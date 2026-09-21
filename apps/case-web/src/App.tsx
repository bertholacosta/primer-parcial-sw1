import React from 'react';
import { ConnectedApp, type ConnectedAppDeps } from './components/ConnectedApp';
import { StandaloneEditor } from './components/StandaloneEditor';

export { DEFAULT_CANONICAL_FIXTURE } from './components/StandaloneEditor';

interface AppProps {
  /** Si se provee, el editor funciona en modo local/sin conexión (fixture o datos inyectados). */
  initialModelData?: unknown;
}

export const App: React.FC<AppProps & ConnectedAppDeps> = ({ initialModelData, ...deps }) => {
  if (initialModelData !== undefined) {
    return <StandaloneEditor initialModelData={initialModelData} />;
  }
  return <ConnectedApp {...deps} />;
};

export default App;
