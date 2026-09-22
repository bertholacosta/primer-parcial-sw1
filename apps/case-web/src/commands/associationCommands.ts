import type { CanonicalDomainModel, CanonicalAssociation, AssociationKind } from '../domain/model';
import {
  ALLOWED_MULTIPLICITIES,
  incrementPatchVersion,
  type BaseCommand,
  type CommandError,
  type CommandExecutionResult,
} from './attributeCommands';

export const ALLOWED_NAVIGABILITIES = ['unidirectional', 'bidirectional'] as const;

export const ASSOCIATION_KINDS: AssociationKind[] = [
  'association',
  'aggregation',
  'composition',
  'generalization',
  'dependency',
  'associationClass',
];

/** Kinds con multiplicidades/navegabilidad reales (ADR-0009). */
export const STRUCTURAL_KINDS: AssociationKind[] = [
  'association',
  'aggregation',
  'composition',
  'associationClass',
];

export interface CreateAssociationPayload {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  navigability?: string;
  kind?: AssociationKind;
  associationClassId?: string;
  description?: string;
}

export type CreateAssociationCommand = BaseCommand<'CreateAssociation', CreateAssociationPayload>;

export interface DeleteAssociationPayload {
  associationId: string;
}

export type DeleteAssociationCommand = BaseCommand<'DeleteAssociation', DeleteAssociationPayload>;

/**
 * Datos de entrada para la creación visual de una asociación desde el editor.
 * El identificador de la asociación lo genera el emisor del comando.
 */
export interface CreateAssociationInput {
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  navigability?: string;
  kind?: AssociationKind;
  associationClassId?: string;
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

  const kind: AssociationKind = payload.kind ?? 'association';
  const structural = STRUCTURAL_KINDS.includes(kind);

  if (payload.kind && !ASSOCIATION_KINDS.includes(payload.kind)) {
    errors.push({
      code: 'INVALID_ASSOCIATION_KIND',
      message: `El tipo de relación '${payload.kind}' no es válido (${ASSOCIATION_KINDS.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.kind',
    });
  }

  if (structural) {
    // PC-CA-7/8/9: multiplicidades y navegabilidad válidas (solo kinds estructurales)
    if (!ALLOWED_MULTIPLICITIES.includes(payload.sourceMultiplicity as any)) {
      errors.push({
        code: 'INVALID_MULTIPLICITY',
        message: `La multiplicidad '${payload.sourceMultiplicity}' no es válida (${ALLOWED_MULTIPLICITIES.join(', ')}).`,
        severity: 'ERROR',
        path: '$.payload.sourceMultiplicity',
      });
    }
    if (!ALLOWED_MULTIPLICITIES.includes(payload.targetMultiplicity as any)) {
      errors.push({
        code: 'INVALID_MULTIPLICITY',
        message: `La multiplicidad '${payload.targetMultiplicity}' no es válida (${ALLOWED_MULTIPLICITIES.join(', ')}).`,
        severity: 'ERROR',
        path: '$.payload.targetMultiplicity',
      });
    }
    if (!ALLOWED_NAVIGABILITIES.includes(payload.navigability as any)) {
      errors.push({
        code: 'INVALID_NAVIGABILITY',
        message: `La navegabilidad '${payload.navigability}' no es válida (${ALLOWED_NAVIGABILITIES.join(', ')}).`,
        severity: 'ERROR',
        path: '$.payload.navigability',
      });
    }
  }

  if (kind === 'generalization') {
    // Herencia simple: la hija solo puede tener una generalización
    if (model.associations.some((a) => (a.kind ?? 'association') === 'generalization' && a.sourceClassId === payload.sourceClassId)) {
      errors.push({
        code: 'MULTIPLE_INHERITANCE',
        message: `La clase '${payload.sourceClassId}' ya tiene una generalización; solo se admite herencia simple.`,
        severity: 'ERROR',
        path: '$.payload.sourceClassId',
      });
    }
    // Sin ciclos: seguir la cadena de padres desde el target
    let current: string | undefined = payload.targetClassId;
    const seen = new Set<string>();
    while (current) {
      if (current === payload.sourceClassId) {
        errors.push({
          code: 'GENERALIZATION_CYCLE',
          message: 'La generalización crearía un ciclo de herencia.',
          severity: 'ERROR',
          path: '$.payload.targetClassId',
        });
        break;
      }
      if (seen.has(current)) break;
      seen.add(current);
      current = model.associations.find(
        (a) => (a.kind ?? 'association') === 'generalization' && a.sourceClassId === current
      )?.targetClassId;
    }
  }

  if (kind === 'composition' &&
    model.associations.some((a) => a.kind === 'composition' && a.targetClassId === payload.targetClassId)) {
    errors.push({
      code: 'COMPOSITION_PART_OCCUPIED',
      message: `La clase '${payload.targetClassId}' ya es parte de otra composición.`,
      severity: 'ERROR',
      path: '$.payload.targetClassId',
    });
  }

  if (kind === 'associationClass') {
    if (!payload.associationClassId) {
      errors.push({
        code: 'MISSING_ASSOCIATION_CLASS',
        message: `Una clase-asociación requiere 'associationClassId'.`,
        severity: 'ERROR',
        path: '$.payload.associationClassId',
      });
    } else if (!model.classes.some((c) => c.id === payload.associationClassId)) {
      errors.push({
        code: 'ASSOCIATION_CLASS_NOT_FOUND',
        message: `No existe la clase con id '${payload.associationClassId}'.`,
        severity: 'ERROR',
        path: '$.payload.associationClassId',
      });
    }
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
    sourceMultiplicity: payload.sourceMultiplicity ?? '1',
    targetMultiplicity: payload.targetMultiplicity ?? '1',
    navigability: (structural ? payload.navigability ?? 'unidirectional' : 'unidirectional') as CanonicalAssociation['navigability'],
    kind,
    associationClassId: kind === 'associationClass' ? payload.associationClassId : undefined,
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

/** Elimina una asociación existente del modelo. */
export function executeDeleteAssociation(
  model: CanonicalDomainModel,
  command: DeleteAssociationCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  if (model.id !== modelId) {
    errors.push({ code: 'MODEL_NOT_FOUND', message: `El modelo con id '${modelId}' no coincide con el modelo actual '${model.id}'.`, severity: 'ERROR', path: '$.modelId' });
  }
  if (model.version !== modelVersion) {
    errors.push({ code: 'CONCURRENT_MODIFICATION', message: `Versión del modelo esperada '${modelVersion}', pero la actual es '${model.version}'.`, severity: 'ERROR', path: '$.modelVersion' });
  }
  if (!model.associations.some((a) => a.id === payload.associationId)) {
    errors.push({ code: 'ASSOCIATION_NOT_FOUND', message: `No existe la asociación con id '${payload.associationId}'.`, severity: 'ERROR', path: '$.payload.associationId' });
  }
  if (errors.length > 0) {
    return { updatedModel: model, result: { result: 'rejected', commandId, modelVersion: model.version, errors } };
  }

  const nextVersion = incrementPatchVersion(model.version);
  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    associations: model.associations.filter((a) => a.id !== payload.associationId),
  };
  return { updatedModel, result: { result: 'accepted', commandId, modelVersion: nextVersion } };
}
