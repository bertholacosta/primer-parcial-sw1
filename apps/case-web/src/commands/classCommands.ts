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
  isAbstract?: boolean;
  description?: string;
}

export type CreateClassCommand = BaseCommand<'CreateClass', CreateClassPayload>;

export interface CreateClassInput {
  name: string;
  packageId?: string;
  isAbstract?: boolean;
}

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
    isAbstract: payload.isAbstract ?? false,
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
