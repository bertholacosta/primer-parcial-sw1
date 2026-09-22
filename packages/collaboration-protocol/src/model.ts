/**
 * Modelo canónico en memoria para la sesión de colaboración.
 *
 * Refleja `docs/contracts/domain-model-v1.md` (contractVersion "1") de forma
 * autocontenida: el paquete no depende de `packages/domain-model` para que el
 * `npm test` del contrato de colaboración sea hermético y reproducible.
 */

import { createHash } from "node:crypto";

export const DOMAIN_CONTRACT_VERSION = "1";

export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const ATTRIBUTE_TYPES = [
  "String",
  "Integer",
  "Long",
  "Double",
  "Boolean",
  "Date",
  "DateTime",
  "UUID",
] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const MULTIPLICITIES = ["1", "0..1", "1..*", "0..*"] as const;
export type Multiplicity = (typeof MULTIPLICITIES)[number];

export const NAVIGABILITIES = ["unidirectional", "bidirectional"] as const;
export type Navigability = (typeof NAVIGABILITIES)[number];

export interface DomainModel {
  contractVersion: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  packages: DomainPackage[];
  classes: DomainClass[];
  associations: DomainAssociation[];
}

export interface DomainPackage {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
}

export interface DomainClass {
  id: string;
  name: string;
  packageId?: string;
  description?: string;
  attributes: DomainAttribute[];
}

export interface DomainAttribute {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  multiplicity: string;
  description?: string;
}

export interface DomainAssociation {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  navigability: string;
  /** Tipo UML (ADR-0009); omitido equivale a "association". */
  kind?: string;
  /** Para kind "associationClass": clase portadora de atributos. */
  associationClassId?: string;
  description?: string;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orden canónico §4 de domain-model-v1: packages por id ASC. */
function comparePackages(a: DomainPackage, b: DomainPackage): number {
  return compareStrings(a.id, b.id);
}

/** Orden canónico §4: classes por packageId ASC (nulos primero), luego id ASC. */
function compareClasses(a: DomainClass, b: DomainClass): number {
  const pa = a.packageId ?? null;
  const pb = b.packageId ?? null;
  if (pa === null && pb !== null) return -1;
  if (pa !== null && pb === null) return 1;
  if (pa !== null && pb !== null) {
    const byPackage = compareStrings(pa, pb);
    if (byPackage !== 0) return byPackage;
  }
  return compareStrings(a.id, b.id);
}

/** Orden canónico §4: attributes por id ASC. */
function compareAttributes(a: DomainAttribute, b: DomainAttribute): number {
  return compareStrings(a.id, b.id);
}

/** Orden canónico §4: associations por sourceClassId ASC, luego id ASC. */
function compareAssociations(a: DomainAssociation, b: DomainAssociation): number {
  const bySource = compareStrings(a.sourceClassId, b.sourceClassId);
  return bySource !== 0 ? bySource : compareStrings(a.id, b.id);
}

/**
 * Devuelve una copia del modelo con todos los arrays en orden canónico (§4).
 * No muta el documento de entrada.
 */
export function canonicalizeModel(model: DomainModel): DomainModel {
  return {
    ...model,
    packages: [...model.packages].sort(comparePackages),
    classes: model.classes
      .map((cls) => ({ ...cls, attributes: [...cls.attributes].sort(compareAttributes) }))
      .sort(compareClasses),
    associations: [...model.associations].sort(compareAssociations),
  };
}

/**
 * Serialización JSON canónica: claves de objeto ordenadas recursivamente y
 * separadores mínimos, conforme a §4.3 de domain-model-v1.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compareStrings(a, b));
  const body = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",");
  return `{${body}}`;
}

/**
 * Hash SHA-256 de la serialización canónica del modelo.
 * Base de `modelSha256` / `resultingSha256` (invariante I6 del contrato).
 */
export function modelSha256(model: DomainModel): string {
  return createHash("sha256")
    .update(stableStringify(canonicalizeModel(model)), "utf8")
    .digest("hex");
}

/** Hash SHA-256 del payload de un comando (para la ventana de deduplicación §5.1). */
export function commandHash(command: unknown): string {
  return createHash("sha256").update(stableStringify(command), "utf8").digest("hex");
}

/**
 * Incrementa la versión semántica en PATCH (ej. "1.0.0" -> "1.0.1"),
 * conforme a model-commands-v1 §2.2.
 */
export function incrementPatchVersion(version: string): string {
  const parts = version.split(".").map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0)) {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
  return `${version}-patch`;
}

/** Copia profunda estructural del modelo (JSON pura). */
export function cloneModel(model: DomainModel): DomainModel {
  return JSON.parse(JSON.stringify(model)) as DomainModel;
}
