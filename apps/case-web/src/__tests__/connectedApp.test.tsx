import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectedApp } from '../components/ConnectedApp';
import { encodeStompFrame, parseStompFrame, type StompFrame } from '../collaboration/stomp';
import type { SocketLike } from '../collaboration/CollaborationSession';
import {
  ApiError,
  type AuthSession,
  type DiagramRecord,
  type ModelServerApi,
  type SessionUser,
} from '../api/modelServerApi';
import {
  createEnvelope,
  modelSha256,
  type DomainModel,
  type Envelope,
} from 'collaboration-protocol';
import type { CanonicalDomainModel } from '../domain/model';

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
  }

  frames(): StompFrame[] {
    return this.sent
      .join('')
      .split('\0')
      .filter(Boolean)
      .map(parseStompFrame);
  }

  envelopes(): Envelope[] {
    return this.frames()
      .filter((f) => f.command === 'SEND')
      .map((f) => JSON.parse(f.body) as Envelope);
  }

  /* Simulación del lado servidor */
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

const user: SessionUser = { userId: 'u-1', email: 'dev@case.local', displayName: 'Dev' };

const sessionModel: DomainModel = {
  contractVersion: '1',
  id: 'd-1',
  name: 'Demo',
  version: '1.0.0',
  packages: [],
  classes: [
    {
      id: 'cls-1',
      name: 'Libro',
      attributes: [{ id: 'attr-1', name: 'titulo', type: 'String', nullable: false, multiplicity: '1' }],
    },
  ],
  associations: [],
};

const diagram: DiagramRecord = {
  diagramId: 'd-1',
  name: 'Demo',
  role: 'owner',
  model: sessionModel as unknown as CanonicalDomainModel,
};

function fakeApi(overrides: Partial<ModelServerApi> = {}): ModelServerApi {
  return {
    accessToken: 'token-1',
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    register: vi.fn(async () => user),
    login: vi.fn(async (): Promise<AuthSession> => ({
      user,
      accessToken: 'token-1',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    })),
    refresh: vi.fn(async () => {
      throw new ApiError('AUTH_REFRESH_INVALID', 401, 'Refresh inválido.');
    }),
    ensureAccessToken: vi.fn(async () => 'token-1'),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => user),
    listDiagrams: vi.fn(async () => [diagram]),
    getDiagram: vi.fn(async () => diagram),
    createDiagram: vi.fn(async () => diagram),
    listMembers: vi.fn(async () => []),
    setMemberRole: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    createInvitation: vi.fn(async () => ({ invitationId: 'i-1', role: 'editor' as const, expiresAt: '' })),
    acceptInvitation: vi.fn(async () => ({ diagramId: 'd-1', role: 'editor' as const })),
    createShareLink: vi.fn(async () => ({ shareLinkId: 'l-1', role: 'viewer' as const, expiresAt: '', url: '/share/tok' })),
    acceptShareLink: vi.fn(async () => ({ diagramId: 'd-1', role: 'viewer' as const })),
    revokeShareLink: vi.fn(async () => undefined),
    ...overrides,
  };
}

/* --------------------------- Helpers --------------------------- */

async function login(api: ModelServerApi) {
  render(
    <ConnectedApp
      api={api}
      wsUrl="ws://test/collaboration"
      clientId="client-1"
      socketFactory={(url) => new FakeSocket(url)}
      reconnectDelayMs={60_000}
    />
  );
  await screen.findByTestId('auth-panel');
  fireEvent.change(screen.getByTestId('login-email-input'), { target: { value: user.email } });
  fireEvent.change(screen.getByTestId('login-password-input'), { target: { value: 'secret-secret' } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('login-submit'));
  });
  await screen.findByTestId('diagram-home');
}

