import { randomUUID } from "node:crypto";
import { modelSha256, type DomainModel } from "collaboration-protocol";
import type { Database, SqlExecutor } from "./database.js";
import { isUniqueViolation, PlatformError } from "./errors.js";

export type DiagramRole = "owner" | "editor" | "viewer";

export interface PublicUser {
  userId: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredUser extends PublicUser {
  passwordHash: string;
  status: "active" | "suspended";
}

export interface DiagramRecord {
  diagramId: string;
  name: string;
  role: DiagramRole;
  model: DomainModel;
}

export interface Mailer {
  sendInvitation(input: { email: string; token: string; diagramId: string; role: Exclude<DiagramRole, "owner">; expiresAt: Date }): Promise<void>;
}

export class NoopMailer implements Mailer {
  async sendInvitation(): Promise<void> {}
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: "active" | "suspended";
  created_at: Date;
  updated_at: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

interface DiagramRow {
  id: string;
  name: string;
  model: DomainModel;
  role: DiagramRole;
}

interface MemberRow {
  user_id: string;
  email: string;
  display_name: string;
  role: DiagramRole;
}

interface InvitationRow {
  id: string;
  diagram_id: string;
  email: string;
  role: Exclude<DiagramRole, "owner">;
  status: "pending" | "accepted" | "revoked" | "expired";
  accepted_by: string | null;
  expires_at: Date;
}

interface ShareLinkRow {
  id: string;
  diagram_id: string;
  role: Exclude<DiagramRole, "owner">;
  expires_at: Date;
  max_uses: number | null;
  use_count: number;
  revoked_at: Date | null;
}

function publicUser(row: UserRow): PublicUser {
  return { userId: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function storedUser(row: UserRow): StoredUser {
  return { ...publicUser(row), passwordHash: row.password_hash, status: row.status };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class PlatformStore {
  constructor(private readonly database: Database, private readonly now: () => Date = () => new Date()) {}

  async createUser(email: string, displayName: string, passwordHash: string): Promise<PublicUser> {
    const id = randomUUID();
    const now = this.now();
    try {
      const result = await this.database.query<UserRow>(
        `INSERT INTO users(id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
        [id, normalizeEmail(email), displayName.trim(), passwordHash, now],
      );
      return publicUser(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new PlatformError("EMAIL_ALREADY_REGISTERED", 409, "El correo ya está registrado.");
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<StoredUser | undefined> {
    const result = await this.database.query<UserRow>("SELECT * FROM users WHERE email = $1", [normalizeEmail(email)]);
    return result.rows[0] ? storedUser(result.rows[0]) : undefined;
  }

  async findUserById(userId: string): Promise<PublicUser | undefined> {
    const result = await this.database.query<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
    return result.rows[0] ? publicUser(result.rows[0]) : undefined;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date, familyId = randomUUID()): Promise<void> {
    await this.database.query(
      `INSERT INTO auth_sessions(id, user_id, family_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), userId, familyId, tokenHash, expiresAt, this.now()],
    );
  }

  async rotateSession(currentHash: string, replacementHash: string, expiresAt: Date): Promise<{ userId: string; familyId: string; reused: boolean } | undefined> {
    return this.database.transaction(async (executor) => {
      const result = await executor.query<SessionRow>("SELECT * FROM auth_sessions WHERE token_hash = $1", [currentHash]);
      const session = result.rows[0];
      if (!session) return undefined;
      const now = this.now();
      if (session.revoked_at) {
        await executor.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE family_id = $1", [session.family_id, now]);
        return { userId: session.user_id, familyId: session.family_id, reused: true };
      }
      if (session.expires_at.getTime() <= now.getTime()) return undefined;
      const replacementId = randomUUID();
      await executor.query("UPDATE auth_sessions SET revoked_at = $2, replaced_by = $3 WHERE id = $1", [session.id, now, replacementId]);
      await executor.query(
        `INSERT INTO auth_sessions(id, user_id, family_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [replacementId, session.user_id, session.family_id, replacementHash, expiresAt, now],
      );
      return { userId: session.user_id, familyId: session.family_id, reused: false };
    });
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.database.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE token_hash = $1", [tokenHash, this.now()]);
  }

  async createDiagram(userId: string, name: string): Promise<DiagramRecord> {
    const diagramId = randomUUID();
    const model: DomainModel = { contractVersion: "1", id: diagramId, name: name.trim(), version: "1.0.0", classes: [], associations: [] };
    const now = this.now();
    await this.database.transaction(async (executor) => {
      await executor.query(
        `INSERT INTO diagrams(id, owner_id, name, model, model_version, model_sha256, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [diagramId, userId, model.name, model, model.version, modelSha256(model), now],
      );
      await executor.query(
        `INSERT INTO diagram_members(diagram_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)`,
        [diagramId, userId, now],
      );
    });
    return { diagramId, name: model.name, role: "owner", model };
  }

  async listDiagrams(userId: string): Promise<DiagramRecord[]> {
    const result = await this.database.query<DiagramRow>(
      `SELECT d.id, d.name, d.model, m.role FROM diagrams d
       JOIN diagram_members m ON m.diagram_id = d.id WHERE m.user_id = $1 ORDER BY d.created_at`,
      [userId],
    );
    return result.rows.map((row) => ({ diagramId: row.id, name: row.name, role: row.role, model: row.model }));
  }

  async getDiagram(userId: string, diagramId: string): Promise<DiagramRecord | undefined> {
    const result = await this.database.query<DiagramRow>(
      `SELECT d.id, d.name, d.model, m.role FROM diagrams d
       JOIN diagram_members m ON m.diagram_id = d.id WHERE d.id = $1 AND m.user_id = $2`,
      [diagramId, userId],
    );
    const row = result.rows[0];
    return row ? { diagramId: row.id, name: row.name, role: row.role, model: row.model } : undefined;
  }

  async roleFor(userId: string, diagramId: string, executor: SqlExecutor = this.database): Promise<DiagramRole | undefined> {
    const result = await executor.query<{ role: DiagramRole }>("SELECT role FROM diagram_members WHERE diagram_id = $1 AND user_id = $2", [diagramId, userId]);
    return result.rows[0]?.role;
  }

  private async requireOwner(userId: string, diagramId: string, executor: SqlExecutor = this.database): Promise<void> {
    if ((await this.roleFor(userId, diagramId, executor)) !== "owner") throw new PlatformError("INSUFFICIENT_PERMISSIONS", 403, "Permisos insuficientes.");
  }

  async listMembers(userId: string, diagramId: string): Promise<MemberRow[]> {
    await this.requireOwner(userId, diagramId);
    const result = await this.database.query<MemberRow>(
      `SELECT u.id AS user_id, u.email, u.display_name, m.role FROM diagram_members m
       JOIN users u ON u.id = m.user_id WHERE m.diagram_id = $1 ORDER BY u.email`,
      [diagramId],
    );
    return result.rows;
  }

  async setMemberRole(ownerId: string, diagramId: string, memberId: string, role: Exclude<DiagramRole, "owner">): Promise<void> {
    await this.requireOwner(ownerId, diagramId);
    const result = await this.database.query("UPDATE diagram_members SET role = $3, updated_at = $4 WHERE diagram_id = $1 AND user_id = $2 AND role <> 'owner'", [diagramId, memberId, role, this.now()]);
    if (result.rowCount === 0) throw new PlatformError("DIAGRAM_NOT_FOUND", 404, "Miembro no encontrado.");
  }

  async removeMember(ownerId: string, diagramId: string, memberId: string): Promise<void> {
    await this.requireOwner(ownerId, diagramId);
    const role = await this.roleFor(memberId, diagramId);
    if (role === "owner") throw new PlatformError("OWNER_REQUIRED", 409, "El diagrama debe conservar propietario.");
    await this.database.query("DELETE FROM diagram_members WHERE diagram_id = $1 AND user_id = $2", [diagramId, memberId]);
  }

  async createInvitation(input: { ownerId: string; diagramId: string; email: string; role: Exclude<DiagramRole, "owner">; tokenHash: string; expiresAt: Date }): Promise<string> {
    await this.requireOwner(input.ownerId, input.diagramId);
    const id = randomUUID();
    const now = this.now();
    await this.database.transaction(async (executor) => {
      await executor.query(
        `UPDATE diagram_invitations SET status = 'revoked', updated_at = $3
         WHERE diagram_id = $1 AND email = $2 AND status = 'pending'`,
        [input.diagramId, normalizeEmail(input.email), now],
      );
      await executor.query(
        `INSERT INTO diagram_invitations(id, diagram_id, email, role, token_hash, status, invited_by, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $8)`,
        [id, input.diagramId, normalizeEmail(input.email), input.role, input.tokenHash, input.ownerId, input.expiresAt, now],
      );
    });
    return id;
  }

  async acceptInvitation(userId: string, email: string, hash: string): Promise<{ diagramId: string; role: Exclude<DiagramRole, "owner"> }> {
    return this.database.transaction(async (executor) => {
      const result = await executor.query<InvitationRow>("SELECT * FROM diagram_invitations WHERE token_hash = $1", [hash]);
      const invitation = result.rows[0];
      if (!invitation || invitation.expires_at.getTime() <= this.now().getTime() || invitation.status === "revoked" || invitation.status === "expired") {
        throw new PlatformError("INVITATION_INVALID", 409, "La invitación no es válida.");
      }
      if (invitation.email !== normalizeEmail(email)) throw new PlatformError("INVITATION_EMAIL_MISMATCH", 403, "La invitación pertenece a otro correo.");
      if (invitation.status === "accepted") {
        if (invitation.accepted_by !== userId) throw new PlatformError("INVITATION_INVALID", 409, "La invitación no es válida.");
        return { diagramId: invitation.diagram_id, role: invitation.role };
      }
      const now = this.now();
      await this.upsertMembership(executor, invitation.diagram_id, userId, invitation.role, now);
      await executor.query("UPDATE diagram_invitations SET status = 'accepted', accepted_by = $2, updated_at = $3 WHERE id = $1", [invitation.id, userId, now]);
      return { diagramId: invitation.diagram_id, role: invitation.role };
    });
  }

  async createShareLink(input: { ownerId: string; diagramId: string; role: Exclude<DiagramRole, "owner">; tokenHash: string; expiresAt: Date; maxUses?: number }): Promise<string> {
    await this.requireOwner(input.ownerId, input.diagramId);
    const id = randomUUID();
    await this.database.query(
      `INSERT INTO diagram_share_links(id, diagram_id, role, token_hash, expires_at, max_uses, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, input.diagramId, input.role, input.tokenHash, input.expiresAt, input.maxUses ?? null, input.ownerId, this.now()],
    );
    return id;
  }

  async revokeShareLink(ownerId: string, diagramId: string, linkId: string): Promise<void> {
    await this.requireOwner(ownerId, diagramId);
    await this.database.query("UPDATE diagram_share_links SET revoked_at = COALESCE(revoked_at, $4) WHERE id = $1 AND diagram_id = $2 AND created_by = $3", [linkId, diagramId, ownerId, this.now()]);
  }

  async acceptShareLink(userId: string, hash: string): Promise<{ diagramId: string; role: Exclude<DiagramRole, "owner"> }> {
    return this.database.transaction(async (executor) => {
      const result = await executor.query<ShareLinkRow>("SELECT * FROM diagram_share_links WHERE token_hash = $1", [hash]);
      const link = result.rows[0];
      if (!link || link.revoked_at || link.expires_at.getTime() <= this.now().getTime()) throw new PlatformError("SHARE_LINK_INVALID", 409, "El enlace no es válido.");
      const previous = await executor.query("SELECT 1 FROM diagram_share_redemptions WHERE share_link_id = $1 AND user_id = $2", [link.id, userId]);
      if (previous.rowCount === 0) {
        if (link.max_uses !== null && link.use_count >= link.max_uses) throw new PlatformError("SHARE_LINK_INVALID", 409, "El enlace no es válido.");
        await executor.query("INSERT INTO diagram_share_redemptions(share_link_id, user_id, created_at) VALUES ($1, $2, $3)", [link.id, userId, this.now()]);
        await executor.query("UPDATE diagram_share_links SET use_count = use_count + 1 WHERE id = $1", [link.id]);
      }
      await this.upsertMembership(executor, link.diagram_id, userId, link.role, this.now());
      return { diagramId: link.diagram_id, role: link.role };
    });
  }

  private async upsertMembership(executor: SqlExecutor, diagramId: string, userId: string, role: Exclude<DiagramRole, "owner">, now: Date): Promise<void> {
    await executor.query(
      `INSERT INTO diagram_members(diagram_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (diagram_id, user_id) DO UPDATE SET
         role = CASE WHEN diagram_members.role = 'owner' THEN diagram_members.role ELSE EXCLUDED.role END,
         updated_at = EXCLUDED.updated_at`,
      [diagramId, userId, role, now],
    );
  }
}
