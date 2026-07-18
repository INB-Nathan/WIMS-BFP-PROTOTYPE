'use client';

import Link from 'next/link';
import type { EmergencyResponse } from '@/lib/api/information';
import {
  IconFlameFilled,
  IconMapPin,
  IconX,
  IconFiretruck,
  IconClipboardList,
  IconRefresh,
} from '@tabler/icons-react';

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
  /** Called when an active-fire card is activated; used to fly the map to it. */
  onSelectEmergency?: (emergency: EmergencyResponse) => void;
  /** The currently selected emergency id, for highlight sync with the map. */
  selectedEmergencyId?: number | null;
  /** Shared emergencies payload owned by the landing page (single fetch). */
  emergencies: EmergencyResponse[];
  /** True during the initial fetch. */
  loading: boolean;
  /** True when the fetch rejected. */
  error: boolean;
  /** Retry the shared fetch. */
  retry: () => void;
}

export function LandingSidebar({
  onClose,
  closeRef,
  sidebarTitleId,
  onSelectEmergency,
  selectedEmergencyId,
  emergencies,
  loading,
  error,
  retry,
}: LandingSidebarProps) {
  return (
    <>
      <div className="landing-sidebar-header">
        <h3 id={sidebarTitleId}>
          <IconFlameFilled size={14} aria-hidden /> Active fires near you{' '}
          {!loading && emergencies.length > 0 && (
            <span className="sidebar-count">{emergencies.length}</span>
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
        {error ? (
          <div className="sidebar-error" data-testid="sidebar-error">
            <p>Unable to load active fires.</p>
            <button
              type="button"
              className="sidebar-retry-btn"
              onClick={retry}
              data-testid="sidebar-retry-btn"
            >
              <IconRefresh size={14} aria-hidden /> Retry
            </button>
          </div>
        ) : loading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="sidebar-skeleton-card" data-testid="sidebar-skeleton" />
            ))}
          </>
        ) : emergencies.length === 0 ? (
          <div className="sidebar-empty" data-testid="sidebar-empty">
            <p>No active fires reported.</p>
          </div>
        ) : (
          emergencies.map((e) => {
            const badge = severityBadge(e.severity);
            const isSelected = selectedEmergencyId != null && e.id === selectedEmergencyId;
            return (
              <button
                key={e.id}
                type="button"
                className={`sidebar-fire-card${isSelected ? ' selected' : ''}`}
                data-testid="sidebar-fire-card"
                onClick={() => onSelectEmergency?.(e)}
                aria-pressed={isSelected}
              >
                <div className={badge.className}>{badge.label}</div>
                <div className="sf-info">
                  <div className="sf-title">{e.title}</div>
                  <div className="sf-loc">
                    <IconMapPin size={10} aria-hidden /> {e.location}
                  </div>
                </div>
              </button>
            );
          })
        )}
        {!loading && !error && emergencies.length > 0 && (
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
