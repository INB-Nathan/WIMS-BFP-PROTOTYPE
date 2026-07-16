'use client';

import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePublicTheme } from '@/components/public/PublicThemeProvider';

/**
 * PublicHeader — shared auth-aware header for the public/contributor surface.
 * Issue #654 (feat/654-public-header-theme-unify, Task T4).
 *
 * Renders the canonical `.landing-header` DOM and consumes the public theme via
 * usePublicTheme() (provided by LayoutShell for public routes). Styling comes
 * from the global public-header.css loaded via layout.tsx — no scoped styles here.
 *
 * Three states:
 * - Staff roles (encoder/validator/analyst/admin): header is NOT shown (sidebar).
 * - Anonymous: WIMS-BFP logo, [Register] [Sign In] [Report a Fire].
 * - Logged-in civilian: WIMS-BFP logo, nav [Home] [Dashboard] [Information],
 *   profile avatar, [Report a Fire].
 *
 * The "Report a Fire" CTA is hidden when already on /report to avoid redundancy.
 */
export function PublicHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const { theme, toggleTheme } = usePublicTheme();

  // Staff roles do not use this header — they keep their sidebar
  const isStaff =
    user?.role &&
    ['REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN'].includes(user.role);

  if (loading || isStaff) {
    return null;
  }

  const isCivilian = user?.role === 'CIVILIAN_REPORTER';
  const isReportPage = pathname === '/report';

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
          <img
            src="/bfp-logo.svg"
            alt="Bureau of Fire Protection"
            className="landing-header-bfp-logo"
          />
        </div>
        <span className="landing-header-title">WIMS-BFP</span>
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

        {!user && (
          <>
            <Link href="/register" className="btn-ghost" data-testid="header-register">
              Register
            </Link>
            <Link href="/login" className="btn-outline" data-testid="header-signin">
              Sign In
            </Link>
          </>
        )}

        {isCivilian && (
          <nav className="landing-header-nav" aria-label="Primary navigation">
            <Link href="/" className="landing-header-nav-link">
              Home
            </Link>
            <Link href="/contributor" className="landing-header-nav-link">
              Dashboard
            </Link>
            <Link href="/information" className="landing-header-nav-link">
              Information
            </Link>
          </nav>
        )}

        {isCivilian && (
          <div
            className="landing-header-avatar"
            role="img"
            aria-label={user.preferred_username || user.email || 'User avatar'}
          >
            {avatarInitial}
          </div>
        )}

        {!isReportPage && (
          <Link href="/report" className="btn-primary" data-testid="header-report">
            Report a Fire
          </Link>
        )}
      </div>
    </header>
  );
}
