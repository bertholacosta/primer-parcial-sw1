/**
 * Envelope canónico y catálogo de mensajes — contrato
 * `docs/contracts/collaboration-protocol-v1.md` §2 (protocolVersion "1.0.0").
 */

import { randomUUID } from "node:crypto";
import type { CommandError, ModelCommand } from "./commands.js";
import type { DomainModel } from "./model.js";

export const PROTOCOL_VERSION = "1.0.0";

/** Roles normativos §3.2. */
export type ParticipantRole = "viewer" | "editor" | "admin";

/** Códigos del catálogo consolidado de errores §11. */
export const PROTOCOL_ERROR_CODES = [
  "AUTH_REQUIRED",
  "INSUFFICIENT_PERMISSIONS",
  "SESSION_NOT_FOUND",
  "CONCURRENT_MODIFICATION",
  "IDEMPOTENCY_PAYLOAD_MISMATCH",
  "OPLOG_TRUNCATED",
  "SNAPSHOT_CHECKSUM_MISMATCH",
  "INVALID_COMMAND_BINDING",
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export interface Envelope<T = unknown> {
  protocolVersion: string;
  messageId: string;
  sessionId: string;
  modelId: string;
  type: string;
  timestamp: string;
  payload: T;
}

/** Crea un envelope conforme a §2.1 con messageId UUID v4 y timestamp ISO 8601 UTC. */
export function createEnvelope<T>(
  sessionId: string,
  modelId: string,
  type: string,
  payload: T,
): Envelope<T> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: randomUUID(),
    sessionId,
    modelId,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/* ------------------------------------------------------------------ */
/* Mensajes de cliente a coordinador (C2S) — §2.2                      */
/* ------------------------------------------------------------------ */

export interface JoinSessionPayload {
  clientId: string;
  authToken?: string;
  lastKnownSeqNumber: number;
  clientMetadata?: Record<string, unknown>;
}

export interface LeaveSessionPayload {
  clientId: string;
  reason?: string;
}

export interface SubmitCommandPayload {
  clientCommandId: string;
  baseSeqNumber: number;
  command: ModelCommand;
}

export interface AcknowledgeReceiptPayload {
  clientId: string;
  receivedSeqNumber: number;
}

export interface RequestSnapshotPayload {
  clientId: string;
  reason?: string;
}

export interface HeartbeatPayload {
  clientId: string;
  clientTimestamp: string;
}

/* ------------------------------------------------------------------ */
/* Mensajes de coordinador a cliente (S2C) — §2.3                      */
/* ------------------------------------------------------------------ */

export interface SessionJoinedPayload {
  clientId: string;
  assignedRole: ParticipantRole;
  currentSeqNumber: number;
  snapshot?: ModelSnapshot;
  activeParticipants: string[];
}

export interface CommandCommittedPayload {
  serverSeqNumber: number;
  originClientId: string;
  clientCommandId: string;
  resultingModelVersion: string;
  resultingSha256: string;
  command: ModelCommand;
}

export interface CommandRejectedPayload {
  originClientId: string;
  clientCommandId: string;
  baseSeqNumber: number;
  currentSeqNumber: number;
  errors: CommandError[];
}

export interface SnapshotResponsePayload {
  baseSeqNumber: number;
  modelVersion: string;
  modelSha256: string;
  model: DomainModel;
  activeParticipants: string[];
}

export interface PresenceUpdatedPayload {
  participantId: string;
  status: "joined" | "left" | "disconnected";
  metadata?: Record<string, unknown>;
}

export interface SessionErrorPayload {
  errorCode: ProtocolErrorCode | string;
  message: string;
  fatal: boolean;
}

export interface HeartbeatAckPayload {
  clientTimestamp: string;
  serverTimestamp: string;
}

/** Snapshot completo y autosuficiente del modelo canónico — §7.1. */
export interface ModelSnapshot {
  protocolVersion: string;
  snapshotId: string;
  modelId: string;
  baseSeqNumber: number;
  modelVersion: string;
  modelSha256: string;
  createdAt: string;
  model: DomainModel;
}
