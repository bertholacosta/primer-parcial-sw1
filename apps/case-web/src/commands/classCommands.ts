import type { CanonicalDomainModel, CanonicalClass } from '../domain/model';
import {
  IDENTIFIER_PATTERN,
  incrementPatchVersion,
  type BaseCommand,
  type CommandError,
  type CommandExecutionResult,
} from './attributeCommands';

export interface CreateClassPayload {
  classId: string;
  name: string;
  packageId?: string;
  description?: string;
}

export type CreateClassCommand = BaseCommand<'CreateClass', CreateClassPayload>;

export interface CreateClassInput {
  /** Id generado por el emisor (el canvas lo necesita para anclar la posición de drop). */
  classId: string;
  name: string;
  packageId?: string;
}

export interface RenameClassPayload {
  classId: string;
  newName: string;
}

export type RenameClassCommand = BaseCommand<'RenameClass', RenameClassPayload>;

export interface UpdateClassPayload {
  classId: string;
  name?: string;
  packageId?: string | null;
  description?: string;
}

export type UpdateClassCommand = BaseCommand<'UpdateClass', UpdateClassPayload>;
export type UpdateClassInput = UpdateClassPayload;

export interface DeleteClassPayload {
  classId: string;
}

export type DeleteClassCommand = BaseCommand<'DeleteClass', DeleteClassPayload>;

export interface CreatePackagePayload {
  packageId: string;
  name: string;
  description?: string;
}

export type CreatePackageCommand = BaseCommand<'CreatePackage', CreatePackagePayload>;

export interface DeletePackagePayload {
  packageId: string;
}

export type DeletePackageCommand = BaseCommand<'DeletePackage', DeletePackagePayload>;

/**
 * Procesa un comando CreateClass verificando las precondiciones del contrato
 * model-commands-v1: identidad del modelo, concurrencia optimista, paquete
 * existente, id único, nombre único en el ámbito y formato identificador.
 */
export function executeCreateClass(
  model: CanonicalDomainModel,
  command: CreateClassCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  if (model.id !== modelId) {
    errors.push({
      code: 'MODEL_NOT_FOUND',
      message: `El modelo con id '${modelId}' no coincide con el modelo actual '${model.id}'.`,
      severity: 'ERROR',
      path: '$.modelId',
    });
  }

  if (model.version !== modelVersion) {
    errors.push({
      code: 'CONCURRENT_MODIFICATION',
      message: `Versión del modelo esperada '${modelVersion}', pero la actual es '${model.version}'.`,
      severity: 'ERROR',
      path: '$.modelVersion',
    });
  }

  if (payload.packageId !== undefined && !model.packages.some((p) => p.id === payload.packageId)) {
    errors.push({
      code: 'PACKAGE_NOT_FOUND',
      message: `No existe un paquete con id '${payload.packageId}' en el modelo.`,
      severity: 'ERROR',
      path: '$.payload.packageId',
    });
  }

  if (model.classes.some((c) => c.id === payload.classId)) {
    errors.push({
      code: 'DUPLICATE_ID',
      message: `Ya existe una clase con id '${payload.classId}' en el modelo.`,
      severity: 'ERROR',
      path: '$.payload.classId',
    });
  }

  const sameScope = (a?: string, b?: string) => (a ?? null) === (b ?? null);
  if (
    model.classes.some(
      (c) => c.name === payload.name && sameScope(c.packageId, payload.packageId)
    )
  ) {
    errors.push({
      code: 'DUPLICATE_CLASS_NAME',
      message: `Ya existe una clase con nombre '${payload.name}' en el mismo ámbito de paquete.`,
      severity: 'ERROR',
      path: '$.payload.name',
    });
  }

  if (!IDENTIFIER_PATTERN.test(payload.name)) {
    errors.push({
      code: 'INVALID_NAME_FORMAT',
      message: `El nombre '${payload.name}' no cumple con el patrón [A-Za-z_][A-Za-z0-9_]*.`,
      severity: 'ERROR',
      path: '$.payload.name',
    });
  }

  if (errors.length > 0) {
    return {
      updatedModel: model,
      result: { result: 'rejected', commandId, modelVersion: model.version, errors },
    };
  }

  const newClass: CanonicalClass = {
    id: payload.classId,
    name: payload.name,
    packageId: payload.packageId,
    description: payload.description,
    attributes: [],
  };

  const nextVersion = incrementPatchVersion(model.version);
  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    classes: [...model.classes, newClass],
  };

  return {
    updatedModel,
    result: { result: 'accepted', commandId, modelVersion: nextVersion },
  };
}

