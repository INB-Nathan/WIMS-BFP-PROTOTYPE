'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { publicApiFetch } from '@/lib/api/public-transport';

interface Emergency {
  id: number;
  title: string;
  location: string;
  severity: string;
  status: string;
}

function severityBadge(severity: string): { label: string; className: string } {
  switch (severity) {
    case 'critical':
      return { label: 'C', className: 'sf-sev crit' };
    case 'high':
      return { label: 'H', className: 'sf-sev high' };
    case 'moderate':
      return { label: 'M', className: 'sf-sev mod' };
    default:
      return { label: 'L', className: 'sf-sev low' };
  }
}

interface LandingSidebarProps {
  onClose?: () => void;
}

export function LandingSidebar({ onClose }: LandingSidebarProps) {
  const [items, setItems] = useState<Emergency[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicApiFetch<Emergency[]>('/information/emergencies')
      .then((data) => {
        if (cancelled) return;
        setItems(data ?? []);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="landing-sidebar-header">
        <h3>
          🔥 Active fires near you{' '}
          {items && items.length > 0 && (
            <span className="sidebar-count">{items.length}</span>
          )}
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="sidebar-close-btn"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        )}
      </div>

      <div className="landing-sidebar-list">
        {failed ? (
          <p className="sidebar-empty" data-testid="sidebar-error">
            Unable to load active fires.
          </p>
        ) : items === null ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="sidebar-skeleton-card" data-testid="sidebar-skeleton" />
            ))}
          </>
        ) : items.length === 0 ? (
          <p className="sidebar-empty" data-testid="sidebar-empty">
            No active fires reported.
          </p>
        ) : (
          items.map((e) => {
            const badge = severityBadge(e.severity);
            return (
              <div key={e.id} className="sidebar-fire-card" data-testid="sidebar-fire-card">
                <div className={badge.className}>{badge.label}</div>
                <div className="sf-info">
                  <div className="sf-title">{e.title}</div>
                  <div className="sf-loc">📍 {e.location}</div>
                </div>
              </div>
            );
          })
        )}
        {items && items.length > 0 && (
          <p className="sidebar-verified-note">
            Showing verified BFP incidents
          </p>
        )}
      </div>

      <div className="landing-sidebar-footer">
        <Link href="/incidents">📋 View all incidents →</Link>
        <Link href="/fire-stations">🚒 Find a fire station →</Link>
      </div>
    </>
  );
}
