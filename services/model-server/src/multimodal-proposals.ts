/**
 * Propuestas multimodales — contrato `docs/contracts/multimodal-proposals-v1.md`.
 *
 * Separación estricta entre inferencia probabilística y mutación determinista:
 * el extractor de visión (Gemini u Ollama local) produce una extracción cruda,
 * este módulo la traduce a comandos `model-commands-v1` y los somete a dry-run
 * con el procesador canónico (`applyCommand`). El resultado es una
 * `MultimodalProposal` auditable; nunca muta el modelo (MP-INV-1, MP-INV-2).
 */

import { createHash, randomUUID } from "node:crypto";
import { applyCommand, cloneModel } from "collaboration-protocol";
import type { AssociationKind, CreateAssociationPayload, CreateClassPayload, DomainModel, ModelCommand, UpdateAssociationPayload, UpdateAttributePayload, UpdateClassPayload } from "collaboration-protocol";
import { PlatformError } from "./errors.js";
import type { AiRecognitionConfig } from "./config.js";

/* ------------------------------------------------------------------ */
/* Tipos del contrato multimodal-proposals v1                          */
/* ------------------------------------------------------------------ */

export type ProposalLifecycleState =
  | "proposed"
  | "dry_run_validated"
  | "awaiting_confirmation"
  | "confirmed"
  | "partially_confirmed"
  | "rejected"
  | "expired";

export interface ProposalBoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface ProposalEvidence {
  evidenceId: string;
  type: "audio_segment" | "bounding_box" | "text_transcript" | "inference_rationale";
  mediaSha256: string;
  payload: {
    textTranscript?: string;
    audioTimeRange?: { startMs: number; endMs: number };
    boundingBox?: ProposalBoundingBox;
    description?: string;
  };
}

export interface ProposalDiagnostic {
  commandIndex: number;
  code: string;
  path: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

export interface MultimodalProposal {
  proposalId: string;
  contractVersion: "1.0.0";
  modelId: string;
  targetModelVersion: string;
  createdAt: string;
  lifecycleState: ProposalLifecycleState;
  source: {
    modality: "voice" | "image" | "multimodal" | "text_prompt";
    clientPlatform: string;
    agentRole: string;
    capturedAt: string;
  };
  confidence: {
    overall: number;
    level: "HIGH" | "MEDIUM" | "LOW";
    breakdown: { commandIndex: number; score: number; fieldScores: Record<string, number> }[];
  };
  evidences: ProposalEvidence[];
  intent: { summary: string; rawPrompt: string };
  proposedCommands: ModelCommand[];
  dryRunValidation: {
    validationStatus: "VALID" | "INVALID" | "WARNINGS";
    validatedAt: string;
    errors: ProposalDiagnostic[];
    warnings: ProposalDiagnostic[];
  };
  resolution: null;
}

/* ------------------------------------------------------------------ */
/* Extractores de visión (inferencia probabilística)                   */
/* ------------------------------------------------------------------ */

export interface VisionImage {
  imageBase64: string;
  mimeType: string;
}

export interface VisionExtractor {
  /** Identificador del agente para `source.agentRole` (ej. "gemini-cloud", "ollama-local/llava"). */
  readonly agentRole: string;
  /** Devuelve la extracción cruda (JSON) producida por el modelo de visión. */
  extract(image: VisionImage): Promise<unknown>;
}

const RECOGNITION_PROMPT = `Eres un extractor de diagramas UML de clases. Analiza la imagen (fotografía de pizarra, boceto o captura) y devuelve EXCLUSIVAMENTE un JSON con esta estructura:
{
  "name": "nombre del modelo",
  "summary": "descripción breve de lo detectado",
  "classes": [
    {
      "name": "NombreClase",
      "confidence": 0.0,
      "boundingBox": { "ymin": 0.0, "xmin": 0.0, "ymax": 0.0, "xmax": 0.0 },
      "attributes": [
        { "name": "nombreAtributo", "type": "String|Integer|Long|Double|Boolean|Date|DateTime|UUID", "multiplicity": "1|0..1|1..*|0..*", "nullable": false, "isPk": false, "isFk": false, "confidence": 0.0 }
      ]
    }
  ],
  "associations": [
    {
      "name": "nombreOpcional",
      "kind": "association|aggregation|composition|generalization|dependency|associationClass",
      "source": "NombreClaseOrigen",
      "target": "NombreClaseDestino",
      "sourceMultiplicity": "1|0..1|1..*|0..*",
      "targetMultiplicity": "1|0..1|1..*|0..*",
      "navigability": "unidirectional|bidirectional",
      "associationClass": "NombreClasePortadoraSoloParaAssociationClass",
      "confidence": 0.0
    }
  ]
}
Reglas:
- Los nombres deben ser identificadores válidos (letras, dígitos, guion bajo; sin espacios).
- Rombo vacío = aggregation, rombo relleno = composition, flecha hueca triangular = generalization (source=hija, target=padre), línea punteada = dependency.
- En generalization y dependency omite multiplicidades y navigability.
- boundingBox con coordenadas normalizadas [0.0, 1.0] si puedes estimarlas; omítelo si no.
- confidence entre 0.0 y 1.0 por cada elemento según legibilidad.
- Si la imagen no contiene un diagrama UML reconocible, devuelve {"classes": [], "associations": []}.
- No incluyas markdown ni texto fuera del JSON.`;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    classes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          confidence: { type: "number" },
          boundingBox: {
            type: "object",
            properties: { ymin: { type: "number" }, xmin: { type: "number" }, ymax: { type: "number" }, xmax: { type: "number" } },
          },
          attributes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                multiplicity: { type: "string" },
                nullable: { type: "boolean" },
                isPk: { type: "boolean" },
                isFk: { type: "boolean" },
                description: { type: "string" },
                confidence: { type: "number" },
              },
            },
          },
        },
      },
    },
    associations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          sourceMultiplicity: { type: "string" },
          targetMultiplicity: { type: "string" },
          navigability: { type: "string" },
          associationClass: { type: "string" },
          confidence: { type: "number" },
          boundingBox: {
            type: "object",
            properties: { ymin: { type: "number" }, xmin: { type: "number" }, ymax: { type: "number" }, xmax: { type: "number" } },
          },
        },
      },
    },
  },
} as const;

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function parseExtractionJson(text: string | undefined): unknown {
  if (!text) throw new PlatformError("INFERENCE_INVALID_RESPONSE", 502, "El modelo de visión no devolvió contenido.");
  try {
    return JSON.parse(text);
  } catch {
    throw new PlatformError("INFERENCE_INVALID_RESPONSE", 502, "La respuesta del modelo de visión no es JSON válido.");
  }
}

