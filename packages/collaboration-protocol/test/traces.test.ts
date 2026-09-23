import { describe, expect, it } from "vitest";
import { LocalCollaborationHub } from "../src/network.js";
import type { CollaborationClient } from "../src/client.js";
import type { CollaborationCoordinator } from "../src/coordinator.js";
import type { Envelope } from "../src/messages.js";
import { cloneModel, modelSha256 } from "../src/model.js";
import type { DomainModel } from "../src/model.js";

function seedModel(version: string): DomainModel {
  return {
    contractVersion: "1",
    id: "model-01",
    name: "SistemaVentas",
    version,
    classes: [{ id: "cls-01", name: "Producto", attributes: [] }],
    associations: [],
  };
}

interface Pair {
  hub: LocalCollaborationHub;
  a: CollaborationClient;
  b: CollaborationClient;
}

/**
 * Crea el escenario de las trazas normativas §9: coordinador + dos clientes
 * (A y B) en IN_SYNC con copia local del modelo en `seq`.
 */
function makePair(model: DomainModel, seq: number, hubOptions: { oplogRetention?: number } = {}): Pair {
  const hub = new LocalCollaborationHub(model, {
    sessionId: "sess-main",
    initialSeqNumber: seq,
    ...hubOptions,
  });
  const a = hub.createClient("client-A", { initialModel: cloneModel(model), initialSeqNumber: seq });
  const b = hub.createClient("client-B", { initialModel: cloneModel(model), initialSeqNumber: seq });
  hub.connect("client-A");
  hub.connect("client-B");
  return { hub, a, b };
}

function expectConverged(a: CollaborationClient, b: CollaborationClient, coordinator: CollaborationCoordinator): void {
  expect(a.state).toBe("IN_SYNC");
  expect(b.state).toBe("IN_SYNC");
  expect(a.localSeqNumber).toBe(coordinator.currentSeqNumber);
  expect(b.localSeqNumber).toBe(coordinator.currentSeqNumber);
  expect(a.localSeqNumber).toBe(b.localSeqNumber);
  const sha = modelSha256(coordinator.currentModel);
  expect(modelSha256(a.localModel!)).toBe(sha);
  expect(modelSha256(b.localModel!)).toBe(sha);
  expect(a.localModel!.version).toBe(b.localModel!.version);
}

