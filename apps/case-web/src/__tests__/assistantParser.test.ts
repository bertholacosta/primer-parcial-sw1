import { describe, expect, it } from 'vitest';
import { parseAssistantMessage } from '../assistant/assistantParser';
import type { CanonicalDomainModel } from '../domain/model';

const model: CanonicalDomainModel = {
  contractVersion: '1',
  id: 'm1',
  name: 'Test',
  version: '1.0.0',
  classes: [
    {
      id: 'cls-cliente',
      name: 'Cliente',
      attributes: [
        { id: 'attr-email', name: 'email', type: 'String', nullable: false, multiplicity: '1' },
      ],
    },
    {
      id: 'cls-venta',
      name: 'Venta',
      attributes: [
        { id: 'attr-fecha', name: 'fecha', type: 'Date', nullable: false, multiplicity: '1' },
      ],
    },
  ],
  associations: [
    {
      id: 'assoc-1',
      sourceClassId: 'cls-cliente',
      targetClassId: 'cls-venta',
      sourceMultiplicity: '1',
      targetMultiplicity: '0..*',
      navigability: 'unidirectional',
    },
  ],
};

describe('assistantParser — crear clase', () => {
  it('crea una clase simple', () => {
    const r = parseAssistantMessage('crea clase Producto', model);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0].type).toBe('CreateClass');
    expect(r.commands[0].payload.name).toBe('Producto');
    expect(r.commands[0].payload.id).toMatch(/^cls-/);
    expect(r.summary).toContain('Producto');
  });

  it('crea clase con atributos tipados y opcionales', () => {
    const r = parseAssistantMessage(
      'crea clase Producto con atributos nombre String, precio Integer y activo Boolean opcional',
      model
    );
    expect(r.commands).toHaveLength(4);
    expect(r.commands[0].type).toBe('CreateClass');
    const attrs = r.commands.slice(1);
    expect(attrs.every((c) => c.type === 'AddAttribute')).toBe(true);
    expect(attrs[0].payload).toMatchObject({ name: 'nombre', type: 'String', multiplicity: '1' });
    expect(attrs[1].payload).toMatchObject({ name: 'precio', type: 'Integer' });
    expect(attrs[2].payload).toMatchObject({ name: 'activo', type: 'Boolean', nullable: true, multiplicity: '0..1' });
    // Los atributos apuntan a la clase recién creada.
    expect(attrs[0].payload.classId).toBe(r.commands[0].payload.id);
  });

  it('sanitiza nombres compuestos con tildes', () => {
    const r = parseAssistantMessage('crea clase línea de pedido', model);
    expect(r.commands[0].payload.name).toBe('LineaDePedido');
  });

  it('rechaza clase duplicada con aclaración', () => {
    const r = parseAssistantMessage('crea clase Cliente', model);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toContain("Ya existe la clase 'Cliente'");
  });
});

describe('assistantParser — atributos', () => {
  it('añade atributo a clase existente', () => {
    const r = parseAssistantMessage('añade atributo telefono String a Cliente', model);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).toMatchObject({
      type: 'AddAttribute',
      payload: { classId: 'cls-cliente', name: 'telefono', type: 'String' },
    });
  });

  it('rechaza atributo en clase inexistente', () => {
    const r = parseAssistantMessage('añade atributo x String a Fantasma', model);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toContain("No encuentro la clase 'Fantasma'");
  });

  it('rechaza atributo duplicado', () => {
    const r = parseAssistantMessage('añade atributo email String a Cliente', model);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toContain('ya tiene el atributo');
  });

  it('rechaza tipo desconocido', () => {
    const r = parseAssistantMessage('añade atributo saldo Dinero a Cliente', model);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toContain("Tipo 'Dinero' no reconocido");
  });

  it('elimina atributo por nombre', () => {
    const r = parseAssistantMessage('elimina atributo email de Cliente', model);
    expect(r.commands[0]).toMatchObject({
      type: 'DeleteAttribute',
      payload: { classId: 'cls-cliente', attributeId: 'attr-email' },
    });
  });

  it('cambia el tipo de un atributo', () => {
    const r = parseAssistantMessage('cambia tipo de fecha en Venta a DateTime', model);
    expect(r.commands[0]).toMatchObject({
      type: 'UpdateAttribute',
      payload: { attributeId: 'attr-fecha', classId: 'cls-venta', type: 'DateTime' },
    });
  });

  it('marca atributo como opcional', () => {
    const r = parseAssistantMessage('haz email de Cliente opcional', model);
    expect(r.commands[0]).toMatchObject({
      type: 'UpdateAttribute',
      payload: { attributeId: 'attr-email', classId: 'cls-cliente', multiplicity: '0..1', nullable: true },
    });
  });
});

describe('assistantParser — clases', () => {
  it('renombra clase existente', () => {
    const r = parseAssistantMessage('renombra Cliente a Persona', model);
    expect(r.commands[0]).toMatchObject({
      type: 'RenameClass',
      payload: { classId: 'cls-cliente', newName: 'Persona' },
    });
  });

  it('elimina clase y avisa de la cascada', () => {
    const r = parseAssistantMessage('elimina clase Cliente', model);
    expect(r.commands[0]).toMatchObject({
      type: 'DeleteClass',
      payload: { classId: 'cls-cliente' },
    });
    expect(r.summary).toContain('1 relación');
  });
});

describe('assistantParser — relaciones', () => {
  it('crea asociación con defaults estructurales', () => {
    const r = parseAssistantMessage('crea asociación entre Venta y Cliente', model);
    expect(r.commands[0]).toMatchObject({
      type: 'CreateAssociation',
      payload: {
        sourceClassId: 'cls-venta',
        targetClassId: 'cls-cliente',
      },
    });
    expect(r.commands[0].payload.kind).toBe('association');
    expect(r.commands[0].payload.targetMultiplicity).toBe('0..*');
    expect(r.commands[0].payload.navigability).toBe('bidirectional');
  });

  it('crea generalización vía "herencia"', () => {
    const r = parseAssistantMessage('crea herencia entre Venta y Cliente', model);
    expect(r.commands[0].payload.kind).toBe('generalization');
    expect(r.commands[0].payload.navigability).toBe('unidirectional');
  });

  it('rechaza auto-asociación', () => {
    const r = parseAssistantMessage('crea asociación entre Cliente y Cliente', model);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toContain('auto-asociaciones');
  });

  it('elimina relación existente en cualquier dirección', () => {
    const r = parseAssistantMessage('elimina relación entre Venta y Cliente', model);
    expect(r.commands[0]).toMatchObject({
      type: 'DeleteAssociation',
      payload: { associationId: 'assoc-1' },
    });
  });

  it('informa si no hay relación', () => {
    const empty: CanonicalDomainModel = { ...model, associations: [] };
    const r = parseAssistantMessage('elimina relación entre Venta y Cliente', empty);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toContain('No hay ninguna relación');
  });
});

describe('assistantParser — fallback', () => {
  it('ayuda lista capacidades', () => {
    const r = parseAssistantMessage('ayuda', model);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toContain('crea clase');
  });

  it('instrucción irreconocible pide aclaración sin mutar', () => {
    const r = parseAssistantMessage('pinta el diagrama de azul', model);
    expect(r.commands).toHaveLength(0);
    expect(r.clarification).toBeTruthy();
  });
});