/** Renombra una clase: precondiciones de unicidad de nombre en el ámbito y formato. */
export function executeRenameClass(
  model: CanonicalDomainModel,
  command: RenameClassCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  if (model.id !== modelId) {
    errors.push({ code: 'MODEL_NOT_FOUND', message: `El modelo con id '${modelId}' no coincide con el modelo actual '${model.id}'.`, severity: 'ERROR', path: '$.modelId' });
  }
  if (model.version !== modelVersion) {
    errors.push({ code: 'CONCURRENT_MODIFICATION', message: `Versión del modelo esperada '${modelVersion}', pero la actual es '${model.version}'.`, severity: 'ERROR', path: '$.modelVersion' });
  }
  const target = model.classes.find((c) => c.id === payload.classId);
  if (!target) {
    errors.push({ code: 'CLASS_NOT_FOUND', message: `No existe la clase con id '${payload.classId}'.`, severity: 'ERROR', path: '$.payload.classId' });
  } else if (
    model.classes.some(
      (c) => c.id !== payload.classId && c.name === payload.newName && (c.packageId ?? null) === (target.packageId ?? null)
    )
  ) {
    errors.push({ code: 'DUPLICATE_CLASS_NAME', message: `Ya existe otra clase con nombre '${payload.newName}' en el mismo ámbito de paquete.`, severity: 'ERROR', path: '$.payload.newName' });
  }
  if (!IDENTIFIER_PATTERN.test(payload.newName)) {
    errors.push({ code: 'INVALID_NAME_FORMAT', message: `El nombre '${payload.newName}' no cumple con el patrón [A-Za-z_][A-Za-z0-9_]*.`, severity: 'ERROR', path: '$.payload.newName' });
  }
  if (errors.length > 0) {
    return { updatedModel: model, result: { result: 'rejected', commandId, modelVersion: model.version, errors } };
  }

  const nextVersion = incrementPatchVersion(model.version);
  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    classes: model.classes.map((c) => (c.id === payload.classId ? { ...c, name: payload.newName } : c)),
  };
  return { updatedModel, result: { result: 'accepted', commandId, modelVersion: nextVersion } };
}

export function executeUpdateClass(
  model: CanonicalDomainModel,
  command: UpdateClassCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;
  const target = model.classes.find((item) => item.id === payload.classId);
  const packageId = payload.packageId === undefined ? target?.packageId : payload.packageId ?? undefined;
  const name = payload.name ?? target?.name;

  if (model.id !== modelId) errors.push({ code: 'MODEL_NOT_FOUND', message: `El modelo con id '${modelId}' no coincide con el modelo actual '${model.id}'.`, severity: 'ERROR', path: '$.modelId' });
  if (model.version !== modelVersion) errors.push({ code: 'CONCURRENT_MODIFICATION', message: `Versión del modelo esperada '${modelVersion}', pero la actual es '${model.version}'.`, severity: 'ERROR', path: '$.modelVersion' });
  if (!target) errors.push({ code: 'CLASS_NOT_FOUND', message: `No existe la clase con id '${payload.classId}'.`, severity: 'ERROR', path: '$.payload.classId' });
  if (payload.name !== undefined && !IDENTIFIER_PATTERN.test(payload.name)) errors.push({ code: 'INVALID_NAME_FORMAT', message: `El nombre '${payload.name}' no cumple con el patrón requerido.`, severity: 'ERROR', path: '$.payload.name' });
  if (payload.packageId !== undefined && payload.packageId !== null && !model.packages.some((item) => item.id === payload.packageId)) errors.push({ code: 'PACKAGE_NOT_FOUND', message: `No existe el paquete con id '${payload.packageId}'.`, severity: 'ERROR', path: '$.payload.packageId' });
  if (target && name && model.classes.some((item) => item.id !== payload.classId && item.name === name && (item.packageId ?? null) === (packageId ?? null))) errors.push({ code: 'DUPLICATE_CLASS_NAME', message: `Ya existe otra clase con nombre '${name}' en el mismo ámbito.`, severity: 'ERROR', path: '$.payload.name' });
  if (errors.length > 0) return { updatedModel: model, result: { result: 'rejected', commandId, modelVersion: model.version, errors } };

  const nextVersion = incrementPatchVersion(model.version);
  return {
    updatedModel: {
      ...model,
      version: nextVersion,
      classes: model.classes.map((item) => item.id === payload.classId ? {
        ...item,
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.packageId !== undefined ? { packageId: payload.packageId ?? undefined } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
      } : item),
    },
    result: { result: 'accepted', commandId, modelVersion: nextVersion },
  };
}

