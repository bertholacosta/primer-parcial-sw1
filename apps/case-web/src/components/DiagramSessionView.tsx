import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DomainModel, ModelCommand } from 'collaboration-protocol';
import {
  CollaborationSession,
  type SessionConnectionState,
  type SessionOutcome,
  type SocketLike,
} from '../collaboration/CollaborationSession';
import {
  type DiagramRecord,
  type ModelServerApi,
  type SessionUser,
} from '../api/modelServerApi';
import { CaseWebCanvas, type CollaborationBarInfo } from './CaseWebCanvas';
import { SharePanel } from './SharePanel';
import type { CanonicalDomainModel } from '../domain/model';
import type { CommandExecutionResult } from '../commands/attributeCommands';
import type { CreateAssociationInput } from '../commands/associationCommands';
import type { CreateClassInput } from '../commands/classCommands';
import type { CreatePackageInput } from './CaseWebCanvas';
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
    (classId: string, name: string, type: string, multiplicity: string) => {
      submit('AddAttribute', {
        id: `attr-${crypto.randomUUID()}`,
        classId,
        name,
        type,
        nullable: multiplicity === '0..1',
        multiplicity,
      });
    },
    [submit]
  );

  const handleUpdateAttribute = useCallback(
    (classId: string, attributeId: string, newName: string) => {
      submit('UpdateAttribute', { attributeId, classId, name: newName });
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
        description: input.description,
      });
    },
    [submit]
  );

  const handleCreateClass = useCallback(
    (input: CreateClassInput) => {
      submit('CreateClass', {
        id: input.classId,
        name: input.name,
        packageId: input.packageId,
        isAbstract: input.isAbstract,
      });
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

  const handleCreatePackage = useCallback(
    (input: CreatePackageInput) => {
      submit('CreatePackage', { id: input.packageId, name: input.name });
    },
    [submit]
  );

  const handleDeletePackage = useCallback(
    (packageId: string) => {
      submit('DeletePackage', { packageId });
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: '8px', padding: '6px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontFamily: 'system-ui, sans-serif', alignItems: 'center' }}>
        <button data-testid="back-to-diagrams" onClick={onExit} style={{ background: 'none', border: 'none', color: '#0284c7', fontSize: '12px', cursor: 'pointer', padding: 0 }}>
          ← Mis diagramas
        </button>
        {isOwner && (
          <button
            data-testid="toggle-share-panel"
            onClick={() => setShareOpen((open) => !open)}
            style={{ marginLeft: 'auto', background: '#e2e8f0', border: 'none', borderRadius: '5px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}
          >
            Compartir
          </button>
        )}
      </div>

      {lastRejected && (
        <div
          data-testid="command-retry-banner"
          style={{ padding: '6px 20px', fontSize: '12px', background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span>El servidor rechazó el comando. Puedes reintentarlo sobre la versión actual.</span>
          <button data-testid="command-retry" onClick={retryRejected} style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '5px', padding: '3px 10px', cursor: 'pointer' }}>
            Reintentar
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {model ? (
          <CaseWebCanvas
            model={model}
            lastCommandResult={lastResult}
            collaboration={collaboration}
            readOnly={readOnly}
            onAddAttribute={readOnly ? undefined : handleAddAttribute}
            onUpdateAttribute={readOnly ? undefined : handleUpdateAttribute}
            onCreateAssociation={readOnly ? undefined : handleCreateAssociation}
            onCreateClass={readOnly ? undefined : handleCreateClass}
            onRenameClass={readOnly ? undefined : handleRenameClass}
            onDeleteClass={readOnly ? undefined : handleDeleteClass}
            onCreatePackage={readOnly ? undefined : handleCreatePackage}
            onDeletePackage={readOnly ? undefined : handleDeletePackage}
            onDeleteAssociation={readOnly ? undefined : handleDeleteAssociation}
          />
        ) : (
          <div data-testid="session-loading" style={{ padding: '24px', fontFamily: 'sans-serif', fontSize: '13px', color: '#64748b' }}>
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