/** Gemini (nube): `generateContent` con imagen inline y salida JSON forzada por esquema. */
export class GeminiVisionExtractor implements VisionExtractor {
  readonly agentRole: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 20_000,
  ) {
    this.agentRole = `gemini-cloud/${model}`;
  }

  async extract(image: VisionImage): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: RECOGNITION_PROMPT }, { inlineData: { mimeType: image.mimeType, data: image.imageBase64 } }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: EXTRACTION_SCHEMA },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw new PlatformError("INFERENCE_TIMEOUT", 502, "Gemini no respondió dentro del límite de 20 s.");
      throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, "No fue posible contactar con Gemini.");
    }
    if (!response.ok) throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, `Gemini respondió con estado ${response.status}.`);
    const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
    return parseExtractionJson(text);
  }
}

/** Ollama (local): `/api/chat` con la imagen en base64 y `format: "json"`. */
export class OllamaVisionExtractor implements VisionExtractor {
  readonly agentRole: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs = 10_000,
  ) {
    this.agentRole = `ollama-local/${model}`;
  }

  async extract(image: VisionImage): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          messages: [{ role: "user", content: RECOGNITION_PROMPT, images: [image.imageBase64] }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw new PlatformError("INFERENCE_TIMEOUT", 502, "Ollama no respondió dentro del límite de 10 s.");
      throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, "No fue posible contactar con Ollama.");
    }
    if (!response.ok) throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, `Ollama respondió con estado ${response.status}.`);
    const json = (await response.json()) as { message?: { content?: string } };
    return parseExtractionJson(json.message?.content);
  }
}

