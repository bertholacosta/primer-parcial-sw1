/**
 * Procesador determinista de comandos del editor — contrato
 * `docs/contracts/model-commands-v1.md` (corte mínimo: clases, atributos,
 * asociaciones y paquetes).
 *
 * Invariantes:
 * - §2.3 / I4: si alguna precondición falla, el modelo no se modifica.
 * - §9: orden de evaluación fijo; `MODEL_NOT_FOUND` retorna de inmediato y el
 *   resto de pasos se evalúan por completo para devolver todos los errores.
 * - §2.2: todo resultado `accepted` incrementa la versión PATCH del modelo.
 */

import {
  ATTRIBUTE_TYPES,
  IDENTIFIER_PATTERN,
  MULTIPLICITIES,
  NAVIGABILITIES,
  cloneModel,
  incrementPatchVersion,
} from "./model.js";
import type { DomainModel, DomainAssociation } from "./model.js";

export interface CommandError {
  code: string;
  path: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

interface BaseCommand<TType extends string, TPayload> {
  type: TType;
  commandId: string;
  modelId: string;
  modelVersion: string;
  payload: TPayload;
}

export interface CreateClassPayload {
  id: string;
  name: string;
  packageId?: string;
  isAbstract?: boolean;
  description?: string;
}
export type CreateClassCommand = BaseCommand<"CreateClass", CreateClassPayload>;

export interface RenameClassPayload {
  classId: string;
  newName: string;
}
export type RenameClassCommand = BaseCommand<"RenameClass", RenameClassPayload>;

export interface DeleteClassPayload {
  classId: string;
}
export type DeleteClassCommand = BaseCommand<"DeleteClass", DeleteClassPayload>;

export interface AddAttributePayload {
  id: string;
  classId: string;
  name: string;
  type: string;
  nullable: boolean;
  multiplicity: string;
  description?: string;
}
export type AddAttributeCommand = BaseCommand<"AddAttribute", AddAttributePayload>;

export interface UpdateAttributePayload {
  attributeId: string;
  classId: string;
  name?: string;
  type?: string;
  nullable?: boolean;
  multiplicity?: string;
  description?: string;
}
export type UpdateAttributeCommand = BaseCommand<"UpdateAttribute", UpdateAttributePayload>;

export interface DeleteAttributePayload {
  attributeId: string;
  classId: string;
}
export type DeleteAttributeCommand = BaseCommand<"DeleteAttribute", DeleteAttributePayload>;

export const ASSOCIATION_KINDS = [
  "association",
  "aggregation",
  "composition",
  "generalization",
  "dependency",
  "associationClass",
] as const;
export type AssociationKind = (typeof ASSOCIATION_KINDS)[number];

export interface CreateAssociationPayload {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  /** Obligatorias salvo en `generalization` y `dependency` (se rellenan con "1"). */
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  /** Obligatoria salvo en `generalization` y `dependency` (se fuerza "unidirectional"). */
  navigability?: string;
  /** Tipo UML; omitido equivale a "association". */
  kind?: AssociationKind;
  /** Solo para `kind: "associationClass"`: clase que porta los atributos. */
  associationClassId?: string;
  description?: string;
}
export type CreateAssociationCommand = BaseCommand<"CreateAssociation", CreateAssociationPayload>;

export interface UpdateAssociationPayload {
  associationId: string;
  name?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  navigability?: string;
  description?: string;
}
export type UpdateAssociationCommand = BaseCommand<"UpdateAssociation", UpdateAssociationPayload>;

export interface DeleteAssociationPayload {
  associationId: string;
}
export type DeleteAssociationCommand = BaseCommand<"DeleteAssociation", DeleteAssociationPayload>;

export interface CreatePackagePayload {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
}
export type CreatePackageCommand = BaseCommand<"CreatePackage", CreatePackagePayload>;

export interface DeletePackagePayload {
  packageId: string;
}
export type DeletePackageCommand = BaseCommand<"DeletePackage", DeletePackagePayload>;

export type ModelCommand =
  | CreateClassCommand
  | RenameClassCommand
  | DeleteClassCommand
  | AddAttributeCommand
  | UpdateAttributeCommand
  | DeleteAttributeCommand
  | CreateAssociationCommand
  | UpdateAssociationCommand
  | DeleteAssociationCommand
  | CreatePackageCommand
  | DeletePackageCommand;

export interface CommandOutcome {
  commandId: string;
  result: "accepted" | "rejected" | "noop";
  /** Estado del modelo tras aplicar; idéntico al de entrada si no fue `accepted`. */
  model: DomainModel;
  /** Versión del modelo tras el comando (incremento PATCH si `accepted`). */
  modelVersion: string;
  errors: CommandError[];
  warnings: CommandError[];
}

function err(code: string, path: string, message: string): CommandError {
  return { code, path, message, severity: "ERROR" };
}

function warn(code: string, path: string, message: string): CommandError {
  return { code, path, message, severity: "WARNING" };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function isMultiplicity(value: unknown): boolean {
  return typeof value === "string" && (MULTIPLICITIES as readonly string[]).includes(value);
}

function isAttributeType(value: unknown): boolean {
  return typeof value === "string" && (ATTRIBUTE_TYPES as readonly string[]).includes(value);
}

function isNavigability(value: unknown): boolean {
  return typeof value === "string" && (NAVIGABILITIES as readonly string[]).includes(value);
}

interface CommandEvaluation {
  errors: CommandError[];
  warnings: CommandError[];
  /** `true` cuando el comando no introduce campos modificables (resultado `noop`). */
  noop: boolean;
  /** Mutación sobre una copia del modelo; solo se invoca si no hay errores y no es noop. */
  apply: (model: DomainModel) => void;
}

type CommandHandler = (model: DomainModel, command: ModelCommand) => CommandEvaluation;

const sameScope = (a?: string, b?: string) => (a ?? null) === (b ?? null);

function evaluateCreateClass(model: DomainModel, command: CreateClassCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;

  if (p.packageId !== undefined && !model.packages.some((pkg) => pkg.id === p.packageId)) {
    errors.push(
      err("PACKAGE_NOT_FOUND", "$.payload.packageId", `No existe un paquete con id '${p.packageId}' en el modelo '${model.id}'.`),
    );
  }
  if (model.classes.some((cls) => cls.id === p.id)) {
    errors.push(err("DUPLICATE_ID", "$.payload.id", `Ya existe una clase con id '${p.id}' en el documento.`));
  }
  if (model.classes.some((cls) => cls.name === p.name && sameScope(cls.packageId, p.packageId))) {
    errors.push(
      err("DUPLICATE_CLASS_NAME", "$.payload.name", `Ya existe una clase con nombre '${p.name}' en el mismo ámbito de paquete.`),
    );
  }
  if (!isIdentifier(p.name)) {
    errors.push(err("INVALID_NAME_FORMAT", "$.payload.name", `El nombre '${p.name}' no cumple el patrón [A-Za-z_][A-Za-z0-9_]*.`));
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      m.classes.push({
        id: p.id,
        name: p.name,
        packageId: p.packageId,
        isAbstract: p.isAbstract ?? false,
        description: p.description,
        attributes: [],
      });
    },
  };
}

function evaluateRenameClass(model: DomainModel, command: RenameClassCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;
  const target = model.classes.find((cls) => cls.id === p.classId);

  if (!target) {
    errors.push(err("CLASS_NOT_FOUND", "$.payload.classId", `No existe una clase con id '${p.classId}' en el modelo '${model.id}'.`));
  } else if (model.classes.some((cls) => cls.id !== p.classId && cls.name === p.newName && sameScope(cls.packageId, target.packageId))) {
    errors.push(
      err("DUPLICATE_CLASS_NAME", "$.payload.newName", `Ya existe otra clase con nombre '${p.newName}' en el mismo ámbito de paquete.`),
    );
  }
  if (!isIdentifier(p.newName)) {
    errors.push(err("INVALID_NAME_FORMAT", "$.payload.newName", `El nombre '${p.newName}' no cumple el patrón [A-Za-z_][A-Za-z0-9_]*.`));
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      const cls = m.classes.find((c) => c.id === p.classId);
      if (cls) cls.name = p.newName;
    },
  };
}

