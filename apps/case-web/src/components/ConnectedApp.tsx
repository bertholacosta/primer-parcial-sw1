import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createModelServerApi,
  type AuthSession,
  type ModelServerApi,
  type SessionUser,
} from '../api/modelServerApi';
import { AuthPanel } from './AuthPanel';
import { DiagramHome } from './DiagramHome';
import { DiagramSessionView } from './DiagramSessionView';
import type { SocketLike } from '../collaboration/CollaborationSession';

export interface ConnectedAppDeps {
  api?: ModelServerApi;
  wsUrl?: string;
  socketFactory?: (url: string) => SocketLike;
  clientId?: string;
  reconnectDelayMs?: number;
}

type Phase = 'restoring' | 'anonymous' | 'home' | 'diagram';

/**
 * Orquesta el ciclo de sesión: restauración por refresh (cookie HttpOnly),
 * autenticación, selección de diagrama y apertura de la sesión colaborativa.
 * El access token vive solo en memoria dentro del cliente API.
 */
export const ConnectedApp: React.FC<ConnectedAppDeps> = ({
  api: injectedApi,
  wsUrl,
  socketFactory,
  clientId,
  reconnectDelayMs,
}) => {
  const [api] = useState<ModelServerApi>(() => injectedApi ?? createModelServerApi());
  const [phase, setPhase] = useState<Phase>('restoring');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const pendingShareToken = useRef<string | null>(shareTokenFromLocation());

  useEffect(() => {
    let cancelled = false;
    void api
      .refresh()
      .then(() => api.me())
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setPhase('home');
      })
      .catch(() => {
        if (!cancelled) setPhase('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const onAuthenticated = useCallback(
    (session: AuthSession) => {
      setUser(session.user);
      setPhase('home');
      const token = pendingShareToken.current;
      if (token) {
        pendingShareToken.current = null;
        void api
          .acceptShareLink(token)
          .then((result) => setDiagramId(result.diagramId))
          .then(() => setPhase('diagram'))
          .catch(() => setPhase('home'));
      }
    },
    [api]
  );

  const openDiagram = useCallback((id: string) => {
    setDiagramId(id);
    setPhase('diagram');
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setDiagramId(null);
    setPhase('anonymous');
  }, []);

  if (phase === 'restoring') {
    return (
      <div data-testid="session-restoring" style={{ padding: '24px', fontFamily: 'sans-serif', fontSize: '13px', color: '#64748b' }}>
        Restaurando sesión…
      </div>
    );
  }

  if (phase === 'anonymous' || !user) {
    return <AuthPanel api={api} onAuthenticated={onAuthenticated} />;
  }

  if (phase === 'diagram' && diagramId) {
    return (
      <DiagramSessionView
        api={api}
        diagramId={diagramId}
        user={user}
        wsUrl={wsUrl}
        clientId={clientId}
        socketFactory={socketFactory}
        reconnectDelayMs={reconnectDelayMs}
        onExit={() => {
          setDiagramId(null);
          setPhase('home');
        }}
      />
    );
  }

  return <DiagramHome api={api} user={user} onOpenDiagram={openDiagram} onLogout={logout} />;
};

function shareTokenFromLocation(): string | null {
  const path = globalThis.location?.pathname ?? '';
  const match = /^\/share\/([^/]+)$/.exec(path);
  return match ? decodeURIComponent(match[1]) : null;
}

export { ApiError };
export default ConnectedApp;
