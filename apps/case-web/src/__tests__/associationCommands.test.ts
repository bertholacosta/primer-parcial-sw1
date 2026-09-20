import { describe, it, expect } from 'vitest';
import { parseDomainModel, modelToFlowEdges } from '../adapter/domainModelAdapter';
import {
  executeCreateAssociation,
  type CreateAssociationCommand,
} from '../commands/associationCommands';
import { DEFAULT_CANONICAL_FIXTURE } from '../App';

describe('associationCommands — CreateAssociation (P4-005)', () => {
  const getInitialModel = () => parseDomainModel(DEFAULT_CANONICAL_FIXTURE);

  const buildCommand = (
    payload: Partial<CreateAssociationCommand['payload']> & {
      id: string;
      sourceClassId: string;
      targetClassId: string;
    },
    overrides?: Partial<Omit<CreateAssociationCommand, 'payload'>>
  ): { model: ReturnType<typeof getInitialModel>; command: CreateAssociationCommand } => {
    const model = getInitialModel();
    const command: CreateAssociationCommand = {
      type: 'CreateAssociation',
      commandId: 'cmd-assoc-test',
      modelId: model.id,
      modelVersion: model.version,
      ...overrides,
      payload: {
        sourceMultiplicity: '0..*',
        targetMultiplicity: '1',
        navigability: 'unidirectional',
        ...payload,
      },
    };
    return { model, command };
  };

  it('crea una asociación válida entre dos clases e incrementa la versión en PATCH', () => {
    const { model, command } = buildCommand({
      id: 'assoc-nueva',
      name: 'tieneAutor',
      sourceClassId: 'cls-01',
      targetClassId: 'cls-02',
      sourceMultiplicity: '0..*',
      targetMultiplicity: '1..*',
      navigability: 'bidirectional',
    });

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('accepted');
    expect(result.modelVersion).toBe('1.0.1');
    expect(updatedModel.version).toBe('1.0.1');

    // La fixture ya contiene assoc-01; la nueva se añade al array
    expect(updatedModel.associations).toHaveLength(2);

    const added = updatedModel.associations.find((a) => a.id === 'assoc-nueva');
    expect(added).toBeDefined();
    expect(added?.name).toBe('tieneAutor');
    expect(added?.sourceClassId).toBe('cls-01');
    expect(added?.targetClassId).toBe('cls-02');
    expect(added?.sourceMultiplicity).toBe('0..*');
    expect(added?.targetMultiplicity).toBe('1..*');
    expect(added?.navigability).toBe('bidirectional');

    // La asociación previa no fue modificada
    const previous = updatedModel.associations.find((a) => a.id === 'assoc-01');
    expect(previous?.targetMultiplicity).toBe('1..*');
  });

  it('rechaza y no muta el modelo si la clase origen no existe (CLASS_NOT_FOUND)', () => {
    const { model, command } = buildCommand({
      id: 'assoc-bad-source',
      sourceClassId: 'cls-inexistente',
      targetClassId: 'cls-02',
    });
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'CLASS_NOT_FOUND')).toBe(true);
    expect(result.errors?.some((e) => e.path === '$.payload.sourceClassId')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
    expect(JSON.stringify(model)).toBe(snapshot);
  });

  it('rechaza y no muta el modelo si la clase destino no existe (CLASS_NOT_FOUND)', () => {
    const { model, command } = buildCommand({
      id: 'assoc-bad-target',
      sourceClassId: 'cls-01',
      targetClassId: 'cls-inexistente',
    });
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'CLASS_NOT_FOUND')).toBe(true);
    expect(result.errors?.some((e) => e.path === '$.payload.targetClassId')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
  });

  it('rechaza y no muta el modelo si la multiplicidad de un extremo es inválida (INVALID_MULTIPLICITY)', () => {
    const { model, command } = buildCommand({
      id: 'assoc-bad-mult',
      sourceClassId: 'cls-01',
      targetClassId: 'cls-02',
      sourceMultiplicity: '2..5',
    });
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'INVALID_MULTIPLICITY')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
  });

  it('rechaza una auto-asociación (SELF_ASSOCIATION_NOT_ALLOWED)', () => {
    const { model, command } = buildCommand({
      id: 'assoc-self',
      sourceClassId: 'cls-01',
      targetClassId: 'cls-01',
    });
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'SELF_ASSOCIATION_NOT_ALLOWED')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
  });

  it('rechaza si ya existe una asociación con el mismo id (DUPLICATE_ID)', () => {
    const { model, command } = buildCommand({
      id: 'assoc-01', // Ya existe en el fixture
      sourceClassId: 'cls-02',
      targetClassId: 'cls-01',
    });
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
  });

  it('rechaza una navegabilidad fuera del catálogo (INVALID_NAVIGABILITY)', () => {
    const { model, command } = buildCommand({
      id: 'assoc-bad-nav',
      sourceClassId: 'cls-01',
      targetClassId: 'cls-02',
      navigability: 'circular',
    });
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'INVALID_NAVIGABILITY')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
  });

  it('rechaza si la versión esperada no coincide (CONCURRENT_MODIFICATION)', () => {
    const { model, command } = buildCommand(
      {
        id: 'assoc-concurrent',
        sourceClassId: 'cls-01',
        targetClassId: 'cls-02',
      },
      { modelVersion: '0.9.0' }
    );
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'CONCURRENT_MODIFICATION')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
  });

  it('rechaza si el modelId no corresponde al modelo (MODEL_NOT_FOUND)', () => {
    const { model, command } = buildCommand(
      {
        id: 'assoc-wrong-model',
        sourceClassId: 'cls-01',
        targetClassId: 'cls-02',
      },
      { modelId: 'otro-modelo' }
    );
    const snapshot = JSON.stringify(model);

    const { updatedModel, result } = executeCreateAssociation(model, command);

    expect(result.result).toBe('rejected');
    expect(result.errors?.some((e) => e.code === 'MODEL_NOT_FOUND')).toBe(true);
    expect(JSON.stringify(updatedModel)).toBe(snapshot);
  });
});

