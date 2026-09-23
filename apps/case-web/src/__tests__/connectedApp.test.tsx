import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectedApp } from '../components/ConnectedApp';
import { encodeStompFrame, parseStompFrame, type StompFrame } from '../collaboration/stomp';
import type { SocketLike } from '../collaboration/CollaborationSession';
import {
  ApiError,
  type AuthSession,
  type DiagramRecord,
  type ImageProposal,
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
  classes: [
    {
      id: 'cls-1',
      name: 'Libro',
      attributes: [{ id: 'attr-1', name: 'titulo', type: 'String', nullable: false, multiplicity: '1' }],
    },
    {
      id: 'cls-2',
      name: 'Autor',
      attributes: [],
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

const imageProposal: ImageProposal = {
  proposalId: 'prop-1',
  lifecycleState: 'awaiting_confirmation',
  intent: { summary: 'Se detectó una clase con un atributo.' },
  source: { modality: 'image', agentRole: 'ollama-local/llava' },
  confidence: {
    overall: 0.87,
    level: 'HIGH',
    breakdown: [
      { commandIndex: 0, score: 0.9, fieldScores: {} },
      { commandIndex: 1, score: 0.8, fieldScores: {} },
    ],
  },
  proposedCommands: [
    {
      type: 'CreateClass',
      commandId: 'cmd-prop-1',
      modelId: 'd-1',
      modelVersion: '1.0.0',
      payload: { id: 'cls-p1', name: 'Factura' },
    },
    {
      type: 'AddAttribute',
      commandId: 'cmd-prop-2',
      modelId: 'd-1',
      modelVersion: '1.0.0',
      payload: { id: 'attr-p1', classId: 'cls-p1', name: 'total', type: 'Double', nullable: false, multiplicity: '1' },
    },
  ],
  dryRunValidation: { validationStatus: 'VALID', errors: [], warnings: [] },
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
    createImageProposal: vi.fn(async () => imageProposal),
    createTextProposal: vi.fn(async () => imageProposal),
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

  it('crea una clase-asociación encadenando CreateClass + CreateAssociation con versión post-commit', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('admin');

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-add-association'));
    });
    fireEvent.change(screen.getByTestId('assoc-kind-select'), { target: { value: 'associationClass' } });
    fireEvent.change(screen.getByTestId('assoc-source-select'), { target: { value: 'cls-1' } });
    fireEvent.change(screen.getByTestId('assoc-target-select'), { target: { value: 'cls-2' } });
    fireEvent.change(screen.getByTestId('assoc-new-class-name-input'), { target: { value: 'Prestamo' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-add-association'));
    });

    // Solo el primer comando sale; el segundo espera su commit.
    let submits = socket.envelopes().filter((e) => e.type === 'SubmitCommand');
    expect(submits).toHaveLength(1);
    const first = submits[0].payload as {
      clientCommandId: string;
      command: { commandId: string; type: string; modelVersion: string; payload: { id: string } };
    };
    expect(first.command.type).toBe('CreateClass');
    expect(first.command.modelVersion).toBe('1.0.0');

    await act(async () => {
      socket.serverMessage(
        createEnvelope(diagram.diagramId, diagram.diagramId, 'CommandCommitted', {
          serverSeqNumber: 1,
          originClientId: 'client-1',
          clientCommandId: first.clientCommandId,
          resultingModelVersion: '1.0.1',
          resultingSha256: 'sha',
          command: first.command,
        })
      );
    });

    // El segundo comando se despacha declarando la versión post-commit.
    submits = socket.envelopes().filter((e) => e.type === 'SubmitCommand');
    expect(submits).toHaveLength(2);
    const second = submits[1].payload as {
      clientCommandId: string;
      command: { commandId: string; type: string; modelVersion: string; payload: { associationClassId: string } };
    };
    expect(second.command.type).toBe('CreateAssociation');
    expect(second.command.modelVersion).toBe('1.0.1');
    expect(second.command.payload.associationClassId).toBe(first.command.payload.id);

    await act(async () => {
      socket.serverMessage(
        createEnvelope(diagram.diagramId, diagram.diagramId, 'CommandCommitted', {
          serverSeqNumber: 2,
          originClientId: 'client-1',
          clientCommandId: second.clientCommandId,
          resultingModelVersion: '1.0.2',
          resultingSha256: 'sha',
          command: second.command,
        })
      );
    });
    expect(screen.getByTestId('semantic-association-list').textContent).toContain('«associationClass»');
    expect(screen.getByTestId('command-result-banner').textContent).toContain('Comando aplicado');
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

describe('ConnectedApp — propuesta multimodal por imagen', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  const uploadImage = async (fileName = 'pizarra.png') => {
    fireEvent.click(screen.getByTestId('btn-import-image'));
    const file = new File(['fake-png'], fileName, { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByTestId('image-file-input'), { target: { files: [file] } });
    });
  };

  it('sube la imagen, muestra la propuesta validada y aplica los comandos por la sesión', async () => {
    const createImageProposal = vi.fn(async () => imageProposal);
    const api = fakeApi({ createImageProposal });
    await login(api);
    const socket = await openDiagram('editor');

    await uploadImage();

    await screen.findByTestId('image-proposal-panel');
    expect(createImageProposal).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({ mimeType: 'image/png', clientPlatform: 'case_web' })
    );
    expect(screen.getByTestId('image-proposal-summary').textContent).toContain('una clase');
    const commands = screen.getByTestId('image-proposal-commands').textContent;
    expect(commands).toContain("Clase 'Factura'");
    expect(commands).toContain("'total'");

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-apply-proposal'));
    });
    expect(screen.queryByTestId('image-proposal-panel')).not.toBeInTheDocument();

    // Primer comando encolado sale por el socket; el resto espera su commit.
    let submits = socket.envelopes().filter((e) => e.type === 'SubmitCommand');
    expect(submits).toHaveLength(1);
    const first = submits[0].payload as {
      clientCommandId: string;
      command: { commandId: string; type: string; payload: { id: string; name: string } };
    };
    expect(first.command.type).toBe('CreateClass');
    expect(first.command.payload.id).toBe('cls-p1');
    expect(first.command.payload.name).toBe('Factura');

    await act(async () => {
      socket.serverMessage(
        createEnvelope(diagram.diagramId, diagram.diagramId, 'CommandCommitted', {
          serverSeqNumber: 1,
          originClientId: 'client-1',
          clientCommandId: first.clientCommandId,
          resultingModelVersion: '1.0.1',
          resultingSha256: 'sha',
          command: first.command,
        })
      );
    });

    submits = socket.envelopes().filter((e) => e.type === 'SubmitCommand');
    expect(submits).toHaveLength(2);
    const second = submits[1].payload as {
      clientCommandId: string;
      command: { type: string; modelVersion: string; payload: { classId: string; name: string } };
    };
    expect(second.command.type).toBe('AddAttribute');
    expect(second.command.modelVersion).toBe('1.0.1');
    expect(second.command.payload.classId).toBe('cls-p1');
    expect(second.command.payload.name).toBe('total');
  });

  it('descartar cierra el panel sin enviar comandos', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('admin');

    await uploadImage();
    await screen.findByTestId('image-proposal-panel');

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-discard-proposal'));
    });

    expect(screen.queryByTestId('image-proposal-panel')).not.toBeInTheDocument();
    expect(socket.envelopes().filter((e) => e.type === 'SubmitCommand')).toHaveLength(0);
  });

  it('muestra el error cuando el reconocimiento no está configurado', async () => {
    const api = fakeApi({
      createImageProposal: vi.fn(async () => {
        throw new ApiError('AI_NOT_CONFIGURED', 503, 'Reconocimiento por IA no configurado.');
      }),
    });
    await login(api);
    const socket = await openDiagram('editor');

    await uploadImage();

    await screen.findByTestId('image-proposal-error');
    expect(screen.getByTestId('image-proposal-error').textContent).toContain('no configurado');
    expect(socket.envelopes().filter((e) => e.type === 'SubmitCommand')).toHaveLength(0);
  });

  it('el visor no ve el botón de importar imagen', async () => {
    const api = fakeApi();
    await login(api);
    await openDiagram('viewer');

    expect(screen.queryByTestId('btn-import-image')).not.toBeInTheDocument();
  });
});