function evaluateDeleteClass(model: DomainModel, command: DeleteClassCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;

  if (!model.classes.some((cls) => cls.id === p.classId)) {
    errors.push(err("CLASS_NOT_FOUND", "$.payload.classId", `No existe una clase con id '${p.classId}' en el modelo '${model.id}'.`));
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      m.classes = m.classes.filter((cls) => cls.id !== p.classId);
      m.associations = m.associations.filter(
        (assoc) => assoc.sourceClassId !== p.classId && assoc.targetClassId !== p.classId,
      );
    },
  };
}

function multiplicityWarnings(multiplicity: string, nullable: boolean, path: string): CommandError[] {
  const warnings: CommandError[] = [];
  if (multiplicity === "1" && nullable) {
    warnings.push(warn("NULLABLE_REQUIRED_CONFLICT", path, "El atributo tiene multiplicity '1' pero nullable es true."));
  }
  if (multiplicity === "0..1" && !nullable) {
    warnings.push(warn("NOT_NULLABLE_OPTIONAL_CONFLICT", path, "El atributo tiene multiplicity '0..1' pero nullable es false."));
  }
  return warnings;
}

function evaluateAddAttribute(model: DomainModel, command: AddAttributeCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;
  const target = model.classes.find((cls) => cls.id === p.classId);

  if (!target) {
    errors.push(err("CLASS_NOT_FOUND", "$.payload.classId", `No existe una clase con id '${p.classId}' en el modelo '${model.id}'.`));
  }
  if (model.classes.some((cls) => cls.attributes.some((a) => a.id === p.id))) {
    errors.push(err("DUPLICATE_ID", "$.payload.id", `Ya existe un atributo con id '${p.id}' en el documento.`));
  }
  if (target && target.attributes.some((a) => a.name === p.name)) {
    errors.push(
      err("DUPLICATE_ATTRIBUTE_NAME", "$.payload.name", `La clase '${target.name}' ya tiene un atributo con nombre '${p.name}'.`),
    );
  }
  if (!isIdentifier(p.name)) {
    errors.push(err("INVALID_NAME_FORMAT", "$.payload.name", `El nombre '${p.name}' no cumple el patrón [A-Za-z_][A-Za-z0-9_]*.`));
  }
  if (!isAttributeType(p.type)) {
    errors.push(
      err("UNKNOWN_TYPE", "$.payload.type", `Tipo '${p.type}' no reconocido en el corte mínimo v1. Tipos permitidos: ${ATTRIBUTE_TYPES.join(", ")}.`),
    );
  }
  if (!isMultiplicity(p.multiplicity)) {
    errors.push(err("INVALID_MULTIPLICITY", "$.payload.multiplicity", `La multiplicidad '${p.multiplicity}' no es un literal permitido (${MULTIPLICITIES.join(", ")}).`));
  }

  const warnings =
    errors.length === 0 ? multiplicityWarnings(p.multiplicity, p.nullable, `$.classes[?(@.id=='${p.classId}')].attributes[?(@.id=='${p.id}')]`) : [];

  return {
    errors,
    warnings,
    noop: false,
    apply: (m) => {
      const cls = m.classes.find((c) => c.id === p.classId);
      cls?.attributes.push({
        id: p.id,
        name: p.name,
        type: p.type,
        nullable: p.nullable,
        multiplicity: p.multiplicity,
        description: p.description,
      });
    },
  };
}

