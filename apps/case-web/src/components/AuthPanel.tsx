import React, { useState } from 'react';
import { ApiError, type AuthSession, type ModelServerApi } from '../api/modelServerApi';

interface AuthPanelProps {
  api: ModelServerApi;
  onAuthenticated(session: AuthSession): void;
}

/** Registro e inicio de sesión con correo y contraseña (identity-access-v1). */
export const AuthPanel: React.FC<AuthPanelProps> = ({ api, onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await api.register(email, password, displayName || email);
      onAuthenticated(await api.login(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No fue posible autenticar la sesión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout" data-testid="auth-panel">
      <section className="auth-hero" aria-label="Presentación de CASE Studio">
        <div className="auth-hero-mark" aria-hidden="true">CS</div>
        <h1>CASE Studio</h1>
        <p>Diseña modelos UML consistentes, colabora en tiempo real y transforma tus diagramas en software verificable.</p>
      </section>
      <section className="auth-panel-wrap">
        <div className="auth-card">
          <h2>{mode === 'login' ? 'Bienvenido' : 'Crear cuenta'}</h2>
          <p>{mode === 'login' ? 'Accede a tus modelos y sesiones colaborativas.' : 'Configura tu espacio de modelado.'}</p>
          {error && <div role="alert" data-testid="auth-error" className="alert error">{error}</div>}
          <form onSubmit={submit}>
            {mode === 'register' && (
              <label className="form-label">
                Nombre visible
                <input data-testid="register-display-name-input" className="form-control" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
              </label>
            )}
            <label className="form-label">
              Correo electrónico
              <input data-testid="login-email-input" className="form-control" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label className="form-label">
              Contraseña
              <input data-testid="login-password-input" className="form-control" type="password" required minLength={mode === 'register' ? 12 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </label>
            <button data-testid="login-submit" className="button-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Procesando…' : mode === 'login' ? 'Entrar al espacio' : 'Crear cuenta y entrar'}
            </button>
          </form>
          <button data-testid="auth-mode-toggle" className="button-ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }} style={{ width: '100%', marginTop: 10 }}>
            {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>
      </section>
    </main>
  );
};

export default AuthPanel;
