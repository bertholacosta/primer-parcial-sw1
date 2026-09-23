import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CollaborationSession,
  type SessionConnectionState,
  type SessionOutcome,
  type SocketLike,
} from '../collaboration/CollaborationSession';
import { encodeStompFrame, parseStompFrame, type StompFrame } from '../collaboration/stomp';
import {
  createEnvelope,
  modelSha256,
  type DomainModel,
  type Envelope,
} from 'collaboration-protocol';

/* --------------------------- Fakes --------------------------- */

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: unknown = null;
  onmessage: unknown = null;
  onclose: unknown = null;
  onerror: unknown = null;

  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  frames(): StompFrame[] {
    return this.sent.join('').split('\0').filter(Boolean).map(parseStompFrame);
  }

  envelopes(): Envelope[] {
    return this.frames()
      .filter((f) => f.command === 'SEND')
      .map((f) => JSON.parse(f.body) as Envelope);
  }

  serverOpen(): void {
    this.readyState = 1;
    (this.onopen as () => void)?.();
  }

  serverSend(command: string, headers: Record<string, string>, body = ''): void {
    (this.onmessage as (e: { data: string }) => void)?.({ data: encodeStompFrame(command, headers, body) });
  }

  serverMessage(envelope: Envelope): void {
    this.serverSend('MESSAGE', { destination: `/topic/diagrams/${envelope.modelId}`, subscription: 'sub' }, JSON.stringify(envelope));
  }

  serverClose(): void {
    this.readyState = 3;
    (this.onclose as () => void)?.();
  }
}

/* --------------------------- Fixtures --------------------------- */

const DIAGRAM = 'd-1';

const baseModel: DomainModel = {
  contractVersion: '1',
  id: DIAGRAM,
  name: 'Demo',
  version: '1.0.0',
  classes: [{ id: 'cls-1', name: 'Libro', attributes: [] }],
  associations: [],
};

interface Harness {
  session: CollaborationSession;
  socket: FakeSocket;
  models: DomainModel[];
  states: SessionConnectionState[];
  outcomes: SessionOutcome[];
  participants: string[][];
  errors: string[];
  roles: string[];
}

async function openSession(overrides: Partial<Parameters<typeof buildHarness>[0]> = {}): Promise<Harness> {
  return buildHarness(overrides);
}

async function buildHarness(opts: {
  role?: 'admin' | 'editor' | 'viewer';
  activeParticipants?: string[];
  currentSeqNumber?: number;
} = {}): Promise<Harness> {
  const models: DomainModel[] = [];
  const states: SessionConnectionState[] = [];
  const outcomes: SessionOutcome[] = [];
  const participants: string[][] = [];
  const errors: string[] = [];
  const roles: string[] = [];

  const session = new CollaborationSession({
    url: 'ws://test/collaboration',
    diagramId: DIAGRAM,
    clientId: 'client-1',
    getToken: vi.fn(async () => 'token-1'),
    socketFactory: (url) => new FakeSocket(url),
    reconnectDelayMs: 5,
    events: {
      onModel: (m) => models.push(m),
      onState: (s) => states.push(s),
      onRole: (r) => roles.push(r),
      onParticipants: (p) => participants.push(p),
      onOutcome: (o) => outcomes.push(o),
      onError: (m) => errors.push(m),
    },
  });

  await session.open();
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
  socket.serverOpen();
  socket.serverSend('CONNECTED', { version: '1.2', session: 's-1' });

  socket.serverMessage(
    createEnvelope(DIAGRAM, DIAGRAM, 'SessionJoined', {
      clientId: 'client-1',
      assignedRole: opts.role ?? 'admin',
      currentSeqNumber: opts.currentSeqNumber ?? 0,
      activeParticipants: opts.activeParticipants ?? ['client-1'],
    })
  );
  socket.serverMessage(
    createEnvelope(DIAGRAM, DIAGRAM, 'SnapshotResponse', {
      baseSeqNumber: opts.currentSeqNumber ?? 0,
      modelVersion: baseModel.version,
      modelSha256: modelSha256(baseModel),
      model: baseModel,
      activeParticipants: opts.activeParticipants ?? ['client-1'],
    })
  );

  return { session, socket, models, states, outcomes, participants, errors, roles };
}

