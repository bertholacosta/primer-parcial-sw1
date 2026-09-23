import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, type Database } from "../src/database.js";
import { buildHttpApp } from "../src/http-app.js";
import type { VisionExtractor, VisionImage } from "../src/multimodal-proposals.js";
import { createTestDatabase } from "./test-database.js";

class FakeExtractor implements VisionExtractor {
  readonly agentRole = "fake-vision/test";
  readonly calls: VisionImage[] = [];

  constructor(private readonly result: unknown) {}

  async extract(image: VisionImage): Promise<unknown> {
    this.calls.push(image);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const TEST_CONFIG = {
  databaseUrl: "postgres://test",
  jwtSecret: "t".repeat(32),
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 3600,
  corsOrigins: ["http://localhost:5173"],
  host: "127.0.0.1",
  port: 3000,
  secureCookies: false,
};

const VALID_EXTRACTION = {
  name: "Tienda",
  summary: "Dos clases con asociación uno a muchos",
  classes: [
    {
      name: "Factura",
      confidence: 0.95,
      boundingBox: { ymin: 0.1, xmin: 0.1, ymax: 0.4, xmax: 0.4 },
      attributes: [
        { name: "numero", type: "String", multiplicity: "1", isPk: true, confidence: 0.9 },
        { name: "fecha", type: "Date", multiplicity: "0..1", confidence: 0.85 },
      ],
    },
    { name: "DetalleFactura", confidence: 0.9 },
  ],
  associations: [
    {
      name: "detalles",
      kind: "association",
      source: "Factura",
      target: "DetalleFactura",
      sourceMultiplicity: "1",
      targetMultiplicity: "1..*",
      navigability: "unidirectional",
      confidence: 0.8,
    },
  ],
};

async function loginToken(app: FastifyInstance): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email: "ana@example.com", displayName: "Ana", password: "correct-horse-battery" },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "ana@example.com", password: "correct-horse-battery" },
  });
  return response.json<{ accessToken: string }>().accessToken;
}

async function createDiagram(app: FastifyInstance, token: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/diagrams",
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Tienda" },
  });
  return response.json<{ diagramId: string }>().diagramId;
}

function imageBody(overrides: Record<string, unknown> = {}) {
  return { imageBase64: Buffer.from("fake-png-bytes").toString("base64"), mimeType: "image/png", ...overrides };
}

