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
  /**
   * Si es true, emite `<xmi:Extension extender="Enterprise Architect">` con
   * elementos, conectores y un diagrama de clases (type="Logical") con layout
   * en grilla. Por defecto true — EA lo necesita para mostrar el diagrama.
   */
  includeDiagram?: boolean;
}

const DEFAULT_EA_VERSION = '15.0.1514.12';
const EA_TIMESTAMP = '2020-01-01 00:00:00';
// Contenedor raíz obligatorio para EA: todo el contenido va dentro de un
// uml:Package con este id (EA resuelve los package= de la extensión contra
// paquetes reales; un uml:Model no le sirve). En importación se pliega
// (§3.2): no se materializa como paquete canónico.
export const EA_ROOT_PACKAGE_ID = 'EAPK_ROOT';

export function exportXmi(model: CanonicalDomainModel, options: XmiExportOptions = {}): string {
  const eaVersion = options.eaVersion ?? DEFAULT_EA_VERSION;
  const includeDiagram = options.includeDiagram ?? true;
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
  // EA exige que todo el contenido viva dentro de un uml:Package raíz; las
  // referencias package= de la extensión apuntan a ese paquete.
  lines.push(`    <packagedElement xmi:type="uml:Package" xmi:id="${EA_ROOT_PACKAGE_ID}" name="${escapeXml(model.name)}">`);

  const packageMap = new Map<string, CanonicalPackage>();
  for (const pkg of model.packages) {
    packageMap.set(pkg.id, pkg);
  }

  const classById = new Map<string, CanonicalClass>();
  for (const cls of model.classes) {
    classById.set(cls.id, cls);
  }

  // Las clases portadoras de clase-asociación se fusionan dentro del
  // packagedElement uml:AssociationClass; no se emiten como uml:Class aparte.
  const carrierIds = new Set<string>();
  for (const assoc of model.associations) {
    if (assoc.kind === 'associationClass' && assoc.associationClassId) {
      carrierIds.add(assoc.associationClassId);
    }
  }

  // Las generalizaciones se emiten como <generalization> dentro de la clase
  // específica (source), no como packagedElement uml:Association.
  const generalizationsBySource = new Map<string, CanonicalAssociation[]>();
  for (const assoc of model.associations) {
    if (assoc.kind === 'generalization') {
      const list = generalizationsBySource.get(assoc.sourceClassId) ?? [];
      list.push(assoc);
      generalizationsBySource.set(assoc.sourceClassId, list);
    }
  }

  const classesByPackage = new Map<string, CanonicalClass[]>();
  const rootClasses: CanonicalClass[] = [];

  for (const cls of model.classes) {
    if (carrierIds.has(cls.id)) {
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
    renderPackage(pkg, '      ');
  }

  // Render root classes
  for (const cls of rootClasses) {
    renderClass(cls, '      ');
  }

  // Render root associations
  for (const assoc of rootAssociations) {
    renderAssociation(assoc, '      ');
  }

  lines.push('    </packagedElement>');
  lines.push('  </uml:Model>');

  if (includeDiagram) {
    renderExtension();
  }

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
    lines.push(`${indent}                visibility="private">`);
    renderComment(attr.id, attr.description, indent + '  ');
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(attr.id)}_lo" value="${lower}"/>`);
    lines.push(`${indent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(attr.id)}_hi" value="${upper}"/>`);
    // EA referencia el tipo como elemento hijo con id EAnone_<tipo> (tipos
    // primitivos internos de EA), no como atributo type="...".
    lines.push(`${indent}  <type xmi:idref="EAnone_${escapeXml(mappedType)}"/>`);
    lines.push(`${indent}</ownedAttribute>`);
  }

  function renderAssociation(assoc: CanonicalAssociation, indent: string) {
    const kind = assoc.kind ?? 'association';
    if (kind === 'dependency') {
      const nameAttr = assoc.name ? ` name="${escapeXml(assoc.name)}"` : '';
      lines.push(`${indent}<packagedElement xmi:type="uml:Dependency" xmi:id="${escapeXml(assoc.id)}" client="${escapeXml(assoc.sourceClassId)}" supplier="${escapeXml(assoc.targetClassId)}"${nameAttr}/>`);
      return;
    }
    const aggregation = kind === 'aggregation' ? 'shared' : kind === 'composition' ? 'composite' : undefined;
    if (kind === 'associationClass') {
      renderAssociationClass(assoc, indent);
      return;
    }
    lines.push(`${indent}<packagedElement xmi:type="uml:Association"`);
    lines.push(`${indent}                 xmi:id="${escapeXml(assoc.id)}"${assoc.name ? ` name="${escapeXml(assoc.name)}"` : ''}>`);

    const innerIndent = indent + '  ';
    renderComment(assoc.id, assoc.description, innerIndent);
    renderEnds(assoc, innerIndent, aggregation);
    lines.push(`${indent}</packagedElement>`);
  }

  /**
   * Emite uml:AssociationClass: un único packagedElement que es a la vez clase
   * (con los ownedAttribute de la portadora) y asociación (con memberEnd/
   * ownedEnd). Es la representación que EA reconoce y enlaza con la línea
   * punteada; el nombre visible es el de la clase portadora.
   */
  function renderAssociationClass(assoc: CanonicalAssociation, indent: string) {
    const carrier = assoc.associationClassId ? classById.get(assoc.associationClassId) : undefined;
    const name = carrier?.name ?? assoc.name ?? '';
    lines.push(`${indent}<packagedElement xmi:type="uml:AssociationClass"`);
    lines.push(`${indent}                 xmi:id="${escapeXml(assoc.id)}"${name ? ` name="${escapeXml(name)}"` : ''}>`);

    const innerIndent = indent + '  ';
    renderComment(assoc.id, assoc.description ?? carrier?.description, innerIndent);
    for (const attr of carrier?.attributes ?? []) {
      renderAttribute(attr, innerIndent);
    }
    renderEnds(assoc, innerIndent, undefined);
    lines.push(`${indent}</packagedElement>`);
  }

  function renderEnds(assoc: CanonicalAssociation, indent: string, aggregation: 'shared' | 'composite' | undefined) {
    const srcBounds = getBoundsFromMultiplicity(assoc.sourceMultiplicity);
    const tgtBounds = getBoundsFromMultiplicity(assoc.targetMultiplicity);

    const endSrcId = `END_${escapeXml(assoc.id)}_SRC`;
    const endTgtId = `END_${escapeXml(assoc.id)}_TGT`;

    // El extremo lleva association="<id>" y el tipo como hijo <type xmi:idref>;
    // con type="..." en atributo EA no resuelve el clasificador y descarta
    // el conector completo.
    lines.push(`${indent}<memberEnd xmi:idref="${endSrcId}"/>`);
    lines.push(`${indent}<memberEnd xmi:idref="${endTgtId}"/>`);

    // Source ownedEnd. En una asociación unidireccional origen→destino el extremo
    // NO navegable es el del origen: se marca isNavigable="false" aquí (§3.5).
    const srcNavAttr = assoc.navigability === 'unidirectional' ? ' isNavigable="false"' : '';
    const srcAggAttr = aggregation ? ` aggregation="${aggregation}"` : '';
    lines.push(`${indent}<ownedEnd xmi:type="uml:Property" xmi:id="${endSrcId}" association="${escapeXml(assoc.id)}"${srcAggAttr}${srcNavAttr}>`);
    lines.push(`${indent}  <type xmi:idref="${escapeXml(assoc.sourceClassId)}"/>`);
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_SRC" value="${srcBounds.lower}"/>`);
    lines.push(`${indent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(assoc.id)}_SRC" value="${srcBounds.upper}"/>`);
    lines.push(`${indent}</ownedEnd>`);

    // Target ownedEnd
    lines.push(`${indent}<ownedEnd xmi:type="uml:Property" xmi:id="${endTgtId}" association="${escapeXml(assoc.id)}">`);
    lines.push(`${indent}  <type xmi:idref="${escapeXml(assoc.targetClassId)}"/>`);
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_TGT" value="${tgtBounds.lower}"/>`);
    lines.push(`${indent}  <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="UV_${escapeXml(assoc.id)}_TGT" value="${tgtBounds.upper}"/>`);
    lines.push(`${indent}</ownedEnd>`);
  }

  // ─── Extensión propietaria de EA (diagrama, estilos, conectores) ───────────

  function renderExtension() {
    // ea_localid: identificadores locales secuenciales y deterministas.
    const localIds = new Map<string, number>();
    const localId = (id: string): number => {
      const existing = localIds.get(id);
      if (existing !== undefined) {
        return existing;
      }
      const next = localIds.size + 1;
      localIds.set(id, next);
      return next;
    };

    lines.push('');
    lines.push('  <xmi:Extension extender="Enterprise Architect" extenderID="6.5">');
    lines.push('    <elements>');

    // El paquete raíz tiene estructura propia en EA (packageproperties +
    // flags isModel=1), sin <model> ni xmi:type.
    lines.push(`      <element xmi:idref="${EA_ROOT_PACKAGE_ID}">`);
    lines.push('        <packageproperties version="1.0"/>');
    lines.push('        <paths/>');
    lines.push(`        <times created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" lastloaddate="${EA_TIMESTAMP}" lastsavedate="${EA_TIMESTAMP}"/>`);
    lines.push('        <flags iscontrolled="0" isprotected="0" usedtd="0" logxml="0" packageFlags="isModel=1;"/>');
    lines.push('      </element>');

    for (const pkg of model.packages) {
      const parentId = pkg.parentId ?? EA_ROOT_PACKAGE_ID;
      const parentName = pkg.parentId ? packageMap.get(pkg.parentId)?.name ?? '' : model.name;
      lines.push(`      <element xmi:idref="${escapeXml(pkg.id)}" xmi:type="uml:Package" name="${escapeXml(pkg.name)}" scope="public">`);
      lines.push(`        <model package2="EAID_${escapeXml(pkg.id)}" package="${escapeXml(parentId)}" tpos="0" ea_localid="${localId(pkg.id)}" ea_eleType="package"/>`);
      lines.push(`        <properties isSpecification="false" sType="Package" nType="0" scope="public"${pkg.description ? ` documentation="${escapeXml(pkg.description)}"` : ''}/>`);
      lines.push(`        <project author="case-web" version="1.0" phase="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" complexity="1" status="Proposed"/>`);
      lines.push('        <code gentype="Java"/>');
      lines.push('        <style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
      lines.push('        <tags/>');
      lines.push('        <xrefs/>');
      lines.push(`        <extendedProperties tagged="0" package_name="${escapeXml(parentName)}"/>`);
      lines.push('        <packageproperties version="1.0" tpos="0"/>');
      lines.push('        <paths/>');
      lines.push(`        <times created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" lastloaddate="${EA_TIMESTAMP}" lastsavedate="${EA_TIMESTAMP}"/>`);
      lines.push('        <flags iscontrolled="0" isprotected="0" batchsave="0" batchload="0" usedtd="0" logxml="0"/>');
      lines.push('      </element>');
    }

    for (const cls of model.classes) {
      if (carrierIds.has(cls.id)) {
        continue;
      }
      const ownerId = cls.packageId && packageMap.has(cls.packageId) ? cls.packageId : EA_ROOT_PACKAGE_ID;
      const ownerName = cls.packageId && packageMap.has(cls.packageId) ? packageMap.get(cls.packageId)!.name : model.name;
      lines.push(`      <element xmi:idref="${escapeXml(cls.id)}" xmi:type="uml:Class" name="${escapeXml(cls.name)}" scope="public">`);
      lines.push(`        <model package="${escapeXml(ownerId)}" tpos="0" ea_localid="${localId(cls.id)}" ea_eleType="element"/>`);
      lines.push(`        <properties isSpecification="false" sType="Class" nType="0" scope="public" isRoot="false" isLeaf="false" isAbstract="false" isActive="false"${cls.description ? ` documentation="${escapeXml(cls.description)}"` : ''}/>`);
      lines.push(`        <project author="case-web" version="1.0" phase="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" complexity="1" status="Proposed"/>`);
      lines.push('        <code gentype="Java"/>');
      lines.push('        <style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
      lines.push('        <tags/>');
      lines.push('        <xrefs/>');
      lines.push(`        <extendedProperties tagged="0" package_name="${escapeXml(ownerName)}"/>`);

      // EA registra los conectores que tocan al elemento en <links>; la clase
      // portadora de una clase-asociación también lista su conector.
      const touching = model.associations.filter(
        a => a.sourceClassId === cls.id || a.targetClassId === cls.id || a.associationClassId === cls.id
      );
      if (touching.length > 0) {
        lines.push('        <links>');
        for (const assoc of touching) {
          const linkType = assoc.kind === 'generalization'
            ? 'Generalization'
            : assoc.kind === 'dependency'
              ? 'Dependency'
              : 'Association';
          lines.push(`          <${linkType} xmi:id="${escapeXml(assoc.id)}" start="${escapeXml(assoc.sourceClassId)}" end="${escapeXml(assoc.targetClassId)}"/>`);
        }
        lines.push('        </links>');
      }

      lines.push('      </element>');
    }

    // Las clases-asociación fusionan clase y asociación en un solo elemento
    // UML: su entrada en <elements> usa el id de la asociación y el nombre de
    // la clase portadora.
    for (const assoc of model.associations) {
      if (assoc.kind !== 'associationClass') {
        continue;
      }
      const carrier = assoc.associationClassId ? classById.get(assoc.associationClassId) : undefined;
      const name = carrier?.name ?? assoc.name ?? '';
      const ownerId = carrier?.packageId && packageMap.has(carrier.packageId) ? carrier.packageId : EA_ROOT_PACKAGE_ID;
      const ownerName = carrier?.packageId && packageMap.has(carrier.packageId) ? packageMap.get(carrier.packageId)!.name : model.name;
      lines.push(`      <element xmi:idref="${escapeXml(assoc.id)}" xmi:type="uml:Class" name="${escapeXml(name)}" scope="public">`);
      lines.push(`        <model package="${escapeXml(ownerId)}" tpos="0" ea_localid="${localId(assoc.id)}" ea_eleType="element"/>`);
      lines.push(`        <properties isSpecification="false" sType="Class" nType="0" scope="public" isRoot="false" isLeaf="false" isAbstract="false" isActive="false"${carrier?.description ? ` documentation="${escapeXml(carrier.description)}"` : ''}/>`);
      lines.push(`        <project author="case-web" version="1.0" phase="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" complexity="1" status="Proposed"/>`);
      lines.push('        <code gentype="Java"/>');
      lines.push('        <style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
      lines.push('        <tags/>');
      lines.push('        <xrefs/>');
      lines.push(`        <extendedProperties tagged="0" package_name="${escapeXml(ownerName)}"/>`);
      lines.push('        <links>');
      lines.push(`          <Association xmi:id="${escapeXml(assoc.id)}" start="${escapeXml(assoc.sourceClassId)}" end="${escapeXml(assoc.targetClassId)}"/>`);
      lines.push('        </links>');
      lines.push('      </element>');
    }

    lines.push('    </elements>');
    lines.push('    <connectors>');

    for (const assoc of model.associations) {
      renderConnector(assoc, localId, classById);
    }

    lines.push('    </connectors>');

    renderDiagram(localIds);

    lines.push('  </xmi:Extension>');
  }

  function renderConnector(
    assoc: CanonicalAssociation,
    localId: (id: string) => number,
    classes: Map<string, CanonicalClass>
  ) {
    const kind = assoc.kind ?? 'association';
    const eaType = kind === 'generalization'
      ? 'Generalization'
      : kind === 'dependency'
        ? 'Dependency'
        : 'Association';
    const isAssocKind = kind === 'association' || kind === 'aggregation' || kind === 'composition' || kind === 'associationClass';
    const direction = assoc.navigability === 'bidirectional' && isAssocKind
      ? 'Bi-Directional'
      : 'Source -&gt; Destination';
    const aggregation = kind === 'aggregation' ? 'shared' : kind === 'composition' ? 'composite' : 'none';
    const nameAttr = assoc.name ? ` name="${escapeXml(assoc.name)}"` : '';

    lines.push(`      <connector xmi:idref="${escapeXml(assoc.id)}"${nameAttr}>`);
    // Bidireccional: ambos extremos navegables. Unidireccional (o gen/dep):
    // solo el extremo destino es navegable.
    const srcNavigable = isAssocKind && assoc.navigability === 'bidirectional';
    renderConnectorEnd('source', assoc.sourceClassId, assoc.sourceMultiplicity, isAssocKind, aggregation, srcNavigable);
    renderConnectorEnd('target', assoc.targetClassId, assoc.targetMultiplicity, isAssocKind, 'none', true);
    lines.push(`        <model ea_localid="${localId(assoc.id)}"/>`);
    lines.push(`        <properties ea_type="${eaType}" direction="${direction}"/>`);
    lines.push('        <modifiers isRoot="false" isLeaf="false"/>');
    lines.push('        <parameterSubstitutions/>');
    lines.push(`        <documentation${assoc.description ? ` value="${escapeXml(assoc.description)}"` : ''}/>`);
    lines.push('        <appearance linemode="3" linecolor="-1" linewidth="0" seqno="0" headStyle="0" lineStyle="0"/>');
    if (isAssocKind) {
      const mtAttr = assoc.name ? ` mt="${escapeXml(assoc.name)}"` : '';
      lines.push(`        <labels lb="${escapeXml(assoc.sourceMultiplicity)}"${mtAttr} rb="${escapeXml(assoc.targetMultiplicity)}"/>`);
    } else {
      lines.push('        <labels/>');
    }
    // En uml:AssociationClass clase y asociación comparten el mismo xmi:id;
    // associationclass apunta a ese elemento fusionado.
    const assocClassAttr = kind === 'associationClass'
      ? ` associationclass="${escapeXml(assoc.id)}"`
      : '';
    lines.push(`        <extendedProperties virtualInheritance="0"${assocClassAttr}/>`);
    lines.push('        <style/>');
    lines.push('        <xrefs/>');
    lines.push('        <tags/>');
    lines.push('      </connector>');

    function renderConnectorEnd(
      tag: 'source' | 'target',
      classId: string,
      multiplicity: string,
      withMultiplicity: boolean,
      agg: 'none' | 'shared' | 'composite',
      navigable: boolean
    ) {
      const cls = classes.get(classId);
      const multAttr = withMultiplicity ? ` multiplicity="${escapeXml(multiplicity)}"` : '';
      lines.push(`        <${tag} xmi:idref="${escapeXml(classId)}">`);
      lines.push(`          <model ea_localid="${localId(classId)}" type="Class" name="${escapeXml(cls?.name ?? classId)}"/>`);
      lines.push('          <role visibility="Public" targetScope="instance"/>');
      lines.push(`          <type${multAttr} aggregation="${agg}" containment="Unspecified"/>`);
      lines.push('          <constraints/>');
      lines.push(`          <modifiers isOrdered="false" changeable="none" isNavigable="${navigable}"/>`);
      lines.push(`          <style value="Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=${navigable ? 'Navigable' : 'Non-Navigable'};"/>`);
      lines.push('          <documentation/>');
      lines.push('          <xrefs/>');
      lines.push('          <tags/>');
      lines.push(`        </${tag}>`);
    }
  }

  /**
   * Emite un diagrama de clases UML (type="Logical") con todas las clases en
   * una grilla determinista y todos los conectores. Sin este bloque EA importa
   * el modelo pero no crea ningún diagrama.
   */
  function renderDiagram(localIds: Map<string, number>) {
    const diagramId = `DGM_${model.id}`;
    // El diagrama vive en el paquete raíz del modelo (EA lo muestra al nivel
    // superior del navegador de proyecto tras importar).
    const owner = EA_ROOT_PACKAGE_ID;

    // DUID: identificador de 8 hex por elemento de diagrama, determinista.
    const duids = new Map<string, string>();
    const duid = (key: string): string => {
      const existing = duids.get(key);
      if (existing) {
        return existing;
      }
      const next = (duids.size + 1).toString(16).toUpperCase().padStart(8, '0');
      duids.set(key, next);
      return next;
    };

    lines.push('    <diagrams>');
    lines.push(`      <diagram xmi:id="${escapeXml(diagramId)}">`);
    lines.push(`        <model package="${escapeXml(owner)}" localID="${localIds.size + 1}" owner="${escapeXml(owner)}" tpos="0"/>`);
    lines.push(`        <properties name="${escapeXml(model.name)}" type="Logical"/>`);
    lines.push(`        <project author="case-web" version="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}"/>`);
    lines.push('        <style1 value="ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Locked=0;Border=1;HighlightForeign=1;PackageContents=1;SequenceNotes=0;ScalePrintImage=0;PPgs.cx=1;PPgs.cy=1;DocSize.cx=826;DocSize.cy=1169;ShowDetails=0;Orientation=P;Zoom=100;ShowTags=0;OpParams=1;VisibleAttributeDetail=0;ShowIcons=1;ShowReqs=0;ShowCons=0;PaperSize=9;HideParents=0;UseAlias=0;HideAtts=0;HideOps=0;HideStereo=0;HideProps=0;ShowReqSymbols=0;ShowConsSymbols=0;ShowSequence=0;ShowAttribs=1;ShowOps=1;ShowSN=1;ShowNotes=0;"/>');
    lines.push('        <style2 value="ExcludeRTF=0;DocAll=0;HideQuals=0;AttPkg=1;ShowTests=0;ShowMaint=0;SuppressFOC=1;MatrixActive=0;SwimlanesActive=1;KanbanActive=0;MatrixLineWidth=1;MatrixLineClr=0;MatrixLocked=0;TConnectorNotation=UML 2.1;TExplicitNavigability=0;AdvancedElementProps=1;AdvancedFeatureProps=1;AdvancedConnectorProps=1;mNTElement=1;mNTConnector=1;mNTDefaultLab=0;mNTDefaultName=0;mNTDefaultType=0;mNTDefaultStereotype=0;"/>');
    lines.push('        <swimlanes value="locked=false;orientation=0;width=0;inbar=false;names=false;color=-1;bold=false;"/>');
    lines.push('        <matrixitems value="locked=false;matrixactive=false;swimlanesactive=true;kanbanactive=false;width=1;clrLine=0;"/>');
    lines.push('        <extendedProperties/>');
    lines.push('        <xrefs/>');
    lines.push('        <elements>');

    // Grilla determinista: ceil(sqrt(n)) columnas, celdas de 280x220.
    // Las clases-asociación ocupan una celda con el id de la asociación
    // (el elemento fusionado) y el alto de los atributos de la portadora.
    const diagramClasses: { id: string; attrCount: number }[] = model.classes
      .filter(c => !carrierIds.has(c.id))
      .map(c => ({ id: c.id, attrCount: c.attributes.length }));
    for (const assoc of model.associations) {
      if (assoc.kind !== 'associationClass') {
        continue;
      }
      const carrier = assoc.associationClassId ? classById.get(assoc.associationClassId) : undefined;
      diagramClasses.push({ id: assoc.id, attrCount: carrier?.attributes.length ?? 0 });
    }
    const cols = Math.max(1, Math.ceil(Math.sqrt(diagramClasses.length)));
    diagramClasses.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const left = 40 + col * 280;
      const top = 40 + row * 220;
      const right = left + 220;
      const bottom = top + Math.max(80, 60 + item.attrCount * 18);
      lines.push(`          <element geometry="Left=${left};Top=${top};Right=${right};Bottom=${bottom};" subject="${escapeXml(item.id)}" seqno="${i + 1}" style="DUID=${duid(item.id)};"/>`);
    });

    for (const assoc of model.associations) {
      const srcDuid = duids.get(assoc.sourceClassId);
      const tgtDuid = duids.get(assoc.targetClassId);
      if (!srcDuid || !tgtDuid) {
        continue;
      }
      lines.push(`          <element geometry="SX=0;SY=0;EX=0;EY=0;EDGE=1;$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;Path=;" subject="${escapeXml(assoc.id)}" style="Mode=3;EOID=${tgtDuid};SOID=${srcDuid};Color=-1;LWidth=0;Hidden=0;"/>`);
    }

    lines.push('        </elements>');
    lines.push('      </diagram>');
    lines.push('    </diagrams>');
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
