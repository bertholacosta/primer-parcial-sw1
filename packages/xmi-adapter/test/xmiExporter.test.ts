import { describe, it, expect } from 'vitest';
import { exportXmi, importXmi, parseXml, CanonicalDomainModel } from '../src/index.js';

const baseModel: CanonicalDomainModel = {
  contractVersion: '1',
  id: 'MODEL_EA15',
  name: 'Inventario',
  version: '1.0.0',
  classes: [
    {
      id: 'CLS_TODO',
      name: 'Todo',
      attributes: [
        { id: 'ATTR_01', name: 'nombre', type: 'String', nullable: false, multiplicity: '1' }
      ]
    },
    { id: 'CLS_PARTE', name: 'Parte', attributes: [] },
    { id: 'CLS_BASE', name: 'EntidadBase', attributes: [] },
    { id: 'CLS_HIJA', name: 'EntidadHija', attributes: [] },
    { id: 'CLS_AUDIT', name: 'Auditoria', attributes: [] },
    {
      id: 'CLS_LINEA',
      name: 'LineaAsignacion',
      attributes: [
        { id: 'ATTR_L1', name: 'cantidad', type: 'Integer', nullable: false, multiplicity: '1' }
      ]
    }
  ],
  associations: [
    {
      id: 'ASSOC_COMP',
      name: 'compone',
      sourceClassId: 'CLS_TODO',
      targetClassId: 'CLS_PARTE',
      sourceMultiplicity: '1',
      targetMultiplicity: '1..*',
      navigability: 'unidirectional',
      kind: 'composition'
    },
    {
      id: 'ASSOC_GEN',
      sourceClassId: 'CLS_HIJA',
      targetClassId: 'CLS_BASE',
      sourceMultiplicity: '1',
      targetMultiplicity: '1',
      navigability: 'unidirectional',
      kind: 'generalization'
    },
    {
      id: 'ASSOC_DEP',
      name: 'usa',
      sourceClassId: 'CLS_TODO',
      targetClassId: 'CLS_AUDIT',
      sourceMultiplicity: '1',
      targetMultiplicity: '1',
      navigability: 'unidirectional',
      kind: 'dependency'
    },
    {
      id: 'ASSOC_ACLASS',
      name: 'asignacion',
      sourceClassId: 'CLS_TODO',
      targetClassId: 'CLS_AUDIT',
      sourceMultiplicity: '0..1',
      targetMultiplicity: '0..*',
      navigability: 'bidirectional',
      kind: 'associationClass',
      associationClassId: 'CLS_LINEA'
    }
  ]
};

