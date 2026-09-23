import React, { useState, useEffect, useCallback, useRef } from 'react';
import { parseDomainModel } from '../adapter/domainModelAdapter';
import { CaseWebCanvas } from './CaseWebCanvas';
import type { CanonicalDomainModel } from '../domain/model';
import {
  executeAddAttribute,
  executeUpdateAttribute,
  executeDeleteAttribute,
  type CommandExecutionResult,
  type AddAttributeCommand,
  type UpdateAttributeCommand,
  type DeleteAttributeCommand,
} from '../commands/attributeCommands';
import {
  executeCreateAssociation,
  executeUpdateAssociation,
  executeDeleteAssociation,
  type CreateAssociationCommand,
  type UpdateAssociationCommand,
  type DeleteAssociationCommand,
  type CreateAssociationInput,
  type CreateAssociationClassInput,
  type UpdateAssociationInput,
} from '../commands/associationCommands';
import {
  executeCreateClass,
  executeRenameClass,
  executeUpdateClass,
  executeDeleteClass,
  type CreateClassCommand,
  type RenameClassCommand,
  type UpdateClassCommand,
  type UpdateClassInput,
  type DeleteClassCommand,
  type CreateClassInput,
} from '../commands/classCommands';

// Fixture por defecto canónico incrustado para ejecución local/standalone
export const DEFAULT_CANONICAL_FIXTURE = {
  contractVersion: '1',
  id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  name: 'Biblioteca',
  version: '1.0.0',
  classes: [
    {
      id: 'cls-01',
      name: 'Libro',
      attributes: [
        {
          id: 'attr-01',
          name: 'titulo',
          type: 'String',
          nullable: false,
          multiplicity: '1',
        },
        {
          id: 'attr-02',
          name: 'isbn',
          type: 'String',
          nullable: false,
          multiplicity: '1',
        },
        {
          id: 'attr-03',
          name: 'fechaPublicacion',
          type: 'Date',
          nullable: true,
          multiplicity: '0..1',
        },
      ],
    },
    {
      id: 'cls-02',
      name: 'Autor',
      attributes: [
        {
          id: 'attr-04',
          name: 'nombre',
          type: 'String',
          nullable: false,
          multiplicity: '1',
        },
      ],
    },
  ],
  associations: [
    {
      id: 'assoc-01',
      name: 'escritoPor',
      sourceClassId: 'cls-01',
      targetClassId: 'cls-02',
      sourceMultiplicity: '0..*',
      targetMultiplicity: '1..*',
      navigability: 'bidirectional',
    },
  ],
};

interface StandaloneEditorProps {
  initialModelData?: unknown;
}

