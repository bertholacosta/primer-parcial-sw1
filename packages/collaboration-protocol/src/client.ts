/**
 * Cliente de colaboración — máquina de estados del participante según el
 * contrato `collaboration-protocol-v1.md` §8.
 *
 * El cliente mantiene una copia local del modelo canónico y la hace converger
 * aplicando `CommandCommitted` en orden estricto de `serverSeqNumber`
 * (deduplicación §5.2) o sustituyéndola por un snapshot verificado por
 * SHA-256 (I6). Las mutaciones solo se emiten como `SubmitCommand` en estado
 * `IN_SYNC`; fuera de él se retienen en una cola de salida local.
 */

import { applyCommand } from "./commands.js";
import type { ModelCommand } from "./commands.js";
import { cloneModel, modelSha256 } from "./model.js";
import type { DomainModel } from "./model.js";
import { createEnvelope } from "./messages.js";
import type {
  AcknowledgeReceiptPayload,
  CommandCommittedPayload,
  CommandRejectedPayload,
  Envelope,
  HeartbeatPayload,
  JoinSessionPayload,
  LeaveSessionPayload,
  ParticipantRole,
  PresenceUpdatedPayload,
  SessionErrorPayload,
  SessionJoinedPayload,
  SnapshotResponsePayload,
  SubmitCommandPayload,
} from "./messages.js";

export type ClientState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "JOINING"
  | "SYNCING_CATCHUP"
  | "SYNCING_SNAPSHOT"
  | "IN_SYNC"
  | "RECONNECTING";

export interface ClientOptions {
  clientId: string;
  authToken: string;
  modelId: string;
  /** Canal de salida hacia el coordinador (lo provee el transporte). */
  send: (envelope: Envelope) => void;
  /** Copia local previa del modelo (reconexión con estado persistido). */
  initialModel?: DomainModel;
  /** Último `serverSeqNumber` aplicado sobre `initialModel`. */
  initialSeqNumber?: number;
  clientMetadata?: Record<string, unknown>;
}

export class CollaborationClient {
  readonly clientId: string;
  readonly modelId: string;

  state: ClientState = "DISCONNECTED";
  sessionId?: string;
  assignedRole?: ParticipantRole;
  localModel?: DomainModel;
  localSeqNumber: number;

  /** Observabilidad mínima para consumidores y pruebas. */
  readonly rejections: CommandRejectedPayload[] = [];
  readonly sessionErrors: SessionErrorPayload[] = [];
  readonly presenceLog: PresenceUpdatedPayload[] = [];

  private readonly authToken: string;
  private readonly clientMetadata?: Record<string, unknown>;
  private readonly send: (envelope: Envelope) => void;
  private targetSeqNumber?: number;
  private readonly outOfOrder = new Map<number, Envelope<CommandCommittedPayload>>();
  private readonly outboundQueue: Envelope<SubmitCommandPayload>[] = [];
  /** Comandos emitidos por este cliente aún sin resolución (commit/reject). */
  private readonly unresolvedEnvelopes = new Map<string, Envelope<SubmitCommandPayload>>();

  constructor(options: ClientOptions) {
    this.clientId = options.clientId;
    this.modelId = options.modelId;
    this.authToken = options.authToken;
    this.clientMetadata = options.clientMetadata;
    this.send = options.send;
    this.localModel = options.initialModel ? cloneModel(options.initialModel) : undefined;
    this.localSeqNumber = options.initialSeqNumber ?? 0;
  }

  /** Abre la participación en una sesión (DISCONNECTED → CONNECTING → JOINING). */
  connect(sessionId: string): void {
    this.sessionId = sessionId;
    this.state = "CONNECTING";
    this.sendJoin();
  }

  /** Reintento tras pérdida transitoria (RECONNECTING → CONNECTING → JOINING). */
  reconnect(): void {
    if (!this.sessionId) {
      throw new Error("No hay sessionId previo; use connect(sessionId).");
    }
    this.state = "RECONNECTING";
    this.state = "CONNECTING";
    this.sendJoin();
  }

  /** Corte del enlace: el estado local se conserva para la reconexión (§7.2). */
  disconnect(): void {
    // Los comandos ya transmitidos pero sin resolución se reencolan al frente:
    // tras el rejoin se reenvían con el mismo clientCommandId y payload intacto,
    // así la deduplicación por commandHash del servidor los reconoce (§5.1, §9.5).
    const resend = [...this.unresolvedEnvelopes.values()].filter(
      (envelope) => !this.outboundQueue.includes(envelope),
    );
    if (resend.length > 0) {
      this.outboundQueue.unshift(...resend);
    }
    this.state = this.sessionId ? "RECONNECTING" : "DISCONNECTED";
  }