describe("trazas normativas de dos clientes (collaboration-protocol-v1 §9)", () => {
  it("§9.1: comandos secuenciales de A y B convergen a modelos equivalentes", () => {
    const { hub, a, b } = makePair(seedModel("1.0.0"), 10);

    // Cliente A: CreateClass "Categoria" sobre modelVersion "1.0.0" (baseSeq 10).
    a.submitCommand(a.buildCommand("CreateClass", { id: "cls-02", name: "Categoria" }));
    expect(hub.coordinator.currentSeqNumber).toBe(11);
    expect(a.localModel!.version).toBe("1.0.1");
    expect(b.localModel!.version).toBe("1.0.1");

    // Cliente B: AddAttribute "precio" sobre la versión actualizada "1.0.1".
    b.submitCommand(
      b.buildCommand("AddAttribute", {
        id: "attr-01",
        classId: "cls-01",
        name: "precio",
        type: "Double",
        nullable: false,
        multiplicity: "1",
      }),
    );
    expect(hub.coordinator.currentSeqNumber).toBe(12);

    // Ambos convergen a seq=12, modelVersion "1.0.2", con Producto y Categoria.
    expectConverged(a, b, hub.coordinator);
    expect(a.localModel!.version).toBe("1.0.2");
    expect(a.localModel!.classes.map((c) => c.name).sort()).toEqual(["Categoria", "Producto"]);
    const producto = b.localModel!.classes.find((c) => c.id === "cls-01")!;
    expect(producto.attributes.map((x) => x.name)).toEqual(["precio"]);
  });

  it("§9.2: concurrencia sobre la misma versión -> CONCURRENT_MODIFICATION y convergencia", () => {
    const { hub, a, b } = makePair(seedModel("1.0.5"), 20);

    // Ambos comandos se construyen sobre modelVersion "1.0.5" (emisión simultánea).
    const cmdA = a.buildCommand("DeleteClass", { classId: "cls-01" });
    const cmdB = b.buildCommand("AddAttribute", {
      id: "attr-02",
      classId: "cls-01",
      name: "sku",
      type: "String",
      nullable: false,
      multiplicity: "1",
    });

    a.submitCommand(cmdA); // seq=21, modelVersion "1.0.6"; B aplica el commit.
    b.submitCommand(cmdB); // declara "1.0.5" != "1.0.6" -> rechazo determinista.

    expect(b.rejections).toHaveLength(1);
    expect(b.rejections[0].errors.map((e) => e.code)).toContain("CONCURRENT_MODIFICATION");
    expect(hub.coordinator.currentSeqNumber).toBe(21); // el rechazo no consume secuencia

    expectConverged(a, b, hub.coordinator);
    expect(a.localModel!.version).toBe("1.0.6");
    expect(a.localModel!.classes).toHaveLength(0); // cls-01 eliminada en ambas copias
  });

  it("§9.3: reconexión con catch-up incremental aplica las secuencias perdidas en orden", () => {
    const { hub, a, b } = makePair(seedModel("1.1.0"), 30);

    hub.disconnect("client-B"); // corte transitorio

    a.submitCommand(a.buildCommand("AddAttribute", {
      id: "attr-10", classId: "cls-01", name: "stock", type: "Integer", nullable: false, multiplicity: "1",
    }));
    a.submitCommand(a.buildCommand("AddAttribute", {
      id: "attr-11", classId: "cls-01", name: "peso", type: "Double", nullable: true, multiplicity: "0..1",
    }));
    expect(hub.coordinator.currentSeqNumber).toBe(32);
    expect(b.localSeqNumber).toBe(30); // B no recibió nada durante el corte

    hub.connect("client-B"); // JoinSession(lastKnownSeqNumber=30) -> replay 31,32
    b.acknowledge();

    expectConverged(a, b, hub.coordinator);
    expect(b.localSeqNumber).toBe(32);
    expect(b.localModel!.version).toBe("1.1.2");
    const producto = b.localModel!.classes.find((c) => c.id === "cls-01")!;
    expect(producto.attributes.map((x) => x.name).sort()).toEqual(["peso", "stock"]);
  });

  it("§9.4: reconexión con brecha profunda -> OPLOG_TRUNCATED + Snapshot Fallback", () => {
    const { hub, a, b } = makePair(seedModel("1.0.0"), 5, { oplogRetention: 2 });

    hub.disconnect("client-B");

    // Tres commits; el OpLog solo retiene las 2 últimas (seq 7 y 8).
    a.submitCommand(a.buildCommand("CreateClass", { id: "cls-02", name: "Categoria" }));
    a.submitCommand(a.buildCommand("AddAttribute", {
      id: "attr-20", classId: "cls-01", name: "precio", type: "Double", nullable: false, multiplicity: "1",
    }));
    a.submitCommand(a.buildCommand("CreateClass", { id: "cls-03", name: "Orden" }));
    expect(hub.coordinator.currentSeqNumber).toBe(8);
    expect(hub.coordinator.minAvailableSeqNumber).toBe(7);

    // B reconecta con lastKnownSeqNumber=5 < minAvailable -> snapshot.
    hub.connect("client-B");
    b.acknowledge();

    expect(b.sessionErrors.map((e) => e.errorCode)).toContain("OPLOG_TRUNCATED");
    expectConverged(a, b, hub.coordinator);
    expect(b.localSeqNumber).toBe(8);
    expect(b.localModel!.classes.map((c) => c.name).sort()).toEqual(["Categoria", "Orden", "Producto"]);
  });

  it("§9.5: reintento tras pérdida de la respuesta no duplica la mutación", () => {
    const model = seedModel("1.0.0");
    const hub = new LocalCollaborationHub(model, { sessionId: "sess-main", initialSeqNumber: 40 });
    const a = hub.createClient("client-A", { initialModel: cloneModel(model), initialSeqNumber: 40 });
    hub.connect("client-A");
    expect(a.state).toBe("IN_SYNC");

    // El commit seq=41 se aplica en el coordinador pero la respuesta se pierde.
    hub.dropNextMessageFor("client-A");
    const command = a.buildCommand("CreateClass", { id: "cls-09", name: "Orden" });
    a.submitCommand(command);
    expect(hub.coordinator.currentSeqNumber).toBe(41);
    expect(a.localSeqNumber).toBe(40); // A no recibió el commit

    // Timeout en A: reintento con idéntico clientCommandId y payload.
    a.submitCommand(command);

    // Una sola mutación, sin nuevo serverSeqNumber; A converge al recibir el commit retransmitido.
    expect(hub.coordinator.currentSeqNumber).toBe(41);
    expect(a.localSeqNumber).toBe(41);
    const ordenes = hub.coordinator.currentModel.classes.filter((c) => c.name === "Orden");
    expect(ordenes).toHaveLength(1);
    expect(modelSha256(a.localModel!)).toBe(modelSha256(hub.coordinator.currentModel));
  });
});

