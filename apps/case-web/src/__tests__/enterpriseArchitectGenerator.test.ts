import { describe, it, expect } from 'vitest';
import { parseXml } from 'xmi-adapter';
import {
  buildEnterpriseArchitectXmi,
  EA_TARGET_VERSION
} from '../generator/enterpriseArchitectGenerator';
import { DEFAULT_CANONICAL_FIXTURE } from '../App';
import { parseDomainModel } from '../adapter/domainModelAdapter';
import { CanonicalDomainModel } from '../domain/model';

function loadFixture(): CanonicalDomainModel {
  return parseDomainModel(DEFAULT_CANONICAL_FIXTURE);
}

describe('enterpriseArchitectGenerator', () => {
  it('emite XMI 2.1 declarando Enterprise Architect 15.0.1514.12', () => {
    const xmi = buildEnterpriseArchitectXmi(loadFixture());
    expect(EA_TARGET_VERSION).toBe('15.0.1514.12');
    expect(xmi).toContain('xmi:version="2.1"');
    expect(xmi).toContain('xmi:exporter="Enterprise Architect"');
    expect(xmi).toContain('xmi:exporterVersion="15.0.1514.12"');
    // Namespaces legacy XMI/UML 2.1 — los que EA 15 emite y reconoce.
    expect(xmi).toContain('xmlns:uml="http://schema.omg.org/spec/UML/2.1"');
  });

  it('produce XML bien formado con el modelo raíz', () => {
    const model = loadFixture();
    const doc = parseXml(buildEnterpriseArchitectXmi(model));
    expect(doc.name).toBe('xmi:XMI');
    const umlModel = doc.children.find(c => c.name === 'uml:Model');
    expect(umlModel?.attributes['name']).toBe(model.name);
  });

  it('incluye todas las clases y atributos del fixture con sus tipos XMI', () => {
    const model = loadFixture();
    const xmi = buildEnterpriseArchitectXmi(model);
    for (const cls of model.classes) {
      expect(xmi).toContain(`xmi:id="${cls.id}"`);
      expect(xmi).toContain(`name="${cls.name}"`);
    }
    expect(xmi).toContain('PrimitiveTypes.xmi#String');
    expect(xmi).toContain('type="String"');
    expect(xmi).toContain('xmi:type="uml:Property"');
  });

  it('emite las asociaciones como uml:Association con memberEnd y multiplicidades', () => {
    const model = loadFixture();
    const xmi = buildEnterpriseArchitectXmi(model);
    for (const assoc of model.associations) {
      expect(xmi).toContain(`xmi:id="${assoc.id}"`);
    }
    expect(xmi).toContain('<memberEnd xmi:idref=');
    expect(xmi).toContain('uml:LiteralInteger');
    expect(xmi).toContain('uml:LiteralUnlimitedNatural');
  });

  it('es determinista: dos ejecuciones producen el mismo documento', () => {
    const model = loadFixture();
    expect(buildEnterpriseArchitectXmi(model)).toBe(buildEnterpriseArchitectXmi(model));
  });
});
