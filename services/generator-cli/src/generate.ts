import { canonicalize, type DomainModel } from "domain-model";
import { validate, type Diagnostic } from "domain-validator";
import type { GenerationConfig } from "./config.js";
import { validateConfig } from "./config.js";
import {
  GeneratorError,
  GeneratorErrorCode,
  type GeneratorErrorEntry,
} from "./errors.js";
import {
  assertSupportedModelContractVersion,
  canonicalJson,
  readModelDocument,
  sha256Hex,
} from "./model-io.js";
import { planClassArtifactPaths, type PlannedArtifact } from "./artifact-plan.js";
import { buildManifest } from "./manifest.js";
import { buildWritePlan } from "./write-plan.js";
import { ensureOutputDirAvailable, writePlanAtomically } from "./atomic-write.js";

export const MANIFEST_FILE_NAME = "generation-manifest.json";

export interface GenerateInput {
  /** Ruta al fichero domain-model.json (§3.1). */
  modelPath: string;
  /** Configuración cruda (§3.2); se valida dentro de la ejecución. */
  config: unknown;
}

export interface GenerateSuccess {
  outcome: "succeeded";
  outputDir: string;
  /** Rutas relativas escritas, en orden estable. */
  filesWritten: string[];
  /** Plan de rutas de las cinco capas (contenido pendiente de P2-004). */
  plannedArtifacts: PlannedArtifact[];
  /** Advertencias no bloqueantes del validador. */
  warnings: Diagnostic[];
}

export interface GenerateFailure {
  outcome: "failed";
  errors: GeneratorErrorEntry[];
}

export type GenerateResult = GenerateSuccess | GenerateFailure;

/**
 * Pipeline del núcleo del generador (P2-003):
 *
 *   lectura del modelo → contractVersion → validación del validador
 *   canónico → validación de configuración → comprobación de outputDir →
 *   planificación ordenada → escritura atómica.
 *
 * Las cinco capas (P2-004) y el descriptor Flutter (P2-005) aún no generan
 * contenido: el plan de escritura contiene únicamente el manifiesto, por lo
 * que `files` del manifiesto queda vacío hasta que esas tareas añadan sus
 * artefactos.
 */
export function generate(input: GenerateInput): GenerateResult {
  try {
    // Fase "Entrada": lectura y parseo del modelo (§9.2).
    const doc = readModelDocument(input.modelPath);

    // Fase "Validación previa": versión del contrato del modelo (§2.2) y
    // validación determinista (§3.1, invariante 2).
    assertSupportedModelContractVersion(doc);
    const validation = validate(doc);
    if (validation.errors.length > 0) {
      throw new GeneratorError(
        GeneratorErrorCode.INVALID_MODEL,
        "El modelo tiene diagnósticos de severidad ERROR; no se genera salida.",
        validation.errors,
      );
    }
    const model = canonicalize(doc as DomainModel);

    // Fase "Configuración" (§9.2).
    const config: GenerationConfig = validateConfig(input.config);
    ensureOutputDirAvailable(config.outputDir);

    // Planificación ordenada de artefactos de capa (§5.1, §6). Las rutas se
    // calculan ahora; su contenido lo añade P2-004.
    const plannedArtifacts = planClassArtifactPaths(model, config);

    // Plan de escritura ordenado y contenido atómico.
    const modelSha256 = sha256Hex(canonicalJson(model));
    const plan = buildWritePlan(
      [
        {
          relativePath: MANIFEST_FILE_NAME,
          content: () => buildManifest(model, config, modelSha256, []),
        },
      ],
      config.outputDir,
    );

    writePlanAtomically(config.outputDir, plan);

    return {
      outcome: "succeeded",
      outputDir: config.outputDir,
      filesWritten: plan.map((file) => file.relativePath),
      plannedArtifacts,
      warnings: validation.warnings,
    };
  } catch (err) {
    if (err instanceof GeneratorError) {
      return { outcome: "failed", errors: [err.toEntry()] };
    }
    return {
      outcome: "failed",
      errors: [
        {
          code: GeneratorErrorCode.INTERNAL_ERROR,
          message: `Error interno no catalogado: ${(err as Error).message}`,
        },
      ],
    };
  }
}
