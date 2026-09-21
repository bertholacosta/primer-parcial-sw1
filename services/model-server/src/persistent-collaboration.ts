import { applyCommand, canonicalizeModel, commandHash, createEnvelope, modelSha256, type CommandCommittedPayload, type CommandError, type DomainModel, type Envelope, type HeartbeatPayload, type ModelCommand, type ParticipantRole, type SubmitCommandPayload } from "collaboration-protocol";
import type { Database, SqlExecutor } from "./database.js";
import type { DiagramRole } from "./platform-store.js";

export interface PersistentDelivery {
  to: string;
  envelope: Envelope;
}

interface Participant {
  clientId: string;
  userId: string;
  role: ParticipantRole;
}

interface DiagramStateRow {
  model: DomainModel;
  model_version: string;
  model_sha256: string;
}

interface RoleRow { role: DiagramRole }
interface SequenceRow { seq_number: string | number | null }
interface DedupRow {
  command_hash: string;
  seq_number: string | number;
  resulting_version: string;
  resulting_sha256: string;
  command_payload: ModelCommand;
}
interface OplogRow {
  seq_number: string | number;
  client_id: string;
  client_command_id: string;
  command_payload: ModelCommand;
  resulting_version: string;
  resulting_sha256: string;
}

function protocolRole(role: DiagramRole): ParticipantRole {
  return role === "owner" ? "admin" : role;
}

function committedEnvelope(diagramId: string, row: OplogRow | DedupRow, originClientId?: string, clientCommandId?: string): Envelope<CommandCommittedPayload> {
  return createEnvelope(diagramId, diagramId, "CommandCommitted", {
    serverSeqNumber: Number(row.seq_number),
    originClientId: "client_id" in row ? row.client_id : originClientId!,
    clientCommandId: "client_command_id" in row ? row.client_command_id : clientCommandId!,
    resultingModelVersion: row.resulting_version,
    resultingSha256: row.resulting_sha256,
    command: row.command_payload,
  });
}

