import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importXmi, exportXmi, parseXml, CanonicalDomainModel } from '../src/index.js';
import { validate } from '../../domain-validator/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../../../fixtures/xmi');
const modelsDir = path.resolve(__dirname, '../../../fixtures/models');

describe('XMI Exporter & Semantic Round-trip', () => {
  it('06-round-trip: should export canonical model to valid XMI complying with EA profile and re-import with exact semantics', () => {
    const canonicalInput: CanonicalDomainModel = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, '06-round-trip/canonical-input.json'), 'utf-8')
    );
    const expectedXmiFixture = fs.readFileSync(path.join(fixturesDir, '06-round-trip/expected-xmi-export.xmi'), 'utf-8');
    const expectedReimport = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, '06-round-trip/reimport-canonical.json'), 'utf-8')
    );

    const exportedXmi = exportXmi(canonicalInput);

    // Profile conformance (§2, §3.1)
    expect(exportedXmi).toContain('xmi:version="2.1"');
    expect(exportedXmi).toContain('xmi:exporter="Enterprise Architect"');
    expect(exportedXmi).toContain('xmi:exporterVersion="15.0.1514.12"');
    expect(exportedXmi).toContain('xmlns:xmi="http://www.omg.org/spec/XMI/20131001"');
    expect(exportedXmi).toContain('xmlns:uml="http://www.omg.org/spec/UML/20131001"');
    expect(exportedXmi).toContain('<xmi:Documentation exporter="Enterprise Architect" exporterVersion="15.0.1514.12"/>');
    expect(exportedXmi).toContain('<uml:Model xmi:id="MODEL_06" name="Biblioteca" xmi:type="uml:Model">');

    // Verify type mappings in exported XMI (§5)
    expect(exportedXmi).toContain('name="titulo"');
    expect(exportedXmi).toContain('type="String"');
    expect(exportedXmi).toContain('name="anioPublicacion"');
    expect(exportedXmi).toContain('type="int"');

    // Structural XML parse check against expected XMI fixture
    const parsedExported = parseXml(exportedXmi);
    const parsedExpected = parseXml(expectedXmiFixture);
    expect(parsedExported.name).toBe('xmi:XMI');
    expect(parsedExpected.name).toBe('xmi:XMI');
    expect(parsedExported.attributes['xmi:version']).toBe('2.1');
    expect(parsedExported.attributes['xmi:exporter']).toBe('Enterprise Architect');
    expect(parsedExported.attributes['xmi:exporterVersion']).toBe('15.0.1514.12');

    // Re-import and semantic equality
    const importResult = importXmi(exportedXmi);
    expect(importResult.outcome).toBe('success');
    expect(importResult.canonicalModel).not.toBeNull();
    expect(importResult.canonicalModel).toEqual(expectedReimport);

    const validation = validate(importResult.canonicalModel!);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should guarantee exact deterministic stability (identical byte output across multiple runs)', () => {
    const canonicalInput: CanonicalDomainModel = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, '06-round-trip/canonical-input.json'), 'utf-8')
    );

    const run1 = exportXmi(canonicalInput);
    const run2 = exportXmi(canonicalInput);
    expect(run1).toBe(run2);
  });

  it('should maintain idempotency across multiple round-trip export/import cycles', () => {
    const canonicalInput: CanonicalDomainModel = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, '06-round-trip/canonical-input.json'), 'utf-8')
    );

    // Cycle 1: canonical -> XMI -> canonical
    const xmi1 = exportXmi(canonicalInput);
    const res1 = importXmi(xmi1);
    expect(res1.outcome).toBe('success');

    // Cycle 2: canonical -> XMI -> canonical
    const xmi2 = exportXmi(res1.canonicalModel!);
    const res2 = importXmi(xmi2);
    expect(res2.outcome).toBe('success');

    expect(res2.canonicalModel).toEqual(res1.canonicalModel);
  });

  it('should cover all 8 canonical types export (§5) and re-import with exact round-trip fidelity', () => {
    const allTypesModel: CanonicalDomainModel = {
      contractVersion: '1',
      id: 'MODEL_ALL_TYPES',
      name: 'AllTypesModel',
      version: '1.0.0',
      packages: [],
      classes: [
        {
          id: 'CLS_TYPES',
          name: 'TypeCatalog',
          attributes: [
            { id: 'ATTR_01_STR', name: 'fString', type: 'String', nullable: false, multiplicity: '1' },
            { id: 'ATTR_02_INT', name: 'fInt', type: 'Integer', nullable: false, multiplicity: '1' },
            { id: 'ATTR_03_LNG', name: 'fLong', type: 'Long', nullable: false, multiplicity: '1' },
            { id: 'ATTR_04_DBL', name: 'fDouble', type: 'Double', nullable: false, multiplicity: '1' },
            { id: 'ATTR_05_BLN', name: 'fBool', type: 'Boolean', nullable: false, multiplicity: '1' },
            { id: 'ATTR_06_DTE', name: 'fDate', type: 'Date', nullable: false, multiplicity: '1' },
            { id: 'ATTR_07_DTM', name: 'fDateTime', type: 'DateTime', nullable: false, multiplicity: '1' },
            { id: 'ATTR_08_UID', name: 'fUuid', type: 'UUID', nullable: false, multiplicity: '1' }
          ]
        }
      ],
      associations: []
    };

    const exportedXmi = exportXmi(allTypesModel);

    // Verify each exact contractual XMI form per §5
    expect(exportedXmi).toContain('type="String"');
    expect(exportedXmi).toContain('type="int"');
    expect(exportedXmi).toContain('type="long"');
    expect(exportedXmi).toContain('type="double"');
    expect(exportedXmi).toContain('type="boolean"');
    expect(exportedXmi).toContain('type="EAJava_Date"');
    expect(exportedXmi).toContain('type="DateTime"');
    expect(exportedXmi).toContain('type="UUID"');

    // Re-import and verify recovery of all canonical types
    const reimported = importXmi(exportedXmi);
    expect(reimported.outcome).toBe('success');
    expect(reimported.canonicalModel).toEqual(allTypesModel);

    const validation = validate(reimported.canonicalModel!);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('round-trip 01-minimal-import: should preserve full semantics on export and re-import', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '01-minimal-import/input.xmi'), 'utf-8');
    const firstImport = importXmi(inputXmi);
    expect(firstImport.outcome).toBe('success');

    const exportedXmi = exportXmi(firstImport.canonicalModel!);
    const reimported = importXmi(exportedXmi);
    expect(reimported.outcome).toBe('success');
    expect(reimported.canonicalModel).toEqual(firstImport.canonicalModel);

    const validation = validate(reimported.canonicalModel!);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('round-trip 02-associations: should preserve associations, multiplicities, and unidirectional navigability', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '02-associations/input.xmi'), 'utf-8');
    const firstImport = importXmi(inputXmi);
    expect(firstImport.outcome).toBe('success');

    const exportedXmi = exportXmi(firstImport.canonicalModel!);
    const reimported = importXmi(exportedXmi);
    expect(reimported.outcome).toBe('success');
    expect(reimported.canonicalModel).toEqual(firstImport.canonicalModel);

    const validation = validate(reimported.canonicalModel!);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('round-trip valid-minimal.json: should export canonical model fixture and re-import valid domain model', () => {
    const validMinimal: CanonicalDomainModel = JSON.parse(
      fs.readFileSync(path.join(modelsDir, 'valid-minimal.json'), 'utf-8')
    );

    const exportedXmi = exportXmi(validMinimal);
    const reimported = importXmi(exportedXmi);
    expect(reimported.outcome).toBe('success');
    expect(reimported.canonicalModel).not.toBeNull();

    // Verify key structural components
    expect(reimported.canonicalModel!.id).toBe(validMinimal.id);
    expect(reimported.canonicalModel!.name).toBe(validMinimal.name);
    expect(reimported.canonicalModel!.classes).toHaveLength(validMinimal.classes.length);
    expect(reimported.canonicalModel!.associations).toHaveLength(validMinimal.associations.length);

    const validation = validate(reimported.canonicalModel!);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('03-ignored-elements: should demonstrate irreversible loss of unmodeled elements and preserve canonical semantics', () => {
    const inputXmi = fs.readFileSync(path.join(fixturesDir, '03-ignored-elements/input.xmi'), 'utf-8');
    const expectedCanonical = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, '03-ignored-elements/expected-canonical.json'), 'utf-8')
    );

    // 1. Initial import of fixture with ignored elements (§4, §8)
    const initialImport = importXmi(inputXmi);
    expect(initialImport.outcome).toBe('success');
    expect(initialImport.canonicalModel).toEqual(expectedCanonical);

    // Confirm HTML warning was emitted during first import
    const htmlWarning = initialImport.diagnostics.find(d => d.code === 'OWNEDCOMMENT_HTML_DISCARDED');
    expect(htmlWarning).toBeDefined();

    // 2. Export canonical model to XMI
    const exportedXmi = exportXmi(initialImport.canonicalModel!);

    // 3. Verify explicit losses: unmodeled EA constructs must NOT be present in re-exported XMI
    expect(exportedXmi).not.toContain('<generalization');
    expect(exportedXmi).not.toContain('GEN_01');
    expect(exportedXmi).not.toContain('<ownedOperation');
    expect(exportedXmi).not.toContain('OP_01');
    expect(exportedXmi).not.toContain('validar');
    expect(exportedXmi).not.toContain('<xmi:Extension');
    expect(exportedXmi).not.toContain('<diagrams');
    expect(exportedXmi).not.toContain('DGM_01');
    expect(exportedXmi).not.toContain('<appearance');
    expect(exportedXmi).not.toContain('<appliedStereotype');
    expect(exportedXmi).not.toContain('STEREO_01');
    expect(exportedXmi).not.toContain('<defaultValue');
    expect(exportedXmi).not.toContain('DV_01');
    expect(exportedXmi).not.toContain('&lt;html&gt;');
    expect(exportedXmi).not.toContain('<b>Artículo');
    expect(exportedXmi).not.toContain('visibility=');

    // Plain text comment on EntidadBase is preserved
    expect(exportedXmi).toContain('Clase base abstracta para todas las entidades del inventario.');

    // 4. Re-import the exported XMI
    const reimported = importXmi(exportedXmi);
    expect(reimported.outcome).toBe('success');
    expect(reimported.canonicalModel).toEqual(initialImport.canonicalModel);

    // In re-import, no HTML warning is emitted because the discarded HTML is irreversibly gone
    const reimportedHtmlWarning = reimported.diagnostics.find(d => d.code === 'OWNEDCOMMENT_HTML_DISCARDED');
    expect(reimportedHtmlWarning).toBeUndefined();

    // Re-imported model is canonically valid
    const validation = validate(reimported.canonicalModel!);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('round-trip NULLABLE_REQUIRED_CONFLICT: should demonstrate documented normalization of contradictory nullable flag', () => {
    const conflictModel: CanonicalDomainModel = {
      contractVersion: '1',
      id: 'MODEL_CONFLICT_1',
      name: 'NullableConflictModel',
      version: '1.0.0',
      packages: [],
      classes: [
        {
          id: 'CLS_01',
          name: 'Item',
          attributes: [
            {
              id: 'ATTR_01',
              name: 'code',
              type: 'String',
              nullable: true,
              multiplicity: '1'
            }
          ]
        }
      ],
      associations: []
    };

    const preValidation = validate(conflictModel);
    expect(preValidation.valid).toBe(true);
    expect(preValidation.warnings.some(w => w.code === 'NULLABLE_REQUIRED_CONFLICT')).toBe(true);

    const exportedXmi = exportXmi(conflictModel);
    expect(exportedXmi).toContain('value="1"');

    const reimportResult = importXmi(exportedXmi);
    expect(reimportResult.outcome).toBe('success');
    expect(reimportResult.canonicalModel).not.toBeNull();
    const reimportedAttr = reimportResult.canonicalModel!.classes[0].attributes[0];
    expect(reimportedAttr.multiplicity).toBe('1');
    expect(reimportedAttr.nullable).toBe(false);

    const postValidation = validate(reimportResult.canonicalModel!);
    expect(postValidation.valid).toBe(true);
    expect(postValidation.warnings.some(w => w.code === 'NULLABLE_REQUIRED_CONFLICT')).toBe(false);
  });

  it('round-trip NOT_NULLABLE_OPTIONAL_CONFLICT: should demonstrate documented normalization of contradictory nullable flag', () => {
    const conflictModel: CanonicalDomainModel = {
      contractVersion: '1',
      id: 'MODEL_CONFLICT_2',
      name: 'NotNullOptionalModel',
      version: '1.0.0',
      packages: [],
      classes: [
        {
          id: 'CLS_01',
          name: 'Item',
          attributes: [
            {
              id: 'ATTR_01',
              name: 'code',
              type: 'String',
              nullable: false,
              multiplicity: '0..1'
            }
          ]
        }
      ],
      associations: []
    };

    const preValidation = validate(conflictModel);
    expect(preValidation.valid).toBe(true);
    expect(preValidation.warnings.some(w => w.code === 'NOT_NULLABLE_OPTIONAL_CONFLICT')).toBe(true);

    const exportedXmi = exportXmi(conflictModel);
    expect(exportedXmi).toContain('value="0"');

    const reimportResult = importXmi(exportedXmi);
    expect(reimportResult.outcome).toBe('success');
    expect(reimportResult.canonicalModel).not.toBeNull();
    const reimportedAttr = reimportResult.canonicalModel!.classes[0].attributes[0];
    expect(reimportedAttr.multiplicity).toBe('0..1');
    expect(reimportedAttr.nullable).toBe(true);

    const postValidation = validate(reimportResult.canonicalModel!);
    expect(postValidation.valid).toBe(true);
    expect(postValidation.warnings.some(w => w.code === 'NOT_NULLABLE_OPTIONAL_CONFLICT')).toBe(false);
  });
});
