import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
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
  type CreateAssociationClassInput,
  type UpdateAssociationInput,
} from '../commands/associationCommands';
import type { CreateClassInput } from '../commands/classCommands';
import { generateAndDownloadSpringBoot } from '../generator/springBootGenerator';

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
  /** Crea la clase portadora y la asociación de tipo associationClass en una sola operación. */
  onCreateAssociationClass?: (input: CreateAssociationClassInput) => void;
  onUpdateAssociation?: (input: UpdateAssociationInput) => void;
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
  onDeleteAttribute,
  onUpdateClass,
  onRenameClass,
  onDeleteClass,
  onCreateAssociation,
  onCreateAssociationClass,
  onUpdateAssociation,
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
  const [selectedAssociationId, setSelectedAssociationId] = useState<string | null>(null);
  const [editingAssociationId, setEditingAssociationId] = useState<string | null>(null);
  const [assocName, setAssocName] = useState('');
  const [assocKind, setAssocKind] = useState<AssociationKind>('association');
  const [paletteRelationKind, setPaletteRelationKind] = useState<AssociationKind>('association');
  const [assocClassId, setAssocClassId] = useState('');
  const [assocNewClassName, setAssocNewClassName] = useState('');
  const [assocDescription, setAssocDescription] = useState('');
  const [assocSourceMult, setAssocSourceMult] = useState<string>(ALLOWED_MULTIPLICITIES[0]);
  const [assocTargetMult, setAssocTargetMult] = useState<string>(ALLOWED_MULTIPLICITIES[0]);
  const [assocNavigability, setAssocNavigability] = useState<string>(ALLOWED_NAVIGABILITIES[0]);

  // Ids de nodos eliminados en el ciclo actual: sus aristas se eliminan en
  // cascada dentro del propio comando DeleteClass; no emitir DeleteAssociation.
  const deletedNodeIds = useRef<Set<string>>(new Set());

  const callbacks = useMemo(
    () => ({ readOnly, onAddAttribute, onUpdateAttribute, onDeleteAttribute, onUpdateClass, onRenameClass, onDeleteClass }),
    [readOnly, onAddAttribute, onUpdateAttribute, onDeleteAttribute, onUpdateClass, onRenameClass, onDeleteClass]
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
    setEditingAssociationId(null);
    setAssocName('');
    setAssocKind(paletteRelationKind);
    setAssocClassId('');
    setAssocNewClassName('');
    setAssocDescription('');
    setAssocSourceMult(ALLOWED_MULTIPLICITIES[0]);
    setAssocTargetMult(ALLOWED_MULTIPLICITIES[0]);
    setAssocNavigability(ALLOWED_NAVIGABILITIES[0]);
    setPendingConnection({ sourceClassId, targetClassId });
  }, [paletteRelationKind]);

  const openAssociationEditor = useCallback((associationId: string) => {
    const association = model.associations.find((item) => item.id === associationId);
    if (!association) return;
    setEditingAssociationId(association.id);
    setAssocName(association.name ?? '');
    setAssocKind(association.kind ?? 'association');
    setAssocClassId(association.associationClassId ?? '');
    setAssocNewClassName('');
    setAssocDescription(association.description ?? '');
    setAssocSourceMult(association.sourceMultiplicity);
    setAssocTargetMult(association.targetMultiplicity);
    setAssocNavigability(association.navigability);
    setPendingConnection({
      sourceClassId: association.sourceClassId,
      targetClassId: association.targetClassId,
    });
  }, [model.associations]);

  const edges = useMemo(
    () => modelToFlowEdges(model).map((edge) => ({
      ...edge,
      selected: edge.id === selectedAssociationId,
      data: {
        ...edge.data,
        onEditAssociation: readOnly ? undefined : openAssociationEditor,
        onDeleteAssociation: readOnly ? undefined : onDeleteAssociation,
      },
    })),
    [model, readOnly, selectedAssociationId, openAssociationEditor, onDeleteAssociation]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      openAssociationPopover(connection.source, connection.target);
    },
    [openAssociationPopover]
  );

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation();
    setSelectedAssociationId(edge.id);
  }, []);

  const handleConfirmConnection = () => {
    if (!pendingConnection) return;
    const structural = STRUCTURAL_KINDS.includes(assocKind);

    if (editingAssociationId && onUpdateAssociation) {
      // Edición: la clase portadora ya existe; se pasa su id existente.
      onUpdateAssociation({
        associationId: editingAssociationId,
        name: assocName.trim(),
        kind: assocKind,
        sourceMultiplicity: structural ? assocSourceMult : undefined,
        targetMultiplicity: structural ? assocTargetMult : undefined,
        navigability: structural ? assocNavigability : undefined,
        associationClassId: assocKind === 'associationClass' ? assocClassId || null : null,
        description: assocDescription,
      });
    } else if (assocKind === 'associationClass' && onCreateAssociationClass) {
      // Creación de clase-asociación: genera la clase portadora automáticamente.
      onCreateAssociationClass({
        associationName: assocName.trim() || undefined,
        sourceClassId: pendingConnection.sourceClassId,
        targetClassId: pendingConnection.targetClassId,
        newClassName: assocNewClassName.trim() || 'AsociacionClase',
        newClassId: `cls-${crypto.randomUUID()}`,
        sourceMultiplicity: assocSourceMult,
        targetMultiplicity: assocTargetMult,
        navigability: assocNavigability,
        description: assocDescription || undefined,
      });
    } else if (onCreateAssociation) {
      onCreateAssociation({
        name: assocName.trim() ? assocName.trim() : undefined,
        kind: assocKind,
        sourceClassId: pendingConnection.sourceClassId,
        targetClassId: pendingConnection.targetClassId,
        sourceMultiplicity: structural ? assocSourceMult : '1',
        targetMultiplicity: structural ? assocTargetMult : '1',
        navigability: structural ? assocNavigability : 'unidirectional',
        description: assocDescription || undefined,
      });
    }
    setPendingConnection(null);
    setEditingAssociationId(null);
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
      setSelectedAssociationId(null);
    },
    [onDeleteAssociation]
  );

  /* ---------------- Exportación Spring Boot ---------------- */

  const [exporting, setExporting] = useState(false);

  const handleExportSpringBoot = useCallback(async () => {
    setExporting(true);
    try {
      await generateAndDownloadSpringBoot(model);
    } finally {
      setExporting(false);
    }
  }, [model]);

  const editable = !readOnly;

  return (
    <div className="case-editor" data-testid="case-web-canvas-container">
      {/* Barra de información superior */}
      <header className="editor-header">
        <div>
          <span className="editor-eyebrow">Modelo de dominio</span>
          <h1 className="editor-title">Editor CASE — {model.name}</h1>
          <span className="editor-meta">
            Versión {model.version} · Contrato v{model.contractVersion}
          </span>
        </div>
        <div className="editor-actions">
          <button
            data-testid="btn-export-spring-boot"
            className="button-secondary"
            onClick={handleExportSpringBoot}
            disabled={exporting || model.classes.length === 0}
            title={
              model.classes.length === 0
                ? 'Se requiere al menos una clase para exportar'
                : 'Descarga un ZIP con el proyecto Spring Boot generado'
            }
          >
            {exporting ? 'Generando…' : 'Exportar Spring Boot'}
          </button>
          <div data-testid="model-classes-count" className="editor-count">
            {model.classes.length} {model.classes.length === 1 ? 'clase renderizada' : 'clases renderizadas'}
          </div>
        </div>
      </header>

      {/* Barra de estado de colaboración (solo en modo conectado) */}
      {collaboration && (
        <div data-testid="collaboration-bar" className="collaboration-bar">
          <span
            data-testid="collaboration-state"
            className={`connection-state${collaboration.connected ? ' connected' : ''}`}
          >
            <span className="connection-dot" aria-hidden="true" />
            {collaboration.stateLabel}
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
            <span data-testid="collaboration-readonly" className="toolbar-spacer">
              Modo solo lectura
            </span>
          )}
        </div>
      )}

      {/* Banner de resultado del último comando */}
      {lastCommandResult && (
        <div
          data-testid="command-result-banner"
          className={`status-banner ${lastCommandResult.result}`}
        >
          <span>
            <strong>Comando {lastCommandResult.result === 'accepted' ? 'aplicado' : 'rechazado'}:</strong>{' '}
            {lastCommandResult.errors && lastCommandResult.errors.length > 0
              ? lastCommandResult.errors.map((e) => `[${e.code}] ${e.message}`).join(', ')
              : `Versión del modelo: ${lastCommandResult.modelVersion}`}
          </span>
          <span className="status-id">ID: {lastCommandResult.commandId.slice(0, 8)}…</span>
        </div>
      )}

      {/* Zona principal: paleta + lienzo */}
      <main className="editor-workspace">
        {editable && (onCreateClass || onCreatePackage) && (
          <aside
            data-testid="element-palette"
            aria-label="Paleta de elementos UML"
            className="element-palette"
          >
            <div className="palette-heading">Elementos</div>
            {PALETTE_ITEMS.map((item) => (
              <div
                key={item.kind}
                data-testid={`palette-item-${item.kind}`}
                draggable
                onDragStart={handlePaletteDragStart(item.kind)}
                onClick={handlePaletteClick(item.kind)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') handlePaletteClick(item.kind)();
                }}
                title={item.hint}
                className="palette-item"
                role="button"
                tabIndex={0}
              >
                <span className="palette-icon" aria-hidden="true">
                  {item.kind === 'package' ? '▱' : '▦'}
                </span>
                {item.label}
              </div>
            ))}
            {onCreateAssociation && (
              <>
                <div className="palette-heading relations">Relaciones</div>
                {RELATION_ITEMS.map((item) => (
                  <div
                    key={item.kind}
                    data-testid={`palette-relation-${item.kind}`}
                    role="button"
                    aria-pressed={paletteRelationKind === item.kind}
                    onClick={() => setPaletteRelationKind(item.kind)}
                    title="Selecciona y arrastra entre dos clases"
                    tabIndex={0}
                    className={`palette-relation${paletteRelationKind === item.kind ? ' active' : ''}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setPaletteRelationKind(item.kind);
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
                  className="button-secondary"
                >
                  Crear relación
                </button>
              </>
            )}
            <div className="palette-help">
              Arrastra elementos al lienzo. Elige una relación y conecta dos clases. Doble clic renombra; Supr elimina.
            </div>
          </aside>
        )}

        <div ref={flowWrapper} className="flow-stage">
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
            onEdgeClick={handleEdgeClick}
            onNodeClick={() => setSelectedAssociationId(null)}
            onPaneClick={() => setSelectedAssociationId(null)}
            onNodesDelete={editable ? handleNodesDelete : undefined}
            onEdgesDelete={editable ? handleEdgesDelete : undefined}
            aria-label="Diagrama UML de clases"
          >
            <Background variant={BackgroundVariant.Lines} color="var(--diagram-grid)" gap={16} size={0.7} />
            <Controls />
          </ReactFlow>
          <UmlEdgeMarkerDefs />

          {/* Popover de configuración de asociación (estilo Apollon) */}
          {pendingConnection && (
            <div
              data-testid="association-popover"
              role="dialog"
              aria-label="Configurar asociación"
              className="association-popover"
            >
              <select
                data-testid="assoc-kind-select"
                aria-label="Tipo de relación"
                value={assocKind}
                onChange={(e) => setAssocKind(e.target.value as AssociationKind)}
                className="field-control"
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
                className="field-control"
              />
              <select
                data-testid="assoc-source-select"
                aria-label="Clase origen"
                value={pendingConnection.sourceClassId}
                disabled={editingAssociationId !== null}
                onChange={(e) =>
                  setPendingConnection((p) => (p ? { ...p, sourceClassId: e.target.value } : p))
                }
                className="field-control"
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
                  className="field-control"
                >
                  {ALLOWED_MULTIPLICITIES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
              <span className="association-arrow" aria-hidden="true">→</span>
              <select
                data-testid="assoc-target-select"
                aria-label="Clase destino"
                value={pendingConnection.targetClassId}
                disabled={editingAssociationId !== null}
                onChange={(e) =>
                  setPendingConnection((p) => (p ? { ...p, targetClassId: e.target.value } : p))
                }
                className="field-control"
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
                    className="field-control"
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
                    className="field-control"
                  >
                    {ALLOWED_NAVIGABILITIES.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </>
              )}
              {assocKind === 'associationClass' && (
                editingAssociationId ? (
                  /* Edición: muestra la clase portadora ya existente (solo lectura en esta versión) */
                  <select
                    data-testid="assoc-class-select"
                    aria-label="Clase de la asociación"
                    value={assocClassId}
                    onChange={(e) => setAssocClassId(e.target.value)}
                    className="field-control"
                  >
                    <option value="">— clase portadora —</option>
                    {model.classes
                      .filter(
                        (c) =>
                          c.id !== pendingConnection?.sourceClassId &&
                          c.id !== pendingConnection?.targetClassId
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  /* Creación: nombre de la nueva clase portadora */
                  <>
                    <input
                      data-testid="assoc-new-class-name-input"
                      aria-label="Nombre de la clase portadora"
                      placeholder="Nombre de la clase portadora (ej. Contrato)"
                      value={assocNewClassName}
                      onChange={(e) => setAssocNewClassName(e.target.value)}
                      className="field-control"
                    />
                    <span className="field-hint" aria-live="polite">
                      Se creará una nueva clase con este nombre.
                    </span>
                  </>
                )
              )}
              <input
                data-testid="assoc-description-input"
                aria-label="Descripción de la relación"
                placeholder="Descripción (opcional)"
                value={assocDescription}
                onChange={(event) => setAssocDescription(event.target.value)}
                className="field-control"
              />
              <button
                data-testid="confirm-add-association"
                onClick={handleConfirmConnection}
                className="button-primary"
              >
                {editingAssociationId ? 'Guardar' : 'Crear'}
              </button>
              <button
                data-testid="cancel-add-association"
                onClick={() => {
                  setPendingConnection(null);
                  setEditingAssociationId(null);
                }}
                className="button-secondary"
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
        className="semantic-panel"
      >
        <h2>Resumen textual accesible de entidades</h2>
        <ul>
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
            <h2 className="association-title">Asociaciones</h2>
            <ul data-testid="semantic-association-list">
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
