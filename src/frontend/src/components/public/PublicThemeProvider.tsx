'use client';

import '@/styles/public-surface.css';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Theme = 'dark' | 'light';

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: 'dark',
  toggleTheme: () => {},
});

export function usePublicTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = 'landing-theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

/**
 * PublicThemeProvider — wraps a public/civilian surface page in the prototype's
 * shared design system (.public-surface token scope) and provides the persisted
 * day/night toggle. Renders the shared header (with theme toggle) and footer so
 * every public page gets consistent chrome without re-implementing it.
 */
export function PublicThemeProvider({
  children,
  showThemeToggle = true,
  showHeader = true,
}: {
  children: React.ReactNode;
  showThemeToggle?: boolean;
  showHeader?: boolean;
}) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const ctx = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={ctx}>
      <div className="public-surface" data-theme={theme} suppressHydrationWarning>
        {showHeader && (
          <header className="ps-header">
          <div className="ps-header-left">
            <Link href="/" className="ps-header-logo-link" aria-label="WIMS-BFP home">
              <span className="ps-header-title">WIMS-BFP</span>
            </Link>
          </div>
          <div className="ps-header-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {showThemeToggle && (
              <button
                type="button"
                onClick={toggleTheme}
                className="ps-theme-toggle"
                data-testid="theme-toggle"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
              </button>
            )}
          </div>
        </header>
        )}

        <main className="ps-content">{children}</main>

        <footer className="ps-footer">
          <p>
            <strong>WIMS-BFP</strong> · Bureau of Fire Protection · Republic of the Philippines
          </p>
          <p>
            <Link href="/privacy">Privacy Policy</Link>
            {' · '}
            <Link href="/register">Register as a reporter</Link>
          </p>
        </footer>
      </div>
    </ThemeContext.Provider>
  );
}