const UPDATE_ATTRIBUTE_FIELDS = ["name", "type", "nullable", "multiplicity", "description"] as const;

function evaluateUpdateAttribute(model: DomainModel, command: UpdateAttributeCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;
  const target = model.classes.find((cls) => cls.id === p.classId);
  const attr = target?.attributes.find((a) => a.id === p.attributeId);

  if (!target) {
    errors.push(err("CLASS_NOT_FOUND", "$.payload.classId", `No existe una clase con id '${p.classId}' en el modelo '${model.id}'.`));
  } else if (!attr) {
    errors.push(
      err("ATTRIBUTE_NOT_FOUND", "$.payload.attributeId", `No existe un atributo con id '${p.attributeId}' en la clase '${target.name}'.`),
    );
  }

  if (p.name !== undefined) {
    if (target && target.attributes.some((a) => a.id !== p.attributeId && a.name === p.name)) {
      errors.push(
        err("DUPLICATE_ATTRIBUTE_NAME", "$.payload.name", `La clase '${target.name}' ya tiene otro atributo con nombre '${p.name}'.`),
      );
    }
    if (!isIdentifier(p.name)) {
      errors.push(err("INVALID_NAME_FORMAT", "$.payload.name", `El nombre '${p.name}' no cumple el patrón [A-Za-z_][A-Za-z0-9_]*.`));
    }
  }
  if (p.type !== undefined && !isAttributeType(p.type)) {
    errors.push(
      err("UNKNOWN_TYPE", "$.payload.type", `Tipo '${p.type}' no reconocido en el corte mínimo v1. Tipos permitidos: ${ATTRIBUTE_TYPES.join(", ")}.`),
    );
  }
  if (p.multiplicity !== undefined && !isMultiplicity(p.multiplicity)) {
    errors.push(err("INVALID_MULTIPLICITY", "$.payload.multiplicity", `La multiplicidad '${p.multiplicity}' no es un literal permitido (${MULTIPLICITIES.join(", ")}).`));
  }

  const noop = UPDATE_ATTRIBUTE_FIELDS.every((field) => p[field] === undefined);

  const warnings: CommandError[] = [];
  if (errors.length === 0 && !noop && attr) {
    const resultingMultiplicity = p.multiplicity ?? attr.multiplicity;
    const resultingNullable = p.nullable ?? attr.nullable;
    warnings.push(
      ...multiplicityWarnings(
        resultingMultiplicity,
        resultingNullable,
        `$.classes[?(@.id=='${p.classId}')].attributes[?(@.id=='${p.attributeId}')]`,
      ),
    );
  }

  return {
    errors,
    warnings,
    noop,
    apply: (m) => {
      const targetAttr = m.classes.find((c) => c.id === p.classId)?.attributes.find((a) => a.id === p.attributeId);
      if (!targetAttr) return;
      if (p.name !== undefined) targetAttr.name = p.name;
      if (p.type !== undefined) targetAttr.type = p.type;
      if (p.nullable !== undefined) targetAttr.nullable = p.nullable;
      if (p.multiplicity !== undefined) targetAttr.multiplicity = p.multiplicity;
      if (p.description !== undefined) targetAttr.description = p.description;
    },
  };
}

