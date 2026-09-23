import { describe, it, expect } from 'vitest';
import {
  importEnterpriseArchitectXmi,
  buildEaImportCommands,
  sanitizeIdentifier,
} from '../generator/enterpriseArchitectImporter';
import { buildEnterpriseArchitectXmi } from '../generator/enterpriseArchitectGenerator';
import type { CanonicalDomainModel } from '../domain/model';

const EA_XMI = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>
  <uml:Model xmi:id="M1" name="Ventas">
    <packagedElement xmi:type="uml:Package" xmi:id="P1" name="ventas">
      <packagedElement xmi:type="uml:Class" xmi:id="C1" name="Cliente">
        <ownedAttribute xmi:type="uml:Property" xmi:id="A1" name="nombre" type="String">
          <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
          <upperValue xmi:type="uml:LiteralInteger" value="1"/>
        </ownedAttribute>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="C2" name="Pedido"/>
      <packagedElement xmi:type="uml:Association" xmi:id="AS1" name="realiza">
        <ownedEnd xmi:type="uml:Property" xmi:id="E1"><type xmi:idref="C1"/><lowerValue xmi:type="uml:LiteralInteger" value="1"/><upperValue xmi:type="uml:LiteralInteger" value="1"/></ownedEnd>
        <ownedEnd xmi:type="uml:Property" xmi:id="E2"><type xmi:idref="C2"/><lowerValue xmi:type="uml:LiteralInteger" value="0"/><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="-1"/></ownedEnd>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="C3" name="PedidoVIP">
        <generalization xmi:type="uml:Generalization" xmi:id="G1" general="C2"/>
      </packagedElement>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

const emptyModel: CanonicalDomainModel = {
  contractVersion: '1',
  id: 'm-existing',
  name: 'Existente',
  version: '1.0.0',
  classes: [],
  associations: [],
};

