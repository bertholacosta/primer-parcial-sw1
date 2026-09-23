import { describe, it, expect } from 'vitest';
import { exportXmi, importXmi, parseXml, CanonicalDomainModel } from '../src/index.js';

const baseModel: CanonicalDomainModel = {
  contractVersion: '1',
  id: 'MODEL_EA15',
  name: 'Inventario',
  version: '1.0.0',
  packages: [],
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
    expect(xmi).toContain('<xmi:Documentation exporter="Enterprise Architect" exporterVersion="15.0.1514.12"/>');
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
    expect(xmi).not.toMatch(/xmi:id="END_ASSOC_COMP_TGT"[^>]*aggregation=/);
  });

  it('marca isNavigable="false" en el extremo origen para navegabilidad unidireccional', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toMatch(/xmi:id="END_ASSOC_COMP_SRC"[^>]*isNavigable="false"/);
    expect(xmi).not.toMatch(/xmi:id="END_ASSOC_COMP_TGT"[^>]*isNavigable/);
  });

  it('emite uml:Generalization dentro de la clase específica (origen)', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain('<generalization xmi:type="uml:Generalization" xmi:id="ASSOC_GEN" general="CLS_BASE"');
    // La generalización no se emite como uml:Association
    const assocElements = xmi.match(/xmi:type="uml:Association"/g) ?? [];
    // Solo ASSOC_COMP es uml:Association (ASSOC_ACLASS es AssociationClass, ASSOC_GEN no cuenta)
    expect(assocElements.length).toBe(1);
  });

  it('emite uml:Dependency con client/supplier', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain(
      '<packagedElement xmi:type="uml:Dependency" xmi:id="ASSOC_DEP" client="CLS_TODO" supplier="CLS_AUDIT" name="usa"/>'
    );
  });

  it('fusiona la clase portadora en uml:AssociationClass sin duplicarla como uml:Class', () => {
    const xmi = exportXmi(baseModel);
    expect(xmi).toContain('xmi:type="uml:AssociationClass"');
    expect(xmi).toContain('xmi:id="ASSOC_ACLASS"');
    // Los atributos de la portadora van dentro del AssociationClass
    expect(xmi).toContain('name="cantidad"');
    // La portadora no aparece como uml:Class separada
    const classMatches = xmi.match(/xmi:type="uml:Class"/g) ?? [];
    // 5 clases reales (la portadora CLS_LINEA no se duplica)
    expect(classMatches.length).toBe(5);
  });

  it('omite el atributo name cuando la asociación no tiene nombre', () => {
    const xmi = exportXmi(baseModel);
    const genLine = xmi.split('\n').find(l => l.includes('ASSOC_GEN'))!;
    expect(genLine).not.toContain('name=');
  });

  it('el XMI exportado se reimporta sin errores bloqueantes (round-trip)', () => {
    const result = importXmi(exportXmi(baseModel), { verbose: true });
    expect(result.outcome).toBe('success');
    expect(result.diagnostics.filter(d => d.severity === 'ERROR')).toHaveLength(0);
    // Asociaciones normales sobreviven al round-trip
    const assocIds = result.canonicalModel!.associations.map(a => a.id);
    expect(assocIds).toContain('ASSOC_COMP');
    // Los elementos fuera del perfil v1 se ignoran con diagnóstico informativo
    expect(result.diagnostics.some(d => d.code === 'ELEMENT_IGNORED')).toBe(true);
  });
});
