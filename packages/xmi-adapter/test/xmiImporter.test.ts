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
    expect(diagnostic?.element?.typeFound).toBe('BigDecimal');
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
});
