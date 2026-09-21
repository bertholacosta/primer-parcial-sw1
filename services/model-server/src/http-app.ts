import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Database } from "./database.js";
import { databaseHealthy } from "./database.js";
import type { ModelServerConfig } from "./config.js";
import { PlatformError } from "./errors.js";
import { NoopMailer, PlatformStore, type DiagramRole, type Mailer } from "./platform-store.js";
import { RateLimiter } from "./rate-limiter.js";
import { hashPassword, newOpaqueToken, signAccessToken, tokenHash, verifyAccessToken, verifyPassword, type AccessIdentity } from "./security.js";

const REFRESH_COOKIE = "refresh_token";
const MAX_SHARE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

type SharedRole = Exclude<DiagramRole, "owner">;

interface RegisterBody { email: string; password: string; displayName: string }
interface LoginBody { email: string; password: string }
interface DiagramBody { name: string }
interface DiagramParams { diagramId: string }
interface MemberParams extends DiagramParams { userId: string }
interface RoleBody { role: SharedRole }
interface InvitationBody extends RoleBody { email: string; expiresAt: string }
interface TokenParams { token: string }
interface ShareBody extends RoleBody { expiresAt: string; maxUses?: number }
interface ShareParams extends DiagramParams { linkId: string }

export interface BuildHttpAppOptions {
  database: Database;
  config: ModelServerConfig;
  mailer?: Mailer;
  now?: () => Date;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireSharedRole(role: string): SharedRole {
  if (role !== "editor" && role !== "viewer") throw new PlatformError("VALIDATION_ERROR", 400, "Rol inválido.");
  return role;
}

function expiration(value: string, now: Date): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime() || parsed.getTime() > now.getTime() + MAX_SHARE_LIFETIME_MS) {
    throw new PlatformError("VALIDATION_ERROR", 400, "Expiración inválida.");
  }
  return parsed;
}

function bearer(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new PlatformError("AUTH_SESSION_INVALID", 401, "Sesión inválida.");
  return authorization.slice(7);
}

