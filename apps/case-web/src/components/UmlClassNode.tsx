import React, { useState } from 'react';
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import type { CanonicalAttribute } from '../domain/model';
import type { UmlClassFlowNode } from '../adapter/domainModelAdapter';
import { ALLOWED_MULTIPLICITIES } from '../commands/attributeCommands';

const ATTRIBUTE_TYPES = ['String', 'Integer', 'Long', 'Double', 'Boolean', 'Date', 'DateTime', 'UUID'];

const handleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  background: '#0284c7',
  border: '1px solid #ffffff',
};

/** Convención de prefijos de metadatos en el campo description (domain-model-v1). */
const PK_PREFIX = '[PK]';
const FK_PREFIX = '[FK]';

/** Extrae los flags PK/FK y la descripción limpia del campo description. */
function parseAttrMeta(description?: string): { isPk: boolean; isFk: boolean; desc: string } {
  const s = description ?? '';
  const isPk = s.includes(PK_PREFIX);
  const isFk = s.includes(FK_PREFIX);
  const desc = s.replace(PK_PREFIX, '').replace(FK_PREFIX, '').trim();
  return { isPk, isFk, desc };
}

/** Reconstruye el campo description incluyendo los prefijos activos. */
function buildAttrDescription(isPk: boolean, isFk: boolean, desc: string): string {
  const prefixes = [isPk ? PK_PREFIX : '', isFk ? FK_PREFIX : ''].filter(Boolean).join('');
  return prefixes ? `${prefixes} ${desc}`.trim() : desc;
}

