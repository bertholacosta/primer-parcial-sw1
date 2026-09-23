import React from 'react';
import { ConnectedApp, type ConnectedAppDeps } from './components/ConnectedApp';
import { StandaloneEditor } from './components/StandaloneEditor';
import { ThemeToggle } from './components/ThemeToggle';

export { DEFAULT_CANONICAL_FIXTURE } from './components/StandaloneEditor';

interface AppProps {
  /** Si se provee, el editor funciona en modo local/sin conexión (fixture o datos inyectados). */
  initialModelData?: unknown;
}

export const App: React.FC<AppProps & ConnectedAppDeps> = ({ initialModelData, ...deps }) => (
  <div className="app-shell">
    <ThemeToggle />
    {initialModelData !== undefined ? (
      <StandaloneEditor initialModelData={initialModelData} />
    ) : (
      <ConnectedApp {...deps} />
    )}
  </div>
);

export default App;