function evaluateDeleteAttribute(model: DomainModel, command: DeleteAttributeCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;
  const target = model.classes.find((cls) => cls.id === p.classId);

  if (!target) {
    errors.push(err("CLASS_NOT_FOUND", "$.payload.classId", `No existe una clase con id '${p.classId}' en el modelo '${model.id}'.`));
  } else if (!target.attributes.some((a) => a.id === p.attributeId)) {
    errors.push(
      err("ATTRIBUTE_NOT_FOUND", "$.payload.attributeId", `No existe un atributo con id '${p.attributeId}' en la clase '${target.name}'.`),
    );
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      const cls = m.classes.find((c) => c.id === p.classId);
      if (cls) cls.attributes = cls.attributes.filter((a) => a.id !== p.attributeId);
    },
  };
}

/** Kinds que llevan multiplicidades/navegabilidad reales (el resto usa neutros). */
const STRUCTURAL_KINDS: readonly AssociationKind[] = ["association", "aggregation", "composition", "associationClass"];

/** Sigue la cadena de padres (generalization source→target) y detecta ciclos. */
function createsGeneralizationCycle(model: DomainModel, childId: string, parentId: string): boolean {
  let current: string | undefined = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === childId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = model.associations.find(
      (a) => (a.kind ?? "association") === "generalization" && a.sourceClassId === current,
    )?.targetClassId;
  }
  return false;
}

