import {
  CanonicalDomainModel,
  CanonicalClass,
  CanonicalPackage,
  CanonicalAssociation,
  CanonicalAttribute,
  CanonicalType
} from './types.js';

export interface XmiExportOptions {
  /**
   * Versión de Enterprise Architect declarada en `xmi:exporterVersion` y
   * `<xmi:Documentation>` (§2). Por defecto '15.0.1514.12'.
   */
  eaVersion?: string;
}

const DEFAULT_EA_VERSION = '15.0.1514.12';

export function exportXmi(model: CanonicalDomainModel, options: XmiExportOptions = {}): string {
  const eaVersion = options.eaVersion ?? DEFAULT_EA_VERSION;
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<xmi:XMI xmi:version="2.1"');
  lines.push('         xmi:exporter="Enterprise Architect"');
  lines.push(`         xmi:exporterVersion="${escapeXml(eaVersion)}"`);
  lines.push('         xmlns:xmi="http://www.omg.org/spec/XMI/20131001"');
  lines.push('         xmlns:uml="http://www.omg.org/spec/UML/20131001">');
  lines.push('');
  lines.push(`  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="${escapeXml(eaVersion)}"/>`);
  lines.push('');
  lines.push(`  <uml:Model xmi:id="${escapeXml(model.id)}" name="${escapeXml(model.name)}" xmi:type="uml:Model">`);

  const packageMap = new Map<string, CanonicalPackage>();
  for (const pkg of model.packages) {
    packageMap.set(pkg.id, pkg);
  }

  const classById = new Map<string, CanonicalClass>();
  for (const cls of model.classes) {
    classById.set(cls.id, cls);
  }

  // Las clases portadoras de una clase-asociación se emiten fusionadas dentro de
  // uml:AssociationClass; no deben aparecer también como uml:Class independiente.
  const associationClassById = new Map<string, CanonicalAssociation>();
  // Las generalizaciones se emiten como <generalization> dentro de la clase
  // específica (source), no como packagedElement uml:Association.
  const generalizationsBySource = new Map<string, CanonicalAssociation[]>();
  for (const assoc of model.associations) {
    if (assoc.kind === 'associationClass' && assoc.associationClassId) {
      associationClassById.set(assoc.associationClassId, assoc);
    } else if (assoc.kind === 'generalization') {
      const list = generalizationsBySource.get(assoc.sourceClassId) ?? [];
      list.push(assoc);
      generalizationsBySource.set(assoc.sourceClassId, list);
    }
  }

  const classesByPackage = new Map<string, CanonicalClass[]>();
  const rootClasses: CanonicalClass[] = [];

  for (const cls of model.classes) {
    if (associationClassById.has(cls.id)) {
      continue;
    }
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
  for (const assoc of model.associations) {
    if (assoc.kind === 'generalization') {
      continue;
    }
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

    renderComment(pkg.id, pkg.description, innerIndent);

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

  function renderComment(ownerId: string, description: string | undefined, indent: string) {
    if (!description) {
      return;
    }
    lines.push(`${indent}<ownedComment xmi:type="uml:Comment" xmi:id="CMT_${escapeXml(ownerId)}">`);
    lines.push(`${indent}  <body>${escapeXml(description)}</body>`);
    lines.push(`${indent}</ownedComment>`);
  }

  function renderClass(cls: CanonicalClass, indent: string) {
    lines.push(`${indent}<packagedElement xmi:type="uml:Class"`);
    lines.push(`${indent}                 xmi:id="${escapeXml(cls.id)}"`);
    lines.push(`${indent}                 name="${escapeXml(cls.name)}">`);

    const innerIndent = indent + '  ';

    renderComment(cls.id, cls.description, innerIndent);

    for (const attr of cls.attributes) {
      renderAttribute(attr, innerIndent);
    }

    for (const gen of generalizationsBySource.get(cls.id) ?? []) {
      const nameAttr = gen.name ? ` name="${escapeXml(gen.name)}"` : '';
      lines.push(`${innerIndent}<generalization xmi:type="uml:Generalization" xmi:id="${escapeXml(gen.id)}" general="${escapeXml(gen.targetClassId)}"${nameAttr}/>`);
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
    renderComment(attr.id, attr.description, indent + '  ');
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(attr.id)}_lo" value="${lower}"/>`);
    lines.push(`${indent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(attr.id)}_hi" value="${upper}"/>`);
    lines.push(`${indent}</ownedAttribute>`);
  }

  function renderAssociation(assoc: CanonicalAssociation, indent: string) {
    const kind = assoc.kind ?? 'association';
    if (kind === 'dependency') {
      renderDependency(assoc, indent);
      return;
    }
    const carrier = kind === 'associationClass' && assoc.associationClassId
      ? classById.get(assoc.associationClassId)
      : undefined;
    if (carrier) {
      renderAssociationClass(assoc, carrier, indent);
      return;
    }
    const aggregation = kind === 'aggregation' ? 'shared' : kind === 'composition' ? 'composite' : undefined;
    renderAssociationEnds(assoc, indent, 'uml:Association', aggregation);
  }

  function renderDependency(assoc: CanonicalAssociation, indent: string) {
    const nameAttr = assoc.name ? ` name="${escapeXml(assoc.name)}"` : '';
    lines.push(`${indent}<packagedElement xmi:type="uml:Dependency" xmi:id="${escapeXml(assoc.id)}" client="${escapeXml(assoc.sourceClassId)}" supplier="${escapeXml(assoc.targetClassId)}"${nameAttr}/>`);
  }

  /**
   * Emite uml:AssociationClass: elemento que es a la vez clase y asociación.
   * Los atributos de la clase portadora se renderizan como ownedAttribute del
   * propio elemento, junto a los memberEnd/ownedEnd de la asociación.
   */
  function renderAssociationClass(assoc: CanonicalAssociation, carrier: CanonicalClass, indent: string) {
    lines.push(`${indent}<packagedElement xmi:type="uml:AssociationClass"`);
    lines.push(`${indent}                 xmi:id="${escapeXml(assoc.id)}"`);
    lines.push(`${indent}                 name="${escapeXml(assoc.name ?? carrier.name)}">`);

    const innerIndent = indent + '  ';
    renderComment(assoc.id, assoc.description ?? carrier.description, innerIndent);
    for (const attr of carrier.attributes) {
      renderAttribute(attr, innerIndent);
    }
    renderEnds(assoc, innerIndent, undefined);
    lines.push(`${indent}</packagedElement>`);
  }

  function renderAssociationEnds(
    assoc: CanonicalAssociation,
    indent: string,
    xmiType: string,
    aggregation: 'shared' | 'composite' | undefined
  ) {
    lines.push(`${indent}<packagedElement xmi:type="${xmiType}"`);
    lines.push(`${indent}                 xmi:id="${escapeXml(assoc.id)}"${assoc.name ? ` name="${escapeXml(assoc.name)}"` : ''}>`);

    const innerIndent = indent + '  ';
    renderComment(assoc.id, assoc.description, innerIndent);
    renderEnds(assoc, innerIndent, aggregation);
    lines.push(`${indent}</packagedElement>`);
  }

  function renderEnds(assoc: CanonicalAssociation, indent: string, aggregation: 'shared' | 'composite' | undefined) {
    const srcBounds = getBoundsFromMultiplicity(assoc.sourceMultiplicity);
    const tgtBounds = getBoundsFromMultiplicity(assoc.targetMultiplicity);

    const endSrcId = `END_${escapeXml(assoc.id)}_SRC`;
    const endTgtId = `END_${escapeXml(assoc.id)}_TGT`;

    lines.push(`${indent}<memberEnd xmi:idref="${endSrcId}"/>`);
    lines.push(`${indent}<memberEnd xmi:idref="${endTgtId}"/>`);

    // Source ownedEnd. En una asociación unidireccional origen→destino el extremo
    // NO navegable es el del origen: se marca isNavigable="false" aquí (§3.5).
    const srcNavAttr = assoc.navigability === 'unidirectional' ? ' isNavigable="false"' : '';
    const srcAggAttr = aggregation ? ` aggregation="${aggregation}"` : '';
    lines.push(`${indent}<ownedEnd xmi:type="uml:Property" xmi:id="${endSrcId}" type="${escapeXml(assoc.sourceClassId)}"${srcAggAttr}${srcNavAttr}>`);
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_SRC" value="${srcBounds.lower}"/>`);
    lines.push(`${indent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(assoc.id)}_SRC" value="${srcBounds.upper}"/>`);
    lines.push(`${indent}</ownedEnd>`);

    // Target ownedEnd
    lines.push(`${indent}<ownedEnd xmi:type="uml:Property" xmi:id="${endTgtId}" type="${escapeXml(assoc.targetClassId)}">`);
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_TGT" value="${tgtBounds.lower}"/>`);
    lines.push(`${indent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(assoc.id)}_TGT" value="${tgtBounds.upper}"/>`);
    lines.push(`${indent}</ownedEnd>`);
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
