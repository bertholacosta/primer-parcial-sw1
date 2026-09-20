/**
 * Modelo canónico — contrato domain-model v1.0.0
 * (docs/contracts/domain-model-v1.md)
 *
 * Tipos y utilidades puras. Sin dependencias ni efectos laterales.
 */

export const CONTRACT_VERSION = "1";

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
  contractVersion: typeof CONTRACT_VERSION;
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
  isAbstract?: boolean;
  description?: string;
  attributes: DomainAttribute[];
}

export interface DomainAttribute {
  id: string;
  name: string;
  type: AttributeType;
  nullable: boolean;
  multiplicity: Multiplicity;
  description?: string;
}

export interface DomainAssociation {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: Multiplicity;
  targetMultiplicity: Multiplicity;
  navigability: Navigability;
  description?: string;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orden canónico §4: packages por id ASC. */
export function comparePackages(a: DomainPackage, b: DomainPackage): number {
  return compareStrings(a.id, b.id);
}

/** Orden canónico §4: classes por packageId ASC (nulos primero), luego id ASC. */
export function compareClasses(a: DomainClass, b: DomainClass): number {
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
export function compareAttributes(a: DomainAttribute, b: DomainAttribute): number {
  return compareStrings(a.id, b.id);
}

/** Orden canónico §4: associations por sourceClassId ASC, luego id ASC. */
export function compareAssociations(a: DomainAssociation, b: DomainAssociation): number {
  const bySource = compareStrings(a.sourceClassId, b.sourceClassId);
  return bySource !== 0 ? bySource : compareStrings(a.id, b.id);
}

/**
 * Devuelve una copia del modelo con todos los arrays en orden canónico (§4).
 * No muta el documento de entrada.
 */
export function canonicalize(model: DomainModel): DomainModel {
  return {
    ...model,
    packages: [...model.packages].sort(comparePackages),
    classes: model.classes
      .map((cls) => ({ ...cls, attributes: [...cls.attributes].sort(compareAttributes) }))
      .sort(compareClasses),
    associations: [...model.associations].sort(compareAssociations),
  };
}