async function openDiagram(role: 'admin' | 'editor' | 'viewer' = 'admin') {
  fireEvent.click(screen.getByTestId(`open-diagram-${diagram.diagramId}`));
  const socket = await waitFor(() => {
    expect(FakeSocket.instances.length).toBeGreaterThan(0);
    return FakeSocket.instances[FakeSocket.instances.length - 1];
  });
  await act(async () => socket.serverOpen());
  expect(socket.frames().some((f) => f.command === 'CONNECT' && f.headers.authorization === 'Bearer token-1')).toBe(true);

  await act(async () => socket.serverSend('CONNECTED', { version: '1.2', session: 's-1' }));
  expect(socket.frames().some((f) => f.command === 'SUBSCRIBE' && f.headers.destination === `/topic/diagrams/${diagram.diagramId}`)).toBe(true);
  expect(socket.envelopes().some((e) => e.type === 'JoinSession')).toBe(true);

  const model = sessionModel;
  await act(async () => {
    socket.serverMessage(
      createEnvelope(diagram.diagramId, diagram.diagramId, 'SessionJoined', {
        clientId: 'client-1',
        assignedRole: role,
        currentSeqNumber: 0,
        activeParticipants: ['client-1'],
      })
    );
  });
  // El cliente sin copia local pide el snapshot.
  expect(socket.envelopes().some((e) => e.type === 'RequestSnapshot')).toBe(true);
  await act(async () => {
    socket.serverMessage(
      createEnvelope(diagram.diagramId, diagram.diagramId, 'SnapshotResponse', {
        baseSeqNumber: 0,
        modelVersion: model.version,
        modelSha256: modelSha256(model),
        model,
        activeParticipants: ['client-1'],
      })
    );
  });
  await screen.findByTestId('case-web-canvas-container');
  return socket;
}

/* --------------------------- Tests --------------------------- */