export class PersistentCollaborationService {
  private readonly participants = new Map<string, Map<string, Participant>>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly database: Database, private readonly now: () => Date = () => new Date()) {}

  private async serialized<T>(diagramId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(diagramId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.queues.set(diagramId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(diagramId) === queued) this.queues.delete(diagramId);
    }
  }

  private diagramParticipants(diagramId: string): Map<string, Participant> {
    let participants = this.participants.get(diagramId);
    if (!participants) {
      participants = new Map();
      this.participants.set(diagramId, participants);
    }
    return participants;
  }

  private async role(executor: SqlExecutor, userId: string, diagramId: string): Promise<DiagramRole | undefined> {
    const result = await executor.query<RoleRow>("SELECT role FROM diagram_members WHERE diagram_id = $1 AND user_id = $2", [diagramId, userId]);
    return result.rows[0]?.role;
  }

  private activeClients(diagramId: string): string[] {
    return [...this.diagramParticipants(diagramId).keys()];
  }

  async dispatch(userId: string, clientId: string, envelope: Envelope): Promise<PersistentDelivery[]> {
    if (envelope.sessionId !== envelope.modelId) return [this.sessionError(clientId, envelope, "SESSION_NOT_FOUND", true)];
    switch (envelope.type) {
      case "JoinSession":
        return this.join(userId, clientId, envelope);
      case "LeaveSession":
        return this.leave(clientId, envelope);
      case "SubmitCommand":
        return this.submit(userId, clientId, envelope as Envelope<SubmitCommandPayload>);
      case "RequestSnapshot":
        return [await this.snapshot(clientId, envelope.modelId)];
      case "Heartbeat":
        return [{ to: clientId, envelope: createEnvelope(envelope.sessionId, envelope.modelId, "HeartbeatAck", { clientTimestamp: (envelope as Envelope<HeartbeatPayload>).payload.clientTimestamp, serverTimestamp: this.now().toISOString() }) }];
      case "AcknowledgeReceipt":
        return [];
      default:
        return [this.sessionError(clientId, envelope, "UNKNOWN_MESSAGE_TYPE", false)];
    }
  }

  private async join(userId: string, clientId: string, envelope: Envelope): Promise<PersistentDelivery[]> {
    const role = await this.role(this.database, userId, envelope.modelId);
    if (!role) return [this.sessionError(clientId, envelope, "INSUFFICIENT_PERMISSIONS", true)];
    const lastKnown = Number((envelope.payload as { lastKnownSeqNumber?: number }).lastKnownSeqNumber ?? 0);
    const sequence = await this.database.query<SequenceRow>("SELECT COALESCE(MAX(seq_number), 0) AS seq_number FROM collaboration_oplog WHERE diagram_id = $1", [envelope.modelId]);
    const currentSeqNumber = Number(sequence.rows[0]?.seq_number ?? 0);
    const participants = this.diagramParticipants(envelope.modelId);
    const existing = participants.has(clientId);
    participants.set(clientId, { clientId, userId, role: protocolRole(role) });
    const deliveries: PersistentDelivery[] = [{
      to: clientId,
      envelope: createEnvelope(envelope.sessionId, envelope.modelId, "SessionJoined", {
        clientId,
        assignedRole: protocolRole(role),
        currentSeqNumber,
        activeParticipants: this.activeClients(envelope.modelId),
      }),
    }];
    if (!existing) {
      for (const other of this.activeClients(envelope.modelId)) {
        if (other !== clientId) deliveries.push({ to: other, envelope: createEnvelope(envelope.sessionId, envelope.modelId, "PresenceUpdated", { participantId: clientId, status: "joined" }) });
      }
    }
    if (lastKnown < currentSeqNumber) {
      const oplog = await this.database.query<OplogRow>(
        `SELECT seq_number, client_id, client_command_id, command_payload, resulting_version, resulting_sha256
         FROM collaboration_oplog WHERE diagram_id = $1 AND seq_number > $2 ORDER BY seq_number`,
        [envelope.modelId, lastKnown],
      );
      const expected = currentSeqNumber - lastKnown;
      if (oplog.rows.length === expected) {
        deliveries.push(...oplog.rows.map((row) => ({ to: clientId, envelope: committedEnvelope(envelope.modelId, row) })));
      } else {
        deliveries.push(await this.snapshot(clientId, envelope.modelId));
      }
    }
    return deliveries;
  }

  private leave(clientId: string, envelope: Envelope): PersistentDelivery[] {
    const participants = this.diagramParticipants(envelope.modelId);
    if (!participants.delete(clientId)) return [];
    return [...participants.keys()].map((to) => ({ to, envelope: createEnvelope(envelope.sessionId, envelope.modelId, "PresenceUpdated", { participantId: clientId, status: "left" }) }));
  }

  private async submit(userId: string, clientId: string, envelope: Envelope<SubmitCommandPayload>): Promise<PersistentDelivery[]> {
    return this.serialized(envelope.modelId, async () => {
      const participant = this.diagramParticipants(envelope.modelId).get(clientId);
      if (!participant || participant.userId !== userId) return [this.sessionError(clientId, envelope, "AUTH_REQUIRED", true)];
      const persisted = await this.database.transaction(async (executor) => {
        const role = await this.role(executor, userId, envelope.modelId);
        if (!role || role === "viewer") return { rejection: this.rejected(clientId, envelope, [{ code: "INSUFFICIENT_PERMISSIONS", path: "$.payload.command", message: "El rol no autoriza mutaciones.", severity: "ERROR" }]) };
        if (envelope.payload.clientCommandId !== envelope.payload.command?.commandId) return { rejection: this.rejected(clientId, envelope, [{ code: "INVALID_COMMAND_BINDING", path: "$.payload.clientCommandId", message: "clientCommandId debe coincidir con command.commandId.", severity: "ERROR" }]) };
        const hash = commandHash(envelope.payload.command);
        const duplicate = await executor.query<DedupRow>(
          `SELECT command_hash, seq_number, resulting_version, resulting_sha256, command_payload
           FROM collaboration_dedup WHERE diagram_id = $1 AND client_id = $2 AND client_command_id = $3`,
          [envelope.modelId, clientId, envelope.payload.clientCommandId],
        );
        if (duplicate.rows[0]) {
          if (duplicate.rows[0].command_hash !== hash) return { rejection: this.rejected(clientId, envelope, [{ code: "IDEMPOTENCY_PAYLOAD_MISMATCH", path: "$.payload.command", message: "El identificador ya fue usado con otro payload.", severity: "ERROR" }]) };
          return { committed: committedEnvelope(envelope.modelId, duplicate.rows[0], clientId, envelope.payload.clientCommandId), duplicate: true };
        }
        const state = await executor.query<DiagramStateRow>("SELECT model, model_version, model_sha256 FROM diagrams WHERE id = $1", [envelope.modelId]);
        if (!state.rows[0]) return { rejection: this.rejected(clientId, envelope, [{ code: "MODEL_NOT_FOUND", path: "$.modelId", message: "Modelo no encontrado.", severity: "ERROR" }]) };
        const outcome = applyCommand(state.rows[0].model, envelope.payload.command);
        if (outcome.result === "rejected") return { rejection: this.rejected(clientId, envelope, outcome.errors) };
        const sequence = await executor.query<SequenceRow>("SELECT COALESCE(MAX(seq_number), 0) AS seq_number FROM collaboration_oplog WHERE diagram_id = $1", [envelope.modelId]);
        const currentSequence = Number(sequence.rows[0]?.seq_number ?? 0);
        if (outcome.result === "noop") {
          return { committed: createEnvelope(envelope.sessionId, envelope.modelId, "CommandCommitted", {
            serverSeqNumber: currentSequence,
            originClientId: clientId,
            clientCommandId: envelope.payload.clientCommandId,
            resultingModelVersion: state.rows[0].model_version,
            resultingSha256: state.rows[0].model_sha256,
            command: envelope.payload.command,
          }), duplicate: true };
        }
        const nextModel = canonicalizeModel(outcome.model);
        const nextSequence = currentSequence + 1;
        const sha = modelSha256(nextModel);
        const createdAt = this.now();
        await executor.query(
          `INSERT INTO collaboration_oplog(diagram_id, seq_number, client_id, client_command_id, command_payload, resulting_version, resulting_sha256, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [envelope.modelId, nextSequence, clientId, envelope.payload.clientCommandId, envelope.payload.command, nextModel.version, sha, createdAt],
        );
        await executor.query(
          `INSERT INTO collaboration_dedup(diagram_id, client_id, client_command_id, command_hash, seq_number, resulting_version, resulting_sha256, command_payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [envelope.modelId, clientId, envelope.payload.clientCommandId, hash, nextSequence, nextModel.version, sha, envelope.payload.command, createdAt],
        );
        await executor.query(
          `INSERT INTO collaboration_snapshots(diagram_id, base_seq_number, model_version, model_sha256, model, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [envelope.modelId, nextSequence, nextModel.version, sha, nextModel, createdAt],
        );
        await executor.query("UPDATE diagrams SET model = $2, model_version = $3, model_sha256 = $4, updated_at = $5 WHERE id = $1", [envelope.modelId, nextModel, nextModel.version, sha, createdAt]);
        return { committed: createEnvelope(envelope.sessionId, envelope.modelId, "CommandCommitted", {
          serverSeqNumber: nextSequence,
          originClientId: clientId,
          clientCommandId: envelope.payload.clientCommandId,
          resultingModelVersion: nextModel.version,
          resultingSha256: sha,
          command: envelope.payload.command,
        }), duplicate: false };
      });
      if (persisted.rejection) return [{ to: clientId, envelope: persisted.rejection }];
      if (persisted.duplicate) return [{ to: clientId, envelope: persisted.committed! }];
      return this.activeClients(envelope.modelId).map((to) => ({ to, envelope: persisted.committed! }));
    });
  }

  private rejected(clientId: string, envelope: Envelope<SubmitCommandPayload>, errors: CommandError[]): Envelope {
    return createEnvelope(envelope.sessionId, envelope.modelId, "CommandRejected", {
      originClientId: clientId,
      clientCommandId: envelope.payload.clientCommandId,
      baseSeqNumber: envelope.payload.baseSeqNumber,
      currentSeqNumber: envelope.payload.baseSeqNumber,
      errors,
    });
  }

  private sessionError(clientId: string, envelope: Envelope, errorCode: string, fatal: boolean): PersistentDelivery {
    return { to: clientId, envelope: createEnvelope(envelope.sessionId, envelope.modelId, "SessionError", { errorCode, message: errorCode, fatal }) };
  }

  private async snapshot(clientId: string, diagramId: string): Promise<PersistentDelivery> {
    const state = await this.database.query<DiagramStateRow>("SELECT model, model_version, model_sha256 FROM diagrams WHERE id = $1", [diagramId]);
    if (!state.rows[0]) return { to: clientId, envelope: createEnvelope(diagramId, diagramId, "SessionError", { errorCode: "SESSION_NOT_FOUND", message: "SESSION_NOT_FOUND", fatal: true }) };
    const sequence = await this.database.query<SequenceRow>("SELECT COALESCE(MAX(seq_number), 0) AS seq_number FROM collaboration_oplog WHERE diagram_id = $1", [diagramId]);
    return {
      to: clientId,
      envelope: createEnvelope(diagramId, diagramId, "SnapshotResponse", {
        baseSeqNumber: Number(sequence.rows[0]?.seq_number ?? 0),
        modelVersion: state.rows[0].model_version,
        modelSha256: state.rows[0].model_sha256,
        model: state.rows[0].model,
        activeParticipants: this.activeClients(diagramId),
      }),
    };
  }
}
