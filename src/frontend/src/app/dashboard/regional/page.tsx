'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  Flame, Building2, TreePine, Car, ChevronLeft, ChevronRight, Trees,
  Home, Users, Layers, Truck, CalendarDays, Archive, Clock,
} from 'lucide-react';
import { apiFetch, type RegionalIncidentListItem } from '@/lib/api';
import { fetchRegionalIncidentsOfflineAware } from '@/lib/api/offlineRegional';
import {
  archiveEncoderIncidentOfflineAware,
  unarchiveEncoderIncidentOfflineAware,
} from '@/lib/api/offlineRegionalActions';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { getConnectivitySnapshot } from '@/lib/connectivity';
import { getPendingOps, getConflictOps, getFailedOps, getCachedIncidents, maybePruneCaches, type OfflineOpDecrypted } from '@/lib/offlineStore';
import { type SyncedIncidentSummary } from '@/lib/useAutoSync';
import {
  REGIONAL_INCIDENT_GENERAL_CATEGORIES,
  REGIONAL_PAGE_SIZE_OPTIONS,
  clampRegionalPageSize,
  offsetFromPage,
  totalRegionalPages,
} from '@/lib/regional-incidents';
import { formatClassification } from '@/lib/afor-utils';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { StatCard, StatsDateFilterChips } from '@/components/ui';
import type { StatsDateFilterValue } from '@/components/ui';
import { WidgetGrid, AddWidgetDropdown } from '@/components/dashboard';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { buildOfflineStatusByServerId, type RegionalIncidentOfflineStatus } from '@/lib/regionalOfflineStatus';
import { formatIncidentDate, isDateOnly, getDateBounds as getDateBoundsUtil, categoryCount, formatCacheAge } from '@/lib/incident-utils';
import { useScrollSafeUpdate } from '@/lib/useScrollSafeUpdate';
import { useHoverHint } from '@/lib/useHoverHint';
import { EmptyState } from '@/components/ui';
import { fetchRegionalStatsOfflineAware } from '@/lib/api/offlineRegionalStats';
import { RegionalPageHeader } from '@/components/regional/RegionalPageHeader';
import { NotificationToasts } from '@/components/regional/NotificationToasts';
import { IncidentCard } from '@/components/regional/IncidentCard';
import { SyncNotificationModal } from '@/components/regional/SyncNotificationModal';
import { WildlandFireBreakdown } from '@/components/regional/WildlandFireBreakdown';
import { OfflineModeManager } from '@/components/regional/OfflineModeManager';
import { GhostIncidentCard, GhostStatCard, GhostIncidentRow } from '@/components/ui/GhostIncidentCard';

interface RegionalStatsPayload {
  total_incidents?: number;
  total_incidents_this_week?: number;
  by_category?: Array<{ category: string | null; count: number }>;
  by_status?: Array<{ status: string; count: number }>;
  wildland_total?: number;
  by_wildland_type?: Array<{ fire_type: string | null; count: number }>;
  structures_affected?: number;
  households_affected?: number;
  families_affected?: number;
  individuals_affected?: number;
  vehicles_affected?: number;
  my_total_incidents?: number;
  my_by_category?: Array<{ category: string | null; count: number }>;
}

const getRegionalDateBounds = getDateBoundsUtil;

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Verified', value: 'VERIFIED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Drafts', value: 'DRAFT' },
];

const DATE_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'This Year', value: 'year' },
  { label: 'Specific Date', value: 'specific' },
  { label: 'All Time', value: 'all' },
] as const;


type DateFilterValue = (typeof DATE_FILTERS)[number]['value'];

const FILTER_STORAGE_KEY = 'wims:regional_filters';

interface PersistedFilters {
  dateFilter: DateFilterValue;
  statusFilter: string;
  categoryFilter: string;
  pageIndex: number;
  pageSize: number;
  specificDate: string;
}

function loadPersistedFilters(): Partial<PersistedFilters> {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(FILTER_STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as Partial<PersistedFilters>) : {};
  } catch { return {}; }
}

function savePersistedFilters(f: PersistedFilters): void {
  try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f)); } catch {}
}

