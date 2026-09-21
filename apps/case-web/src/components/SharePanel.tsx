import React, { useEffect, useState } from 'react';
import {
  ApiError,
  type MemberRecord,
  type ModelServerApi,
  type SharedRole,
} from '../api/modelServerApi';

interface SharePanelProps {
  api: ModelServerApi;
  diagramId: string;
  currentUserId: string;
  onClose(): void;
}

interface CreatedLink {
  shareLinkId: string;
  url: string;
  role: SharedRole;
  revoked?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  viewer: 'Lector',
};

const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** Gestión de miembros, invitaciones por correo y enlaces revocables (solo owner). */
export const SharePanel: React.FC<SharePanelProps> = ({ api, diagramId, currentUserId, onClose }) => {
  const [members, setMembers] = useState<MemberRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<SharedRole>('editor');
  const [inviteDays, setInviteDays] = useState(7);
  const [linkRole, setLinkRole] = useState<SharedRole>('viewer');
  const [linkDays, setLinkDays] = useState(7);
  const [linkMaxUses, setLinkMaxUses] = useState('');
  const [links, setLinks] = useState<CreatedLink[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const showError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Operación no completada.');

  const load = async () => {
    try {
      setMembers(await api.listMembers(diagramId));
      setError(null);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId]);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      await api.createInvitation(diagramId, inviteEmail.trim(), inviteRole, plusDays(inviteDays));
      setNotice(`Invitación enviada a ${inviteEmail.trim()} como ${ROLE_LABELS[inviteRole]}.`);
      setInviteEmail('');
    } catch (err) {
      showError(err);
    }
  };

  const changeRole = async (member: MemberRecord, role: SharedRole) => {
    try {
      await api.setMemberRole(diagramId, member.user_id, role);
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const remove = async (member: MemberRecord) => {
    try {
      await api.removeMember(diagramId, member.user_id);
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const createLink = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const maxUses = linkMaxUses.trim() ? Number(linkMaxUses) : undefined;
      const created = await api.createShareLink(diagramId, linkRole, plusDays(linkDays), maxUses);
      setLinks((prev) => [...prev, { shareLinkId: created.shareLinkId, url: created.url, role: created.role }]);
    } catch (err) {
      showError(err);
    }
  };

  const revokeLink = async (link: CreatedLink) => {
    try {
      await api.revokeShareLink(diagramId, link.shareLinkId);
      setLinks((prev) => prev.map((l) => (l.shareLinkId === link.shareLinkId ? { ...l, revoked: true } : l)));
    } catch (err) {
      showError(err);
    }
  };

  const field: React.CSSProperties = { padding: '5px 8px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '5px' };

  return (
    <aside
      data-testid="share-panel"
      style={{
        borderTop: '1px solid #e2e8f0',
        background: '#ffffff',
        padding: '12px 20px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        maxHeight: '220px',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h2 style={{ fontSize: '14px', margin: 0, color: '#0f172a' }}>Compartir diagrama</h2>
        <button data-testid="share-panel-close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#64748b' }}>
          Cerrar
        </button>
      </div>

      {error && (
        <div role="alert" data-testid="share-error" style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: '5px', padding: '6px 8px', marginBottom: '8px' }}>
          {error}
        </div>
      )}
      {notice && (
        <div data-testid="share-notice" style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', borderRadius: '5px', padding: '6px 8px', marginBottom: '8px' }}>
          {notice}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <section>
          <h3 style={{ fontSize: '12px', margin: '0 0 6px 0', color: '#334155' }}>Miembros</h3>
          <ul data-testid="member-list" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '4px' }}>
            {members?.map((member) => (
              <li key={member.user_id} data-testid={`member-${member.user_id}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {member.display_name} ({member.email})
                </span>
                {member.role === 'owner' ? (
                  <span style={{ color: '#0284c7' }}>Propietario</span>
                ) : (
                  <>
                    <select
                      data-testid={`member-role-${member.user_id}`}
                      value={member.role}
                      onChange={(e) => void changeRole(member, e.target.value as SharedRole)}
                      style={field}
                      aria-label={`Rol de ${member.email}`}
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Lector</option>
                    </select>
                    {member.user_id !== currentUserId && (
                      <button
                        data-testid={`member-remove-${member.user_id}`}
                        onClick={() => void remove(member)}
                        style={{ ...field, cursor: 'pointer', color: '#991b1b' }}
                      >
                        Revocar
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          <form onSubmit={invite} style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
            <input
              data-testid="invite-email"
              type="email"
              placeholder="correo@ejemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={{ ...field, flex: 1, minWidth: '140px' }}
            />
            <select data-testid="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as SharedRole)} style={field} aria-label="Rol de la invitación">
              <option value="editor">Editor</option>
              <option value="viewer">Lector</option>
            </select>
            <input
              data-testid="invite-days"
              type="number"
              min={1}
              max={7}
              value={inviteDays}
              onChange={(e) => setInviteDays(Number(e.target.value))}
              style={{ ...field, width: '56px' }}
              title="Días hasta expirar"
              aria-label="Días hasta expirar"
            />
            <button data-testid="invite-submit" type="submit" style={{ ...field, cursor: 'pointer', background: '#0f172a', color: '#fff', border: 'none' }}>
              Invitar
            </button>
          </form>
        </section>

        <section>
          <h3 style={{ fontSize: '12px', margin: '0 0 6px 0', color: '#334155' }}>Enlace revocable</h3>
          <form onSubmit={createLink} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <select data-testid="share-link-role" value={linkRole} onChange={(e) => setLinkRole(e.target.value as SharedRole)} style={field} aria-label="Rol del enlace">
              <option value="editor">Editor</option>
              <option value="viewer">Lector</option>
            </select>
            <input
              data-testid="share-link-days"
              type="number"
              min={1}
              max={7}
              value={linkDays}
              onChange={(e) => setLinkDays(Number(e.target.value))}
              style={{ ...field, width: '56px' }}
              title="Días hasta expirar"
              aria-label="Días hasta expirar"
            />
            <input
              data-testid="share-link-max-uses"
              placeholder="usos máx. (opcional)"
              value={linkMaxUses}
              onChange={(e) => setLinkMaxUses(e.target.value)}
              style={{ ...field, width: '130px' }}
              aria-label="Usos máximos"
            />
            <button data-testid="share-link-create" type="submit" style={{ ...field, cursor: 'pointer', background: '#0f172a', color: '#fff', border: 'none' }}>
              Crear enlace
            </button>
          </form>
          <ul data-testid="share-link-list" style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: '4px' }}>
            {links.map((link) => (
              <li key={link.shareLinkId} data-testid={`share-link-${link.shareLinkId}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <code data-testid="share-link-url" style={{ flex: 1, background: '#f1f5f9', padding: '3px 6px', borderRadius: '4px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {link.url}
                </code>
                <span>{ROLE_LABELS[link.role]}</span>
                {link.revoked ? (
                  <span style={{ color: '#991b1b' }}>revocado</span>
                ) : (
                  <button
                    data-testid={`share-link-revoke-${link.shareLinkId}`}
                    onClick={() => void revokeLink(link)}
                    style={{ ...field, cursor: 'pointer', color: '#991b1b' }}
                  >
                    Revocar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
};

export default SharePanel;