export function buildVisionExtractor(ai: AiRecognitionConfig | undefined): VisionExtractor | undefined {
  if (!ai) return undefined;
  if (ai.provider === "gemini") return new GeminiVisionExtractor(ai.geminiApiKey ?? "", ai.geminiModel);
  if (ai.provider === "ollama") return new OllamaVisionExtractor(ai.ollamaBaseUrl, ai.ollamaModel);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Intérprete de texto (modalidad text_prompt, §5.3)                   */
/* ------------------------------------------------------------------ */

export interface TextInterpretationInput {
  /** Instrucción del usuario en lenguaje natural (español). */
  prompt: string;
  /** Snapshot compacto del modelo para que el LLM resuelva referencias por nombre. */
  modelSnapshot: unknown;
}

export interface TextInterpreter {
  /** Identificador del agente para `source.agentRole` (ej. "gemini-cloud/…", "ollama-local/…"). */
  readonly agentRole: string;
  /** Devuelve la interpretación cruda (JSON) producida por el LLM. */
  interpret(input: TextInterpretationInput): Promise<unknown>;
}

const TEXT_INTERPRETER_PROMPT = `Eres el intérprete de instrucciones de un editor UML de clases. El usuario describe en español cambios sobre su diagrama (puede dictarlos por voz, con frases informales o imprecisas).

Devuelve EXCLUSIVAMENTE un JSON con esta estructura:
{
  "summary": "resumen breve de lo que se va a proponer",
  "confidence": 0.0,
  "commands": [ ... ],
  "clarification": "pregunta al usuario SOLO si la instrucción es ambigua o no trata de editar el diagrama"
}

Cada comando usa referencias POR NOMBRE (nunca ids). Tipos soportados:
- {"type":"CreateClass","name":"Cliente","description?":"..."}
- {"type":"RenameClass","className":"Cliente","newName":"Persona"}
- {"type":"UpdateClass","className":"Cliente","newName?":"...","description?":"..."}
- {"type":"DeleteClass","className":"Cliente"}
- {"type":"AddAttribute","className":"Cliente","name":"email","attributeType":"String|Integer|Long|Double|Boolean|Date|DateTime|UUID","nullable?":false,"multiplicity?":"1|0..1|1..*|0..*"}
- {"type":"UpdateAttribute","className":"Cliente","attributeName":"email","newName?":"...","attributeType?":"String","nullable?":true,"multiplicity?":"0..1"}
- {"type":"DeleteAttribute","className":"Cliente","attributeName":"email"}
- {"type":"CreateAssociation","name?":"...","sourceClassName":"A","targetClassName":"B","kind?":"association|aggregation|composition|generalization|dependency|associationClass","sourceMultiplicity?":"1","targetMultiplicity?":"0..*","navigability?":"unidirectional|bidirectional","associationClassName?":"C"}
- {"type":"UpdateAssociation","associationName?":"...","sourceClassName?":"A","targetClassName?":"B","name?":"...","kind?":"...","sourceMultiplicity?":"...","targetMultiplicity?":"...","navigability?":"..."}
- {"type":"DeleteAssociation","associationName?":"...","sourceClassName?":"A","targetClassName?":"B"}

Reglas:
- Máximo 25 comandos, en orden lógico (crear una clase antes de usarla).
- Si el usuario pide una clase con atributos, emite CreateClass + un AddAttribute por cada atributo.
- Convierte nombres a identificadores válidos PascalCase/camelCase (sin espacios ni tildes).
- "opcional" → nullable true y multiplicity "0..1"; "muchos" → "0..*"; "uno a muchos" → source "1", target "0..*".
- "hereda de" / "extiende" → kind "generalization" (source = hija, target = padre).
- Solo puedes referenciar clases del modelo actual o creadas en este mismo lote; no inventes otras.
- Si hay ambigüedad real (falta la clase, falta el tipo), usa clarification en vez de adivinar.`;

const TEXT_COMMANDS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    clarification: { type: "string" },
    confidence: { type: "number" },
    commands: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          name: { type: "string" },
          className: { type: "string" },
          newName: { type: "string" },
          attributeName: { type: "string" },
          attributeType: { type: "string" },
          nullable: { type: "boolean" },
          multiplicity: { type: "string" },
          sourceClassName: { type: "string" },
          targetClassName: { type: "string" },
          kind: { type: "string" },
          sourceMultiplicity: { type: "string" },
          targetMultiplicity: { type: "string" },
          navigability: { type: "string" },
          associationName: { type: "string" },
          associationClassName: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

function textUserMessage(input: TextInterpretationInput): string {
  return `${TEXT_INTERPRETER_PROMPT}\n\nModelo actual del diagrama (JSON):\n${JSON.stringify(input.modelSnapshot)}\n\nInstrucción del usuario:\n${input.prompt}`;
}

/** Gemini (nube): `generateContent` con salida JSON forzada por esquema. */
export class GeminiTextInterpreter implements TextInterpreter {
  readonly agentRole: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 20_000,
  ) {
    this.agentRole = `gemini-cloud/${model}`;
  }

  async interpret(input: TextInterpretationInput): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: textUserMessage(input) }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: TEXT_COMMANDS_SCHEMA },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw new PlatformError("INFERENCE_TIMEOUT", 502, "Gemini no respondió dentro del límite de 20 s.");
      throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, "No fue posible contactar con Gemini.");
    }
    if (!response.ok) throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, `Gemini respondió con estado ${response.status}.`);
    const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
    return parseExtractionJson(text);
  }
}

/** Ollama (local): `/api/chat` con `format: "json"`. */
export class OllamaTextInterpreter implements TextInterpreter {
  readonly agentRole: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs = 10_000,
  ) {
    this.agentRole = `ollama-local/${model}`;
  }

  async interpret(input: TextInterpretationInput): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          messages: [{ role: "user", content: textUserMessage(input) }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw new PlatformError("INFERENCE_TIMEOUT", 502, "Ollama no respondió dentro del límite de 10 s.");
      throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, "No fue posible contactar con Ollama.");
    }
    if (!response.ok) throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, `Ollama respondió con estado ${response.status}.`);
    const json = (await response.json()) as { message?: { content?: string } };
    return parseExtractionJson(json.message?.content);
  }
}

export function buildTextInterpreter(ai: AiRecognitionConfig | undefined): TextInterpreter | undefined {
  if (!ai) return undefined;
  if (ai.provider === "gemini") return new GeminiTextInterpreter(ai.geminiApiKey ?? "", ai.geminiModel);
  if (ai.provider === "ollama") return new OllamaTextInterpreter(ai.ollamaBaseUrl, ai.ollamaModel);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Normalización determinista de la extracción                         */
/* ------------------------------------------------------------------ */

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const CONFIDENCE_THRESHOLD = 0.4;
const ASSOCIATION_KIND_SET = new Set(["association", "aggregation", "composition", "generalization", "dependency", "associationClass"]);
const NON_STRUCTURAL_KINDS = new Set(["generalization", "dependency"]);

const TYPE_ALIASES: Record<string, string> = {
  string: "String",
  int: "Integer",
  integer: "Integer",
  long: "Long",
  double: "Double",
  float: "Double",
  number: "Double",
  boolean: "Boolean",
  bool: "Boolean",
  date: "Date",
  fecha: "Date",
  datetime: "DateTime",
  timestamp: "DateTime",
  uuid: "UUID",
};

const KIND_ALIASES: Record<string, string> = {
  asociacion: "association",
  agregacion: "aggregation",
  composicion: "composition",
  generalizacion: "generalization",
  herencia: "generalization",
  dependencia: "dependency",
  claseasociacion: "associationClass",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIdentifier(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function toAttributeType(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return TYPE_ALIASES[raw.toLowerCase()] ?? (raw || "String");
}

function toMultiplicity(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["0..1", "?", "optional", "opcional"].includes(raw)) return "0..1";
  if (["1..*", "1..n", "1..many"].includes(raw)) return "1..*";
  if (["0..*", "*", "n", "many", "0..n", "muchos"].includes(raw)) return "0..*";
  return "1";
}

function toNavigability(value: unknown): "unidirectional" | "bidirectional" {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["bidirectional", "bidireccional", "both", "<->"].includes(raw) ? "bidirectional" : "unidirectional";
}

function toAssociationKind(value: unknown): AssociationKind {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_-]+/g, "") : "";
  const mapped = KIND_ALIASES[raw] ?? raw;
  return (ASSOCIATION_KIND_SET.has(mapped) ? mapped : "association") as AssociationKind;
}

