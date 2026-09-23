import {
  CanonicalDomainModel,
  CanonicalClass,
  CanonicalAttribute,
  DomainModelContractError,
} from '../domain/model';
import { type Node, type Edge } from '@xyflow/react';

export interface UmlClassNodeData {
  [key: string]: unknown;
  id: string;
  name: string;
  packageId?: string;
  description?: string;
  packages: { id: string; name: string }[];
  attributes: CanonicalAttribute[];
  readOnly?: boolean;
  onAddAttribute?: (classId: string, name: string, type: string, multiplicity: string, nullable?: boolean, description?: string) => void;
  onUpdateAttribute?: (classId: string, attributeId: string, updates: { name: string; type: string; multiplicity: string; nullable: boolean; description?: string }) => void;
  onDeleteAttribute?: (classId: string, attributeId: string) => void;
  onUpdateClass?: (input: { classId: string; name: string; packageId: string | null; description: string }) => void;
  onRenameClass?: (classId: string, newName: string) => void;
  onDeleteClass?: (classId: string) => void;
}

export type UmlClassFlowNode = Node<UmlClassNodeData, 'umlClass'>;

export interface UmlPackageNodeData {
  [key: string]: unknown;
  id: string;
  name: string;
  readOnly?: boolean;
}

export type UmlPackageFlowNode = Node<UmlPackageNodeData, 'umlPackage'>;

export type AnyFlowNode = UmlClassFlowNode | UmlPackageFlowNode;

/** Posiciones visuales por id de elemento; el modelo canónico es solo semántico. */
export type LayoutPositions = Record<string, { x: number; y: number }>;

export type UmlAssociationFlowEdge = Edge;

/**
 * Parsea y valida un documento de modelo de dominio canónico según docs/contracts/domain-model-v1.md.
 * Rechaza de forma explícita versiones de contrato no soportadas (!== '1').
 */
export function parseDomainModel(raw: unknown): CanonicalDomainModel {
  if (!raw || typeof raw !== 'object') {
    throw new DomainModelContractError(
      'INVALID_MODEL_DOCUMENT',
      'The domain model document must be a non-null object.'
    );
  }

  const doc = raw as Record<string, unknown>;

  if (typeof doc.contractVersion !== 'string') {
    throw new DomainModelContractError(
      'MISSING_CONTRACT_VERSION',
      'The domain model document is missing the mandatory "contractVersion" field.'
    );
  }

  if (doc.contractVersion !== '1') {
    throw new DomainModelContractError(
      'UNSUPPORTED_CONTRACT_VERSION',
      `Unsupported contractVersion "${doc.contractVersion}". Expected "1" according to domain-model-v1.md.`
    );
  }

  if (typeof doc.id !== 'string' || !doc.id.trim()) {
    throw new DomainModelContractError('INVALID_MODEL_ID', 'Missing or invalid model "id".');
  }

  if (typeof doc.name !== 'string' || !doc.name.trim()) {
    throw new DomainModelContractError('INVALID_MODEL_NAME', 'Missing or invalid model "name".');
  }

  if (typeof doc.version !== 'string' || !doc.version.trim()) {
    throw new DomainModelContractError('INVALID_MODEL_VERSION', 'Missing or invalid model "version".');
  }

  if (!Array.isArray(doc.classes)) {
    throw new DomainModelContractError('MISSING_CLASSES_ARRAY', 'The "classes" field must be an array.');
  }

  if (!Array.isArray(doc.packages)) {
    throw new DomainModelContractError('MISSING_PACKAGES_ARRAY', 'The "packages" field must be an array.');
  }

  if (!Array.isArray(doc.associations)) {
    throw new DomainModelContractError(
      'MISSING_ASSOCIATIONS_ARRAY',
      'The "associations" field must be an array.'
    );
  }

  const parsedClasses: CanonicalClass[] = doc.classes.map((c, index) => {
    if (!c || typeof c !== 'object') {
      throw new DomainModelContractError('INVALID_CLASS_ENTRY', `Class at index ${index} is invalid.`);
    }
    const classObj = c as Record<string, unknown>;
    if (typeof classObj.id !== 'string' || typeof classObj.name !== 'string') {
      throw new DomainModelContractError(
        'INVALID_CLASS_STRUCTURE',
        `Class at index ${index} must have "id" and "name".`
      );
    }

    const attrs = Array.isArray(classObj.attributes) ? classObj.attributes : [];
    const parsedAttributes: CanonicalAttribute[] = attrs.map((a, attrIdx) => {
      const attrObj = a as Record<string, unknown>;
      return {
        id: String(attrObj.id ?? `attr-${attrIdx}`),
        name: String(attrObj.name ?? ''),
        type: String(attrObj.type ?? 'String'),
        nullable: Boolean(attrObj.nullable),
        multiplicity: String(attrObj.multiplicity ?? '1'),
        description: typeof attrObj.description === 'string' ? attrObj.description : undefined,
      };
    });

    return {
      id: classObj.id,
      name: classObj.name,
      packageId: typeof classObj.packageId === 'string' ? classObj.packageId : undefined,
      description: typeof classObj.description === 'string' ? classObj.description : undefined,
      attributes: parsedAttributes,
    };
  });

  return {
    contractVersion: doc.contractVersion,
    id: doc.id,
    name: doc.name,
    version: doc.version,
    description: typeof doc.description === 'string' ? doc.description : undefined,
    packages: doc.packages as CanonicalDomainModel['packages'],
    classes: parsedClasses,
    associations: doc.associations as CanonicalDomainModel['associations'],
  };
}

