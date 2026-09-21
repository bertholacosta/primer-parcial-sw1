/**
 * ModelServer — frontera del servicio de modelo para el corte mínimo.
 *
 * Hospeda un repositorio en memoria de modelos canónicos y sesiones de
 * colaboración (`CollaborationCoordinator`, ADR-0003 Alternativa A). El
 * transporte físico (WebSocket/STOMP u otro) se conecta aquí mediante
 * `dispatch`: el servidor enruta el envelope C2S a la sesión indicada y
 * devuelve las entregas S2C producidas.
 */

import { CollaborationCoordinator, createEnvelope } from "collaboration-protocol";
import type {
  DomainModel,
  Envelope,
  ParticipantRole,
  SessionErrorPayload,
} from "collaboration-protocol";

/** Entrega S2C producida por el coordinador hacia un cliente concreto. */
export interface OutboundDelivery {
  to: string;
  envelope: Envelope;
}

export interface OpenSessionOptions {
  modelId: string;
  sessionId?: string;
  /** Retención del OpLog para catch-up incremental (ver collaboration-protocol §7.2). */
  oplogRetention?: number;
  initialSeqNumber?: number;
  resolveRole?: (clientId: string, authToken?: string) => ParticipantRole;
  requireAuth?: boolean;
}

interface HostedSession {
  coordinator: CollaborationCoordinator;
  deliveries: OutboundDelivery[];
}

export class ModelServer {
  private readonly models = new Map<string, DomainModel>();
  private readonly sessions = new Map<string, HostedSession>();

  /** Registra (o reemplaza) el modelo canónico sobre el que se colabora. */
  registerModel(model: DomainModel): void {
    this.models.set(model.id, model);
  }

  getModel(modelId: string): DomainModel | undefined {
    return this.models.get(modelId);
  }

  /**
   * Abre una sesión de colaboración sobre un modelo registrado.
   * Devuelve el `sessionId` adjudicado.
   */
  openSession(options: OpenSessionOptions): string {
    const model = this.models.get(options.modelId);
    if (!model) {
      throw new Error(`MODEL_NOT_FOUND: no existe un modelo registrado con id '${options.modelId}'.`);
    }
    const deliveries: OutboundDelivery[] = [];
    const coordinator = new CollaborationCoordinator(model, {
      sessionId: options.sessionId,
      oplogRetention: options.oplogRetention,
      initialSeqNumber: options.initialSeqNumber,
      resolveRole: options.resolveRole,
      requireAuth: options.requireAuth,
      emit: (to, envelope) => deliveries.push({ to, envelope }),
    });
    this.sessions.set(coordinator.sessionId, { coordinator, deliveries });
    return coordinator.sessionId;
  }

  /** Enruta un mensaje C2S y devuelve las entregas S2C resultantes. */
  dispatch(clientId: string, envelope: Envelope): OutboundDelivery[] {
    const session = this.sessions.get(envelope.sessionId);
    if (!session) {
      return [
        {
          to: clientId,
          envelope: createEnvelope<SessionErrorPayload>(
            envelope.sessionId,
            envelope.modelId,
            "SessionError",
            {
              errorCode: "SESSION_NOT_FOUND",
              message: `La sesión '${envelope.sessionId}' no existe o ha concluido.`,
              fatal: true,
            },
          ),
        },
      ];
    }
    session.deliveries.length = 0;
    session.coordinator.handleMessage(clientId, envelope);
    return [...session.deliveries];
  }

  coordinator(sessionId: string): CollaborationCoordinator | undefined {
    return this.sessions.get(sessionId)?.coordinator;
  }

  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  /** Cierra la sesión; los participantes posteriores reciben SESSION_NOT_FOUND. */
  closeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}