function toConfidence(value: unknown, fallback = 0.75): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function toBoundingBox(value: unknown): ProposalBoundingBox | undefined {
  const box = asRecord(value);
  const coords = [box.ymin, box.xmin, box.ymax, box.xmax];
  if (!coords.every((c) => typeof c === "number" && Number.isFinite(c))) return undefined;
  const [ymin, xmin, ymax, xmax] = coords as number[];
  return { ymin, xmin, ymax, xmax };
}

interface CommandSpec {
  command: ModelCommand;
  confidence: number;
  boundingBox?: ProposalBoundingBox;
  label?: string;
}

/**
 * Traduce la extracción cruda del modelo de visión a comandos
 * `model-commands-v1` ordenados topológicamente (clases → atributos →
 * asociaciones). Las referencias por nombre se resuelven primero contra las
 * clases propuestas y luego contra las clases ya existentes en el diagrama.
 */
function extractionToCommands(extraction: Record<string, unknown>, model: DomainModel): CommandSpec[] {
  const specs: CommandSpec[] = [];
  const classIdByName = new Map<string, string>();
  let seq = 0;
  let clsSeq = 0;
  let attrSeq = 0;
  let assocSeq = 0;
  const nextCommandId = () => `cmd-prop-${++seq}`;

  for (const rawClass of asArray(extraction.classes)) {
    const cls = asRecord(rawClass);
    const name = toIdentifier(cls.name, `Clase${clsSeq + 1}`);
    const classId = `cls-${++clsSeq}`;
    classIdByName.set(name.toLowerCase(), classId);
    const rawName = typeof cls.name === "string" ? cls.name.trim().toLowerCase() : "";
    if (rawName) classIdByName.set(rawName, classId);
    const box = toBoundingBox(cls.boundingBox);
    const classConfidence = toConfidence(cls.confidence);

    specs.push({
      command: { type: "CreateClass", commandId: nextCommandId(), modelId: model.id, modelVersion: model.version, payload: { id: classId, name } },
      confidence: classConfidence,
      boundingBox: box,
      label: `Clase '${name}'`,
    });

    for (const rawAttr of asArray(cls.attributes)) {
      const attr = asRecord(rawAttr);
      const attrName = toIdentifier(attr.name, `atributo${attrSeq + 1}`);
      const multiplicity = toMultiplicity(attr.multiplicity);
      const nullable = typeof attr.nullable === "boolean" ? attr.nullable : multiplicity.startsWith("0");
      const markers = [attr.isPk === true ? "[PK]" : "", attr.isFk === true ? "[FK]" : ""].filter(Boolean).join("");
      const baseDesc = typeof attr.description === "string" ? attr.description.trim() : "";
      const description = [markers, baseDesc].filter(Boolean).join(" ") || undefined;

      specs.push({
        command: {
          type: "AddAttribute",
          commandId: nextCommandId(),
          modelId: model.id,
          modelVersion: model.version,
          payload: { id: `attr-${++attrSeq}`, classId, name: attrName, type: toAttributeType(attr.type), nullable, multiplicity, description },
        },
        confidence: toConfidence(attr.confidence, classConfidence),
        label: `Atributo '${attrName}'`,
      });
    }
  }

  const resolveClassId = (value: unknown): string => {
    const name = toIdentifier(value, "");
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    return classIdByName.get(name.toLowerCase())
      ?? classIdByName.get(raw)
      ?? model.classes.find((c) => c.name.toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === raw)?.id
      ?? name;
  };

  for (const rawAssoc of asArray(extraction.associations)) {
    const assoc = asRecord(rawAssoc);
    const kind = toAssociationKind(assoc.kind);
    const structural = !NON_STRUCTURAL_KINDS.has(kind);
    const payload: CreateAssociationPayload = {
      id: `assoc-${++assocSeq}`,
      sourceClassId: resolveClassId(assoc.source),
      targetClassId: resolveClassId(assoc.target),
      kind,
    };
    const name = typeof assoc.name === "string" ? assoc.name.trim() : "";
    if (name) payload.name = name;
    if (structural) {
      payload.sourceMultiplicity = toMultiplicity(assoc.sourceMultiplicity);
      payload.targetMultiplicity = toMultiplicity(assoc.targetMultiplicity);
      payload.navigability = toNavigability(assoc.navigability);
    }
    if (kind === "associationClass") {
      const carrier = resolveClassId(assoc.associationClass);
      if (carrier) payload.associationClassId = carrier;
    }

    specs.push({
      command: { type: "CreateAssociation", commandId: nextCommandId(), modelId: model.id, modelVersion: model.version, payload },
      confidence: toConfidence(assoc.confidence),
      boundingBox: toBoundingBox(assoc.boundingBox),
      label: `Relación '${kind}'`,
    });
  }

  return specs;
}

