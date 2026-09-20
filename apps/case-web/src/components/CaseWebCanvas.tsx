import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CanonicalDomainModel } from '../domain/model';
import { modelToFlowNodes, type FlowNodeCallbacks } from '../adapter/domainModelAdapter';
import { UmlClassNode } from './UmlClassNode';
import type { CommandExecutionResult } from '../commands/attributeCommands';

interface CaseWebCanvasProps extends FlowNodeCallbacks {
  model: CanonicalDomainModel;
  lastCommandResult?: CommandExecutionResult | null;
}

export const CaseWebCanvas: React.FC<CaseWebCanvasProps> = ({
  model,
  lastCommandResult,
  onAddAttribute,
  onUpdateAttribute,
}) => {
  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      umlClass: UmlClassNode,
    }),
    []
  );

  const callbacks = useMemo(
    () => ({
      onAddAttribute,
      onUpdateAttribute,
    }),
    [onAddAttribute, onUpdateAttribute]
  );

  const nodes = useMemo(() => modelToFlowNodes(model, callbacks), [model, callbacks]);

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
          edges={[]}
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
      </section>
    </div>
  );
};