  /** Cierre voluntario y ordenado (IN_SYNC → DISCONNECTED). */
  leave(reason?: string): void {
    if (this.sessionId && this.state === "IN_SYNC") {
      this.send(createEnvelope<LeaveSessionPayload>(this.sessionId, this.modelId, "LeaveSession", {
        clientId: this.clientId,
        reason,
      }));
    }
    this.state = "DISCONNECTED";
    this.sessionId = undefined;
    // Cierre voluntario: el trabajo pendiente de envío se descarta.
    this.outboundQueue.length = 0;
    this.unresolvedEnvelopes.clear();
  }

  /**
   * Construye un comando del contrato model-commands-v1 con la versión local
   * vigente y un `commandId` nuevo (UUID v4).
   */
  buildCommand(type: ModelCommand["type"], payload: ModelCommand["payload"]): ModelCommand {
    if (!this.localModel) {
      throw new Error("Sin copia local del modelo; el cliente aún no está sincronizado.");
    }
    return {
      type,
      commandId: crypto.randomUUID(),
      modelId: this.modelId,
      modelVersion: this.localModel.version,
      payload,
    } as ModelCommand;
  }

  /**
   * Emite un `SubmitCommand`. Solo se envía en `IN_SYNC`; en cualquier otro
   * estado se encola y se drena al alcanzar `IN_SYNC`. El comando se conserva
   * como no resuelto hasta su commit/reject, lo que permite reencolarlo tras
   * una desconexión con payload intacto para la deduplicación del servidor.
   */
  submitCommand(command: ModelCommand): Envelope<SubmitCommandPayload> {
    const envelope = createEnvelope<SubmitCommandPayload>(this.sessionId ?? "", this.modelId, "SubmitCommand", {
      clientCommandId: command.commandId,
      baseSeqNumber: this.localSeqNumber,
      command,
    });
    this.unresolvedEnvelopes.set(command.commandId, envelope);
    if (this.state === "IN_SYNC") {
      this.send(envelope);
    } else {
      this.outboundQueue.push(envelope);
    }
    return envelope;
  }

  /** Entrega de un mensaje S2C por el transporte. */
  deliver(envelope: Envelope): void {
    switch (envelope.type) {
      case "SessionJoined":
        this.onSessionJoined(envelope as Envelope<SessionJoinedPayload>);
        break;
      case "CommandCommitted":
        this.onCommandCommitted(envelope as Envelope<CommandCommittedPayload>);
        break;
      case "CommandRejected":
        this.onCommandRejected(envelope as Envelope<CommandRejectedPayload>);
        break;
      case "SnapshotResponse":
        this.onSnapshotResponse(envelope as Envelope<SnapshotResponsePayload>);
        break;
      case "PresenceUpdated":
        this.presenceLog.push((envelope as Envelope<PresenceUpdatedPayload>).payload);
        break;
      case "SessionError":
        this.onSessionError(envelope as Envelope<SessionErrorPayload>);
        break;
      case "HeartbeatAck":
        break;
      default:
        break;
    }
  }

  /** Heartbeat de vivacidad (§2.2). */
  heartbeat(): void {
    if (!this.sessionId) return;
    this.send(createEnvelope<HeartbeatPayload>(this.sessionId, this.modelId, "Heartbeat", {
      clientId: this.clientId,
      clientTimestamp: new Date().toISOString(),
    }));
  }

  /** Confirmación de recepción de secuencias (§2.2). */
  acknowledge(): void {
    if (!this.sessionId) return;
    this.send(createEnvelope<AcknowledgeReceiptPayload>(this.sessionId, this.modelId, "AcknowledgeReceipt", {
      clientId: this.clientId,
      receivedSeqNumber: this.localSeqNumber,
    }));
  }

  /* ---------------------------------------------------------------- */

  private sendJoin(): void {
    this.state = "JOINING";
    this.send(createEnvelope<JoinSessionPayload>(this.sessionId!, this.modelId, "JoinSession", {
      clientId: this.clientId,
      authToken: this.authToken,
      lastKnownSeqNumber: this.localSeqNumber,
      clientMetadata: this.clientMetadata,
    }));
  }

  private onSessionJoined(envelope: Envelope<SessionJoinedPayload>): void {
    const p = envelope.payload;
    this.assignedRole = p.assignedRole;
    this.targetSeqNumber = p.currentSeqNumber;
    if (p.snapshot) {
      this.installSnapshot({
        baseSeqNumber: p.snapshot.baseSeqNumber,
        modelVersion: p.snapshot.modelVersion,
        modelSha256: p.snapshot.modelSha256,
        model: p.snapshot.model,
        activeParticipants: p.activeParticipants,
      });
      return;
    }
    if (this.localSeqNumber >= p.currentSeqNumber) {
      this.enterInSync();
    }
    // Si hay brecha, el siguiente mensaje (CommandCommitted o
    // SnapshotResponse) fija el subestado SYNCING_*.
  }

