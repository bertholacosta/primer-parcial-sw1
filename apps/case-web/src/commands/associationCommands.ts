import type { CanonicalDomainModel, CanonicalAssociation } from '../domain/model';
import {
  ALLOWED_MULTIPLICITIES,
  incrementPatchVersion,
  type BaseCommand,
  type CommandError,
  type CommandExecutionResult,
} from './attributeCommands';

export const ALLOWED_NAVIGABILITIES = ['unidirectional', 'bidirectional'] as const;

export interface CreateAssociationPayload {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  navigability: string;
  description?: string;
}

export type CreateAssociationCommand = BaseCommand<'CreateAssociation', CreateAssociationPayload>;

/**
 * Datos de entrada para la creación visual de una asociación desde el editor.
 * El identificador de la asociación lo genera el emisor del comando.
 */
export interface CreateAssociationInput {
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  navigability: string;
  description?: string;
}

/**
 * Procesa un comando CreateAssociation verificando todas las precondiciones de
 * docs/contracts/model-commands-v1.md §5.1 (PC-CA-1 a PC-CA-9).
 * Si alguna precondición falla, devuelve result: 'rejected' sin mutar el modelo.
 */
export function executeCreateAssociation(
  model: CanonicalDomainModel,
  command: CreateAssociationCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  // PC-CA-1 & PC-CA-2: Identidad del modelo y concurrencia optimista
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

  // PC-CA-3: id de asociación único en el documento
  if (model.associations.some((a) => a.id === payload.id)) {
    errors.push({
      code: 'DUPLICATE_ID',
      message: `Ya existe una asociación con id '${payload.id}' en el modelo.`,
      severity: 'ERROR',
      path: '$.payload.id',
    });
  }

  // PC-CA-4: la clase origen debe existir
  if (!model.classes.some((c) => c.id === payload.sourceClassId)) {
    errors.push({
      code: 'CLASS_NOT_FOUND',
      message: `No existe la clase con id '${payload.sourceClassId}'.`,
      severity: 'ERROR',
      path: '$.payload.sourceClassId',
    });
  }

  // PC-CA-5: la clase destino debe existir
  if (!model.classes.some((c) => c.id === payload.targetClassId)) {
    errors.push({
      code: 'CLASS_NOT_FOUND',
      message: `No existe la clase con id '${payload.targetClassId}'.`,
      severity: 'ERROR',
      path: '$.payload.targetClassId',
    });
  }

  // PC-CA-6: no se admiten auto-asociaciones en v1
  if (payload.sourceClassId === payload.targetClassId) {
    errors.push({
      code: 'SELF_ASSOCIATION_NOT_ALLOWED',
      message: `sourceClassId y targetClassId no pueden ser el mismo en v1. La clase '${payload.sourceClassId}' no puede asociarse consigo misma.`,
      severity: 'ERROR',
      path: '$.payload.targetClassId',
    });
  }

  // PC-CA-7: multiplicidad del extremo origen válida
  if (!ALLOWED_MULTIPLICITIES.includes(payload.sourceMultiplicity as any)) {
    errors.push({
      code: 'INVALID_MULTIPLICITY',
      message: `La multiplicidad '${payload.sourceMultiplicity}' no es válida (${ALLOWED_MULTIPLICITIES.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.sourceMultiplicity',
    });
  }

  // PC-CA-8: multiplicidad del extremo destino válida
  if (!ALLOWED_MULTIPLICITIES.includes(payload.targetMultiplicity as any)) {
    errors.push({
      code: 'INVALID_MULTIPLICITY',
      message: `La multiplicidad '${payload.targetMultiplicity}' no es válida (${ALLOWED_MULTIPLICITIES.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.targetMultiplicity',
    });
  }

  // PC-CA-9: navegabilidad válida
  if (!ALLOWED_NAVIGABILITIES.includes(payload.navigability as any)) {
    errors.push({
      code: 'INVALID_NAVIGABILITY',
      message: `La navegabilidad '${payload.navigability}' no es válida (${ALLOWED_NAVIGABILITIES.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.navigability',
    });
  }

  if (errors.length > 0) {
    return {
      updatedModel: model, // Invariante §2.3: No mutar en error
      result: {
        result: 'rejected',
        commandId,
        modelVersion: model.version,
        errors,
      },
    };
  }

  // Aplicar comando en nueva estructura inmutable
  const newAssociation: CanonicalAssociation = {
    id: payload.id,
    name: payload.name,
    sourceClassId: payload.sourceClassId,
    targetClassId: payload.targetClassId,
    sourceMultiplicity: payload.sourceMultiplicity,
    targetMultiplicity: payload.targetMultiplicity,
    navigability: payload.navigability as CanonicalAssociation['navigability'],
    description: payload.description,
  };

  const nextVersion = incrementPatchVersion(model.version);

  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    associations: [...model.associations, newAssociation],
  };

  return {
    updatedModel,
    result: {
      result: 'accepted',
      commandId,
      modelVersion: nextVersion,
    },
  };
}
