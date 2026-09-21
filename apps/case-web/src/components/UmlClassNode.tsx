import React, { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { UmlClassFlowNode } from '../adapter/domainModelAdapter';

const handleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  background: '#0284c7',
  border: '1px solid #ffffff',
};

export const UmlClassNode: React.FC<NodeProps<UmlClassFlowNode>> = ({ data }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrType, setNewAttrType] = useState('String');
  const [editingAttrId, setEditingAttrId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  const handleStartAdd = () => {
    setIsAdding(true);
    setNewAttrName('');
    setNewAttrType('String');
  };

  const handleConfirmAdd = () => {
    if (data.onAddAttribute && typeof data.onAddAttribute === 'function') {
      data.onAddAttribute(data.id, newAttrName, newAttrType, '1');
    }
    setIsAdding(false);
    setNewAttrName('');
  };

  const handleStartRename = () => {
    if (data.readOnly || !data.onRenameClass) return;
    setRenameValue(data.name);
    setIsRenaming(true);
  };

  const handleConfirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== data.name && data.onRenameClass) {
      data.onRenameClass(data.id, trimmed);
    }
    setIsRenaming(false);
  };

  const handleStartEdit = (attrId: string, currentName: string) => {
    setEditingAttrId(attrId);
    setEditNameValue(currentName);
  };

  const handleConfirmEdit = (attrId: string) => {
    if (data.onUpdateAttribute && typeof data.onUpdateAttribute === 'function') {
      data.onUpdateAttribute(data.id, attrId, editNameValue);
    }
    setEditingAttrId(null);
  };

  return (
    <div
      role="figure"
      aria-label={`Clase UML ${data.name}`}
      data-testid={`uml-class-node-${data.name}`}
      style={{
        background: '#ffffff',
        border: '2px solid #1e293b',
        borderRadius: '6px',
        minWidth: '240px',
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
        {isRenaming ? (
          <input
            data-testid={`rename-class-input-${data.id}`}
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleConfirmRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmRename();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            style={{ fontSize: '14px', fontWeight: 700, textAlign: 'center', width: '90%', padding: '1px 4px' }}
          />
        ) : (
          <div
            data-testid={`class-name-${data.name}`}
            onDoubleClick={handleStartRename}
            title={data.readOnly ? undefined : 'Doble clic para renombrar'}
            style={{
              fontWeight: 700,
              fontSize: '14px',
              fontStyle: data.isAbstract ? 'italic' : 'normal',
              cursor: data.readOnly || !data.onRenameClass ? 'default' : 'text',
            }}
          >
            {data.name}
          </div>
        )}
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
          data.attributes.map((attr) => {
            const isEditing = editingAttrId === attr.id;
            return (
              <div
                key={attr.id}
                data-testid={`attribute-row-${data.name}-${attr.name}`}
                style={{
                  padding: '3px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                }}
              >
                {isEditing ? (
                  <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                    <input
                      data-testid={`edit-attribute-input-${attr.id}`}
                      type="text"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      style={{ fontSize: '11px', padding: '2px 4px', width: '100px' }}
                    />
                    <button
                      data-testid={`confirm-edit-attribute-${attr.id}`}
                      onClick={() => handleConfirmEdit(attr.id)}
                      style={{ fontSize: '10px', padding: '2px 4px', cursor: 'pointer' }}
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditingAttrId(null)}
                      style={{ fontSize: '10px', padding: '2px 4px', cursor: 'pointer' }}
                    >
                      X
                    </button>
                  </div>
                ) : (
                  <>
                    <span style={{ fontWeight: 500 }}>
                      + {attr.name}:{' '}
                      <span style={{ color: '#0284c7', fontWeight: 600 }}>{attr.type}</span>
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ color: '#64748b', fontSize: '11px' }}>
                        [{attr.multiplicity}]
                      </span>
                      {!data.readOnly && data.onUpdateAttribute && (
                        <button
                          data-testid={`btn-edit-attr-${data.name}-${attr.name}`}
                          onClick={() => handleStartEdit(attr.id, attr.name)}
                          title="Renombrar/editar atributo"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '11px',
                            color: '#475569',
                            padding: '1px 3px',
                          }}
                        >
                          &#9998;
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '12px' }}>
            (sin atributos)
          </div>
        )}
      </div>

      {/* Handles de conexión en los cuatro lados (interacción estilo Apollon) */}
      {!data.readOnly && (
        <>
          <Handle type="source" position={Position.Top} id="top" style={handleStyle} />
          <Handle type="source" position={Position.Right} id="right" style={handleStyle} />
          <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />
          <Handle type="source" position={Position.Left} id="left" style={handleStyle} />
          <Handle type="target" position={Position.Top} id="top-t" style={{ ...handleStyle, background: '#94a3b8' }} />
          <Handle type="target" position={Position.Right} id="right-t" style={{ ...handleStyle, background: '#94a3b8' }} />
          <Handle type="target" position={Position.Bottom} id="bottom-t" style={{ ...handleStyle, background: '#94a3b8' }} />
          <Handle type="target" position={Position.Left} id="left-t" style={{ ...handleStyle, background: '#94a3b8' }} />
        </>
      )}

      {/* Pie para agregar atributo mediante comando */}
      <div
        style={{
          borderTop: '1px solid #f1f5f9',
          padding: '4px 8px',
          background: '#f8fafc',
          textAlign: 'right',
        }}
      >
        {isAdding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
            <input
              data-testid={`add-attribute-name-input-${data.name}`}
              placeholder="nombreAtributo"
              value={newAttrName}
              onChange={(e) => setNewAttrName(e.target.value)}
              style={{ fontSize: '11px', padding: '2px 4px' }}
            />
            <div style={{ display: 'flex', gap: '4px' }}>
              <select
                data-testid={`add-attribute-type-select-${data.name}`}
                value={newAttrType}
                onChange={(e) => setNewAttrType(e.target.value)}
                style={{ fontSize: '11px', padding: '2px' }}
              >
                <option value="String">String</option>
                <option value="Integer">Integer</option>
                <option value="Long">Long</option>
                <option value="Double">Double</option>
                <option value="Boolean">Boolean</option>
                <option value="Date">Date</option>
                <option value="DateTime">DateTime</option>
                <option value="UUID">UUID</option>
              </select>
              <button
                data-testid={`confirm-add-attribute-${data.name}`}
                onClick={handleConfirmAdd}
                style={{ fontSize: '11px', padding: '2px 6px', cursor: 'pointer' }}
              >
                Crear
              </button>
              <button
                onClick={() => setIsAdding(false)}
                style={{ fontSize: '11px', padding: '2px 4px', cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : data.readOnly || !data.onAddAttribute ? (
          <span data-testid={`readonly-footer-${data.name}`} style={{ color: '#cbd5e1', fontSize: '10px' }}>
            solo lectura
          </span>
        ) : (
          <button
            data-testid={`btn-add-attribute-${data.name}`}
            onClick={handleStartAdd}
            style={{
              background: '#e2e8f0',
              border: 'none',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              color: '#334155',
            }}
          >
            + Atributo
          </button>
        )}
      </div>
    </div>
  );
};
