import type { DomainAssociation, DomainAttribute, DomainClass, DomainModel, DomainPackage, Multiplicity } from "domain-model";
import type { GenerationConfig } from "./config.js";
import { GeneratorError, GeneratorErrorCode } from "./errors.js";

/** Nombre del fichero de descriptor en la raíz del outputDir (§5.3 del contrato del generador). */
export const DESCRIPTOR_FILE_NAME = "flutter-descriptor.json";

/** Versión del contrato flutter-descriptor implementada (§2.1 del contrato del descriptor). */
export const DESCRIPTOR_CONTRACT_VERSION = "1";

/** Versión del descriptor emitido por esta versión del generador (§2.2: formato MAJOR.MINOR.PATCH). */
export const DESCRIPTOR_VERSION = "1.0.0";

const SINGLE_MULTIPLICITIES: readonly Multiplicity[] = ["1", "0..1"];
const MANY_MULTIPLICITIES: readonly Multiplicity[] = ["0..*", "1..*"];

function isSingle(multiplicity: Multiplicity): boolean {
  return SINGLE_MULTIPLICITIES.includes(multiplicity);
}

function isMany(multiplicity: Multiplicity): boolean {
  return MANY_MULTIPLICITIES.includes(multiplicity);
}

/**
 * Mapeo determinista `type` + `multiplicity` → `uiType` (§4 del contrato del
 * descriptor, invariante I4). Un tipo sin mapeo produce
 * DESCRIPTOR_TYPE_MAPPING_ERROR (§8.1); en la práctica el validador canónico
 * ya rechaza esos tipos antes de la generación.
 */
export function uiTypeFor(type: string, multiplicity: Multiplicity): string {
  switch (type) {
    case "String":
      return isMany(multiplicity) ? "textList" : "textField";
    case "Integer":
    case "Long":
      return "integerField";
    case "Double":
      return "decimalField";
    case "Boolean":
      return "checkbox";
    case "Date":
      return "datePicker";
    case "DateTime":
      return "dateTimePicker";
    case "UUID":
      return "uuidField";
    default:
      throw new GeneratorError(
        GeneratorErrorCode.DESCRIPTOR_TYPE_MAPPING_ERROR,
        `El tipo de atributo '${type}' no tiene mapeo uiType definido en el contrato flutter-descriptor v1 §4.`,
      );
  }
}

/**
 * Inferencia determinista de `relationType` a partir de las multiplicidades
 * (§5.1 del contrato del descriptor, invariante I5).
 */
export function relationTypeFor(sourceMultiplicity: Multiplicity, targetMultiplicity: Multiplicity): string {
  if (isSingle(sourceMultiplicity) && isSingle(targetMultiplicity)) return "oneToOne";
  if (isMany(sourceMultiplicity) && isSingle(targetMultiplicity)) return "manyToOne";
  if (isSingle(sourceMultiplicity) && isMany(targetMultiplicity)) return "oneToMany";
  return "manyToMany";
}

/** §5.2: candidata a carga diferida si `oneToMany` o `manyToMany`. */
export function isLazyLoadable(relationType: string): boolean {
  return relationType === "oneToMany" || relationType === "manyToMany";
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function attributeDescriptor(attr: DomainAttribute) {
  return {
    id: attr.id,
    name: attr.name,
    type: attr.type,
    nullable: attr.nullable,
    multiplicity: attr.multiplicity,
    uiType: uiTypeFor(attr.type, attr.multiplicity),
    // §3.3: obligatorio en UI si nullable: false y multiplicity: "1".
    required: attr.nullable === false && attr.multiplicity === "1",
    description: attr.description ?? null,
  };
}

function classDescriptor(cls: DomainClass, packagesById: Map<string, DomainPackage>) {
  const packageName = cls.packageId === undefined ? null : (packagesById.get(cls.packageId)?.name ?? null);
  return {
    id: cls.id,
    name: cls.name,
    packageName,
    isAbstract: cls.isAbstract === true,
    description: cls.description ?? null,
    attributes: [...cls.attributes].sort((a, b) => compareStrings(a.id, b.id)).map(attributeDescriptor),
  };
}

function associationDescriptor(assoc: DomainAssociation) {
  const relationType = relationTypeFor(assoc.sourceMultiplicity, assoc.targetMultiplicity);
  return {
    id: assoc.id,
    name: assoc.name ?? null,
    sourceClassId: assoc.sourceClassId,
    targetClassId: assoc.targetClassId,
    sourceMultiplicity: assoc.sourceMultiplicity,
    targetMultiplicity: assoc.targetMultiplicity,
    navigability: assoc.navigability,
    relationType,
    isLazyLoadable: isLazyLoadable(relationType),
    description: assoc.description ?? null,
  };
}

/**
 * Construye el contenido del `flutter-descriptor.json` conforme al contrato
 * flutter-descriptor v1 a partir del modelo canónico ya normalizado.
 *
 * Orden canónico §6 del contrato del descriptor: `classes` por `id` ASC,
 * `classes[*].attributes` por `id` ASC y `associations` por `sourceClassId`
 * ASC luego `id` ASC. La serialización usa claves en el orden del contrato e
 * indentación fija de dos espacios: el contenido es byte a byte determinista
 * (invariante I3).
 */
export function buildFlutterDescriptor(
  model: DomainModel,
  config: GenerationConfig,
  modelSha256: string,
): string {
  const packagesById = new Map(model.packages.map((pkg) => [pkg.id, pkg]));

  const descriptor = {
    descriptorContractVersion: DESCRIPTOR_CONTRACT_VERSION,
    descriptorVersion: DESCRIPTOR_VERSION,
    sourceModelId: model.id,
    sourceModelVersion: model.version,
    sourceModelContractVersion: model.contractVersion,
    sourceModelSha256: modelSha256,
    generatorVersion: config.generatorVersion,
    classes: [...model.classes]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((cls) => classDescriptor(cls, packagesById)),
    associations: [...model.associations]
      .sort((a, b) => compareStrings(a.sourceClassId, b.sourceClassId) || compareStrings(a.id, b.id))
      .map(associationDescriptor),
  };

  return JSON.stringify(descriptor, null, 2) + "\n";
}
