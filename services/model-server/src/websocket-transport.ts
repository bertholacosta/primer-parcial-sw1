import { randomUUID } from "node:crypto";
import websocket from "@fastify/websocket";
import { createEnvelope, type Envelope } from "collaboration-protocol";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { ModelServerConfig } from "./config.js";
import type { Database } from "./database.js";
import { PersistentCollaborationService, type PersistentDelivery } from "./persistent-collaboration.js";
import { verifyAccessToken, type AccessIdentity } from "./security.js";
import { encodeStompFrame, parseStompFrame } from "./stomp.js";

interface Connection {
  socket: WebSocket;
  identity?: AccessIdentity;
  clientId?: string;
  diagramId?: string;
  subscriptionId?: string;
}

interface RoleRow { role: string }

export async function registerCollaborationTransport(app: FastifyInstance, database: Database, config: ModelServerConfig): Promise<PersistentCollaborationService> {
  const service = new PersistentCollaborationService(database);
  const clients = new Map<string, Connection>();
  await app.register(websocket);

  const send = (connection: Connection, command: string, headers: Record<string, string>, body = "") => {
    if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(encodeStompFrame(command, headers, body));
  };

  const deliver = (delivery: PersistentDelivery) => {
    const target = clients.get(delivery.to);
    if (!target) return;
    send(target, "MESSAGE", {
      destination: `/topic/diagrams/${delivery.envelope.modelId}`,
      subscription: target.subscriptionId ?? "session",
      "message-id": delivery.envelope.messageId,
      "content-type": "application/json",
    }, JSON.stringify(delivery.envelope));
  };

  app.get("/collaboration", { websocket: true }, (socket, request) => {
    const connection: Connection = { socket };
    const origin = request.headers.origin;
    if (!origin || !config.corsOrigins.includes(origin)) {
      socket.close(1008, "origin not allowed");
      return;
    }
    let buffer = "";
    let processing = Promise.resolve();

    const fail = (message: string) => send(connection, "ERROR", { message }, JSON.stringify({ code: message }));

    const handle = async (raw: string) => {
      const frame = parseStompFrame(raw);
      if (frame.command === "CONNECT" || frame.command === "STOMP") {
        const authorization = frame.headers.authorization;
        if (!authorization?.startsWith("Bearer ")) {
          fail("AUTH_REQUIRED");
          socket.close(1008, "authentication required");
          return;
        }
        try {
          connection.identity = await verifyAccessToken(authorization.slice(7), config.jwtSecret);
          send(connection, "CONNECTED", { version: "1.2", session: randomUUID(), "heart-beat": "15000,15000" });
        } catch {
          fail("AUTH_REQUIRED");
          socket.close(1008, "authentication required");
        }
        return;
      }
      if (!connection.identity) {
        fail("AUTH_REQUIRED");
        return;
      }
      if (frame.command === "SUBSCRIBE") {
        const match = /^\/topic\/diagrams\/([0-9a-f-]+)$/i.exec(frame.headers.destination ?? "");
        if (!match) {
          fail("INVALID_DESTINATION");
          return;
        }
        const role = await database.query<RoleRow>("SELECT role FROM diagram_members WHERE diagram_id = $1 AND user_id = $2", [match[1], connection.identity.userId]);
        if (!role.rows[0]) {
          fail("INSUFFICIENT_PERMISSIONS");
          return;
        }
        connection.diagramId = match[1];
        connection.subscriptionId = frame.headers.id ?? "session";
        return;
      }
      if (frame.command === "SEND") {
        const match = /^\/app\/diagrams\/([0-9a-f-]+)$/i.exec(frame.headers.destination ?? "");
        if (!match || connection.diagramId !== match[1]) {
          fail("INVALID_DESTINATION");
          return;
        }
        let envelope: Envelope;
        try {
          envelope = JSON.parse(frame.body) as Envelope;
        } catch {
          fail("INVALID_ENVELOPE");
          return;
        }
        if (envelope.modelId !== match[1] || envelope.sessionId !== match[1]) {
          fail("SESSION_NOT_FOUND");
          return;
        }
        const payloadClientId = typeof envelope.payload === "object" && envelope.payload !== null && "clientId" in envelope.payload ? String(envelope.payload.clientId) : connection.clientId;
        if (envelope.type === "JoinSession") {
          if (!payloadClientId) {
            fail("INVALID_ENVELOPE");
            return;
          }
          if (connection.clientId && connection.clientId !== payloadClientId) {
            fail("INVALID_CLIENT_ID");
            return;
          }
          connection.clientId = payloadClientId;
          clients.set(payloadClientId, connection);
        }
        if (!connection.clientId) {
          fail("AUTH_REQUIRED");
          return;
        }
        const deliveries = await service.dispatch(connection.identity.userId, connection.clientId, envelope);
        deliveries.forEach(deliver);
        return;
      }
      if (frame.command === "DISCONNECT") socket.close(1000, "disconnect");
    };

    socket.on("message", (data) => {
      buffer += data.toString();
      const frames = buffer.split("\0");
      buffer = frames.pop() ?? "";
      for (const frame of frames) processing = processing.then(() => handle(frame)).catch(() => fail("SESSION_ERROR"));
    });

    socket.on("close", () => {
      if (connection.clientId) clients.delete(connection.clientId);
      if (connection.clientId && connection.diagramId && connection.identity) {
        const leave = createEnvelope(connection.diagramId, connection.diagramId, "LeaveSession", { clientId: connection.clientId, reason: "connection_closed" });
        void service.dispatch(connection.identity.userId, connection.clientId, leave).then((deliveries) => deliveries.forEach(deliver));
      }
    });
  });

  return service;
}
