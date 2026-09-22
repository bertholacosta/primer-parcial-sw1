import React, { useState, useEffect, useCallback } from 'react';
import { parseDomainModel } from '../adapter/domainModelAdapter';
import { CaseWebCanvas } from './CaseWebCanvas';
import type { CanonicalDomainModel } from '../domain/model';
import {
  executeAddAttribute,
  executeUpdateAttribute,
  type CommandExecutionResult,
  type AddAttributeCommand,
  type UpdateAttributeCommand,
} from '../commands/attributeCommands';
import {
  executeCreateAssociation,
  executeDeleteAssociation,
  type CreateAssociationCommand,
  type DeleteAssociationCommand,
  type CreateAssociationInput,
} from '../commands/associationCommands';
import {
  executeCreateClass,
  executeRenameClass,
  executeDeleteClass,
  executeCreatePackage,
  executeDeletePackage,
  type CreateClassCommand,
  type RenameClassCommand,
  type DeleteClassCommand,
  type CreatePackageCommand,
  type DeletePackageCommand,
  type CreateClassInput,
} from '../commands/classCommands';
import type { CreatePackageInput } from './CaseWebCanvas';

// Fixture por defecto canónico incrustado para ejecución local/standalone
export const DEFAULT_CANONICAL_FIXTURE = {
  contractVersion: '1',
  id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  name: 'Biblioteca',
  version: '1.0.0',
  packages: [
    {
      id: 'pkg-01',
      name: 'biblioteca',
    },
  ],
  classes: [
    {
      id: 'cls-01',
      name: 'Libro',
      packageId: 'pkg-01',
      isAbstract: false,
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
      packageId: 'pkg-01',
      isAbstract: false,
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
  const [model, setModel] = useState<CanonicalDomainModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCommandResult, setLastCommandResult] = useState<CommandExecutionResult | null>(null);

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
    (classId: string, name: string, type: string, multiplicity: string) => {
      if (!model) return;
      const command: AddAttributeCommand = {
        type: 'AddAttribute',
        commandId: `cmd-add-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId: `attr-${Date.now()}`,
          classId,
          name,
          type,
          nullable: multiplicity === '0..1',
          multiplicity,
        },
      };

      const { updatedModel, result } = executeAddAttribute(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') {
        setModel(updatedModel);
      }
    },
    [model]
  );

  const handleUpdateAttribute = useCallback(
    (classId: string, attributeId: string, newName: string) => {
      if (!model) return;
      const command: UpdateAttributeCommand = {
        type: 'UpdateAttribute',
        commandId: `cmd-upd-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          attributeId,
          classId,
          name: newName,
        },
      };

      const { updatedModel, result } = executeUpdateAttribute(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') {
        setModel(updatedModel);
      }
    },
    [model]
  );

  const handleCreateClass = useCallback(
    (input: CreateClassInput) => {
      if (!model) return;
      const command: CreateClassCommand = {
        type: 'CreateClass',
        commandId: `cmd-class-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          classId: input.classId,
          name: input.name,
          packageId: input.packageId,
          isAbstract: input.isAbstract,
        },
      };

      const { updatedModel, result } = executeCreateClass(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') {
        setModel(updatedModel);
      }
    },
    [model]
  );

  const handleCreateAssociation = useCallback(
    (input: CreateAssociationInput) => {
      if (!model) return;
      const command: CreateAssociationCommand = {
        type: 'CreateAssociation',
        commandId: `cmd-assoc-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: {
          id: `assoc-${Date.now()}`,
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

      const { updatedModel, result } = executeCreateAssociation(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') {
        setModel(updatedModel);
      }
    },
    [model]
  );

  const handleRenameClass = useCallback(
    (classId: string, newName: string) => {
      if (!model) return;
      const command: RenameClassCommand = {
        type: 'RenameClass',
        commandId: `cmd-ren-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: { classId, newName },
      };
      const { updatedModel, result } = executeRenameClass(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [model]
  );

  const handleDeleteClass = useCallback(
    (classId: string) => {
      if (!model) return;
      const command: DeleteClassCommand = {
        type: 'DeleteClass',
        commandId: `cmd-del-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: { classId },
      };
      const { updatedModel, result } = executeDeleteClass(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [model]
  );

  const handleCreatePackage = useCallback(
    (input: CreatePackageInput) => {
      if (!model) return;
      const command: CreatePackageCommand = {
        type: 'CreatePackage',
        commandId: `cmd-pkg-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: { packageId: input.packageId, name: input.name },
      };
      const { updatedModel, result } = executeCreatePackage(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [model]
  );

  const handleDeletePackage = useCallback(
    (packageId: string) => {
      if (!model) return;
      const command: DeletePackageCommand = {
        type: 'DeletePackage',
        commandId: `cmd-delpkg-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: { packageId },
      };
      const { updatedModel, result } = executeDeletePackage(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [model]
  );

  const handleDeleteAssociation = useCallback(
    (associationId: string) => {
      if (!model) return;
      const command: DeleteAssociationCommand = {
        type: 'DeleteAssociation',
        commandId: `cmd-delassoc-${Date.now()}`,
        modelId: model.id,
        modelVersion: model.version,
        payload: { associationId },
      };
      const { updatedModel, result } = executeDeleteAssociation(model, command);
      setLastCommandResult(result);
      if (result.result === 'accepted') setModel(updatedModel);
    },
    [model]
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
      onCreateAssociation={handleCreateAssociation}
      onCreateClass={handleCreateClass}
      onRenameClass={handleRenameClass}
      onDeleteClass={handleDeleteClass}
      onCreatePackage={handleCreatePackage}
      onDeletePackage={handleDeletePackage}
      onDeleteAssociation={handleDeleteAssociation}
    />
  );
};

export default StandaloneEditor;