function evaluateCreateAssociation(model: DomainModel, command: CreateAssociationCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;
  const kind: AssociationKind = p.kind ?? "association";
  const structural = STRUCTURAL_KINDS.includes(kind);

  if (!model.classes.some((cls) => cls.id === p.sourceClassId)) {
    errors.push(err("CLASS_NOT_FOUND", "$.payload.sourceClassId", `No existe una clase con id '${p.sourceClassId}' en el modelo '${model.id}'.`));
  }
  if (!model.classes.some((cls) => cls.id === p.targetClassId)) {
    errors.push(err("CLASS_NOT_FOUND", "$.payload.targetClassId", `No existe una clase con id '${p.targetClassId}' en el modelo '${model.id}'.`));
  }
  if (model.associations.some((assoc) => assoc.id === p.id)) {
    errors.push(err("DUPLICATE_ID", "$.payload.id", `Ya existe una asociación con id '${p.id}' en el documento.`));
  }
  if (kind && !ASSOCIATION_KINDS.includes(kind)) {
    errors.push(err("INVALID_ASSOCIATION_KIND", "$.payload.kind", `El tipo de relación '${kind}' no es válido (${ASSOCIATION_KINDS.join(", ")}).`));
  }
  if (structural) {
    if (!isMultiplicity(p.sourceMultiplicity)) {
      errors.push(err("INVALID_MULTIPLICITY", "$.payload.sourceMultiplicity", `La multiplicidad '${p.sourceMultiplicity}' no es un literal permitido (${MULTIPLICITIES.join(", ")}).`));
    }
    if (!isMultiplicity(p.targetMultiplicity)) {
      errors.push(err("INVALID_MULTIPLICITY", "$.payload.targetMultiplicity", `La multiplicidad '${p.targetMultiplicity}' no es un literal permitido (${MULTIPLICITIES.join(", ")}).`));
    }
    if (!isNavigability(p.navigability)) {
      errors.push(err("INVALID_NAVIGABILITY", "$.payload.navigability", `La navegabilidad '${p.navigability}' debe ser 'unidirectional' o 'bidirectional'.`));
    }
  }
  if (p.sourceClassId === p.targetClassId) {
    errors.push(
      err("SELF_ASSOCIATION_NOT_ALLOWED", "$.payload.targetClassId", `sourceClassId y targetClassId no pueden ser el mismo en v1. La clase '${p.sourceClassId}' no puede asociarse consigo misma.`),
    );
  }
  if (kind === "generalization") {
    if (model.associations.some((a) => (a.kind ?? "association") === "generalization" && a.sourceClassId === p.sourceClassId)) {
      errors.push(err("MULTIPLE_INHERITANCE", "$.payload.sourceClassId", `La clase '${p.sourceClassId}' ya tiene una generalización; solo se admite herencia simple.`));
    }
    if (createsGeneralizationCycle(model, p.sourceClassId, p.targetClassId)) {
      errors.push(err("GENERALIZATION_CYCLE", "$.payload.targetClassId", `La generalización crearía un ciclo de herencia.`));
    }
  }
  if (kind === "composition" && model.associations.some((a) => a.kind === "composition" && a.targetClassId === p.targetClassId)) {
    errors.push(err("COMPOSITION_PART_OCCUPIED", "$.payload.targetClassId", `La clase '${p.targetClassId}' ya es parte de otra composición; una parte solo puede pertenecer a un todo.`));
  }
  if (kind === "associationClass") {
    if (!p.associationClassId) {
      errors.push(err("MISSING_ASSOCIATION_CLASS", "$.payload.associationClassId", `Una clase-asociación requiere 'associationClassId'.`));
    } else if (!model.classes.some((cls) => cls.id === p.associationClassId)) {
      errors.push(err("ASSOCIATION_CLASS_NOT_FOUND", "$.payload.associationClassId", `No existe una clase con id '${p.associationClassId}'.`));
    }
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      m.associations.push({
        id: p.id,
        name: p.name,
        sourceClassId: p.sourceClassId,
        targetClassId: p.targetClassId,
        sourceMultiplicity: p.sourceMultiplicity ?? "1",
        targetMultiplicity: p.targetMultiplicity ?? "1",
        navigability: structural ? (p.navigability ?? "unidirectional") : "unidirectional",
        kind,
        associationClassId: kind === "associationClass" ? p.associationClassId : undefined,
        description: p.description,
      });
    },
  };
}

