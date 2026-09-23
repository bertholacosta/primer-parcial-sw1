import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DomainModel, ModelCommand } from 'collaboration-protocol';
import {
  CollaborationSession,
  type SessionConnectionState,
  type SessionOutcome,
  type SocketLike,
} from '../collaboration/CollaborationSession';
import {
  ApiError,
  type DiagramRecord,
  type ModelServerApi,
  type SessionUser,
} from '../api/modelServerApi';
import type { AssistantRemoteResult } from './AssistantChatPanel';
import { CaseWebCanvas, type CollaborationBarInfo } from './CaseWebCanvas';
import { SharePanel } from './SharePanel';
import { ImageImportPanel } from './ImageImportPanel';
import { EaImportPanel } from './EaImportPanel';
import type { CanonicalDomainModel } from '../domain/model';
import type { CommandExecutionResult } from '../commands/attributeCommands';
import type { CreateAssociationInput, UpdateAssociationInput, CreateAssociationClassInput } from '../commands/associationCommands';
import type { CreateClassInput, UpdateClassInput } from '../commands/classCommands';
import type { ParticipantRole } from 'collaboration-protocol';

interface DiagramSessionViewProps {
  api: ModelServerApi;
  diagramId: string;
  user: SessionUser;
  wsUrl?: string;
  clientId?: string;
  socketFactory?: (url: string) => SocketLike;
  reconnectDelayMs?: number;
  onExit(): void;
}

const STATE_LABELS: Record<SessionConnectionState, string> = {
  connecting: 'Conectando…',
  syncing: 'Sincronizando…',
  in_sync: 'En línea',
  reconnecting: 'Reconectando…',
  closed: 'Desconectado',
};

const ROLE_LABELS: Record<ParticipantRole, string> = {
  admin: 'Propietario',
  editor: 'Editor',
  viewer: 'Lector',
};

const defaultWsUrl = () =>
  `${globalThis.location?.protocol === 'https:' ? 'wss' : 'ws'}://${globalThis.location?.host ?? 'localhost'}/collaboration`;

/**
 * Vista de un diagrama conectado: abre la sesión WebSocket/STOMP, aplica solo
 * los commits confirmados por el servidor y muestra rol, presencia, estado de
 * sincronización, comandos pendientes y rechazos con reintento explícito.
 */
