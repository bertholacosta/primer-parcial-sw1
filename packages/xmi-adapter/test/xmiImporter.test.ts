import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importXmi } from '../src/index.js';
import { validate } from '../../domain-validator/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../../../fixtures/xmi');

describe('XMI Importer - Enterprise Architect v1 Profile', () => {
  it('01-minimal-import: should import minimal model and match expected canonical output', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '01-minimal-import/input.xmi'), 'utf-8');
    const expectedJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, '01-minimal-import/expected-canonical.json'), 'utf-8'));

    const result = importXmi(inputXmi);
    expect(result.outcome).toBe('success');
    expect(result.canonicalModel).not.toBeNull();
    expect(result.canonicalModel).toEqual(expectedJson);

    // Conformance with canonical domain validator
    const validationResult = validate(result.canonicalModel!);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.errors).toHaveLength(0);
  });

  it('02-associations: should import associations with multiplicities and navigability correctly', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '02-associations/input.xmi'), 'utf-8');
    const expectedJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, '02-associations/expected-canonical.json'), 'utf-8'));

    const result = importXmi(inputXmi);
    expect(result.outcome).toBe('success');
    expect(result.canonicalModel).not.toBeNull();
    expect(result.canonicalModel).toEqual(expectedJson);

    // Conformance with canonical domain validator
    const validationResult = validate(result.canonicalModel!);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.errors).toHaveLength(0);
  });

  it('03-ignored-elements: should ignore unmodeled EA extensions and parse plain text comments', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '03-ignored-elements/input.xmi'), 'utf-8');
    const expectedJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, '03-ignored-elements/expected-canonical.json'), 'utf-8'));

    const result = importXmi(inputXmi);
    expect(result.outcome).toBe('success');
    expect(result.canonicalModel).not.toBeNull();
    expect(result.canonicalModel).toEqual(expectedJson);

    // Warning about HTML comment discarded
    const htmlWarning = result.diagnostics.find(d => d.code === 'OWNEDCOMMENT_HTML_DISCARDED');
    expect(htmlWarning).toBeDefined();
    expect(htmlWarning?.severity).toBe('WARNING');

    // Conformance with canonical domain validator
    const validationResult = validate(result.canonicalModel!);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.errors).toHaveLength(0);
  });

  it('04-error-unknown-type: should abort on unknown type and return structured diagnostic without partial model', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '04-error-unknown-type/input.xmi'), 'utf-8');
    const expectedError = JSON.parse(fs.readFileSync(path.join(fixturesDir, '04-error-unknown-type/expected-error.json'), 'utf-8'));

    const result = importXmi(inputXmi);
    expect(result.outcome).toBe('error');
    expect(result.canonicalModel).toBeNull();

    const diagnostic = result.diagnostics.find(d => d.code === 'UNKNOWN_TYPE');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('ERROR');
    expect(diagnostic?.element?.typeFound).toBe('MoneyBag');
    expect(diagnostic?.element?.className).toBe('Factura');
    expect(diagnostic?.element?.attributeName).toBe('total');
  });

  it('05-error-self-association: should abort on self-association without partial model', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '05-error-self-association/input.xmi'), 'utf-8');
    const expectedError = JSON.parse(fs.readFileSync(path.join(fixturesDir, '05-error-self-association/expected-error.json'), 'utf-8'));

    const result = importXmi(inputXmi);
    expect(result.outcome).toBe('error');
    expect(result.canonicalModel).toBeNull();

    const diagnostic = result.diagnostics.find(d => d.code === 'SELF_ASSOCIATION_NOT_SUPPORTED');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('ERROR');
    expect(diagnostic?.element?.classId).toBe('CLS_40');
    expect(diagnostic?.element?.className).toBe('Nodo');
  });

  it('should report MALFORMED_XMI when XML is not well-formed', () => {
    const malformedXmi = '<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/2.1"><uml:Model name="broken">';
    const result = importXmi(malformedXmi);

    expect(result.outcome).toBe('error');
    expect(result.canonicalModel).toBeNull();
    const diagnostic = result.diagnostics.find(d => d.code === 'MALFORMED_XMI');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('ERROR');
  });

  it('should report MALFORMED_XMI when attributes are unquoted', () => {
    const unquotedXmi = '<xmi:XMI xmi:version=2.1><uml:Model name="broken"/></xmi:XMI>';
    const result = importXmi(unquotedXmi);

    expect(result.outcome).toBe('error');
    expect(result.canonicalModel).toBeNull();
    expect(result.diagnostics.some(d => d.code === 'MALFORMED_XMI')).toBe(true);
  });

  it('should report MALFORMED_XMI when multiple root elements exist', () => {
    const multiRootXmi = '<xmi:XMI xmi:version="2.1"></xmi:XMI><xmi:XMI xmi:version="2.1"></xmi:XMI>';
    const result = importXmi(multiRootXmi);

    expect(result.outcome).toBe('error');
    expect(result.canonicalModel).toBeNull();
    expect(result.diagnostics.some(d => d.code === 'MALFORMED_XMI')).toBe(true);
  });

  it('should report UNSUPPORTED_EXPORTER when exporter version is older than EA 15 or newer than 16', () => {
    const oldEaXmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="14.1"/>
  <uml:Model xmi:id="M01" name="OldModel"/>
</xmi:XMI>`;
    const resultOld = importXmi(oldEaXmi);
    expect(resultOld.outcome).toBe('error');
    expect(resultOld.canonicalModel).toBeNull();
    expect(resultOld.diagnostics.some(d => d.code === 'UNSUPPORTED_EXPORTER')).toBe(true);

    const newEaXmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="17.0"/>
  <uml:Model xmi:id="M01" name="FutureModel"/>
</xmi:XMI>`;
    const resultNew = importXmi(newEaXmi);
    expect(resultNew.outcome).toBe('error');
    expect(resultNew.canonicalModel).toBeNull();
    expect(resultNew.diagnostics.some(d => d.code === 'UNSUPPORTED_EXPORTER')).toBe(true);
  });

  it('should report UNSUPPORTED_EXPORTER when XMI version is not 2.1', () => {
    const xmi1 = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="1.1" xmlns:xmi="http://www.omg.org/spec/XMI/1.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="16.0"/>
  <uml:Model xmi:id="M01" name="Model1"/>
</xmi:XMI>`;
    const result = importXmi(xmi1);
    expect(result.outcome).toBe('error');
    expect(result.canonicalModel).toBeNull();
    expect(result.diagnostics.some(d => d.code === 'UNSUPPORTED_EXPORTER')).toBe(true);
  });

  it('should report MISSING_ROOT_MODEL when uml:Model is absent', () => {
    const noModelXmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://www.omg.org/spec/XMI/20131001">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="16.0"/>
</xmi:XMI>`;
    const result = importXmi(noModelXmi);

    expect(result.outcome).toBe('error');
    expect(result.canonicalModel).toBeNull();
    const diagnostic = result.diagnostics.find(d => d.code === 'MISSING_ROOT_MODEL');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('ERROR');
  });

  it('recupera generalization, dependency y associationClass (contrato v1.1)', () => {
    const xmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>
  <uml:Model xmi:id="M01" name="K">
    <packagedElement xmi:type="uml:Class" xmi:id="C1" name="Base"/>
    <packagedElement xmi:type="uml:Class" xmi:id="C2" name="Hija">
      <generalization xmi:type="uml:Generalization" xmi:id="G1" general="C1"/>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="C3" name="Servicio"/>
    <packagedElement xmi:type="uml:Dependency" xmi:id="D1" name="usa" client="C3" supplier="C2"/>
    <packagedElement xmi:type="uml:AssociationClass" xmi:id="AC1" name="Detalle">
      <ownedAttribute xmi:type="uml:Property" xmi:id="AT1" name="cantidad" type="Integer">
        <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
        <upperValue xmi:type="uml:LiteralInteger" value="1"/>
      </ownedAttribute>
      <memberEnd xmi:idref="E1"/>
      <memberEnd xmi:idref="E2"/>
      <ownedEnd xmi:type="uml:Property" xmi:id="E1" association="AC1"><type xmi:idref="C1"/></ownedEnd>
      <ownedEnd xmi:type="uml:Property" xmi:id="E2" association="AC1"><type xmi:idref="C3"/></ownedEnd>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;
    const result = importXmi(xmi);
    expect(result.outcome).toBe('success');

    const byId = new Map(result.canonicalModel!.associations.map(a => [a.id, a]));
    expect(byId.get('G1')?.kind).toBe('generalization');
    expect(byId.get('G1')?.sourceClassId).toBe('C2');
    expect(byId.get('G1')?.targetClassId).toBe('C1');
    expect(byId.get('D1')?.kind).toBe('dependency');
    expect(byId.get('D1')?.sourceClassId).toBe('C3');
    expect(byId.get('D1')?.targetClassId).toBe('C2');

    const acl = byId.get('AC1');
    expect(acl?.kind).toBe('associationClass');
    expect(acl?.associationClassId).toBe('ACL_AC1');
    const carrier = result.canonicalModel!.classes.find(c => c.id === 'ACL_AC1');
    expect(carrier?.name).toBe('Detalle');
    expect(carrier?.attributes.map(a => a.name)).toEqual(['cantidad']);
  });

  it('recupera aggregation/composition e invierte los extremos si el todo es el segundo', () => {
    const xmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>
  <uml:Model xmi:id="M02" name="Agg">
    <packagedElement xmi:type="uml:Class" xmi:id="W1" name="Todo"/>
    <packagedElement xmi:type="uml:Class" xmi:id="P1" name="Parte"/>
    <packagedElement xmi:type="uml:Association" xmi:id="A1">
      <ownedEnd xmi:type="uml:Property" xmi:id="E1" aggregation="composite"><type xmi:idref="W1"/></ownedEnd>
      <ownedEnd xmi:type="uml:Property" xmi:id="E2" aggregation="none"><type xmi:idref="P1"/></ownedEnd>
    </packagedElement>
    <packagedElement xmi:type="uml:Association" xmi:id="A2">
      <ownedEnd xmi:type="uml:Property" xmi:id="E3" aggregation="none"><type xmi:idref="P1"/></ownedEnd>
      <ownedEnd xmi:type="uml:Property" xmi:id="E4" aggregation="shared"><type xmi:idref="W1"/></ownedEnd>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;
    const result = importXmi(xmi);
    expect(result.outcome).toBe('success');
    const byId = new Map(result.canonicalModel!.associations.map(a => [a.id, a]));
    // El "todo" (W1) queda como origen en ambos casos
    expect(byId.get('A1')?.kind).toBe('composition');
    expect(byId.get('A1')?.sourceClassId).toBe('W1');
    expect(byId.get('A1')?.targetClassId).toBe('P1');
    expect(byId.get('A2')?.kind).toBe('aggregation');
    expect(byId.get('A2')?.sourceClassId).toBe('W1');
    expect(byId.get('A2')?.targetClassId).toBe('P1');
  });

  it('tolera prefijos de namespace no estándar (x:) y uml:Model sin name', () => {
    const xmi = `<?xml version="1.0" encoding="UTF-8"?>
<x:XMI x:version="2.1" xmlns:x="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <x:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>
  <uml:Model x:id="M9">
    <packagedElement x:type="uml:Class" x:id="C9" name="Factura">
      <ownedAttribute x:type="uml:Property" x:id="A9" name="total" type="Double"/>
    </packagedElement>
  </uml:Model>
</x:XMI>`;
    const result = importXmi(xmi);
    expect(result.outcome).toBe('success');
    expect(result.canonicalModel!.id).toBe('M9');
    expect(result.canonicalModel!.name).toBe('Modelo_EA');
    expect(result.canonicalModel!.classes[0].name).toBe('Factura');
    expect(result.canonicalModel!.classes[0].attributes[0].name).toBe('total');
  });

  it('acepta xmi:uuid como id del modelo raíz', () => {
    const xmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>
  <uml:Model xmi:uuid="UUID_9" name="ConUuid">
    <packagedElement xmi:type="uml:Class" xmi:id="C9" name="Factura"/>
  </uml:Model>
</xmi:XMI>`;
    const result = importXmi(xmi);
    expect(result.outcome).toBe('success');
    expect(result.canonicalModel!.id).toBe('UUID_9');
  });

  it('should exclude association-backed ownedAttribute elements and avoid false UNKNOWN_TYPE', () => {
    const assocBackedXmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="16.0"/>
  <uml:Model xmi:id="M01" name="AssocModel">
    <packagedElement xmi:type="uml:Package" xmi:id="P01" name="pkg">
      <packagedElement xmi:type="uml:Class" xmi:id="C01" name="Order">
        <ownedAttribute xmi:type="uml:Property" xmi:id="A01" name="customer" type="C02" association="ASSOC01"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="A02" name="total" type="Double"/>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="C02" name="Customer">
        <ownedAttribute xmi:type="uml:Property" xmi:id="A03" name="name" type="String"/>
      </packagedElement>
      <packagedElement xmi:type="uml:Association" xmi:id="ASSOC01" name="orderCustomer">
        <ownedEnd xmi:type="uml:Property" xmi:id="E01" type="C01"/>
        <ownedEnd xmi:type="uml:Property" xmi:id="E02" type="C02"/>
      </packagedElement>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;
    const result = importXmi(assocBackedXmi);
    expect(result.outcome).toBe('success');
    expect(result.canonicalModel).not.toBeNull();
    const orderClass = result.canonicalModel!.classes.find(c => c.id === 'C01');
    expect(orderClass?.attributes).toHaveLength(1);
    expect(orderClass?.attributes[0].name).toBe('total');
  });

  it('resuelve el tipo de atributo desde la extensión EA (exports reales)', () => {
    const xmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>
  <uml:Model xmi:id="M1" name="EA_Model">
    <packagedElement xmi:type="uml:Class" xmi:id="EAID_C1" name="Cliente">
      <ownedAttribute xmi:type="uml:Property" xmi:id="EAID_A1" name="nombre"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="EAID_A2" name="edad"/>
    </packagedElement>
  </uml:Model>
  <xmi:Extension extender="Enterprise Architect" extenderID="6.5">
    <elements>
      <element xmi:idref="EAID_C1" xmi:type="uml:Class" name="Cliente">
        <attributes>
          <attribute xmi:idref="EAID_A1" name="nombre"><properties type="String"/></attribute>
          <attribute xmi:idref="EAID_A2" name="edad"><properties type="int"/></attribute>
        </attributes>
      </element>
    </elements>
  </xmi:Extension>
</xmi:XMI>`;
    const result = importXmi(xmi);
    expect(result.outcome).toBe('success');
    const cliente = result.canonicalModel!.classes[0];
    expect(cliente.attributes.map(a => [a.name, a.type])).toEqual([
      ['nombre', 'String'],
      ['edad', 'Integer'],
    ]);
  });
});
