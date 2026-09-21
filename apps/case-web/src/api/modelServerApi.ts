import type { CanonicalDomainModel } from '../domain/model';

export type DiagramRole = 'owner' | 'editor' | 'viewer';
export type SharedRole = Exclude<DiagramRole, 'owner'>;

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
}

export interface AuthSession {
  user: SessionUser;
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface DiagramRecord {
  diagramId: string;
  name: string;
  role: DiagramRole;
  model: CanonicalDomainModel;
}

export interface MemberRecord {
  user_id: string;
  email: string;
  display_name: string;
  role: DiagramRole;
}

export interface InvitationResult {
  invitationId: string;
  role: SharedRole;
  expiresAt: string;
}

export interface ShareLinkResult {
  shareLinkId: string;
  role: SharedRole;
  expiresAt: string;
  url: string;
}

export interface AcceptResult {
  diagramId: string;
  role: SharedRole;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ModelServerApi {
  readonly accessToken: string | undefined;
  readonly accessTokenExpiresAt: string | undefined;
  register(email: string, password: string, displayName: string): Promise<SessionUser>;
  login(email: string, password: string): Promise<AuthSession>;
  refresh(): Promise<{ accessToken: string; accessTokenExpiresAt: string }>;
  ensureAccessToken(): Promise<string>;
  logout(): Promise<void>;
  me(): Promise<SessionUser>;
  listDiagrams(): Promise<DiagramRecord[]>;
  getDiagram(diagramId: string): Promise<DiagramRecord>;
  createDiagram(name: string): Promise<DiagramRecord>;
  listMembers(diagramId: string): Promise<MemberRecord[]>;
  setMemberRole(diagramId: string, userId: string, role: SharedRole): Promise<void>;
  removeMember(diagramId: string, userId: string): Promise<void>;
  createInvitation(diagramId: string, email: string, role: SharedRole, expiresAt: string): Promise<InvitationResult>;
  acceptInvitation(token: string): Promise<AcceptResult>;
  createShareLink(diagramId: string, role: SharedRole, expiresAt: string, maxUses?: number): Promise<ShareLinkResult>;
  acceptShareLink(token: string): Promise<AcceptResult>;
  revokeShareLink(diagramId: string, linkId: string): Promise<void>;
}

interface ApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Cliente REST del contrato identity-access-v1. El access token vive solo en
 * memoria; el refresh token viaja en cookie HttpOnly (credentials: 'include')
 * y nunca se materializa en JS ni en almacenamiento del navegador.
 */
export function createModelServerApi(options: ApiOptions = {}): ModelServerApi {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  let accessToken: string | undefined;
  let accessTokenExpiresAt: string | undefined;
  let refreshing: Promise<{ accessToken: string; accessTokenExpiresAt: string }> | null = null;

  const parseError = async (response: Response): Promise<ApiError> => {
    try {
      const body = (await response.json()) as { code?: string; message?: string; details?: unknown[] };
      return new ApiError(body.code ?? 'INTERNAL_ERROR', response.status, body.message ?? 'Error de la solicitud.', body.details);
    } catch {
      return new ApiError('INTERNAL_ERROR', response.status, 'Error de la solicitud.');
    }
  };

  const request = async <T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    if (response.status === 401 && allowRefresh && accessToken) {
      try {
        await api.refresh();
      } catch {
        throw await parseError(response);
      }
      return request<T>(path, init, false);
    }
    if (!response.ok) throw await parseError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };

  const api: ModelServerApi = {
    get accessToken() {
      return accessToken;
    },
    get accessTokenExpiresAt() {
      return accessTokenExpiresAt;
    },

    async register(email, password, displayName) {
      const body = await request<{ user: SessionUser }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
      return body.user;
    },

    async login(email, password) {
      const body = await request<AuthSession>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      accessToken = body.accessToken;
      accessTokenExpiresAt = body.accessTokenExpiresAt;
      return body;
    },

    async refresh() {
      refreshing ??= (async () => {
        try {
          const body = await request<{ accessToken: string; accessTokenExpiresAt: string }>(
            '/api/v1/auth/refresh',
            { method: 'POST' },
            false
          );
          accessToken = body.accessToken;
          accessTokenExpiresAt = body.accessTokenExpiresAt;
          return body;
        } finally {
          refreshing = null;
        }
      })();
      return refreshing;
    },

    async ensureAccessToken() {
      if (!accessToken) throw new ApiError('AUTH_SESSION_INVALID', 401, 'Sesión inválida.');
      const expiry = accessTokenExpiresAt ? new Date(accessTokenExpiresAt).getTime() : 0;
      if (expiry - 30_000 <= Date.now()) {
        const renewed = await api.refresh();
        return renewed.accessToken;
      }
      return accessToken;
    },

    async logout() {
      await request<void>('/api/v1/auth/logout', { method: 'POST' });
      accessToken = undefined;
      accessTokenExpiresAt = undefined;
    },

    async me() {
      const body = await request<{ user: SessionUser }>('/api/v1/users/me');
      return body.user;
    },

    listDiagrams: () => request<DiagramRecord[]>('/api/v1/diagrams'),
    getDiagram: (diagramId) => request<DiagramRecord>(`/api/v1/diagrams/${diagramId}`),
    createDiagram: (name) =>
      request<DiagramRecord>('/api/v1/diagrams', { method: 'POST', body: JSON.stringify({ name }) }),
    listMembers: (diagramId) => request<MemberRecord[]>(`/api/v1/diagrams/${diagramId}/members`),
    setMemberRole: (diagramId, userId, role) =>
      request<void>(`/api/v1/diagrams/${diagramId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    removeMember: (diagramId, userId) =>
      request<void>(`/api/v1/diagrams/${diagramId}/members/${userId}`, { method: 'DELETE' }),
    createInvitation: (diagramId, email, role, expiresAt) =>
      request<InvitationResult>(`/api/v1/diagrams/${diagramId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, role, expiresAt }),
      }),
    acceptInvitation: (token) =>
      request<AcceptResult>(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    createShareLink: (diagramId, role, expiresAt, maxUses) =>
      request<ShareLinkResult>(`/api/v1/diagrams/${diagramId}/share-links`, {
        method: 'POST',
        body: JSON.stringify({ role, expiresAt, maxUses }),
      }),
    acceptShareLink: (token) =>
      request<AcceptResult>(`/api/v1/share-links/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    revokeShareLink: (diagramId, linkId) =>
      request<void>(`/api/v1/diagrams/${diagramId}/share-links/${linkId}`, { method: 'DELETE' }),
  };

  return api;
}