describe("POST /api/v1/diagrams/:diagramId/proposals — propuesta multimodal por imagen", () => {
  let database: Database;
  let app: FastifyInstance;
  let extractor: FakeExtractor;
  let token: string;
  let diagramId: string;

  async function build(withExtractor = true) {
    database = createTestDatabase();
    await migrate(database);
    extractor = new FakeExtractor(VALID_EXTRACTION);
    app = await buildHttpApp({
      database,
      config: TEST_CONFIG,
      ...(withExtractor ? { visionExtractor: extractor } : {}),
    });
    token = await loginToken(app);
    diagramId = await createDiagram(app, token);
  }

  afterEach(async () => {
    await app?.close();
    await database?.close();
  });

  it("rechaza sin autenticación (401)", async () => {
    await build();
    const response = await app.inject({ method: "POST", url: `/api/v1/diagrams/${diagramId}/proposals`, payload: imageBody() });
    expect(response.statusCode).toBe(401);
  });

  it("responde 503 AI_NOT_CONFIGURED cuando no hay extractor configurado", async () => {
    await build(false);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: imageBody(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe("AI_NOT_CONFIGURED");
  });

  it("rechaza imagen vacía y formato no soportado (400)", async () => {
    await build();
    const empty = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: imageBody({ imageBase64: "" }),
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json<{ code: string }>().code).toBe("MEDIA_PAYLOAD_EMPTY");

    const badMime = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: imageBody({ mimeType: "image/gif" }),
    });
    expect(badMime.statusCode).toBe(400);
    expect(badMime.json<{ code: string }>().code).toBe("IMAGE_FORMAT_UNSUPPORTED");
  });

  it("responde 422 NO_COMMANDS_GENERATED si la extracción está vacía", async () => {
    await build();
    extractor = new FakeExtractor({ classes: [], associations: [] });
    // reconstruir la app con el extractor vacío
    await app.close();
    await database.close();
    database = createTestDatabase();
    await migrate(database);
    app = await buildHttpApp({ database, config: TEST_CONFIG, visionExtractor: extractor });
    token = await loginToken(app);
    diagramId = await createDiagram(app, token);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: imageBody(),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe("NO_COMMANDS_GENERATED");
  });

  it("responde 502 cuando el extractor falla", async () => {
    await build();
    await app.close();
    await database.close();
    database = createTestDatabase();
    await migrate(database);
    app = await buildHttpApp({ database, config: TEST_CONFIG, visionExtractor: new FakeExtractor(new Error("boom")) });
    token = await loginToken(app);
    diagramId = await createDiagram(app, token);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: imageBody(),
    });
    expect(response.statusCode).toBe(502);
    expect(response.json<{ code: string }>().code).toBe("INFERENCE_PROVIDER_ERROR");
  });

  it("devuelve una MultimodalProposal válida con comandos, evidencias y dry-run VALID", async () => {
    await build();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: imageBody({ clientPlatform: "case_web" }),
    });
    expect(response.statusCode).toBe(201);
    const proposal = response.json<{
      contractVersion: string;
      modelId: string;
      lifecycleState: string;
      source: { modality: string; agentRole: string };
      confidence: { overall: number; level: string };
      evidences: { type: string; mediaSha256: string }[];
      proposedCommands: { type: string; payload: Record<string, unknown> }[];
      dryRunValidation: { validationStatus: string; errors: unknown[] };
      resolution: null;
    }>();

    expect(proposal.contractVersion).toBe("1.0.0");
    expect(proposal.modelId).toBe(diagramId);
    expect(proposal.lifecycleState).toBe("awaiting_confirmation");
    expect(proposal.source.modality).toBe("image");
    expect(proposal.source.agentRole).toBe("fake-vision/test");
    expect(proposal.resolution).toBeNull();

    const types = proposal.proposedCommands.map((c) => c.type);
    expect(types).toEqual(["CreateClass", "AddAttribute", "AddAttribute", "CreateClass", "CreateAssociation"]);

    const assoc = proposal.proposedCommands.find((c) => c.type === "CreateAssociation")!;
    expect(assoc.payload.sourceClassId).toBe("cls-1");
    expect(assoc.payload.targetClassId).toBe("cls-2");
    expect(assoc.payload.targetMultiplicity).toBe("1..*");

    const pkAttr = proposal.proposedCommands.find((c) => c.type === "AddAttribute")!;
    expect(pkAttr.payload.description).toContain("[PK]");

    expect(proposal.dryRunValidation.validationStatus).toBe("VALID");
    expect(proposal.dryRunValidation.errors).toHaveLength(0);
    expect(proposal.evidences.some((e) => e.type === "bounding_box")).toBe(true);
    expect(proposal.evidences.every((e) => /^[0-9a-f]{64}$/.test(e.mediaSha256))).toBe(true);
    expect(extractor.calls).toHaveLength(1);
    expect(extractor.calls[0].mimeType).toBe("image/png");
  });

  it("marca la propuesta INVALID cuando el dry-run rechaza un comando", async () => {
    await build();
    await app.close();
    await database.close();
    database = createTestDatabase();
    await migrate(database);
    const badExtraction = {
      classes: [{ name: "Empleado", attributes: [{ name: "salario", type: "Decimal", multiplicity: "1" }] }],
      associations: [],
    };
    app = await buildHttpApp({ database, config: TEST_CONFIG, visionExtractor: new FakeExtractor(badExtraction) });
    token = await loginToken(app);
    diagramId = await createDiagram(app, token);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: imageBody(),
    });
    expect(response.statusCode).toBe(201);
    const proposal = response.json<{
      lifecycleState: string;
      dryRunValidation: { validationStatus: string; errors: { code: string; commandIndex: number }[] };
    }>();
    expect(proposal.lifecycleState).toBe("dry_run_validated");
    expect(proposal.dryRunValidation.validationStatus).toBe("INVALID");
    expect(proposal.dryRunValidation.errors.some((e) => e.code === "UNKNOWN_TYPE")).toBe(true);
  });
});