describe('XMI Exporter — Enterprise Architect 15.0.1514.12', () => {
  it('declara EA 15.0.1514.12 como versión de exportador por defecto', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain('xmi:exporter="Enterprise Architect"');
    expect(xmi).toContain('xmi:exporterVersion="15.0.1514.12"');
    // EA escribe la versión del extender XMI ('6.5'), no la del producto.
    expect(xmi).toContain('<xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>');
    expect(xmi).toContain('xmi:version="2.1"');
  });

  it('permite sobreescribir la versión de EA declarada', () => {
    const xmi = exportXmi(baseModel, { eaVersion: '16.0' });
    expect(xmi).toContain('xmi:exporterVersion="16.0"');
  });

  it('produce XML bien formado parseable por el propio adaptador', () => {
    const doc = parseXml(exportXmi(baseModel));
    expect(doc.name).toBe('xmi:XMI');
  });

  it('mapea composition a uml:Association con aggregation="composite" en el extremo del todo', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain('xmi:type="uml:Association"');
    expect(xmi).toMatch(/xmi:id="END_ASSOC_COMP_SRC"[^>]*aggregation="composite"/);
    expect(xmi).toMatch(/xmi:id="END_ASSOC_COMP_TGT"[^>]*aggregation="none"/);
  });

  it('marca isNavigable="false" en el extremo origen para navegabilidad unidireccional', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toMatch(/xmi:id="END_ASSOC_COMP_SRC"[^>]*isNavigable="false"/);
    expect(xmi).not.toMatch(/xmi:id="END_ASSOC_COMP_TGT"[^>]*isNavigable/);
  });

  it('emite los extremos en formato EA: association="<id>" y tipo como hijo <type xmi:idref>', () => {
    const xmi = exportXmi(baseModel);
    const umlPart = xmi.split('<xmi:Extension')[0];
    // El extremo referencia su asociación y su clasificador como elemento hijo,
    // no como atributo type="..." — EA descarta el conector en el formato viejo.
    expect(umlPart).toMatch(
      /<ownedEnd xmi:type="uml:Property" xmi:id="END_ASSOC_COMP_SRC" association="ASSOC_COMP"[^>]*>\s*<type xmi:idref="CLS_TODO"\/>/
    );
    expect(umlPart).toMatch(
      /<ownedEnd xmi:type="uml:Property" xmi:id="END_ASSOC_COMP_TGT" association="ASSOC_COMP"[^>]*>\s*<type xmi:idref="CLS_PARTE"\/>/
    );
    expect(umlPart).not.toMatch(/<ownedEnd[^>]* type="CLS_/);
    // Los atributos emiten el tipo como hijo: href a PrimitiveTypes.xmi para
    // primitivos UML, o xmi:idref="EAnone_..." para tipos internos de EA
    expect(umlPart).toMatch(/<type xmi:type="uml:PrimitiveType" href="[^"]*PrimitiveTypes\.xmi#/);
    expect(umlPart).not.toMatch(/<ownedAttribute[^>]* type="/);
  });

  it('emite uml:Generalization dentro de la clase específica (origen)', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain('<generalization xmi:type="uml:Generalization" xmi:id="ASSOC_GEN" general="CLS_BASE"');
    // La generalización no se emite como uml:Association
    const assocElements = xmi.match(/xmi:type="uml:Association"/g) ?? [];
    // ASSOC_COMP es uml:Association; ASSOC_ACLASS es uml:AssociationClass; ASSOC_GEN no
    expect(assocElements.length).toBe(1);
  });

  it('emite uml:Dependency con client/supplier', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain(
      '<packagedElement xmi:type="uml:Dependency" xmi:id="ASSOC_DEP" client="CLS_TODO" supplier="CLS_AUDIT" name="usa"/>'
    );
  });

  it('emite la clase-asociación como uml:AssociationClass fusionado (clase + extremos)', () => {
    const xmi = exportXmi(baseModel);
    const umlPart = xmi.split('<xmi:Extension')[0];
    // Un único elemento que es clase y asociación: nombre de la portadora,
    // atributos de la portadora y extremos de la asociación.
    expect(umlPart).toMatch(
      /<packagedElement xmi:type="uml:AssociationClass"\s+xmi:id="ASSOC_ACLASS" name="LineaAsignacion" visibility="public">/
    );
    expect(umlPart).toContain('name="cantidad"');
    expect(umlPart).toMatch(/<ownedEnd[^>]*association="ASSOC_ACLASS"/);
    // La portadora no se duplica como uml:Class independiente
    expect(umlPart).not.toContain('xmi:id="CLS_LINEA"');
    const classMatches = umlPart.match(/xmi:type="uml:Class"/g) ?? [];
    expect(classMatches.length).toBe(5);
    // Formato EA 15: el conector tiene identidad propia (CONN_<id>),
    // subtype="Class" y associationclass apunta al elemento fusionado.
    expect(xmi).toContain('<connector xmi:idref="CONN_ASSOC_ACLASS" name="LineaAsignacion">');
    expect(xmi).toContain('<properties ea_type="Association" subtype="Class"');
    expect(xmi).toMatch(/associationclass="ASSOC_ACLASS" privatedata1="\d+"/);
    expect(xmi).toContain('<element xmi:idref="ASSOC_ACLASS" xmi:type="uml:Class" name="LineaAsignacion"');
    // El elemento declara nType="17" y enlaza al conector vía conID
    expect(xmi).toContain('nType="17"');
    expect(xmi).toContain('conID="CONN_ASSOC_ACLASS"');
  });

  it('emite la extensión EA con un diagrama de clases Logical y geometría de elementos', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain('<xmi:Extension extender="Enterprise Architect" extenderID="6.5">');
    expect(xmi).toContain('<diagrams>');
    expect(xmi).toContain(`type="Logical"`);
    expect(xmi).toContain(`name="${baseModel.name}"`);
    // Cada clase tiene un elemento de diagrama con geometría y DUID (la
    // portadora CLS_LINEA no: su caja usa el id de la asociación)
    for (const cls of baseModel.classes) {
      if (cls.id === 'CLS_LINEA') {
        continue;
      }
      expect(xmi).toMatch(new RegExp(`geometry="Left=\\d+;Top=\\d+;Right=\\d+;Bottom=\\d+;" subject="${cls.id}"`));
    }
    // La clase-asociación tiene su caja con el id del elemento fusionado
    expect(xmi).toMatch(/geometry="Left=\d+;Top=\d+;Right=\d+;Bottom=\d+;" subject="ASSOC_ACLASS"/);
    // Los conectores referencian los DUID de origen/destino
    expect(xmi).toMatch(/subject="ASSOC_COMP" style="Mode=3;EOID=[0-9A-F]{8};SOID=[0-9A-F]{8};/);
  });

  it('emite <elements> y <connectors> de la extensión EA con roles y multiplicidades', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain('<connectors>');
    expect(xmi).toContain('<properties ea_type="Association"');
    expect(xmi).toContain('<properties ea_type="Generalization"');
    expect(xmi).toContain('<properties ea_type="Dependency"');
    // La composición lleva aggregation="composite" en el extremo del todo (source)
    // (EA usa notación de rango: '1' → '1..1')
    expect(xmi).toMatch(/<type multiplicity="1\.\.1" aggregation="composite"/);
    // Las clases listan sus conectores en <links>
    expect(xmi).toContain('<links>');
    expect(xmi).toContain('<Association xmi:id="ASSOC_COMP" start="CLS_TODO" end="CLS_PARTE"/>');
    expect(xmi).toContain('<Generalization xmi:id="ASSOC_GEN" start="CLS_HIJA" end="CLS_BASE"/>');
  });

  it('omite el atributo name cuando la asociación no tiene nombre', () => {
    const xmi = exportXmi(baseModel);
    const genLine = xmi.split('\n').find(l => l.includes('ASSOC_GEN'))!;
    expect(genLine).not.toContain('name=');
  });

  it('el XMI exportado se reimporta sin errores bloqueantes y conserva los kinds (round-trip)', () => {
    const result = importXmi(exportXmi(baseModel), { verbose: true });
    expect(result.outcome).toBe('success');
    expect(result.diagnostics.filter(d => d.severity === 'ERROR')).toHaveLength(0);
    // Desde xmi-profile v1.1 los kinds sobreviven al round-trip completo.
    const byId = new Map(result.canonicalModel!.associations.map(a => [a.id, a]));
    expect(byId.get('ASSOC_COMP')?.kind).toBe('composition');
    expect(byId.get('ASSOC_GEN')?.kind).toBe('generalization');
    expect(byId.get('ASSOC_DEP')?.kind).toBe('dependency');
    const aclass = byId.get('ASSOC_ACLASS');
    expect(aclass?.kind).toBe('associationClass');
    // La clase portadora se materializa con id derivado y sus atributos
    const carrier = result.canonicalModel!.classes.find(c => c.id === aclass?.associationClassId);
    expect(carrier?.name).toBe('LineaAsignacion');
    expect(carrier?.attributes.map(a => a.name)).toEqual(['cantidad']);
  });
});
