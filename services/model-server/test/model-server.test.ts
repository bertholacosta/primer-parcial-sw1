import { describe, expect, it } from "vitest";
import { CollaborationClient, modelSha256 } from "collaboration-protocol";
import type { DomainModel, Envelope } from "collaboration-protocol";
import { ModelServer } from "../src/index.js";

function seedModel(): DomainModel {
  return {
    contractVersion: "1",
    id: "model-01",
    name: "SistemaVentas",
    version: "1.0.0",
    packages: [],
    classes: [{ id: "cls-01", name: "Producto", attributes: [] }],
    associations: [],
  };
}

/** Cableado en proceso: clientes ↔ ModelServer.dispatch con corte de enlace simulable. */
function harness() {
  const server = new ModelServer();
  const links = new Map<string, boolean>();
  const clients = new Map<string, CollaborationClient>();

  const attach = (clientId: string, initialModel?: DomainModel, initialSeqNumber = 0) => {
    const client = new CollaborationClient({
      clientId,
      modelId: "model-01",
      authToken: `token-${clientId}`,
      initialModel,
      initialSeqNumber,
      send: (envelope: Envelope) => {
        if (links.get(clientId) !== true) return;
        for (const delivery of server.dispatch(clientId, envelope)) {
          if (links.get(delivery.to) === true) {
            clients.get(delivery.to)?.deliver(delivery.envelope);
          }
        }
      },
    });
    clients.set(clientId, client);
    links.set(clientId, true);
    return client;
  };

  return { server, clients, links, attach };
}

describe("ModelServer — sesión de dos clientes", () => {
  it("dos clientes intercambian comandos y convergen tras reconexión (catch-up)", () => {
    const { server, attach, links } = harness();
    server.registerModel(seedModel());
    const sessionId = server.openSession({ modelId: "model-01" });

    const a = attach("client-A", seedModel(), 0);
    const b = attach("client-B", seedModel(), 0);
    a.connect(sessionId);
    b.connect(sessionId);
    expect(a.state).toBe("IN_SYNC");
    expect(b.state).toBe("IN_SYNC");

    // A emite un comando; ambos lo reciben comprometido.
    a.submitCommand(a.buildCommand("CreateClass", { id: "cls-02", name: "Categoria" }));
    expect(a.localSeqNumber).toBe(1);
    expect(b.localSeqNumber).toBe(1);

    // B se desconecta; A emite otro comando; B reconecta y hace catch-up.
    links.set("client-B", false);
    b.disconnect();
    a.submitCommand(a.buildCommand("CreateClass", { id: "cls-03", name: "Orden" }));
    expect(b.localSeqNumber).toBe(1);

    links.set("client-B", true);
    b.reconnect();

    expect(b.state).toBe("IN_SYNC");
    expect(b.localSeqNumber).toBe(2);
    const sha = modelSha256(server.coordinator(sessionId)!.currentModel);
    expect(modelSha256(a.localModel!)).toBe(sha);
    expect(modelSha256(b.localModel!)).toBe(sha);
  });

  it("un mensaje a una sesión inexistente recibe SESSION_NOT_FOUND", () => {
    const { server, attach } = harness();
    server.registerModel(seedModel());
    const a = attach("client-A", seedModel(), 0);

    const deliveries = server.dispatch("client-A", {
      protocolVersion: "1.0.0",
      messageId: "m-1",
      sessionId: "sess-inexistente",
      modelId: "model-01",
      type: "JoinSession",
      timestamp: new Date().toISOString(),
      payload: { clientId: "client-A", authToken: "token-client-A", lastKnownSeqNumber: 0 },
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].to).toBe("client-A");
    expect(deliveries[0].envelope.type).toBe("SessionError");
    expect((deliveries[0].envelope.payload as { errorCode: string }).errorCode).toBe("SESSION_NOT_FOUND");
    expect(a.state).toBe("DISCONNECTED");
  });
});
