/**
 * Coordinador de sesión — autoridad de secuenciación central (ADR-0003,
 * Alternativa A) para el contrato `collaboration-protocol-v1`.
 *
 * Responsabilidades:
 * - Orden total: asigna `serverSeqNumber` monótono y consecutivo (I2).
 * - Idempotencia: deduplicación por `(clientId, clientCommandId)` (I3, §5.1).
 * - No-mutación en rechazo: ningún rechazo altera el modelo ni consume
 *   secuencia (I4, §6.2).
 * - Reconexión: catch-up incremental desde el OpLog o `SnapshotResponse`
 *   verificado por SHA-256 (§7.2, I6).
 */

import { randomUUID } from "node:crypto";
import { applyCommand } from "./commands.js";
import type { CommandError, ModelCommand } from "./commands.js";
import { canonicalizeModel, cloneModel, commandHash, modelSha256 } from "./model.js";
import type { DomainModel } from "./model.js";
import {
  PROTOCOL_VERSION,
  createEnvelope,
} from "./messages.js";
import type {
  AcknowledgeReceiptPayload,
  CommandCommittedPayload,
  CommandRejectedPayload,
  Envelope,
  HeartbeatAckPayload,
  HeartbeatPayload,
  JoinSessionPayload,
  LeaveSessionPayload,
  ModelSnapshot,
  ParticipantRole,
  PresenceUpdatedPayload,
  RequestSnapshotPayload,
  SessionErrorPayload,
  SessionJoinedPayload,
  SnapshotResponsePayload,
  SubmitCommandPayload,
} from "./messages.js";

interface Participant {
  clientId: string;
  role: ParticipantRole;
  status: "active" | "left";
  lastAckedSeqNumber: number;
  metadata?: Record<string, unknown>;
}

interface OplogEntry {
  seqNumber: number;
  originClientId: string;
  clientCommandId: string;
  command: ModelCommand;
  resultingModelVersion: string;
  resultingSha256: string;
  committedEnvelope: Envelope<CommandCommittedPayload>;
}

interface DedupRecord {
  serverSeqNumber: number;
  resultingModelVersion: string;
  resultingSha256: string;
  commandHash: string;
  committedEnvelope: Envelope<CommandCommittedPayload>;
}

export interface CoordinatorOptions {
  /** Emisor de mensajes S2C; el transporte es responsabilidad del llamador (I5). */
  emit: (clientId: string, envelope: Envelope) => void;
  sessionId?: string;
  /**
   * Número máximo de entradas del OpLog retenidas para catch-up incremental.
   * Las entradas anteriores se podan y la brecha se resuelve por snapshot
   * (§7.2). Por defecto, retención ilimitada.
   */
  oplogRetention?: number;
  /** Secuencia inicial (por defecto 0; el primer comando aceptado es seq=1). */
  initialSeqNumber?: number;
  /** Adjudicación de rol en JoinSession; por defecto `editor`. */
  resolveRole?: (clientId: string, authToken?: string) => ParticipantRole;
  /** Si es true (defecto), un JoinSession sin `authToken` se rechaza con AUTH_REQUIRED. */
  requireAuth?: boolean;
}

export class CollaborationCoordinator {
  readonly sessionId: string;
  readonly modelId: string;

  private model: DomainModel;
  private seqNumber: number;
  private readonly emit: (clientId: string, envelope: Envelope) => void;
  private readonly resolveRole: (clientId: string, authToken?: string) => ParticipantRole;
  private readonly requireAuth: boolean;
  private readonly oplogRetention: number;
  private readonly participants = new Map<string, Participant>();
  private readonly dedup = new Map<string, DedupRecord>();
  private readonly oplog: OplogEntry[] = [];

  constructor(model: DomainModel, options: CoordinatorOptions) {
    this.model = canonicalizeModel(cloneModel(model));
    this.modelId = this.model.id;
    this.sessionId = options.sessionId ?? randomUUID();
    this.seqNumber = options.initialSeqNumber ?? 0;
    this.emit = options.emit;
    this.resolveRole = options.resolveRole ?? (() => "editor");
    this.requireAuth = options.requireAuth ?? true;
    this.oplogRetention = options.oplogRetention ?? Number.POSITIVE_INFINITY;
  }

