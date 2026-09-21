import React, { useEffect, useState } from 'react';
import {
  ApiError,
  type DiagramRecord,
  type ModelServerApi,
  type SessionUser,
} from '../api/modelServerApi';

interface DiagramHomeProps {
  api: ModelServerApi;
  user: SessionUser;
  onOpenDiagram(diagramId: string): void;
  onLogout(): void;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  viewer: 'Lector',
};

const card: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '12px 14px',
  background: '#ffffff',
};

/** Lista de diagramas accesibles, creación y aceptación de invitaciones/enlaces. */
export const DiagramHome: React.FC<DiagramHomeProps> = ({ api, user, onOpenDiagram, onLogout }) => {
  const [diagrams, setDiagrams] = useState<DiagramRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [shareToken, setShareToken] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      setDiagrams(await api.listDiagrams());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la lista.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    try {
      const created = await api.createDiagram(newName.trim());
      setNewName('');
      onOpenDiagram(created.diagramId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el diagrama.');
    }
  };

  const accept = async (kind: 'invitation' | 'share') => {
    const token = kind === 'invitation' ? invitationToken.trim() : shareToken.trim();
    if (!token) return;
    try {
      const result =
        kind === 'invitation' ? await api.acceptInvitation(token) : await api.acceptShareLink(token);
      setNotice(`Acceso concedido como ${ROLE_LABELS[result.role] ?? result.role}.`);
      setInvitationToken('');
      setShareToken('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'El token no es válido.');
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  };

  return (
    <div
      data-testid="diagram-home"
      style={{ maxWidth: '720px', margin: '0 auto', padding: '24px', fontFamily: 'system-ui, sans-serif' }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', margin: 0, color: '#0f172a' }}>Mis diagramas</h1>
          <span data-testid="current-user" style={{ fontSize: '13px', color: '#64748b' }}>
            {user.displayName} · {user.email}
          </span>
        </div>
        <button
          data-testid="logout-button"
          onClick={logout}
          style={{ background: '#e2e8f0', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
        >
          Cerrar sesión
        </button>
      </header>

      {error && (
        <div role="alert" data-testid="home-error" style={{ ...card, background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b', fontSize: '13px', marginBottom: '14px' }}>
          {error}
        </div>
      )}
      {notice && (
        <div data-testid="home-notice" style={{ ...card, background: '#f0fdf4', borderColor: '#86efac', color: '#166534', fontSize: '13px', marginBottom: '14px' }}>
          {notice}
        </div>
      )}

      <section style={{ ...card, marginBottom: '16px' }}>
        <form onSubmit={create} style={{ display: 'flex', gap: '8px' }}>
          <input
            data-testid="create-diagram-name"
            placeholder="Nombre del nuevo diagrama"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, padding: '7px 10px', fontSize: '14px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
          />
          <button
            data-testid="create-diagram-submit"
            type="submit"
            style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer' }}
          >
            Crear diagrama
          </button>
        </form>
      </section>

      <section data-testid="diagram-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        {diagrams === null && <p style={{ color: '#64748b', fontSize: '13px' }}>Cargando diagramas…</p>}
        {diagrams?.length === 0 && (
          <p style={{ color: '#64748b', fontSize: '13px' }}>Aún no tienes diagramas. Crea uno o acepta una invitación.</p>
        )}
        {diagrams?.map((diagram) => (
          <div key={diagram.diagramId} data-testid={`diagram-item-${diagram.diagramId}`} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: '14px', color: '#0f172a' }}>{diagram.name}</strong>
              <span style={{ marginLeft: '10px', fontSize: '12px', color: '#0284c7' }}>
                {ROLE_LABELS[diagram.role] ?? diagram.role}
              </span>
            </div>
            <button
              data-testid={`open-diagram-${diagram.diagramId}`}
              onClick={() => onOpenDiagram(diagram.diagramId)}
              style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
            >
              Abrir
            </button>
          </div>
        ))}
      </section>

      <section style={{ ...card, display: 'grid', gap: '10px' }}>
        <h2 style={{ fontSize: '14px', margin: 0, color: '#334155' }}>Aceptar acceso compartido</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            data-testid="accept-invitation-input"
            placeholder="Token de invitación por correo"
            value={invitationToken}
            onChange={(e) => setInvitationToken(e.target.value)}
            style={{ flex: 1, padding: '6px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
          />
          <button
            data-testid="accept-invitation-submit"
            onClick={() => void accept('invitation')}
            style={{ background: '#e2e8f0', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
          >
            Aceptar invitación
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            data-testid="accept-share-input"
            placeholder="Token de enlace compartido (/share/…)"
            value={shareToken}
            onChange={(e) => setShareToken(e.target.value)}
            style={{ flex: 1, padding: '6px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
          />
          <button
            data-testid="accept-share-submit"
            onClick={() => void accept('share')}
            style={{ background: '#e2e8f0', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
          >
            Usar enlace
          </button>
        </div>
      </section>
    </div>
  );
};

export default DiagramHome;
