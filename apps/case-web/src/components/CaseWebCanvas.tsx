import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  useNodesState,
  applyNodeChanges,
  ConnectionLineType,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CanonicalDomainModel, AssociationKind } from '../domain/model';
import {
  modelToFlowNodes,
  modelToFlowEdges,
  type FlowNodeCallbacks,
  type AnyFlowNode,
} from '../adapter/domainModelAdapter';
import { UmlClassNode } from './UmlClassNode';
import { UmlPackageNode } from './UmlPackageNode';
import { UmlAssociationEdge, UmlEdgeMarkerDefs } from './UmlAssociationEdge';
import {
  ALLOWED_MULTIPLICITIES,
  type CommandExecutionResult,
} from '../commands/attributeCommands';
import {
  ALLOWED_NAVIGABILITIES,
  STRUCTURAL_KINDS,
  type CreateAssociationInput,
} from '../commands/associationCommands';
import type { CreateClassInput } from '../commands/classCommands';

export interface CollaborationBarInfo {
  stateLabel: string;
  connected: boolean;
  roleLabel?: string;
  participants: string[];
  pendingCount: number;
}

export interface CreatePackageInput {
  packageId: string;
  name: string;
}

export interface CaseWebCanvasProps extends FlowNodeCallbacks {
  model: CanonicalDomainModel;
  lastCommandResult?: CommandExecutionResult | null;
  collaboration?: CollaborationBarInfo;
  onCreateAssociation?: (input: CreateAssociationInput) => void;
  onCreateClass?: (input: CreateClassInput) => void;
  onRenameClass?: (classId: string, newName: string) => void;
  onDeleteClass?: (classId: string) => void;
  onCreatePackage?: (input: CreatePackageInput) => void;
  onDeletePackage?: (packageId: string) => void;
  onDeleteAssociation?: (associationId: string) => void;
}

type PaletteKind = 'class' | 'package';

const PALETTE_ITEMS: { kind: PaletteKind; label: string; hint: string }[] = [
  { kind: 'class', label: 'Clase', hint: 'Arrastra al lienzo para crear' },
  { kind: 'package', label: 'Paquete', hint: 'Arrastra al lienzo para crear' },
];

const RELATION_ITEMS: { kind: AssociationKind; label: string }[] = [
  { kind: 'association', label: '— Asociación' },
  { kind: 'aggregation', label: '—◇ Agregación' },
  { kind: 'composition', label: '—◆ Composición' },
  { kind: 'generalization', label: '—▷ Generalización' },
  { kind: 'dependency', label: '⇢ Dependencia' },
  { kind: 'associationClass', label: '— Clase-asociación' },
];

const PALETTE_DRAG_TYPE = 'application/x-case-palette-item';

interface PendingConnection {
  sourceClassId: string;
  targetClassId: string;
}

let paletteCounter = 0;
const nextName = (prefix: string) => `${prefix}${++paletteCounter}`;

