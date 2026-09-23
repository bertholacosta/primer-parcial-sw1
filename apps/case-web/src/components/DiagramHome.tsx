import React, { useEffect, useState } from 'react';
import { ApiError, type DiagramRecord, type ModelServerApi, type SessionUser } from '../api/modelServerApi';

interface DiagramHomeProps {
  api: ModelServerApi;
  user: SessionUser;
  onOpenDiagram(diagramId: string): void;
  onLogout(): void;
}

const ROLE_LABELS: Record<string, string> = { owner: 'Propietario', editor: 'Editor', viewer: 'Lector' };

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

  useEffect(() => { void load(); }, []);

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
      const result = kind === 'invitation' ? await api.acceptInvitation(token) : await api.acceptShareLink(token);
      setNotice(`Acceso concedido como ${ROLE_LABELS[result.role] ?? result.role}.`);
      setInvitationToken('');
      setShareToken('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'El token no es válido.');
    }
  };

  const logout = async () => {
    try { await api.logout(); } finally { onLogout(); }
  };

  return (
    <main className="home-page" data-testid="diagram-home">
      <div className="home-content">
        <header className="home-header">
          <div>
            <span className="editor-eyebrow">CASE Studio</span>
            <h1>Mis diagramas</h1>
            <span data-testid="current-user" className="home-user">{user.displayName} · {user.email}</span>
          </div>
          <button data-testid="logout-button" onClick={logout} className="button-secondary">Cerrar sesión</button>
        </header>

        {error && <div role="alert" data-testid="home-error" className="alert error">{error}</div>}
        {notice && <div data-testid="home-notice" className="alert success">{notice}</div>}

        <section className="surface-card create-diagram-card" aria-label="Crear diagrama">
          <form onSubmit={create} className="horizontal-form">
            <input data-testid="create-diagram-name" className="form-control" placeholder="Nombre del nuevo diagrama" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button data-testid="create-diagram-submit" type="submit" className="button-primary">Crear diagrama</button>
          </form>
        </section>

        <section data-testid="diagram-list" className="diagram-grid" aria-label="Diagramas disponibles">
          {diagrams === null && <div className="empty-state">Cargando diagramas…</div>}
          {diagrams?.length === 0 && <div className="empty-state">Aún no tienes diagramas. Crea uno o acepta una invitación.</div>}
          {diagrams?.map((diagram) => (
            <article key={diagram.diagramId} data-testid={`diagram-item-${diagram.diagramId}`} className="surface-card diagram-card">
              <div>
                <div className="diagram-card-title"><strong>{diagram.name}</strong></div>
                <span className="role-badge">{ROLE_LABELS[diagram.role] ?? diagram.role}</span>
              </div>
              <div className="diagram-card-actions">
                <button data-testid={`open-diagram-${diagram.diagramId}`} onClick={() => onOpenDiagram(diagram.diagramId)} className="button-primary">Abrir editor</button>
              </div>
            </article>
          ))}
        </section>

        <section className="surface-card access-card">
          <h2>Aceptar acceso compartido</h2>
          <div className="horizontal-form">
            <input data-testid="accept-invitation-input" className="form-control" placeholder="Token de invitación por correo" value={invitationToken} onChange={(e) => setInvitationToken(e.target.value)} />
            <button data-testid="accept-invitation-submit" onClick={() => void accept('invitation')} className="button-secondary">Aceptar invitación</button>
          </div>
          <div className="horizontal-form">
            <input data-testid="accept-share-input" className="form-control" placeholder="Token de enlace compartido (/share/…)" value={shareToken} onChange={(e) => setShareToken(e.target.value)} />
            <button data-testid="accept-share-submit" onClick={() => void accept('share')} className="button-secondary">Usar enlace</button>
          </div>
        </section>
      </div>
    </main>
  );
};

export default DiagramHome;