/** Editor local sin conexión: ejecuta comandos contra el estado en memoria. */
export const StandaloneEditor: React.FC<StandaloneEditorProps> = ({
  initialModelData = DEFAULT_CANONICAL_FIXTURE,
}) => {
  const [model, setModelState] = useState<CanonicalDomainModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCommandResult, setLastCommandResult] = useState<CommandExecutionResult | null>(null);
  // Ref sincronizado con el estado: garantiza que los callbacks siempre lean
  // la versión más reciente sin depender del ciclo de re-render de React.
  const modelRef = useRef<CanonicalDomainModel | null>(null);

  const setModel = useCallback((next: CanonicalDomainModel | null) => {
    modelRef.current = next;
    setModelState(next);
  }, []);

  useEffect(() => {
    try {
      const parsed = parseDomainModel(initialModelData);
      setModel(parsed);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido de contrato');
      setModel(null);
    }
  }, [initialModelData]);

  const handleAddAttribute = useCallback(
    (classId: string, name: string, type: string, multiplicity: string, nullable = multiplicity === '0..1', description?: string) => {
      const m = modelRef.current;
      if (!m) return;
      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: `cmd-add-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: {
          attributeId: `attr-${crypto.randomUUID()}`,
          classId,
          name,
          type,
          nullable,
          multiplicity,
          description,
        },
      };
      const { updatedModel, result } = executeAddAttribute(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleUpdateAttribute = useCallback(
    (classId: string, attributeId: string, updates: { name: string; type: string; multiplicity: string; nullable: boolean; description?: string }) => {
      const m = modelRef.current;
      if (!m) return;
      const command: UpdateAttributeCommand = {
        type: 'UpdateAttribute',
        commandId: `cmd-upd-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: { attributeId, classId, ...updates },
      };
      const { updatedModel, result } = executeUpdateAttribute(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleDeleteAttribute = useCallback(
    (classId: string, attributeId: string) => {
      const m = modelRef.current;
      if (!m) return;
      const command: DeleteAttributeCommand = {
        type: 'DeleteAttribute',
        commandId: `cmd-delattr-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: { classId, attributeId },
      };
      const { updatedModel, result } = executeDeleteAttribute(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleCreateClass = useCallback(
    (input: CreateClassInput) => {
      const m = modelRef.current;
      if (!m) return;
      const command: CreateClassCommand = {
        type: 'CreateClass',
        commandId: `cmd-class-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: { classId: input.classId, name: input.name },
      };
      const { updatedModel, result } = executeCreateClass(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleCreateAssociation = useCallback(
    (input: CreateAssociationInput) => {
      const m = modelRef.current;
      if (!m) return;
      const command: CreateAssociationCommand = {
        type: 'CreateAssociation',
        commandId: `cmd-assoc-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: {
          id: `assoc-${crypto.randomUUID()}`,
          name: input.name,
          sourceClassId: input.sourceClassId,
          targetClassId: input.targetClassId,
          sourceMultiplicity: input.sourceMultiplicity,
          targetMultiplicity: input.targetMultiplicity,
          navigability: input.navigability,
          kind: input.kind,
          associationClassId: input.associationClassId,
          description: input.description,
        },
      };
      const { updatedModel, result } = executeCreateAssociation(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  /**
   * Crea la clase portadora y la asociación de tipo associationClass de forma
   * atómica: ambos comandos se ejecutan contra el mismo snapshot del modelo.
   */
  const handleCreateAssociationClass = useCallback(
    (input: CreateAssociationClassInput) => {
      const m = modelRef.current;
      if (!m) return;
      // Paso 1: crear la clase portadora
      const classCmd: CreateClassCommand = {
        type: 'CreateClass',
        commandId: `cmd-class-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: { classId: input.newClassId, name: input.newClassName },
      };
      const { updatedModel: modelWithClass, result: classResult } = executeCreateClass(m, classCmd);
      setLastCommandResult(classResult);
      if (classResult.result !== 'accepted') return;
      // Paso 2: la asociación usa el modelo ya actualizado (versión correcta)
      const assocCmd: CreateAssociationCommand = {
        type: 'CreateAssociation',
        commandId: `cmd-assoc-${Date.now()}`,
        modelId: modelWithClass.id,
        modelVersion: modelWithClass.version,
        payload: {
          id: `assoc-${crypto.randomUUID()}`,
          name: input.associationName,
          sourceClassId: input.sourceClassId,
          targetClassId: input.targetClassId,
          sourceMultiplicity: input.sourceMultiplicity,
          targetMultiplicity: input.targetMultiplicity,
          navigability: input.navigability,
          kind: 'associationClass',
          associationClassId: input.newClassId,
          description: input.description,
        },
      };
      const { updatedModel: finalModel, result: assocResult } = executeCreateAssociation(modelWithClass, assocCmd);
      setLastCommandResult(assocResult);
      if (assocResult.result === 'accepted') setModel(finalModel);
    },
    [setModel]
  );

  const handleRenameClass = useCallback(
    (classId: string, newName: string) => {
      const m = modelRef.current;
      if (!m) return;
      const command: RenameClassCommand = {
        type: 'RenameClass',
        commandId: `cmd-ren-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: { classId, newName },
      };
      const { updatedModel, result } = executeRenameClass(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleUpdateClass = useCallback(
    (input: UpdateClassInput) => {
      const m = modelRef.current;
      if (!m) return;
      const command: UpdateClassCommand = {
        type: 'UpdateClass',
        commandId: `cmd-updclass-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: input,
      };
      const { updatedModel, result } = executeUpdateClass(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleDeleteClass = useCallback(
    (classId: string) => {
      const m = modelRef.current;
      if (!m) return;
      const command: DeleteClassCommand = {
        type: 'DeleteClass',
        commandId: `cmd-del-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: { classId },
      };
      const { updatedModel, result } = executeDeleteClass(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleUpdateAssociation = useCallback(
    (input: UpdateAssociationInput) => {
      const m = modelRef.current;
      if (!m) return;
      const command: UpdateAssociationCommand = {
        type: 'UpdateAssociation',
        commandId: `cmd-updassoc-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: input,
      };
      const { updatedModel, result } = executeUpdateAssociation(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  const handleDeleteAssociation = useCallback(
    (associationId: string) => {
      const m = modelRef.current;
      if (!m) return;
      const command: DeleteAssociationCommand = {
        type: 'DeleteAssociation',
        commandId: `cmd-delassoc-${Date.now()}`,
        modelId: m.id,
        modelVersion: m.version,
        payload: { associationId },
      };
      const { updatedModel, result } = executeDeleteAssociation(m, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [setModel]
  );

  /**
   * Aplica los comandos del asistente (shape del protocolo model-commands-v1)
   * mapeándolos a los ejecutores locales. Secuencial: cada handler lee
   * `modelRef`, que ya refleja el comando anterior.
   */
  const applyAssistantCommands = useCallback(
    (commands: { type: string; payload: Record<string, unknown> }[]) => {
      for (const cmd of commands) {
        const p = cmd.payload;
        switch (cmd.type) {
          case 'CreateClass':
            handleCreateClass({ classId: String(p.id), name: String(p.name) });
            break;
          case 'RenameClass':
            handleRenameClass(String(p.classId), String(p.newName));
            break;
          case 'UpdateClass':
            handleUpdateClass({
              classId: String(p.classId),
              name: p.name as string | undefined,
              description: p.description as string | undefined,
            });
            break;
          case 'DeleteClass':
            handleDeleteClass(String(p.classId));
            break;
          case 'AddAttribute':
            handleAddAttribute(
              String(p.classId),
              String(p.name),
              String(p.type),
              String(p.multiplicity ?? '1'),
              Boolean(p.nullable),
              p.description as string | undefined
            );
            break;
          case 'UpdateAttribute': {
            const m = modelRef.current;
            const cls = m?.classes.find((c) => c.id === p.classId);
            const attr = cls?.attributes.find((a) => a.id === p.attributeId);
            if (!cls || !attr) break;
            handleUpdateAttribute(cls.id, attr.id, {
              name: (p.name as string | undefined) ?? attr.name,
              type: (p.type as string | undefined) ?? attr.type,
              multiplicity: (p.multiplicity as string | undefined) ?? attr.multiplicity,
              nullable: (p.nullable as boolean | undefined) ?? attr.nullable,
              description: (p.description as string | undefined) ?? attr.description,
            });
            break;
          }
          case 'DeleteAttribute':
            handleDeleteAttribute(String(p.classId), String(p.attributeId));
            break;
          case 'CreateAssociation':
            handleCreateAssociation({
              name: p.name as string | undefined,
              sourceClassId: String(p.sourceClassId),
              targetClassId: String(p.targetClassId),
              sourceMultiplicity: p.sourceMultiplicity as string | undefined,
              targetMultiplicity: p.targetMultiplicity as string | undefined,
              navigability: p.navigability as string | undefined,
              kind: p.kind as CreateAssociationInput['kind'],
              associationClassId: p.associationClassId as string | undefined,
              description: p.description as string | undefined,
            });
            break;
          case 'UpdateAssociation':
            handleUpdateAssociation(p as unknown as UpdateAssociationInput);
            break;
          case 'DeleteAssociation':
            handleDeleteAssociation(String(p.associationId));
            break;
          default:
            break;
        }
      }
    },
    [
      handleCreateClass,
      handleRenameClass,
      handleUpdateClass,
      handleDeleteClass,
      handleAddAttribute,
      handleUpdateAttribute,
      handleDeleteAttribute,
      handleCreateAssociation,
      handleUpdateAssociation,
      handleDeleteAssociation,
    ]
  );

  if (error) {
    return (
      <div
        role="alert"
        data-testid="error-container"
        style={{
          padding: '24px',
          background: '#fef2f2',
          border: '1px solid #f87171',
          borderRadius: '8px',
          margin: '20px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h2 style={{ color: '#991b1b', margin: '0 0 8px 0', fontSize: '18px' }}>
          Error al cargar el modelo de dominio
        </h2>
        <p data-testid="error-message" style={{ color: '#b91c1c', margin: 0, fontSize: '14px' }}>
          {error}
        </p>
      </div>
    );
  }

  if (!model) {
    return (
      <div data-testid="loading-state" style={{ padding: '24px', fontFamily: 'sans-serif' }}>
        Cargando modelo canónico...
      </div>
    );
  }

  return (
    <CaseWebCanvas
      model={model}
      lastCommandResult={lastCommandResult}
      onAddAttribute={handleAddAttribute}
      onUpdateAttribute={handleUpdateAttribute}
      onDeleteAttribute={handleDeleteAttribute}
      onUpdateClass={handleUpdateClass}
      onCreateAssociation={handleCreateAssociation}
      onCreateAssociationClass={handleCreateAssociationClass}
      onCreateClass={handleCreateClass}
      onRenameClass={handleRenameClass}
      onDeleteClass={handleDeleteClass}
      onUpdateAssociation={handleUpdateAssociation}
      onDeleteAssociation={handleDeleteAssociation}
      onApplyAssistantCommands={applyAssistantCommands}
    />
  );
};

export default StandaloneEditor;
