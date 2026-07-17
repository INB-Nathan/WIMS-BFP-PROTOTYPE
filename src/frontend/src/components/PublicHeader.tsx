'use client';

import { useAuth } from '@/context/AuthContext';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePublicTheme } from '@/components/public/PublicThemeProvider';
import { defaultRouteForRole } from '@/lib/roleRedirect';

/**
 * PublicHeader — shared auth-aware header for the public/contributor surface.
 * Issue #654 (feat/654-public-header-theme-unify, Task T4).
 *
 * Renders the canonical `.landing-header` DOM and consumes the public theme via
 * usePublicTheme() (provided by LayoutShell for public routes). Styling comes
 * from the global public-header.css loaded via layout.tsx — no scoped styles here.
 *
 * The header consumes the validated session exposed by AuthContext (including
 * the established offline-session restore) instead of reading the HttpOnly JWT
 * in browser code. Anonymous navigation stays on the approved public surface;
 * authenticated users also receive their role-appropriate dashboard link.
 *
 * The "Report a Fire" CTA is authenticated-only and hidden on /report.
 */
export function PublicHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const { theme, toggleTheme } = usePublicTheme();

  if (loading) {
    return null;
  }

  const isAuthenticated = user !== null;
  const isReportPage = pathname === '/report';
  const dashboardHref = defaultRouteForRole(user?.role);

  const avatarInitial = user
    ? user.preferred_username?.[0]?.toUpperCase() ||
      user.email?.[0]?.toUpperCase() ||
      user.sub?.[0]?.toUpperCase() ||
      'U'
    : 'U';

  return (
    <header className="landing-header">
      <div className="landing-header-left">
        <div className="landing-header-logo">
          <Image
            src="/bfp-logo.svg"
            alt="Bureau of Fire Protection"
            width={34}
            height={34}
            className="landing-header-bfp-logo"
          />
        </div>
        <Link href="/" className="landing-header-title" aria-label="WIMS-BFP home">
          WIMS-BFP
        </Link>
      </div>

      <div className="landing-header-right">
        <button
          type="button"
          onClick={toggleTheme}
          className="btn-theme-toggle"
          data-testid="theme-toggle"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
        </button>

        <nav className="landing-header-nav" aria-label="Primary navigation">
          <Link href="/" className="landing-header-nav-link">
            Home
          </Link>
          {isAuthenticated && (
            <Link href={dashboardHref} className="landing-header-nav-link">
              Dashboard
            </Link>
          )}
          <Link href="/information" className="landing-header-nav-link">
            Information
          </Link>
          <Link href="/fire-stations" className="landing-header-nav-link">
            Fire Stations
          </Link>
        </nav>

        {!isAuthenticated && (
          <>
            <Link href="/register" className="btn-ghost" data-testid="header-register">
              Register
            </Link>
            <Link href="/login" className="btn-outline" data-testid="header-signin">
              Sign In
            </Link>
          </>
        )}

        {user && (
          <div
            className="landing-header-avatar"
            role="img"
            aria-label={user.preferred_username || user.email || 'User avatar'}
          >
            {avatarInitial}
          </div>
        )}

        {isAuthenticated && !isReportPage && (
          <Link href="/report" className="btn-primary" data-testid="header-report">
            Report a Fire
          </Link>
        )}
      </div>
    </header>
  );
}
