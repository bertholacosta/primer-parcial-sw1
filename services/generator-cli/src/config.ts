import { readFileSync } from "node:fs";
import { GeneratorError, GeneratorErrorCode } from "./errors.js";

/**
 * Configuración de generación (contrato §3.2). Inmutable durante una ejecución.
 */
export interface GenerationConfig {
  outputDir: string;
  basePackage: string;
  artifactId: string;
  groupId: string;
  generatorVersion: string;
  templateSetId: string;
}

const JAVA_QUALIFIED_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const ARTIFACT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const REQUIRED_FIELDS = [
  "outputDir",
  "basePackage",
  "artifactId",
  "groupId",
  "generatorVersion",
  "templateSetId",
] as const;

/**
 * Lee y parsea el fichero JSON de configuración. Los errores de lectura o
 * parseo se reportan con el código de extensión INVALID_CONFIG (el catálogo
 * §9.2 no contempla todavía errores del propio fichero de configuración).
 */
export function loadConfigFile(configPath: string): unknown {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    throw new GeneratorError(
      GeneratorErrorCode.INVALID_CONFIG,
      `No se pudo leer el fichero de configuración '${configPath}'.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GeneratorError(
      GeneratorErrorCode.INVALID_CONFIG,
      `El fichero de configuración '${configPath}' no contiene JSON válido.`,
    );
  }
}

/**
 * Valida la configuración de generación contra §3.2 del contrato.
 * Devuelve una copia inmutable de los campos declarados.
 */
export function validateConfig(raw: unknown): GenerationConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new GeneratorError(
      GeneratorErrorCode.INVALID_CONFIG,
      "La configuración de generación debe ser un objeto JSON.",
    );
  }

  const doc = raw as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    const value = doc[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new GeneratorError(
        GeneratorErrorCode.INVALID_CONFIG,
        `El campo de configuración '${field}' es obligatorio y debe ser una cadena no vacía.`,
      );
    }
  }

  const config = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, doc[f]])) as unknown as GenerationConfig;

  if (!JAVA_QUALIFIED_IDENTIFIER.test(config.basePackage)) {
    throw new GeneratorError(
      GeneratorErrorCode.INVALID_BASE_PACKAGE,
      `El basePackage '${config.basePackage}' no es un identificador Java calificado válido.`,
    );
  }
  if (!JAVA_QUALIFIED_IDENTIFIER.test(config.groupId)) {
    throw new GeneratorError(
      GeneratorErrorCode.INVALID_CONFIG,
      `El groupId '${config.groupId}' no es un identificador Java calificado válido.`,
    );
  }
  if (!ARTIFACT_ID_PATTERN.test(config.artifactId)) {
    throw new GeneratorError(
      GeneratorErrorCode.INVALID_ARTIFACT_ID,
      `El artifactId '${config.artifactId}' no sigue el patrón [a-z][a-z0-9-]*.`,
    );
  }

  return Object.freeze(config);
}