/** Elimina una clase y todas las asociaciones que la referencian. */
export function executeDeleteClass(
  model: CanonicalDomainModel,
  command: DeleteClassCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  if (model.id !== modelId) {
    errors.push({ code: 'MODEL_NOT_FOUND', message: `El modelo con id '${modelId}' no coincide con el modelo actual '${model.id}'.`, severity: 'ERROR', path: '$.modelId' });
  }
  if (model.version !== modelVersion) {
    errors.push({ code: 'CONCURRENT_MODIFICATION', message: `Versión del modelo esperada '${modelVersion}', pero la actual es '${model.version}'.`, severity: 'ERROR', path: '$.modelVersion' });
  }
  if (!model.classes.some((c) => c.id === payload.classId)) {
    errors.push({ code: 'CLASS_NOT_FOUND', message: `No existe la clase con id '${payload.classId}'.`, severity: 'ERROR', path: '$.payload.classId' });
  }
  if (errors.length > 0) {
    return { updatedModel: model, result: { result: 'rejected', commandId, modelVersion: model.version, errors } };
  }

  const nextVersion = incrementPatchVersion(model.version);
  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    classes: model.classes.filter((c) => c.id !== payload.classId),
    associations: model.associations.filter(
      (a) => a.sourceClassId !== payload.classId && a.targetClassId !== payload.classId
    ),
  };
  return { updatedModel, result: { result: 'accepted', commandId, modelVersion: nextVersion } };
}

/** Crea un paquete UML de primer nivel. */
export function executeCreatePackage(
  model: CanonicalDomainModel,
  command: CreatePackageCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  if (model.id !== modelId) {
    errors.push({ code: 'MODEL_NOT_FOUND', message: `El modelo con id '${modelId}' no coincide con el modelo actual '${model.id}'.`, severity: 'ERROR', path: '$.modelId' });
  }
  if (model.version !== modelVersion) {
    errors.push({ code: 'CONCURRENT_MODIFICATION', message: `Versión del modelo esperada '${modelVersion}', pero la actual es '${model.version}'.`, severity: 'ERROR', path: '$.modelVersion' });
  }
  if (model.packages.some((p) => p.id === payload.packageId)) {
    errors.push({ code: 'DUPLICATE_ID', message: `Ya existe un paquete con id '${payload.packageId}'.`, severity: 'ERROR', path: '$.payload.packageId' });
  }
  if (model.packages.some((p) => p.name === payload.name && !p.parentId)) {
    errors.push({ code: 'DUPLICATE_PACKAGE_NAME', message: `Ya existe un paquete con nombre '${payload.name}' en el nivel raíz.`, severity: 'ERROR', path: '$.payload.name' });
  }
  if (!IDENTIFIER_PATTERN.test(payload.name)) {
    errors.push({ code: 'INVALID_NAME_FORMAT', message: `El nombre '${payload.name}' no cumple con el patrón [A-Za-z_][A-Za-z0-9_]*.`, severity: 'ERROR', path: '$.payload.name' });
  }
  if (errors.length > 0) {
    return { updatedModel: model, result: { result: 'rejected', commandId, modelVersion: model.version, errors } };
  }

  const nextVersion = incrementPatchVersion(model.version);
  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    packages: [...model.packages, { id: payload.packageId, name: payload.name, description: payload.description }],
  };
  return { updatedModel, result: { result: 'accepted', commandId, modelVersion: nextVersion } };
}

/** Elimina un paquete vacío (sin clases ni subpaquetes). */
export function executeDeletePackage(
  model: CanonicalDomainModel,
  command: DeletePackageCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  if (model.id !== modelId) {
    errors.push({ code: 'MODEL_NOT_FOUND', message: `El modelo con id '${modelId}' no coincide con el modelo actual '${model.id}'.`, severity: 'ERROR', path: '$.modelId' });
  }
  if (model.version !== modelVersion) {
    errors.push({ code: 'CONCURRENT_MODIFICATION', message: `Versión del modelo esperada '${modelVersion}', pero la actual es '${model.version}'.`, severity: 'ERROR', path: '$.modelVersion' });
  }
  if (!model.packages.some((p) => p.id === payload.packageId)) {
    errors.push({ code: 'PACKAGE_NOT_FOUND', message: `No existe el paquete con id '${payload.packageId}'.`, severity: 'ERROR', path: '$.payload.packageId' });
  }
  if (model.classes.some((c) => c.packageId === payload.packageId)) {
    errors.push({ code: 'PACKAGE_NOT_EMPTY', message: `El paquete contiene clases; reasigna o elimina las clases primero.`, severity: 'ERROR', path: '$.payload.packageId' });
  }
  if (model.packages.some((p) => p.parentId === payload.packageId)) {
    errors.push({ code: 'PACKAGE_HAS_CHILDREN', message: `El paquete contiene subpaquetes; elimínalos primero.`, severity: 'ERROR', path: '$.payload.packageId' });
  }
  if (errors.length > 0) {
    return { updatedModel: model, result: { result: 'rejected', commandId, modelVersion: model.version, errors } };
  }

  const nextVersion = incrementPatchVersion(model.version);
  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    packages: model.packages.filter((p) => p.id !== payload.packageId),
  };
  return { updatedModel, result: { result: 'accepted', commandId, modelVersion: nextVersion } };
}