const UPDATE_ASSOCIATION_FIELDS = ["name", "sourceMultiplicity", "targetMultiplicity", "navigability", "description"] as const;

function evaluateUpdateAssociation(model: DomainModel, command: UpdateAssociationCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;
  const assoc = model.associations.find((a) => a.id === p.associationId);

  if (!assoc) {
    errors.push(
      err("ASSOCIATION_NOT_FOUND", "$.payload.associationId", `No existe una asociación con id '${p.associationId}' en el modelo '${model.id}'.`),
    );
  }
  if (p.sourceMultiplicity !== undefined && !isMultiplicity(p.sourceMultiplicity)) {
    errors.push(err("INVALID_MULTIPLICITY", "$.payload.sourceMultiplicity", `La multiplicidad '${p.sourceMultiplicity}' no es un literal permitido (${MULTIPLICITIES.join(", ")}).`));
  }
  if (p.targetMultiplicity !== undefined && !isMultiplicity(p.targetMultiplicity)) {
    errors.push(err("INVALID_MULTIPLICITY", "$.payload.targetMultiplicity", `La multiplicidad '${p.targetMultiplicity}' no es un literal permitido (${MULTIPLICITIES.join(", ")}).`));
  }
  if (p.navigability !== undefined && !isNavigability(p.navigability)) {
    errors.push(err("INVALID_NAVIGABILITY", "$.payload.navigability", `La navegabilidad '${p.navigability}' debe ser 'unidirectional' o 'bidirectional'.`));
  }

  return {
    errors,
    warnings: [],
    noop: UPDATE_ASSOCIATION_FIELDS.every((field) => p[field] === undefined),
    apply: (m) => {
      const target = m.associations.find((a) => a.id === p.associationId);
      if (!target) return;
      if (p.name !== undefined) target.name = p.name;
      if (p.sourceMultiplicity !== undefined) target.sourceMultiplicity = p.sourceMultiplicity;
      if (p.targetMultiplicity !== undefined) target.targetMultiplicity = p.targetMultiplicity;
      if (p.navigability !== undefined) target.navigability = p.navigability;
      if (p.description !== undefined) target.description = p.description;
    },
  };
}

function evaluateDeleteAssociation(model: DomainModel, command: DeleteAssociationCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;

  if (!model.associations.some((assoc) => assoc.id === p.associationId)) {
    errors.push(
      err("ASSOCIATION_NOT_FOUND", "$.payload.associationId", `No existe una asociación con id '${p.associationId}' en el modelo '${model.id}'.`),
    );
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      m.associations = m.associations.filter((a) => a.id !== p.associationId);
    },
  };
}

function evaluateCreatePackage(model: DomainModel, command: CreatePackageCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;

  if (p.parentId !== undefined && !model.packages.some((pkg) => pkg.id === p.parentId)) {
    errors.push(err("PACKAGE_NOT_FOUND", "$.payload.parentId", `No existe un paquete con id '${p.parentId}' en el modelo '${model.id}'.`));
  }
  if (model.packages.some((pkg) => pkg.id === p.id)) {
    errors.push(err("DUPLICATE_ID", "$.payload.id", `Ya existe un paquete con id '${p.id}' en el documento.`));
  }
  if (model.packages.some((pkg) => pkg.name === p.name && sameScope(pkg.parentId, p.parentId))) {
    errors.push(
      err("DUPLICATE_PACKAGE_NAME", "$.payload.name", `Ya existe un paquete con nombre '${p.name}' bajo el mismo padre.`),
    );
  }
  if (!isIdentifier(p.name)) {
    errors.push(err("INVALID_NAME_FORMAT", "$.payload.name", `El nombre '${p.name}' no cumple el patrón [A-Za-z_][A-Za-z0-9_]*.`));
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      m.packages.push({ id: p.id, name: p.name, parentId: p.parentId, description: p.description });
    },
  };
}