const CaseWebCanvasInner: React.FC<CaseWebCanvasProps> = ({
  model,
  lastCommandResult,
  collaboration,
  readOnly,
  onAddAttribute,
  onUpdateAttribute,
  onRenameClass,
  onDeleteClass,
  onCreateAssociation,
  onCreateClass,
  onCreatePackage,
  onDeletePackage,
  onDeleteAssociation,
}) => {
  const { screenToFlowPosition } = useReactFlow();
  const flowWrapper = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      umlClass: UmlClassNode,
      umlPackage: UmlPackageNode,
    }),
    []
  );

  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      umlAssociation: UmlAssociationEdge,
    }),
    []
  );

  // Nodos controlados por React Flow (conservan dragging/measured/selected
  // internos, evitando parpadeo). El modelo se fusiona encima en el effect.
  const [flowNodes, setFlowNodes] = useNodesState<AnyFlowNode>([]);
  // Posición de drop/click para elementos aún no presentes en el modelo.
  const pendingPositions = useRef<Record<string, { x: number; y: number }>>({});

  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [assocName, setAssocName] = useState('');
  const [assocKind, setAssocKind] = useState<AssociationKind>('association');
  const [paletteRelationKind, setPaletteRelationKind] = useState<AssociationKind>('association');
  const [assocClassId, setAssocClassId] = useState('');
  const [assocSourceMult, setAssocSourceMult] = useState<string>(ALLOWED_MULTIPLICITIES[0]);
  const [assocTargetMult, setAssocTargetMult] = useState<string>(ALLOWED_MULTIPLICITIES[0]);
  const [assocNavigability, setAssocNavigability] = useState<string>(ALLOWED_NAVIGABILITIES[0]);

  // Ids de nodos eliminados en el ciclo actual: sus aristas se eliminan en
  // cascada dentro del propio comando DeleteClass; no emitir DeleteAssociation.
  const deletedNodeIds = useRef<Set<string>>(new Set());

  const callbacks = useMemo(
    () => ({ readOnly, onAddAttribute, onUpdateAttribute, onRenameClass }),
    [readOnly, onAddAttribute, onUpdateAttribute, onRenameClass]
  );

  // Sincroniza el modelo canónico con los nodos del canvas conservando
  // posición/estado interno de los ya existentes (claves del no-parpadeo).
  useEffect(() => {
    setFlowNodes((current) => {
      const fresh = modelToFlowNodes(model, callbacks);
      return fresh.map((n) => {
        const prev = current.find((p) => p.id === n.id);
        const pending = pendingPositions.current[n.id];
        if (pending) delete pendingPositions.current[n.id];
        if (!prev) return pending ? { ...n, position: pending } : n;
        return {
          ...n,
          position: prev.position,
          selected: prev.selected,
          dragging: prev.dragging,
          measured: prev.measured,
        };
      });
    });
  }, [model, callbacks, setFlowNodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<AnyFlowNode>[]) => {
      setFlowNodes((ns) => applyNodeChanges(changes, ns));
    },
    [setFlowNodes]
  );

  const edges = useMemo(() => modelToFlowEdges(model), [model]);

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    model.classes.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [model.classes]);

  /* ---------------- Paleta drag & drop (estilo Apollon) ---------------- */

  const createPaletteItem = useCallback(
    (kind: PaletteKind, position: { x: number; y: number }) => {
      if (kind === 'package') {
        if (!onCreatePackage) return;
        const packageId = `pkg-${crypto.randomUUID()}`;
        pendingPositions.current[packageId] = position;
        onCreatePackage({ packageId, name: nextName('Paquete') });
        return;
      }
      if (!onCreateClass) return;
      const classId = `cls-${crypto.randomUUID()}`;
      pendingPositions.current[classId] = position;
      onCreateClass({
        classId,
        name: nextName('Clase'),
        packageId: model.packages[0]?.id,
      });
    },
    [onCreateClass, onCreatePackage, model.packages]
  );

  const handlePaletteDragStart = (kind: PaletteKind) => (e: React.DragEvent) => {
    e.dataTransfer.setData(PALETTE_DRAG_TYPE, kind);
    e.dataTransfer.effectAllowed = 'move';
  };

  /** Alternativa accesible al drag: clic crea el elemento en la siguiente celda libre. */
  const handlePaletteClick = (kind: PaletteKind) => () => {
    const index = flowNodes.length;
    createPaletteItem(kind, { x: 80 + (index % 3) * 320, y: 80 + Math.floor(index / 3) * 260 });
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const kind = e.dataTransfer.getData(PALETTE_DRAG_TYPE) as PaletteKind | '';
      if (!kind) return;
      e.preventDefault();
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      createPaletteItem(kind, position);
    },
    [screenToFlowPosition, createPaletteItem]
  );

  /* ---------------- Conexión por arrastre → popover ---------------- */

  const openAssociationPopover = useCallback((sourceClassId: string, targetClassId: string) => {
    setAssocName('');
    setAssocKind(paletteRelationKind);
    setAssocClassId('');
    setAssocSourceMult(ALLOWED_MULTIPLICITIES[0]);
    setAssocTargetMult(ALLOWED_MULTIPLICITIES[0]);
    setAssocNavigability(ALLOWED_NAVIGABILITIES[0]);
    setPendingConnection({ sourceClassId, targetClassId });
  }, [paletteRelationKind]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      openAssociationPopover(connection.source, connection.target);
    },
    [openAssociationPopover]
  );

  const handleConfirmConnection = () => {
    if (pendingConnection && onCreateAssociation) {
      const structural = STRUCTURAL_KINDS.includes(assocKind);
      onCreateAssociation({
        name: assocName.trim() ? assocName.trim() : undefined,
        kind: assocKind,
        sourceClassId: pendingConnection.sourceClassId,
        targetClassId: pendingConnection.targetClassId,
        sourceMultiplicity: structural ? assocSourceMult : '1',
        targetMultiplicity: structural ? assocTargetMult : '1',
        navigability: structural ? assocNavigability : 'unidirectional',
        associationClassId: assocKind === 'associationClass' && assocClassId ? assocClassId : undefined,
      });
    }
    setPendingConnection(null);
  };

  /* ---------------- Movimiento libre y borrado ---------------- */

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((n) => deletedNodeIds.current.add(n.id));
      for (const n of deleted) {
        if (n.type === 'umlPackage') onDeletePackage?.(n.id);
        else onDeleteClass?.(n.id);
      }
    },
    [onDeleteClass, onDeletePackage]
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        if (deletedNodeIds.current.has(e.source) || deletedNodeIds.current.has(e.target)) continue;
        onDeleteAssociation?.(e.id);
      }
      deletedNodeIds.current.clear();
    },
    [onDeleteAssociation]
  );

  const editable = !readOnly;

  return (
    <div
      style={{ width: '100%', height: '100%', minHeight: '500px', display: 'flex', flexDirection: 'column' }}
      data-testid="case-web-canvas-container"
    >
      {/* Barra de información superior */}
      <header
        style={{
          padding: '12px 20px',
          background: '#0f172a',
          color: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Editor CASE — {model.name}
          </h1>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Versión del modelo: {model.version} | Contrato: v{model.contractVersion}
          </span>
        </div>
        <div data-testid="model-classes-count" style={{ fontSize: '13px', color: '#38bdf8' }}>
          {model.classes.length} {model.classes.length === 1 ? 'clase' : 'clases'} renderizadas
        </div>
      </header>

      {/* Barra de estado de colaboración (solo en modo conectado) */}
      {collaboration && (
        <div
          data-testid="collaboration-bar"
          style={{
            padding: '6px 20px',
            background: '#1e293b',
            color: '#e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '12px',
          }}
        >
          <span data-testid="collaboration-state" style={{ color: collaboration.connected ? '#4ade80' : '#fbbf24' }}>
            ● {collaboration.stateLabel}
          </span>
          {collaboration.roleLabel && (
            <span data-testid="collaboration-role">Rol: {collaboration.roleLabel}</span>
          )}
          <span data-testid="collaboration-participants">
            Participantes: {collaboration.participants.length}
          </span>
          {collaboration.pendingCount > 0 && (
            <span data-testid="collaboration-pending">
              {collaboration.pendingCount} comando(s) pendiente(s)
            </span>
          )}
          {readOnly && (
            <span data-testid="collaboration-readonly" style={{ marginLeft: 'auto', color: '#94a3b8' }}>
              Modo solo lectura
            </span>
          )}
        </div>
      )}

      {/* Banner de resultado del último comando */}
      {lastCommandResult && (
        <div
          data-testid="command-result-banner"
          style={{
            padding: '8px 20px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: lastCommandResult.result === 'accepted' ? '#f0fdf4' : '#fef2f2',
            borderBottom: `1px solid ${lastCommandResult.result === 'accepted' ? '#86efac' : '#fca5a5'}`,
            color: lastCommandResult.result === 'accepted' ? '#166534' : '#991b1b',
          }}
        >
          <span>
            <strong>Comando {lastCommandResult.result === 'accepted' ? 'aplicado' : 'rechazado'}:</strong>{' '}
            {lastCommandResult.errors && lastCommandResult.errors.length > 0
              ? lastCommandResult.errors.map((e) => `[${e.code}] ${e.message}`).join(', ')
              : `Versión del modelo: ${lastCommandResult.modelVersion}`}
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            ID: {lastCommandResult.commandId.slice(0, 8)}...
          </span>
        </div>
      )}

      {/* Zona principal: paleta + lienzo */}
      <main style={{ flex: 1, position: 'relative', minHeight: '400px', display: 'flex' }}>
        {editable && (onCreateClass || onCreatePackage) && (
          <aside
            data-testid="element-palette"
            aria-label="Paleta de elementos UML"
            style={{
              width: '140px',
              flexShrink: 0,
              background: '#f8fafc',
              borderRight: '1px solid #e2e8f0',
              padding: '10px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>
              Elementos
            </div>
            {PALETTE_ITEMS.map((item) => (
              <div
                key={item.kind}
                data-testid={`palette-item-${item.kind}`}
                draggable
                onDragStart={handlePaletteDragStart(item.kind)}
                onClick={handlePaletteClick(item.kind)}
                title={item.hint}
                style={{
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '6px',
                  background: '#ffffff',
                  padding: '8px 6px',
                  fontSize: '12px',
                  textAlign: 'center',
                  cursor: 'grab',
                  color: '#0f172a',
                  userSelect: 'none',
                }}
              >
                {item.kind === 'package' ? (
                  <span>&#128193; {item.label}</span>
                ) : (
                  item.label
                )}
              </div>
            ))}
            {onCreateAssociation && (
              <>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '8px', marginBottom: '2px' }}>
                  Relaciones
                </div>
                {RELATION_ITEMS.map((item) => (
                  <div
                    key={item.kind}
                    data-testid={`palette-relation-${item.kind}`}
                    role="button"
                    aria-pressed={paletteRelationKind === item.kind}
                    onClick={() => setPaletteRelationKind(item.kind)}
                    title="Selecciona y arrastra entre dos clases"
                    style={{
                      border: `1.5px solid ${paletteRelationKind === item.kind ? '#0284c7' : '#cbd5e1'}`,
                      borderRadius: '6px',
                      background: paletteRelationKind === item.kind ? '#e0f2fe' : '#ffffff',
                      padding: '6px',
                      fontSize: '11px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      color: '#0f172a',
                      userSelect: 'none',
                    }}
                  >
                    {item.label}
                  </div>
                ))}
                <button
                  data-testid="btn-add-association"
                  onClick={() =>
                    openAssociationPopover(
                      model.classes[0]?.id ?? '',
                      model.classes[1]?.id ?? model.classes[0]?.id ?? ''
                    )
                  }
                  disabled={model.classes.length < 2}
                  title={
                    model.classes.length < 2
                      ? 'Se requieren al menos dos clases para crear una relación'
                      : 'Crear relación eligiendo origen y destino'
                  }
                  style={{
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '6px',
                    background: '#ffffff',
                    padding: '8px 6px',
                    fontSize: '12px',
                    cursor: model.classes.length < 2 ? 'not-allowed' : 'pointer',
                    color: '#334155',
                  }}
                >
                  ↔ Crear relación
                </button>
              </>
            )}
            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px', lineHeight: 1.4 }}>
              Arrastra elementos al lienzo. Elige un tipo de relación y arrastra entre dos clases. Doble clic renombra. Supr elimina lo seleccionado.
            </div>
          </aside>
        )}

        <div ref={flowWrapper} style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            nodesFocusable={true}
            edgesFocusable={false}
            connectionLineType={ConnectionLineType.Straight}
            nodesConnectable={editable}
            nodesDraggable={true}
            elementsSelectable={true}
            deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onConnect={editable ? handleConnect : undefined}

            onNodesDelete={editable ? handleNodesDelete : undefined}
            onEdgesDelete={editable ? handleEdgesDelete : undefined}
            aria-label="Diagrama UML de clases"
          >
            <Background color="#cbd5e1" gap={16} />
            <Controls />
          </ReactFlow>
          <UmlEdgeMarkerDefs />

          {/* Popover de configuración de asociación (estilo Apollon) */}
          {pendingConnection && (
            <div
              data-testid="association-popover"
              role="dialog"
              aria-label="Configurar asociación"
              style={{
                position: 'absolute',
                top: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 20,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
                fontSize: '12px',
              }}
            >
              <select
                data-testid="assoc-kind-select"
                aria-label="Tipo de relación"
                value={assocKind}
                onChange={(e) => setAssocKind(e.target.value as AssociationKind)}
                style={{ fontSize: '12px', padding: '3px' }}
              >
                <option value="association">Asociación</option>
                <option value="aggregation">Agregación ◇</option>
                <option value="composition">Composición ◆</option>
                <option value="generalization">Generalización ▷</option>
                <option value="dependency">Dependencia ⇢</option>
                <option value="associationClass">Clase-asociación</option>
              </select>
              <input
                data-testid="assoc-name-input"
                placeholder="nombreAsociacion (opcional)"
                value={assocName}
                onChange={(e) => setAssocName(e.target.value)}
                style={{ fontSize: '12px', padding: '3px 6px' }}
              />
              <select
                data-testid="assoc-source-select"
                aria-label="Clase origen"
                value={pendingConnection.sourceClassId}
                onChange={(e) =>
                  setPendingConnection((p) => (p ? { ...p, sourceClassId: e.target.value } : p))
                }
                style={{ fontSize: '12px', padding: '3px' }}
              >
                {model.classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {STRUCTURAL_KINDS.includes(assocKind) && (
                <select
                  data-testid="assoc-source-mult-select"
                  aria-label="Multiplicidad origen"
                  value={assocSourceMult}
                  onChange={(e) => setAssocSourceMult(e.target.value)}
                  style={{ fontSize: '12px', padding: '3px' }}
                >
                  {ALLOWED_MULTIPLICITIES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
              <span aria-hidden="true">→</span>
              <select
                data-testid="assoc-target-select"
                aria-label="Clase destino"
                value={pendingConnection.targetClassId}
                onChange={(e) =>
                  setPendingConnection((p) => (p ? { ...p, targetClassId: e.target.value } : p))
                }
                style={{ fontSize: '12px', padding: '3px' }}
              >
                {model.classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {STRUCTURAL_KINDS.includes(assocKind) && (
                <>
                  <select
                    data-testid="assoc-target-mult-select"
                    aria-label="Multiplicidad destino"
                    value={assocTargetMult}
                    onChange={(e) => setAssocTargetMult(e.target.value)}
                    style={{ fontSize: '12px', padding: '3px' }}
                  >
                    {ALLOWED_MULTIPLICITIES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select
                    data-testid="assoc-navigability-select"
                    aria-label="Navegabilidad"
                    value={assocNavigability}
                    onChange={(e) => setAssocNavigability(e.target.value)}
                    style={{ fontSize: '12px', padding: '3px' }}
                  >
                    {ALLOWED_NAVIGABILITIES.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </>
              )}
              {assocKind === 'associationClass' && (
                <select
                  data-testid="assoc-class-select"
                  aria-label="Clase de la asociación"
                  value={assocClassId}
                  onChange={(e) => setAssocClassId(e.target.value)}
                  style={{ fontSize: '12px', padding: '3px' }}
                >
                  <option value="">— clase portadora —</option>
                  {model.classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              <button
                data-testid="confirm-add-association"
                onClick={handleConfirmConnection}
                style={{ fontSize: '12px', padding: '3px 8px', cursor: 'pointer', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px' }}
              >
                Crear
              </button>
              <button
                data-testid="cancel-add-association"
                onClick={() => setPendingConnection(null)}
                style={{ fontSize: '12px', padding: '3px 8px', cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Tabla semántica accesible alternativa (ADR-0001 §Accesibilidad WCAG 2.1 AA) */}
      <section
        aria-label="Lista accesible de clases y atributos"
        data-testid="semantic-class-list"
        style={{
          borderTop: '1px solid #e2e8f0',
          background: '#f8fafc',
          padding: '12px 20px',
          maxHeight: '180px',
          overflowY: 'auto',
          fontSize: '12px',
        }}
      >
        <h2 style={{ fontSize: '13px', margin: '0 0 8px 0', color: '#334155' }}>
          Resumen textual accesible de entidades:
        </h2>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          {model.classes.map((cls) => (
            <li key={cls.id} data-testid={`semantic-item-${cls.name}`}>
              <strong>{cls.name}</strong> &mdash;{' '}
              {cls.attributes.length > 0
                ? cls.attributes
                    .map((a) => `${a.name}: ${a.type} [${a.multiplicity}]`)
                    .join(', ')
                : 'sin atributos'}
            </li>
          ))}
        </ul>
        {model.associations.length > 0 && (
          <>
            <h2 style={{ fontSize: '13px', margin: '8px 0 4px 0', color: '#334155' }}>
              Asociaciones:
            </h2>
            <ul data-testid="semantic-association-list" style={{ margin: 0, paddingLeft: '20px' }}>
              {model.associations.map((assoc) => (
                <li key={assoc.id} data-testid={`semantic-assoc-${assoc.id}`}>
                  {(assoc.kind ?? 'association') !== 'association' ? `«${assoc.kind}» ` : ''}
                  {assoc.name ? `${assoc.name}: ` : ''}
                  {classNameById.get(assoc.sourceClassId) ?? assoc.sourceClassId} [
                  {assoc.sourceMultiplicity}] →{' '}
                  {classNameById.get(assoc.targetClassId) ?? assoc.targetClassId} [
                  {assoc.targetMultiplicity}] ({assoc.navigability})
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
};

export const CaseWebCanvas: React.FC<CaseWebCanvasProps> = (props) => (
  <ReactFlowProvider>
    <CaseWebCanvasInner {...props} />
  </ReactFlowProvider>
);