/* ------------------------------------------------------------------ */
/* Construcción de la propuesta (dry-run + evidencias + confianza)     */
/* ------------------------------------------------------------------ */

export interface CreateImageProposalInput {
  /** Diagrama objetivo: su modelo canónico es la base del dry-run. */
  diagram: { diagramId: string; model: DomainModel };
  /** Cuerpo de la petición: { imageBase64, mimeType, capturedAt?, clientPlatform? }. */
  body: unknown;
  extractor: VisionExtractor;
  now?: () => Date;
}

/**
 * Ejecuta el flujo completo de la modalidad `image`: valida el medio, invoca el
 * extractor, traduce a comandos, ejecuta el dry-run determinista y devuelve la
 * `MultimodalProposal` (MP-INV-1/2/4/5). Nunca muta el modelo.
 */
export async function createImageProposal(input: CreateImageProposalInput): Promise<MultimodalProposal> {
  const now = input.now ?? (() => new Date());
  const body = asRecord(input.body);

  // §7.1 — validación del medio capturado.
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
  if (!imageBase64) throw new PlatformError("MEDIA_PAYLOAD_EMPTY", 400, "La imagen está vacía.");
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw new PlatformError("IMAGE_FORMAT_UNSUPPORTED", 400, "Formato de imagen no soportado; use PNG, JPEG, WEBP o SVG.");
  }
  const bytes = Buffer.from(imageBase64, "base64");
  if (bytes.byteLength === 0) throw new PlatformError("MEDIA_PAYLOAD_EMPTY", 400, "La imagen está vacía.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new PlatformError("MEDIA_PAYLOAD_TOO_LARGE", 400, "La imagen supera el límite de 15 MB.");

  // MP-INV-5: solo el hash se conserva; los bytes crudos no se persisten.
  const mediaSha256 = createHash("sha256").update(bytes).digest("hex");

  let rawExtraction: unknown;
  try {
    rawExtraction = await input.extractor.extract({ imageBase64, mimeType });
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, "El extractor de visión falló durante la inferencia.");
  }
  const extraction = asRecord(rawExtraction);
  const specs = extractionToCommands(extraction, input.diagram.model);
  if (specs.length === 0) {
    throw new PlatformError("NO_COMMANDS_GENERATED", 422, "La IA no pudo deducir clases ni relaciones del diagrama.");
  }

  // §3.1.2 — confianza global y por comando.
  const overall = toConfidence(extraction.confidence, specs.reduce((sum, s) => sum + s.confidence, 0) / specs.length);
  if (overall < CONFIDENCE_THRESHOLD) {
    throw new PlatformError("CONFIDENCE_BELOW_THRESHOLD", 422, `La confianza global (${overall.toFixed(2)}) es inferior al umbral mínimo de 0.40.`);
  }
  const level = overall >= 0.85 ? "HIGH" : overall >= 0.6 ? "MEDIUM" : "LOW";

  // MP-INV-2 — dry-run: cada comando espera la versión resultante del anterior.
  const errors: ProposalDiagnostic[] = [];
  const warnings: ProposalDiagnostic[] = [];
  let working = cloneModel(input.diagram.model);
  specs.forEach((spec, index) => {
    spec.command.modelVersion = working.version;
    const outcome = applyCommand(working, spec.command);
    for (const error of outcome.errors) errors.push({ commandIndex: index, ...error });
    for (const warning of outcome.warnings) warnings.push({ commandIndex: index, ...warning });
    working = outcome.model;
  });
  const validationStatus = errors.length > 0 ? "INVALID" : warnings.length > 0 ? "WARNINGS" : "VALID";

  // MP-INV-4 — evidencias: bounding boxes por elemento + rationale sintético.
  const evidences: ProposalEvidence[] = specs
    .map((spec) => ({ spec }))
    .filter(({ spec }) => spec.boundingBox !== undefined)
    .map(({ spec }) => ({
      evidenceId: `ev-${randomUUID()}`,
      type: "bounding_box" as const,
      mediaSha256,
      payload: { boundingBox: spec.boundingBox, description: spec.label },
    }));
  evidences.push({
    evidenceId: `ev-${randomUUID()}`,
    type: "inference_rationale",
    mediaSha256,
    payload: { description: typeof extraction.summary === "string" ? extraction.summary : "Extracción de diagrama UML desde imagen." },
  });

  return {
    proposalId: `prop-${randomUUID()}`,
    contractVersion: "1.0.0",
    modelId: input.diagram.diagramId,
    targetModelVersion: input.diagram.model.version,
    createdAt: now().toISOString(),
    lifecycleState: errors.length > 0 ? "dry_run_validated" : "awaiting_confirmation",
    source: {
      modality: "image",
      clientPlatform: typeof body.clientPlatform === "string" ? body.clientPlatform : "case_web",
      agentRole: input.extractor.agentRole,
      capturedAt: typeof body.capturedAt === "string" ? body.capturedAt : now().toISOString(),
    },
    confidence: {
      overall,
      level,
      breakdown: specs.map((spec, index) => ({ commandIndex: index, score: spec.confidence, fieldScores: {} })),
    },
    evidences,
    intent: {
      summary: typeof extraction.summary === "string" ? extraction.summary : "Diagrama de clases detectado en la imagen.",
      rawPrompt: "Imagen de diagrama UML cargada por el usuario.",
    },
    proposedCommands: specs.map((spec) => spec.command),
    dryRunValidation: { validationStatus, validatedAt: now().toISOString(), errors, warnings },
    resolution: null,
  };
}