export const DiagramSessionView: React.FC<DiagramSessionViewProps> = ({
  api,
  diagramId,
  user,
  wsUrl,
  clientId,
  socketFactory,
  reconnectDelayMs,
  onExit,
}) => {
  const [diagram, setDiagram] = useState<DiagramRecord | null>(null);
  const [model, setModel] = useState<CanonicalDomainModel | null>(null);
  const [role, setRole] = useState<ParticipantRole | undefined>(undefined);
  const [participants, setParticipants] = useState<string[]>([]);
  const [connState, setConnState] = useState<SessionConnectionState>('connecting');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastResult, setLastResult] = useState<CommandExecutionResult | null>(null);
  const [lastRejected, setLastRejected] = useState<SessionOutcome | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const sessionRef = useRef<CollaborationSession | null>(null);
  const modelRef = useRef<CanonicalDomainModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFatalError(null);

    const session = new CollaborationSession({
      url: wsUrl ?? defaultWsUrl(),
      diagramId,
      clientId: clientId ?? crypto.randomUUID(),
      getToken: () => api.ensureAccessToken(),
      socketFactory,
      reconnectDelayMs,
      events: {
        onModel: (next: DomainModel) => {
          // SAFETY: DomainModel del protocolo y CanonicalDomainModel comparten el contrato domain-model-v1.
          const canonical = next as unknown as CanonicalDomainModel;
          modelRef.current = canonical;
          setModel(canonical);
        },
        onState: setConnState,
        onRole: setRole,
        onParticipants: setParticipants,
        onOutcome: (outcome) => {
          setPendingCount(sessionRef.current?.pendingCount ?? 0);
          setLastResult({
            result: outcome.result,
            commandId: outcome.commandId,
            modelVersion: outcome.modelVersion ?? modelRef.current?.version ?? '',
            errors: outcome.errors,
          });
          setLastRejected(outcome.result === 'rejected' ? outcome : null);
        },
        onError: (message) => setFatalError(message),
      },
    });
    sessionRef.current = session;

    void api
      .getDiagram(diagramId)
      .then((record) => {
        if (cancelled) return;
        setDiagram(record);
        return session.open();
      })
      .catch((err) => {
        if (!cancelled) setFatalError(err instanceof Error ? err.message : 'No se pudo abrir el diagrama.');
      });

    return () => {
      cancelled = true;
      session.leave();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, diagramId]);

  const submit = useCallback((type: string, payload: Record<string, unknown>) => {
    const session = sessionRef.current;
    if (!session?.canSubmit) return;
    session.submit(
      type as ModelCommand['type'],
      payload as unknown as ModelCommand['payload']
    );
    setPendingCount(session.pendingCount);
  }, []);

  const handleAddAttribute = useCallback(
    (classId: string, name: string, type: string, multiplicity: string, nullable = multiplicity === '0..1', description?: string) => {
      submit('AddAttribute', {
        id: `attr-${crypto.randomUUID()}`,
        classId,
        name,
        type,
        nullable,
        multiplicity,
        description,
      });
    },
    [submit]
  );

  const handleUpdateAttribute = useCallback(
    (classId: string, attributeId: string, updates: { name: string; type: string; multiplicity: string; nullable: boolean; description?: string }) => {
      submit('UpdateAttribute', { attributeId, classId, ...updates });
    },
    [submit]
  );

  const handleDeleteAttribute = useCallback(
    (classId: string, attributeId: string) => {
      submit('DeleteAttribute', { classId, attributeId });
    },
    [submit]
  );

  const handleCreateAssociation = useCallback(
    (input: CreateAssociationInput) => {
      submit('CreateAssociation', {
        id: `assoc-${crypto.randomUUID()}`,
        name: input.name,
        sourceClassId: input.sourceClassId,
        targetClassId: input.targetClassId,
        sourceMultiplicity: input.sourceMultiplicity,
        targetMultiplicity: input.targetMultiplicity,
        navigability: input.navigability,
        kind: input.kind,
        associationClassId: input.associationClassId,
        description: input.description,
      });
    },
    [submit]
  );

  /**
   * En modo colaborativo, crea la clase portadora y la asociación como dos
   * comandos secuenciales. El servidor los aplica en orden FIFO.
   */
  const handleCreateAssociationClass = useCallback(
    (input: CreateAssociationClassInput) => {
      submit('CreateClass', {
        id: input.newClassId,
        name: input.newClassName,
      });
      submit('CreateAssociation', {
        id: `assoc-${crypto.randomUUID()}`,
        name: input.associationName,
        sourceClassId: input.sourceClassId,
        targetClassId: input.targetClassId,
        sourceMultiplicity: input.sourceMultiplicity,
        targetMultiplicity: input.targetMultiplicity,
        navigability: input.navigability,
        kind: 'associationClass',
        associationClassId: input.newClassId,
        description: input.description,
      });
    },
    [submit]
  );

  const handleUpdateAssociation = useCallback(
    (input: UpdateAssociationInput) => {
      submit('UpdateAssociation', { ...input });
    },
    [submit]
  );

  const handleCreateClass = useCallback(
    (input: CreateClassInput) => {
      submit('CreateClass', {
        id: input.classId,
        name: input.name,
      });
    },
    [submit]
  );

  const handleUpdateClass = useCallback(
    (input: UpdateClassInput) => {
      submit('UpdateClass', { ...input });
    },
    [submit]
  );

  const handleRenameClass = useCallback(
    (classId: string, newName: string) => {
      submit('RenameClass', { classId, newName });
    },
    [submit]
  );

  const handleDeleteClass = useCallback(
    (classId: string) => {
      submit('DeleteClass', { classId });
    },
    [submit]
  );

  const handleDeleteAssociation = useCallback(
    (associationId: string) => {
      submit('DeleteAssociation', { associationId });
    },
    [submit]
  );

  const retryRejected = useCallback(() => {
    if (!lastRejected) return;
    submit(lastRejected.type, lastRejected.payload as Record<string, unknown>);
    setLastRejected(null);
  }, [lastRejected, submit]);

  /**
   * Propuesta multimodal confirmada: los comandos ya pasaron el dry-run del
   * servidor; aquí se despachan por la sesión, que los serializa y les asigna
   * la modelVersion vigente al momento de cada envío.
   */
  const handleApplyProposal = useCallback(
    (commands: { type: string; payload: Record<string, unknown> }[]) => {
      for (const command of commands) submit(command.type, command.payload);
    },
    [submit]
  );

  /**
   * Fallback del chat del asistente: cuando el parser local no entiende la
   * instrucción, el servidor la interpreta con IA (modalidad text_prompt) y
   * devuelve una propuesta ya validada por dry-run — nunca muta el modelo.
   */
  const interpretAssistant = useCallback(
    async (text: string): Promise<AssistantRemoteResult> => {
      try {
        const proposal = await api.createTextProposal(diagramId, {
          textPrompt: text,
          clientPlatform: 'case_web',
        });
        const commands = proposal.proposedCommands.map((c) => ({ type: c.type, payload: c.payload }));
        if (commands.length === 0) {
          return { clarification: 'La IA no produjo comandos aplicables.' };
        }
        if (proposal.dryRunValidation.validationStatus === 'INVALID') {
          const first = proposal.dryRunValidation.errors.slice(0, 3).map((e) => e.message).join(' ');
          return { clarification: `La IA propuso cambios pero no validan sobre el modelo actual: ${first}` };
        }
        const note =
          proposal.dryRunValidation.validationStatus === 'WARNINGS'
            ? ` (${proposal.dryRunValidation.warnings.length} advertencia(s) de validación)`
            : '';
        return { commands, summary: `IA: ${proposal.intent.summary}${note}` };
      } catch (error) {
        return {
          clarification:
            error instanceof ApiError ? error.message : 'No fue posible interpretar la instrucción con la IA.',
        };
      }
    },
    [api, diagramId]
  );

  const isOwner = diagram?.role === 'owner';

  if (fatalError) {
    return (
      <div role="alert" data-testid="session-error" style={{ padding: '24px', margin: '20px', background: '#fef2f2', border: '1px solid #f87171', borderRadius: '8px', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ color: '#991b1b', margin: '0 0 8px 0', fontSize: '18px' }}>Error de sesión</h2>
        <p style={{ color: '#b91c1c', margin: '0 0 12px 0', fontSize: '14px' }}>{fatalError}</p>
        <button data-testid="session-error-back" onClick={onExit} style={{ background: '#e2e8f0', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}>
          Volver a mis diagramas
        </button>
      </div>
    );
  }

  const readOnly = role === 'viewer';
  const collaboration: CollaborationBarInfo = {
    stateLabel: STATE_LABELS[connState],
    connected: connState === 'in_sync',
    roleLabel: role ? ROLE_LABELS[role] : undefined,
    participants,
    pendingCount,
  };

  return (
    <div className="session-view">
      <div className="session-toolbar">
        <button data-testid="back-to-diagrams" onClick={onExit} className="button-ghost">
          ← Mis diagramas
        </button>
        {!readOnly && (
          <ImageImportPanel
            api={api}
            diagramId={diagramId}
            onApply={handleApplyProposal}
            applyDisabled={connState !== 'in_sync'}
          />
        )}
        {!readOnly && (
          <EaImportPanel
            existingModel={model}
            onApply={handleApplyProposal}
            applyDisabled={connState !== 'in_sync'}
          />
        )}
        {isOwner && (
          <button
            data-testid="toggle-share-panel"
            onClick={() => setShareOpen((open) => !open)}
            className="button-secondary toolbar-spacer"
          >
            Compartir
          </button>
        )}
      </div>

      {lastRejected && (
        <div
          data-testid="command-retry-banner"
          className="status-banner"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
        >
          <span>El servidor rechazó el comando. Puedes reintentarlo sobre la versión actual.</span>
          <button data-testid="command-retry" onClick={retryRejected} className="button-secondary">
            Reintentar
          </button>
        </div>
      )}

      <div className="session-content">
        {model ? (
          <CaseWebCanvas
            model={model}
            lastCommandResult={lastResult}
            collaboration={collaboration}
            readOnly={readOnly}
            onAddAttribute={readOnly ? undefined : handleAddAttribute}
            onUpdateAttribute={readOnly ? undefined : handleUpdateAttribute}
            onDeleteAttribute={readOnly ? undefined : handleDeleteAttribute}
            onUpdateClass={readOnly ? undefined : handleUpdateClass}
            onCreateAssociation={readOnly ? undefined : handleCreateAssociation}
            onCreateAssociationClass={readOnly ? undefined : handleCreateAssociationClass}
            onUpdateAssociation={readOnly ? undefined : handleUpdateAssociation}
            onCreateClass={readOnly ? undefined : handleCreateClass}
            onRenameClass={readOnly ? undefined : handleRenameClass}
            onDeleteClass={readOnly ? undefined : handleDeleteClass}
            onDeleteAssociation={readOnly ? undefined : handleDeleteAssociation}
            onApplyAssistantCommands={readOnly ? undefined : handleApplyProposal}
            onAssistantInterpret={readOnly ? undefined : interpretAssistant}
          />
        ) : (
          <div data-testid="session-loading" className="loading-state">
            Sincronizando con el servidor…
          </div>
        )}
      </div>

      {shareOpen && diagram && (
        <SharePanel api={api} diagramId={diagramId} currentUserId={user.userId} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
};

export default DiagramSessionView;