/**
 * Transforma un modelo canónico en nodos de React Flow (corte mínimo: renderizar clases y atributos).
 * Dispone las clases en una cuadrícula determinista sin lógica de dominio cableada.
 */
export interface FlowNodeCallbacks {
  readOnly?: boolean;
  onAddAttribute?: (classId: string, name: string, type: string, multiplicity: string, nullable?: boolean, description?: string) => void;
  onUpdateAttribute?: (classId: string, attributeId: string, updates: { name: string; type: string; multiplicity: string; nullable: boolean; description?: string }) => void;
  onDeleteAttribute?: (classId: string, attributeId: string) => void;
  onUpdateClass?: (input: { classId: string; name: string; packageId: string | null; description: string }) => void;
  onRenameClass?: (classId: string, newName: string) => void;
  onDeleteClass?: (classId: string) => void;
}

export function modelToFlowNodes(
  model: CanonicalDomainModel,
  callbacks?: FlowNodeCallbacks,
  positions: LayoutPositions = {}
): AnyFlowNode[] {
  const columns = 2;
  const colSpacing = 320;
  const rowSpacing = 240;
  const startX = 60;
  const startY = 60;

  const classNodes: UmlClassFlowNode[] = model.classes.map((cls, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const fallback = {
      x: startX + col * colSpacing,
      y: startY + row * rowSpacing,
    };

    return {
      id: cls.id,
      type: 'umlClass' as const,
      position: positions[cls.id] ?? fallback,
      data: {
        id: cls.id,
        name: cls.name,
        packageId: cls.packageId,
        description: cls.description,
        packages: model.packages.map((item) => ({ id: item.id, name: item.name })),
        attributes: cls.attributes,
        readOnly: callbacks?.readOnly,
        onAddAttribute: callbacks?.readOnly ? undefined : callbacks?.onAddAttribute,
        onUpdateAttribute: callbacks?.readOnly ? undefined : callbacks?.onUpdateAttribute,
        onDeleteAttribute: callbacks?.readOnly ? undefined : callbacks?.onDeleteAttribute,
        onUpdateClass: callbacks?.readOnly ? undefined : callbacks?.onUpdateClass,
        onRenameClass: callbacks?.readOnly ? undefined : callbacks?.onRenameClass,
        onDeleteClass: callbacks?.readOnly ? undefined : callbacks?.onDeleteClass,
      },
    };
  });

  const packageNodes: UmlPackageFlowNode[] = model.packages.map((pkg, index) => ({
    id: pkg.id,
    type: 'umlPackage' as const,
    position: positions[pkg.id] ?? {
      x: startX + index * 260,
      y: startY - 140,
    },
    data: {
      id: pkg.id,
      name: pkg.name,
      readOnly: callbacks?.readOnly,
    },
  }));

  return [...packageNodes, ...classNodes];
}

/**
 * Transforma las asociaciones del modelo canónico en aristas de React Flow.
 * La etiqueta muestra el nombre (si existe) y las multiplicidades de ambos extremos;
 * las asociaciones unidireccionales llevan flecha en el extremo destino.
 */
export function modelToFlowEdges(model: CanonicalDomainModel): Edge[] {
  return model.associations.map((assoc) => {
    const kind = assoc.kind ?? 'association';
    const structural = kind !== 'generalization' && kind !== 'dependency';
    const mults = structural ? ` [${assoc.sourceMultiplicity} → ${assoc.targetMultiplicity}]` : '';
    return {
      id: assoc.id,
      type: 'umlAssociation',
      source: assoc.sourceClassId,
      target: assoc.targetClassId,
      label: `${assoc.name ?? ''}${mults}`.trim() || undefined,
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: 'var(--diagram-surface)', fillOpacity: 0.9 },
      style: { stroke: 'var(--diagram-border)', strokeWidth: 2 },
      markerEnd:
        kind === 'association' && assoc.navigability === 'unidirectional'
          ? 'url(#uml-association-arrow)'
          : undefined,
      data: {
        name: assoc.name,
        sourceMultiplicity: assoc.sourceMultiplicity,
        targetMultiplicity: assoc.targetMultiplicity,
        navigability: assoc.navigability,
        kind,
        associationClassId: assoc.associationClassId,
      },
    };
  });
}
