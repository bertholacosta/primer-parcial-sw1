import {
  CanonicalDomainModel,
  CanonicalClass,
  CanonicalPackage,
  CanonicalAssociation,
  CanonicalAttribute,
  CanonicalType
} from './types.js';

export function exportXmi(model: CanonicalDomainModel): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<xmi:XMI xmi:version="2.1"');
  lines.push('         xmi:exporter="Enterprise Architect"');
  lines.push('         xmi:exporterVersion="16.0"');
  lines.push('         xmlns:xmi="http://www.omg.org/spec/XMI/20131001"');
  lines.push('         xmlns:uml="http://www.omg.org/spec/UML/20131001">');
  lines.push('');
  lines.push('  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="16.0"/>');
  lines.push('');
  lines.push(`  <uml:Model xmi:id="${escapeXml(model.id)}" name="${escapeXml(model.name)}" xmi:type="uml:Model">`);

  // Map classes and associations to packages
  const packageMap = new Map<string, CanonicalPackage>();
  for (const pkg of model.packages) {
    packageMap.set(pkg.id, pkg);
  }

  const classesByPackage = new Map<string, CanonicalClass[]>();
  const rootClasses: CanonicalClass[] = [];

  for (const cls of model.classes) {
    if (cls.packageId && packageMap.has(cls.packageId)) {
      if (!classesByPackage.has(cls.packageId)) {
        classesByPackage.set(cls.packageId, []);
      }
      classesByPackage.get(cls.packageId)!.push(cls);
    } else {
      rootClasses.push(cls);
    }
  }

  const associationsByPackage = new Map<string, CanonicalAssociation[]>();
  const rootAssociations: CanonicalAssociation[] = [];

  // Group associations: place in package of source class if valid, else root
  const classById = new Map<string, CanonicalClass>();
  for (const cls of model.classes) {
    classById.set(cls.id, cls);
  }

  for (const assoc of model.associations) {
    const srcCls = classById.get(assoc.sourceClassId);
    if (srcCls?.packageId && packageMap.has(srcCls.packageId)) {
      if (!associationsByPackage.has(srcCls.packageId)) {
        associationsByPackage.set(srcCls.packageId, []);
      }
      associationsByPackage.get(srcCls.packageId)!.push(assoc);
    } else {
      rootAssociations.push(assoc);
    }
  }

  // Render top-level packages (and nested ones)
  const rootPackages = model.packages.filter(p => !p.parentId);
  for (const pkg of rootPackages) {
    renderPackage(pkg, '    ');
  }

  // Render root classes
  for (const cls of rootClasses) {
    renderClass(cls, '    ');
  }

  // Render root associations
  for (const assoc of rootAssociations) {
    renderAssociation(assoc, '    ');
  }

  lines.push('  </uml:Model>');
  lines.push('</xmi:XMI>');
  lines.push('');

  return lines.join('\n');

  function renderPackage(pkg: CanonicalPackage, indent: string) {
    lines.push(`${indent}<packagedElement xmi:type="uml:Package" xmi:id="${escapeXml(pkg.id)}" name="${escapeXml(pkg.name)}">`);
    const innerIndent = indent + '  ';

    // Nested packages
    const children = model.packages.filter(p => p.parentId === pkg.id);
    for (const childPkg of children) {
      renderPackage(childPkg, innerIndent);
    }

    // Classes in this package
    const pkgClasses = classesByPackage.get(pkg.id) || [];
    for (const cls of pkgClasses) {
      renderClass(cls, innerIndent);
    }

    // Associations in this package
    const pkgAssocs = associationsByPackage.get(pkg.id) || [];
    for (const assoc of pkgAssocs) {
      renderAssociation(assoc, innerIndent);
    }

    lines.push(`${indent}</packagedElement>`);
  }

  function renderClass(cls: CanonicalClass, indent: string) {
    lines.push(`${indent}<packagedElement xmi:type="uml:Class"`);
    lines.push(`${indent}                 xmi:id="${escapeXml(cls.id)}"`);
    lines.push(`${indent}                 name="${escapeXml(cls.name)}">`);

    const innerIndent = indent + '  ';

    if (cls.description) {
      lines.push(`${innerIndent}<ownedComment xmi:type="uml:Comment" xmi:id="CMT_${escapeXml(cls.id)}">`);
      lines.push(`${innerIndent}  <body>${escapeXml(cls.description)}</body>`);
      lines.push(`${innerIndent}</ownedComment>`);
    }

    for (const attr of cls.attributes) {
      renderAttribute(attr, innerIndent);
    }

    lines.push(`${indent}</packagedElement>`);
  }

  /**
   * Renderiza un atributo escalar UML (uml:Property).
   *
   * Política contractual de multiplicidad y nulabilidad (§3.4, §8):
   * En UML/XMI 2.1, la cardinalidad y opcionalidad se expresan exclusivamente mediante
   * lowerValue y upperValue. Para modelos canónicos con conflicto advertible
   * (NULLABLE_REQUIRED_CONFLICT o NOT_NULLABLE_OPTIONAL_CONFLICT), la multiplicidad canónica
   * gobierna los límites estructurales emitidos en XMI. Al reimportar, el modelo resultante
   * normaliza el flag nullable conforme a la tabla §3.4 (pérdida documentada del conflicto original).
   */
  function renderAttribute(attr: CanonicalAttribute, indent: string) {
    const mappedType = mapCanonicalTypeToXmi(attr.type);
    const { lower, upper } = getBoundsFromMultiplicity(attr.multiplicity);

    lines.push(`${indent}<ownedAttribute xmi:type="uml:Property"`);
    lines.push(`${indent}                xmi:id="${escapeXml(attr.id)}"`);
    lines.push(`${indent}                name="${escapeXml(attr.name)}"`);
    lines.push(`${indent}                type="${escapeXml(mappedType)}">`);
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(attr.id)}_lo" value="${lower}"/>`);
    lines.push(`${indent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(attr.id)}_hi" value="${upper}"/>`);
    lines.push(`${indent}</ownedAttribute>`);
  }

  function renderAssociation(assoc: CanonicalAssociation, indent: string) {
    const srcBounds = getBoundsFromMultiplicity(assoc.sourceMultiplicity);
    const tgtBounds = getBoundsFromMultiplicity(assoc.targetMultiplicity);

    const endSrcId = `END_${escapeXml(assoc.id)}_SRC`;
    const endTgtId = `END_${escapeXml(assoc.id)}_TGT`;

    lines.push(`${indent}<packagedElement xmi:type="uml:Association"`);
    lines.push(`${indent}                 xmi:id="${escapeXml(assoc.id)}"`);
    lines.push(`${indent}                 name="${escapeXml(assoc.name)}">`);

    const innerIndent = indent + '  ';
    lines.push(`${innerIndent}<memberEnd xmi:idref="${endSrcId}"/>`);
    lines.push(`${innerIndent}<memberEnd xmi:idref="${endTgtId}"/>`);

    // Source ownedEnd
    lines.push(`${innerIndent}<ownedEnd xmi:type="uml:Property" xmi:id="${endSrcId}" type="${escapeXml(assoc.sourceClassId)}">`);
    lines.push(`${innerIndent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_SRC" value="${srcBounds.lower}"/>`);
    lines.push(`${innerIndent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(assoc.id)}_SRC" value="${srcBounds.upper}"/>`);
    lines.push(`${innerIndent}</ownedEnd>`);

    // Target ownedEnd
    const isNavigableAttr = assoc.navigability === 'unidirectional' ? ' isNavigable="false"' : '';
    lines.push(`${innerIndent}<ownedEnd xmi:type="uml:Property" xmi:id="${endTgtId}" type="${escapeXml(assoc.targetClassId)}"${isNavigableAttr}>`);
    lines.push(`${innerIndent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_TGT" value="${tgtBounds.lower}"/>`);
    lines.push(`${innerIndent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(assoc.id)}_TGT" value="${tgtBounds.upper}"/>`);
    lines.push(`${innerIndent}</ownedEnd>`);

    lines.push(`${indent}</packagedElement>`);
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function mapCanonicalTypeToXmi(type: CanonicalType): string {
  switch (type) {
    case 'String':
      return 'String';
    case 'Integer':
      return 'int';
    case 'Long':
      return 'long';
    case 'Double':
      return 'double';
    case 'Boolean':
      return 'boolean';
    case 'Date':
      return 'EAJava_Date';
    case 'DateTime':
      return 'DateTime';
    case 'UUID':
      return 'UUID';
    default:
      return type;
  }
}

function getBoundsFromMultiplicity(mult: string): { lower: string; upper: string } {
  switch (mult) {
    case '1':
      return { lower: '1', upper: '1' };
    case '0..1':
      return { lower: '0', upper: '1' };
    case '1..*':
      return { lower: '1', upper: '*' };
    case '0..*':
      return { lower: '0', upper: '*' };
    default:
      return { lower: '1', upper: '1' };
  }
}