describe('importEnterpriseArchitectXmi', () => {
  it('parsea un XMI de EA 15 a modelo canónico (clases, atributos, asociaciones, generalización)', () => {
    const result = importEnterpriseArchitectXmi(EA_XMI);
    expect(result.outcome).toBe('success');
    const model = result.model!;
    expect(model.name).toBe('Ventas');
    // Los uml:Package de EA se atraviesan pero no se materializan: solo existe
    // el paquete raíz y se avisa con PACKAGE_FLATTENED.
    expect(result.diagnostics.some((d) => d.code === 'PACKAGE_FLATTENED')).toBe(true);
    expect(model.classes.map((c) => c.name).sort()).toEqual(['Cliente', 'Pedido', 'PedidoVIP']);
    const gen = model.associations.find((a) => a.kind === 'generalization');
    expect(gen?.sourceClassId).toBe('C3');
    expect(gen?.targetClassId).toBe('C2');
  });

  it('rechaza XML que no es XMI de EA con diagnóstico', () => {
    const result = importEnterpriseArchitectXmi('<html><body>hola</body></html>');
    expect(result.outcome).toBe('error');
    expect(result.model).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('sanitizeIdentifier', () => {
  it('normaliza espacios, acentos y dígitos iniciales', () => {
    expect(sanitizeIdentifier('Order Line')).toBe('Order_Line');
    expect(sanitizeIdentifier('Línea Asignación')).toBe('Linea_Asignacion');
    expect(sanitizeIdentifier('2da Clase')).toBe('_2da_Clase');
    expect(sanitizeIdentifier('Cliente')).toBe('Cliente');
  });
});

describe('buildEaImportCommands', () => {
  it('genera comandos ordenados: clases (planas, sin paquetes), atributos, relaciones; ids remapeados', () => {
    const imported = importEnterpriseArchitectXmi(EA_XMI).model!;
    const plan = buildEaImportCommands(imported, emptyModel);

    expect(plan.blocked).toBe(false);

    const types = plan.commands.map((c) => c.type);
    // Orden: CreateClass ×3 → AddAttribute → CreateAssociation ×2
    expect(types.slice(0, 3)).toEqual(['CreateClass', 'CreateClass', 'CreateClass']);
    expect(types[3]).toBe('AddAttribute');
    expect(types.slice(4)).toEqual(['CreateAssociation', 'CreateAssociation']);

    // Los ids del XMI (C1…) se remapean y las clases van a la raíz
    const clsCmds = plan.commands.filter((c) => c.type === 'CreateClass');
    const newIds = new Set(clsCmds.map((c) => c.payload.id as string));
    expect([...newIds].every((id) => id.startsWith('cls-'))).toBe(true);

    const assocCmds = plan.commands.filter((c) => c.type === 'CreateAssociation');
    const gen = assocCmds.find((c) => c.payload.kind === 'generalization')!;
    const vip = clsCmds.find((c) => c.payload.name === 'PedidoVIP')!;
    const pedido = clsCmds.find((c) => c.payload.name === 'Pedido')!;
    expect(gen.payload.sourceClassId).toBe(vip.payload.id);
    expect(gen.payload.targetClassId).toBe(pedido.payload.id);

    const normal = assocCmds.find((c) => c.payload.kind !== 'generalization')!;
    expect(normal.payload.sourceMultiplicity).toBe('1');
    expect(normal.payload.targetMultiplicity).toBe('0..*');
  });

  it('sanitiza nombres no identificadores y avisa con NAME_SANITIZED', () => {
    const imported: CanonicalDomainModel = {
      ...emptyModel,
      id: 'imp',
      name: 'Imp',
      classes: [
        {
          id: 'X1',
          name: 'Línea de Pedido',
          attributes: [
            { id: 'a1', name: 'cantidad total', type: 'Integer', nullable: false, multiplicity: '1' },
          ],
        },
      ],
    };
    const plan = buildEaImportCommands(imported, emptyModel);
    expect(plan.blocked).toBe(false);
    expect(plan.diagnostics.filter((d) => d.code === 'NAME_SANITIZED')).toHaveLength(2);
    const cls = plan.commands.find((c) => c.type === 'CreateClass')!;
    expect(cls.payload.name).toBe('Linea_de_Pedido');
    const attr = plan.commands.find((c) => c.type === 'AddAttribute')!;
    expect(attr.payload.name).toBe('cantidad_total');
  });

  it('bloquea si una clase raíz importada colisiona con una existente', () => {
    const existing: CanonicalDomainModel = {
      ...emptyModel,
      classes: [{ id: 'e1', name: 'Cliente', attributes: [] }],
    };
    const imported: CanonicalDomainModel = {
      ...emptyModel,
      id: 'imp',
      classes: [{ id: 'X1', name: 'Cliente', attributes: [] }],
    };
    const plan = buildEaImportCommands(imported, existing);
    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics.some((d) => d.code === 'IMPORT_NAME_COLLISION')).toBe(true);
  });

  it('dos clases homónimas importadas colisionan en el ámbito raíz único', () => {
    const imported: CanonicalDomainModel = {
      ...emptyModel,
      id: 'imp',
      classes: [
        { id: 'X1', name: 'Cliente', attributes: [] },
        { id: 'X2', name: 'Cliente', attributes: [] },
      ],
    };
    const plan = buildEaImportCommands(imported, emptyModel);
    expect(plan.blocked).toBe(true);
    expect(
      plan.diagnostics.some(
        (d) => d.code === 'IMPORT_NAME_COLLISION' && d.message.includes('Dos clases')
      )
    ).toBe(true);
  });

  it('la clase-asociación importada genera CreateClass portadora + CreateAssociation', () => {
    const imported: CanonicalDomainModel = {
      ...emptyModel,
      id: 'imp',
      classes: [
        { id: 'X1', name: 'Venta', attributes: [] },
        { id: 'X2', name: 'Producto', attributes: [] },
        { id: 'ACL_AS1', name: 'Detalle', attributes: [
          { id: 'a9', name: 'cantidad', type: 'Integer', nullable: false, multiplicity: '1' },
        ]},
      ],
      associations: [
        {
          id: 'AS1', name: 'detalle', sourceClassId: 'X1', targetClassId: 'X2',
          sourceMultiplicity: '1', targetMultiplicity: '0..*',
          navigability: 'bidirectional', kind: 'associationClass', associationClassId: 'ACL_AS1',
        },
      ],
    };
    const plan = buildEaImportCommands(imported, emptyModel);
    expect(plan.blocked).toBe(false);
    const assoc = plan.commands.find((c) => c.type === 'CreateAssociation')!;
    expect(assoc.payload.kind).toBe('associationClass');
    const carrier = plan.commands.find(
      (c) => c.type === 'CreateClass' && c.payload.name === 'Detalle'
    )!;
    expect(assoc.payload.associationClassId).toBe(carrier.payload.id);
  });
});

describe('round-trip EA: exportar → importar', () => {
  it('el XMI exportado por el editor se reimporta preservando kinds', () => {
    const model: CanonicalDomainModel = {
      contractVersion: '1',
      id: 'MRT',
      name: 'RtModel',
      version: '1.0.0',
      classes: [
        { id: 'K1', name: 'Venta', attributes: [] },
        { id: 'K2', name: 'Vendedor', attributes: [] },
        { id: 'K3', name: 'VentaOnline', attributes: [] },
      ],
      associations: [
        {
          id: 'R1', sourceClassId: 'K1', targetClassId: 'K2',
          sourceMultiplicity: '0..*', targetMultiplicity: '1',
          navigability: 'unidirectional', kind: 'association',
        },
        {
          id: 'R2', sourceClassId: 'K3', targetClassId: 'K1',
          sourceMultiplicity: '1', targetMultiplicity: '1',
          navigability: 'unidirectional', kind: 'generalization',
        },
      ],
    };
    const xmi = buildEnterpriseArchitectXmi(model);
    const result = importEnterpriseArchitectXmi(xmi);
    expect(result.outcome).toBe('success');
    const kinds = result.model!.associations.map((a) => a.kind ?? 'association').sort();
    expect(kinds).toEqual(['association', 'generalization']);
  });
});
