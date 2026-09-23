import {
  CollaborationClient,
  createEnvelope,
  type ClientState,
  type CommandError,
  type CommandCommittedPayload,
  type CommandRejectedPayload,
  type DomainModel,
  type Envelope,
  type ModelCommand,
  type ParticipantRole,
  type PresenceUpdatedPayload,
  type SessionJoinedPayload,
} from 'collaboration-protocol';
import { encodeStompFrame, parseStompFrame, splitStompFrames } from './stomp';

export type SessionConnectionState =
  | 'connecting'
  | 'syncing'
  | 'in_sync'
  | 'reconnecting'
  | 'closed';

export interface SessionOutcome {
  commandId: string;
  type: string;
  payload: unknown;
  result: 'accepted' | 'rejected';
  modelVersion?: string;
  errors?: CommandError[];
}

export interface CollaborationSessionEvents {
  onModel(model: DomainModel): void;
  onState(state: SessionConnectionState): void;
  onRole(role: ParticipantRole): void;
  onParticipants(participants: string[]): void;
  onOutcome(outcome: SessionOutcome): void;
  onError(message: string): void;
}

/**
 * Subconjunto de la interfaz DOM WebSocket que la sesión necesita; permite
 * inyectar sockets falsos en pruebas.
 */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: unknown;
  onmessage: unknown;
  onclose: unknown;
  onerror: unknown;
}

export interface CollaborationSessionOptions {
  url: string;
  diagramId: string;
  clientId: string;
  /** Proveedor del access token; se invoca en cada apertura/reconexión. */
  getToken: () => Promise<string>;
  socketFactory?: (url: string) => SocketLike;
  reconnectDelayMs?: number;
  events: CollaborationSessionEvents;
}

const SOCKET_OPEN = 1;

/**
 * Adapta `CollaborationClient` (transporte-neutral) al enlace WebSocket/STOMP
 * de model-server: CONNECT autenticado, SUBSCRIBE a /topic/diagrams/{id} y
 * SEND a /app/diagrams/{id}. Tras `SessionJoined`, si el cliente no tiene
 * copia local, descarta el replay del OpLog (no tiene base para aplicarlo) y
 * solicita `RequestSnapshot`, cuyo SnapshotResponse instala el modelo.
 */
export class CollaborationSession {
  readonly clientId: string;
  readonly diagramId: string;

  private readonly client: CollaborationClient;
  private readonly options: CollaborationSessionOptions;
  private readonly socketFactory: (url: string) => SocketLike;
  private readonly pending = new Map<string, { type: string; payload: unknown }>();
  private readonly participants = new Map<string, 'joined' | 'left' | 'disconnected'>();

  private socket?: SocketLike;
  private inboundBuffer = '';
  private snapshotRequested = false;
  /**
   * Cola serializada de envío: un comando en vuelo por cliente. Cada comando
   * se construye justo al despachar (modelVersion fresca post-commit), así los
   * comandos encadenados (p. ej. clase-asociación) no chocan con la validación
   * estricta de versión del servidor (CONCURRENT_MODIFICATION).
   */
  private readonly submitQueue: { commandId: string; type: ModelCommand['type']; payload: ModelCommand['payload'] }[] = [];
  private inFlightSubmit?: string;
  private joinedOnce = false;
  private closed = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private lastModelEmitted?: DomainModel;
  private lastStateEmitted?: SessionConnectionState;

