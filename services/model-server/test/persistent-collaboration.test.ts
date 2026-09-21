import { randomUUID } from "node:crypto";
import { createEnvelope, modelSha256, type DomainModel, type Envelope } from "collaboration-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, type Database, type SqlExecutor } from "../src/database.js";
import { PlatformStore } from "../src/platform-store.js";
import { PersistentCollaborationService } from "../src/persistent-collaboration.js";
import { createTestDatabase } from "./test-database.js";

function submit(diagramId: string, clientCommandId: string, modelVersion = "1.0.0"): Envelope {
  return createEnvelope(diagramId, diagramId, "SubmitCommand", {
    clientCommandId,
    baseSeqNumber: 0,
    command: {
      type: "CreateClass",
      commandId: clientCommandId,
      modelId: diagramId,
      modelVersion,
      payload: { id: "cls-01", name: "Producto", isAbstract: false },
    },
  });
}

function join(diagramId: string, clientId: string, lastKnownSeqNumber = 0): Envelope {
  return createEnvelope(diagramId, diagramId, "JoinSession", { clientId, authToken: "transport-authenticated", lastKnownSeqNumber });
}

describe("persistent collaboration", () => {
  let database: Database;
  let store: PlatformStore;
  let ownerId: string;
  let editorId: string;
  let viewerId: string;
  let diagramId: string;
  let ownerClient: string;
  let editorClient: string;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    store = new PlatformStore(database);
    ownerId = (await store.createUser("owner@example.com", "Owner", "hash")).userId;
    editorId = (await store.createUser("editor@example.com", "Editor", "hash")).userId;
    viewerId = (await store.createUser("viewer@example.com", "Viewer", "hash")).userId;
    diagramId = (await store.createDiagram(ownerId, "Ventas")).diagramId;
    const now = new Date();
    await database.query("INSERT INTO diagram_members(diagram_id, user_id, role, created_at, updated_at) VALUES ($1, $2, 'editor', $4, $4), ($1, $3, 'viewer', $4, $4)", [diagramId, editorId, viewerId, now]);
    ownerClient = randomUUID();
    editorClient = randomUUID();
  });

  it("persists a commit before broadcast and recovers catch-up after restart", async () => {
    const service = new PersistentCollaborationService(database);
    await service.dispatch(ownerId, ownerClient, join(diagramId, ownerClient));
    await service.dispatch(editorId, editorClient, join(diagramId, editorClient));
    const commandId = randomUUID();
    const deliveries = await service.dispatch(ownerId, ownerClient, submit(diagramId, commandId));
    expect(deliveries.map((delivery) => delivery.to).sort()).toEqual([editorClient, ownerClient].sort());
    expect(deliveries.every((delivery) => delivery.envelope.type === "CommandCommitted")).toBe(true);

    const persisted = await database.query<{ model: DomainModel; model_sha256: string }>("SELECT model, model_sha256 FROM diagrams WHERE id = $1", [diagramId]);
    expect(persisted.rows[0].model.classes[0].name).toBe("Producto");
    expect(modelSha256(persisted.rows[0].model)).toBe(persisted.rows[0].model_sha256);

    const restarted = new PersistentCollaborationService(database);
    const reconnect = await restarted.dispatch(editorId, editorClient, join(diagramId, editorClient, 0));
    expect(reconnect.some((delivery) => delivery.envelope.type === "CommandCommitted")).toBe(true);
  });

  it("deduplicates the same command after restart without advancing sequence", async () => {
    const commandId = randomUUID();
    const first = new PersistentCollaborationService(database);
    await first.dispatch(ownerId, ownerClient, join(diagramId, ownerClient));
    await first.dispatch(ownerId, ownerClient, submit(diagramId, commandId));

    const restarted = new PersistentCollaborationService(database);
    await restarted.dispatch(ownerId, ownerClient, join(diagramId, ownerClient));
    const duplicate = await restarted.dispatch(ownerId, ownerClient, submit(diagramId, commandId));
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].envelope.type).toBe("CommandCommitted");
    const sequences = await database.query<{ count: string }>("SELECT COUNT(*) AS count FROM collaboration_oplog WHERE diagram_id = $1", [diagramId]);
    expect(Number(sequences.rows[0].count)).toBe(1);
  });

  it("revalidates viewer permission before every command", async () => {
    const viewerClient = randomUUID();
    const service = new PersistentCollaborationService(database);
    await service.dispatch(viewerId, viewerClient, join(diagramId, viewerClient));
    const rejected = await service.dispatch(viewerId, viewerClient, submit(diagramId, randomUUID()));
    expect(rejected).toHaveLength(1);
    expect(rejected[0].envelope.type).toBe("CommandRejected");
    expect(JSON.stringify(rejected[0].envelope.payload)).toContain("INSUFFICIENT_PERMISSIONS");
  });

  it("does not expose a commit when persistence fails", async () => {
    const failing: Database = {
      query: database.query.bind(database),
      close: database.close.bind(database),
      transaction: <T>(operation: (executor: SqlExecutor) => Promise<T>) => database.transaction((executor) => operation({
        query: (text, values) => text.includes("INSERT INTO collaboration_oplog") ? Promise.reject(new Error("storage unavailable")) : executor.query(text, values),
      })),
    };
    const service = new PersistentCollaborationService(failing);
    await service.dispatch(ownerId, ownerClient, join(diagramId, ownerClient));
    await expect(service.dispatch(ownerId, ownerClient, submit(diagramId, randomUUID()))).rejects.toThrow("storage unavailable");
    const state = await database.query<{ model: DomainModel }>("SELECT model FROM diagrams WHERE id = $1", [diagramId]);
    expect(state.rows[0].model.classes).toHaveLength(0);
  });
});
