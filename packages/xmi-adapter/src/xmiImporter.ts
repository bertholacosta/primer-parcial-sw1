import { parseXml, XmlNode, XmlParseError } from './xmlParser.js';
import { EA_ROOT_PACKAGE_ID } from './xmiExporter.js';
import {
  CanonicalDomainModel,
  CanonicalClass,
  CanonicalAttribute,
  CanonicalAssociation,
  CanonicalType,
  CanonicalMultiplicity,
  CanonicalNavigability,
  CanonicalAssociationKind,
  ImportResult,
  ImportOptions,
  XmiDiagnostic
} from './types.js';

const KNOWN_IGNORED_PACKAGED_TYPES = new Set([
  'uml:Interface',
  'uml:Enumeration',
  'uml:DataType',
  'uml:PrimitiveType',
  'uml:Realization',
  'uml:Usage',
  'uml:Component',
  'uml:Artifact',
  'uml:Node',
  'uml:Collaboration',
  'uml:Signal'
]);

/**
 * Normaliza atributos del namespace XMI con prefijos no estándar: los exports
 * reales pueden declarar el namespace XMI con otro prefijo (`x:id`, `XMI:id`…)
 * o usar `xmi:uuid`. Se copian a la forma `xmi:*` canónica sin pisar valores
 * existentes. No toca atributos sin prefijo ni `type` plano (tipo UML).
 */
function normalizeXmiAttributes(node: XmlNode) {
  const XMI_LOCALS: Record<string, string> = {
    id: 'xmi:id',
    uuid: 'xmi:uuid',
    type: 'xmi:type',
    idref: 'xmi:idref',
    version: 'xmi:version'
  };
  const walk = (n: XmlNode) => {
    for (const key of Object.keys(n.attributes)) {
      const idx = key.indexOf(':');
      if (idx <= 0 || key.startsWith('xmi:')) continue;
      const target = XMI_LOCALS[key.slice(idx + 1)];
      if (target && n.attributes[target] === undefined) {
        n.attributes[target] = n.attributes[key];
      }
    }
    n.children.forEach(walk);
  };
  walk(node);
}