/* ------------------------------------------------------------------ */
/* Propuesta por prompt textual (modalidad text_prompt, §5.3)          */
/* ------------------------------------------------------------------ */

const MAX_TEXT_COMMANDS = 25;
const MAX_TEXT_PROMPT_CHARS = 4000;
const COMMAND_TYPE_SET = new Set([
  "CreateClass",
  "RenameClass",
  "UpdateClass",
  "DeleteClass",
  "AddAttribute",
  "UpdateAttribute",
  "DeleteAttribute",
  "CreateAssociation",
  "UpdateAssociation",
  "DeleteAssociation",
]);

/** Snapshot compacto enviado al LLM para que resuelva referencias por nombre. */
function snapshotOf(model: DomainModel): unknown {
  const className = (id: string) => model.classes.find((c) => c.id === id)?.name ?? id;
  return {
    classes: model.classes.map((c) => ({
      name: c.name,
      attributes: c.attributes.map((a) => ({ name: a.name, type: a.type, nullable: a.nullable, multiplicity: a.multiplicity })),
    })),
    associations: model.associations.map((a) => ({
      name: a.name,
      kind: a.kind ?? "association",
      source: className(a.sourceClassId),
      target: className(a.targetClassId),
    })),
  };
}

function keyOf(value: unknown): string {
  return toIdentifier(value, "").toLowerCase();
}

/**
 * Traduce los comandos por nombre del LLM a `model-commands-v1` concretos:
 * resuelve `className`/`attributeName`/extremos de asociación contra el modelo
 * actual (insensible a mayúsculas y tildes) y genera ids frescos para las
 * entidades nuevas. Los renombres actualizan el mapa para que referencias
 * posteriores del mismo lote sigan resolviendo.
 */
