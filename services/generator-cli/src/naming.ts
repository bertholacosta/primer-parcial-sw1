import type { DomainClass, DomainModel, DomainPackage } from "domain-model";
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

function packagesById(model: DomainModel): Map<string, DomainPackage> {
  return new Map(model.packages.map((pkg) => [pkg.id, pkg]));
}

/**
 * §6.2 — paquete Java de una clase: `{basePackage}.{pkgs...}` con los nombres
 * de paquete del modelo en orden jerárquico raíz → inmediato, en minúsculas.
 * Sin `packageId` se usa solo `{basePackage}`.
 */
export function javaPackageForClass(
  cls: DomainClass,
  model: DomainModel,
  basePackage: string,
): string {
  const byId = packagesById(model);
  const segments: string[] = [];
  let current = cls.packageId === undefined ? undefined : byId.get(cls.packageId);
  while (current !== undefined) {
    segments.unshift(current.name.toLowerCase());
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return [basePackage, ...segments].join(".");
}

function immediatePackageName(cls: DomainClass, model: DomainModel): string | undefined {
  if (cls.packageId === undefined) return undefined;
  return packagesById(model).get(cls.packageId)?.name;
}

/**
 * §6.1 — resuelve el `{ClassName}` Java de cada clase del modelo.
 * Colisiones entre clases de paquetes distintos se desambiguan anteponiendo
 * el nombre del paquete inmediato (`{PackageName}{ClassName}`); si la
 * colisión persiste se lanza NAME_COLLISION (§9.2).
 */
export function resolveJavaClassNames(model: DomainModel): Map<string, string> {
  const baseNames = new Map(model.classes.map((cls) => [cls.id, toUpperCamelCase(cls.name)]));
  const resolved = new Map<string, string>();

  const groups = new Map<string, DomainClass[]>();
  for (const cls of model.classes) {
    const base = baseNames.get(cls.id) ?? "";
    const group = groups.get(base) ?? [];
    group.push(cls);
    groups.set(base, group);
  }

  for (const [base, group] of groups) {
    for (const cls of group) {
      const packageName = group.length > 1 ? immediatePackageName(cls, model) : undefined;
      resolved.set(cls.id, packageName === undefined ? base : toUpperCamelCase(packageName) + base);
    }
  }

  const seen = new Map<string, string>();
  for (const cls of model.classes) {
    const className = resolved.get(cls.id) ?? "";
    const first = seen.get(className);
    if (first !== undefined) {
      throw new GeneratorError(
        GeneratorErrorCode.NAME_COLLISION,
        `Las clases '${first}' y '${cls.id}' producen el mismo nombre de clase Java '${className}' y la desambiguación por paquete no la resuelve.`,
      );
    }
    seen.set(className, cls.id);
  }

  return resolved;
}