export function importXmi(xmiContent: string, options: ImportOptions = {}): ImportResult {
  const diagnostics: XmiDiagnostic[] = [];

  let rootNode: XmlNode;
  try {
    rootNode = parseXml(xmiContent);
    normalizeXmiAttributes(rootNode);
  } catch (error) {
    const err = error as XmlParseError;
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics: [
        {
          code: 'MALFORMED_XMI',
          severity: 'ERROR',
          path: '/',
          message: `Error de parseo XML: ${err.message}`
        }
      ]
    };
  }

  // Find xmi:XMI root (por nombre local: el prefijo del namespace puede variar)
  let xmiRoot = rootNode;
  if (getLocalName(rootNode.name) !== 'XMI') {
    const found = findFirstChildByLocalName(rootNode, 'XMI');
    if (!found) {
      return {
        outcome: 'error',
        canonicalModel: null,
        diagnostics: [
          {
            code: 'MISSING_ROOT_MODEL',
            severity: 'ERROR',
            path: '/',
            message: 'Documento XMI sin elemento raíz xmi:XMI.'
          }
        ]
      };
    }
    xmiRoot = found;
  }

  // Enforce XMI 2.1 explicitly (§2, D1)
  const xmiVersion = xmiRoot.attributes['xmi:version'] || xmiRoot.attributes['version'] || '';
  if (xmiVersion !== '2.1') {
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics: [
        {
          code: 'UNSUPPORTED_EXPORTER',
          severity: 'ERROR',
          path: 'xmi:XMI',
          message: `Versión XMI no soportada: '${xmiVersion}'. Se requiere XMI 2.1.`
        }
      ]
    };
  }

  // Validate exporter & version (§2, D1: only EA 15.x and 16.x)
  const docNode = findFirstChildByLocalName(xmiRoot, 'Documentation');
  const exporter = docNode?.attributes['exporter'] || xmiRoot.attributes['xmi:exporter'] || '';
  const exporterVersion = docNode?.attributes['exporterVersion'] || xmiRoot.attributes['xmi:exporterVersion'] || '';

  if (!exporter) {
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics: [
        {
          code: 'UNSUPPORTED_EXPORTER',
          severity: 'ERROR',
          path: 'xmi:Documentation',
          message: 'Exportador no especificado. Se requiere Enterprise Architect 15.x o 16.x.'
        }
      ]
    };
  }

  const isEa = exporter.toLowerCase().includes('enterprise architect');
  if (!isEa) {
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics: [
        {
          code: 'UNSUPPORTED_EXPORTER',
          severity: 'ERROR',
          path: 'xmi:Documentation',
          message: `Exportador no soportado: '${exporter}'. Se requiere EA 15.x o 16.x.`
        }
      ]
    };
  }

  // EA escribe en <xmi:Documentation> la versión del extender XMI ('6.5'),
  // no la del producto: exports reales de EA 15 declaran "6.5". También se
  // acepta la versión de producto (15.x/16.x) que otros generadores emiten.
  const versionNum = parseFloat(exporterVersion);
  const isEaExtender = versionNum >= 6.0 && versionNum < 7.0;
  const isEaProduct = versionNum >= 15.0 && versionNum < 17.0;
  if (isNaN(versionNum) || (!isEaExtender && !isEaProduct)) {
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics: [
        {
          code: 'UNSUPPORTED_EXPORTER',
          severity: 'ERROR',
          path: 'xmi:Documentation',
          message: `Exportador no soportado: 'Enterprise Architect ${exporterVersion || 'desconocida'}'. Se requiere EA 15.x o 16.x.`
        }
      ]
    };
  }

  // Locate uml:Model
  const modelNode = findFirstChildByLocalName(xmiRoot, 'Model');
  if (!modelNode) {
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics: [
        {
          code: 'MISSING_ROOT_MODEL',
          severity: 'ERROR',
          path: 'xmi:XMI',
          message: 'Documento XMI sin elemento raíz uml:Model.'
        }
      ]
    };
  }

  // Algunos exports omiten id/name en el modelo raíz o usan xmi:uuid: se
  // derivan valores por defecto en lugar de abortar (§3.1, contrato v1.1).
  const modelId =
    modelNode.attributes['xmi:id'] || modelNode.attributes['xmi:uuid'] || 'MODEL_ROOT';
  const modelName = modelNode.attributes['name'] || 'Modelo_EA';
  if (!modelNode.attributes['xmi:id'] || !modelNode.attributes['name']) {
    diagnostics.push({
      code: 'ELEMENT_IGNORED',
      severity: 'INFO',
      path: 'uml:Model',
      message: `uml:Model sin ${!modelNode.attributes['xmi:id'] ? 'xmi:id' : 'name'}; se usan valores derivados ('${modelId}'/'${modelName}').`
    });
  }

  // First pass: gather all class IDs in the model to distinguish scalar attributes from association ends (§3.4)
  const allClassIds = new Set<string>();
  function collectClassIds(node: XmlNode) {
    for (const child of node.children) {
      if (getLocalName(child.name) === 'packagedElement') {
        const type = child.attributes['xmi:type'];
        // uml:AssociationClass es también un clasificador: un ownedAttribute
        // tipado a ella es un extremo de asociación, no un atributo escalar.
        if (type === 'uml:Class' || type === 'uml:AssociationClass') {
          const id = child.attributes['xmi:id'];
          if (id) allClassIds.add(id);
        }
        collectClassIds(child);
      }
    }
  }
  collectClassIds(modelNode);

  const classes: CanonicalClass[] = [];
  const associations: CanonicalAssociation[] = [];

  const seenIds = new Set<string>();

  function registerId(id: string, path: string): boolean {
    if (!id) return true;
    if (seenIds.has(id)) {
      diagnostics.push({
        code: 'DUPLICATE_ID',
        severity: 'ERROR',
        path,
        message: `Id duplicado '${id}' en el documento.`
      });
      return false;
    }
    seenIds.add(id);
    return true;
  }

  registerId(modelId, `uml:Model[@xmi:id='${modelId}']`);

  // Map of all properties defined in the document by xmi:id for memberEnd resolution
  const propertyNodesById = new Map<string, XmlNode>();
  function indexPropertyNodes(node: XmlNode) {
    for (const child of node.children) {
      const localName = getLocalName(child.name);
      if (localName === 'ownedAttribute' || localName === 'ownedEnd') {
        const id = child.attributes['xmi:id'];
        if (id) propertyNodesById.set(id, child);
      }
      indexPropertyNodes(child);
    }
  }
  indexPropertyNodes(modelNode);

  // Los exports reales de EA no siempre declaran el tipo del atributo en la
  // sección UML: lo escriben en la extensión propietaria
  // (<element>/<attributes>/<attribute xmi:idref>/<properties type="…"/>).
  // Se indexa para usarlo como fallback de resolución de tipo (§3.4, v1.1).
  const extensionAttrTypes = new Map<string, string>();
  const extensionNode = findFirstChildByLocalName(xmiRoot, 'Extension');
  if (extensionNode) {
    const elementsNode = findFirstChildByLocalName(extensionNode, 'elements');
    for (const el of elementsNode?.children ?? []) {
      if (getLocalName(el.name) !== 'element') continue;
      const attrsNode = findFirstChildByLocalName(el, 'attributes');
      for (const attrEl of attrsNode?.children ?? []) {
        if (getLocalName(attrEl.name) !== 'attribute') continue;
        const ref = attrEl.attributes['xmi:idref'] || attrEl.attributes['idref'];
        const propsNode = findFirstChildByLocalName(attrEl, 'properties');
        const eaType = propsNode?.attributes['type'];
        if (ref && eaType) extensionAttrTypes.set(ref, eaType);
      }
    }
  }

  // Traverse model elements
  function processPackageChildren(pkgNode: XmlNode, parentPath: string) {
    for (const child of pkgNode.children) {
      if (getLocalName(child.name) === 'packagedElement') {
        const type = child.attributes['xmi:type'];
        if (type === 'uml:Package') {
          processPackage(child, parentPath);
        } else if (type === 'uml:Class') {
          processClass(child, parentPath);
        } else if (type === 'uml:Association' || type === 'uml:AssociationClass') {
          processAssociation(child, parentPath);
        } else if (type === 'uml:Dependency') {
          processDependency(child, parentPath);
        } else if (KNOWN_IGNORED_PACKAGED_TYPES.has(type)) {
          if (options.verbose) {
            diagnostics.push({
              code: 'ELEMENT_IGNORED',
              severity: 'INFO',
              path: `${parentPath} / packagedElement[@xmi:id='${child.attributes['xmi:id'] || ''}']`,
              message: `Elemento ignorado según §4: <${child.name} xmi:type="${type}">`
            });
          }
        } else {
          // Out of profile element (§7)
          diagnostics.push({
            code: 'MALFORMED_XMI',
            severity: 'ERROR',
            path: `${parentPath} / packagedElement[@xmi:id='${child.attributes['xmi:id'] || ''}']`,
            message: `Elemento packagedElement de tipo no soportado '${type}' fuera del perfil XMI v1.`
          });
        }
      }
    }
  }

  // uml:Package no se materializa (v1.1: solo existe el paquete raíz = el
  // modelo). Se registra su id y se recorren sus hijos, que pasan al ámbito
  // raíz del modelo canónico.
  function processPackage(pkgNode: XmlNode, parentPath: string) {
    const pkgId = pkgNode.attributes['xmi:id'];
    const currentPath = `${parentPath} / packagedElement[@xmi:id='${pkgId}']`;

    if (!pkgId) {
      diagnostics.push({
        code: 'MALFORMED_XMI',
        severity: 'ERROR',
        path: currentPath,
        message: 'Elemento uml:Package requiere atributo xmi:id.'
      });
      return;
    }

    registerId(pkgId, currentPath);
    diagnostics.push({
      code: 'PACKAGE_FLATTENED',
      severity: 'INFO',
      path: currentPath,
      message: `Paquete '${pkgNode.attributes['name'] || pkgId}' omitido; su contenido se importa en el paquete raíz.`
    });
    processPackageChildren(pkgNode, currentPath);
  }

  function processClass(classNode: XmlNode, parentPath: string) {
    const classId = classNode.attributes['xmi:id'];
    const className = classNode.attributes['name'];
    const currentPath = `${parentPath} / packagedElement[@xmi:id='${classId}']`;

    if (!classId || !className) {
      diagnostics.push({
        code: 'MALFORMED_XMI',
        severity: 'ERROR',
        path: currentPath,
        message: 'Elemento uml:Class requiere atributos xmi:id y name.'
      });
      return;
    }

    registerId(classId, currentPath);

    // Parse ownedComment if present
    let description: string | undefined = undefined;
    for (const child of classNode.children) {
      if (getLocalName(child.name) === 'ownedComment') {
        const bodyNode = findFirstChildByLocalName(child, 'body');
        const commentText = bodyNode ? bodyNode.text : child.text;
        if (commentText) {
          if (/<[a-zA-Z][^>]*>/.test(commentText)) {
            diagnostics.push({
              code: 'OWNEDCOMMENT_HTML_DISCARDED',
              severity: 'WARNING',
              path: currentPath,
              message: `Comentario HTML descartado en clase '${className}'.`
            });
          } else {
            description = commentText.trim();
          }
        }
      }
    }

    const attributes = parseOwnedAttributes(classNode, currentPath, className);

    // Las generalizaciones viajan como hijos <generalization> de la clase
    // específica (origen); 'general' apunta a la clase padre (destino).
    for (const child of classNode.children) {
      if (getLocalName(child.name) === 'generalization') {
        const general = child.attributes['general'] || '';
        const genId = child.attributes['xmi:id'] || `GEN_${classId}_${associations.length}`;
        registerId(genId, `${currentPath} / generalization[@xmi:id='${genId}']`);
        if (!general) {
          diagnostics.push({
            code: 'MALFORMED_XMI',
            severity: 'ERROR',
            path: `${currentPath} / generalization`,
            message: `Generalización en clase '${className}' sin atributo 'general'.`
          });
          continue;
        }
        associations.push({
          id: genId,
          name: child.attributes['name'] || undefined,
          sourceClassId: classId,
          targetClassId: general,
          sourceMultiplicity: '1',
          targetMultiplicity: '1',
          navigability: 'unidirectional',
          kind: 'generalization'
        });
      }
    }

    const cls: CanonicalClass = {
      id: classId,
      name: className,
      attributes
    };
    if (description) {
      cls.description = description;
    }
    classes.push(cls);
  }

  /**
   * Atributos escalares de un clasificador (uml:Class o uml:AssociationClass):
   * ownedAttribute sin 'association' y cuyo tipo no sea otra clase del modelo.
   */
  function parseOwnedAttributes(ownerNode: XmlNode, ownerPath: string, ownerName: string): CanonicalAttribute[] {
    const attributes: CanonicalAttribute[] = [];

    for (const child of ownerNode.children) {
      if (getLocalName(child.name) === 'ownedAttribute') {
        const attrTypeAttr = child.attributes['xmi:type'];
        if (attrTypeAttr && attrTypeAttr !== 'uml:Property') {
          continue;
        }

        // Exclude association-backed properties (§3.4)
        if (child.attributes['association']) {
          continue;
        }
        const rawTypeCandidate = child.attributes['type'] || '';
        if (rawTypeCandidate && allClassIds.has(rawTypeCandidate)) {
          continue;
        }

        const attrId = child.attributes['xmi:id'];
        const attrName = child.attributes['name'];
        const attrPath = `${ownerPath} / ownedAttribute[@xmi:id='${attrId}']`;

        if (!attrId || !attrName) {
          diagnostics.push({
            code: 'MALFORMED_XMI',
            severity: 'ERROR',
            path: attrPath,
            message: `Atributo en clase '${ownerName}' requiere atributos xmi:id y name.`
          });
          continue;
        }

        registerId(attrId, attrPath);

        // Resolve attribute type (inspect attribute or child <type href="..." name="..." xmi:idref="...">)
        let rawType = child.attributes['type'] || '';
        if (!rawType) {
          const typeChild = findFirstChildByLocalName(child, 'type');
          if (typeChild) {
            rawType = typeChild.attributes['name'] || '';
            if (!rawType && typeChild.attributes['xmi:idref']) {
              // EA emite primitivos como EAnone_<tipo>; el sufijo es el nombre.
              rawType = stripEaNonePrefix(typeChild.attributes['xmi:idref']);
            }
            if (!rawType && typeChild.attributes['href']) {
              const href = typeChild.attributes['href'];
              const hashIdx = href.indexOf('#');
              rawType = hashIdx !== -1 ? href.slice(hashIdx + 1) : href;
            }
          }
        }
        if (!rawType && child.attributes['xmi:type'] && child.attributes['xmi:type'] !== 'uml:Property') {
          rawType = child.attributes['xmi:type'];
        }
        // Fallback EA: el tipo vive en la extensión propietaria (v1.1).
        if (!rawType) {
          rawType = extensionAttrTypes.get(attrId) ?? '';
        }

        const typeMapping = mapRawType(rawType);

        if (typeMapping.error) {
          diagnostics.push({
            code: 'UNKNOWN_TYPE',
            severity: 'ERROR',
            path: attrPath,
            message: `Tipo '${rawType}' no reconocido en el perfil XMI v1. Ruta: clase '${ownerName}' / atributo '${attrName}'. Tipos soportados: String, Integer, Long, Double, Boolean, Date, DateTime, UUID.`,
            element: {
              xmiId: attrId,
              className: ownerName,
              attributeName: attrName,
              typeFound: rawType
            }
          });
        } else if (typeMapping.warning) {
          diagnostics.push({
            code: 'TYPE_PROMOTED',
            severity: 'WARNING',
            path: attrPath,
            message: `Tipo '${rawType}' promovido a 'Double' en '${ownerName}.${attrName}'.`
          });
        }

        // Multiplicity and nullability derivation (§3.4)
        const multDerivation = deriveMultiplicity(child);
        if (multDerivation.error) {
          diagnostics.push({
            code: 'UNSUPPORTED_MULTIPLICITY',
            severity: 'ERROR',
            path: attrPath,
            message: `Multiplicidad '${multDerivation.raw}' no soportada en '${ownerName}.${attrName}'.`
          });
        }

        if (!typeMapping.error && !multDerivation.error) {
          attributes.push({
            id: attrId,
            name: attrName,
            type: typeMapping.canonicalType!,
            nullable: multDerivation.nullable!,
            multiplicity: multDerivation.multiplicity!
          });
        }
      }
    }

    return attributes;
  }

  function processAssociation(assocNode: XmlNode, parentPath: string) {
    const assocId = assocNode.attributes['xmi:id'];
    const assocName = assocNode.attributes['name'] || '';
    const isAssocClass = assocNode.attributes['xmi:type'] === 'uml:AssociationClass';
    const currentPath = `${parentPath} / packagedElement[@xmi:id='${assocId}']`;

    if (!assocId) {
      diagnostics.push({
        code: 'MALFORMED_XMI',
        severity: 'ERROR',
        path: currentPath,
        message: `Elemento ${assocNode.attributes['xmi:type'] || 'uml:Association'} requiere atributo xmi:id.`
      });
      return;
    }

    registerId(assocId, currentPath);

    // Resolve association ends: from ownedEnd children or memberEnd references (§3.5)
    let endNodes = assocNode.children.filter(c => getLocalName(c.name) === 'ownedEnd');
    if (endNodes.length < 2) {
      const memberEnds = assocNode.children.filter(c => getLocalName(c.name) === 'memberEnd');
      const resolvedEnds: XmlNode[] = [];
      for (const me of memberEnds) {
        const idref = me.attributes['xmi:idref'] || me.attributes['idref'];
        if (idref && propertyNodesById.has(idref)) {
          resolvedEnds.push(propertyNodesById.get(idref)!);
        }
      }
      if (resolvedEnds.length >= 2) {
        endNodes = resolvedEnds;
      }
    }

    if (endNodes.length >= 2) {
      let srcEnd = endNodes[0];
      let tgtEnd = endNodes[1];

      // El extremo con aggregation="shared|composite" es el "todo". El modelo
      // canónico lo convenciona como origen: si EA lo marcó en el segundo
      // extremo, se intercambian los extremos (§3.5, ADR-0009).
      const aggOf = (e: XmlNode) => e.attributes['aggregation'] || 'none';
      if (!isAssocClass && aggOf(srcEnd) === 'none' && (aggOf(tgtEnd) === 'shared' || aggOf(tgtEnd) === 'composite')) {
        const tmp = srcEnd;
        srcEnd = tgtEnd;
        tgtEnd = tmp;
      }
      const kind: CanonicalAssociationKind = isAssocClass
        ? 'associationClass'
        : aggOf(srcEnd) === 'shared'
          ? 'aggregation'
          : aggOf(srcEnd) === 'composite'
            ? 'composition'
            : 'association';

      // EA emite el clasificador del extremo como hijo <type xmi:idref="..."/>;
      // otros exportadores usan el atributo type="...". Soportar ambos.
      const sourceClassId = resolveEndClassId(srcEnd);
      const targetClassId = resolveEndClassId(tgtEnd);

      if (sourceClassId && targetClassId && sourceClassId === targetClassId) {
        const matchingClass = classes.find(c => c.id === sourceClassId);
        const className = matchingClass ? matchingClass.name : sourceClassId;

        diagnostics.push({
          code: 'SELF_ASSOCIATION_NOT_SUPPORTED',
          severity: 'ERROR',
          path: currentPath,
          message: `Auto-asociación no permitida en el corte mínimo v1. La asociación '${assocName}' (${assocId}) tiene sourceClassId y targetClassId apuntando a la misma clase '${className}' (${sourceClassId}).`,
          element: {
            xmiId: assocId,
            associationName: assocName,
            classId: sourceClassId,
            className
          }
        });
        return;
      }

      const srcMult = deriveMultiplicity(srcEnd);
      const tgtMult = deriveMultiplicity(tgtEnd);

      if (srcMult.error || tgtMult.error) {
        diagnostics.push({
          code: 'UNSUPPORTED_MULTIPLICITY',
          severity: 'ERROR',
          path: currentPath,
          message: `Multiplicidad no soportada en extremos de la asociación '${assocName}'.`
        });
        return;
      }

      const isNavigableSrc = srcEnd.attributes['isNavigable'] !== 'false';
      const isNavigableTgt = tgtEnd.attributes['isNavigable'] !== 'false';

      let navigability: CanonicalNavigability = 'bidirectional';
      if (!isNavigableSrc || !isNavigableTgt) {
        navigability = 'unidirectional';
      }

      // uml:AssociationClass: el packagedElement es a la vez clase (sus
      // ownedAttribute) y asociación. Se materializa una clase portadora con
      // id derivado y la asociación la referencia vía associationClassId.
      let associationClassId: string | undefined;
      if (isAssocClass) {
        associationClassId = `ACL_${assocId}`;
        registerId(associationClassId, `${currentPath} / carrier-class`);
        const carrier: CanonicalClass = {
          id: associationClassId,
          name: assocName,
          attributes: parseOwnedAttributes(assocNode, currentPath, assocName)
        };
        classes.push(carrier);
      }

      const assoc: CanonicalAssociation = {
        id: assocId,
        name: assocName,
        sourceClassId,
        targetClassId,
        sourceMultiplicity: srcMult.multiplicity!,
        targetMultiplicity: tgtMult.multiplicity!,
        navigability
      };
      // kind se omite para 'association' (valor por defecto del contrato).
      if (kind !== 'association') {
        assoc.kind = kind;
      }
      if (associationClassId) {
        assoc.associationClassId = associationClassId;
      }
      associations.push(assoc);
    }
  }

  /**
   * uml:Dependency (client→supplier): relación no estructural con
   * multiplicidades y navegabilidad neutras (§3.5).
   */
  function processDependency(depNode: XmlNode, parentPath: string) {
    const depId = depNode.attributes['xmi:id'];
    const depName = depNode.attributes['name'] || '';
    const currentPath = `${parentPath} / packagedElement[@xmi:id='${depId}']`;

    if (!depId) {
      diagnostics.push({
        code: 'MALFORMED_XMI',
        severity: 'ERROR',
        path: currentPath,
        message: 'Elemento uml:Dependency requiere atributo xmi:id.'
      });
      return;
    }
    registerId(depId, currentPath);

    // client/supplier pueden ser listas separadas por espacios: tomar el primero.
    const client = (depNode.attributes['client'] || '').split(/\s+/)[0] || '';
    const supplier = (depNode.attributes['supplier'] || '').split(/\s+/)[0] || '';
    if (!client || !supplier) {
      diagnostics.push({
        code: 'MALFORMED_XMI',
        severity: 'ERROR',
        path: currentPath,
        message: `Dependencia '${depName}' requiere atributos client y supplier.`
      });
      return;
    }
    if (client === supplier) {
      diagnostics.push({
        code: 'SELF_ASSOCIATION_NOT_SUPPORTED',
        severity: 'ERROR',
        path: currentPath,
        message: `Auto-dependencia no permitida en v1: '${depName}' (${depId}).`
      });
      return;
    }

    associations.push({
      id: depId,
      name: depName || undefined,
      sourceClassId: client,
      targetClassId: supplier,
      sourceMultiplicity: '1',
      targetMultiplicity: '1',
      navigability: 'unidirectional',
      kind: 'dependency'
    });
  }

  // Process root uml:Model elements. Si el único packagedElement raíz es el
  // paquete contenedor EAPK_ROOT que nuestro exportador emite para EA (mismo
  // nombre que el modelo), se pliega: sus hijos se procesan como de nivel
  // raíz y no se materializa como paquete canónico.
  const modelPath = `uml:Model[@xmi:id='${modelId}']`;
  const topLevelElements = modelNode.children.filter(c => getLocalName(c.name) === 'packagedElement');
  const rootChildren =
    topLevelElements.length === 1 &&
    topLevelElements[0].attributes['xmi:type'] === 'uml:Package' &&
    topLevelElements[0].attributes['xmi:id'] === EA_ROOT_PACKAGE_ID &&
    topLevelElements[0].attributes['name'] === modelName
      ? topLevelElements[0].children
      : modelNode.children;

  for (const child of rootChildren) {
    if (getLocalName(child.name) === 'packagedElement') {
      const type = child.attributes['xmi:type'];
      if (type === 'uml:Package') {
        processPackage(child, modelPath);
      } else if (type === 'uml:Class') {
        processClass(child, modelPath);
      } else if (type === 'uml:Association' || type === 'uml:AssociationClass') {
        processAssociation(child, modelPath);
      } else if (type === 'uml:Dependency') {
        processDependency(child, modelPath);
      } else if (KNOWN_IGNORED_PACKAGED_TYPES.has(type)) {
        if (options.verbose) {
          diagnostics.push({
            code: 'ELEMENT_IGNORED',
            severity: 'INFO',
            path: `${modelPath} / packagedElement[@xmi:id='${child.attributes['xmi:id'] || ''}']`,
            message: `Elemento ignorado según §4: <${child.name} xmi:type="${type}">`
          });
        }
      } else {
        diagnostics.push({
          code: 'MALFORMED_XMI',
          severity: 'ERROR',
          path: `${modelPath} / packagedElement[@xmi:id='${child.attributes['xmi:id'] || ''}']`,
          message: `Elemento packagedElement de tipo no soportado '${type}' fuera del perfil XMI v1.`
        });
      }
    }
  }

  // Validate unresolved references (§7)
  const classIds = new Set(classes.map(c => c.id));
  for (const assoc of associations) {
    if (!classIds.has(assoc.sourceClassId)) {
      diagnostics.push({
        code: 'UNRESOLVED_CLASS_REF',
        severity: 'ERROR',
        path: `association[@id='${assoc.id}']`,
        message: `Referencia sin resolver: '${assoc.sourceClassId}' en asociación '${assoc.id}'.`
      });
    }
    if (!classIds.has(assoc.targetClassId)) {
      diagnostics.push({
        code: 'UNRESOLVED_CLASS_REF',
        severity: 'ERROR',
        path: `association[@id='${assoc.id}']`,
        message: `Referencia sin resolver: '${assoc.targetClassId}' en asociación '${assoc.id}'.`
      });
    }
  }

  // Check if any ERROR diagnostics exist
  const hasErrors = diagnostics.some(d => d.severity === 'ERROR');
  if (hasErrors) {
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics
    };
  }

  // Canonical sorting according to domain-model-v1.md §4:
  // classes: id ASC (todas en el paquete raíz)
  classes.sort((a, b) => a.id.localeCompare(b.id));

  // attributes within class: id ASC
  for (const cls of classes) {
    cls.attributes.sort((a, b) => a.id.localeCompare(b.id));
  }

  // associations: sourceClassId ASC, then id ASC
  associations.sort((a, b) => {
    const srcComp = a.sourceClassId.localeCompare(b.sourceClassId);
    return srcComp !== 0 ? srcComp : a.id.localeCompare(b.id);
  });

  const canonicalModel: CanonicalDomainModel = {
    contractVersion: '1',
    id: modelId,
    name: modelName,
    version: '1.0.0',
    classes,
    associations
  };

  return {
    outcome: 'success',
    canonicalModel,
    diagnostics
  };
}

