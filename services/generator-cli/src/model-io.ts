import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { GeneratorError, GeneratorErrorCode, GENERATOR_CONTRACT_VERSION } from "./errors.js";

/**
 * Lee el documento de modelo canónico indicado por `modelPath` (§3.1).
 */
export function readModelDocument(modelPath: string): unknown {
  let text: string;
  try {
    text = readFileSync(modelPath, "utf8");
  } catch {
    throw new GeneratorError(
      GeneratorErrorCode.MODEL_NOT_FOUND,
      `El fichero de modelo '${modelPath}' no existe o no es legible.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GeneratorError(
      GeneratorErrorCode.MODEL_NOT_VALID_JSON,
      `El fichero de modelo '${modelPath}' no puede parsearse como JSON.`,
    );
  }
}

/**
 * Rechaza documentos cuya `contractVersion` no sea compatible con este
 * generador (§2.2). Un documento sin `contractVersion` no se rechaza aquí:
 * el validador lo reporta como MISSING_REQUIRED_FIELD → INVALID_MODEL.
 */
export function assertSupportedModelContractVersion(doc: unknown): void {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return;
  const version = (doc as Record<string, unknown>).contractVersion;
  if (version !== undefined && version !== GENERATOR_CONTRACT_VERSION) {
    throw new GeneratorError(
      GeneratorErrorCode.UNSUPPORTED_MODEL_CONTRACT_VERSION,
      `La contractVersion '${String(version)}' del modelo no está soportada; este generador soporta '${GENERATOR_CONTRACT_VERSION}'.`,
    );
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Serialización JSON canónica: claves de objeto ordenadas y separadores
 * mínimos (UTF-8). Los arrays conservan el orden dado; para el modelo se
 * aplica previamente `canonicalize` (§4 de domain-model v1 y §4.2 del
 * contrato del generador), por lo que documentos canónicamente iguales
 * producen la misma cadena.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** SHA-256 hex de una cadena UTF-8 (§5.2: `modelSha256`, hashes del manifiesto). */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
