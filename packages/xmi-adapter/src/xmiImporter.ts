import { parseXml, XmlNode, XmlParseError } from './xmlParser.js';
import {
  CanonicalDomainModel,
  CanonicalPackage,
  CanonicalClass,
  CanonicalAttribute,
  CanonicalAssociation,
  CanonicalType,
  CanonicalMultiplicity,
  CanonicalNavigability,
  ImportResult,
  ImportOptions,
  XmiDiagnostic
} from './types.js';

const KNOWN_IGNORED_PACKAGED_TYPES = new Set([
  'uml:Interface',
  'uml:Enumeration',
  'uml:DataType',
  'uml:PrimitiveType',
  'uml:Dependency',
  'uml:Realization',
  'uml:Usage',
  'uml:Component',
  'uml:Artifact',
  'uml:Node',
  'uml:Collaboration',
  'uml:Signal',
  'uml:AssociationClass'
]);

export function importXmi(xmiContent: string, options: ImportOptions = {}): ImportResult {
  const diagnostics: XmiDiagnostic[] = [];

  let rootNode: XmlNode;
  try {
    rootNode = parseXml(xmiContent);
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

  // Find xmi:XMI root
  let xmiRoot = rootNode;
  if (rootNode.name !== 'xmi:XMI' && rootNode.name !== 'XMI') {
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

  const versionNum = parseFloat(exporterVersion);
  if (isNaN(versionNum) || versionNum < 15.0 || versionNum >= 17.0) {
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

  const modelId = modelNode.attributes['xmi:id'];
  const modelName = modelNode.attributes['name'];
  if (!modelId || !modelName) {
    return {
      outcome: 'error',
      canonicalModel: null,
      diagnostics: [
        {
          code: 'MALFORMED_XMI',
          severity: 'ERROR',
          path: 'uml:Model',
          message: 'Elemento uml:Model requiere atributos xmi:id y name.'
        }
      ]
    };
  }

  // First pass: gather all class IDs in the model to distinguish scalar attributes from association ends (§3.4)
  const allClassIds = new Set<string>();
  function collectClassIds(node: XmlNode) {
    for (const child of node.children) {
      if (getLocalName(child.name) === 'packagedElement') {
        const type = child.attributes['xmi:type'];
        if (type === 'uml:Class') {
          const id = child.attributes['xmi:id'];
          if (id) allClassIds.add(id);
        }
        collectClassIds(child);
      }
    }
  }
  collectClassIds(modelNode);

  const packages: CanonicalPackage[] = [];
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

  // Traverse model elements
  function processPackageChildren(pkgNode: XmlNode, parentPath: string, parentPackageId: string) {
    for (const child of pkgNode.children) {
      if (getLocalName(child.name) === 'packagedElement') {
        const type = child.attributes['xmi:type'];
        if (type === 'uml:Package') {
          processPackage(child, parentPath, parentPackageId);
        } else if (type === 'uml:Class') {
          processClass(child, parentPath, parentPackageId);
        } else if (type === 'uml:Association') {
          processAssociation(child, parentPath);
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

  function processPackage(pkgNode: XmlNode, parentPath: string, parentId?: string) {
    const pkgId = pkgNode.attributes['xmi:id'];
    const pkgName = pkgNode.attributes['name'];
    const currentPath = `${parentPath} / packagedElement[@xmi:id='${pkgId}']`;

    if (!pkgId || !pkgName) {
      diagnostics.push({
        code: 'MALFORMED_XMI',
        severity: 'ERROR',
        path: currentPath,
        message: 'Elemento uml:Package requiere atributos xmi:id y name.'
      });
      return;
    }

    registerId(pkgId, currentPath);

    const pkg: CanonicalPackage = {
      id: pkgId,
      name: pkgName
    };
    if (parentId) {
      pkg.parentId = parentId;
    }
    packages.push(pkg);

    processPackageChildren(pkgNode, currentPath, pkgId);
  }

  function processClass(classNode: XmlNode, parentPath: string, packageId?: string) {
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

    const attributes: CanonicalAttribute[] = [];

    // Parse attributes
    for (const child of classNode.children) {
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
        const attrPath = `${currentPath} / ownedAttribute[@xmi:id='${attrId}']`;

        if (!attrId || !attrName) {
          diagnostics.push({
            code: 'MALFORMED_XMI',
            severity: 'ERROR',
            path: attrPath,
            message: `Atributo en clase '${className}' requiere atributos xmi:id y name.`
          });
          continue;
        }

        registerId(attrId, attrPath);

        // Resolve attribute type (inspect attribute or child <type href="..." name="...">)
        let rawType = child.attributes['type'] || '';
        if (!rawType) {
          const typeChild = findFirstChildByLocalName(child, 'type');
          if (typeChild) {
            rawType = typeChild.attributes['name'] || '';
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

        const typeMapping = mapRawType(rawType);

        if (typeMapping.error) {
          diagnostics.push({
            code: 'UNKNOWN_TYPE',
            severity: 'ERROR',
            path: attrPath,
            message: `Tipo '${rawType}' no reconocido en el perfil XMI v1. Ruta: clase '${className}' / atributo '${attrName}'. Tipos soportados: String, Integer, Long, Double, Boolean, Date, DateTime, UUID.`,
            element: {
              xmiId: attrId,
              className,
              attributeName: attrName,
              typeFound: rawType
            }
          });
        } else if (typeMapping.warning) {
          diagnostics.push({
            code: 'TYPE_PROMOTED',
            severity: 'WARNING',
            path: attrPath,
            message: `Tipo '${rawType}' promovido a 'Double' en '${className}.${attrName}'.`
          });
        }

        // Multiplicity and nullability derivation (§3.4)
        const multDerivation = deriveMultiplicity(child);
        if (multDerivation.error) {
          diagnostics.push({
            code: 'UNSUPPORTED_MULTIPLICITY',
            severity: 'ERROR',
            path: attrPath,
            message: `Multiplicidad '${multDerivation.raw}' no soportada en '${className}.${attrName}'.`
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

    const cls: CanonicalClass = {
      id: classId,
      name: className,
      attributes
    };
    if (packageId && packageId.trim() !== '') {
      cls.packageId = packageId;
    }
    if (description) {
      cls.description = description;
    }
    classes.push(cls);
  }

  function processAssociation(assocNode: XmlNode, parentPath: string) {
    const assocId = assocNode.attributes['xmi:id'];
    const assocName = assocNode.attributes['name'] || '';
    const currentPath = `${parentPath} / packagedElement[@xmi:id='${assocId}']`;

    if (!assocId) {
      diagnostics.push({
        code: 'MALFORMED_XMI',
        severity: 'ERROR',
        path: currentPath,
        message: 'Elemento uml:Association requiere atributo xmi:id.'
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
      const srcEnd = endNodes[0];
      const tgtEnd = endNodes[1];

      const sourceClassId = srcEnd.attributes['type'] || '';
      const targetClassId = tgtEnd.attributes['type'] || '';

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

      associations.push({
        id: assocId,
        name: assocName,
        sourceClassId,
        targetClassId,
        sourceMultiplicity: srcMult.multiplicity!,
        targetMultiplicity: tgtMult.multiplicity!,
        navigability
      });
    }
  }

  // Process root uml:Model elements
  const modelPath = `uml:Model[@xmi:id='${modelId}']`;
  for (const child of modelNode.children) {
    if (getLocalName(child.name) === 'packagedElement') {
      const type = child.attributes['xmi:type'];
      if (type === 'uml:Package') {
        processPackage(child, modelPath);
      } else if (type === 'uml:Class') {
        processClass(child, modelPath);
      } else if (type === 'uml:Association') {
        processAssociation(child, modelPath);
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
  // packages: id ASC
  packages.sort((a, b) => a.id.localeCompare(b.id));

  // classes: packageId ASC (null/undefined first), then id ASC
  classes.sort((a, b) => {
    const pkgA = a.packageId ?? '';
    const pkgB = b.packageId ?? '';
    const pkgComp = pkgA.localeCompare(pkgB);
    return pkgComp !== 0 ? pkgComp : a.id.localeCompare(b.id);
  });

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
    packages,
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

function mapRawType(raw: string): { canonicalType?: CanonicalType; warning?: boolean; error?: boolean } {
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'string':
    case 'eajava_string':
    case 'java.lang.string':
      return { canonicalType: 'String' };
    case 'int':
    case 'integer':
    case 'eajava_int':
    case 'java.lang.integer':
      return { canonicalType: 'Integer' };
    case 'long':
    case 'eajava_long':
    case 'java.lang.long':
      return { canonicalType: 'Long' };
    case 'double':
    case 'eajava_double':
      return { canonicalType: 'Double' };
    case 'float':
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
  const upper = upperRaw !== undefined && upperRaw !== null && upperRaw !== '' ? upperRaw : '1';

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
