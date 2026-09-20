import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { UmlClassFlowNode } from '../adapter/domainModelAdapter';

export const UmlClassNode: React.FC<NodeProps<UmlClassFlowNode>> = ({ data }) => {
  return (
    <div
      role="figure"
      aria-label={`Clase UML ${data.name}`}
      data-testid={`uml-class-node-${data.name}`}
      style={{
        background: '#ffffff',
        border: '2px solid #1e293b',
        borderRadius: '6px',
        minWidth: '220px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        color: '#0f172a',
        overflow: 'hidden',
      }}
    >
      {/* Cabecera de la Clase */}
      <div
        style={{
          background: '#f1f5f9',
          borderBottom: '1.5px solid #cbd5e1',
          padding: '8px 12px',
          textAlign: 'center',
        }}
      >
        {data.isAbstract && (
          <div
            data-testid="abstract-tag"
            style={{
              fontSize: '11px',
              fontStyle: 'italic',
              color: '#64748b',
              marginBottom: '2px',
            }}
          >
            &laquo;abstract&raquo;
          </div>
        )}
        <div
          data-testid={`class-name-${data.name}`}
          style={{
            fontWeight: 700,
            fontSize: '14px',
            fontStyle: data.isAbstract ? 'italic' : 'normal',
          }}
        >
          {data.name}
        </div>
      </div>

      {/* Compartimento de Atributos */}
      <div
        style={{
          padding: '8px 12px',
          background: '#ffffff',
          minHeight: '40px',
        }}
        data-testid={`attributes-compartment-${data.name}`}
      >
        {data.attributes && data.attributes.length > 0 ? (
          data.attributes.map((attr) => (
            <div
              key={attr.id}
              data-testid={`attribute-row-${data.name}-${attr.name}`}
              style={{
                padding: '2px 0',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <span style={{ fontWeight: 500 }}>
                + {attr.name}:{' '}
                <span style={{ color: '#0284c7', fontWeight: 600 }}>{attr.type}</span>
              </span>
              <span style={{ color: '#64748b', fontSize: '11px' }}>
                [{attr.multiplicity}]
              </span>
            </div>
          ))
        ) : (
          <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '12px' }}>
            (sin atributos)
          </div>
        )}
      </div>
    </div>
  );
};
