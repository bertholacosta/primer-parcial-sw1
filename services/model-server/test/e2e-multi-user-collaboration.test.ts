import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEnvelope, modelSha256, type CommandCommittedPayload, type CommandRejectedPayload, type DomainModel, type Envelope, type SessionJoinedPayload, type SnapshotResponsePayload } from "collaboration-protocol";
import { migrate, type Database } from "../src/database.js";
import { buildHttpApp } from "../src/http-app.js";
import type { Mailer } from "../src/platform-store.js";
import { encodeStompFrame, parseStompFrame, type StompFrame } from "../src/stomp.js";
import { createTestDatabase } from "./test-database.js";

/**
 * P10-011 — Escenario extremo a extremo con el stack real: HTTP + WebSocket/STOMP
 * + persistencia. Owner invita a editor (correo) y viewer (enlace), owner y
 * editor coeditan con convergencia de hash, viewer no puede mutar, una
 * reconexión recupera solo las secuencias faltantes y un reinicio del servidor
 * conserva modelo y deduplicación.
 */

class FrameInbox {
  private readonly frames: StompFrame[] = [];
  private readonly waiters: Array<() => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      for (const raw of data.toString().split("\0").filter(Boolean)) this.frames.push(parseStompFrame(raw));
      this.waiters.splice(0).forEach((resolve) => resolve());
    });
  }

  async take(predicate: (frame: StompFrame) => boolean, timeoutMs = 4000): Promise<StompFrame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.frames.findIndex(predicate);
      if (index >= 0) return this.frames.splice(index, 1)[0];
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("frame timeout")), Math.min(100, deadline - Date.now()));
        this.waiters.push(() => { clearTimeout(timeout); resolve(); });
      }).catch(() => undefined);
    }
    throw new Error("frame timeout");
  }

  async envelope<T = unknown>(type: string): Promise<Envelope<T>> {
    const frame = await this.take((candidate) => candidate.command === "MESSAGE" && JSON.parse(candidate.body).type === type);
    return JSON.parse(frame.body) as Envelope<T>;
  }
}

interface TestUser { userId: string; token: string; clientId: string }

interface SentInvitation { email: string; token: string }

const ORIGIN = "http://localhost:5173";

