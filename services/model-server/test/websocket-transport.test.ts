import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEnvelope, type Envelope } from "collaboration-protocol";
import { migrate, type Database } from "../src/database.js";
import { buildHttpApp } from "../src/http-app.js";
import { encodeStompFrame, parseStompFrame, type StompFrame } from "../src/stomp.js";
import { createTestDatabase } from "./test-database.js";

class FrameInbox {
  private readonly frames: StompFrame[] = [];
  private readonly waiters: Array<() => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      for (const raw of data.toString().split("\0").filter(Boolean)) this.frames.push(parseStompFrame(raw));
      this.waiters.splice(0).forEach((resolve) => resolve());
    });
  }

  async take(predicate: (frame: StompFrame) => boolean, timeoutMs = 3000): Promise<StompFrame> {
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

  async envelope(type: string): Promise<Envelope> {
    const frame = await this.take((candidate) => candidate.command === "MESSAGE" && JSON.parse(candidate.body).type === type);
    return JSON.parse(frame.body) as Envelope;
  }
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: "http://localhost:5173" } });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function register(app: FastifyInstance, email: string) {
  const registered = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, displayName: email, password: "correct-horse-battery" } });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "correct-horse-battery" } });
  return { userId: registered.json<{ user: { userId: string } }>().user.userId, token: login.json<{ accessToken: string }>().accessToken };
}

describe("authenticated STOMP transport", () => {
  let database: Database;
  let app: FastifyInstance;
  let address: string;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    app = await buildHttpApp({
      database,
      config: {
        databaseUrl: "postgres://test",
        jwtSecret: "w".repeat(32),
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 3600,
        corsOrigins: ["http://localhost:5173"],
        host: "127.0.0.1",
        port: 3000,
        secureCookies: false,
      },
    });
    address = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
    await database.close();
  });

  it("authenticates two clients and broadcasts a persisted commit", async () => {
    const owner = await register(app, "owner@example.com");
    const editor = await register(app, "editor@example.com");
    const created = await app.inject({ method: "POST", url: "/api/v1/diagrams", headers: { authorization: `Bearer ${owner.token}` }, payload: { name: "Ventas" } });
    const diagramId = created.json<{ diagramId: string }>().diagramId;
    const now = new Date();
    await database.query("INSERT INTO diagram_members(diagram_id, user_id, role, created_at, updated_at) VALUES ($1, $2, 'editor', $3, $3)", [diagramId, editor.userId, now]);

    const wsAddress = `${address.replace("http", "ws")}/collaboration`;
    const ownerSocket = await open(wsAddress);
    const editorSocket = await open(wsAddress);
    const ownerInbox = new FrameInbox(ownerSocket);
    const editorInbox = new FrameInbox(editorSocket);
    ownerSocket.send(encodeStompFrame("CONNECT", { authorization: `Bearer ${owner.token}`, "accept-version": "1.2" }));
    editorSocket.send(encodeStompFrame("CONNECT", { authorization: `Bearer ${editor.token}`, "accept-version": "1.2" }));
    expect((await ownerInbox.take((frame) => frame.command === "CONNECTED")).command).toBe("CONNECTED");
    expect((await editorInbox.take((frame) => frame.command === "CONNECTED")).command).toBe("CONNECTED");

    ownerSocket.send(encodeStompFrame("SUBSCRIBE", { id: "owner-sub", destination: `/topic/diagrams/${diagramId}` }));
    editorSocket.send(encodeStompFrame("SUBSCRIBE", { id: "editor-sub", destination: `/topic/diagrams/${diagramId}` }));
    const ownerClient = randomUUID();
    const editorClient = randomUUID();
    ownerSocket.send(encodeStompFrame("SEND", { destination: `/app/diagrams/${diagramId}` }, JSON.stringify(createEnvelope(diagramId, diagramId, "JoinSession", { clientId: ownerClient, lastKnownSeqNumber: 0 }))));
    editorSocket.send(encodeStompFrame("SEND", { destination: `/app/diagrams/${diagramId}` }, JSON.stringify(createEnvelope(diagramId, diagramId, "JoinSession", { clientId: editorClient, lastKnownSeqNumber: 0 }))));
    expect((await ownerInbox.envelope("SessionJoined")).type).toBe("SessionJoined");
    expect((await editorInbox.envelope("SessionJoined")).type).toBe("SessionJoined");

    const commandId = randomUUID();
    ownerSocket.send(encodeStompFrame("SEND", { destination: `/app/diagrams/${diagramId}` }, JSON.stringify(createEnvelope(diagramId, diagramId, "SubmitCommand", {
      clientCommandId: commandId,
      baseSeqNumber: 0,
      command: { type: "CreateClass", commandId, modelId: diagramId, modelVersion: "1.0.0", payload: { id: "cls-01", name: "Producto" } },
    }))));
    expect((await ownerInbox.envelope("CommandCommitted")).type).toBe("CommandCommitted");
    expect((await editorInbox.envelope("CommandCommitted")).type).toBe("CommandCommitted");
    const persisted = await database.query<{ count: string }>("SELECT COUNT(*) AS count FROM collaboration_oplog WHERE diagram_id = $1", [diagramId]);
    expect(Number(persisted.rows[0].count)).toBe(1);

    ownerSocket.close();
    editorSocket.close();
  });
});