  get currentSeqNumber(): number {
    return this.seqNumber;
  }

  get currentModel(): DomainModel {
    return this.model;
  }

  get oplogSize(): number {
    return this.oplog.length;
  }

  get dedupSize(): number {
    return this.dedup.size;
  }

  /** Menor `serverSeqNumber` aún disponible en el OpLog para catch-up. */
  get minAvailableSeqNumber(): number {
    return this.oplog.length > 0 ? this.oplog[0].seqNumber : this.seqNumber + 1;
  }

  activeParticipants(): string[] {
    return [...this.participants.values()]
      .filter((p) => p.status === "active")
      .map((p) => p.clientId);
  }

  /** Punto de entrada único para mensajes C2S. */
  handleMessage(clientId: string, envelope: Envelope): void {
    if (envelope.sessionId !== this.sessionId || envelope.modelId !== this.modelId) {
      this.emitError(clientId, envelope, {
        errorCode: "SESSION_NOT_FOUND",
        message: `La sesión '${envelope.sessionId}' no existe o ha concluido.`,
        fatal: true,
      });
      return;
    }

    switch (envelope.type) {
      case "JoinSession":
        this.handleJoin(clientId, envelope as Envelope<JoinSessionPayload>);
        break;
      case "LeaveSession":
        this.handleLeave(clientId, envelope as Envelope<LeaveSessionPayload>);
        break;
      case "SubmitCommand":
        this.handleSubmitCommand(clientId, envelope as Envelope<SubmitCommandPayload>);
        break;
      case "AcknowledgeReceipt":
        this.handleAcknowledge(clientId, envelope as Envelope<AcknowledgeReceiptPayload>);
        break;
      case "RequestSnapshot":
        this.handleRequestSnapshot(clientId, envelope as Envelope<RequestSnapshotPayload>);
        break;
      case "Heartbeat":
        this.handleHeartbeat(clientId, envelope as Envelope<HeartbeatPayload>);
        break;
      default:
        this.emitError(clientId, envelope, {
          errorCode: "UNKNOWN_MESSAGE_TYPE",
          message: `Tipo de mensaje '${envelope.type}' no reconocido por el protocolo v1.`,
          fatal: false,
        });
    }
  }

  /* ---------------------------------------------------------------- */

  private handleJoin(clientId: string, envelope: Envelope<JoinSessionPayload>): void {
    const p = envelope.payload;
    const effectiveClientId = p.clientId ?? clientId;

    if (this.requireAuth && !p.authToken) {
      this.emitError(effectiveClientId, envelope, {
        errorCode: "AUTH_REQUIRED",
        message: "Credencial ausente o token no válido en JoinSession.",
        fatal: true,
      });
      return;
    }

    const role = this.resolveRole(effectiveClientId, p.authToken);
    const wasKnown = this.participants.get(effectiveClientId);
    this.participants.set(effectiveClientId, {
      clientId: effectiveClientId,
      role,
      status: "active",
      lastAckedSeqNumber: wasKnown?.lastAckedSeqNumber ?? p.lastKnownSeqNumber,
      metadata: p.clientMetadata,
    });

    const joined = createEnvelope<SessionJoinedPayload>(this.sessionId, this.modelId, "SessionJoined", {
      clientId: effectiveClientId,
      assignedRole: role,
      currentSeqNumber: this.seqNumber,
      activeParticipants: this.activeParticipants(),
    });
    this.emit(effectiveClientId, joined);

    if (!wasKnown) {
      this.broadcastExcept(effectiveClientId, createEnvelope<PresenceUpdatedPayload>(
        this.sessionId,
        this.modelId,
        "PresenceUpdated",
        { participantId: effectiveClientId, status: "joined", metadata: p.clientMetadata },
      ));
    }

    const lastKnown = p.lastKnownSeqNumber;
    if (lastKnown >= this.seqNumber) {
      return;
    }

    if (lastKnown + 1 >= this.minAvailableSeqNumber) {
      // Catch-up incremental: retransmisión ordenada de los commits perdidos.
      for (const entry of this.oplog) {
        if (entry.seqNumber > lastKnown) {
          this.emit(effectiveClientId, entry.committedEnvelope);
        }
      }
      return;
    }

    // Brecha profunda: el OpLog ya no cubre las secuencias -> Snapshot Fallback.
    this.emitError(effectiveClientId, envelope, {
      errorCode: "OPLOG_TRUNCATED",
      message: `La brecha de secuencias (lastKnown=${lastKnown}, mínimo disponible=${this.minAvailableSeqNumber}) excede la retención del OpLog; se transiciona a sincronización por snapshot.`,
      fatal: false,
    });
    this.emit(effectiveClientId, this.buildSnapshotResponse());
  }

