import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, type Database } from "../src/database.js";
import { buildHttpApp } from "../src/http-app.js";
import type { Mailer } from "../src/platform-store.js";
import { createTestDatabase } from "./test-database.js";

class FakeMailer implements Mailer {
  readonly deliveries: Array<{ email: string; token: string; diagramId: string; role: "editor" | "viewer"; expiresAt: Date }> = [];
  async sendInvitation(input: { email: string; token: string; diagramId: string; role: "editor" | "viewer"; expiresAt: Date }): Promise<void> {
    this.deliveries.push(input);
  }
}

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("missing refresh cookie");
  return value.split(";", 1)[0];
}

async function register(app: FastifyInstance, email: string, displayName: string) {
  return app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, displayName, password: "correct-horse-battery" } });
}

async function login(app: FastifyInstance, email: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "correct-horse-battery" } });
  return { response, body: response.json<{ user: { userId: string }; accessToken: string }>(), cookie: cookie(response) };
}

describe("identity and diagram access HTTP API", () => {
  let database: Database;
  let app: FastifyInstance;
  let mailer: FakeMailer;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    mailer = new FakeMailer();
    app = await buildHttpApp({
      database,
      mailer,
      config: {
        databaseUrl: "postgres://test",
        jwtSecret: "t".repeat(32),
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 3600,
        corsOrigins: ["http://localhost:5173"],
        host: "127.0.0.1",
        port: 3000,
        secureCookies: false,
      },
    });
  });

  afterEach(async () => {
    await app.close();
    await database.close();
  });

  it("registers, logs in, rotates refresh and rejects reuse", async () => {
    expect((await register(app, "ANA@example.com", "Ana")).statusCode).toBe(201);
    const session = await login(app, "ana@example.com");
    expect(session.response.statusCode).toBe(200);
    expect(session.body.accessToken).toBeTruthy();

    const refreshed = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie: session.cookie } });
    expect(refreshed.statusCode).toBe(200);
    expect(cookie(refreshed)).not.toBe(session.cookie);

    const reused = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie: session.cookie } });
    expect(reused.statusCode).toBe(401);
    expect(reused.json<{ code: string }>().code).toBe("AUTH_REFRESH_REUSE");
  });

  it("persists owner, invitation and editor membership idempotently", async () => {
    await register(app, "ana@example.com", "Ana");
    await register(app, "bruno@example.com", "Bruno");
    const ana = await login(app, "ana@example.com");
    const bruno = await login(app, "bruno@example.com");

    const created = await app.inject({ method: "POST", url: "/api/v1/diagrams", headers: { authorization: `Bearer ${ana.body.accessToken}` }, payload: { name: "Biblioteca" } });
    expect(created.statusCode).toBe(201);
    const diagram = created.json<{ diagramId: string; role: string }>();
    expect(diagram.role).toBe("owner");

    const invited = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagram.diagramId}/invitations`,
      headers: { authorization: `Bearer ${ana.body.accessToken}` },
      payload: { email: "bruno@example.com", role: "editor", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(invited.statusCode).toBe(201);
    expect(mailer.deliveries).toHaveLength(1);

    const accept = async () => app.inject({ method: "POST", url: `/api/v1/invitations/${mailer.deliveries[0].token}/accept`, headers: { authorization: `Bearer ${bruno.body.accessToken}` } });
    expect((await accept()).statusCode).toBe(200);
    expect((await accept()).statusCode).toBe(200);

    const listed = await app.inject({ method: "GET", url: "/api/v1/diagrams", headers: { authorization: `Bearer ${bruno.body.accessToken}` } });
    expect(listed.json<Array<{ role: string }>>()).toHaveLength(1);
    expect(listed.json<Array<{ role: string }>>()[0].role).toBe("editor");
  });

  it("allows one idempotent share redemption and blocks viewers from member administration", async () => {
    await register(app, "ana@example.com", "Ana");
    await register(app, "viewer@example.com", "Viewer");
    const ana = await login(app, "ana@example.com");
    const viewer = await login(app, "viewer@example.com");
    const created = await app.inject({ method: "POST", url: "/api/v1/diagrams", headers: { authorization: `Bearer ${ana.body.accessToken}` }, payload: { name: "Ventas" } });
    const diagramId = created.json<{ diagramId: string }>().diagramId;

    const link = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/share-links`,
      headers: { authorization: `Bearer ${ana.body.accessToken}` },
      payload: { role: "viewer", maxUses: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    const token = link.json<{ url: string }>().url.split("/").pop();
    expect(token).toBeTruthy();
    const redeem = async () => app.inject({ method: "POST", url: `/api/v1/share-links/${token}/accept`, headers: { authorization: `Bearer ${viewer.body.accessToken}` } });
    expect((await redeem()).statusCode).toBe(200);
    expect((await redeem()).statusCode).toBe(200);

    const forbidden = await app.inject({ method: "GET", url: `/api/v1/diagrams/${diagramId}/members`, headers: { authorization: `Bearer ${viewer.body.accessToken}` } });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<{ code: string }>().code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("rate limits repeated invalid logins and logs out idempotently", async () => {
    await register(app, "ana@example.com", "Ana");
    const session = await login(app, "ana@example.com");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "ana@example.com", password: "wrong" } });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "ana@example.com", password: "wrong" } });
    expect(limited.statusCode).toBe(429);

    const logout = async () => app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { authorization: `Bearer ${session.body.accessToken}`, cookie: session.cookie } });
    expect((await logout()).statusCode).toBe(204);
    expect((await logout()).statusCode).toBe(204);
  });
});
