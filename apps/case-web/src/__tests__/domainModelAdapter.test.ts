import { describe, it, expect } from 'vitest';
import { parseDomainModel, modelToFlowNodes } from '../adapter/domainModelAdapter';
import { DomainModelContractError } from '../domain/model';
import { DEFAULT_CANONICAL_FIXTURE } from '../App';

describe('domainModelAdapter — parseDomainModel & modelToFlowNodes', () => {
  it('parsea exitosamente el fixture canónico valid-minimal.json', () => {
    const model = parseDomainModel(DEFAULT_CANONICAL_FIXTURE);

    expect(model.contractVersion).toBe('1');
    expect(model.id).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(model.name).toBe('Biblioteca');
    expect(model.version).toBe('1.0.0');

    // Debe contener las dos clases del fixture
    expect(model.classes).toHaveLength(2);

    const libro = model.classes.find((c) => c.name === 'Libro');
    expect(libro).toBeDefined();
    expect(libro?.id).toBe('cls-01');
    expect(libro?.isAbstract).toBe(false);
    expect(libro?.attributes).toHaveLength(3);
    expect(libro?.attributes.map((a) => a.name)).toEqual(['titulo', 'isbn', 'fechaPublicacion']);
    expect(libro?.attributes.map((a) => a.type)).toEqual(['String', 'String', 'Date']);

    const autor = model.classes.find((c) => c.name === 'Autor');
    expect(autor).toBeDefined();
    expect(autor?.id).toBe('cls-02');
    expect(autor?.attributes).toHaveLength(1);
    expect(autor?.attributes[0].name).toBe('nombre');
    expect(autor?.attributes[0].type).toBe('String');
  });

  it('rechaza explícitamente versiones no soportadas del contrato (contractVersion != "1")', () => {
    const invalidVersionFixture = {
      contractVersion: '2',
      id: 'm-1',
      name: 'Modelo Incompatible',
      version: '1.0.0',
      packages: [],
      classes: [],
      associations: [],
    };

    expect(() => parseDomainModel(invalidVersionFixture)).toThrow(DomainModelContractError);

    try {
      parseDomainModel(invalidVersionFixture);
    } catch (err) {
      const contractErr = err as DomainModelContractError;
      expect(contractErr.code).toBe('UNSUPPORTED_CONTRACT_VERSION');
      expect(contractErr.message).toContain('Unsupported contractVersion "2"');
    }
  });

  it('rechaza documentos que no incluyan contractVersion', () => {
    const missingVersion = {
      id: 'm-1',
      name: 'Sin Version',
      version: '1.0.0',
      classes: [],
      packages: [],
      associations: [],
    };

    expect(() => parseDomainModel(missingVersion)).toThrow(
      /missing the mandatory "contractVersion" field/i
    );
  });

  it('rechaza documentos donde faltan los arrays obligatorios de clases o paquetes', () => {
    const missingClasses = {
      contractVersion: '1',
      id: 'm-1',
      name: 'Sin Classes',
      version: '1.0.0',
      packages: [],
      associations: [],
    };

    expect(() => parseDomainModel(missingClasses)).toThrow(/must be an array/i);
  });

  it('transforma clases a nodos de React Flow de forma dinámica y determinista', () => {
    const model = parseDomainModel(DEFAULT_CANONICAL_FIXTURE);
    const nodes = modelToFlowNodes(model);

    // 2 clases + 1 paquete del fixture
    expect(nodes).toHaveLength(3);
    expect(nodes.filter((n) => n.type === 'umlClass')).toHaveLength(2);
    expect(nodes.filter((n) => n.type === 'umlPackage')).toHaveLength(1);

    const libroNode = nodes.find((n) => n.id === 'cls-01');
    expect(libroNode).toBeDefined();
    expect(libroNode?.type).toBe('umlClass');
    expect(libroNode?.data.name).toBe('Libro');
    expect(libroNode?.data.attributes).toHaveLength(3);
    expect(libroNode?.position).toBeDefined();

    const autorNode = nodes.find((n) => n.id === 'cls-02');
    expect(autorNode).toBeDefined();
    expect(autorNode?.type).toBe('umlClass');
    expect(autorNode?.data.name).toBe('Autor');
    expect(autorNode?.data.attributes).toHaveLength(1);

    // Las posiciones son deterministas y separadas en cuadrícula
    expect(libroNode!.position.x).not.toBe(autorNode!.position.x);
  });

  it('no contiene lógica de dominio acoplada a entidades concretas', () => {
    // Un modelo arbitrario que no sea Biblioteca debe parsearse y mapearse idénticamente
    const customModel = {
      contractVersion: '1',
      id: 'custom-99',
      name: 'Hospital',
      version: '1.0.0',
      packages: [],
      classes: [
        {
          id: 'cls-paciente',
          name: 'Paciente',
          isAbstract: true,
          attributes: [
            { id: 'a1', name: 'historiaClinica', type: 'String', nullable: false, multiplicity: '1' },
          ],
        },
      ],
      associations: [],
    };

    const parsed = parseDomainModel(customModel);
    const nodes = modelToFlowNodes(parsed);
    const classNodes = nodes.filter((n) => n.type === 'umlClass');

    expect(classNodes).toHaveLength(1);
    expect(classNodes[0].data.name).toBe('Paciente');
    expect(classNodes[0].data.isAbstract).toBe(true);
    expect(classNodes[0].data.attributes[0].name).toBe('historiaClinica');
  });
});