  private onCommandCommitted(envelope: Envelope<CommandCommittedPayload>): void {
    const p = envelope.payload;
    this.releaseUnresolved(p.clientCommandId);

    // §5.2: descarte idempotente de secuencias ya aplicadas.
    if (p.serverSeqNumber <= this.localSeqNumber) {
      return;
    }

    if (this.state === "JOINING") {
      this.state = "SYNCING_CATCHUP";
    }

    if (p.serverSeqNumber === this.localSeqNumber + 1) {
      this.applyCommitted(p);
      this.drainOutOfOrder();
    } else {
      // Brecha en la entrega: se bufferiza y se solicita resincronización.
      this.outOfOrder.set(p.serverSeqNumber, envelope);
      if (this.sessionId) {
        this.state = "RECONNECTING";
        this.sendJoin();
      }
      return;
    }

    if (this.targetSeqNumber !== undefined && this.localSeqNumber >= this.targetSeqNumber) {
      this.enterInSync();
    }
  }

  private applyCommitted(p: CommandCommittedPayload): void {
    if (!this.localModel) {
      // Sin estado local, el commit no es aplicable; se pide snapshot.
      this.requestSnapshot();
      return;
    }
    const outcome = applyCommand(this.localModel, p.command);
    if (outcome.result === "rejected") {
      // Divergencia local irrecuperable: fallback a snapshot.
      this.requestSnapshot();
      return;
    }
    if (outcome.result === "accepted") {
      this.localModel = outcome.model;
    }
    this.localSeqNumber = p.serverSeqNumber;
  }

  private drainOutOfOrder(): void {
    let next = this.localSeqNumber + 1;
    while (this.outOfOrder.has(next)) {
      const envelope = this.outOfOrder.get(next)!;
      this.outOfOrder.delete(next);
      this.releaseUnresolved(envelope.payload.clientCommandId);
      this.applyCommitted(envelope.payload);
      next = this.localSeqNumber + 1;
    }
  }

  private onCommandRejected(envelope: Envelope<CommandRejectedPayload>): void {
    const p = envelope.payload;
    if (p.originClientId === this.clientId) {
      this.releaseUnresolved(p.clientCommandId);
      this.rejections.push(p);
    }
  }

  private onSnapshotResponse(envelope: Envelope<SnapshotResponsePayload>): void {
    this.state = "SYNCING_SNAPSHOT";
    this.installSnapshot(envelope.payload);
  }

  private installSnapshot(p: SnapshotResponsePayload): void {
    const snapshotModel = cloneModel(p.model);
    if (modelSha256(snapshotModel) !== p.modelSha256) {
      // I6 / §11: checksum inválido, el snapshot se descarta.
      this.sessionErrors.push({
        errorCode: "SNAPSHOT_CHECKSUM_MISMATCH",
        message: `El hash SHA-256 del snapshot no coincide con '${p.modelSha256}'; se descarta.`,
        fatal: true,
      });
      this.state = "DISCONNECTED";
      return;
    }
    this.localModel = snapshotModel;
    this.localSeqNumber = p.baseSeqNumber;
    this.outOfOrder.clear();
    this.enterInSync();
  }

  private onSessionError(envelope: Envelope<SessionErrorPayload>): void {
    this.sessionErrors.push(envelope.payload);
    if (envelope.payload.fatal) {
      this.state = "DISCONNECTED";
    }
  }

  private requestSnapshot(): void {
    if (!this.sessionId) return;
    this.send(createEnvelope(this.sessionId, this.modelId, "RequestSnapshot", {
      clientId: this.clientId,
      reason: "local-divergence",
    }));
  }

  private enterInSync(): void {
    this.state = "IN_SYNC";
    this.targetSeqNumber = undefined;
    // Drena la cola de salida retenida durante la sincronización (§8.1).
    while (this.outboundQueue.length > 0) {
      this.send(this.outboundQueue.shift()!);
    }
  }

  /** Libera el comando tras commit/reject definitivo (I4, §5.1). */
  private releaseUnresolved(clientCommandId: string): void {
    const envelope = this.unresolvedEnvelopes.get(clientCommandId);
    if (envelope) {
      this.unresolvedEnvelopes.delete(clientCommandId);
      const queued = this.outboundQueue.indexOf(envelope);
      if (queued >= 0) {
        this.outboundQueue.splice(queued, 1);
      }
    }
  }
}
