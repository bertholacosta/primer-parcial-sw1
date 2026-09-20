import type { CanonicalDomainModel, CanonicalAttribute } from '../domain/model';

export const ALLOWED_ATTRIBUTE_TYPES = [
  'String',
  'Integer',
  'Long',
  'Double',
  'Boolean',
  'Date',
  'DateTime',
  'UUID',
] as const;

export const ALLOWED_MULTIPLICITIES = ['1', '0..1', '1..*', '0..*'] as const;

export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface BaseCommand<TType extends string, TPayload> {
  type: TType;
  commandId: string;
  modelId: string;
  modelVersion: string;
  payload: TPayload;
}

export interface AddAttributePayload {
  attributeId: string;
  classId: string;
  name: string;
  type: string;
  nullable: boolean;
  multiplicity: string;
  description?: string;
}

export type AddAttributeCommand = BaseCommand<'AddAttribute', AddAttributePayload>;

export interface UpdateAttributePayload {
  attributeId: string;
  classId: string;
  name?: string;
  type?: string;
  nullable?: boolean;
  multiplicity?: string;
  description?: string;
}

export type UpdateAttributeCommand = BaseCommand<'UpdateAttribute', UpdateAttributePayload>;

export type ModelCommand = AddAttributeCommand | UpdateAttributeCommand;

export interface CommandError {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  path?: string;
}

export interface CommandExecutionResult {
  result: 'accepted' | 'rejected' | 'noop';
  commandId: string;
  modelVersion: string;
  errors?: CommandError[];
  warnings?: CommandError[];
}

/**
 * Incrementa la versión semántica en PATCH (ej. 1.0.0 -> 1.0.1)
 */
export function incrementPatchVersion(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
  return `${version}-patch`;
}

/**
 * Procesa un comando AddAttribute verificando todas las precondiciones de docs/contracts/model-commands-v1.md §4.1.
 * Si alguna precondición falla, devuelve result: 'rejected' sin mutar el modelo.
 */