  constructor(options: CollaborationSessionOptions) {
    this.options = options;
    this.diagramId = options.diagramId;
    this.clientId = options.clientId;
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url) as SocketLike);
    this.client = new CollaborationClient({
      clientId: options.clientId,
      authToken: '',
      modelId: options.diagramId,
      send: (envelope) => this.sendEnvelope(envelope),
    });
  }

  get model(): DomainModel | undefined {
    return this.client.localModel;
  }

  get role(): ParticipantRole | undefined {
    return this.client.assignedRole;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * El editor puede emitir comandos cuando hay copia local y la sesión sigue
   * viva. Fuera de IN_SYNC el cliente los encola y los envía al resincronizar,
   * así una edición durante la reconexión no se descarta en silencio.
   */
  get canSubmit(): boolean {
    return this.client.localModel !== undefined && this.client.state !== 'DISCONNECTED';
  }

  get participantIds(): string[] {
    return [...this.participants.entries()]
      .filter(([, status]) => status === 'joined')
      .map(([id]) => id)
      .sort();
  }

  async open(): Promise<void> {
    this.closed = false;
    this.emitState('connecting');
    const token = await this.options.getToken();
    this.openSocket(token);
  }

  /**
   * Encola un comando del contrato model-commands; devuelve su commandId. El
   * envío efectivo es serializado: cada comando se despacha cuando el anterior
   * fue confirmado o rechazado, con la modelVersion vigente en ese instante.
   */
  submit(type: ModelCommand['type'], payload: ModelCommand['payload']): string {
    const commandId = crypto.randomUUID();
    this.submitQueue.push({ commandId, type, payload });
    this.pending.set(commandId, { type, payload });
    this.drainSubmissions();
    return commandId;
  }

  /** Cierre voluntario: LeaveSession + cierre del socket, sin reconexión. */
  leave(): void {
    this.closed = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.submitQueue.length = 0;
    this.inFlightSubmit = undefined;
    this.client.leave('user_exit');
    this.pending.clear();
    this.socket?.close();
    this.emitState('closed');
  }

  /* ---------------------------------------------------------------- */

  private openSocket(token: string): void {
    const socket = this.socketFactory(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      this.inboundBuffer = '';
      socket.send(
        encodeStompFrame('CONNECT', {
          'accept-version': '1.2',
          host: this.diagramId,
          authorization: `Bearer ${token}`,
        })
      );
    };
    socket.onmessage = (event: { data: unknown }) => this.onSocketData(String(event.data));
    socket.onclose = () => this.onSocketClose();
    socket.onerror = () => undefined;
  }

  private sendEnvelope(envelope: Envelope): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;
    this.socket.send(
      encodeStompFrame(
        'SEND',
        { destination: `/app/diagrams/${this.diagramId}`, 'content-type': 'application/json' },
        JSON.stringify(envelope)
      )
    );
  }

  private onSocketData(data: string): void {
    const { frames, rest } = splitStompFrames(this.inboundBuffer + data);
    this.inboundBuffer = rest;
    for (const raw of frames) this.onStompFrame(parseStompFrame(raw));
  }

  private onStompFrame(frame: ReturnType<typeof parseStompFrame>): void {
    if (frame.command === 'CONNECTED') {
      this.socket?.send(
        encodeStompFrame('SUBSCRIBE', {
          id: `sub-${this.diagramId}`,
          destination: `/topic/diagrams/${this.diagramId}`,
        })
      );
      if (this.joinedOnce) {
        this.client.reconnect();
      } else {
        this.joinedOnce = true;
        this.client.connect(this.diagramId);
      }
      this.emitClientState();
      return;
    }
    if (frame.command === 'ERROR') {
      this.options.events.onError(frame.headers.message ?? 'SESSION_ERROR');
      return;
    }
    if (frame.command !== 'MESSAGE') return;

    let envelope: Envelope;
    try {
      envelope = JSON.parse(frame.body) as Envelope;
    } catch {
      return;
    }

    // Sin copia local el replay del OpLog no es aplicable: el snapshot lo cubre.
    if (envelope.type === 'CommandCommitted' && !this.client.localModel) return;

    this.client.deliver(envelope);
    this.afterDelivery(envelope);
  }

  private afterDelivery(envelope: Envelope): void {
    const events = this.options.events;

    if (envelope.type === 'SessionJoined') {
      const payload = envelope.payload as SessionJoinedPayload;
      events.onRole(payload.assignedRole);
      this.reconnectAttempts = 0;
      this.participants.clear();
      for (const id of payload.activeParticipants) this.participants.set(id, 'joined');
      this.emitParticipants();
      if (!this.client.localModel && !this.snapshotRequested) {
        this.snapshotRequested = true;
        this.requestSnapshot();
      }
    }

    if (envelope.type === 'PresenceUpdated') {
      const payload = envelope.payload as PresenceUpdatedPayload;
      this.participants.set(payload.participantId, payload.status);
      this.emitParticipants();
    }

    if (envelope.type === 'CommandCommitted') {
      const payload = envelope.payload as CommandCommittedPayload;
      const sent = this.pending.get(payload.clientCommandId);
      if (sent) {
        this.pending.delete(payload.clientCommandId);
        events.onOutcome({
          commandId: payload.clientCommandId,
          type: sent.type,
          payload: sent.payload,
          result: 'accepted',
          modelVersion: payload.resultingModelVersion,
        });
      }
      if (this.inFlightSubmit === payload.clientCommandId) {
        this.inFlightSubmit = undefined;
      }
    }

    if (envelope.type === 'CommandRejected') {
      const payload = envelope.payload as CommandRejectedPayload;
      const sent = this.pending.get(payload.clientCommandId);
      if (sent) {
        this.pending.delete(payload.clientCommandId);
        events.onOutcome({
          commandId: payload.clientCommandId,
          type: sent.type,
          payload: sent.payload,
          result: 'rejected',
          errors: payload.errors,
        });
      }
      if (this.inFlightSubmit === payload.clientCommandId) {
        this.inFlightSubmit = undefined;
      }
    }

    if (envelope.type === 'SessionError') {
      const payload = envelope.payload as { errorCode?: string; message?: string; fatal?: boolean };
      if (payload.fatal) {
        events.onError(payload.message || payload.errorCode || 'Error de sesión de colaboración.');
      }
    }

    if (this.client.localModel && this.client.localModel !== this.lastModelEmitted) {
      this.lastModelEmitted = this.client.localModel;
      events.onModel(this.client.localModel);
    }
    this.emitClientState();
    this.drainSubmissions();
  }

  /**
   * Despacha el siguiente comando encolado si no hay ninguno en vuelo. Se
   * construye aquí (no al encolar) para que declare la versión del modelo
   * posterior a los commits ya aplicados.
   */
  private drainSubmissions(): void {
    if (this.inFlightSubmit !== undefined) return;
    if (this.client.state !== 'IN_SYNC' || !this.client.localModel) return;
    const next = this.submitQueue.shift();
    if (!next) return;
    const command = {
      type: next.type,
      commandId: next.commandId,
      modelId: this.diagramId,
      modelVersion: this.client.localModel.version,
      payload: next.payload,
    } as ModelCommand;
    this.inFlightSubmit = next.commandId;
    this.client.submitCommand(command);
  }

  private requestSnapshot(): void {
    this.sendEnvelope(
      createEnvelope(this.diagramId, this.diagramId, 'RequestSnapshot', {
        clientId: this.clientId,
        reason: 'initial-load',
      })
    );
  }

  private onSocketClose(): void {
    if (this.closed) {
      this.emitState('closed');
      return;
    }
    this.client.disconnect();
    this.reconnectAttempts += 1;
    const base = this.options.reconnectDelayMs ?? 1500;
    const delay = Math.min(base * this.reconnectAttempts, 10_000);
    this.emitState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.options
        .getToken()
        .then((token) => {
          if (!this.closed) this.openSocket(token);
        })
        .catch(() => this.onSocketClose());
    }, delay);
  }

  private emitParticipants(): void {
    this.options.events.onParticipants(this.participantIds);
  }

  private emitClientState(): void {
    this.emitState(mapClientState(this.client.state));
  }

  private emitState(state: SessionConnectionState): void {
    if (state === this.lastStateEmitted) return;
    this.lastStateEmitted = state;
    this.options.events.onState(state);
  }
}

function mapClientState(state: ClientState): SessionConnectionState {
  switch (state) {
    case 'IN_SYNC':
      return 'in_sync';
    case 'JOINING':
    case 'SYNCING_CATCHUP':
    case 'SYNCING_SNAPSHOT':
      return 'syncing';
    case 'RECONNECTING':
      return 'reconnecting';
    case 'DISCONNECTED':
      return 'closed';
    default:
      return 'connecting';
  }
}