async function startApp(database: Database, mailer: Mailer): Promise<{ app: FastifyInstance; address: string }> {
  const app = await buildHttpApp({
    database,
    mailer,
    config: {
      databaseUrl: "postgres://test",
      jwtSecret: "w".repeat(32),
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 3600,
      corsOrigins: [ORIGIN],
      host: "127.0.0.1",
      port: 3000,
      secureCookies: false,
    },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, address };
}

function openSocket(address: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${address.replace("http", "ws")}/collaboration`, { headers: { Origin: ORIGIN } });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function register(app: FastifyInstance, email: string): Promise<TestUser> {
  const registered = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, displayName: email, password: "correct-horse-battery" } });
  expect(registered.statusCode).toBe(201);
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "correct-horse-battery" } });
  expect(login.statusCode).toBe(200);
  return {
    userId: registered.json<{ user: { userId: string } }>().user.userId,
    token: login.json<{ accessToken: string }>().accessToken,
    clientId: randomUUID(),
  };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Abre socket, autentica STOMP, suscribe al diagrama y hace JoinSession. */
async function joinDiagram(address: string, user: TestUser, diagramId: string, lastKnownSeqNumber = 0): Promise<{ socket: WebSocket; inbox: FrameInbox; joined: SessionJoinedPayload }> {
  const socket = await openSocket(address);
  const inbox = new FrameInbox(socket);
  socket.send(encodeStompFrame("CONNECT", { authorization: `Bearer ${user.token}`, "accept-version": "1.2" }));
  await inbox.take((frame) => frame.command === "CONNECTED");
  socket.send(encodeStompFrame("SUBSCRIBE", { id: `sub-${user.clientId}`, destination: `/topic/diagrams/${diagramId}` }));
  socket.send(encodeStompFrame("SEND", { destination: `/app/diagrams/${diagramId}` }, JSON.stringify(createEnvelope(diagramId, diagramId, "JoinSession", { clientId: user.clientId, lastKnownSeqNumber }))));
  const joined = await inbox.envelope<SessionJoinedPayload>("SessionJoined");
  return { socket, inbox, joined: joined.payload };
}

function sendCommand(socket: WebSocket, diagramId: string, commandId: string, baseSeqNumber: number, command: unknown): void {
  socket.send(encodeStompFrame("SEND", { destination: `/app/diagrams/${diagramId}` }, JSON.stringify(createEnvelope(diagramId, diagramId, "SubmitCommand", { clientCommandId: commandId, baseSeqNumber, command }))));
}

describe("colaboración multiusuario extremo a extremo (P10-011)", () => {
  let database: Database;
  let app: FastifyInstance;
  let address: string;
  const invitations: SentInvitation[] = [];
  const mailer: Mailer = {
    async sendInvitation(input) {
      invitations.push({ email: input.email, token: input.token });
    },
  };

  beforeEach(async () => {
    invitations.length = 0;
    database = createTestDatabase();
    await migrate(database);
    ({ app, address } = await startApp(database, mailer));
  });

  afterEach(async () => {
    await app.close();
    await database.close();
  });

  it("owner, editor y viewer comparten, coeditan, reconectan y sobreviven al reinicio", async () => {
    const owner = await register(app, "owner@example.com");
    const editor = await register(app, "editor@example.com");
    const viewer = await register(app, "viewer@example.com");

    /* ---- Compartición: invitación por correo + enlace revocable ---- */
    const created = await app.inject({ method: "POST", url: "/api/v1/diagrams", headers: auth(owner.token), payload: { name: "Ventas" } });
    expect(created.statusCode).toBe(201);
    const diagramId = created.json<{ diagramId: string }>().diagramId;

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const invite = await app.inject({ method: "POST", url: `/api/v1/diagrams/${diagramId}/invitations`, headers: auth(owner.token), payload: { email: "editor@example.com", role: "editor", expiresAt } });
    expect(invite.statusCode).toBe(201);
    const invitation = invitations.find((i) => i.email === "editor@example.com");
    expect(invitation).toBeDefined();
    const acceptedInvite = await app.inject({ method: "POST", url: `/api/v1/invitations/${invitation!.token}/accept`, headers: auth(editor.token) });
    expect(acceptedInvite.statusCode).toBe(200);
    expect(acceptedInvite.json<{ role: string }>().role).toBe("editor");

    const share = await app.inject({ method: "POST", url: `/api/v1/diagrams/${diagramId}/share-links`, headers: auth(owner.token), payload: { role: "viewer", expiresAt } });
    expect(share.statusCode).toBe(201);
    const shareToken = share.json<{ url: string }>().url.split("/share/")[1];
    const acceptedShare = await app.inject({ method: "POST", url: `/api/v1/share-links/${shareToken}/accept`, headers: auth(viewer.token) });
    expect(acceptedShare.statusCode).toBe(200);
    expect(acceptedShare.json<{ role: string }>().role).toBe("viewer");

    /* ---- Tres clientes se unen con el rol esperado ---- */
    const ownerWs = await joinDiagram(address, owner, diagramId);
    const editorWs = await joinDiagram(address, editor, diagramId);
    const viewerWs = await joinDiagram(address, viewer, diagramId);
    expect(ownerWs.joined.assignedRole).toBe("admin");
    expect(editorWs.joined.assignedRole).toBe("editor");
    expect(viewerWs.joined.assignedRole).toBe("viewer");

    /* ---- Owner y editor coeditan; todos convergen ---- */
    const cmd1 = randomUUID();
    sendCommand(ownerWs.socket, diagramId, cmd1, 0, {
      type: "CreateClass", commandId: cmd1, modelId: diagramId, modelVersion: "1.0.0",
      payload: { id: "cls-01", name: "Producto" },
    });
    const c1Owner = (await ownerWs.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    const c1Editor = (await editorWs.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    const c1Viewer = (await viewerWs.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    expect(c1Owner.serverSeqNumber).toBe(1);
    expect(c1Owner.resultingSha256).toBe(c1Editor.resultingSha256);
    expect(c1Editor.resultingSha256).toBe(c1Viewer.resultingSha256);

    const cmd2 = randomUUID();
    sendCommand(editorWs.socket, diagramId, cmd2, 1, {
      type: "AddAttribute", commandId: cmd2, modelId: diagramId, modelVersion: c1Owner.resultingModelVersion,
      payload: { id: "attr-01", classId: "cls-01", name: "precio", type: "Double", nullable: false, multiplicity: "1" },
    });
    const c2Owner = (await ownerWs.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    const c2Editor = (await editorWs.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    const c2Viewer = (await viewerWs.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    expect(c2Owner.serverSeqNumber).toBe(2);
    expect(c2Owner.resultingSha256).toBe(c2Editor.resultingSha256);
    expect(c2Editor.resultingSha256).toBe(c2Viewer.resultingSha256);

    /* ---- Viewer observa pero no puede mutar (mensaje fabricado) ---- */
    const forged = randomUUID();
    sendCommand(viewerWs.socket, diagramId, forged, 2, {
      type: "DeleteClass", commandId: forged, modelId: diagramId, modelVersion: c2Owner.resultingModelVersion,
      payload: { classId: "cls-01" },
    });
    const rejection = (await viewerWs.inbox.envelope<CommandRejectedPayload>("CommandRejected")).payload;
    expect(rejection.errors.some((e) => e.code === "INSUFFICIENT_PERMISSIONS")).toBe(true);
    const oplogAfterForge = await database.query<{ count: string }>("SELECT COUNT(*) AS count FROM collaboration_oplog WHERE diagram_id = $1", [diagramId]);
    expect(Number(oplogAfterForge.rows[0].count)).toBe(2);

    /* ---- Reconexión con catch-up sin duplicados ---- */
    editorWs.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cmd3 = randomUUID();
    sendCommand(ownerWs.socket, diagramId, cmd3, 2, {
      type: "CreateClass", commandId: cmd3, modelId: diagramId, modelVersion: c2Owner.resultingModelVersion,
      payload: { id: "cls-02", name: "Factura" },
    });
    const c3Owner = (await ownerWs.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    expect(c3Owner.serverSeqNumber).toBe(3);

    const editorRejoin = await joinDiagram(address, editor, diagramId, 2);
    expect(editorRejoin.joined.assignedRole).toBe("editor");
    const catchup = (await editorRejoin.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    expect(catchup.serverSeqNumber).toBe(3);
    expect(catchup.resultingSha256).toBe(c3Owner.resultingSha256);
    // No llega ninguna otra secuencia repetida tras el catch-up.
    await editorRejoin.inbox.take((frame) => {
      if (frame.command !== "MESSAGE") return false;
      const env = JSON.parse(frame.body) as Envelope<CommandCommittedPayload>;
      return env.type === "CommandCommitted" && env.payload.serverSeqNumber !== 3;
    }, 250).then(
      () => { throw new Error("Se recibió una secuencia duplicada o inesperada tras la reconexión."); },
      () => undefined,
    );

    /* ---- Reinicio del servidor: modelo y deduplicación persisten ---- */
    ownerWs.socket.close();
    viewerWs.socket.close();
    editorRejoin.socket.close();
    await app.close();
    ({ app, address } = await startApp(database, mailer));

    const ownerRestart = await joinDiagram(address, owner, diagramId, 3);
    expect(ownerRestart.joined.currentSeqNumber).toBe(3);
    // Sin brecha no hay replay; el cliente pide snapshot y el hash coincide con la persistencia.
    ownerRestart.socket.send(encodeStompFrame("SEND", { destination: `/app/diagrams/${diagramId}` }, JSON.stringify(createEnvelope(diagramId, diagramId, "RequestSnapshot", { clientId: owner.clientId }))));
    const snapshot = (await ownerRestart.inbox.envelope<SnapshotResponsePayload>("SnapshotResponse")).payload;
    const persisted = await database.query<{ model: DomainModel; model_sha256: string }>("SELECT model, model_sha256 FROM diagrams WHERE id = $1", [diagramId]);
    expect(snapshot.modelSha256).toBe(persisted.rows[0].model_sha256);
    expect(modelSha256(snapshot.model)).toBe(snapshot.modelSha256);
    expect(snapshot.model.classes.map((c) => c.name)).toEqual(["Producto", "Factura"]);

    // Reenvío idéntico tras el reinicio → deduplicación persistente, mismo seq.
    sendCommand(ownerRestart.socket, diagramId, cmd1, 3, {
      type: "CreateClass", commandId: cmd1, modelId: diagramId, modelVersion: "1.0.0",
      payload: { id: "cls-01", name: "Producto" },
    });
    const dedup = (await ownerRestart.inbox.envelope<CommandCommittedPayload>("CommandCommitted")).payload;
    expect(dedup.clientCommandId).toBe(cmd1);
    expect(dedup.serverSeqNumber).toBe(1);
    const oplogFinal = await database.query<{ count: string }>("SELECT COUNT(*) AS count FROM collaboration_oplog WHERE diagram_id = $1", [diagramId]);
    expect(Number(oplogFinal.rows[0].count)).toBe(3);

    ownerRestart.socket.close();
  });
});
