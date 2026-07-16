'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useState, useCallback, useRef, useEffect } from 'react';
import { IntentModal } from '@/components/IntentModal';
import { LandingSidebar } from '@/components/LandingSidebar';
import { usePublicTheme } from '@/components/public/PublicThemeProvider';
import { IconMapPinFilled, IconLayoutSidebar, IconShieldCheckFilled, IconFlameFilled } from '@tabler/icons-react';

const PublicFireMap = dynamic(
  () => import('@/components/PublicFireMap').then((m) => m.PublicFireMap),
  { ssr: false },
);

export default function LandingPage() {
  const [showStations, setShowStations] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);

  const handleToggleStations = useCallback(() => {
    setShowStations((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  // ── Focus management for mobile sidebar dialog ────────────────────────────
  useEffect(() => {
    if (sidebarOpen) {
      // Focus the close button once the sidebar has opened
      const timer = setTimeout(() => {
        sidebarCloseRef.current?.focus();
      }, 300); // after CSS transition
      return () => clearTimeout(timer);
    } else {
      // Restore focus to launcher when sidebar closes
      sidebarToggleRef.current?.focus();
    }
  }, [sidebarOpen]);

  // Escape key closes the mobile sidebar
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && sidebarOpen) {
        closeSidebar();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, closeSidebar]);

  // Theme now comes from the shared PublicThemeProvider (T2) — the landing
  // page is rendered inside it via LayoutShell, so the same persisted
  // 'landing-theme' key and toggle behavior are reused.
  const { theme, toggleTheme } = usePublicTheme();

  return (
    <div className="scene-landing" data-theme={theme}>
      <IntentModal />

      {/* ── Floating translucent header ───────────────────────────────── */}
      <header className="landing-header">
        <div className="landing-header-left">
          <div className="landing-header-logo">
            <Image
              src="/bfp-logo.svg"
              alt="Bureau of Fire Protection"
              width={22}
              height={22}
              className="landing-header-bfp-logo"
              priority
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
          <Link href="/register" className="btn-ghost" data-testid="header-register">Register</Link>
          <Link href="/login" className="btn-outline" data-testid="header-signin">Sign In</Link>
          <Link href="/report" className="btn-primary" data-testid="header-report">Report a Fire</Link>
        </div>
      </header>

      {/* ── Map + Sidebar layout ───────────────────────────────────────── */}
      <div className="landing-layout">
        {/* Full-screen map */}
        <div className="landing-map">
          <PublicFireMap
            height="100%"
            className="landing-public-map"
            zoom={15}
            locateOnLoad
            showStations={showStations}
          />
        </div>

        {/* Map overlay controls */}
        <div className="landing-map-controls">
          <button
            type="button"
            onClick={handleToggleStations}
            aria-pressed={showStations}
            aria-label="Toggle fire stations"
            data-testid="toggle-stations-btn"
          >
            <IconMapPinFilled size={14} aria-hidden />
            Fire stations
          </button>
        </div>

        {/* Map trust / meaning panel */}
        <div className="landing-trust-panel" data-testid="landing-trust-panel">
          <IconShieldCheckFilled size={12} aria-hidden />
          <span>
            Verified BFP incidents · colour shows severity · refresh every minute
          </span>
        </div>

        {/* Sidebar — active fires */}
        <aside
          ref={sidebarRef}
          className={`landing-sidebar${sidebarOpen ? ' open' : ''}`}
          data-testid="landing-sidebar"
          role="dialog"
          aria-modal={sidebarOpen ? 'true' : undefined}
          aria-labelledby="landing-sidebar-title"
        >
          <LandingSidebar
            onClose={closeSidebar}
            closeRef={sidebarCloseRef}
            sidebarTitleId="landing-sidebar-title"
          />

          {/* Mobile-only: stylish link to the full information screen
              (replaces the inline Emergencies + Announcements sections) */}
          <div className="sidebar-mobile-extra" data-testid="sidebar-mobile-extra">
            <Link
              href="/information"
              className="sidebar-info-link"
              data-testid="sidebar-info-link"
            >
              <span className="sidebar-info-link-icon">
                <IconFlameFilled size={16} aria-hidden />
              </span>
              <span className="sidebar-info-link-text">
                <span className="sidebar-info-link-title">Active fires &amp; BFP announcements</span>
                <span className="sidebar-info-link-sub">View emergencies, advisories and reporting guide</span>
              </span>
              <span className="sidebar-info-link-arrow" aria-hidden>&rarr;</span>
            </Link>
          </div>
        </aside>

        {/* Mobile sidebar toggle */}
        <button
          ref={sidebarToggleRef}
          type="button"
          className="landing-sidebar-toggle"
          onClick={handleToggleSidebar}
          aria-label="Toggle active fires sidebar"
          aria-expanded={sidebarOpen}
          data-testid="sidebar-toggle-btn"
        >
          <IconLayoutSidebar size={18} aria-hidden />
        </button>
      </div>

      {/* ── Floating footer ────────────────────────────────────────────── */}
      <footer className="landing-footer" data-testid="landing-footer">
        <p>
          <strong>WIMS-BFP</strong> · Bureau of Fire Protection · Republic of the Philippines
        </p>
        <p>
          <Link href="/privacy">Privacy Policy</Link>
          {' · '}
          <Link href="/register">Register as a reporter</Link>
        </p>
      </footer>

      <style>{`
        /* ── Immersive full-screen layout ──────────────────────────────── */
        .scene-landing {
          position: relative;
          height: 100vh;
          overflow: hidden;
        }
        /* ── Prototype design tokens (dark default) ──────────────────── */
        .scene-landing {
          --bg-deep: #0a0a0e;
          --bg-base: #111116;
          --bg-elevated: #18181d;
          --bg-surface: #202026;
          --bg-hover: rgba(255,255,255,0.06);
          --text-primary: #e8e8ed;
          --text-secondary: rgba(232,232,237,0.65);
          --text-muted: rgba(232,232,237,0.38);
          --border: rgba(255,255,255,0.06);
          --border-strong: rgba(255,255,255,0.12);
          --primary: #3b82f6;
          --primary-hover: #2563eb;
          --primary-bg: rgba(59,130,246,0.12);
          --red: #dc2626;
          --red-light: #ef4444;
          --red-deep: #b91c1c;
          --red-bg: rgba(220,38,38,0.15);
          --orange: #ea580c;
          --orange-light: #ff8a65;
          --orange-bg: rgba(234,88,12,0.15);
          --yellow: #d97706;
          --yellow-light: #fbbf24;
          --yellow-bg: rgba(217,119,6,0.12);
          --green: #059669;
          --green-light: #34d399;
          --green-bg: rgba(5,150,105,0.12);
          --blue: #3b82f6;
          --blue-bg: rgba(59,130,246,0.12);
          --shadow: 0 2px 12px rgba(0,0,0,0.5);
          --transition: 180ms ease;
        }
        .scene-landing[data-theme="light"] {
          --bg-deep: #f0eee9;
          --bg-base: #faf8f4;
          --bg-elevated: #f5f3ee;
          --bg-surface: #eeebe5;
          --bg-hover: rgba(0,0,0,0.04);
          --text-primary: #1a1815;
          --text-secondary: rgba(26,24,21,0.62);
          --text-muted: rgba(26,24,21,0.38);
          --border: rgba(0,0,0,0.07);
          --border-strong: rgba(0,0,0,0.14);
          --primary: #2563eb;
          --primary-hover: #1d4ed8;
          --primary-bg: rgba(37,99,235,0.08);
          --red: #dc2626;
          --red-light: #ef4444;
          --red-deep: #b91c1c;
          --red-bg: rgba(220,38,38,0.08);
          --orange: #ea580c;
          --orange-light: #ea580c;
          --orange-bg: rgba(234,88,12,0.08);
          --yellow: #d97706;
          --yellow-light: #d97706;
          --yellow-bg: rgba(217,119,6,0.08);
          --green: #059669;
          --green-light: #059669;
          --green-bg: rgba(5,150,105,0.08);
          --blue: #2563eb;
          --blue-bg: rgba(37,99,235,0.06);
          --shadow: 0 2px 12px rgba(0,0,0,0.08);
        }
        .landing-layout {
          position: absolute;
          inset: 0;
        }
        .landing-map {
          position: absolute;
          top: 52px;
          bottom: 52px;
          left: 0;
          right: 0;
          z-index: 1;
          background:
            linear-gradient(160deg, rgba(10,10,14,0.95) 0%, rgba(10,10,14,0.9) 40%, rgba(59,130,246,0.2) 100%),
            repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.012) 2px, rgba(255,255,255,0.012) 4px);
        }
        .landing-map::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          mix-blend-mode: screen;
          background:
            radial-gradient(ellipse at 30% 70%, rgba(198,40,40,0.18) 0%, transparent 55%),
            radial-gradient(ellipse at 70% 30%, rgba(234,88,12,0.10) 0%, transparent 45%);
        }
        /* Keep the live Leaflet map above the gradient glow overlay. */
        .landing-map .leaflet-container,
        .landing-map .landing-public-map {
          position: relative;
          z-index: 1;
        }
        .scene-landing[data-theme="light"] .landing-map {
          background:
            linear-gradient(160deg, rgba(240,238,233,0.96) 0%, rgba(238,240,248,0.92) 50%, rgba(37,99,235,0.06) 100%),
            repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.015) 2px, rgba(0,0,0,0.015) 4px);
        }
        .scene-landing[data-theme="light"] .landing-map::after {
          z-index: 2;
          mix-blend-mode: multiply;
          background:
            radial-gradient(ellipse at 30% 70%, rgba(198,40,40,0.06) 0%, transparent 55%),
            radial-gradient(ellipse at 70% 30%, rgba(234,88,12,0.04) 0%, transparent 45%);
        }

        /* ── Floating header (immersive overlay) ────────────────────────
           The landing header chrome (.landing-header, btn-ghost/outline/
           primary, etc.) now lives in the global public-header.css (T3).
           Only the landing-unique absolute overlay is retained here so the
           floating header keeps its position over the full-screen map,
           overriding the global sticky base. */
        .scene-landing .landing-header {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
          justify-content: space-between;
        }

        /* ── Map overlay controls ──────────────────────────────────────── */
        .landing-map-controls {
          position: absolute;
          top: 64px;
          left: 12px;
          z-index: 90;
          display: flex;
          gap: 8px;
        }
        .landing-map-controls button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(10,10,14,0.75);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: var(--text-secondary, rgba(232,232,237,0.65));
          font-size: 0.72rem;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          transition: all 180ms ease;
        }
        .landing-map-controls button:hover {
          color: var(--text-primary, #e8e8ed);
          border-color: rgba(255,255,255,0.3);
        }
        .landing-map-controls button:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
        .landing-map-controls button[aria-pressed="true"] {
          background: rgba(198,40,40,0.2);
          border-color: rgba(198,40,40,0.4);
          color: #ef4444;
        }

        /* ── Map trust panel ───────────────────────────────────────────── */
        .landing-trust-panel {
          position: absolute;
          bottom: 64px;
          left: 12px;
          z-index: 70;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 6px;
          background: rgba(10,10,14,0.72);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 0.62rem;
          color: var(--text-muted, rgba(232,232,237,0.38));
          line-height: 1.4;
          max-width: 280px;
          pointer-events: none;
        }
        .landing-trust-panel span {
          display: inline;
        }

        /* ── Sidebar ───────────────────────────────────────────────────── */
        .landing-sidebar {
          position: absolute;
          top: 52px;
          right: 0;
          bottom: 52px;
          width: 360px;
          background: var(--bg-base, #111116);
          border-left: 1px solid var(--border, rgba(255,255,255,0.06));
          box-shadow: -4px 0 24px rgba(0,0,0,0.25);
          z-index: 80;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .landing-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
        }
        .landing-sidebar-header h3 {
          font-size: 0.82rem;
          font-weight: 700;
          color: var(--text-primary, #e8e8ed);
        }
        .landing-sidebar-header .sidebar-count {
          font-size: 0.65rem;
          color: var(--text-muted, rgba(232,232,237,0.38));
          font-weight: 400;
          margin-left: 4px;
        }
        .sidebar-close-btn {
          background: none;
          border: none;
          color: var(--text-muted, rgba(232,232,237,0.38));
          cursor: pointer;
          font-size: 1rem;
          font-family: inherit;
          padding: 4px;
          line-height: 1;
        }
        .sidebar-close-btn:hover {
          color: var(--text-primary, #e8e8ed);
        }
        .sidebar-close-btn:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
          border-radius: 4px;
        }
        .landing-sidebar-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 12px;
        }
        .sidebar-fire-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          margin-bottom: 8px;
          background: var(--bg-elevated, #18181d);
          border: 1px solid var(--border, rgba(255,255,255,0.06));
          border-radius: 10px;
          cursor: pointer;
          transition: all 180ms ease;
        }
        .sidebar-fire-card:hover {
          border-color: var(--border-strong, rgba(255,255,255,0.12));
          background: var(--bg-surface, #202026);
        }
        .sidebar-fire-card:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
        .sidebar-fire-card .sf-sev {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .sf-sev.crit { background: #dc2626; color: #fff; }
        .sf-sev.high { background: #ea580c; color: #000; }
        .sf-sev.mod  { background: #d97706; color: #000; }
        .sf-sev.low  { background: #059669; color: #fff; }
        .sidebar-fire-card .sf-info {
          flex: 1;
          min-width: 0;
        }
        .sidebar-fire-card .sf-title {
          font-size: 0.76rem;
          font-weight: 600;
          color: var(--text-primary, #e8e8ed);
        }
        .sidebar-fire-card .sf-loc {
          font-size: 0.64rem;
          color: var(--text-muted, rgba(232,232,237,0.38));
          margin-top: 2px;
        }
        .sidebar-verified-note {
          font-size: 0.64rem;
          color: var(--text-muted, rgba(232,232,237,0.38));
          text-align: center;
          margin-top: 8px;
        }
        .sidebar-empty {
          font-size: 0.78rem;
          color: var(--text-muted, rgba(232,232,237,0.38));
          text-align: center;
          padding: 20px;
        }
        .sidebar-error {
          text-align: center;
          padding: 20px;
        }
        .sidebar-error p {
          font-size: 0.78rem;
          color: var(--text-muted, rgba(232,232,237,0.38));
          margin: 0 0 12px;
        }
        .sidebar-retry-btn {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          color: var(--text-secondary, rgba(232,232,237,0.65));
          cursor: pointer;
          font-family: inherit;
          font-size: 0.72rem;
          font-weight: 600;
          padding: 6px 14px;
          transition: all 180ms ease;
        }
        .sidebar-retry-btn:hover {
          background: rgba(255,255,255,0.1);
          border-color: rgba(255,255,255,0.22);
          color: var(--text-primary, #e8e8ed);
        }
        .sidebar-retry-btn:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
        .sidebar-empty-actions {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 12px;
        }
        .sidebar-empty-actions a {
          font-size: 0.72rem;
          color: var(--text-secondary, rgba(232,232,237,0.65));
          text-decoration: none;
          transition: color 180ms ease;
        }
        .sidebar-empty-actions a:hover {
          color: var(--text-primary, #e8e8ed);
        }
        .sidebar-empty-actions a:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
          border-radius: 4px;
        }
        .sidebar-skeleton-card {
          height: 52px;
          margin-bottom: 8px;
          border-radius: 10px;
          background: var(--bg-surface, #202026);
          animation: skeleton-pulse 1.8s ease-in-out infinite;
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
        .landing-sidebar-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--border, rgba(255,255,255,0.06));
        }
        .landing-sidebar-footer a {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 0;
          font-size: 0.72rem;
          color: var(--text-secondary, rgba(232,232,237,0.65));
          text-decoration: none;
        }
        .landing-sidebar-footer a:hover {
          color: var(--text-primary, #e8e8ed);
        }
        .landing-sidebar-footer a:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
          border-radius: 4px;
        }

        /* ── Floating footer ───────────────────────────────────────────── */
        .landing-footer {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 100;
          height: 52px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          background: var(--bg-deep, #0a0a0e);
          border-top: 1px solid var(--border-strong, rgba(255,255,255,0.12));
          padding: 0 20px;
          font-size: 0.65rem;
          color: var(--text-muted, rgba(232,232,237,0.38));
          line-height: 1.6;
        }
        .landing-footer strong {
          color: var(--text-secondary, rgba(232,232,237,0.65));
        }
        .landing-footer a {
          color: var(--text-muted, rgba(232,232,237,0.38));
          text-decoration: underline;
        }
        .landing-footer a:hover {
          color: var(--text-secondary, rgba(232,232,237,0.65));
        }
        .landing-footer a:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
        /* Landing header chrome light overrides now live in global
           public-header.css (T3); only the landing footer light overrides
           remain here (footer is landing-specific). */
        .scene-landing[data-theme="light"] .landing-footer {
          background: var(--bg-base, #faf8f4);
          border-color: var(--border-strong, rgba(0,0,0,0.14));
        }
        .scene-landing[data-theme="light"] .landing-footer strong {
          color: var(--text-secondary, rgba(26,24,21,0.62));
        }
        .scene-landing[data-theme="light"] .landing-footer a {
          color: var(--text-muted, rgba(26,24,21,0.38));
        }
        .scene-landing[data-theme="light"] .landing-footer a:hover {
          color: var(--text-secondary, rgba(26,24,21,0.62));
        }

        /* ── Mobile sidebar toggle button ──────────────────────────────── */
        .landing-sidebar-toggle {
          display: none;
          position: fixed;
          bottom: 64px;
          right: 20px;
          z-index: 200;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: var(--bg-base, #111116);
          border: 1px solid var(--border-strong, rgba(255,255,255,0.12));
          box-shadow: 0 2px 12px rgba(0,0,0,0.5);
          cursor: pointer;
          font-size: 1rem;
          align-items: center;
          justify-content: center;
          color: var(--text-primary, #e8e8ed);
          font-family: inherit;
        }
        .landing-sidebar-toggle:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }

        /* ── Mobile extra content (Emergencies + Announcements) ────────── */
        .sidebar-mobile-extra {
          display: none;
          padding: 8px 12px 20px;
        }
        .sidebar-info-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 14px;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--red-bg, rgba(220,38,38,0.15)) 0%, var(--bg-surface, #202026) 60%);
          border: 1px solid var(--border-strong, rgba(255,255,255,0.12));
          color: var(--text-primary, #e8e8ed);
          text-decoration: none;
          box-shadow: var(--shadow, 0 2px 12px rgba(0,0,0,0.5));
          transition: transform var(--transition, 180ms ease), border-color var(--transition, 180ms ease), background var(--transition, 180ms ease);
        }
        .sidebar-info-link:hover {
          transform: translateY(-2px);
          border-color: var(--red, #dc2626);
          background: linear-gradient(135deg, rgba(220,38,38,0.25) 0%, var(--bg-surface, #202026) 70%);
        }
        .sidebar-info-link:focus-visible {
          outline: 2px solid var(--primary, #3b82f6);
          outline-offset: 2px;
        }
        .sidebar-info-link-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          flex-shrink: 0;
          border-radius: 9px;
          background: var(--red, #dc2626);
          color: #fff;
        }
        .sidebar-info-link-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .sidebar-info-link-title {
          font-size: 0.82rem;
          font-weight: 700;
        }
        .sidebar-info-link-sub {
          font-size: 0.68rem;
          color: var(--text-secondary, rgba(232,232,237,0.65));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sidebar-info-link-arrow {
          margin-left: auto;
          font-size: 1.1rem;
          color: var(--text-secondary, rgba(232,232,237,0.65));
          transition: transform var(--transition, 180ms ease);
        }
        .sidebar-info-link:hover .sidebar-info-link-arrow {
          transform: translateX(3px);
          color: var(--red-light, #ef4444);
        }
        @media (prefers-reduced-motion: reduce) {
          .sidebar-info-link,
          .sidebar-info-link-arrow {
            transition: none;
          }
          .sidebar-info-link:hover {
            transform: none;
          }
          .sidebar-info-link:hover .sidebar-info-link-arrow {
            transform: none;
          }
        }

        /* ── Responsive: desktop sidebar inset the map ─────────────────── */
        @media (min-width: 769px) {
          .landing-map {
            right: 360px;
            transition: right 0.25s ease;
          }
          .sidebar-mobile-extra { display: none; }
        }

        /* ── Responsive: mobile sidebar becomes bottom overlay ─────────── */
        @media (max-width: 768px) {
          .landing-sidebar {
            position: fixed;
            inset: 0;
            z-index: 300;
            width: 100%;
            height: 100%;
            border-radius: 16px 16px 0 0;
            transform: translateY(100%);
            transition: transform 0.25s ease;
            border: none;
            border-top: 1px solid var(--border, rgba(255,255,255,0.06));
            top: auto;
            bottom: 0;
            max-height: 85vh;
          }
          .landing-sidebar.open {
            transform: translateY(0);
          }
          .landing-sidebar-toggle {
            display: flex;
          }
          .scene-landing .landing-header-right .btn-ghost { display: none; }
          .scene-landing .landing-header-right .btn-outline { display: none; }
          .sidebar-mobile-extra { display: block; }
          .landing-trust-panel {
            bottom: 56px;
            max-width: 220px;
          }
        }
      `}</style>
    </div>
  );
}
