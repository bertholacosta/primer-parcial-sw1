import React, { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const initialTheme = (): Theme => {
  const saved = globalThis.localStorage?.getItem('case-web-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    globalThis.localStorage?.setItem('case-web-theme', theme);
  }, [theme]);

  const nextTheme = theme === 'light' ? 'dark' : 'light';

  return (
    <button
      type="button"
      className="theme-toggle"
      data-testid="theme-toggle"
      aria-label={`Cambiar a tema ${nextTheme === 'dark' ? 'oscuro' : 'claro'}`}
      title={`Cambiar a tema ${nextTheme === 'dark' ? 'oscuro' : 'claro'}`}
      onClick={() => setTheme(nextTheme)}
    >
      <span aria-hidden="true">{theme === 'light' ? '◐' : '☀'}</span>
    </button>
  );
};
