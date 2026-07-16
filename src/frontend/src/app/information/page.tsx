'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
// Tabler icons — filled variants are preferred per #610 where available.
// Icons kept as outline (no filled Tabler variant exists):
// IconClipboardList, IconTag, IconCamera, IconSpeakerphone, IconMailbox
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

export default function InformationPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('emergencies');
  const [emergencies, setEmergencies] = useState<EmergencyResponse[] | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementResponse[] | null>(null);
  const [emergenciesError, setEmergenciesError] = useState<string | null>(null);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);
  const [emergenciesBusy, setEmergenciesBusy] = useState(true);
  const [announcementsBusy, setAnnouncementsBusy] = useState(true);

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

  useEffect(() => {
    if (loading || !user || user.role !== 'CIVILIAN_REPORTER') return;
    void loadEmergencies();
    void loadAnnouncements();
  }, [loading, user, loadEmergencies, loadAnnouncements]);

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl p-6" aria-busy="true">
        <p role="status">Loading information…</p>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <section className="rounded border bg-white p-6" role="alert">
          <h1 className="text-2xl font-semibold">Sign in required</h1>
          <p className="mt-2">Sign in to view official BFP information.</p>
          <Link className="mt-4 inline-block rounded bg-blue-700 px-4 py-2 text-white" href="/login">
            Sign in
          </Link>
        </section>
      </main>
    );
  }
  if (user.role !== 'CIVILIAN_REPORTER') {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <section className="rounded border bg-white p-6" role="alert">
          <h1 className="text-2xl font-semibold">Access restricted</h1>
          <p className="mt-2">This page is available to civilian reporters only.</p>
          <Link className="mt-4 inline-block rounded border px-4 py-2" href="/">
            Return to home
          </Link>
        </section>
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
          {!emergenciesBusy && !emergenciesError && emergencies && emergencies.length > 0 && (
            <ul className="flex flex-col gap-2.5">
              {emergencies.map((em) => (
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
                      📍 {em.location}
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