describe('modelToFlowEdges — proyección de asociaciones al canvas', () => {
  it('mapea cada asociación del modelo a una arista con identidad y multiplicidades', () => {
    const model = parseDomainModel(DEFAULT_CANONICAL_FIXTURE);
    const edges = modelToFlowEdges(model);

    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect(edge.id).toBe('assoc-01');
    expect(edge.source).toBe('cls-01');
    expect(edge.target).toBe('cls-02');
    expect(edge.data?.sourceMultiplicity).toBe('0..*');
    expect(edge.data?.targetMultiplicity).toBe('1..*');
    expect(edge.data?.navigability).toBe('bidirectional');
    expect(edge.label).toContain('escritoPor');
    expect(edge.label).toContain('0..*');
    expect(edge.label).toContain('1..*');
  });

  it('incluye flecha de destino solo en asociaciones unidireccionales', () => {
    const model = parseDomainModel(DEFAULT_CANONICAL_FIXTURE);
    const { updatedModel } = executeCreateAssociation(model, {
      type: 'CreateAssociation',
      commandId: 'cmd-edge-test',
      modelId: model.id,
      modelVersion: model.version,
      payload: {
        id: 'assoc-uni',
        sourceClassId: 'cls-02',
        targetClassId: 'cls-01',
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
        navigability: 'unidirectional',
      },
    });

    const edges = modelToFlowEdges(updatedModel);
    const bidirectional = edges.find((e) => e.id === 'assoc-01');
    const unidirectional = edges.find((e) => e.id === 'assoc-uni');

    expect(bidirectional?.markerEnd).toBeUndefined();
    expect(unidirectional?.markerEnd).toBeDefined();
  });
});
