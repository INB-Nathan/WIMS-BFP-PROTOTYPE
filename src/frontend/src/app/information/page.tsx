'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
// Tabler icons — filled variants are preferred per #610 where available.
// Icons kept as outline (no filled Tabler variant exists):
// IconClipboardList, IconTag, IconCamera, IconSpeakerphone, IconMailbox, IconSearch, IconUserPlus
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
  IconUserPlus,
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

const EMERGENCY_SEVERITY_COLOR: Record<string, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  moderate: '#D97706',
  low: '#0891B2',
};

const EMERGENCY_STATUS_CLASS: Record<string, string> = {
  ongoing: 'bg-red-50 text-red-700',
  contained: 'bg-amber-50 text-amber-700',
  monitoring: 'bg-cyan-50 text-cyan-700',
  resolved: 'bg-green-50 text-green-700',
};

const URGENCY_CLASS: Record<string, string> = {
  urgent: 'bg-red-50 text-red-700',
  advisory: 'bg-cyan-50 text-cyan-700',
  general: 'bg-slate-100 text-slate-600',
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

/**
 * Information Hub (#614). Public, no auth required — anonymous and
 * CIVILIAN_REPORTER users see identical content (IA spec
 * docs/superpowers/specs/2026-07-15-public-surface-ia-design.md, §4).
 * The backend (api/routes/information.py) serves both endpoints with no
 * auth dependency at all, filtering only WHERE published = TRUE, so there
 * is no server-side gate to preserve here — this page previously added one
 * on the frontend, which this change removes.
 */
export default function InformationPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('emergencies');
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

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl p-6" aria-busy="true">
        <p role="status">Loading information…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold">Information</h1>
        <p className="mt-1 text-gray-600">
          BFP announcements, reporting guidance, and nationwide emergency updates.
        </p>
      </header>

      {/* Anonymous-only CTA — additive, never a content gate (#614) */}
      {!user && (
        <section
          className="flex flex-col items-start gap-3 rounded border border-blue-200 bg-blue-50 p-5 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Register as a reporter"
        >
          <div className="flex items-start gap-3">
            <IconUserPlus size={28} className="mt-0.5 flex-shrink-0 text-blue-700" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Want to track your reports and contribute regularly?
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Register as a reporter to track submissions, get status updates, and build a trust
                score.
              </p>
            </div>
          </div>
          <Link
            href="/register"
            className="inline-flex flex-shrink-0 items-center rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Register as a reporter
          </Link>
        </section>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setTab('emergencies')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold ${
            tab === 'emergencies' ? 'bg-[#C62828] text-white' : 'text-gray-500'
          }`}
        >
          <IconAlertTriangleFilled size={18} aria-hidden />
          Emergencies
        </button>
        <button
          type="button"
          onClick={() => setTab('announcements')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold ${
            tab === 'announcements' ? 'bg-[#C62828] text-white' : 'text-gray-500'
          }`}
        >
          <IconSpeakerphone size={18} aria-hidden />
          Announcements
        </button>
        <button
          type="button"
          onClick={() => setTab('guide')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold ${
            tab === 'guide' ? 'bg-[#C62828] text-white' : 'text-gray-500'
          }`}
        >
          <IconBookFilled size={18} aria-hidden />
          Reporting Guide
        </button>
      </div>

      {/* Emergencies */}
      {tab === 'emergencies' && (
        <section aria-labelledby="emergencies-heading">
          <h2 id="emergencies-heading" className="sr-only">
            Active emergencies
          </h2>

          {/* Filters: search, severity, date range */}
          <div className="mb-4 flex flex-col gap-3 rounded border bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="emergency-search" className="mb-1 block text-xs font-semibold text-gray-600">
                Search
              </label>
              <div className="relative">
                <IconSearch
                  size={16}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                  aria-hidden
                />
                <input
                  id="emergency-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title, location, or description…"
                  className="w-full rounded border border-gray-300 py-2 pl-8 pr-3 text-sm"
                />
              </div>
            </div>
            <div className="min-w-[160px]">
              <label htmlFor="emergency-severity" className="mb-1 block text-xs font-semibold text-gray-600">
                Severity
              </label>
              <select
                id="emergency-severity"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                {SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[140px]">
              <label htmlFor="emergency-date-from" className="mb-1 block text-xs font-semibold text-gray-600">
                From
              </label>
              <input
                id="emergency-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="min-w-[140px]">
              <label htmlFor="emergency-date-to" className="mb-1 block text-xs font-semibold text-gray-600">
                To
              </label>
              <input
                id="emergency-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Clear filters
              </button>
            )}
          </div>

          {emergenciesBusy && (
            <p role="status">Loading emergencies…</p>
          )}
          {!emergenciesBusy && emergenciesError && (
            <div className="rounded border border-amber-300 bg-amber-50 p-4" role="alert">
              <p>{emergenciesError}</p>
              <button className="mt-2 underline" onClick={() => void loadEmergencies()}>
                Retry
              </button>
            </div>
          )}
          {!emergenciesBusy && !emergenciesError && emergencies?.length === 0 && (
            <div className="rounded border bg-white p-10 text-center shadow-sm">
              <div className="flex justify-center text-gray-400">
                <IconSunFilled size={48} aria-hidden />
              </div>
              <h3 className="mt-3 text-base font-semibold">No active emergencies</h3>
              <p className="mt-2 text-sm text-gray-600">
                There are no published emergency updates right now.
              </p>
            </div>
          )}
          {!emergenciesBusy &&
            !emergenciesError &&
            emergencies &&
            emergencies.length > 0 &&
            filteredEmergencies?.length === 0 && (
              <div className="rounded border bg-white p-10 text-center shadow-sm">
                <h3 className="text-base font-semibold">No matching emergencies</h3>
                <p className="mt-2 text-sm text-gray-600">
                  Try adjusting your search, severity, or date range filters.
                </p>
              </div>
            )}
          {!emergenciesBusy &&
            !emergenciesError &&
            filteredEmergencies &&
            filteredEmergencies.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {filteredEmergencies.map((em) => (
                  <li
                    key={em.id}
                    className="grid grid-cols-[auto_1fr_auto] gap-3.5 rounded border bg-white p-4 shadow-sm"
                  >
                    <span
                      className="h-full min-h-10 w-2 self-stretch rounded"
                      style={{ backgroundColor: EMERGENCY_SEVERITY_COLOR[em.severity] ?? '#9ca3af' }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-gray-900">{em.title}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
                        <IconMapPinFilled size={14} className="flex-shrink-0" aria-hidden />
                        {em.location}
                      </span>
                      <span className="mt-1.5 block text-sm text-gray-600">{em.description}</span>
                    </span>
                    <span className="text-right">
                      <span
                        className={`inline-block rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                          EMERGENCY_STATUS_CLASS[em.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {em.status}
                      </span>
                      <span className="mt-1.5 block text-xs text-gray-500">
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
            <p role="status">Loading announcements…</p>
          )}
          {!announcementsBusy && announcementsError && (
            <div className="rounded border border-amber-300 bg-amber-50 p-4" role="alert">
              <p>{announcementsError}</p>
              <button className="mt-2 underline" onClick={() => void loadAnnouncements()}>
                Retry
              </button>
            </div>
          )}
          {!announcementsBusy && !announcementsError && announcements?.length === 0 && (
            <div className="rounded border bg-white p-10 text-center shadow-sm">
              <div className="flex justify-center text-gray-400">
                <IconMailbox size={48} aria-hidden />
              </div>
              <h3 className="mt-3 text-base font-semibold">No announcements</h3>
              <p className="mt-2 text-sm text-gray-600">
                There are no published announcements right now.
              </p>
            </div>
          )}
          {!announcementsBusy && !announcementsError && announcements && announcements.length > 0 && (
            <ul className="flex flex-col gap-3">
              {announcements.map((ann) => {
                const imageUrl = resolveAnnouncementImageUrl(ann.image_path);
                return (
                  <li
                    key={ann.id}
                    className="rounded border border-l-4 border-gray-200 bg-white p-5 shadow-sm"
                    style={{ borderLeftColor: '#C62828' }}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
                      <span>{formatDate(ann.published_at ?? ann.created_at)}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 uppercase tracking-wide ${
                          URGENCY_CLASS[ann.urgency] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {ann.urgency}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">{ann.title}</h3>
                    <p className="mt-1 text-sm text-gray-600">{ann.body}</p>
                    {imageUrl && (
                      <div className="mt-3 overflow-hidden rounded border border-gray-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageUrl}
                          alt={ann.title}
                          className="max-h-80 w-full object-cover"
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GUIDE_CARDS.map((card) => (
              <div key={card.title} className="rounded border bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-center text-blue-600">
                  <card.Icon size={32} aria-hidden />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">{card.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
