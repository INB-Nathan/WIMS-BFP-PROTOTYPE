'use client';

import '@/styles/public-surface.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
// Tabler icons — filled variants are preferred per #610 where available.
// Icons kept as outline (no filled Tabler variant exists):
// IconClipboardList, IconTag, IconCamera, IconMailbox, IconSpeakerphone, IconSearch, IconUserPlus
import {
  IconClipboardList,
  IconTag,
  IconCamera,
  IconMailbox,
  IconSpeakerphone,
  IconRefresh,
  IconStarFilled,
  IconSunFilled,
  IconLockFilled,
  IconAlertTriangleFilled,
  IconBookFilled,
  IconMapPinFilled,
  IconSearch,
} from '@tabler/icons-react';
import { useAuth } from '@/context/AuthContext';
import { ApiRequestError } from '@/lib/api/errors';
import {
  fetchAnnouncements,
  fetchEmergencies,
  resolveAnnouncementImageUrl,
  type AnnouncementResponse,
  type EmergencyResponse,
} from '@/lib/api/information';

type Tab = 'emergencies' | 'announcements' | 'guide';
type Theme = 'dark' | 'light';

const EMERGENCY_SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--orange)',
  moderate: 'var(--yellow)',
  low: 'var(--blue)',
};

const EMERGENCY_STATUS_PILL: Record<string, string> = {
  ongoing: 'ps-pill-red',
  contained: 'ps-pill-orange',
  monitoring: 'ps-pill-cyan',
  resolved: 'ps-pill-green',
};

const URGENCY_PILL: Record<string, string> = {
  urgent: 'ps-pill-red',
  advisory: 'ps-pill-cyan',
  general: 'ps-pill-slate',
};

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'low', label: 'Low' },
];

const GUIDE_CARDS = [
  {
    Icon: IconClipboardList,
    title: 'How to submit a report',
    desc: 'Open the report form, select a category, describe what you see, and share your location. Photos improve response accuracy. Reports are reviewed by validators within hours.',
  },
  {
    Icon: IconTag,
    title: 'Report categories',
    desc: 'Fire (wildfire, structural, grass), Flood (urban, river, coastal), Earthquake, Medical, Infrastructure, Weather, Hazmat. Choose the closest match — validators will reclassify if needed.',
  },
  {
    Icon: IconStarFilled,
    title: 'Understanding your trust score',
    desc: 'Trust scores range from 0–100. Higher scores come from complete reports, consistent submissions, and reports that are actioned by validators. Your score affects how quickly your reports are reviewed.',
  },
  {
    Icon: IconCamera,
    title: 'Taking effective photos',
    desc: 'Capture wide shots for context, close-ups for detail. Include landmarks when possible. Avoid including identifiable people without consent. Photos are encrypted in transit and storage.',
  },
  {
    Icon: IconLockFilled,
    title: 'Privacy & safety',
    desc: 'Your personal information is never shared publicly. Report locations are generalized for public display. Do not put yourself at risk to submit a report — your safety comes first.',
  },
  {
    Icon: IconRefresh,
    title: 'What happens after you report',
    desc: 'Your report enters the triage queue. Validators review, verify, and assign a status. You will see updates on your contributor dashboard. Actioned reports feed into BFP operations.',
  },
];

function relativeTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem('landing-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

/**
 * Information Hub (#614). Public, no auth required — anonymous and
 * CIVILIAN_REPORTER users see identical content (IA spec
 * docs/superpowers/specs/2026-07-15-public-surface-ia-design.md, §4).
 * The backend (api/routes/information.py) serves both endpoints with no
 * auth dependency at all, filtering only WHERE published = TRUE, so there
 * is no server-side gate to preserve here — this page previously added one
 * on the frontend, which this change removes.
 *
 * Styled with the shared public-surface design system (primitives in
 * public-surface.css). Uses a local theme toggle (persisted under the same
 * `landing-theme` key as PublicThemeProvider) rather than importing that
 * component, so we keep the page's own <header> immediately followed by the
 * tabs container (preserving the InformationPage-icons test contract) and
 * avoid the shared component's emoji toggle glyphs.
 */
export default function InformationPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('emergencies');
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  const [emergencies, setEmergencies] = useState<EmergencyResponse[] | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementResponse[] | null>(null);
  const [emergenciesError, setEmergenciesError] = useState<string | null>(null);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);
  const [emergenciesBusy, setEmergenciesBusy] = useState(true);
  const [announcementsBusy, setAnnouncementsBusy] = useState(true);

  // Emergencies filters — search, severity, date range. Client-side only:
  // the backend already returns the full published set unpaginated.
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('landing-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const loadEmergencies = useCallback(async () => {
    setEmergenciesBusy(true);
    try {
      setEmergencies(await fetchEmergencies());
      setEmergenciesError(null);
    } catch (cause) {
      setEmergenciesError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'We could not load emergency updates. Please try again.',
      );
    } finally {
      setEmergenciesBusy(false);
    }
  }, []);

  const loadAnnouncements = useCallback(async () => {
    setAnnouncementsBusy(true);
    try {
      setAnnouncements(await fetchAnnouncements());
      setAnnouncementsError(null);
    } catch (cause) {
      setAnnouncementsError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'We could not load announcements. Please try again.',
      );
    } finally {
      setAnnouncementsBusy(false);
    }
  }, []);

  // Fetch content immediately on mount for everyone — anonymous visitors and
  // signed-in reporters alike. Both endpoints are public/unauthenticated.
  useEffect(() => {
    void loadEmergencies();
    void loadAnnouncements();
  }, [loadEmergencies, loadAnnouncements]);

  const filteredEmergencies = useMemo(() => {
    if (!emergencies) return emergencies;
    const query = searchQuery.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    // Make the "to" boundary inclusive of the whole day.
    if (to) to.setHours(23, 59, 59, 999);

    return emergencies.filter((em) => {
      if (severityFilter !== 'all' && em.severity !== severityFilter) return false;

      if (query) {
        const haystack = `${em.title} ${em.location} ${em.description}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      const timestamp = em.published_at ?? em.created_at;
      const emDate = timestamp ? new Date(timestamp) : null;
      if (from && (!emDate || emDate < from)) return false;
      if (to && (!emDate || emDate > to)) return false;

      return true;
    });
  }, [emergencies, searchQuery, severityFilter, dateFrom, dateTo]);

  const filtersActive =
    searchQuery.trim() !== '' || severityFilter !== 'all' || dateFrom !== '' || dateTo !== '';

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setSeverityFilter('all');
    setDateFrom('');
    setDateTo('');
  }, []);

  const statusPill = (status: string) => EMERGENCY_STATUS_PILL[status] ?? 'ps-pill-slate';
  const urgencyPill = (urgency: string) => URGENCY_PILL[urgency] ?? 'ps-pill-slate';

  return (
    <div className="public-surface ps-has-mesh" data-theme={theme} suppressHydrationWarning>
      <div className="ps-header">
        <Link href="/" className="ps-header-logo-link" aria-label="WIMS-BFP home">
          <span className="ps-header-title">WIMS-BFP</span>
        </Link>
        <button
          type="button"
          onClick={toggleTheme}
          className="ps-theme-toggle"
          data-testid="theme-toggle"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      {loading ? (
        <main className="ps-content">
          <div className="ps-info-inner">
            <p className="ps-status-msg" role="status">
              Loading information…
            </p>
          </div>
        </main>
      ) : (
        <main className="ps-content">
          <div className="ps-info-inner">
            <header>
              <h1 className="ps-info-title">Information</h1>
              <p className="ps-info-subtitle">
                BFP announcements, reporting guidance, and nationwide emergency updates.
              </p>
            </header>

            {/* Tabs — first sibling after <header> (InformationPage-icons test contract) */}
            <div className="ps-info-tabs" role="tablist" aria-label="Information sections">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'emergencies'}
                onClick={() => setTab('emergencies')}
                className={`ps-info-tab ${tab === 'emergencies' ? 'is-active' : ''}`}
              >
                <IconAlertTriangleFilled size={18} aria-hidden />
                Emergencies
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'announcements'}
                onClick={() => setTab('announcements')}
                className={`ps-info-tab ${tab === 'announcements' ? 'is-active' : ''}`}
              >
                <IconSpeakerphone size={18} aria-hidden />
                Announcements
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'guide'}
                onClick={() => setTab('guide')}
                className={`ps-info-tab ${tab === 'guide' ? 'is-active' : ''}`}
              >
                <IconBookFilled size={18} aria-hidden />
                Reporting Guide
              </button>
            </div>

            {/* Anonymous-only CTA — additive, never a content gate (#614) */}
            {!user && (
              <section className="ps-info-cta" aria-label="Register as a reporter">
                <div className="ps-info-cta-body">
                  <h2>Want to track your reports and contribute regularly?</h2>
                  <p>
                    Register as a reporter to track submissions, get status updates, and build a
                    trust score.
                  </p>
                </div>
                <Link href="/register" className="ps-btn ps-btn-primary">
                  Register as a reporter
                </Link>
              </section>
            )}

            {/* Emergencies */}
            {tab === 'emergencies' && (
              <section aria-labelledby="emergencies-heading">
                <h2 id="emergencies-heading" className="sr-only">
                  Active emergencies
                </h2>

                {/* Filters: search, severity, date range */}
                <div className="ps-filters">
                  <div className="ps-filter-field">
                    <label htmlFor="emergency-search" className="ps-filter-label">
                      Search
                    </label>
                    <div className="ps-filter-input-wrap">
                      <IconSearch
                        size={16}
                        className="ps-filter-icon"
                        aria-hidden
                      />
                      <input
                        id="emergency-search"
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search title, location, or description…"
                        className="ps-input"
                      />
                    </div>
                  </div>
                  <div className="ps-filter-field">
                    <label htmlFor="emergency-severity" className="ps-filter-label">
                      Severity
                    </label>
                    <select
                      id="emergency-severity"
                      value={severityFilter}
                      onChange={(e) => setSeverityFilter(e.target.value)}
                      className="ps-select"
                    >
                      {SEVERITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ps-filter-field">
                    <label htmlFor="emergency-date-from" className="ps-filter-label">
                      From
                    </label>
                    <input
                      id="emergency-date-from"
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="ps-input"
                    />
                  </div>
                  <div className="ps-filter-field">
                    <label htmlFor="emergency-date-to" className="ps-filter-label">
                      To
                    </label>
                    <input
                      id="emergency-date-to"
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="ps-input"
                    />
                  </div>
                  {filtersActive && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="ps-btn ps-btn-outline"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                {!emergenciesBusy && !emergenciesError && emergencies && filteredEmergencies && (
                  <p className="ps-filter-result-count ps-muted" aria-live="polite">
                    Showing {filteredEmergencies.length} of {emergencies.length} emergencies
                  </p>
                )}

                {emergenciesBusy && (
                  <p className="ps-status-msg" role="status">
                    Loading emergencies…
                  </p>
                )}
                {!emergenciesBusy && emergenciesError && (
                  <div className="ps-alert" role="alert">
                    <p>{emergenciesError}</p>
                    <button type="button" onClick={() => void loadEmergencies()}>
                      Retry
                    </button>
                  </div>
                )}
                {!emergenciesBusy && !emergenciesError && emergencies?.length === 0 && (
                  <div className="ps-empty text-center">
                    <div className="ps-empty-icon">
                      <IconSunFilled size={48} aria-hidden />
                    </div>
                    <h3 className="ps-empty-title">No active emergencies</h3>
                    <p className="ps-empty-text">
                      There are no published emergency updates right now.
                    </p>
                  </div>
                )}
                {!emergenciesBusy &&
                  !emergenciesError &&
                  emergencies &&
                  emergencies.length > 0 &&
                  filteredEmergencies?.length === 0 && (
                    <div className="ps-empty text-center">
                      <h3 className="ps-empty-title">No matching emergencies</h3>
                      <p className="ps-empty-text">
                        Try adjusting your search, severity, or date range filters.
                      </p>
                    </div>
                  )}
                {!emergenciesBusy &&
                  !emergenciesError &&
                  filteredEmergencies &&
                  filteredEmergencies.length > 0 && (
                    <ul className="ps-list">
                      {filteredEmergencies.map((em) => (
                        <li key={em.id} className="ps-list-item">
                          <span
                            className="ps-sev-bar"
                            style={{
                              backgroundColor:
                                EMERGENCY_SEVERITY_COLOR[em.severity] ?? 'var(--text-muted)',
                            }}
                            aria-hidden
                          />
                          <span className="ps-list-main">
                            <span className="ps-list-title">{em.title}</span>
                            <span className="ps-list-loc">
                              <IconMapPinFilled size={14} className="ps-list-loc-icon" aria-hidden />
                              {em.location}
                            </span>
                            <span className="ps-list-desc">{em.description}</span>
                          </span>
                          <span className="ps-list-meta">
                            <span className={`ps-pill ${statusPill(em.status)}`}>{em.status}</span>
                            <span className="ps-list-time">
                              {relativeTime(em.published_at ?? em.created_at)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </section>
            )}

            {/* Announcements */}
            {tab === 'announcements' && (
              <section aria-labelledby="announcements-heading">
                <h2 id="announcements-heading" className="sr-only">
                  Announcements
                </h2>
                {announcementsBusy && (
                  <p className="ps-status-msg" role="status">
                    Loading announcements…
                  </p>
                )}
                {!announcementsBusy && announcementsError && (
                  <div className="ps-alert" role="alert">
                    <p>{announcementsError}</p>
                    <button type="button" onClick={() => void loadAnnouncements()}>
                      Retry
                    </button>
                  </div>
                )}
                {!announcementsBusy && !announcementsError && announcements?.length === 0 && (
                  <div className="ps-empty text-center">
                    <div className="ps-empty-icon">
                      <IconMailbox size={48} aria-hidden />
                    </div>
                    <h3 className="ps-empty-title">No announcements</h3>
                    <p className="ps-empty-text">There are no published announcements right now.</p>
                  </div>
                )}
                {!announcementsBusy &&
                  !announcementsError &&
                  announcements &&
                  announcements.length > 0 && (
                    <ul className="ps-announcement-list">
                      {announcements.map((ann) => {
                        const imageUrl = resolveAnnouncementImageUrl(ann.image_path);
                        return (
                          <li key={ann.id} className="ps-announcement-card">
                            <div className="ps-announcement-meta">
                              <span>{formatDate(ann.published_at ?? ann.created_at)}</span>
                              <span className={`ps-pill ${urgencyPill(ann.urgency)}`}>
                                {ann.urgency}
                              </span>
                            </div>
                            <h3 className="ps-announcement-title">{ann.title}</h3>
                            <p className="ps-announcement-body">{ann.body}</p>
                            {imageUrl && (
                              <div className="ps-announcement-img">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imageUrl}
                                  alt={ann.title}
                                  loading="lazy"
                                />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
              </section>
            )}

            {/* Reporting Guide */}
            {tab === 'guide' && (
              <section aria-labelledby="guide-heading">
                <h2 id="guide-heading" className="sr-only">
                  Reporting guide
                </h2>
                <div className="ps-info-guide-grid">
                  {GUIDE_CARDS.map((card) => (
                    <div key={card.title} className="ps-info-card">
                      <div className="flex items-center justify-center ps-info-card-icon">
                        <card.Icon size={32} aria-hidden />
                      </div>
                      <h3 className="ps-info-card-title">{card.title}</h3>
                      <p className="ps-info-card-desc">{card.desc}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </main>
      )}

      <footer className="ps-footer">
        <p>
          <strong>WIMS-BFP</strong> · Bureau of Fire Protection · Republic of the Philippines
        </p>
        <p>
          <Link href="/privacy">Privacy Policy</Link>
          {!user && (
            <>
              {' · '}
              <Link href="/register">Register as a reporter</Link>
            </>
          )}
        </p>
      </footer>
    </div>
  );
}