function getLocalName(name: string): string {
  const parts = name.split(':');
  return parts.length > 1 ? parts[1] : parts[0];
}

function findFirstChildByLocalName(node: XmlNode, localName: string): XmlNode | null {
  for (const child of node.children) {
    if (getLocalName(child.name) === localName) {
      return child;
    }
  }
  return null;
}

function stripEaNonePrefix(idref: string): string {
  return idref.startsWith('EAnone_') ? idref.slice('EAnone_'.length) : '';
}

function resolveEndClassId(end: XmlNode): string {
  const attrType = end.attributes['type'];
  if (attrType) {
    return attrType;
  }
  const typeChild = findFirstChildByLocalName(end, 'type');
  return typeChild?.attributes['xmi:idref'] ?? '';
}

function mapRawType(raw: string): { canonicalType?: CanonicalType; warning?: boolean; error?: boolean } {
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'string':
    case 'char':
    case 'eajava_string':
    case 'java.lang.string':
      return { canonicalType: 'String' };
    case 'int':
    case 'integer':
    case 'short':
    case 'byte':
    case 'eajava_int':
    case 'java.lang.integer':
      return { canonicalType: 'Integer' };
    case 'long':
    case 'eajava_long':
    case 'java.lang.long':
    case 'biginteger':
    case 'java.math.biginteger':
      return { canonicalType: 'Long' };
    case 'double':
    case 'real':
    case 'eajava_double':
      return { canonicalType: 'Double' };
    case 'float':
    case 'bigdecimal':
    case 'java.math.bigdecimal':
      return { canonicalType: 'Double', warning: true };
    case 'boolean':
    case 'eajava_boolean':
      return { canonicalType: 'Boolean' };
    case 'date':
    case 'eajava_date':
    case 'java.util.date':
      return { canonicalType: 'Date' };
    case 'datetime':
    case 'timestamp':
    case 'java.sql.timestamp':
    case 'java.time.localdatetime':
      return { canonicalType: 'DateTime' };
    case 'uuid':
    case 'java.util.uuid':
      return { canonicalType: 'UUID' };
    default:
      return { error: true };
  }
}

