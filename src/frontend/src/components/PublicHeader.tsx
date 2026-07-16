'use client';

import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

/**
 * PublicHeader — shared auth-aware floating header for the public/contributor surface.
 * Issue #609 (PR feat/609-shared-header-nav). Refined to match prototype style.
 *
 * Two states per IA spec (docs/superpowers/specs/2026-07-15-public-surface-ia-design.md):
 * - Anonymous: WIMS-BFP logo, [Register] [Sign In] [Report a Fire] (right-aligned desktop; FAB mobile)
 * - Logged-in civilian: WIMS-BFP logo, [Home] [Dashboard] [Information], profile avatar, [Report a Fire]
 *
 * Staff roles (encoder/validator/analyst/admin) keep their existing sidebar — this
 * header is NOT shown for them.
 *
 * The "Report a Fire" CTA is hidden in the nav when already on /report to avoid redundancy.
 */
export function PublicHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Staff roles do not use this header — they keep their sidebar
  const isStaff =
    user?.role &&
    ['REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN'].includes(user.role);

  if (loading || isStaff) {
    return null;
  }

  const isCivilian = user?.role === 'CIVILIAN_REPORTER';
  const isReportPage = pathname === '/report';

  return (
    <>
      <header className="public-header">
        <div className="public-header-inner">
          {/* Left: Logo */}
          <div className="public-header-left">
            <Link href="/" className="public-header-logo-link">
              <div className="public-header-logo">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
                </svg>
              </div>
              <span className="public-header-title">WIMS-BFP</span>
            </Link>
          </div>

          {/* Center: nav (logged-in civilian only) */}
          {isCivilian && (
            <nav className="public-header-nav" aria-label="Primary navigation">
              <Link href="/" className="public-header-nav-link">
                Home
              </Link>
              <Link href="/contributor" className="public-header-nav-link">
                Dashboard
              </Link>
              <Link href="/information" className="public-header-nav-link">
                Information
              </Link>
            </nav>
          )}

          {/* Right: actions */}
          <div className="public-header-right">
            {!user && (
              <>
                <Link href="/register" className="public-header-btn public-header-btn-ghost">
                  Register
                </Link>
                <Link href="/login" className="public-header-btn public-header-btn-outline">
                  Sign In
                </Link>
              </>
            )}

            {isCivilian && (
              <div className="public-header-avatar" role="img" aria-label={user.preferred_username || user.email || 'User avatar'}>
                {user.preferred_username?.[0]?.toUpperCase() || user.sub?.[0]?.toUpperCase() || 'U'}
              </div>
            )}

            {/* Desktop Report button — hidden on /report to avoid redundancy */}
            {!isReportPage && (
              <Link href="/report" className="public-header-btn public-header-btn-report public-header-btn-report-desktop">
                <AlertCircle size={16} aria-hidden />
                Report a Fire
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Mobile FAB — hidden on /report (redundant) and on desktop */}
      {!isReportPage && (
        <Link href="/report" className="public-fab" aria-label="Report a Fire">
          <AlertCircle size={24} aria-hidden />
        </Link>
      )}

      <style jsx>{`
        .public-header {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(10, 10, 14, 0.82);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          padding: 0 1.25rem;
          height: 52px;
          display: flex;
          align-items: center;
        }
        .public-header-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
          gap: 1.5rem;
        }
        .public-header-left {
          display: flex;
          align-items: center;
        }
        .public-header-logo-link {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          text-decoration: none;
        }
        .public-header-logo {
          width: 30px;
          height: 30px;
          background: #3b82f6;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
        }
        .public-header-logo svg {
          width: 18px;
          height: 18px;
        }
        .public-header-title {
          font-size: 0.82rem;
          font-weight: 700;
          color: #e8e8ed;
          white-space: nowrap;
        }
        .public-header-nav {
          display: none;
          align-items: center;
          gap: 1rem;
        }
        @media (min-width: 768px) {
          .public-header-nav {
            display: flex;
          }
        }
        .public-header-nav-link {
          font-size: 0.82rem;
          font-weight: 600;
          color: rgba(232, 232, 237, 0.65);
          text-decoration: none;
          transition: color 180ms ease;
          white-space: nowrap;
        }
        .public-header-nav-link:hover {
          color: #e8e8ed;
        }
        .public-header-right {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-shrink: 0;
        }
        .public-header-btn {
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 0.74rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 180ms ease;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          font-family: inherit;
        }
        .public-header-btn-ghost {
          background: transparent;
          color: rgba(232, 232, 237, 0.65);
          border: 1px solid transparent;
        }
        .public-header-btn-ghost:hover {
          color: #e8e8ed;
          background: rgba(255, 255, 255, 0.06);
        }
        .public-header-btn-outline {
          background: transparent;
          color: #e8e8ed;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .public-header-btn-outline:hover {
          border-color: rgba(255, 255, 255, 0.35);
          background: rgba(255, 255, 255, 0.06);
        }
        .public-header-btn-report {
          background: #dc2626;
          color: #fff;
        }
        .public-header-btn-report:hover {
          background: #b91c1c;
          box-shadow: 0 0 16px rgba(220, 38, 38, 0.3);
        }
        .public-header-btn-report-desktop {
          display: none;
        }
        @media (min-width: 768px) {
          .public-header-btn-report-desktop {
            display: inline-flex;
          }
        }
        .public-header-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.12);
          color: #3b82f6;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 700;
          flex-shrink: 0;
        }

        /* Mobile FAB */
        .public-fab {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 200;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: #dc2626;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px rgba(220, 38, 38, 0.35);
          transition: all 180ms ease;
          color: #fff;
          text-decoration: none;
        }
        .public-fab:hover {
          transform: scale(1.05);
          background: #b91c1c;
        }
        @media (min-width: 768px) {
          .public-fab {
            display: none;
          }
        }
      `}</style>
    </>
  );
}