function commitFor(diagramId: string, seq: number, command: { commandId: string }, origin = 'client-1', version = `1.0.${seq}`): Envelope {
  return createEnvelope(diagramId, diagramId, 'CommandCommitted', {
    serverSeqNumber: seq,
    originClientId: origin,
    clientCommandId: command.commandId,
    resultingModelVersion: version,
    resultingSha256: 'sha',
    command,
  });
}

function submittedCommands(socket: FakeSocket) {
  return socket
    .envelopes()
    .filter((e) => e.type === 'SubmitCommand')
    .map((e) => e.payload as { clientCommandId: string; command: { commandId: string; type: string; modelVersion: string } });
}

/* --------------------------- Tests --------------------------- */

describe('CollaborationSession — ciclo de vida', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('hace CONNECT autenticado, SUBSCRIBE y JoinSession; instala snapshot y emite in_sync', async () => {
    const { session, socket, models, states, roles, participants } = await openSession();

    const connect = socket.frames().find((f) => f.command === 'CONNECT');
    expect(connect?.headers.authorization).toBe('Bearer token-1');
    expect(socket.frames().some((f) => f.command === 'SUBSCRIBE' && f.headers.destination === `/topic/diagrams/${DIAGRAM}`)).toBe(true);
    expect(socket.envelopes().some((e) => e.type === 'JoinSession')).toBe(true);
    // Sin copia local: se solicita el snapshot.
    expect(socket.envelopes().some((e) => e.type === 'RequestSnapshot')).toBe(true);

    expect(models).toHaveLength(1);
    expect(models[0].classes[0].name).toBe('Libro');
    expect(session.canSubmit).toBe(true);
    expect(states[states.length - 1]).toBe('in_sync');
    expect(roles).toContain('admin');
    expect(participants[participants.length - 1]).toEqual(['client-1']);
  });

  it('un SessionError fatal se propaga a onError', async () => {
    const { socket, errors } = await openSession();
    socket.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'SessionError', {
        errorCode: 'INSUFFICIENT_PERMISSIONS',
        message: 'Sin permisos.',
        fatal: true,
      })
    );
    expect(errors.some((m) => m.includes('Sin permisos'))).toBe(true);
  });

  it('leave() cierra la sesión, no reconecta y reporta closed', async () => {
    const { session, socket, states } = await openSession();
    session.leave();
    expect(socket.envelopes().some((e) => e.type === 'LeaveSession')).toBe(true);
    expect(states[states.length - 1]).toBe('closed');
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeSocket.instances).toHaveLength(1); // no se abrió socket nuevo
  });
});