function textExtractionToSpecs(extraction: Record<string, unknown>, model: DomainModel): CommandSpec[] {
  const specs: CommandSpec[] = [];
  const classIdByName = new Map<string, string>();
  const attrIdByClass = new Map<string, Map<string, string>>();
  for (const cls of model.classes) {
    classIdByName.set(keyOf(cls.name), cls.id);
    attrIdByClass.set(cls.id, new Map(cls.attributes.map((a) => [keyOf(a.name), a.id])));
  }

  const rawCommands = asArray(extraction.commands)
    .map(asRecord)
    .filter((cmd) => COMMAND_TYPE_SET.has(String(cmd.type)))
    .slice(0, MAX_TEXT_COMMANDS);

  // Pre-registro de ids de las CreateClass para resolver referencias anticipadas.
  const createClassIds = new Map<number, string>();
  let clsSeq = 0;
  rawCommands.forEach((cmd, index) => {
    if (cmd.type !== "CreateClass") return;
    const id = `cls-${++clsSeq}`;
    createClassIds.set(index, id);
    classIdByName.set(keyOf(cmd.name), id);
  });

  let attrSeq = 0;
  let assocSeq = 0;
  let seq = 0;
  const nextCommandId = () => `cmd-text-${++seq}`;
  const resolveClassId = (raw: unknown): string => classIdByName.get(keyOf(raw)) ?? keyOf(raw) ?? "";
  const resolveAttributeId = (classId: string, raw: unknown): string =>
    attrIdByClass.get(classId)?.get(keyOf(raw)) ?? keyOf(raw) ?? "";
  const registerAttribute = (classId: string, name: string, id: string) => {
    let map = attrIdByClass.get(classId);
    if (!map) attrIdByClass.set(classId, (map = new Map()));
    map.set(keyOf(name), id);
  };
  const resolveAssociationId = (cmd: Record<string, unknown>): string => {
    const byName = keyOf(cmd.associationName ?? cmd.name);
    if (byName) {
      const found = model.associations.find((a) => a.name !== undefined && keyOf(a.name) === byName);
      if (found) return found.id;
    }
    const source = cmd.sourceClassName !== undefined ? resolveClassId(cmd.sourceClassName) : undefined;
    const target = cmd.targetClassName !== undefined ? resolveClassId(cmd.targetClassName) : undefined;
    if (source && target) {
      const found = model.associations.find(
        (a) =>
          (a.sourceClassId === source && a.targetClassId === target) ||
          (a.sourceClassId === target && a.targetClassId === source),
      );
      if (found) return found.id;
    }
    return byName || `${source ?? ""}->${target ?? ""}`;
  };

  rawCommands.forEach((cmd, index) => {
    const base = { commandId: nextCommandId(), modelId: model.id, modelVersion: model.version };
    switch (cmd.type) {
      case "CreateClass": {
        const id = createClassIds.get(index)!;
        const name = toIdentifier(cmd.name, `Clase${index + 1}`);
        classIdByName.set(keyOf(name), id);
        const payload: CreateClassPayload = { id, name };
        const description = typeof cmd.description === "string" ? cmd.description.trim() : "";
        if (description) payload.description = description;
        specs.push({ command: { ...base, type: "CreateClass", payload }, confidence: 0.8, label: `Clase '${name}'` });
        break;
      }
      case "RenameClass": {
        const classId = resolveClassId(cmd.className);
        const newName = toIdentifier(cmd.newName, "");
        if (!newName) return;
        classIdByName.set(keyOf(newName), classId);
        specs.push({ command: { ...base, type: "RenameClass", payload: { classId, newName } }, confidence: 0.8, label: `Renombrar '${keyOf(cmd.className)}'` });
        break;
      }
      case "UpdateClass": {
        const classId = resolveClassId(cmd.className);
        const payload: UpdateClassPayload = { classId };
        const newName = toIdentifier(cmd.newName ?? cmd.name, "");
        if (newName) {
          payload.name = newName;
          classIdByName.set(keyOf(newName), classId);
        }
        const description = typeof cmd.description === "string" ? cmd.description.trim() : "";
        if (description) payload.description = description;
        if (Object.keys(payload).length === 1) return;
        specs.push({ command: { ...base, type: "UpdateClass", payload }, confidence: 0.8, label: `Actualizar clase` });
        break;
      }
      case "DeleteClass": {
        specs.push({ command: { ...base, type: "DeleteClass", payload: { classId: resolveClassId(cmd.className) } }, confidence: 0.8, label: `Eliminar clase` });
        break;
      }
      case "AddAttribute": {
        const classId = resolveClassId(cmd.className);
        const name = toIdentifier(cmd.name, `atributo${attrSeq + 1}`);
        const multiplicity = toMultiplicity(cmd.multiplicity);
        const nullable = typeof cmd.nullable === "boolean" ? cmd.nullable : multiplicity.startsWith("0");
        const id = `attr-${++attrSeq}`;
        registerAttribute(classId, name, id);
        specs.push({
          command: { ...base, type: "AddAttribute", payload: { id, classId, name, type: toAttributeType(cmd.attributeType), nullable, multiplicity } },
          confidence: 0.8,
          label: `Atributo '${name}'`,
        });
        break;
      }
      case "UpdateAttribute": {
        const classId = resolveClassId(cmd.className);
        const attributeId = resolveAttributeId(classId, cmd.attributeName);
        const payload: UpdateAttributePayload = { attributeId, classId };
        const newName = toIdentifier(cmd.newName, "");
        if (newName) {
          payload.name = newName;
          registerAttribute(classId, newName, attributeId);
        }
        if (cmd.attributeType !== undefined) payload.type = toAttributeType(cmd.attributeType);
        if (typeof cmd.nullable === "boolean") payload.nullable = cmd.nullable;
        if (cmd.multiplicity !== undefined) payload.multiplicity = toMultiplicity(cmd.multiplicity);
        const description = typeof cmd.description === "string" ? cmd.description.trim() : "";
        if (description) payload.description = description;
        if (Object.keys(payload).length === 2) return;
        specs.push({ command: { ...base, type: "UpdateAttribute", payload }, confidence: 0.8, label: `Actualizar atributo` });
        break;
      }
      case "DeleteAttribute": {
        const classId = resolveClassId(cmd.className);
        specs.push({
          command: { ...base, type: "DeleteAttribute", payload: { attributeId: resolveAttributeId(classId, cmd.attributeName), classId } },
          confidence: 0.8,
          label: `Eliminar atributo`,
        });
        break;
      }
      case "CreateAssociation": {
        const kind = toAssociationKind(cmd.kind);
        const structural = !NON_STRUCTURAL_KINDS.has(kind);
        const payload: CreateAssociationPayload = {
          id: `assoc-${++assocSeq}`,
          sourceClassId: resolveClassId(cmd.sourceClassName),
          targetClassId: resolveClassId(cmd.targetClassName),
          kind,
        };
        const name = typeof cmd.name === "string" ? cmd.name.trim() : "";
        if (name) payload.name = name;
        if (structural) {
          payload.sourceMultiplicity = toMultiplicity(cmd.sourceMultiplicity);
          payload.targetMultiplicity = toMultiplicity(cmd.targetMultiplicity);
          payload.navigability = toNavigability(cmd.navigability);
        }
        if (kind === "associationClass") {
          const carrier = resolveClassId(cmd.associationClassName);
          if (carrier) payload.associationClassId = carrier;
        }
        specs.push({ command: { ...base, type: "CreateAssociation", payload }, confidence: 0.8, label: `Relación '${kind}'` });
        break;
      }
      case "UpdateAssociation": {
        const associationId = resolveAssociationId(cmd);
        const payload: UpdateAssociationPayload = { associationId };
        const name = typeof cmd.name === "string" ? cmd.name.trim() : "";
        if (name) payload.name = name;
        if (cmd.kind !== undefined) payload.kind = toAssociationKind(cmd.kind);
        if (cmd.sourceMultiplicity !== undefined) payload.sourceMultiplicity = toMultiplicity(cmd.sourceMultiplicity);
        if (cmd.targetMultiplicity !== undefined) payload.targetMultiplicity = toMultiplicity(cmd.targetMultiplicity);
        if (cmd.navigability !== undefined) payload.navigability = toNavigability(cmd.navigability);
        const description = typeof cmd.description === "string" ? cmd.description.trim() : "";
        if (description) payload.description = description;
        if (Object.keys(payload).length === 1) return;
        specs.push({ command: { ...base, type: "UpdateAssociation", payload }, confidence: 0.8, label: `Actualizar relación` });
        break;
      }
      case "DeleteAssociation": {
        specs.push({ command: { ...base, type: "DeleteAssociation", payload: { associationId: resolveAssociationId(cmd) } }, confidence: 0.8, label: `Eliminar relación` });
        break;
      }
      default:
        break;
    }
  });

  return specs;
}

