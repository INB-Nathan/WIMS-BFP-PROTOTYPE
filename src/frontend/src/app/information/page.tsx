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
import { PublicContentModal } from '@/components/public/PublicContentModal';

type Tab = 'emergencies' | 'announcements' | 'guide';

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

/**
 * Guide entries are data-driven so future content is additive: add an entry
 * to this array and it appears as a card + expandable modal. `short` is the
 * card summary; `body` is the richer modal copy (paragraphs). `media` is an
 * optional illustrated slot — supply `src` for a real image (caption + alt),
 * or omit `src` to render a labelled placeholder until assets are available.
 * This keeps the modal ready for media without requiring a backend change.
 */
interface GuideMedia {
  src?: string;
  alt: string;
  caption?: string;
}

interface GuideEntry {
  id: string;
  Icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  short: string;
  body: string[];
  media?: GuideMedia;
}

const GUIDE_ENTRIES: GuideEntry[] = [
  {
    id: 'submit-report',
    Icon: IconClipboardList,
    title: 'How to submit a report',
    short:
      'Open the report form, select a category, describe what you see, and share your location. Photos improve response accuracy.',
    body: [
      'Open the report form and pick the category that best matches what you see. A precise category helps validators route your report to the right team without delay.',
      'Describe the situation in plain language — what is burning, how large the area is, and whether anyone is at risk. Share your location (or drop a pin on the map) so responders know where to go.',
      'Add photos when you can: a wide shot for context and a close-up for detail. Reports with clear photos are reviewed faster. Every report is assessed by validators, usually within hours.',
    ],
    media: {
      alt: 'Illustration of the civilian report wizard with location, photo, and category steps',
      caption: 'The report wizard guides you through location, photo, and category in five short steps.',
    },
  },
  {
    id: 'categories',
    Icon: IconTag,
    title: 'Report categories',
    short:
      'Fire, Flood, Earthquake, Medical, Infrastructure, Weather, Hazmat. Choose the closest match — validators reclassify if needed.',
    body: [
      'Fire covers wildfire, structural, and grass fires. Flood covers urban, river, and coastal flooding. Earthquake, Medical, Infrastructure, Weather, and Hazmat round out the main categories.',
      'Pick the closest match. If you are unsure, validators will reclassify your report during review — choosing the wrong category will not block your submission.',
    ],
  },
  {
    id: 'trust-score',
    Icon: IconStarFilled,
    title: 'Understanding your trust score',
    short:
      'Trust scores range from 0–100. Higher scores come from complete reports, consistent submissions, and reports that are actioned.',
    body: [
      'Your trust score reflects how useful your reports are to operations. Complete reports, consistent submissions, and reports that validators action all raise your score.',
      'A higher score means your future reports are reviewed more quickly. The score is never shown publicly and does not affect whether your report is accepted.',
    ],
  },
  {
    id: 'photos',
    Icon: IconCamera,
    title: 'Taking effective photos',
    short:
      'Capture wide shots for context, close-ups for detail. Include landmarks. Avoid identifiable people without consent. Photos are encrypted.',
    body: [
      'Capture a wide shot for context and a close-up for detail. Include a landmark or street sign so responders can confirm the location.',
      'Avoid including identifiable people without their consent. All photos are encrypted in transit and at rest — they are only visible to validated responders.',
    ],
  },
  {
    id: 'privacy',
    Icon: IconLockFilled,
    title: 'Privacy & safety',
    short:
      'Your personal information is never shared publicly. Report locations are generalized for public display. Your safety comes first.',
    body: [
      'Your personal information is never shared publicly. On public maps, report locations are generalized so individuals cannot be identified from a pinned position.',
      'Never put yourself at risk to submit a report. If a situation is dangerous, move to safety first — your safety always comes before any submission.',
    ],
  },
  {
    id: 'after-report',
    Icon: IconRefresh,
    title: 'What happens after you report',
    short:
      'Your report enters the triage queue. Validators review, verify, and assign a status. You see updates on your contributor dashboard.',
    body: [
      'After you submit, your report enters the triage queue. Validators review it, verify the details, and assign a status (pending, verified, or rejected).',
      'You can follow updates on your contributor dashboard. Reports that are verified feed directly into BFP operations and may appear as published emergency updates.',
    ],
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

/**
 * Information Hub (#614). Public, no auth required — anonymous and
 * CIVILIAN_REPORTER users see identical content (IA spec
 * docs/superpowers/specs/2026-07-15-public-surface-ia-design.md, §4).
 * The backend (api/routes/information.py) serves both endpoints with no
 * auth dependency at all, filtering only WHERE published = TRUE, so there
 * is no server-side gate to preserve here — this page previously added one
 * on the frontend, which this change removes.
 *
 * Styled with the shared public-surface design system. LayoutShell supplies
 * the same auth-aware header and persisted public theme used by the other
 * anonymous/civilian routes.
 */
export default function InformationPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('emergencies');
  const [activeGuide, setActiveGuide] = useState<GuideEntry | null>(null);

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
    <div className="ps-has-mesh">
      {loading ? (
        <div>
          <div className="ps-info-inner">
            <p className="ps-status-msg" role="status">
              Loading information…
            </p>
          </div>
        </div>
      ) : (
        <div>
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
                  {GUIDE_ENTRIES.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="ps-info-card ps-info-card-button"
                      onClick={() => setActiveGuide(entry)}
                      aria-haspopup="dialog"
                    >
                      <div className="flex items-center justify-center ps-info-card-icon">
                        <entry.Icon size={32} aria-hidden />
                      </div>
                      <h3 className="ps-info-card-title">{entry.title}</h3>
                      <p className="ps-info-card-desc">{entry.short}</p>
                      <span className="ps-info-card-more">Read more</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <PublicContentModal
              open={activeGuide !== null}
              title={activeGuide?.title ?? ''}
              onClose={() => setActiveGuide(null)}
            >
              {activeGuide && (
                <article className="ps-guide-detail">
                  {activeGuide.media && (
                    <figure className="ps-guide-media">
                      {activeGuide.media.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeGuide.media.src}
                          alt={activeGuide.media.alt}
                          className="ps-guide-media-img"
                        />
                      ) : (
                        <div
                          className="ps-guide-media-placeholder"
                          role="img"
                          aria-label={activeGuide.media.alt}
                        >
                          <IconBookFilled size={28} aria-hidden />
                          <span>Illustration coming soon</span>
                        </div>
                      )}
                      {activeGuide.media.caption && (
                        <figcaption className="ps-guide-media-caption">
                          {activeGuide.media.caption}
                        </figcaption>
                      )}
                    </figure>
                  )}
                  {activeGuide.body.map((paragraph, i) => (
                    <p key={i} className="ps-guide-paragraph">
                      {paragraph}
                    </p>
                  ))}
                </article>
              )}
            </PublicContentModal>
          </div>
        </div>
      )}
    </div>
  );
}