describe('CollaborationSession — comandos serializados', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('encadena comandos: el segundo se envía tras el commit con modelVersion fresca', async () => {
    const { session, socket } = await openSession();

    session.submit('CreateClass', { id: 'cls-2', name: 'Autor' } as never);
    session.submit('CreateAssociation', {
      id: 'as-1',
      sourceClassId: 'cls-1',
      targetClassId: 'cls-2',
      sourceMultiplicity: '1',
      targetMultiplicity: '1..*',
      navigability: 'bidirectional',
      kind: 'association',
    } as never);

    // Solo el primero salió; el segundo espera al commit.
    let submits = submittedCommands(socket);
    expect(submits).toHaveLength(1);
    expect(submits[0].command.type).toBe('CreateClass');
    expect(submits[0].command.modelVersion).toBe('1.0.0');

    socket.serverMessage(commitFor(DIAGRAM, 1, submits[0].command, 'client-1', '1.0.1'));

    submits = submittedCommands(socket);
    expect(submits).toHaveLength(2);
    expect(submits[1].command.type).toBe('CreateAssociation');
    // Construido post-commit: declara la versión resultante, no la obsoleta.
    expect(submits[1].command.modelVersion).toBe('1.0.1');

    socket.serverMessage(commitFor(DIAGRAM, 2, submits[1].command, 'client-1', '1.0.2'));
    expect(session.pendingCount).toBe(0);
  });

  it('un rechazo libera la cola y reporta el outcome con errores', async () => {
    const { session, socket, outcomes } = await openSession();

    const firstId = session.submit('DeleteClass', { classId: 'cls-x' } as never);
    session.submit('CreateClass', { id: 'cls-9', name: 'Orden' } as never);

    socket.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'CommandRejected', {
        originClientId: 'client-1',
        clientCommandId: firstId,
        baseSeqNumber: 0,
        currentSeqNumber: 0,
        errors: [{ code: 'CLASS_NOT_FOUND', path: '$.payload.classId', message: 'No existe.', severity: 'ERROR' }],
      })
    );

    const rejected = outcomes.find((o) => o.commandId === firstId);
    expect(rejected?.result).toBe('rejected');
    expect(rejected?.errors?.[0].code).toBe('CLASS_NOT_FOUND');

    // El siguiente comando encolado se despachó tras la resolución.
    const submits = submittedCommands(socket);
    expect(submits).toHaveLength(2);
    expect(submits[1].command.modelVersion).toBe('1.0.0'); // sin commit: versión intacta
  });

  it('aplica commits de otros clientes sin resolver pendientes propios', async () => {
    const { session, socket, models } = await openSession();

    const ownId = session.submit('CreateClass', { id: 'cls-2', name: 'Autor' } as never);

    // Commit remoto de otro cliente (secuencia 1): se aplica al modelo local.
    const remoteCommand = {
      type: 'CreateClass',
      commandId: 'remote-cmd',
      modelId: DIAGRAM,
      modelVersion: '1.0.0',
      payload: { id: 'cls-r', name: 'Remota' },
    };
    socket.serverMessage(commitFor(DIAGRAM, 1, remoteCommand, 'client-2', '1.0.1'));

    const latest = models[models.length - 1];
    expect(latest.classes.some((c) => c.name === 'Remota')).toBe(true);
    expect(session.pendingCount).toBe(1); // el nuestro sigue en vuelo

    socket.serverMessage(commitFor(DIAGRAM, 2, { commandId: ownId }, 'client-1', '1.0.2'));
    expect(session.pendingCount).toBe(0);
  });
});