export function executeAddAttribute(
  model: CanonicalDomainModel,
  command: AddAttributeCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  // PC-AA-1 & PC-AA-2: Identidad del modelo y concurrencia optimista
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

  // PC-AA-3: La clase receptora debe existir
  const targetClass = model.classes.find((c) => c.id === payload.classId);
  if (!targetClass) {
    errors.push({
      code: 'CLASS_NOT_FOUND',
      message: `No existe la clase con id '${payload.classId}'.`,
      severity: 'ERROR',
      path: '$.payload.classId',
    });
  }

  // PC-AA-4: attributeId único en el documento
  const idAlreadyExists = model.classes.some((c) =>
    c.attributes.some((a) => a.id === payload.attributeId)
  );
  if (idAlreadyExists) {
    errors.push({
      code: 'DUPLICATE_ID',
      message: `Ya existe un atributo con id '${payload.attributeId}' en el modelo.`,
      severity: 'ERROR',
      path: '$.payload.attributeId',
    });
  }

  // PC-AA-5: name único dentro de la clase
  if (targetClass && targetClass.attributes.some((a) => a.name === payload.name)) {
    errors.push({
      code: 'DUPLICATE_ATTRIBUTE_NAME',
      message: `La clase '${targetClass.name}' ya tiene un atributo con nombre '${payload.name}'.`,
      severity: 'ERROR',
      path: '$.payload.name',
    });
  }

  // PC-AA-6: type permitido
  if (!ALLOWED_ATTRIBUTE_TYPES.includes(payload.type as any)) {
    errors.push({
      code: 'UNKNOWN_TYPE',
      message: `El tipo '${payload.type}' no es un tipo canónico permitido (${ALLOWED_ATTRIBUTE_TYPES.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.type',
    });
  }

  // PC-AA-7: formato de nombre
  if (!IDENTIFIER_PATTERN.test(payload.name)) {
    errors.push({
      code: 'INVALID_NAME_FORMAT',
      message: `El nombre '${payload.name}' no cumple con el patrón [A-Za-z_][A-Za-z0-9_]*.`,
      severity: 'ERROR',
      path: '$.payload.name',
    });
  }

  // PC-AA-8: multiplicidad válida
  if (!ALLOWED_MULTIPLICITIES.includes(payload.multiplicity as any)) {
    errors.push({
      code: 'INVALID_MULTIPLICITY',
      message: `La multiplicidad '${payload.multiplicity}' no es válida (${ALLOWED_MULTIPLICITIES.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.multiplicity',
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
  const newAttribute: CanonicalAttribute = {
    id: payload.attributeId,
    name: payload.name,
    type: payload.type,
    nullable: payload.nullable,
    multiplicity: payload.multiplicity,
    description: payload.description,
  };

  const nextVersion = incrementPatchVersion(model.version);

  const updatedClasses = model.classes.map((cls) => {
    if (cls.id === payload.classId) {
      return {
        ...cls,
        attributes: [...cls.attributes, newAttribute],
      };
    }
    return cls;
  });

  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    classes: updatedClasses,
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

/**
 * Procesa un comando UpdateAttribute verificando todas las precondiciones de docs/contracts/model-commands-v1.md §4.2.
 * Si alguna precondición falla, devuelve result: 'rejected' sin mutar el modelo.
 */
export function executeUpdateAttribute(
  model: CanonicalDomainModel,
  command: UpdateAttributeCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  const errors: CommandError[] = [];
  const { payload, commandId, modelVersion, modelId } = command;

  // Optimistic locking & modelId
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

  // PC-UA-3: La clase propietaria debe existir
  const targetClass = model.classes.find((c) => c.id === payload.classId);
  if (!targetClass) {
    errors.push({
      code: 'CLASS_NOT_FOUND',
      message: `No existe la clase con id '${payload.classId}'.`,
      severity: 'ERROR',
      path: '$.payload.classId',
    });
  }

  // PC-UA-4: El atributo debe existir dentro de la clase
  const targetAttr = targetClass?.attributes.find((a) => a.id === payload.attributeId);
  if (targetClass && !targetAttr) {
    errors.push({
      code: 'ATTRIBUTE_NOT_FOUND',
      message: `No existe el atributo '${payload.attributeId}' en la clase '${targetClass.name}'.`,
      severity: 'ERROR',
      path: '$.payload.attributeId',
    });
  }

  // PC-UA-5 & PC-UA-7: Validación de renombre de nombre
  if (payload.name !== undefined && targetClass) {
    if (!IDENTIFIER_PATTERN.test(payload.name)) {
      errors.push({
        code: 'INVALID_NAME_FORMAT',
        message: `El nombre '${payload.name}' no cumple con el patrón [A-Za-z_][A-Za-z0-9_]*.`,
        severity: 'ERROR',
        path: '$.payload.name',
      });
    }

    const nameDuplicate = targetClass.attributes.some(
      (a) => a.id !== payload.attributeId && a.name === payload.name
    );
    if (nameDuplicate) {
      errors.push({
        code: 'DUPLICATE_ATTRIBUTE_NAME',
        message: `La clase '${targetClass.name}' ya tiene otro atributo con nombre '${payload.name}'.`,
        severity: 'ERROR',
        path: '$.payload.name',
      });
    }
  }

  // PC-UA-6: Validación de tipo si se suministra
  if (payload.type !== undefined && !ALLOWED_ATTRIBUTE_TYPES.includes(payload.type as any)) {
    errors.push({
      code: 'UNKNOWN_TYPE',
      message: `El tipo '${payload.type}' no es un tipo canónico permitido (${ALLOWED_ATTRIBUTE_TYPES.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.type',
    });
  }

  // Validación de multiplicidad si se suministra
  if (
    payload.multiplicity !== undefined &&
    !ALLOWED_MULTIPLICITIES.includes(payload.multiplicity as any)
  ) {
    errors.push({
      code: 'INVALID_MULTIPLICITY',
      message: `La multiplicidad '${payload.multiplicity}' no es válida (${ALLOWED_MULTIPLICITIES.join(', ')}).`,
      severity: 'ERROR',
      path: '$.payload.multiplicity',
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

  const nextVersion = incrementPatchVersion(model.version);

  const updatedClasses = model.classes.map((cls) => {
    if (cls.id === payload.classId) {
      const updatedAttributes = cls.attributes.map((attr) => {
        if (attr.id === payload.attributeId) {
          return {
            ...attr,
            name: payload.name ?? attr.name,
            type: payload.type ?? attr.type,
            nullable: payload.nullable ?? attr.nullable,
            multiplicity: payload.multiplicity ?? attr.multiplicity,
            description:
              payload.description !== undefined ? payload.description : attr.description,
          };
        }
        return attr;
      });

      return {
        ...cls,
        attributes: updatedAttributes,
      };
    }
    return cls;
  });

  const updatedModel: CanonicalDomainModel = {
    ...model,
    version: nextVersion,
    classes: updatedClasses,
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

/**
 * Despachador de comandos de atributos
 */
export function dispatchAttributeCommand(
  model: CanonicalDomainModel,
  command: ModelCommand
): { updatedModel: CanonicalDomainModel; result: CommandExecutionResult } {
  switch (command.type) {
    case 'AddAttribute':
      return executeAddAttribute(model, command);
    case 'UpdateAttribute':
      return executeUpdateAttribute(model, command);
    default:
      throw new Error(`Comando no soportado: ${(command as any).type}`);
  }
}