  private handleLeave(clientId: string, envelope: Envelope<LeaveSessionPayload>): void {
    const participant = this.participants.get(clientId);
    if (!participant || participant.status !== "active") return;
    participant.status = "left";
    this.broadcastExcept(clientId, createEnvelope<PresenceUpdatedPayload>(
      this.sessionId,
      this.modelId,
      "PresenceUpdated",
      { participantId: clientId, status: "left", metadata: { reason: envelope.payload.reason } },
    ));
  }

  private handleSubmitCommand(clientId: string, envelope: Envelope<SubmitCommandPayload>): void {
    const p = envelope.payload;
    const participant = this.participants.get(clientId);

    if (!participant || participant.status !== "active") {
      this.emitError(clientId, envelope, {
        errorCode: "AUTH_REQUIRED",
        message: "El cliente no está unido a la sesión; emita JoinSession antes de SubmitCommand.",
        fatal: true,
      });
      return;
    }

    const reject = (errors: CommandError[]) =>
      this.emit(clientId, createEnvelope<CommandRejectedPayload>(this.sessionId, this.modelId, "CommandRejected", {
        originClientId: clientId,
        clientCommandId: p.clientCommandId,
        baseSeqNumber: p.baseSeqNumber,
        currentSeqNumber: this.seqNumber,
        errors,
      }));

    // Autorización por rol (§3.2): viewer no puede emitir mutaciones.
    if (participant.role === "viewer") {
      reject([
        {
          code: "INSUFFICIENT_PERMISSIONS",
          path: "$.payload.command",
          message: `El rol 'viewer' no autoriza la emisión de comandos de mutación.`,
          severity: "ERROR",
        },
      ]);
      return;
    }

    // D1: vinculación estricta clientCommandId == command.commandId.
    if (p.clientCommandId !== p.command?.commandId) {
      reject([
        {
          code: "INVALID_COMMAND_BINDING",
          path: "$.payload.clientCommandId",
          message: "El clientCommandId del envelope debe ser idéntico a command.commandId.",
          severity: "ERROR",
        },
      ]);
      return;
    }

    // §5.1: deduplicación por clave de emisor.
    const dedupKey = `${clientId}:${p.clientCommandId}`;
    const previous = this.dedup.get(dedupKey);
    if (previous) {
      if (previous.commandHash === commandHash(p.command)) {
        // Reuso con contenido idéntico: noop; se retransmite el commit original.
        this.emit(clientId, previous.committedEnvelope);
      } else {
        reject([
          {
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            path: "$.payload.command",
            message: `El clientCommandId '${p.clientCommandId}' ya fue registrado con un payload diferente.`,
            severity: "ERROR",
          },
        ]);
      }
      return;
    }

    const outcome = applyCommand(this.model, p.command);

    if (outcome.result === "rejected") {
      // I4: el modelo queda inalterado y la secuencia no avanza.
      reject(outcome.errors);
      return;
    }

    if (outcome.result === "noop") {
      // Comando sin efecto observable: no consume secuencia (I2); se confirma
      // al emisor con el seq vigente para que libere el comando pendiente.
      this.emit(clientId, createEnvelope<CommandCommittedPayload>(this.sessionId, this.modelId, "CommandCommitted", {
        serverSeqNumber: this.seqNumber,
        originClientId: clientId,
        clientCommandId: p.clientCommandId,
        resultingModelVersion: this.model.version,
        resultingSha256: modelSha256(this.model),
        command: p.command,
      }));
      return;
    }

    // accepted: ordenación lineal, persistencia en OpLog y difusión.
    this.seqNumber += 1;
    this.model = canonicalizeModel(outcome.model);
    const resultingSha256 = modelSha256(this.model);

    const committed = createEnvelope<CommandCommittedPayload>(this.sessionId, this.modelId, "CommandCommitted", {
      serverSeqNumber: this.seqNumber,
      originClientId: clientId,
      clientCommandId: p.clientCommandId,
      resultingModelVersion: this.model.version,
      resultingSha256,
      command: p.command,
    });

    this.oplog.push({
      seqNumber: this.seqNumber,
      originClientId: clientId,
      clientCommandId: p.clientCommandId,
      command: p.command,
      resultingModelVersion: this.model.version,
      resultingSha256,
      committedEnvelope: committed,
    });
    while (this.oplog.length > this.oplogRetention) {
      this.oplog.shift();
    }

    this.dedup.set(dedupKey, {
      serverSeqNumber: this.seqNumber,
      resultingModelVersion: this.model.version,
      resultingSha256,
      commandHash: commandHash(p.command),
      committedEnvelope: committed,
    });

    for (const participantId of this.activeParticipants()) {
      this.emit(participantId, committed);
    }
  }

