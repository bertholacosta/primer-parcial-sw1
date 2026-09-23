import type { DomainClass, DomainModel } from "domain-model";
import { GeneratorError, GeneratorErrorCode } from "./errors.js";

/**
 * Reglas de nombres deterministas del contrato generator-input-output v1 §6.
 * Funciones puras: no dependen de estado externo ni del reloj.
 */

/** §6.1/§6.3 — UpperCamelCase: mayúscula inicial y tras `_` o `-`; elimina separadores. */
export function toUpperCamelCase(name: string): string {
  return name
    .split(/[_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join("");
}

/** §6.3 — lowerCamelCase para nombres de atributo Java. */
export function toLowerCamelCase(name: string): string {
  const upper = toUpperCamelCase(name);
  return upper.length === 0 ? upper : upper[0].toLowerCase() + upper.slice(1);
}

function splitWords(name: string): string[] {
  return name
    .replace(/-/g, "_")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/_+/)
    .filter((word) => word.length > 0);
}

/** §6.5 — snake_case en minúsculas para nombres de tabla y columna. */
export function toSnakeCase(name: string): string {
  return splitWords(name).join("_").toLowerCase();
}

/** kebab-case en minúsculas para rutas REST (§6.4). */
export function toKebabCase(name: string): string {
  return splitWords(name).join("-").toLowerCase();
}

/** §6.4 — ruta REST de colección a partir del `{ClassName}`: `/{kebab}s`. */
export function restPathForClassName(className: string): string {
  return `/${toKebabCase(className)}s`;
}

/**
 * §6.2 — paquete Java de una clase: el modelo tiene un único paquete raíz,
 * por lo que todas las clases viven en `{basePackage}`.
 */
export function javaPackageForClass(
  _cls: DomainClass,
  _model: DomainModel,
  basePackage: string,
): string {
  return basePackage;
}

/**
 * §6.1 — resuelve el `{ClassName}` Java de cada clase del modelo. Con un
 * único paquete raíz no hay desambiguación por paquete: cualquier colisión de
 * nombre es NAME_COLLISION (§9.2).
 */
export function resolveJavaClassNames(model: DomainModel): Map<string, string> {
  const resolved = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const cls of model.classes) {
    const className = toUpperCamelCase(cls.name);
    const first = seen.get(className);
    if (first !== undefined) {
      throw new GeneratorError(
        GeneratorErrorCode.NAME_COLLISION,
        `Las clases '${first}' y '${cls.id}' producen el mismo nombre de clase Java '${className}'.`,
      );
    }
    seen.set(className, cls.id);
    resolved.set(cls.id, className);
  }
  return resolved;
}
