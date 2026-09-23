import {
  CanonicalDomainModel,
  CanonicalClass,
  CanonicalAssociation,
  CanonicalAttribute,
  CanonicalType
} from './types.js';

export interface XmiExportOptions {
  /**
   * Versión de Enterprise Architect declarada en `xmi:exporterVersion` (§2).
   * Por defecto '15.0.1514.12'. `<xmi:Documentation>` siempre declara la
   * versión del extender XMI de EA ('6.5'), como en los exports reales.
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

  // Namespaces legacy de XMI/UML 2.1: los que EA 15 emite y reconoce en su
  // importador. Los URIs 2013 (www.omg.org/spec/...) hacen que EA ignore las
  // referencias xmi:idref de la extensión → el diagrama no se crea.
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<xmi:XMI xmi:version="2.1"');
  lines.push('         xmi:exporter="Enterprise Architect"');
  lines.push(`         xmi:exporterVersion="${escapeXml(eaVersion)}"`);
  lines.push('         xmlns:uml="http://schema.omg.org/spec/UML/2.1"');
  lines.push('         xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">');
  lines.push('');
  lines.push('  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>');
  lines.push('');
  lines.push(`  <uml:Model xmi:id="${escapeXml(model.id)}" name="${escapeXml(model.name)}" xmi:type="uml:Model">`);
  // EA exige que todo el contenido viva dentro de un uml:Package raíz; las
  // referencias package= de la extensión apuntan a ese paquete.
  lines.push(`    <packagedElement xmi:type="uml:Package" xmi:id="${EA_ROOT_PACKAGE_ID}" name="${escapeXml(model.name)}" visibility="public">`);

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

  // Todas las clases y asociaciones viven en el paquete raíz (EAPK_ROOT);
  // el modelo canónico no tiene paquetes anidados.
  const rootClasses = model.classes.filter(cls => !carrierIds.has(cls.id));
  const rootAssociations = model.associations.filter(assoc => assoc.kind !== 'generalization');

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
    lines.push(`${indent}                 name="${escapeXml(cls.name)}"`);
    lines.push(`${indent}                 visibility="public">`);

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
    lines.push(`${indent}                visibility="private" isStatic="false" isReadOnly="false"`);
    lines.push(`${indent}                isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false">`);
    renderComment(attr.id, attr.description, indent + '  ');
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(attr.id)}_lo" value="${lower}"/>`);
    lines.push(`${indent}  ${upperValueTag(`UV_${attr.id}_hi`, upper)}`);
    // Tipos estándar: href a la librería de primitivos UML (lo que EA emite
    // en sus exports). Tipos sin primitivo UML (Date, DateTime, UUID):
    // idref EAnone_<tipo>, convención de tipos internos de EA.
    const umlPrimitive = UML_PRIMITIVE_HREF[mappedType];
    if (umlPrimitive) {
      lines.push(`${indent}  <type xmi:type="uml:PrimitiveType" href="${umlPrimitive}"/>`);
    } else {
      lines.push(`${indent}  <type xmi:idref="EAnone_${escapeXml(mappedType)}"/>`);
    }
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
    lines.push(`${indent}                 xmi:id="${escapeXml(assoc.id)}"${assoc.name ? ` name="${escapeXml(assoc.name)}"` : ''} visibility="public">`);

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
    lines.push(`${indent}                 xmi:id="${escapeXml(assoc.id)}"${name ? ` name="${escapeXml(name)}"` : ''} visibility="public">`);

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

    // Formato EA 15: flags completos en el ownedEnd, association="<id>" y el
    // tipo como hijo <type xmi:idref>; con type="..." en atributo EA no
    // resuelve el clasificador y descarta el conector completo.
    const endFlags = 'visibility="public" isStatic="false" isReadOnly="false" isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false"';
    // En una asociación unidireccional origen→destino el extremo NO navegable
    // es el del origen: se marca isNavigable="false" aquí (§3.5).
    const srcNavAttr = assoc.navigability === 'unidirectional' ? ' isNavigable="false"' : '';
    lines.push(`${indent}<ownedEnd xmi:type="uml:Property" xmi:id="${endSrcId}" association="${escapeXml(assoc.id)}" ${endFlags} aggregation="${aggregation ?? 'none'}"${srcNavAttr}>`);
    lines.push(`${indent}  <type xmi:idref="${escapeXml(assoc.sourceClassId)}"/>`);
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_SRC" value="${srcBounds.lower}"/>`);
    lines.push(`${indent}  ${upperValueTag(`UV_${assoc.id}_SRC`, srcBounds.upper)}`);
    lines.push(`${indent}</ownedEnd>`);

    // Target ownedEnd
    lines.push(`${indent}<ownedEnd xmi:type="uml:Property" xmi:id="${endTgtId}" association="${escapeXml(assoc.id)}" ${endFlags} aggregation="none">`);
    lines.push(`${indent}  <type xmi:idref="${escapeXml(assoc.targetClassId)}"/>`);
    lines.push(`${indent}  <lowerValue xmi:type="uml:LiteralInteger" xmi:id="LV_${escapeXml(assoc.id)}_TGT" value="${tgtBounds.lower}"/>`);
    lines.push(`${indent}  ${upperValueTag(`UV_${assoc.id}_TGT`, tgtBounds.upper)}`);
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

    // Entradas <attribute> del elemento, tal como las emite EA 15.
    function renderExtAttributes(attrs: CanonicalAttribute[]) {
      if (attrs.length === 0) {
        return;
      }
      lines.push('        <attributes>');
      for (const attr of attrs) {
        const { lower, upper } = getBoundsFromMultiplicity(attr.multiplicity);
        lines.push(`          <attribute xmi:idref="${escapeXml(attr.id)}" name="${escapeXml(attr.name)}" scope="Private">`);
        lines.push('            <initial/>');
        lines.push(`            <documentation${attr.description ? ` value="${escapeXml(attr.description)}"` : ''}/>`);
        lines.push(`            <model ea_localid="${localId(attr.id)}" ea_guid="${eaGuid(attr.id)}"/>`);
        lines.push(`            <properties type="${escapeXml(mapCanonicalTypeToEa(attr.type))}" derived="0" precision="0" collection="false" length="0" static="0" duplicates="0" changeability="changeable"/>`);
        lines.push('            <coords ordered="0" scale="0"/>');
        lines.push('            <containment containment="Not Specified" position="0"/>');
        lines.push('            <stereotype/>');
        lines.push(`            <bounds lower="${lower}" upper="${upper === '*' ? '-1' : upper}"/>`);
        lines.push('            <options/>');
        lines.push('            <style/>');
        lines.push('            <styleex value="volatile=0;IsLiteral=0;"/>');
        lines.push('            <tags/>');
        lines.push('            <xrefs/>');
        lines.push('          </attribute>');
      }
      lines.push('        </attributes>');
    }

    lines.push('');
    lines.push('  <xmi:Extension extender="Enterprise Architect" extenderID="6.5">');
    lines.push('    <elements>');

    // El paquete raíz se emite como un elemento Package normal (formato
    // EA 15); package= se autorreferencia porque no hay paquete padre.
    lines.push(`      <element xmi:idref="${EA_ROOT_PACKAGE_ID}" xmi:type="uml:Package" name="${escapeXml(model.name)}" scope="public">`);
    lines.push(`        <model package2="EAID_ROOT" package="${EA_ROOT_PACKAGE_ID}" tpos="0" ea_localid="${localId(EA_ROOT_PACKAGE_ID)}" ea_eleType="package"/>`);
    lines.push('        <properties isSpecification="false" sType="Package" nType="0" scope="public"/>');
    lines.push(`        <project author="case-web" version="1.0" phase="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" complexity="1" status="Proposed"/>`);
    lines.push('        <code gentype="Java"/>');
    lines.push('        <style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
    lines.push('        <tags/>');
    lines.push('        <xrefs/>');
    lines.push(`        <extendedProperties tagged="0" package_name="${escapeXml(model.name)}"/>`);
    lines.push('        <packageproperties version="1.0"/>');
    lines.push('        <paths/>');
    lines.push(`        <times created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}"/>`);
    lines.push('        <flags iscontrolled="FALSE" isprotected="FALSE" usedtd="FALSE" logxml="FALSE"/>');
    lines.push('      </element>');

    for (const cls of model.classes) {
      if (carrierIds.has(cls.id)) {
        continue;
      }
      const ownerId = EA_ROOT_PACKAGE_ID;
      const ownerName = model.name;
      lines.push(`      <element xmi:idref="${escapeXml(cls.id)}" xmi:type="uml:Class" name="${escapeXml(cls.name)}" scope="public">`);
      lines.push(`        <model package="${escapeXml(ownerId)}" tpos="0" ea_localid="${localId(cls.id)}" ea_eleType="element"/>`);
      lines.push(`        <properties isSpecification="false" sType="Class" nType="0" scope="public" isRoot="false" isLeaf="false" isAbstract="false" isActive="false"${cls.description ? ` documentation="${escapeXml(cls.description)}"` : ''}/>`);
      lines.push(`        <project author="case-web" version="1.0" phase="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" complexity="1" status="Proposed"/>`);
      lines.push('        <code gentype="Java"/>');
      lines.push('        <style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
      lines.push('        <tags/>');
      lines.push('        <xrefs/>');
      lines.push(`        <extendedProperties tagged="0" package_name="${escapeXml(ownerName)}"/>`);

      renderExtAttributes(cls.attributes);

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
          lines.push(`          <${linkType} xmi:id="${escapeXml(connectorId(assoc))}" start="${escapeXml(assoc.sourceClassId)}" end="${escapeXml(assoc.targetClassId)}"/>`);
        }
        lines.push('        </links>');
      }
      lines.push('        <flags iscontrolled="FALSE" isprotected="FALSE" usedtd="FALSE" logxml="FALSE"/>');
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
      const ownerId = EA_ROOT_PACKAGE_ID;
      const ownerName = model.name;
      // nType="17" = AssociationClass en EA; conID enlaza el elemento con el
      // objeto conector (identidad propia, CONN_<id>).
      lines.push(`      <element xmi:idref="${escapeXml(assoc.id)}" xmi:type="uml:Class" name="${escapeXml(name)}" scope="public">`);
      lines.push(`        <model package="${escapeXml(ownerId)}" tpos="0" ea_localid="${localId(assoc.id)}" ea_eleType="element"/>`);
      lines.push(`        <properties isSpecification="false" sType="Class" nType="17" scope="public" isRoot="false" isLeaf="false" isAbstract="false" isActive="false"${carrier?.description ? ` documentation="${escapeXml(carrier.description)}"` : ''}/>`);
      lines.push(`        <project author="case-web" version="1.0" phase="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}" complexity="1" status="Proposed"/>`);
      lines.push('        <code gentype="Java"/>');
      lines.push('        <style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
      lines.push('        <tags/>');
      lines.push('        <xrefs/>');
      lines.push(`        <extendedProperties tagged="0" package_name="${escapeXml(ownerName)}" conID="${escapeXml(connectorId(assoc))}"/>`);
      renderExtAttributes(carrier?.attributes ?? []);
      lines.push('        <links>');
      lines.push(`          <Association xmi:id="${escapeXml(connectorId(assoc))}" start="${escapeXml(assoc.sourceClassId)}" end="${escapeXml(assoc.targetClassId)}"/>`);
      lines.push('        </links>');
      lines.push('        <flags iscontrolled="FALSE" isprotected="FALSE" usedtd="FALSE" logxml="FALSE"/>');
      lines.push('      </element>');
    }

    lines.push('    </elements>');
    lines.push('    <connectors>');

    for (const assoc of model.associations) {
      renderConnector(assoc, localId, classById);
    }

    lines.push('    </connectors>');
    lines.push('    <primitivetypes>');
    lines.push('      <packagedElement xmi:type="uml:Package" xmi:id="EAPrimitiveTypesPackage" name="EA_PrimitiveTypes_Package" visibility="public"/>');
    lines.push('    </primitivetypes>');
    lines.push('    <profiles/>');

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
    // EA 15: bidireccional = ambos extremos navegables; unidireccional = solo
    // el destino. subtype="Class" marca el conector de una clase-asociación.
    const direction = !isAssocKind
      ? 'Source -&gt; Destination'
      : assoc.navigability === 'bidirectional'
        ? 'Bi-Directional'
        : 'Source -&gt; Destination';
    const aggregation = kind === 'aggregation' ? 'shared' : kind === 'composition' ? 'composite' : 'none';
    const connectorName = kind === 'associationClass'
      ? (assoc.associationClassId ? classes.get(assoc.associationClassId)?.name : undefined) ?? assoc.name
      : assoc.name;
    const nameAttr = connectorName ? ` name="${escapeXml(connectorName)}"` : '';

    lines.push(`      <connector xmi:idref="${escapeXml(connectorId(assoc))}"${nameAttr}>`);
    const srcNavigable = isAssocKind && assoc.navigability === 'bidirectional';
    renderConnectorEnd('source', assoc.sourceClassId, assoc.sourceMultiplicity, isAssocKind, aggregation, srcNavigable);
    renderConnectorEnd('target', assoc.targetClassId, assoc.targetMultiplicity, isAssocKind, 'none', true);
    lines.push(`        <model ea_localid="${localId(assoc.id)}"/>`);
    const subtypeAttr = kind === 'associationClass' ? ' subtype="Class"' : '';
    lines.push(`        <properties ea_type="${eaType}"${subtypeAttr} direction="${direction}"/>`);
    lines.push('        <modifiers isRoot="false" isLeaf="false"/>');
    lines.push('        <parameterSubstitutions/>');
    lines.push(`        <documentation${assoc.description ? ` value="${escapeXml(assoc.description)}"` : ''}/>`);
    lines.push('        <appearance linemode="3" linecolor="0" linewidth="0" seqno="0" headStyle="0" lineStyle="0"/>');
    if (isAssocKind) {
      const mtAttr = connectorName ? ` mt="${escapeXml(connectorName)}"` : '';
      lines.push(`        <labels lb="${escapeXml(eaMultiplicity(assoc.sourceMultiplicity))}"${mtAttr} rb="${escapeXml(eaMultiplicity(assoc.targetMultiplicity))}"/>`);
    } else {
      lines.push('        <labels/>');
    }
    // Clase-asociación: associationclass = xmi:id del elemento fusionado;
    // privatedata1 = ea_localid de ese elemento.
    const extProps = kind === 'associationClass'
      ? ` associationclass="${escapeXml(assoc.id)}" privatedata1="${localId(assoc.id)}"`
      : '';
    lines.push(`        <extendedProperties${extProps}/>`);
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
      const multAttr = withMultiplicity ? ` multiplicity="${escapeXml(eaMultiplicity(multiplicity))}"` : '';
      lines.push(`        <${tag} xmi:idref="${escapeXml(classId)}">`);
      lines.push(`          <model ea_localid="${localId(classId)}" type="Class" name="${escapeXml(cls?.name ?? classId)}"/>`);
      lines.push('          <role visibility="Public"/>');
      lines.push(`          <type${multAttr} aggregation="${agg}"/>`);
      lines.push('          <constraints/>');
      lines.push(`          <modifiers isOrdered="false" isNavigable="${navigable}"/>`);
      lines.push(`          <style value="Derived=0;Union=0;Owned=0;Navigable=${navigable ? 'Navigable' : 'Unspecified'};"/>`);
      lines.push('          <documentation/>');
      lines.push('          <xrefs/>');
      lines.push('          <tags/>');
      lines.push(`        </${tag}>`);
    }
  }

  interface DiagramBox {
    id: string;
    name: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  /**
   * Grilla determinista compartida entre el diagrama UMLDI (que EA usa para
   * crear el diagrama) y el diagrama de la extensión EA (metadatos propios):
   * ceil(sqrt(n)) columnas, celdas de 280x220. Las clases-asociación ocupan
   * una celda con el id del elemento fusionado.
   */
  function getDiagramBoxes(): DiagramBox[] {
    const items: { id: string; name: string; attrCount: number }[] = model.classes
      .filter(c => !carrierIds.has(c.id))
      .map(c => ({ id: c.id, name: c.name, attrCount: c.attributes.length }));
    for (const assoc of model.associations) {
      if (assoc.kind !== 'associationClass') {
        continue;
      }
      const carrier = assoc.associationClassId ? classById.get(assoc.associationClassId) : undefined;
      items.push({
        id: assoc.id,
        name: carrier?.name ?? assoc.name ?? '',
        attrCount: carrier?.attributes.length ?? 0
      });
    }
    const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    return items.map((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const left = 40 + col * 280;
      const top = 40 + row * 220;
      return {
        id: item.id,
        name: item.name,
        left,
        top,
        right: left + 220,
        bottom: top + Math.max(80, 60 + item.attrCount * 18)
      };
    });
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
    lines.push(`        <model package="${escapeXml(owner)}" localID="${localIds.size + 1}" owner="${escapeXml(owner)}"/>`);
    lines.push(`        <properties name="${escapeXml(model.name)}" type="Logical"/>`);
    lines.push(`        <project author="case-web" version="1.0" created="${EA_TIMESTAMP}" modified="${EA_TIMESTAMP}"/>`);
    lines.push('        <style1 value="ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Locked=0;Border=1;HighlightForeign=1;PackageContents=1;SequenceNotes=0;ScalePrintImage=0;PPgs.cx=0;PPgs.cy=0;DocSize.cx=850;DocSize.cy=1098;ShowDetails=0;Orientation=P;Zoom=100;ShowTags=0;OpParams=1;VisibleAttributeDetail=0;ShowOpRetType=1;ShowIcons=1;CollabNums=0;HideProps=0;ShowReqs=0;ShowCons=0;PaperSize=1;HideParents=0;UseAlias=0;HideAtts=0;HideOps=0;HideStereo=0;HideElemStereo=0;ShowTests=0;ShowMaint=0;ConnectorNotation=UML 2.1;ExplicitNavigability=0;ShowShape=1;AllDockable=0;AdvancedElementProps=1;AdvancedFeatureProps=1;AdvancedConnectorProps=1;m_bElementClassifier=1;SPT=1;ShowNotes=0;SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;"/>');
    lines.push('        <style2 value="ExcludeRTF=0;DocAll=0;HideQuals=0;AttPkg=1;ShowTests=0;ShowMaint=0;SuppressFOC=1;MatrixActive=0;SwimlanesActive=1;KanbanActive=0;MatrixLineWidth=1;MatrixLineClr=0;MatrixLocked=0;TConnectorNotation=UML 2.1;TExplicitNavigability=0;AdvancedElementProps=1;AdvancedFeatureProps=1;AdvancedConnectorProps=1;m_bElementClassifier=1;SPT=1;MDGDgm=;STBLDgm=;ShowNotes=0;VisibleAttributeDetail=0;ShowOpRetType=1;SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;SuppressedCompartments=;Theme=:119;"/>');
    lines.push('        <swimlanes value="locked=false;orientation=0;width=0;inbar=false;names=false;color=-1;bold=false;fcol=0;tcol=-1;ofCol=-1;ufCol=-1;hl=0;ufh=0;hh=0;cls=0;bw=0;hli=0;SwimlaneFont=lfh:-16,lfw:0,lfi:0,lfu:0,lfs:0,lfface:Calibri,lfe:0,lfo:0,lfchar:1,lfop:0,lfcp:0,lfq:0,lfpf=0,lfWidth=0;"/>');
    lines.push('        <matrixitems value="locked=false;matrixactive=false;swimlanesactive=true;kanbanactive=false;width=1;clrLine=0;"/>');
    lines.push('        <extendedProperties/>');
    lines.push('        <elements>');

    const objStyle = 'NSL=0;BCol=-1;BFol=-1;LCol=-1;LWth=-1;fontsz=0;bold=0;black=0;italic=0;ul=0;charset=0;pitch=0;';
    getDiagramBoxes().forEach((box, i) => {
      lines.push(`          <element geometry="Left=${box.left};Top=${box.top};Right=${box.right};Bottom=${box.bottom};" subject="${escapeXml(box.id)}" seqno="${i + 1}" style="DUID=${duid(box.id)};${objStyle}"/>`);
    });

    // Geometría de etiquetas de EA: CX en LLB/LRB (multiplicidades) y LMT
    // (nombre). subject es el id del conector (propio en clase-asociación).
    const labelGeo = (cx: number) => `CX=${cx}:CY=14:OX=0:OY=0:HDN=0:BLD=0:ITA=0:UND=0:CLR=-1:ALN=1:DIR=0:ROT=0`;
    for (const assoc of model.associations) {
      const srcDuid = duids.get(assoc.sourceClassId);
      const tgtDuid = duids.get(assoc.targetClassId);
      if (!srcDuid || !tgtDuid) {
        continue;
      }
      const isAssocKind = assoc.kind !== 'generalization' && assoc.kind !== 'dependency';
      const llb = isAssocKind ? `$LLB=${labelGeo(17)};` : '$LLB=;';
      const lmt = assoc.name ? `LMT=${labelGeo(29)};` : 'LMT=;';
      const lrb = isAssocKind ? `LRB=${labelGeo(17)};` : 'LRB=;';
      lines.push(`          <element geometry="EDGE=1;${llb}LLT=;${lmt}LMB=;LRT=;${lrb}IRHS=;ILHS=;Path=;" subject="${escapeXml(connectorId(assoc))}" style="Mode=3;EOID=${tgtDuid};SOID=${srcDuid};Color=-1;LWidth=0;Hidden=0;"/>`);
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

/**
 * Primitivos UML estándar: EA los referencia por href a la librería
 * PrimitiveTypes.xmi. Los tipos sin equivalente UML (Date, DateTime, UUID,
 * long) se emiten como EAnone_<nombre> y el nombre visible va en la extensión.
 */
const UML_PRIMITIVE_HREF: Record<string, string> = {
  String: 'http://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi#String',
  int: 'http://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi#Integer',
  double: 'http://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi#Real',
  boolean: 'http://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi#Boolean'
};

/** Nombre del tipo tal como EA lo muestra en el atributo (properties type=). */
function mapCanonicalTypeToEa(type: CanonicalType): string {
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
      return 'Date';
    case 'DateTime':
      return 'DateTime';
    case 'UUID':
      return 'UUID';
    default:
      return type;
  }
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

/**
 * En EA el conector de una clase-asociación es un objeto con identidad propia
 * (guid distinto del elemento uml:AssociationClass). El elemento lo referencia
 * vía conID y el conector via associationclass.
 */
function connectorId(assoc: CanonicalAssociation): string {
  return assoc.kind === 'associationClass' ? `CONN_${assoc.id}` : assoc.id;
}

/**
 * EA 15 codifica el límite superior: LiteralInteger para valores finitos,
 * LiteralUnlimitedNatural value="-1" para '*'.
 */
function upperValueTag(id: string, upper: string): string {
  return upper === '*'
    ? `<upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="${escapeXml(id)}" value="-1"/>`
    : `<upperValue xmi:type="uml:LiteralInteger" xmi:id="${escapeXml(id)}" value="${escapeXml(upper)}"/>`;
}

/** Multiplicidad canónica en la notación rango de EA ('1' → '1..1'). */
function eaMultiplicity(mult: string): string {
  return mult === '1' ? '1..1' : mult;
}

/**
 * GUID determinista derivado del id (EA usa {GUID}; cualquier valor estable
 * con formato GUID sirve para las referencias internas de la extensión).
 */
function eaGuid(id: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < id.length; i++) {
    h1 = Math.imul(h1 ^ id.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 ^ id.charCodeAt(id.length - 1 - i), 0x811c9dc5);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const a = hex(h1);
  const b = hex(h2);
  return `{${a}-${b.slice(0, 4)}-${b.slice(4)}-${a.slice(0, 4)}-${a.slice(4)}${b}}`;
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