describe('CollaborationSession — presencia y reconexión', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('PresenceUpdated añade y quita participantes', async () => {
    const { socket, participants } = await openSession();

    socket.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'PresenceUpdated', { participantId: 'client-2', status: 'joined' })
    );
    expect(participants[participants.length - 1]).toEqual(['client-1', 'client-2']);

    socket.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'PresenceUpdated', { participantId: 'client-2', status: 'left' })
    );
    expect(participants[participants.length - 1]).toEqual(['client-1']);
  });

  it('reconecta con token fresco, rejoin con lastKnownSeqNumber y aplica el replay', async () => {
    const getToken = vi.fn()
      .mockResolvedValueOnce('token-1')
      .mockResolvedValueOnce('token-2');
    const models: DomainModel[] = [];
    const states: SessionConnectionState[] = [];

    const session = new CollaborationSession({
      url: 'ws://test/collaboration',
      diagramId: DIAGRAM,
      clientId: 'client-1',
      getToken,
      socketFactory: (url) => new FakeSocket(url),
      reconnectDelayMs: 5,
      events: {
        onModel: (m) => models.push(m),
        onState: (s) => states.push(s),
        onRole: () => undefined,
        onParticipants: () => undefined,
        onOutcome: () => undefined,
        onError: () => undefined,
      },
    });
    await session.open();
    const first = FakeSocket.instances[0];
    first.serverOpen();
    first.serverSend('CONNECTED', { version: '1.2', session: 's-1' });
    first.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'SessionJoined', {
        clientId: 'client-1', assignedRole: 'editor', currentSeqNumber: 0, activeParticipants: ['client-1'],
      })
    );
    first.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'SnapshotResponse', {
        baseSeqNumber: 0, modelVersion: baseModel.version, modelSha256: modelSha256(baseModel),
        model: baseModel, activeParticipants: ['client-1'],
      })
    );
    expect(states[states.length - 1]).toBe('in_sync');

    first.serverClose();
    expect(states[states.length - 1]).toBe('reconnecting');

    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(2));
    const second = FakeSocket.instances[1];
    second.serverOpen();
    const reconnectConnect = second.frames().find((f) => f.command === 'CONNECT');
    expect(reconnectConnect?.headers.authorization).toBe('Bearer token-2'); // token fresco
    second.serverSend('CONNECTED', { version: '1.2', session: 's-2' });

    const rejoin = second.envelopes().find((e) => e.type === 'JoinSession');
    expect(rejoin).toBeDefined();
    expect((rejoin!.payload as { lastKnownSeqNumber: number }).lastKnownSeqNumber).toBe(0);

    // El servidor reenvía el commit perdido durante el corte (seq 1).
    second.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'SessionJoined', {
        clientId: 'client-1', assignedRole: 'editor', currentSeqNumber: 1, activeParticipants: ['client-1'],
      })
    );
    second.serverMessage(
      commitFor(
        DIAGRAM,
        1,
        {
          commandId: 'remote-cmd',
          type: 'CreateClass',
          modelId: DIAGRAM,
          modelVersion: '1.0.0',
          payload: { id: 'cls-r', name: 'Remota' },
        } as never,
        'client-2',
        '1.0.1'
      )
    );
    const last = models[models.length - 1];
    expect(last.classes.some((c) => c.name === 'Remota')).toBe(true);
    expect(states[states.length - 1]).toBe('in_sync');
    session.leave();
  });

  it('reenvía un comando en vuelo tras reconectar con el mismo clientCommandId (idempotente)', async () => {
    const { session, socket } = await openSession();

    const commandId = session.submit('CreateClass', { id: 'cls-2', name: 'Autor' } as never);
    expect(submittedCommands(socket)).toHaveLength(1);

    socket.serverClose();
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(2));
    const second = FakeSocket.instances[1];
    second.serverOpen();
    second.serverSend('CONNECTED', { version: '1.2', session: 's-2' });
    second.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'SessionJoined', {
        clientId: 'client-1', assignedRole: 'admin', currentSeqNumber: 0, activeParticipants: ['client-1'],
      })
    );

    // Tras el rejoin sin commits perdidos, el comando en vuelo se retransmite.
    const resends = submittedCommands(second);
    expect(resends).toHaveLength(1);
    expect(resends[0].clientCommandId).toBe(commandId);
    expect(session.pendingCount).toBe(1); // sigue pendiente hasta el commit

    second.serverMessage(commitFor(DIAGRAM, 1, { commandId } as never, 'client-1', '1.0.1'));
    expect(session.pendingCount).toBe(0);
  });

  it('permite encolar una edición durante la reconexión y la envía al resincronizar', async () => {
    const { session, socket } = await openSession();
    socket.serverClose();

    // Durante la reconexión hay copia local: el editor puede seguir trabajando.
    expect(session.canSubmit).toBe(true);
    session.submit('RenameClass', { classId: 'cls-1', newName: 'LibroRenombrado' } as never);
    expect(session.pendingCount).toBe(1);

    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(2));
    const second = FakeSocket.instances[1];
    second.serverOpen();
    second.serverSend('CONNECTED', { version: '1.2', session: 's-2' });
    second.serverMessage(
      createEnvelope(DIAGRAM, DIAGRAM, 'SessionJoined', {
        clientId: 'client-1', assignedRole: 'admin', currentSeqNumber: 0, activeParticipants: ['client-1'],
      })
    );

    const submits = submittedCommands(second);
    expect(submits).toHaveLength(1);
    expect(submits[0].command.type).toBe('RenameClass');
  });
});