export default function RegionalDashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const canAccessRegional =
    role === 'REGIONAL_ENCODER' ||
    role === 'NATIONAL_VALIDATOR' ||
    role === 'ENCODER';

  useEffect(() => {
    if (!loading && !canAccessRegional) {
      router.replace('/dashboard');
    }
  }, [loading, canAccessRegional, router]);

  const [stats, setStats] = useState<RegionalStatsPayload | null>(null);
  const [incidents, setIncidents] = useState<RegionalIncidentListItem[]>([]);
  const [incidentsTotal, setIncidentsTotal] = useState(0);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const { isOnline } = useNetworkStatus();
  const [isFromCache, setIsFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | undefined>();
  const [queuedOps, setQueuedOps] = useState<OfflineOpDecrypted[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [offlineStatusByServerId, setOfflineStatusByServerId] = useState<
    Map<number, RegionalIncidentOfflineStatus>
  >(new Map());
  const [cachedDetailIds, setCachedDetailIds] = useState<Set<number>>(new Set());
  const [syncNotification, setSyncNotification] = useState<SyncedIncidentSummary[] | null>(null);

  // Stats visibility — hidden by default each login; persisted across page navigations.
  // Auto-collapsed when offline (stats can't refresh and would be misleading).
  const [showStats, setShowStats] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem('wims:regional_show_stats');
      return stored === 'true';
    } catch { return false; }
  });
  useEffect(() => {
    if (!isOnline) setShowStats(false);
  }, [isOnline]);

  // Pre-cache the RSC payload and JS chunks for offline-capable routes.
  // Fires on mount unconditionally — router.prefetch silently fails when offline,
  // so no guard needed. Firing early (not waiting for isOnline state) avoids the
  // race condition where the user goes offline before the health probe resolves.
  useEffect(() => {
    router.prefetch('/afor/create');
    router.prefetch('/afor/import');
    // Restricted pages: prefetch so their RSC is cached and they remain navigable
    // offline (showing their own "unavailable offline" guard, not the browser's
    // offline error page).
    router.prefetch('/dashboard/regional/audit');
    router.prefetch('/home');
    // Warm the incident-detail route. The page is 'use client' (no server data
    // fetch), so prefetching any concrete id caches the SAME shell/RSC that the
    // SW keys canonically — making every incident, including offline-created
    // local IDs, viewable offline even when the encoder has no server incidents.
    router.prefetch('/dashboard/regional/incidents/1');
  }, [router]); // router is stable — this runs once on mount
  const toggleStats = () => {
    setShowStats((prev) => {
      const next = !prev;
      try { sessionStorage.setItem('wims:regional_show_stats', String(next)); } catch {}
      return next;
    });
  };

  const [savedFilters] = useState(() => loadPersistedFilters());
  const [pageIndex, setPageIndex] = useState(savedFilters.pageIndex ?? 0);
  const [pageSize, setPageSize] = useState(savedFilters.pageSize ?? 10);
  const [categoryFilter, setCategoryFilter] = useState(savedFilters.categoryFilter ?? '');
  const [statusFilter, setStatusFilter] = useState(savedFilters.statusFilter ?? '');
  const [dateFilter, setDateFilter] = useState<DateFilterValue>((savedFilters.dateFilter as DateFilterValue) ?? 'today');
  const [specificDate, setSpecificDate] = useState(savedFilters.specificDate ?? '');
  const [specificDateDraft, setSpecificDateDraft] = useState(savedFilters.specificDate ?? '');
  const [statsDateFilter, setStatsDateFilter] = useState<StatsDateFilterValue>('week');
  const [statsViewMode, setStatsViewMode] = useState<'region' | 'mine'>(() => {
    try {
      const stored = sessionStorage.getItem('wims:regional_stats_view');
      return stored === 'mine' ? 'mine' : 'region';
    } catch { return 'region'; }
  });

  // Switch view mode and persist
  const toggleStatsView = useCallback(() => {
    setStatsViewMode((prev) => {
      const next = prev === 'region' ? 'mine' : 'region';
      try { sessionStorage.setItem('wims:regional_stats_view', next); } catch {}
      return next;
    });
  }, []);

  const [rejectionNoticeDismissed, setRejectionNoticeDismissed] = useState(false);
  const [pendingActionedBanner, setPendingActionedBanner] = useState(false);
  const lastKnownPendingCountRef = useRef<number | null>(null);
  const [isArchiveView, setIsArchiveView] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const incidentsSectionRef = useRef<HTMLElement | null>(null);
  const dateBounds = useMemo(() => getRegionalDateBounds(dateFilter, specificDate), [dateFilter, specificDate]);
  const statsDateBounds = useMemo(() => getRegionalDateBounds(statsDateFilter, ''), [statsDateFilter]);
  const specificDateDraftIsValid = isDateOnly(specificDateDraft);

  useEffect(() => {
    savePersistedFilters({ dateFilter, statusFilter, categoryFilter, pageIndex, pageSize, specificDate });
  }, [dateFilter, statusFilter, categoryFilter, pageIndex, pageSize, specificDate]);

  const updateFiltersWithoutScrollShift = useScrollSafeUpdate();
  const { hoverHint, clearHoverHint, scheduleHoverHint, hideHoverHintOnMove } = useHoverHint();

  // ── Widget customization ────────────────────────────────────────────────
  const widgetConfig = useDashboardWidgets(
    role === 'NATIONAL_VALIDATOR' ? 'NATIONAL_VALIDATOR' : 'REGIONAL_ENCODER',
  );

  const applySpecificDateFilter = useCallback(() => {
    if (!specificDateDraftIsValid) return;
    updateFiltersWithoutScrollShift(() => {
      setSpecificDate(specificDateDraft);
      setDateFilter('specific');
      setPageIndex(0);
    });
  }, [specificDateDraft, specificDateDraftIsValid, updateFiltersWithoutScrollShift]);

  const loadStats = useCallback(async () => {
    try {
      const result = await fetchRegionalStatsOfflineAware(statsDateBounds);
      setStats(result.response);
    } catch {
      // Stats errors surface via empty cards
    }
  }, [statsDateBounds]);

  const loadIncidents = useCallback(async () => {
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const size = clampRegionalPageSize(pageSize);
      const offset = offsetFromPage(pageIndex, size);
      const encoderId = (user as { id?: string })?.id ?? '';
      const { response: data, fromCache, cachedAt: cAt } = await fetchRegionalIncidentsOfflineAware(
        {
          limit: size,
          offset,
          category: isArchiveView ? undefined : (categoryFilter || undefined),
          status: isArchiveView ? undefined : (statusFilter || undefined),
          date_from: isArchiveView ? undefined : dateBounds.date_from,
          date_to: isArchiveView ? undefined : dateBounds.date_to,
          archived: isArchiveView || undefined,
        },
        encoderId,
      );
      const freshItems = data.items ?? [];
      setIncidents(freshItems);
      setIncidentsTotal(typeof data.total === 'number' ? data.total : 0);
      setIsFromCache(fromCache);
      setCachedAt(cAt);

      if (encoderId) {
        const allCached = await getCachedIncidents(encoderId);
        setCachedDetailIds(new Set(
          allCached
            .filter((c) => (c.data as Record<string, unknown>).nonsensitive !== undefined)
            .map((c) => c.serverId),
        ));
      } else {
        setCachedDetailIds(new Set());
      }

      // Surface pending create ops. Cross-reference against the current incident list
      // to avoid showing duplicate cards when an op's server incident is already cached
      // (e.g. sync succeeded but the op status wasn't flushed before going offline).
      // Also build per-incident offline status overlays from pending, conflict, and failed ops.
      if (encoderId) {
        const serverIds = new Set(freshItems.map((i) => i.incident_id));
        const ops = await getPendingOps(encoderId);
        setQueuedOps(ops.filter((op) => {
          if (op.operation !== 'create' || op.syncStatus === 'synced') return false;
          if (op.serverId !== null && serverIds.has(op.serverId)) return false;
          return true;
        }));

        // Load conflict + failed ops for overlay badges on server incident cards
        const [conflictOps, failedOps] = await Promise.all([
          getConflictOps(encoderId),
          getFailedOps(encoderId),
        ]);
        setConflictCount(conflictOps.length);
        setFailedCount(failedOps.length);
        const allActionableOps = [...ops, ...conflictOps, ...failedOps];
        setOfflineStatusByServerId(buildOfflineStatusByServerId(allActionableOps));
      } else {
        setQueuedOps([]);
        setConflictCount(0);
        setFailedCount(0);
        setOfflineStatusByServerId(new Map());
      }
    } catch (e) {
      setIncidents([]);
      setIncidentsTotal(0);
      setIncidentsError(e instanceof Error ? e.message : 'Failed to load incidents.');
    } finally {
      setIncidentsLoading(false);
    }
  }, [pageIndex, pageSize, categoryFilter, statusFilter, dateBounds.date_from, dateBounds.date_to, isArchiveView, user]);

  useEffect(() => {
    if (canAccessRegional) {
      loadStats().catch(() => { /* stats errors surface via empty cards */ });
    }
  }, [canAccessRegional, loadStats]);

  useEffect(() => {
    if (canAccessRegional) {
      loadIncidents();
    }
  }, [canAccessRegional, loadIncidents, isOnline]);

  // Listen for sync-complete events dispatched by useAutoSync after a successful reconnect sync.
  // Shows a modal listing which incidents were synced so the encoder can acknowledge.
  useEffect(() => {
    const handler = (e: Event) => {
      const { incidents } = (e as CustomEvent<{ incidents: SyncedIncidentSummary[] }>).detail;
      // Task 10: sync-completion eviction trigger. Self-gated by an internal
      // 1h timestamp so this is cheap to call on every sync event. Wrapped
      // in try/catch + void — eviction is best-effort and must never block
      // the sync-complete handler's UI refresh.
      try {
        void maybePruneCaches();
      } catch {
        // noop
      }
      if (incidents.length > 0) {
        setSyncNotification(incidents);
        loadIncidents();
      }
    };
    window.addEventListener('wims:sync-complete', handler);
    return () => window.removeEventListener('wims:sync-complete', handler);
  }, [loadIncidents]);

  // Background poll: detect when a PENDING submission is actioned by a validator.
  // Compares the PENDING total every 20 s; if it drops, something was resolved.
  useEffect(() => {
    if (!canAccessRegional) return;
    const checkPending = async () => {
      if (!getConnectivitySnapshot().isOnline) return;
      try {
        const data = await apiFetch<{ total: number }>(`/regional/incidents?status=PENDING&limit=1&offset=0`);
        if (
          lastKnownPendingCountRef.current !== null &&
          data.total < lastKnownPendingCountRef.current
        ) {
          setPendingActionedBanner(true);
        }
        lastKnownPendingCountRef.current = data.total;
      } catch { /* non-critical */ }
    };
    const id = setInterval(checkPending, 20_000);
    return () => clearInterval(id);
  }, [canAccessRegional]);

  const refreshAll = async () => {
    setStatsRefreshing(true);
    try {
      await Promise.all([loadStats(), loadIncidents()]);
    } finally {
      setStatsRefreshing(false);
    }
  };

  // Show ghost panels while auth is loading — keeps layout stable
  // and avoids a jarring flash from "Loading Dashboard…" to full UI.
  if (!canAccessRegional && !loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        Redirecting…
      </div>
    );
  }

  const size = clampRegionalPageSize(pageSize);
  const offset = offsetFromPage(pageIndex, size);
  const pages = totalRegionalPages(incidentsTotal, size);
  const fromRow = incidentsTotal === 0 ? 0 : offset + 1;
  const toRow = Math.min(offset + incidents.length, incidentsTotal);
  const canPrev = pageIndex > 0 && !incidentsLoading;
  const canNext = incidentsTotal > 0 && offset + size < incidentsTotal && !incidentsLoading;
  const isTodayView = dateFilter === 'today' || dateFilter === 'specific';
  const useCardView = isTodayView || (!incidentsLoading && incidentsTotal > 0 && incidentsTotal <= 6);

  const rejectedCount = stats?.by_status?.find((s) => s.status === 'REJECTED')?.count ?? 0;
  const showRejectedFilter = () => updateFiltersWithoutScrollShift(() => {
    setStatusFilter('REJECTED');
    setCategoryFilter('');
    setDateFilter('all');
    setSpecificDate('');
    setSpecificDateDraft('');
    setPageIndex(0);
  });

  const showAllTimeIncidents = () => updateFiltersWithoutScrollShift(() => {
    setDateFilter('all');
    setSpecificDate('');
    setSpecificDateDraft('');
    setPageIndex(0);
  });

  const encoderArchiveContext = () => ({
    encoderId: user?.id ?? '',
    regionId: Number((user as { assignedRegionId?: number | string | null })?.assignedRegionId ?? 0),
  });

  const doEncoderArchive = async (incidentId: number, e: MouseEvent) => {
    e.stopPropagation();
    setArchiveError(null);
    try {
      const result = await archiveEncoderIncidentOfflineAware(incidentId, encoderArchiveContext());
      if (result.queued) {
        setArchiveError('Archive queued — it will sync when you reconnect.');
        return;
      }
      await loadIncidents();
    } catch (err: unknown) {
      setArchiveError(err instanceof Error ? err.message : 'Archive failed');
    }
  };

  const doEncoderUnarchive = async (incidentId: number, e: MouseEvent) => {
    e.stopPropagation();
    setArchiveError(null);
    try {
      const result = await unarchiveEncoderIncidentOfflineAware(incidentId, encoderArchiveContext());
      if (result.queued) {
        setArchiveError('Unarchive queued — it will sync when you reconnect.');
        return;
      }
      await loadIncidents();
    } catch (err: unknown) {
      setArchiveError(err instanceof Error ? err.message : 'Unarchive failed');
    }
  };

  const toggleArchiveView = () => updateFiltersWithoutScrollShift(() => {
    setIsArchiveView((prev) => !prev);
    setStatusFilter('');
    setCategoryFilter('');
    setDateFilter('all');
    setSpecificDate('');
    setSpecificDateDraft('');
    setPageIndex(0);
  });

  const selectStatusFilter = (nextStatus: string) => updateFiltersWithoutScrollShift(() => {
    setStatusFilter(nextStatus);
    setPageIndex(0);
  });

  const showRejectedAndScroll = () => {
    showRejectedFilter();
    setTimeout(() => {
      incidentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  // Extract display fields from a queued-op payload.
  // Handles both the flat Incident structure from IncidentForm and the nested
  // AFOR row structure ({incident_nonsensitive_details, incident_sensitive_details}).
  const getQueuedOpDisplay = (op: OfflineOpDecrypted) => {
    const p = op.payload as Record<string, unknown>;
    const ns = (p.incident_nonsensitive_details ?? {}) as Record<string, unknown>;
    const sens = (p.incident_sensitive_details ?? {}) as Record<string, unknown>;
    const category = String(ns.general_category ?? p.general_category ?? '—');
    const station = String(ns.fire_station_name ?? p.fire_station_name ?? '—');
    const location = [
      sens.street_address ?? p.street_address,
      ns.city_municipality ?? p.city_municipality,
      ns.province_district ?? p.province_district,
    ].filter(Boolean).join(', ') || '—';
    const savedAt = new Date(op.createdAt).toLocaleString('en-PH', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return { category, station, location, savedAt };
  };

  const getQueuedIncidentItem = (op: OfflineOpDecrypted): RegionalIncidentListItem => {
    const p = op.payload as Record<string, unknown>;
    const ns = (p.incident_nonsensitive_details ?? {}) as Record<string, unknown>;
    const sens = (p.incident_sensitive_details ?? {}) as Record<string, unknown>;
    const createdAt = typeof p.created_at === 'string' ? p.created_at : new Date(op.createdAt).toISOString();
    const updatedAt = typeof p.updated_at === 'string' ? p.updated_at : createdAt;
    const city = (ns.city_municipality as string | undefined) ?? null;
    const province = (ns.province_district as string | undefined) ?? null;
    const street = ((sens.street_address ?? ns.incident_address) as string | undefined) ?? null;
    return {
      incident_id: -Math.abs(op.createdAt),
      verification_status: 'PENDING_SYNC',
      created_at: createdAt,
      updated_at: updatedAt,
      notification_dt: (ns.notification_dt as string | undefined) ?? createdAt,
      general_category: (ns.general_category ?? ns.classification_of_involved ?? null) as string | null,
      sub_category: (ns.sub_category ?? ns.incident_type ?? ns.type_of_involved_general_category ?? null) as string | null,
      alarm_level: (ns.alarm_level as string | undefined) ?? null,
      fire_station_name: (ns.fire_station_name as string | undefined) ?? null,
      structures_affected: Number(ns.structures_affected ?? 0),
      households_affected: Number(ns.households_affected ?? 0),
      families_affected: Number(ns.families_affected ?? 0),
      individuals_affected: Number(ns.individuals_affected ?? 0),
      vehicles_affected: Number(ns.vehicles_affected ?? 0),
      responder_type: (ns.responder_type as string | undefined) ?? null,
      fire_origin: (ns.fire_origin as string | undefined) ?? null,
      extent_of_damage: (ns.extent_of_damage as string | undefined) ?? null,
      owner_name: (sens.owner_name as string | undefined) ?? null,
      establishment_name: (sens.establishment_name as string | undefined) ?? null,
      caller_name: (sens.caller_name as string | undefined) ?? null,
      caller_number: (sens.caller_number as string | undefined) ?? null,
      street_address: street,
      is_wildland: false,
      city_municipality: city,
      province_district: province,
      location_display: [province, city].filter(Boolean).join(' - ') || street,
    };
  };

  // Pick the right data source based on view mode
  const activeByCategory = statsViewMode === 'mine'
    ? stats?.my_by_category
    : stats?.by_category;

  const activeTotal = statsViewMode === 'mine'
    ? stats?.my_total_incidents
    : stats?.total_incidents;

  // categoryCount with active by_category
  const activeCategoryCount = useCallback(
    (aliases: Array<string | null>) => {
      const aliasSet = new Set(aliases.map((a) => a?.toUpperCase()));
      const total = activeByCategory?.reduce(
        (sum, c) => (c.category && aliasSet.has(c.category.toUpperCase()) ? sum + c.count : sum),
        0,
      );
      return (total ?? 0).toLocaleString();
    },
    [activeByCategory],
  );

  const incidentCards = [
    {
      key: 'total-period',
      title: statsViewMode === 'mine' ? 'My Verified' : 'Total Verified',
      icon: Flame,
      value: (activeTotal ?? 0).toLocaleString(),
      iconBg: '#FEE2E2',
      iconColor: '#991B1B',
    },
    {
      key: 'STRUCTURAL',
      title: 'Structural',
      icon: Building2,
      value: activeCategoryCount(['STRUCTURAL', 'Structural']),
      iconBg: '#FEF3C7',
      iconColor: '#D97706',
    },
    {
      key: 'NON_STRUCTURAL',
      title: 'Non-Structural',
      icon: TreePine,
      value: activeCategoryCount(['NON_STRUCTURAL', 'NON-STRUCTURAL', 'Non-Structural']),
      iconBg: '#DCFCE7',
      iconColor: '#16A34A',
    },
    {
      key: 'VEHICULAR',
      title: 'Vehicular',
      icon: Car,
      value: activeCategoryCount(['VEHICULAR', 'TRANSPORTATION', 'Vehicular', 'Transportation']),
      iconBg: '#DBEAFE',
      iconColor: '#2563EB',
    },
    {
      key: 'WILDLAND',
      title: 'Wildland Fire',
      icon: Trees,
      value: stats?.wildland_total?.toLocaleString() ?? '0',
      iconBg: '#FEF9C3',
      iconColor: '#92400E',
    },
  ];

  const affectedCards = [
    {
      key: 'structures',
      title: 'Structures',
      icon: Layers,
      value: stats?.structures_affected?.toLocaleString() ?? '0',
      iconBg: '#F3E8FF',
      iconColor: '#7C3AED',
    },
    {
      key: 'households',
      title: 'Households',
      icon: Home,
      value: stats?.households_affected?.toLocaleString() ?? '0',
      iconBg: '#FCE7F3',
      iconColor: '#BE185D',
    },
    {
      key: 'families',
      title: 'Families',
      icon: Users,
      value: stats?.families_affected?.toLocaleString() ?? '0',
      iconBg: '#E0F2FE',
      iconColor: '#0369A1',
    },
    {
      key: 'individuals',
      title: 'Individuals',
      icon: Users,
      value: stats?.individuals_affected?.toLocaleString() ?? '0',
      iconBg: '#ECFDF5',
      iconColor: '#047857',
    },
    {
      key: 'vehicles',
      title: 'Vehicles',
      icon: Truck,
      value: stats?.vehicles_affected?.toLocaleString() ?? '0',
      iconBg: '#FFF7ED',
      iconColor: '#C2410C',
    },
  ];

  return (
    <div className="space-y-6 pb-8" style={{ backgroundColor: 'var(--content-bg)' }}>

      {/* ── Sync notification modal ── */}
      {syncNotification && (
        <SyncNotificationModal
          incidents={syncNotification}
          onConfirm={() => setSyncNotification(null)}
        />
      )}

      {/* ── Archive error banner ── */}
      {archiveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {archiveError}
          <button type="button" onClick={() => setArchiveError(null)} className="ml-3 underline text-red-600 hover:text-red-800">Dismiss</button>
        </div>
      )}

      {/* Enable-offline-mode first-run prompt (E10). Full controls live in Profile. */}
      <OfflineModeManager variant="banner" />

      <NotificationToasts
        pendingActionedBanner={pendingActionedBanner}
        rejectedCount={rejectedCount}
        rejectionNoticeDismissed={rejectionNoticeDismissed}
        onDismissPendingActioned={() => setPendingActionedBanner(false)}
        onRefreshAndDismiss={() => { setPendingActionedBanner(false); void refreshAll(); }}
        onDismissRejection={() => setRejectionNoticeDismissed(true)}
        onShowRejected={showRejectedAndScroll}
      />

      {/* ── Page header ── */}
      <RegionalPageHeader
        showStats={showStats}
        onToggleStats={toggleStats}
        statsRefreshing={statsRefreshing}
        incidentsLoading={incidentsLoading}
        onRefreshAll={refreshAll}
      />

      {/* ── Stats section (collapsible, auto-hidden when offline) ── */}
      {showStats && (
        <>
          {/* Period filter + view toggle */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <StatsDateFilterChips value={statsDateFilter} onChange={setStatsDateFilter} />
            <button
              type="button"
              onClick={toggleStatsView}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
              style={{
                borderColor: 'var(--border-color)',
                color: 'var(--text-secondary)',
                backgroundColor: statsViewMode === 'mine' ? 'var(--accent-bg, #EFF6FF)' : 'transparent',
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: statsViewMode === 'mine' ? '#2563EB' : '#6B7280',
                }}
              />
              {statsViewMode === 'mine' ? 'My Stats' : 'Region Stats'}
            </button>
          </div>

          {/* Incident type stats — show ghost cards while loading */}
          {!stats ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <GhostStatCard />
              <GhostStatCard />
              <GhostStatCard />
              <GhostStatCard />
              <GhostStatCard />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {incidentCards.map((card) => (
                  <StatCard key={card.key} card={card} />
                ))}
              </div>

              {/* Affected count stats */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {affectedCards.map((card) => (
                  <StatCard key={card.key} card={card} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Customizable widget grid ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Dashboard Widgets
        </span>
        <div className="flex items-center gap-2">
          {widgetConfig.widgets.length > 0 && (
            <button
              type="button"
              onClick={widgetConfig.resetToDefaults}
              className="text-xs font-medium px-2 py-1 rounded-md border hover:bg-gray-50 transition-colors"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            >
              Reset
            </button>
          )}
          <AddWidgetDropdown availableAdditions={widgetConfig.availableAdditions} onAddWidget={widgetConfig.addWidget} />
        </div>
      </div>
      <WidgetGrid
        widgetIds={widgetConfig.widgets}
        role={role}
        onRemoveWidget={widgetConfig.removeWidget}
      />

      {/* ── Stale cache banner — only shown when confirmed offline ── */}
      {isFromCache && !isOnline && (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          role="status"
        >
          <span className="mt-0.5 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />
          <div>
            <span className="font-semibold">Showing cached data</span>
            {cachedAt !== undefined && (
              <span className="ml-1 font-normal">
                — last updated {formatCacheAge(cachedAt)}
              </span>
            )}
            <span className="ml-1 font-normal text-amber-700">
              Reconnect to see the latest incidents.
            </span>
          </div>
        </div>
      )}


      {/* ── Offline Work quick link ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Offline Work</h2>
          <p className="text-sm text-gray-500">
            {queuedOps.length + failedCount + conflictCount > 0
              ? `${queuedOps.length} pending · ${failedCount} failed · ${conflictCount} conflicts`
              : 'No pending offline work.'}
          </p>
        </div>
        <Link
          href="/dashboard/regional/offline-work"
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 transition-colors"
        >
          <Clock className="h-4 w-4" aria-hidden />
          Offline Work
          {queuedOps.length + failedCount + conflictCount > 0 && (
            <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
              {queuedOps.length + failedCount + conflictCount}
            </span>
          )}
        </Link>
      </div>

      {/* ── Incidents section ── */}
      <section
        ref={incidentsSectionRef}
        className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
        aria-labelledby="region-incidents-heading"
      >
        {/* Section header */}
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="region-incidents-heading" className="font-bold text-[20px]" style={{ color: 'var(--text-primary)' }}>
                {isArchiveView ? 'Archived Incidents' : 'Your Incidents'}
              </h2>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {isArchiveView ? 'Showing incidents that have been archived by a validator.' : 'Click an incident card to view details.'}
              </p>
            </div>
            <p className="text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
              {incidentsLoading
                ? 'Loading…'
                : `${fromRow}–${toRow} of ${incidentsTotal.toLocaleString()}`}
            </p>
          </div>

          {/* Status filter chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            {STATUS_CHIPS.map((chip) => {
              const active = statusFilter === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => {
                    if (chip.value === 'REJECTED') {
                      showRejectedFilter();
                    } else {
                      selectStatusFilter(chip.value);
                    }
                  }}
                  disabled={incidentsLoading || isArchiveView}
                  className="relative rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
                  style={active
                    ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }
                    : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: 'var(--text-secondary)' }
                  }
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--bfp-red)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb';
                  }}
                >
                  {chip.label}
                  {chip.value === 'REJECTED' && rejectedCount > 0 && (
                    <span className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-2 ring-white">
                      {rejectedCount.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Secondary filters row */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select
              className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
              value={categoryFilter}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setCategoryFilter(e.target.value); setPageIndex(0); })}
              disabled={incidentsLoading}
            >
              <option value="">Classification</option>
              {REGIONAL_INCIDENT_GENERAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{formatClassification(c)}</option>
              ))}
            </select>

            <select
              className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
              value={String(size)}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setPageSize(Number(e.target.value)); setPageIndex(0); })}
              disabled={incidentsLoading}
            >
              {REGIONAL_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}/page</option>
              ))}
            </select>

            {(statusFilter || categoryFilter || dateFilter !== 'today' || size !== 10) && (
              <button
                type="button"
                className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold transition-colors hover:border-gray-300 hover:bg-gray-50"
                style={{ color: 'var(--text-primary)' }}
                onClick={() => updateFiltersWithoutScrollShift(() => {
                  setStatusFilter('');
                  setCategoryFilter('');
                  setDateFilter('today');
                  setSpecificDate('');
                  setSpecificDateDraft('');
                  setPageSize(10);
                  setPageIndex(0);
                })}
                disabled={incidentsLoading}
              >
                Clear Filters
              </button>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <select
                className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
                value={dateFilter}
                onChange={(e) => updateFiltersWithoutScrollShift(() => {
                  setDateFilter(e.target.value as DateFilterValue);
                  setSpecificDate('');
                  setSpecificDateDraft('');
                  setPageIndex(0);
                })}
                disabled={incidentsLoading}
              >
                {DATE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{filter.label}</option>
                ))}
              </select>

              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                <input
                  type="date"
                  className="min-h-9 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  value={specificDateDraft}
                  onChange={(e) => setSpecificDateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applySpecificDateFilter();
                    if (e.key === 'Escape') setSpecificDateDraft(specificDate);
                  }}
                  disabled={incidentsLoading}
                  aria-label="Filter by specific modified date"
                  title="Filter by specific modified date"
                />
              </div>

              <button
                type="button"
                className="min-h-9 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#991B1B' }}
                onClick={applySpecificDateFilter}
                disabled={incidentsLoading || !specificDateDraftIsValid}
              >
                Apply Date
              </button>
            </div>
          </div>
        </div>

        {incidentsError && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-800" role="alert">
            {incidentsError}
          </div>
        )}

        {/* Incident list */}
        {useCardView ? (
          /* ── Ghost card state: show pulsing skeleton cards while loading ── */
          incidentsLoading && incidents.length === 0 ? (
            <div className="grid min-h-[420px] gap-4 p-5 lg:grid-cols-2">
              <GhostIncidentCard />
              <GhostIncidentCard />
              <GhostIncidentCard />
              <GhostIncidentCard />
            </div>
          ) : !incidentsLoading && incidents.length === 0 && queuedOps.length === 0 ? (
            <EmptyState
              message={incidentsError ? 'Could not load incidents.' : undefined}
              secondary={incidentsError ? 'Try refreshing the dashboard.' : undefined}
              showAllTime={!incidentsError && dateFilter !== 'all'}
              onShowAllTime={showAllTimeIncidents}
            />
          ) : (
            <div className={`grid min-h-[420px] gap-4 p-5 transition-opacity lg:grid-cols-2 ${incidentsLoading ? 'opacity-60' : ''}`}>
              {queuedOps.map((op) => {
                const queuedIncident = getQueuedIncidentItem(op);
                return (
                  <div key={`queued-${op.localId}`} className="contents">
                  <IncidentCard
                    key={`queued-card-${op.localId}`}
                    inc={queuedIncident}
                    isArchiveView={false}
                    onCardClick={() => router.push(`/dashboard/regional/incidents/${op.localId}`)}
                    onHoverStart={scheduleHoverHint}
                    onHoverMove={hideHoverHintOnMove}
                    onHoverEnd={clearHoverHint}
                    onArchive={doEncoderArchive}
                    onUnarchive={doEncoderUnarchive}
                    isDetailCached
                    isOnline={isOnline}
                  />
                  </div>
                );
              })}
              {incidents.map((inc) => (
                <IncidentCard
                  key={inc.incident_id}
                  inc={inc}
                  isArchiveView={isArchiveView}
                  onCardClick={(id) => router.push(`/dashboard/regional/incidents/${id}`)}
                  onHoverStart={scheduleHoverHint}
                  onHoverMove={hideHoverHintOnMove}
                  onHoverEnd={clearHoverHint}
                  onArchive={doEncoderArchive}
                  onUnarchive={doEncoderUnarchive}
                  isDetailCached={!isOnline ? cachedDetailIds.has(inc.incident_id) : undefined}
                  isOnline={isOnline}
                  offlineStatus={offlineStatusByServerId.get(inc.incident_id)}
                />
              ))}
            </div>
          )
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid var(--border-color)' }}>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Date</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Classification</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Station</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Location</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Last Modified</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidentsLoading ? (
                <GhostIncidentRow />
              ) : incidents.length === 0 && queuedOps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12">
                    <EmptyState
                      message={incidentsError ? 'Could not load incidents.' : undefined}
                      secondary={incidentsError ? 'Try refreshing the dashboard.' : undefined}
                      showAllTime={!incidentsError && dateFilter !== 'all'}
                      onShowAllTime={showAllTimeIncidents}
                    />
                  </td>
                </tr>
              ) : (
                <>
                {queuedOps.map((op) => {
                  const { category, station, location, savedAt } = getQueuedOpDisplay(op);
                  return (
                <tr
                      key={`queued-${op.localId}`}
                      className="border-b bg-amber-50/50 cursor-pointer hover:bg-amber-100/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
                      title="View pending sync incident"
                      tabIndex={0}
                      role="link"
                      aria-label={`View pending sync incident (${category})`}
                      onClick={() => router.push(`/dashboard/regional/incidents/${op.localId}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(`/dashboard/regional/incidents/${op.localId}`);
                        }
                      }}
                    >
                      <td className="px-5 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                        {savedAt}
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {formatClassification(category)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {station}
                      </td>
                      <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {location}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-muted)' }}>
                        {savedAt}
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          Pending Sync
                        </span>
                      </td>
                      <td className="px-5 py-4" />
                    </tr>
                  );
                })}
                {incidents.map((inc, idx) => {
                  const rowOfflineUncached = !isOnline && !cachedDetailIds.has(inc.incident_id);
                  return (
                  <tr
                    key={inc.incident_id}
                    onClick={() => { if (rowOfflineUncached) return; router.push(`/dashboard/regional/incidents/${inc.incident_id}`); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (rowOfflineUncached) return;
                        router.push(`/dashboard/regional/incidents/${inc.incident_id}`);
                      }
                    }}
                    tabIndex={rowOfflineUncached ? -1 : 0}
                    role={rowOfflineUncached ? 'row' : 'link'}
                    aria-disabled={rowOfflineUncached || undefined}
                    aria-label={`View incident ${inc.incident_id}`}
                    className={rowOfflineUncached ? 'cursor-not-allowed opacity-60 transition-colors outline-none' : 'cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#C62828] focus-visible:ring-inset'}
                    style={{
                      backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => {
                      if (rowOfflineUncached) return;
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-light)';
                      scheduleHoverHint(inc.incident_id, e);
                    }}
                    onMouseMove={() => { if (!rowOfflineUncached) hideHoverHintOnMove(); }}
                    onMouseLeave={(e) => {
                      if (rowOfflineUncached) return;
                      (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
                      clearHoverHint();
                    }}
                  >
                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {formatIncidentDate(inc.notification_dt || inc.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {formatClassification(inc.general_category)}
                        </span>
                        {inc.is_wildland && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            Wildland
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-2">
                        <span>{inc.fire_station_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {inc.location_display ?? '—'}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {formatIncidentDate(inc.updated_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={inc.verification_status} />
                        {rowOfflineUncached && (
                          <span className="rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-500 whitespace-nowrap">
                            Go online to view
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {inc.verification_status === 'VERIFIED' && (
                        <button
                          type="button"
                          onClick={(e) => isArchiveView
                            ? void doEncoderUnarchive(inc.incident_id, e)
                            : void doEncoderArchive(inc.incident_id, e)
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-gray-50"
                          style={{ color: 'var(--text-secondary)' }}
                          title={isArchiveView ? 'Restore this incident to the active list' : 'Archive this verified incident'}
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden />
                          {isArchiveView ? 'Unarchive' : 'Archive'}
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })
                }</>
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Total: <strong style={{ color: 'var(--text-primary)' }}>{incidentsTotal.toLocaleString()}</strong>
            </span>
            <button
              type="button"
              onClick={toggleArchiveView}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${isArchiveView ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
              style={isArchiveView ? {} : { color: 'var(--text-primary)' }}
            >
              <Archive className="h-4 w-4" aria-hidden />
              {isArchiveView ? 'Hide Archive' : 'See Archive'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={!canPrev}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Prev
            </button>
            <span className="text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {pageIndex + 1} / {pages}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setPageIndex((p) => p + 1)}
              disabled={!canNext}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {hoverHint && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          style={{ left: hoverHint.x + 12, top: hoverHint.y + 12 }}
        >
          Click to view
        </div>
      )}

      {stats && (stats.wildland_total ?? 0) > 0 && (
        <WildlandFireBreakdown
          wildlandTotal={stats.wildland_total ?? 0}
          byWildlandType={stats.by_wildland_type}
        />
      )}
    </div>
  );
}

