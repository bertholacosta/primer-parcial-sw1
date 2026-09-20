import React, { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CanonicalDomainModel } from '../domain/model';
import {
  modelToFlowNodes,
  modelToFlowEdges,
  type FlowNodeCallbacks,
} from '../adapter/domainModelAdapter';
import { UmlClassNode } from './UmlClassNode';
import {
  ALLOWED_MULTIPLICITIES,
  type CommandExecutionResult,
} from '../commands/attributeCommands';
import {
  ALLOWED_NAVIGABILITIES,
  type CreateAssociationInput,
} from '../commands/associationCommands';

interface CaseWebCanvasProps extends FlowNodeCallbacks {
  model: CanonicalDomainModel;
  lastCommandResult?: CommandExecutionResult | null;
  onCreateAssociation?: (input: CreateAssociationInput) => void;
}

export const CaseWebCanvas: React.FC<CaseWebCanvasProps> = ({
  model,
  lastCommandResult,
  onAddAttribute,
  onUpdateAttribute,
  onCreateAssociation,
}) => {
  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      umlClass: UmlClassNode,
    }),
    []
  );

  const [isAddingAssociation, setIsAddingAssociation] = useState(false);
  const [assocName, setAssocName] = useState('');
  const [assocSourceId, setAssocSourceId] = useState('');
  const [assocTargetId, setAssocTargetId] = useState('');
  const [assocSourceMult, setAssocSourceMult] = useState<string>(ALLOWED_MULTIPLICITIES[0]);
  const [assocTargetMult, setAssocTargetMult] = useState<string>(ALLOWED_MULTIPLICITIES[0]);
  const [assocNavigability, setAssocNavigability] = useState<string>(ALLOWED_NAVIGABILITIES[0]);

  const handleStartAddAssociation = () => {
    setAssocName('');
    setAssocSourceId(model.classes[0]?.id ?? '');
    setAssocTargetId(model.classes[1]?.id ?? model.classes[0]?.id ?? '');
    setAssocSourceMult(ALLOWED_MULTIPLICITIES[0]);
    setAssocTargetMult(ALLOWED_MULTIPLICITIES[0]);
    setAssocNavigability(ALLOWED_NAVIGABILITIES[0]);
    setIsAddingAssociation(true);
  };

  const handleConfirmAddAssociation = () => {
    if (onCreateAssociation) {
      onCreateAssociation({
        name: assocName.trim() ? assocName.trim() : undefined,
        sourceClassId: assocSourceId,
        targetClassId: assocTargetId,
        sourceMultiplicity: assocSourceMult,
        targetMultiplicity: assocTargetMult,
        navigability: assocNavigability,
      });
    }
    setIsAddingAssociation(false);
  };

  const callbacks = useMemo(
    () => ({
      onAddAttribute,
      onUpdateAttribute,
    }),
    [onAddAttribute, onUpdateAttribute]
  );

  const nodes = useMemo(() => modelToFlowNodes(model, callbacks), [model, callbacks]);
  const edges = useMemo(() => modelToFlowEdges(model), [model]);

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    model.classes.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [model.classes]);

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

      {/* Barra de herramientas: creación de asociaciones mediante comando */}
      <div
        data-testid="association-toolbar"
        style={{
          padding: '8px 20px',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          fontSize: '12px',
        }}
      >
        {isAddingAssociation ? (
          <>
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
              value={assocSourceId}
              onChange={(e) => setAssocSourceId(e.target.value)}
              style={{ fontSize: '12px', padding: '3px' }}
            >
              {model.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              data-testid="assoc-source-mult-select"
              aria-label="Multiplicidad origen"
              value={assocSourceMult}
              onChange={(e) => setAssocSourceMult(e.target.value)}
              style={{ fontSize: '12px', padding: '3px' }}
            >
              {ALLOWED_MULTIPLICITIES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span aria-hidden="true">→</span>
            <select
              data-testid="assoc-target-select"
              aria-label="Clase destino"
              value={assocTargetId}
              onChange={(e) => setAssocTargetId(e.target.value)}
              style={{ fontSize: '12px', padding: '3px' }}
            >
              {model.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              data-testid="assoc-target-mult-select"
              aria-label="Multiplicidad destino"
              value={assocTargetMult}
              onChange={(e) => setAssocTargetMult(e.target.value)}
              style={{ fontSize: '12px', padding: '3px' }}
            >
              {ALLOWED_MULTIPLICITIES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
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
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              data-testid="confirm-add-association"
              onClick={handleConfirmAddAssociation}
              style={{ fontSize: '12px', padding: '3px 8px', cursor: 'pointer' }}
            >
              Crear
            </button>
            <button
              data-testid="cancel-add-association"
              onClick={() => setIsAddingAssociation(false)}
              style={{ fontSize: '12px', padding: '3px 8px', cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            data-testid="btn-add-association"
            onClick={handleStartAddAssociation}
            disabled={model.classes.length < 2}
            title={
              model.classes.length < 2
                ? 'Se requieren al menos dos clases para crear una asociación'
                : 'Crear asociación entre dos clases'
            }
            style={{
              background: '#e2e8f0',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: model.classes.length < 2 ? 'not-allowed' : 'pointer',
              color: '#334155',
            }}
          >
            + Asociación
          </button>
        )}
      </div>

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

      {/* Vista de Canvas React Flow */}
      <main style={{ flex: 1, position: 'relative', minHeight: '400px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          nodesFocusable={true}
          edgesFocusable={false}
          aria-label="Diagrama UML de clases"
        >
          <Background color="#cbd5e1" gap={16} />
          <Controls />
        </ReactFlow>
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
              <strong>{cls.name}</strong> {cls.isAbstract ? '(abstracta)' : ''} &mdash;{' '}
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