describe("idempotencia y deduplicación", () => {
  it("un CommandCommitted reentregado al cliente no aplica el comando dos veces (§5.2)", () => {
    const { hub, a, b } = makePair(seedModel("1.0.0"), 10);

    const delivered: Envelope[] = [];
    const original = b.deliver.bind(b);
    b.deliver = (envelope: Envelope) => {
      delivered.push(envelope);
      original(envelope);
    };

    a.submitCommand(a.buildCommand("CreateClass", { id: "cls-02", name: "Categoria" }));
    const commit = delivered.find((e) => e.type === "CommandCommitted")!;

    const shaBefore = modelSha256(b.localModel!);
    b.deliver(commit); // reenvío duplicado del mismo commit
    expect(b.localSeqNumber).toBe(11);
    expect(modelSha256(b.localModel!)).toBe(shaBefore);
    expect(b.localModel!.classes.filter((c) => c.id === "cls-02")).toHaveLength(1);

    expectConverged(a, b, hub.coordinator);
  });

  it("reuso de clientCommandId con payload divergente -> IDEMPOTENCY_PAYLOAD_MISMATCH", () => {
    const { hub, a } = makePair(seedModel("1.0.0"), 10);

    const command = a.buildCommand("CreateClass", { id: "cls-02", name: "Categoria" });
    a.submitCommand(command);
    expect(hub.coordinator.currentSeqNumber).toBe(11);

    // Mismo commandId, contenido distinto.
    a.submitCommand({
      ...a.buildCommand("CreateClass", { id: "cls-99", name: "Divergente" }),
      commandId: command.commandId,
    });

    expect(a.rejections).toHaveLength(1);
    expect(a.rejections[0].errors.map((e) => e.code)).toContain("IDEMPOTENCY_PAYLOAD_MISMATCH");
    expect(hub.coordinator.currentSeqNumber).toBe(11);
    expect(hub.coordinator.currentModel.classes.some((c) => c.id === "cls-99")).toBe(false);
  });

  it("un viewer no puede emitir SubmitCommand (INSUFFICIENT_PERMISSIONS)", () => {
    const model = seedModel("1.0.0");
    const hub = new LocalCollaborationHub(model, {
      sessionId: "sess-main",
      initialSeqNumber: 10,
      resolveRole: (clientId) => (clientId === "client-v" ? "viewer" : "editor"),
    });
    const v = hub.createClient("client-v", { initialModel: cloneModel(model), initialSeqNumber: 10 });
    hub.connect("client-v");
    expect(v.state).toBe("IN_SYNC");
    expect(v.assignedRole).toBe("viewer");

    v.submitCommand(v.buildCommand("CreateClass", { id: "cls-05", name: "Prohibida" }));

    expect(v.rejections).toHaveLength(1);
    expect(v.rejections[0].errors.map((e) => e.code)).toContain("INSUFFICIENT_PERMISSIONS");
    expect(hub.coordinator.currentSeqNumber).toBe(10);
    expect(hub.coordinator.currentModel.classes.some((c) => c.id === "cls-05")).toBe(false);
  });

  it("un cliente nuevo sin estado local converge mediante SnapshotResponse", () => {
    const { hub, a } = makePair(seedModel("1.0.0"), 10, { oplogRetention: 2 });
    a.submitCommand(a.buildCommand("CreateClass", { id: "cls-02", name: "Categoria" }));

    const c = hub.createClient("client-C"); // sin copia local, lastKnown=0
    hub.connect("client-C");

    expect(c.state).toBe("IN_SYNC");
    expect(c.localSeqNumber).toBe(hub.coordinator.currentSeqNumber);
    expect(modelSha256(c.localModel!)).toBe(modelSha256(hub.coordinator.currentModel));
  });
});
