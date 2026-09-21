import React, { useState } from 'react';
import { ApiError, type AuthSession, type ModelServerApi } from '../api/modelServerApi';

interface AuthPanelProps {
  api: ModelServerApi;
  onAuthenticated(session: AuthSession): void;
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: '14px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  marginBottom: '12px',
};

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
      if (mode === 'register') {
        await api.register(email, password, displayName || email);
      }
      const session = await api.login(email, password);
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No fue posible autenticar la sesión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="auth-panel"
      style={{
        maxWidth: '380px',
        margin: '10vh auto',
        padding: '28px',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        fontFamily: 'system-ui, sans-serif',
        background: '#ffffff',
        boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
      }}
    >
      <h1 style={{ fontSize: '20px', margin: '0 0 4px 0', color: '#0f172a' }}>Editor CASE</h1>
      <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 18px 0' }}>
        {mode === 'login' ? 'Inicia sesión para colaborar en diagramas.' : 'Crea tu cuenta para empezar.'}
      </p>

      {error && (
        <div
          role="alert"
          data-testid="auth-error"
          style={{
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            borderRadius: '6px',
            padding: '8px 10px',
            fontSize: '13px',
            marginBottom: '12px',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        {mode === 'register' && (
          <label style={{ fontSize: '12px', color: '#334155' }}>
            Nombre visible
            <input
              data-testid="register-display-name-input"
              style={inputStyle}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </label>
        )}
        <label style={{ fontSize: '12px', color: '#334155' }}>
          Correo
          <input
            data-testid="login-email-input"
            type="email"
            required
            style={inputStyle}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label style={{ fontSize: '12px', color: '#334155' }}>
          Contraseña
          <input
            data-testid="login-password-input"
            type="password"
            required
            minLength={mode === 'register' ? 12 : undefined}
            style={inputStyle}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        <button
          data-testid="login-submit"
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            padding: '9px',
            fontSize: '14px',
            fontWeight: 600,
            color: '#ffffff',
            background: '#0f172a',
            border: 'none',
            borderRadius: '6px',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {mode === 'login' ? 'Entrar' : 'Registrarse y entrar'}
        </button>
      </form>

      <button
        data-testid="auth-mode-toggle"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
        style={{
          marginTop: '14px',
          background: 'none',
          border: 'none',
          color: '#0284c7',
          fontSize: '13px',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
      </button>
    </div>
  );
};

export default AuthPanel;
