import type { Diagnostic } from "domain-validator";

/** Versión del contrato generator-input-output implementada por este generador (§2.1). */
export const GENERATOR_CONTRACT_VERSION = "1";

/**
 * Catálogo de errores del generador (contrato generator-input-output v1 §9.2).
 * Los códigos marcados como extensión cubren casos que el catálogo v1 no
 * contempla todavía; están documentados en README.md a la espera de una
 * revisión menor del contrato (§12.1 permite ampliar el catálogo).
 */
export const GeneratorErrorCode = {
  // Catálogo §9.2
  INVALID_MODEL: "INVALID_MODEL",
  UNSUPPORTED_MODEL_CONTRACT_VERSION: "UNSUPPORTED_MODEL_CONTRACT_VERSION",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  MODEL_NOT_VALID_JSON: "MODEL_NOT_VALID_JSON",
  OUTPUT_DIR_NOT_EMPTY: "OUTPUT_DIR_NOT_EMPTY",
  INVALID_BASE_PACKAGE: "INVALID_BASE_PACKAGE",
  INVALID_ARTIFACT_ID: "INVALID_ARTIFACT_ID",
  TEMPLATE_SET_NOT_FOUND: "TEMPLATE_SET_NOT_FOUND",
  NAME_COLLISION: "NAME_COLLISION",
  IO_ERROR: "IO_ERROR",
  // Catálogo del contrato flutter-descriptor v1 §8.1 (errores en generación)
  DESCRIPTOR_WRITE_ERROR: "DESCRIPTOR_WRITE_ERROR",
  DESCRIPTOR_TYPE_MAPPING_ERROR: "DESCRIPTOR_TYPE_MAPPING_ERROR",
  // Extensiones pendientes de contrato
  INVALID_CONFIG: "INVALID_CONFIG",
  INVALID_OUTPUT_PATH: "INVALID_OUTPUT_PATH",
  PATH_OUTSIDE_OUTPUT_DIR: "PATH_OUTSIDE_OUTPUT_DIR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
export type GeneratorErrorCode = (typeof GeneratorErrorCode)[keyof typeof GeneratorErrorCode];

export interface GeneratorErrorEntry {
  code: GeneratorErrorCode;
  message: string;
  diagnostics?: Diagnostic[];
}

/** Error interno del pipeline de generación; siempre mapea a un código estable. */
export class GeneratorError extends Error {
  readonly code: GeneratorErrorCode;
  readonly diagnostics?: Diagnostic[];

  constructor(code: GeneratorErrorCode, message: string, diagnostics?: Diagnostic[]) {
    super(message);
    this.name = "GeneratorError";
    this.code = code;
    this.diagnostics = diagnostics;
  }

  toEntry(): GeneratorErrorEntry {
    const entry: GeneratorErrorEntry = { code: this.code, message: this.message };
    if (this.diagnostics !== undefined) entry.diagnostics = this.diagnostics;
    return entry;
  }
}

/** Informe de error del contrato §9.3. */
export interface ErrorReport {
  generatorContractVersion: typeof GENERATOR_CONTRACT_VERSION;
  outcome: "failed";
  errors: GeneratorErrorEntry[];
}

export function toErrorReport(errors: GeneratorErrorEntry[]): ErrorReport {
  return {
    generatorContractVersion: GENERATOR_CONTRACT_VERSION,
    outcome: "failed",
    errors,
  };
}
