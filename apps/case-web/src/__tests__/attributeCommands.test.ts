import { describe, it, expect } from 'vitest';
import { parseDomainModel } from '../adapter/domainModelAdapter';
import {
  executeAddAttribute,
  executeUpdateAttribute,
  type AddAttributeCommand,
  type UpdateAttributeCommand,
} from '../commands/attributeCommands';
import { DEFAULT_CANONICAL_FIXTURE } from '../App';

describe('attributeCommands — AddAttribute & UpdateAttribute (P4-004)', () => {
  const getInitialModel = () => parseDomainModel(DEFAULT_CANONICAL_FIXTURE);

  describe('AddAttribute', () => {
    it('agrega un atributo válido a una clase existente e incrementa la versión en PATCH', () => {
      const model = getInitialModel();

      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: 'cmd-add-01',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-editorial',
          classId: 'cls-01', // Libro
          name: 'editorial',
          type: 'String',
          nullable: true,
          multiplicity: '0..1',
          description: 'Editorial del libro',
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);

      expect(result.result).toBe('accepted');
      expect(result.modelVersion).toBe('1.0.1');
      expect(updatedModel.version).toBe('1.0.1');

      const libro = updatedModel.classes.find((c) => c.id === 'cls-01');
      expect(libro?.attributes).toHaveLength(4); // 3 originales + 1 nuevo

      const added = libro?.attributes.find((a) => a.id === 'attr-editorial');
      expect(added).toBeDefined();
      expect(added?.name).toBe('editorial');
      expect(added?.type).toBe('String');
      expect(added?.nullable).toBe(true);
      expect(added?.multiplicity).toBe('0..1');
      expect(added?.description).toBe('Editorial del libro');

      // Autor no se modificó
      const autor = updatedModel.classes.find((c) => c.id === 'cls-02');
      expect(autor?.attributes).toHaveLength(1);
    });

    it('rechaza y no muta el modelo si la clase destino no existe (CLASS_NOT_FOUND)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: 'cmd-add-err-class',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-ghost',
          classId: 'cls-inexistente',
          name: 'fantasma',
          type: 'String',
          nullable: false,
          multiplicity: '1',
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.[0].code).toBe('CLASS_NOT_FOUND');
      // Invariante §2.3: el modelo se mantiene idéntico
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
      expect(JSON.stringify(model)).toBe(snapshot);
    });

    it('rechaza y no muta el modelo si ya existe un atributo con el mismo nombre en la clase (DUPLICATE_ATTRIBUTE_NAME)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: 'cmd-add-dup-name',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-dup-name',
          classId: 'cls-01',
          name: 'titulo', // 'titulo' ya existe en Libro
          type: 'String',
          nullable: false,
          multiplicity: '1',
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.some((e) => e.code === 'DUPLICATE_ATTRIBUTE_NAME')).toBe(true);
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });

    it('rechaza y no muta el modelo si el tipo no es canónico (UNKNOWN_TYPE)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: 'cmd-add-bad-type',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-bad-type',
          classId: 'cls-01',
          name: 'campoInvalido',
          type: 'List<String>', // No permitido en corte mínimo
          nullable: false,
          multiplicity: '1',
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.some((e) => e.code === 'UNKNOWN_TYPE')).toBe(true);
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });

    it('rechaza y no muta el modelo si el formato del identificador es inválido (INVALID_NAME_FORMAT)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: 'cmd-add-bad-name',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-bad-id-format',
          classId: 'cls-01',
          name: '123-Invalido!',
          type: 'String',
          nullable: false,
          multiplicity: '1',
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.some((e) => e.code === 'INVALID_NAME_FORMAT')).toBe(true);
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });

    it('rechaza y no muta el modelo si la multiplicidad es inválida (INVALID_MULTIPLICITY)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: 'cmd-add-bad-mult',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-bad-mult',
          classId: 'cls-01',
          name: 'paginas',
          type: 'Integer',
          nullable: false,
          multiplicity: '2..5', // No permitido
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.some((e) => e.code === 'INVALID_MULTIPLICITY')).toBe(true);
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });

    it('rechaza si ya existe un atributo con el mismo ID en el modelo (DUPLICATE_ID)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: 'cmd-dup-id',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-01', // Ya existe en cls-01
          classId: 'cls-02',
          name: 'nuevoCampo',
          type: 'String',
          nullable: false,
          multiplicity: '1',
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });
  });

  describe('UpdateAttribute', () => {
    it('renombra exitosamente un atributo e incrementa la versión en PATCH', () => {
      const model = getInitialModel();

      const command: UpdateAttributeCommand = {
        type: 'UpdateAttribute',
        commandId: 'cmd-upd-01',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-02', // isbn
          classId: 'cls-01',
          name: 'codigoIsbn',
        },
      };

      const { updatedModel, result } = executeUpdateAttribute(model, command);

      expect(result.result).toBe('accepted');
      expect(result.modelVersion).toBe('1.0.1');

      const libro = updatedModel.classes.find((c) => c.id === 'cls-01');
      const attr = libro?.attributes.find((a) => a.id === 'attr-02');
      expect(attr?.name).toBe('codigoIsbn');
      expect(attr?.type).toBe('String'); // Conserva el tipo previo
    });

    it('rechaza y no muta el modelo si el atributo a renombrar no existe (ATTRIBUTE_NOT_FOUND)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: UpdateAttributeCommand = {
        type: 'UpdateAttribute',
        commandId: 'cmd-upd-not-found',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-inexistente',
          classId: 'cls-01',
          name: 'nuevoNombre',
        },
      };

      const { updatedModel, result } = executeUpdateAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.[0].code).toBe('ATTRIBUTE_NOT_FOUND');
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });

    it('rechaza y no muta el modelo si el nuevo nombre colisiona con otro atributo de la clase (DUPLICATE_ATTRIBUTE_NAME)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: UpdateAttributeCommand = {
        type: 'UpdateAttribute',
        commandId: 'cmd-upd-dup',
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: 'attr-02', // isbn
          classId: 'cls-01',
          name: 'titulo', // Ya ocupado por attr-01
        },
      };

      const { updatedModel, result } = executeUpdateAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.some((e) => e.code === 'DUPLICATE_ATTRIBUTE_NAME')).toBe(true);
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });

    it('rechaza si la versión esperada no coincide por concurrencia optimista (CONCURRENT_MODIFICATION)', () => {
      const model = getInitialModel();
      const snapshot = JSON.stringify(model);

      const command: UpdateAttributeCommand = {
        type: 'UpdateAttribute',
        commandId: 'cmd-concurrent',
        modelId: model.id,
        modelVersion: '0.9.0', // Versión desfasada
        payload: {
          attributeId: 'attr-02',
          classId: 'cls-01',
          name: 'nuevoIsbn',
        },
      };

      const { updatedModel, result } = executeUpdateAttribute(model, command);

      expect(result.result).toBe('rejected');
      expect(result.errors?.some((e) => e.code === 'CONCURRENT_MODIFICATION')).toBe(true);
      expect(JSON.stringify(updatedModel)).toBe(snapshot);
    });
  });
});