  private handleAcknowledge(clientId: string, envelope: Envelope<AcknowledgeReceiptPayload>): void {
    const participant = this.participants.get(clientId);
    if (participant) {
      participant.lastAckedSeqNumber = Math.max(participant.lastAckedSeqNumber, envelope.payload.receivedSeqNumber);
    }
  }

  private handleRequestSnapshot(clientId: string, _envelope: Envelope<RequestSnapshotPayload>): void {
    this.emit(clientId, this.buildSnapshotResponse());
  }

  private handleHeartbeat(clientId: string, envelope: Envelope<HeartbeatPayload>): void {
    this.emit(clientId, createEnvelope<HeartbeatAckPayload>(this.sessionId, this.modelId, "HeartbeatAck", {
      clientTimestamp: envelope.payload.clientTimestamp,
      serverTimestamp: new Date().toISOString(),
    }));
  }

  /* ---------------------------------------------------------------- */

  private buildSnapshot(): ModelSnapshot {
    const model = canonicalizeModel(cloneModel(this.model));
    return {
      protocolVersion: PROTOCOL_VERSION,
      snapshotId: `snap-${randomUUID()}`,
      modelId: this.modelId,
      baseSeqNumber: this.seqNumber,
      modelVersion: this.model.version,
      modelSha256: modelSha256(model),
      createdAt: new Date().toISOString(),
      model,
    };
  }

  private buildSnapshotResponse(): Envelope<SnapshotResponsePayload> {
    const snapshot = this.buildSnapshot();
    return createEnvelope<SnapshotResponsePayload>(this.sessionId, this.modelId, "SnapshotResponse", {
      baseSeqNumber: snapshot.baseSeqNumber,
      modelVersion: snapshot.modelVersion,
      modelSha256: snapshot.modelSha256,
      model: snapshot.model,
      activeParticipants: this.activeParticipants(),
    });
  }

  private broadcastExcept(exceptClientId: string, envelope: Envelope): void {
    for (const participantId of this.activeParticipants()) {
      if (participantId !== exceptClientId) {
        this.emit(participantId, envelope);
      }
    }
  }

  private emitError(clientId: string, source: Envelope, payload: SessionErrorPayload): void {
    this.emit(
      clientId,
      createEnvelope<SessionErrorPayload>(source.sessionId ?? this.sessionId, source.modelId ?? this.modelId, "SessionError", payload),
    );
  }
}