function evaluateDeletePackage(model: DomainModel, command: DeletePackageCommand): CommandEvaluation {
  const errors: CommandError[] = [];
  const p = command.payload;

  if (!model.packages.some((pkg) => pkg.id === p.packageId)) {
    errors.push(err("PACKAGE_NOT_FOUND", "$.payload.packageId", `No existe un paquete con id '${p.packageId}' en el modelo '${model.id}'.`));
  }
  if (model.classes.some((cls) => cls.packageId === p.packageId)) {
    errors.push(err("PACKAGE_NOT_EMPTY", "$.payload.packageId", `El paquete '${p.packageId}' contiene clases; no puede eliminarse sin reasignar o eliminar las clases primero.`));
  }
  if (model.packages.some((pkg) => pkg.parentId === p.packageId)) {
    errors.push(err("PACKAGE_HAS_CHILDREN", "$.payload.packageId", `El paquete '${p.packageId}' contiene subpaquetes; deben eliminarse primero.`));
  }

  return {
    errors,
    warnings: [],
    noop: false,
    apply: (m) => {
      m.packages = m.packages.filter((pkg) => pkg.id !== p.packageId);
    },
  };
}

const HANDLERS: Record<ModelCommand["type"], CommandHandler> = {
  CreateClass: evaluateCreateClass as CommandHandler,
  RenameClass: evaluateRenameClass as CommandHandler,
  DeleteClass: evaluateDeleteClass as CommandHandler,
  AddAttribute: evaluateAddAttribute as CommandHandler,
  UpdateAttribute: evaluateUpdateAttribute as CommandHandler,
  DeleteAttribute: evaluateDeleteAttribute as CommandHandler,
  CreateAssociation: evaluateCreateAssociation as CommandHandler,
  UpdateAssociation: evaluateUpdateAssociation as CommandHandler,
  DeleteAssociation: evaluateDeleteAssociation as CommandHandler,
  CreatePackage: evaluateCreatePackage as CommandHandler,
  DeletePackage: evaluateDeletePackage as CommandHandler,
};

/**
 * Aplica un comando del contrato `model-commands-v1` sobre el modelo.
 *
 * Devuelve siempre un `CommandOutcome`; el modelo de entrada nunca se muta.
 * Pasos de validación (§9): 1) existencia del modelo —retorno inmediato—,
 * 2) concurrencia optimista, 3-8) precondiciones del comando en orden fijo,
 * 9) advertencias semánticas.
 */
export function applyCommand(model: DomainModel, command: ModelCommand): CommandOutcome {
  if (model.id !== command.modelId) {
    return {
      commandId: command.commandId,
      result: "rejected",
      model,
      modelVersion: model.version,
      errors: [
        err("MODEL_NOT_FOUND", "$.modelId", `El modelo con id '${command.modelId}' no coincide con el modelo actual '${model.id}'.`),
      ],
      warnings: [],
    };
  }

  const errors: CommandError[] = [];
  if (model.version !== command.modelVersion) {
    errors.push(
      err(
        "CONCURRENT_MODIFICATION",
        "$.modelVersion",
        `La versión del modelo indicada en el comando ('${command.modelVersion}') no coincide con la versión actual ('${model.version}'). Sincronice las actualizaciones antes de volver a emitir.`,
      ),
    );
  }

  const handler = HANDLERS[command.type];
  if (!handler) {
    errors.push(err("UNKNOWN_COMMAND", "$.type", `Tipo de comando '${(command as { type: string }).type}' no reconocido en model-commands-v1.`));
    return { commandId: command.commandId, result: "rejected", model, modelVersion: model.version, errors, warnings: [] };
  }

  const evaluation = handler(model, command);
  errors.push(...evaluation.errors);

  if (errors.length > 0) {
    return {
      commandId: command.commandId,
      result: "rejected",
      model,
      modelVersion: model.version,
      errors,
      warnings: [],
    };
  }

  if (evaluation.noop) {
    return {
      commandId: command.commandId,
      result: "noop",
      model,
      modelVersion: model.version,
      errors: [],
      warnings: evaluation.warnings,
    };
  }

  const next = cloneModel(model);
  evaluation.apply(next);
  next.version = incrementPatchVersion(model.version);

  return {
    commandId: command.commandId,
    result: "accepted",
    model: next,
    modelVersion: next.version,
    errors: [],
    warnings: evaluation.warnings,
  };
}
