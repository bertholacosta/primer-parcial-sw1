import React, { useState, useEffect } from 'react';
import { parseDomainModel } from './adapter/domainModelAdapter';
import { CaseWebCanvas } from './components/CaseWebCanvas';
import type { CanonicalDomainModel } from './domain/model';

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

interface AppProps {
  initialModelData?: unknown;
}

export const App: React.FC<AppProps> = ({ initialModelData = DEFAULT_CANONICAL_FIXTURE }) => {
  const [model, setModel] = useState<CanonicalDomainModel | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return <CaseWebCanvas model={model} />;
};

export default App;
