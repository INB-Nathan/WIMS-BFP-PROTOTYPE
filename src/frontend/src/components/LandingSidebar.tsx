'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { publicApiFetch } from '@/lib/api/public-transport';
import {
  IconFlameFilled,
  IconMapPin,
  IconX,
  IconFiretruck,
  IconClipboardList,
  IconRefresh,
} from '@tabler/icons-react';

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
  closeRef?: React.RefObject<HTMLButtonElement | null>;
  sidebarTitleId?: string;
}

export function LandingSidebar({ onClose, closeRef, sidebarTitleId }: LandingSidebarProps) {
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

  const handleRetry = useCallback(() => {
    setItems(null);
    setFailed(false);
    publicApiFetch<Emergency[]>('/information/emergencies')
      .then((data) => {
        setItems(data ?? []);
        setFailed(false);
      })
      .catch(() => {
        setItems([]);
        setFailed(true);
      });
  }, []);

  return (
    <>
      <div className="landing-sidebar-header">
        <h3 id={sidebarTitleId}>
          <IconFlameFilled size={14} aria-hidden /> Active fires near you{' '}
          {items && items.length > 0 && (
            <span className="sidebar-count">{items.length}</span>
          )}
        </h3>
        {onClose && (
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="sidebar-close-btn"
            aria-label="Close sidebar"
          >
            <IconX size={18} aria-hidden />
          </button>
        )}
      </div>

      <div className="landing-sidebar-list">
        {failed ? (
          <div className="sidebar-error" data-testid="sidebar-error">
            <p>Unable to load active fires.</p>
            <button
              type="button"
              className="sidebar-retry-btn"
              onClick={handleRetry}
              data-testid="sidebar-retry-btn"
            >
              <IconRefresh size={14} aria-hidden /> Retry
            </button>
          </div>
        ) : items === null ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="sidebar-skeleton-card" data-testid="sidebar-skeleton" />
            ))}
          </>
        ) : items.length === 0 ? (
          <div className="sidebar-empty" data-testid="sidebar-empty">
            <p>No active fires reported.</p>
            <div className="sidebar-empty-actions">
              <Link href="/fire-stations">
                <IconFiretruck size={14} aria-hidden /> Find a fire station
              </Link>
              <Link href="/report">
                <IconClipboardList size={14} aria-hidden /> Report a fire
              </Link>
            </div>
          </div>
        ) : (
          items.map((e) => {
            const badge = severityBadge(e.severity);
            return (
              <div key={e.id} className="sidebar-fire-card" data-testid="sidebar-fire-card">
                <div className={badge.className}>{badge.label}</div>
                <div className="sf-info">
                  <div className="sf-title">{e.title}</div>
                  <div className="sf-loc">
                    <IconMapPin size={10} aria-hidden /> {e.location}
                  </div>
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
        <Link href="/incidents">
          <IconClipboardList size={14} aria-hidden /> View all incidents
        </Link>
        <Link href="/fire-stations">
          <IconFiretruck size={14} aria-hidden /> Find a fire station
        </Link>
      </div>
    </>
  );
}
