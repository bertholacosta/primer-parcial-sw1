import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, type Database } from "../src/database.js";
import { buildHttpApp } from "../src/http-app.js";
import type { TextInterpretationInput, TextInterpreter } from "../src/multimodal-proposals.js";
import { createTestDatabase } from "./test-database.js";

class FakeInterpreter implements TextInterpreter {
  readonly agentRole = "fake-text/test";
  readonly calls: TextInterpretationInput[] = [];

  constructor(private readonly result: unknown) {}

  async interpret(input: TextInterpretationInput): Promise<unknown> {
    this.calls.push(input);
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

const VALID_INTERPRETATION = {
  summary: "Crear Cliente con email y relacionarlo con Venta",
  confidence: 0.9,
  commands: [
    { type: "CreateClass", name: "Cliente" },
    { type: "AddAttribute", className: "Cliente", name: "email", attributeType: "String", nullable: false, multiplicity: "1" },
    { type: "CreateClass", name: "Venta" },
    { type: "CreateAssociation", sourceClassName: "Cliente", targetClassName: "Venta", kind: "association", targetMultiplicity: "0..*" },
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

function textBody(overrides: Record<string, unknown> = {}) {
  return { textPrompt: "crea la clase cliente con email y una venta asociada", ...overrides };
}

describe("POST /api/v1/diagrams/:diagramId/proposals — modalidad text_prompt", () => {
  let database: Database;
  let app: FastifyInstance;
  let interpreter: FakeInterpreter;
  let token: string;
  let diagramId: string;

  async function build(result: unknown = VALID_INTERPRETATION, withInterpreter = true) {
    database = createTestDatabase();
    await migrate(database);
    interpreter = new FakeInterpreter(result);
    app = await buildHttpApp({
      database,
      config: TEST_CONFIG,
      ...(withInterpreter ? { textInterpreter: interpreter } : {}),
    });
    token = await loginToken(app);
    diagramId = await createDiagram(app, token);
  }

  async function rebuild(result: unknown) {
    await app.close();
    await database.close();
    await build(result);
  }

  afterEach(async () => {
    await app?.close();
    await database?.close();
  });

  it("rechaza sin autenticación (401)", async () => {
    await build();
    const response = await app.inject({ method: "POST", url: `/api/v1/diagrams/${diagramId}/proposals`, payload: textBody() });
    expect(response.statusCode).toBe(401);
  });

  it("responde 503 AI_NOT_CONFIGURED cuando no hay intérprete configurado", async () => {
    await build(VALID_INTERPRETATION, false);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: textBody(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe("AI_NOT_CONFIGURED");
  });

  it("rechaza prompt vacío (400 MEDIA_PAYLOAD_EMPTY)", async () => {
    await build();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: textBody({ textPrompt: "   " }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("MEDIA_PAYLOAD_EMPTY");
  });

  it("devuelve 422 con la aclaración del LLM cuando no hay comandos", async () => {
    await build({ clarification: "¿A qué clase te refieres?" });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: textBody(),
    });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ code: string; message: string }>();
    expect(body.code).toBe("NO_COMMANDS_GENERATED");
    expect(body.message).toContain("¿A qué clase te refieres?");
  });

  it("responde 502 cuando el intérprete falla", async () => {
    await build(new Error("boom"));
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: textBody(),
    });
    expect(response.statusCode).toBe(502);
    expect(response.json<{ code: string }>().code).toBe("INFERENCE_PROVIDER_ERROR");
  });

  it("devuelve propuesta text_prompt con comandos resueltos por nombre y dry-run VALID", async () => {
    await build();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: textBody({ clientPlatform: "case_web" }),
    });
    expect(response.statusCode).toBe(201);
    const proposal = response.json<{
      source: { modality: string; agentRole: string };
      intent: { summary: string; rawPrompt: string };
      evidences: { type: string; payload: { textTranscript?: string } }[];
      proposedCommands: { type: string; payload: Record<string, unknown> }[];
      dryRunValidation: { validationStatus: string; errors: unknown[] };
      lifecycleState: string;
    }>();

    expect(proposal.source.modality).toBe("text_prompt");
    expect(proposal.source.agentRole).toBe("fake-text/test");
    expect(proposal.intent.rawPrompt).toContain("clase cliente");
    expect(proposal.evidences.some((e) => e.type === "text_transcript" && e.payload.textTranscript?.includes("clase cliente"))).toBe(true);

    const types = proposal.proposedCommands.map((c) => c.type);
    expect(types).toEqual(["CreateClass", "AddAttribute", "CreateClass", "CreateAssociation"]);

    const assoc = proposal.proposedCommands.find((c) => c.type === "CreateAssociation")!;
    expect(assoc.payload.sourceClassId).toBe("cls-1");
    expect(assoc.payload.targetClassId).toBe("cls-2");
    expect(assoc.payload.targetMultiplicity).toBe("0..*");

    const attr = proposal.proposedCommands.find((c) => c.type === "AddAttribute")!;
    expect(attr.payload.classId).toBe("cls-1");
    expect(attr.payload.name).toBe("email");

    expect(proposal.dryRunValidation.validationStatus).toBe("VALID");
    expect(proposal.dryRunValidation.errors).toHaveLength(0);
    expect(proposal.lifecycleState).toBe("awaiting_confirmation");

    expect(interpreter.calls).toHaveLength(1);
    const snapshot = interpreter.calls[0].modelSnapshot as { classes: unknown[]; associations: unknown[] };
    expect(snapshot.classes).toEqual([]);
    expect(snapshot.associations).toEqual([]);
  });

  it("resuelve referencias a clases recién creadas tras un RenameClass en el mismo lote", async () => {
    await rebuild({
      summary: "Crear Cliente, renombrar a Persona y añadir atributo",
      commands: [
        { type: "CreateClass", name: "Cliente" },
        { type: "RenameClass", className: "Cliente", newName: "Persona" },
        { type: "AddAttribute", className: "Persona", name: "nombre", attributeType: "String" },
      ],
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: textBody(),
    });
    expect(response.statusCode).toBe(201);
    const proposal = response.json<{
      proposedCommands: { type: string; payload: Record<string, unknown> }[];
      dryRunValidation: { validationStatus: string };
    }>();
    expect(proposal.dryRunValidation.validationStatus).toBe("VALID");
    const addAttr = proposal.proposedCommands.find((c) => c.type === "AddAttribute")!;
    expect(addAttr.payload.classId).toBe("cls-1");
  });

  it("marca INVALID cuando el LLM referencia una clase inexistente", async () => {
    await rebuild({
      summary: "Añadir atributo a clase fantasma",
      commands: [{ type: "AddAttribute", className: "Fantasma", name: "x", attributeType: "String" }],
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/diagrams/${diagramId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: textBody(),
    });
    expect(response.statusCode).toBe(201);
    const proposal = response.json<{
      lifecycleState: string;
      dryRunValidation: { validationStatus: string; errors: { code: string }[] };
    }>();
    expect(proposal.lifecycleState).toBe("dry_run_validated");
    expect(proposal.dryRunValidation.validationStatus).toBe("INVALID");
    expect(proposal.dryRunValidation.errors.some((e) => e.code === "CLASS_NOT_FOUND")).toBe(true);
  });
});