describe('ConnectedApp — identidad y sesión (P10-009)', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('restaura fallida → login → lista de diagramas → abrir diagrama', async () => {
    const api = fakeApi();
    await login(api);
    expect(api.refresh).toHaveBeenCalled();
    expect(api.login).toHaveBeenCalledWith(user.email, 'secret-secret');
    await screen.findByTestId(`diagram-item-${diagram.diagramId}`);
    expect(screen.getByTestId('current-user').textContent).toContain(user.email);
  });

  it('muestra error de autenticación accesible cuando el login falla', async () => {
    const api = fakeApi({
      login: vi.fn(async () => {
        throw new ApiError('AUTH_INVALID_CREDENTIALS', 401, 'No fue posible autenticar la sesión.');
      }),
    });
    render(<ConnectedApp api={api} />);
    await screen.findByTestId('auth-panel');
    fireEvent.change(screen.getByTestId('login-email-input'), { target: { value: user.email } });
    fireEvent.change(screen.getByTestId('login-password-input'), { target: { value: 'x' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('login-submit'));
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No fue posible autenticar');
  });

  it('cierra sesión y vuelve al panel de autenticación', async () => {
    const api = fakeApi();
    await login(api);
    await act(async () => {
      fireEvent.click(screen.getByTestId('logout-button'));
    });
    expect(api.logout).toHaveBeenCalled();
    await screen.findByTestId('auth-panel');
  });
});

describe('ConnectedApp — coedición (P10-010)', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('sincroniza el modelo por snapshot y muestra rol, estado y presencia', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('admin');

    expect(screen.getByTestId('semantic-item-Libro')).toBeInTheDocument();
    expect(screen.getByTestId('collaboration-state').textContent).toContain('En línea');
    expect(screen.getByTestId('collaboration-role').textContent).toContain('Propietario');
    expect(screen.getByTestId('collaboration-participants').textContent).toContain('1');

    await act(async () => {
      socket.serverMessage(
        createEnvelope(diagram.diagramId, diagram.diagramId, 'PresenceUpdated', {
          participantId: 'client-2',
          status: 'joined',
        })
      );
    });
    expect(screen.getByTestId('collaboration-participants').textContent).toContain('2');
  });

  it('no muta el modelo local hasta recibir CommandCommitted', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('admin');

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-edit-attr-Libro-titulo'));
    });
    fireEvent.change(screen.getByTestId('edit-attribute-input-attr-1'), { target: { value: 'genero' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-edit-attribute-attr-1'));
    });

    // El comando sale por el socket pero el modelo local no cambia todavía.
    const submitted = socket.envelopes().find((e) => e.type === 'SubmitCommand');
    expect(submitted).toBeDefined();
    const payload = submitted!.payload as { clientCommandId: string; command: { type: string; commandId: string; payload: { name: string } } };
    expect(payload.command.type).toBe('UpdateAttribute');
    expect(payload.command.payload.name).toBe('genero');
    expect(payload.clientCommandId).toBe(payload.command.commandId);
    expect(screen.queryByTestId('attribute-row-Libro-genero')).not.toBeInTheDocument();

    // El servidor confirma: solo entonces se aplica.
    await act(async () => {
      socket.serverMessage(
        createEnvelope(diagram.diagramId, diagram.diagramId, 'CommandCommitted', {
          serverSeqNumber: 1,
          originClientId: 'client-1',
          clientCommandId: payload.clientCommandId,
          resultingModelVersion: '1.0.1',
          resultingSha256: 'sha',
          command: payload.command,
        })
      );
    });
    await screen.findByTestId('attribute-row-Libro-genero');
    expect(screen.getByTestId('command-result-banner').textContent).toContain('Comando aplicado');
  });

  it('muestra rechazo del servidor y permite reintento explícito', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('editor');

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-edit-attr-Libro-titulo'));
    });
    fireEvent.change(screen.getByTestId('edit-attribute-input-attr-1'), { target: { value: 'tituloDuplicado' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-edit-attribute-attr-1'));
    });
    const submitted = socket.envelopes().find((e) => e.type === 'SubmitCommand');
    const clientCommandId = (submitted!.payload as { clientCommandId: string }).clientCommandId;
    const sentBefore = socket.envelopes().filter((e) => e.type === 'SubmitCommand').length;

    await act(async () => {
      socket.serverMessage(
        createEnvelope(diagram.diagramId, diagram.diagramId, 'CommandRejected', {
          originClientId: 'client-1',
          clientCommandId,
          baseSeqNumber: 0,
          currentSeqNumber: 0,
          errors: [{ code: 'DUPLICATE_ATTRIBUTE_NAME', path: '$.payload.name', message: 'Nombre duplicado.', severity: 'ERROR' }],
        })
      );
    });

    expect(screen.getByTestId('command-result-banner').textContent).toContain('Comando rechazado');
    expect(screen.getByTestId('command-result-banner').textContent).toContain('DUPLICATE_ATTRIBUTE_NAME');
    expect(screen.getByTestId('command-retry-banner')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('command-retry'));
    });
    const resubmits = socket.envelopes().filter((e) => e.type === 'SubmitCommand');
    expect(resubmits.length).toBe(sentBefore + 1);
    const retryId = (resubmits[resubmits.length - 1].payload as { clientCommandId: string }).clientCommandId;
    expect(retryId).not.toBe(clientCommandId);
  });

  it('viewer no dispone de controles de mutación', async () => {
    const api = fakeApi();
    await login(api);
    await openDiagram('viewer');

    expect(screen.getByTestId('collaboration-role').textContent).toContain('Lector');
    expect(screen.getByTestId('collaboration-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-add-attribute-Libro')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-add-association')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-edit-attr-Libro-titulo')).not.toBeInTheDocument();
  });

  it('una caída del socket muestra reconexión sin perder el modelo', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('admin');
    expect(screen.getByTestId('collaboration-state').textContent).toContain('En línea');

    await act(async () => socket.serverClose());
    expect(screen.getByTestId('collaboration-state').textContent).toContain('Reconectando');
    expect(screen.getByTestId('semantic-item-Libro')).toBeInTheDocument();
  });
});