function deriveMultiplicity(node: XmlNode): { multiplicity?: CanonicalMultiplicity; nullable?: boolean; error?: boolean; raw?: string } {
  const lowerNode = findFirstChildByLocalName(node, 'lowerValue');
  const upperNode = findFirstChildByLocalName(node, 'upperValue');

  const lowerRaw = lowerNode ? lowerNode.attributes['value'] : node.attributes['lower'];
  const upperRaw = upperNode ? upperNode.attributes['value'] : node.attributes['upper'];

  const lower = lowerRaw !== undefined && lowerRaw !== null && lowerRaw !== '' ? lowerRaw : '1';
  let upper = upperRaw !== undefined && upperRaw !== null && upperRaw !== '' ? upperRaw : '1';
  // EA codifica '*' como value="-1" en uml:LiteralUnlimitedNatural.
  if (upper === '-1') {
    upper = '*';
  }

  if (lower === '1' && upper === '1') {
    return { multiplicity: '1', nullable: false };
  }
  if (lower === '0' && upper === '1') {
    return { multiplicity: '0..1', nullable: true };
  }
  if (lower === '1' && upper === '*') {
    return { multiplicity: '1..*', nullable: false };
  }
  if (lower === '0' && upper === '*') {
    return { multiplicity: '0..*', nullable: true };
  }

  return { error: true, raw: `${lower}..${upper}` };
}