describe('ConnectedApp — importación de diagrama EA 15 (XMI)', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  const EA_XMI = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>
  <uml:Model xmi:id="M1" name="Ventas">
    <packagedElement xmi:type="uml:Class" xmi:id="C1" name="Factura">
      <ownedAttribute xmi:type="uml:Property" xmi:id="A1" name="total" type="Double">
        <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
        <upperValue xmi:type="uml:LiteralInteger" value="1"/>
      </ownedAttribute>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="C2" name="Cliente"/>
    <packagedElement xmi:type="uml:Association" xmi:id="AS1" name="emite">
      <ownedEnd xmi:type="uml:Property" xmi:id="E1"><type xmi:idref="C2"/><lowerValue xmi:type="uml:LiteralInteger" value="1"/><upperValue xmi:type="uml:LiteralInteger" value="1"/></ownedEnd>
      <ownedEnd xmi:type="uml:Property" xmi:id="E2"><type xmi:idref="C1"/><lowerValue xmi:type="uml:LiteralInteger" value="0"/><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="-1"/></ownedEnd>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

  const uploadXmi = async (content = EA_XMI, fileName = 'ventas.xmi') => {
    fireEvent.click(screen.getByTestId('btn-import-ea'));
    const file = new File([content], fileName, { type: 'text/xml' });
    await act(async () => {
      fireEvent.change(screen.getByTestId('ea-file-input'), { target: { files: [file] } });
    });
  };

  it('lee el XMI, muestra la revisión y despacha los comandos por la sesión', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('editor');

    await uploadXmi();

    await screen.findByTestId('ea-import-panel');
    expect(screen.getByTestId('ea-import-summary').textContent).toContain('Ventas');
    expect(screen.getByTestId('ea-import-summary').textContent).toContain('2 clase(s)');
    const commands = screen.getByTestId('ea-import-commands').textContent;
    expect(commands).toContain("Clase 'Factura'");
    expect(commands).toContain("Clase 'Cliente'");
    expect(commands).toContain("Relación association");

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-apply-ea-import'));
    });
    expect(screen.queryByTestId('ea-import-panel')).not.toBeInTheDocument();

    // El primer comando sale por el socket con ids remapeados
    const submits = socket.envelopes().filter((e) => e.type === 'SubmitCommand');
    expect(submits).toHaveLength(1);
    const first = submits[0].payload as {
      command: { type: string; payload: { id: string; name: string } };
    };
    expect(first.command.type).toBe('CreateClass');
    expect(first.command.payload.id).toMatch(/^cls-/);
    expect(['Factura', 'Cliente']).toContain(first.command.payload.name);
  });

  it('rechaza un archivo que no es XMI de EA y no envía comandos', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('admin');

    await uploadXmi('<html><body>no es xmi</body></html>', 'fake.xmi');

    await screen.findByTestId('ea-import-error');
    expect(socket.envelopes().filter((e) => e.type === 'SubmitCommand')).toHaveLength(0);
  });

  it('descartar cierra el panel sin despachar', async () => {
    const api = fakeApi();
    await login(api);
    const socket = await openDiagram('admin');

    await uploadXmi();
    await screen.findByTestId('ea-import-panel');

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-discard-ea-import'));
    });

    expect(screen.queryByTestId('ea-import-panel')).not.toBeInTheDocument();
    expect(socket.envelopes().filter((e) => e.type === 'SubmitCommand')).toHaveLength(0);
  });

  it('el visor no ve el botón de importar EA', async () => {
    const api = fakeApi();
    await login(api);
    await openDiagram('viewer');

    expect(screen.queryByTestId('btn-import-ea')).not.toBeInTheDocument();
  });
});