export interface CreateTextProposalInput {
  /** Diagrama objetivo: su modelo canónico es la base de la resolución y el dry-run. */
  diagram: { diagramId: string; model: DomainModel };
  /** Cuerpo de la petición: { textPrompt, clientPlatform? }. */
  body: unknown;
  interpreter: TextInterpreter;
  now?: () => Date;
}

/**
 * Flujo de la modalidad `text_prompt` (§5.3): la IA interpreta la instrucción
 * en lenguaje natural, el servidor traduce a comandos y ejecuta el dry-run
 * determinista. Devuelve la propuesta para confirmación humana; nunca muta el
 * modelo (MP-INV-1/2).
 */
export async function createTextProposal(input: CreateTextProposalInput): Promise<MultimodalProposal> {
  const now = input.now ?? (() => new Date());
  const body = asRecord(input.body);

  const textPrompt = typeof body.textPrompt === "string" ? body.textPrompt.trim() : "";
  if (!textPrompt) throw new PlatformError("MEDIA_PAYLOAD_EMPTY", 400, "La instrucción de texto está vacía.");
  if (textPrompt.length > MAX_TEXT_PROMPT_CHARS) {
    throw new PlatformError("MEDIA_PAYLOAD_TOO_LARGE", 400, `La instrucción supera el límite de ${MAX_TEXT_PROMPT_CHARS} caracteres.`);
  }

  const mediaSha256 = createHash("sha256").update(textPrompt, "utf8").digest("hex");

  let rawInterpretation: unknown;
  try {
    rawInterpretation = await input.interpreter.interpret({ prompt: textPrompt, modelSnapshot: snapshotOf(input.diagram.model) });
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError("INFERENCE_PROVIDER_ERROR", 502, "El intérprete de texto falló durante la inferencia.");
  }
  const extraction = asRecord(rawInterpretation);
  const specs = textExtractionToSpecs(extraction, input.diagram.model);
  if (specs.length === 0) {
    const clarification =
      typeof extraction.clarification === "string" && extraction.clarification.trim()
        ? extraction.clarification.trim()
        : "La IA no pudo deducir comandos de la instrucción.";
    throw new PlatformError("NO_COMMANDS_GENERATED", 422, clarification);
  }

  const overall = toConfidence(extraction.confidence, 0.8);
  const level = overall >= 0.85 ? "HIGH" : overall >= 0.6 ? "MEDIUM" : "LOW";

  // MP-INV-2 — dry-run: cada comando espera la versión resultante del anterior.
  const errors: ProposalDiagnostic[] = [];
  const warnings: ProposalDiagnostic[] = [];
  let working = cloneModel(input.diagram.model);
  specs.forEach((spec, index) => {
    spec.command.modelVersion = working.version;
    const outcome = applyCommand(working, spec.command);
    for (const error of outcome.errors) errors.push({ commandIndex: index, ...error });
    for (const warning of outcome.warnings) warnings.push({ commandIndex: index, ...warning });
    working = outcome.model;
  });
  const validationStatus = errors.length > 0 ? "INVALID" : warnings.length > 0 ? "WARNINGS" : "VALID";

  const evidences: ProposalEvidence[] = [
    {
      evidenceId: `ev-${randomUUID()}`,
      type: "text_transcript",
      mediaSha256,
      payload: { textTranscript: textPrompt },
    },
    {
      evidenceId: `ev-${randomUUID()}`,
      type: "inference_rationale",
      mediaSha256,
      payload: { description: typeof extraction.summary === "string" ? extraction.summary : "Instrucción de texto interpretada por IA." },
    },
  ];

  return {
    proposalId: `prop-${randomUUID()}`,
    contractVersion: "1.0.0",
    modelId: input.diagram.diagramId,
    targetModelVersion: input.diagram.model.version,
    createdAt: now().toISOString(),
    lifecycleState: errors.length > 0 ? "dry_run_validated" : "awaiting_confirmation",
    source: {
      modality: "text_prompt",
      clientPlatform: typeof body.clientPlatform === "string" ? body.clientPlatform : "case_web",
      agentRole: input.interpreter.agentRole,
      capturedAt: now().toISOString(),
    },
    confidence: {
      overall,
      level,
      breakdown: specs.map((spec, index) => ({ commandIndex: index, score: spec.confidence, fieldScores: {} })),
    },
    evidences,
    intent: {
      summary: typeof extraction.summary === "string" ? extraction.summary : "Instrucción de texto interpretada por IA.",
      rawPrompt: textPrompt,
    },
    proposedCommands: specs.map((spec) => spec.command),
    dryRunValidation: { validationStatus, validatedAt: now().toISOString(), errors, warnings },
    resolution: null,
  };
}