export async function buildHttpApp(options: BuildHttpAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  const now = options.now ?? (() => new Date());
  const store = new PlatformStore(options.database, now);
  const mailer = options.mailer ?? new NoopMailer();
  const loginLimiter = new RateLimiter(5, 60_000);
  const registerLimiter = new RateLimiter(5, 60_000);

  await app.register(cookie);
  await app.register(cors, { origin: options.config.corsOrigins, credentials: true });

  app.setErrorHandler((error, request, reply) => {
    const platformError = error instanceof PlatformError ? error : new PlatformError("INTERNAL_ERROR", 500, "Error interno.");
    if (!(error instanceof PlatformError)) request.log.error({ err: error }, "request failed");
    void reply.status(platformError.statusCode).send({ code: platformError.code, message: platformError.message, requestId: request.id, details: platformError.details ?? [] });
  });

  const authenticate = async (request: FastifyRequest): Promise<AccessIdentity> => {
    try {
      return await verifyAccessToken(bearer(request), options.config.jwtSecret);
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      throw new PlatformError("AUTH_SESSION_INVALID", 401, "Sesión inválida.");
    }
  };

  const issueSession = async (user: { userId: string; email: string; displayName: string; createdAt: Date; updatedAt: Date }) => {
    const access = await signAccessToken({ userId: user.userId, email: user.email }, options.config.jwtSecret, options.config.accessTokenTtlSeconds);
    const refresh = newOpaqueToken();
    await store.createSession(user.userId, tokenHash(refresh), new Date(now().getTime() + options.config.refreshTokenTtlSeconds * 1000));
    return { access, refresh };
  };

  const setRefreshCookie = (reply: FastifyReply, token: string) => {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: options.config.secureCookies,
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: options.config.refreshTokenTtlSeconds,
    });
  };

  app.get("/health", async (_request, reply) => {
    const healthy = await databaseHealthy(options.database);
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? "ok" : "unavailable" });
  });

  app.post<{ Body: RegisterBody }>("/api/v1/auth/register", async (request, reply) => {
    const email = normalizeEmail(request.body.email ?? "");
    const displayName = request.body.displayName?.trim();
    if (!registerLimiter.consume(`${request.ip}:${email}`)) throw new PlatformError("AUTH_RATE_LIMITED", 429, "Demasiados intentos.");
    if (!validEmail(email) || !displayName || request.body.password?.length < 12 || request.body.password === email) {
      throw new PlatformError("VALIDATION_ERROR", 400, "Datos de registro inválidos.");
    }
    const user = await store.createUser(email, displayName, await hashPassword(request.body.password));
    return reply.status(201).send({ user });
  });

  app.post<{ Body: LoginBody }>("/api/v1/auth/login", async (request, reply) => {
    const email = normalizeEmail(request.body.email ?? "");
    const limiterKey = `${request.ip}:${email}`;
    if (!loginLimiter.consume(limiterKey)) throw new PlatformError("AUTH_RATE_LIMITED", 429, "Demasiados intentos.");
    const user = await store.findUserByEmail(email);
    if (!user || user.status !== "active" || !(await verifyPassword(user.passwordHash, request.body.password ?? ""))) {
      throw new PlatformError("AUTH_INVALID_CREDENTIALS", 401, "No fue posible autenticar la sesión.");
    }
    loginLimiter.reset(limiterKey);
    const session = await issueSession(user);
    setRefreshCookie(reply, session.refresh);
    return reply.send({
      user: { userId: user.userId, email: user.email, displayName: user.displayName, createdAt: user.createdAt, updatedAt: user.updatedAt },
      accessToken: session.access.token,
      accessTokenExpiresAt: session.access.expiresAt,
    });
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    const current = request.cookies[REFRESH_COOKIE];
    if (!current) throw new PlatformError("AUTH_REFRESH_INVALID", 401, "Refresh inválido.");
    const replacement = newOpaqueToken();
    const rotated = await store.rotateSession(tokenHash(current), tokenHash(replacement), new Date(now().getTime() + options.config.refreshTokenTtlSeconds * 1000));
    if (!rotated) throw new PlatformError("AUTH_REFRESH_INVALID", 401, "Refresh inválido.");
    if (rotated.reused) throw new PlatformError("AUTH_REFRESH_REUSE", 401, "Reuso de refresh detectado.");
    const user = await store.findUserById(rotated.userId);
    if (!user) throw new PlatformError("AUTH_REFRESH_INVALID", 401, "Refresh inválido.");
    const access = await signAccessToken({ userId: user.userId, email: user.email }, options.config.jwtSecret, options.config.accessTokenTtlSeconds);
    setRefreshCookie(reply, replacement);
    return reply.send({ accessToken: access.token, accessTokenExpiresAt: access.expiresAt });
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await authenticate(request);
    const refresh = request.cookies[REFRESH_COOKIE];
    if (refresh) await store.revokeSession(tokenHash(refresh));
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    return reply.status(204).send();
  });

  app.get("/api/v1/users/me", async (request) => {
    const identity = await authenticate(request);
    const user = await store.findUserById(identity.userId);
    if (!user) throw new PlatformError("AUTH_SESSION_INVALID", 401, "Sesión inválida.");
    return { user };
  });

  app.post<{ Body: DiagramBody }>("/api/v1/diagrams", async (request, reply) => {
    const identity = await authenticate(request);
    if (!request.body.name?.trim()) throw new PlatformError("VALIDATION_ERROR", 400, "Nombre requerido.");
    return reply.status(201).send(await store.createDiagram(identity.userId, request.body.name));
  });

  app.get("/api/v1/diagrams", async (request) => store.listDiagrams((await authenticate(request)).userId));

  app.get<{ Params: DiagramParams }>("/api/v1/diagrams/:diagramId", async (request) => {
    const diagram = await store.getDiagram((await authenticate(request)).userId, request.params.diagramId);
    if (!diagram) throw new PlatformError("DIAGRAM_NOT_FOUND", 404, "Diagrama no encontrado.");
    return diagram;
  });

  app.get<{ Params: DiagramParams }>("/api/v1/diagrams/:diagramId/members", async (request) => store.listMembers((await authenticate(request)).userId, request.params.diagramId));

  app.patch<{ Params: MemberParams; Body: RoleBody }>("/api/v1/diagrams/:diagramId/members/:userId", async (request) => {
    await store.setMemberRole((await authenticate(request)).userId, request.params.diagramId, request.params.userId, requireSharedRole(request.body.role));
    return { role: request.body.role };
  });

  app.delete<{ Params: MemberParams }>("/api/v1/diagrams/:diagramId/members/:userId", async (request, reply) => {
    await store.removeMember((await authenticate(request)).userId, request.params.diagramId, request.params.userId);
    return reply.status(204).send();
  });

  app.post<{ Params: DiagramParams; Body: InvitationBody }>("/api/v1/diagrams/:diagramId/invitations", async (request, reply) => {
    const identity = await authenticate(request);
    const email = normalizeEmail(request.body.email ?? "");
    if (!validEmail(email)) throw new PlatformError("VALIDATION_ERROR", 400, "Correo inválido.");
    const role = requireSharedRole(request.body.role);
    const expiresAt = expiration(request.body.expiresAt, now());
    const token = newOpaqueToken();
    const invitationId = await store.createInvitation({ ownerId: identity.userId, diagramId: request.params.diagramId, email, role, tokenHash: tokenHash(token), expiresAt });
    await mailer.sendInvitation({ email, token, diagramId: request.params.diagramId, role, expiresAt });
    return reply.status(201).send({ invitationId, role, expiresAt });
  });

  app.post<{ Params: TokenParams }>("/api/v1/invitations/:token/accept", async (request) => {
    const identity = await authenticate(request);
    return store.acceptInvitation(identity.userId, identity.email, tokenHash(request.params.token));
  });

  app.post<{ Params: DiagramParams; Body: ShareBody }>("/api/v1/diagrams/:diagramId/share-links", async (request, reply) => {
    const identity = await authenticate(request);
    const role = requireSharedRole(request.body.role);
    const expiresAt = expiration(request.body.expiresAt, now());
    if (request.body.maxUses !== undefined && (!Number.isInteger(request.body.maxUses) || request.body.maxUses <= 0)) throw new PlatformError("VALIDATION_ERROR", 400, "maxUses inválido.");
    const token = newOpaqueToken();
    const shareLinkId = await store.createShareLink({ ownerId: identity.userId, diagramId: request.params.diagramId, role, tokenHash: tokenHash(token), expiresAt, maxUses: request.body.maxUses });
    return reply.status(201).send({ shareLinkId, role, expiresAt, url: `/share/${token}` });
  });

  app.post<{ Params: TokenParams }>("/api/v1/share-links/:token/accept", async (request) => store.acceptShareLink((await authenticate(request)).userId, tokenHash(request.params.token)));

  app.delete<{ Params: ShareParams }>("/api/v1/diagrams/:diagramId/share-links/:linkId", async (request, reply) => {
    await store.revokeShareLink((await authenticate(request)).userId, request.params.diagramId, request.params.linkId);
    return reply.status(204).send();
  });

  return app;
}
