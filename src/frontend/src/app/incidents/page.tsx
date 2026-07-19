'use client';

import '@/styles/public-surface.css';

import { useMemo, useState } from 'react';
import { IconAlertTriangleFilled, IconSearch, IconSunFilled } from '@tabler/icons-react';
import { usePublicEmergencies } from '@/lib/usePublicEmergencies';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--orange)',
  moderate: 'var(--yellow)',
  low: 'var(--blue)',
};

const STATUS_PILLS: Record<string, string> = {
  ongoing: 'ps-pill-red',
  contained: 'ps-pill-orange',
  monitoring: 'ps-pill-cyan',
  resolved: 'ps-pill-green',
};

function relativeTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function isWithinTimeframe(value: string | null, timeframe: string): boolean {
  if (timeframe === 'all' || !value) return true;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  const age = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  return age <= (timeframe === 'today' ? day : timeframe === 'week' ? 7 * day : 31 * day);
}

export default function IncidentsPage() {
  const { emergencies, loading, error, retry } = usePublicEmergencies();
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [timeframe, setTimeframe] = useState('all');

  const filteredEmergencies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return emergencies.filter((emergency) => {
      if (severity !== 'all' && emergency.severity !== severity) return false;
      if (!isWithinTimeframe(emergency.published_at ?? emergency.created_at, timeframe)) return false;
      return !normalizedQuery ||
        `${emergency.title} ${emergency.location} ${emergency.description}`
          .toLowerCase()
          .includes(normalizedQuery);
    });
  }, [emergencies, query, severity, timeframe]);

  const filtersActive = query.trim() !== '' || severity !== 'all' || timeframe !== 'all';
  const clearFilters = () => {
    setQuery('');
    setSeverity('all');
    setTimeframe('all');
  };

  return (
    <div className="ps-has-mesh">
      <div className="ps-info-inner">
        <header>
          <h1 className="ps-info-title ps-incidents-title">
            <IconAlertTriangleFilled size={22} aria-hidden />
            All active fires
          </h1>
          <p className="ps-info-subtitle">
            Verified BFP updates currently shown on the map.
          </p>
        </header>

        <section aria-labelledby="incident-list-heading">
          <h2 id="incident-list-heading" className="sr-only">
            Published fire incidents
          </h2>

          <div className="ps-filters">
            <div className="ps-filter-field">
              <label htmlFor="incident-search" className="ps-filter-label">
                Search incidents
              </label>
              <div className="ps-filter-input-wrap">
                <IconSearch size={16} className="ps-filter-icon" aria-hidden />
                <input
                  id="incident-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search title, location, or description…"
                  className="ps-input"
                />
              </div>
            </div>
            <div className="ps-filter-field">
              <label htmlFor="incident-severity" className="ps-filter-label">
                Severity
              </label>
              <select
                id="incident-severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
                className="ps-select"
              >
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="moderate">Moderate</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="ps-filter-field">
              <label htmlFor="incident-timeframe" className="ps-filter-label">
                Reported
              </label>
              <select
                id="incident-timeframe"
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value)}
                className="ps-select"
              >
                <option value="all">All time</option>
                <option value="today">Last 24 hours</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
              </select>
            </div>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="ps-btn ps-btn-outline">
                Clear filters
              </button>
            )}
          </div>

          {!loading && !error && (
            <p className="ps-filter-result-count ps-muted" aria-live="polite">
              Showing {filteredEmergencies.length} of {emergencies.length} incidents
            </p>
          )}

          {loading && (
            <p className="ps-status-msg" role="status">
              Loading published incidents…
            </p>
          )}
          {!loading && error && (
            <div className="ps-alert" role="alert">
              <p>We could not load published incidents. Please try again.</p>
              <button type="button" onClick={retry}>Retry</button>
            </div>
          )}
          {!loading && !error && emergencies.length === 0 && (
            <div className="ps-empty text-center">
              <div className="ps-empty-icon">
                <IconSunFilled size={48} aria-hidden />
              </div>
              <h3 className="ps-empty-title">No active incidents</h3>
              <p className="ps-empty-text">There are no published BFP emergency updates right now.</p>
            </div>
          )}
          {!loading && !error && emergencies.length > 0 && filteredEmergencies.length === 0 && (
            <div className="ps-empty text-center">
              <h3 className="ps-empty-title">No matching incidents</h3>
              <p className="ps-empty-text">Try changing your search or severity filter.</p>
            </div>
          )}
          {!loading && !error && filteredEmergencies.length > 0 && (
            <div className="ps-incident-table-wrap">
              <table className="ps-incident-table">
                <thead>
                  <tr>
                    <th scope="col">Incident</th>
                    <th scope="col">Location</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmergencies.map((emergency) => (
                    <tr key={emergency.id}>
                      <td data-label="Incident">{emergency.title}</td>
                      <td data-label="Location">{emergency.location}</td>
                      <td data-label="Severity">
                        <span
                          className="ps-incident-severity"
                          style={{
                            color: SEVERITY_COLORS[emergency.severity] ?? 'var(--text-muted)',
                            backgroundColor: `color-mix(in srgb, ${SEVERITY_COLORS[emergency.severity] ?? 'var(--text-muted)'} 14%, transparent)`,
                          }}
                        >
                          {emergency.severity}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span className={`ps-pill ${STATUS_PILLS[emergency.status] ?? 'ps-pill-slate'}`}>
                          {emergency.status}
                        </span>
                      </td>
                      <td data-label="Reported">{relativeTime(emergency.published_at ?? emergency.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