export const UmlClassNode: React.FC<NodeProps<UmlClassFlowNode>> = ({ data, selected }) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [isEditingClass, setIsEditingClass] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [className, setClassName] = useState('');
  const [classPackageId, setClassPackageId] = useState('');
  const [classDescription, setClassDescription] = useState('');

  const [editingAttrId, setEditingAttrId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('String');
  const [editMultiplicity, setEditMultiplicity] = useState('1');
  const [editIsPk, setEditIsPk] = useState(false);
  const [editIsFk, setEditIsFk] = useState(false);
  const [editDescription, setEditDescription] = useState('');

  const [isAddingAttr, setIsAddingAttr] = useState(false);
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrType, setNewAttrType] = useState('String');
  const [newAttrMultiplicity, setNewAttrMultiplicity] = useState('1');
  const [newAttrIsPk, setNewAttrIsPk] = useState(false);
  const [newAttrIsFk, setNewAttrIsFk] = useState(false);
  const [newAttrDescription, setNewAttrDescription] = useState('');

  const handleStartRename = () => {
    if (data.readOnly || !data.onRenameClass) return;
    setRenameValue(data.name);
    setIsRenaming(true);
  };

  const handleConfirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== data.name) data.onRenameClass?.(data.id, trimmed);
    setIsRenaming(false);
  };

  const handleStartClassEdit = () => {
    setClassName(data.name);
    setClassPackageId(data.packageId ?? '');
    setClassDescription(data.description ?? '');
    setIsEditingClass(true);
  };

  const handleConfirmClassEdit = () => {
    data.onUpdateClass?.({
      classId: data.id,
      name: className.trim(),
      packageId: classPackageId || null,
      description: classDescription,
    });
    setIsEditingClass(false);
  };

  const handleStartEdit = (attribute: CanonicalAttribute) => {
    setEditingAttrId(attribute.id);
    setEditName(attribute.name);
    setEditType(attribute.type);
    setEditMultiplicity(attribute.multiplicity);
    const meta = parseAttrMeta(attribute.description);
    setEditIsPk(meta.isPk);
    setEditIsFk(meta.isFk);
    setEditDescription(meta.desc);
  };

  const handleConfirmEdit = (attributeId: string) => {
    data.onUpdateAttribute?.(data.id, attributeId, {
      name: editName.trim(),
      type: editType,
      multiplicity: editMultiplicity,
      nullable: editMultiplicity.startsWith('0'),
      description: buildAttrDescription(editIsPk, editIsFk, editDescription),
    });
    setEditingAttrId(null);
  };

  const handleAddAttr = () => {
    const name = newAttrName.trim();
    if (!name) return;
    data.onAddAttribute?.(
      data.id,
      name,
      newAttrType,
      newAttrMultiplicity,
      newAttrMultiplicity.startsWith('0'),
      buildAttrDescription(newAttrIsPk, newAttrIsFk, newAttrDescription)
    );
    setNewAttrName('');
    setNewAttrType('String');
    setNewAttrMultiplicity('1');
    setNewAttrIsPk(false);
    setNewAttrIsFk(false);
    setNewAttrDescription('');
    setIsAddingAttr(false);
  };

  return (
    <>
      <NodeToolbar isVisible={selected && !data.readOnly} position={Position.Top} align="end" offset={10}>
        <div className="context-toolbar nodrag nopan" role="toolbar" aria-label={`Acciones de ${data.name}`}>
          <button type="button" className="context-toolbar-button" data-testid={`toolbar-delete-class-${data.id}`} aria-label={`Eliminar clase ${data.name}`} title="Eliminar clase" onClick={() => data.onDeleteClass?.(data.id)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg>
          </button>
          <button type="button" className="context-toolbar-button" data-testid={`toolbar-edit-class-${data.id}`} aria-label={`Editar clase ${data.name}`} title="Editar clase" onClick={handleStartClassEdit}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3" /></svg>
          </button>
        </div>
      </NodeToolbar>

      <div role="figure" aria-label={`Clase UML ${data.name}`} data-testid={`uml-class-node-${data.name}`} className="uml-class-node">
        {/* Cabecera */}
        <div className="uml-class-header">
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
              className="form-control"
              style={{ minHeight: 28, textAlign: 'center' }}
            />
          ) : (
            <div
              data-testid={`class-name-${data.name}`}
              onDoubleClick={handleStartRename}
              title={data.readOnly ? undefined : 'Doble clic para renombrar'}
              className="uml-class-name"
              style={{ cursor: data.readOnly || !data.onRenameClass ? 'default' : 'text' }}
            >
              {data.name}
            </div>
          )}
        </div>

        {/* Editor de clase */}
        {isEditingClass && (
          <div className="uml-property-editor nodrag nowheel">
            <label>Nombre<input data-testid={`edit-class-name-${data.id}`} value={className} onChange={(e) => setClassName(e.target.value)} /></label>
            <label>Paquete
              <select data-testid={`edit-class-package-${data.id}`} value={classPackageId} onChange={(e) => setClassPackageId(e.target.value)}>
                <option value="">Espacio raíz</option>
                {data.packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Descripción<textarea data-testid={`edit-class-description-${data.id}`} value={classDescription} onChange={(e) => setClassDescription(e.target.value)} /></label>
            <div className="uml-form-actions">
              <button data-testid={`confirm-edit-class-${data.id}`} onClick={handleConfirmClassEdit} className="uml-node-button">Guardar clase</button>
              <button onClick={() => setIsEditingClass(false)} className="uml-node-button">Cancelar</button>
            </div>
          </div>
        )}

        {/* Compartimento de Atributos */}
        <div className="uml-attributes" data-testid={`attributes-compartment-${data.name}`}>
          {data.attributes.length > 0 ? data.attributes.map((attr) => {
            const meta = parseAttrMeta(attr.description);
            return (
              <div key={attr.id} data-testid={`attribute-row-${data.name}-${attr.name}`} className="uml-attribute-row">
                {editingAttrId === attr.id ? (
                  <div className="uml-property-editor uml-attribute-editor nodrag nowheel">
                    <label>Nombre<input data-testid={`edit-attribute-input-${attr.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
                    <div className="uml-form-grid">
                      <label>Tipo
                        <select data-testid={`edit-attribute-type-${attr.id}`} value={editType} onChange={(e) => setEditType(e.target.value)}>
                          {ATTRIBUTE_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </label>
                      <label>Multiplicidad
                        <select data-testid={`edit-attribute-multiplicity-${attr.id}`} value={editMultiplicity} onChange={(e) => setEditMultiplicity(e.target.value)}>
                          {ALLOWED_MULTIPLICITIES.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="uml-add-attr-checks">
                      <label className="uml-checkbox uml-pk-marker">
                        <input type="checkbox" data-testid={`edit-attribute-ispk-${attr.id}`} checked={editIsPk} onChange={(e) => setEditIsPk(e.target.checked)} />
                        <span title="Llave primaria (PK)">🗝️ PK</span>
                      </label>
                      <label className="uml-checkbox uml-fk-marker">
                        <input type="checkbox" data-testid={`edit-attribute-isfk-${attr.id}`} checked={editIsFk} onChange={(e) => setEditIsFk(e.target.checked)} />
                        <span title="Llave foránea (FK)">🔑 FK</span>
                      </label>
                    </div>
                    <label>Descripción<textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></label>
                    <div className="uml-form-actions">
                      <button data-testid={`confirm-edit-attribute-${attr.id}`} onClick={() => handleConfirmEdit(attr.id)} className="uml-node-button">Guardar</button>
                      <button data-testid={`delete-attribute-${attr.id}`} onClick={() => data.onDeleteAttribute?.(data.id, attr.id)} className="uml-node-button danger">Eliminar</button>
                      <button onClick={() => setEditingAttrId(null)} className="uml-node-button">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span>
                      {meta.isPk && <span className="uml-pk-icon" title="Llave primaria (PK)">🗝️ </span>}
                      {meta.isFk && <span className="uml-fk-icon" title="Llave foránea (FK)">🔑 </span>}
                      + {attr.name}: <span className="uml-attribute-type">{attr.type}</span>
                    </span>
                    <div className="uml-inline-form">
                    <span className="uml-muted">{attr.nullable ? 'nullable' : 'not null'}</span>
                      {!data.readOnly && data.onUpdateAttribute && (
                        <button data-testid={`btn-edit-attr-${data.name}-${attr.name}`} onClick={() => handleStartEdit(attr)} title="Editar atributo" className="uml-edit-button">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3" /></svg>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          }) : <div className="uml-muted">(sin atributos)</div>}

          {/* Formulario inline para añadir atributo */}
          {!data.readOnly && data.onAddAttribute && (
            isAddingAttr ? (
              <div className="uml-add-attr-form nodrag nowheel" data-testid={`add-attr-form-${data.id}`}>
                <input
                  data-testid={`new-attr-name-${data.id}`}
                  placeholder="nombreAtributo"
                  value={newAttrName}
                  autoFocus
                  onChange={(e) => setNewAttrName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddAttr(); if (e.key === 'Escape') setIsAddingAttr(false); }}
                  className="uml-add-attr-input"
                />
                <div className="uml-form-grid">
                  <select data-testid={`new-attr-type-${data.id}`} value={newAttrType} onChange={(e) => setNewAttrType(e.target.value)}>
                    {ATTRIBUTE_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <select data-testid={`new-attr-multiplicity-${data.id}`} value={newAttrMultiplicity} onChange={(e) => setNewAttrMultiplicity(e.target.value)} aria-label="Multiplicidad">
                    {ALLOWED_MULTIPLICITIES.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="uml-add-attr-checks">
                  <label className="uml-checkbox uml-pk-marker">
                    <input type="checkbox" data-testid={`new-attr-ispk-${data.id}`} checked={newAttrIsPk} onChange={(e) => setNewAttrIsPk(e.target.checked)} />
                    <span title="Llave primaria">🗝️ PK</span>
                  </label>
                  <label className="uml-checkbox uml-fk-marker">
                    <input type="checkbox" data-testid={`new-attr-isfk-${data.id}`} checked={newAttrIsFk} onChange={(e) => setNewAttrIsFk(e.target.checked)} />
                    <span title="Llave foránea">🔑 FK</span>
                  </label>
                </div>
                <input
                  placeholder="Descripción (opcional)"
                  value={newAttrDescription}
                  onChange={(e) => setNewAttrDescription(e.target.value)}
                  className="uml-add-attr-input"
                />
                <div className="uml-form-actions">
                  <button data-testid={`confirm-add-attr-${data.id}`} onClick={handleAddAttr} disabled={!newAttrName.trim()} className="uml-node-button">Añadir</button>
                  <button onClick={() => setIsAddingAttr(false)} className="uml-node-button">Cancelar</button>
                </div>
              </div>
            ) : (
              <button
                data-testid={`btn-add-attr-${data.id}`}
                onClick={() => setIsAddingAttr(true)}
                className="uml-add-attr-btn"
                title="Añadir atributo"
              >
                + Atributo
              </button>
            )
          )}
        </div>

        {/* Handles de conexión en los cuatro lados */}
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
      </div>
    </>
  );
};
