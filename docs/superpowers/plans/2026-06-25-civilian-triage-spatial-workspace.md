# Civilian Triage Spatial Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/incidents/triage` from a table-first queue into a map-first spatial triage workspace with an investigation board, while retaining and enlarging `TriageInspectionModal` as the guarded action surface.

**Architecture:** Keep the existing triage API and mutation flow. Add shared geometry/evidence primitives, a dynamically loaded Leaflet map for page-level spatial exploration, and refit the existing modal CSS/markup so its columns become spatial panel, evidence panel, and action rail. Page owns cross-surface selection state; modal owns only action-tab/form state.

**Tech Stack:** Next.js App Router, React 19, TypeScript, TailwindCSS 4, Vitest + React Testing Library + jsdom, Leaflet/react-leaflet via dynamic import.

## Global Constraints

- Do not deprecate or replace `TriageInspectionModal`.
- Do not move destructive terminal/correct/split/merge commits directly into the page-level board in this phase.
- Do not change backend triage mutation semantics.
- Do not add new backend endpoints unless the existing queue response lacks a required field.
- Reuse the current `GET /api/triage/queue` raw data shape.
- Derive cluster centroid/spread on the client unless backend fields prove necessary.
- Page owns `selectedTriageItemId`, `selectedTriageItemType`, `selectedReportId`, `isInspectionModalOpen`, `mapViewport`, active filters, and raw queue payload.
- Preserve existing terminal/correct/split/merge previews, confirmations, audit guidance, and no-commit-keyboard-shortcut policy.
- Reports with invalid coordinates remain visible in board/list but do not render markers.
- Use dynamic import / SSR guard for all react-leaflet triage maps.
- Update `system-wiki/frontend/route-map.md` and `system-wiki/operations/civilian-triage-hci-polish.md` after implementation.

---

## File Structure

Create:

- `src/frontend/src/components/triage/triageGeometry.ts` — pure helpers for coordinate validation, cluster centroid/radius/bounds, item identity, and priority sorting.
- `src/frontend/src/components/triage/TriageEvidenceCard.tsx` — shared report evidence card used by page board and modal evidence panel.
- `src/frontend/src/components/triage/TriageCanvasMap.tsx` — SSR-safe wrapper around the page map.
- `src/frontend/src/components/triage/TriageCanvasMapInner.tsx` — react-leaflet implementation for page map markers, cluster circles, singleton markers, selected z-order, and popups.
- `src/frontend/src/components/triage/TriageInvestigationBoard.tsx` — selected item summary, evidence stack, no-location hints, ranked item list, and `Inspect / Act` CTA.
- `src/frontend/src/components/triage/TriageSpatialPanel.tsx` — SSR-safe wrapper for modal spatial panel.
- `src/frontend/src/components/triage/TriageSpatialPanelInner.tsx` — react-leaflet implementation for modal map with `invalidateSize()`.
- `src/frontend/src/components/triage/triageGeometry.test.ts` — pure helper tests.
- `src/frontend/src/components/triage/TriageInvestigationBoard.test.tsx` — board/card behavior tests.

Modify:

- `src/frontend/src/components/triage/index.ts` — export new triage components/helpers as needed.
- `src/frontend/src/app/incidents/triage/page.tsx` — replace table-first layout with workspace; own selection state; keep queue loading/filter/claim/reload behavior.
- `src/frontend/src/app/incidents/triage/page.test.tsx` — rewrite page layout tests away from `clusters-table` / `singletons-table`; keep modal action behavior assertions.
- `src/frontend/src/components/triage/TriageInspectionModal.tsx` — relocate `TriageActionTabs` into action rail and insert `TriageSpatialPanel` as first body column.
- `src/frontend/src/components/triage/ReportsListPanel.tsx` — reuse `TriageEvidenceCard` for report cards where practical.
- `src/frontend/src/components/triage/triage-modal.css` — enlarge modal, change grid columns to spatial/evidence/action, style compact action tabs, add responsive behavior.
- `src/frontend/src/components/triage/*.test.tsx` if existing modal tests need selector updates after rail relocation.
- `system-wiki/frontend/route-map.md` — document new `/incidents/triage` workspace.
- `system-wiki/operations/civilian-triage-hci-polish.md` — document new spatial workspace and modal anatomy.

---

### Task 1: Geometry and Shared Evidence Primitives

**Files:**
- Create: `src/frontend/src/components/triage/triageGeometry.ts`
- Create: `src/frontend/src/components/triage/triageGeometry.test.ts`
- Create: `src/frontend/src/components/triage/TriageEvidenceCard.tsx`
- Modify: `src/frontend/src/components/triage/index.ts`

**Interfaces:**
- Consumes: `TriageClusterEntry`, `TriageReportEntry` from `@/lib/api`.
- Produces:
  - `type TriageItemType = 'cluster' | 'singleton'`
  - `type TriageItemIdentity = { type: TriageItemType; id: number }`
  - `type ValidReportCoordinate = { report: TriageReportEntry; lat: number; lng: number }`
  - `type ClusterGeometry = { centroid: [number, number] | null; radiusMeters: number | null; bounds: [[number, number], [number, number]] | null; validReports: ValidReportCoordinate[]; invalidReports: TriageReportEntry[] }`
  - `isValidPhilippinesCoordinate(lat: unknown, lng: unknown): lat is number`
  - `getTriageItemIdentity(item: TriageClusterEntry): TriageItemIdentity | null`
  - `deriveClusterGeometry(item: TriageClusterEntry): ClusterGeometry`
  - `sortTriageItemsByPriority(items: TriageClusterEntry[]): TriageClusterEntry[]`
  - `TriageEvidenceCard(props)` reusable card component.

- [ ] **Step 1: Write failing geometry tests**

Create `src/frontend/src/components/triage/triageGeometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import {
  deriveClusterGeometry,
  getTriageItemIdentity,
  isValidPhilippinesCoordinate,
  sortTriageItemsByPriority,
} from './triageGeometry';

function report(overrides: Partial<TriageReportEntry>): TriageReportEntry {
  return {
    report_id: 1,
    latitude: 14.5,
    longitude: 121.0,
    category: 'STRUCTURAL',
    sub_category: 'RESIDENTIAL',
    reporting_context: 'someone_else_needs_help',
    safety_status: 'life_safety',
    status: 'PENDING',
    status_explanation: null,
    trust_breakdown: {
      score: 75,
      included_signals: ['gps_match'],
      missing_signals: [],
      gps_mismatch: false,
      duplicate_device_count_30m: 0,
    },
    severity: 'HIGH',
    related_count: 0,
    linked_count: 0,
    created_at: '2026-06-25T00:00:00Z',
    reported_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    previous_report_id: null,
    station: { name: 'Balayan FS', distance_m: 1200, phone_available: true },
    ...overrides,
  };
}

function cluster(overrides: Partial<TriageClusterEntry>): TriageClusterEntry {
  return {
    cluster_id: 42,
    anchor_report_id: 1,
    cluster_status: 'OPEN',
    assigned_to: null,
    review_started_at: null,
    member_count: 2,
    has_life_safety: false,
    severity: 'MEDIUM',
    avg_trust: 70,
    oldest_report_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    is_danger: false,
    related_count: 0,
    reports: [report({ report_id: 1 }), report({ report_id: 2, latitude: 14.501, longitude: 121.001 })],
    station: { name: 'Balayan FS', distance_m: 1200, phone_available: true },
    ...overrides,
  };
}

describe('triageGeometry', () => {
  it('accepts expected Philippines coordinates and rejects invalid runtime values', () => {
    expect(isValidPhilippinesCoordinate(14.5995, 120.9842)).toBe(true);
    expect(isValidPhilippinesCoordinate(Number.NaN, 120.9842)).toBe(false);
    expect(isValidPhilippinesCoordinate(0, 0)).toBe(false);
    expect(isValidPhilippinesCoordinate(60, 120)).toBe(false);
    expect(isValidPhilippinesCoordinate(14.5, null)).toBe(false);
  });

  it('derives centroid, radius, bounds, and invalid reports from member coordinates', () => {
    const item = cluster({
      reports: [
        report({ report_id: 10, latitude: 14.5, longitude: 121.0 }),
        report({ report_id: 11, latitude: 14.502, longitude: 121.002 }),
        report({ report_id: 12, latitude: 0 as number, longitude: 0 as number }),
      ],
    });

    const geometry = deriveClusterGeometry(item);

    expect(geometry.validReports.map((entry) => entry.report.report_id)).toEqual([10, 11]);
    expect(geometry.invalidReports.map((entry) => entry.report_id)).toEqual([12]);
    expect(geometry.centroid?.[0]).toBeCloseTo(14.501, 3);
    expect(geometry.centroid?.[1]).toBeCloseTo(121.001, 3);
    expect(geometry.radiusMeters).toBeGreaterThanOrEqual(75);
    expect(geometry.bounds).toEqual([[14.5, 121.0], [14.502, 121.002]]);
  });

  it('identifies clusters and singleton reports with stable ids', () => {
    expect(getTriageItemIdentity(cluster({ cluster_id: 42 }))).toEqual({ type: 'cluster', id: 42 });
    expect(getTriageItemIdentity(cluster({ cluster_id: null, anchor_report_id: 77, reports: [report({ report_id: 77 })] }))).toEqual({ type: 'singleton', id: 77 });
  });

  it('sorts life safety, timeout risk, severity, member count, and age before low-priority items', () => {
    const low = cluster({ cluster_id: 1, severity: 'LOW', oldest_report_at: '2026-06-25T00:20:00Z' });
    const timeout = cluster({ cluster_id: 2, is_timeout_risk: true, severity: 'MEDIUM' });
    const lifeSafety = cluster({ cluster_id: 3, has_life_safety: true, severity: 'HIGH' });

    expect(sortTriageItemsByPriority([low, timeout, lifeSafety]).map((item) => item.cluster_id)).toEqual([3, 2, 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd src/frontend && npx vitest run src/components/triage/triageGeometry.test.ts
```

Expected: FAIL because `./triageGeometry` does not exist.

- [ ] **Step 3: Implement geometry helpers**

Create `src/frontend/src/components/triage/triageGeometry.ts`:

```ts
import type { TriageClusterEntry, TriageReportEntry, TriageSeverity } from '@/lib/api';

export type TriageItemType = 'cluster' | 'singleton';

export interface TriageItemIdentity {
  type: TriageItemType;
  id: number;
}

export interface ValidReportCoordinate {
  report: TriageReportEntry;
  lat: number;
  lng: number;
}

export interface ClusterGeometry {
  centroid: [number, number] | null;
  radiusMeters: number | null;
  bounds: [[number, number], [number, number]] | null;
  validReports: ValidReportCoordinate[];
  invalidReports: TriageReportEntry[];
}

const PHILIPPINES_BOUNDS = {
  minLat: 4,
  maxLat: 22,
  minLng: 116,
  maxLng: 127,
};

const MIN_VISIBLE_CLUSTER_RADIUS_METERS = 75;

const SEVERITY_SCORE: Record<TriageSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function isValidPhilippinesCoordinate(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return (
    lat >= PHILIPPINES_BOUNDS.minLat &&
    lat <= PHILIPPINES_BOUNDS.maxLat &&
    lng >= PHILIPPINES_BOUNDS.minLng &&
    lng <= PHILIPPINES_BOUNDS.maxLng
  );
}

export function getTriageItemIdentity(item: TriageClusterEntry): TriageItemIdentity | null {
  if (item.cluster_id !== null && item.cluster_id !== undefined) {
    return { type: 'cluster', id: item.cluster_id };
  }
  const reportId = item.anchor_report_id ?? item.reports[0]?.report_id;
  return typeof reportId === 'number' ? { type: 'singleton', id: reportId } : null;
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const earthRadiusMeters = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

export function deriveClusterGeometry(item: TriageClusterEntry): ClusterGeometry {
  const validReports: ValidReportCoordinate[] = [];
  const invalidReports: TriageReportEntry[] = [];

  item.reports.forEach((report) => {
    if (isValidPhilippinesCoordinate(report.latitude, report.longitude)) {
      validReports.push({ report, lat: report.latitude, lng: report.longitude });
    } else {
      invalidReports.push(report);
    }
  });

  if (validReports.length === 0) {
    return { centroid: null, radiusMeters: null, bounds: null, validReports, invalidReports };
  }

  const centroid: [number, number] = [
    validReports.reduce((sum, entry) => sum + entry.lat, 0) / validReports.length,
    validReports.reduce((sum, entry) => sum + entry.lng, 0) / validReports.length,
  ];

  const radiusMeters = Math.max(
    MIN_VISIBLE_CLUSTER_RADIUS_METERS,
    ...validReports.map((entry) => distanceMeters(centroid, [entry.lat, entry.lng])),
  );

  const lats = validReports.map((entry) => entry.lat);
  const lngs = validReports.map((entry) => entry.lng);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];

  return { centroid, radiusMeters, bounds, validReports, invalidReports };
}

export function sortTriageItemsByPriority(items: TriageClusterEntry[]): TriageClusterEntry[] {
  return [...items].sort((a, b) => {
    if (a.has_life_safety !== b.has_life_safety) return a.has_life_safety ? -1 : 1;
    if (a.is_danger !== b.is_danger) return a.is_danger ? -1 : 1;
    if (a.is_timeout_risk !== b.is_timeout_risk) return a.is_timeout_risk ? -1 : 1;
    const severityDelta = (SEVERITY_SCORE[b.severity] ?? 0) - (SEVERITY_SCORE[a.severity] ?? 0);
    if (severityDelta !== 0) return severityDelta;
    if (a.member_count !== b.member_count) return b.member_count - a.member_count;
    return new Date(a.oldest_report_at).getTime() - new Date(b.oldest_report_at).getTime();
  });
}
```

- [ ] **Step 4: Implement shared evidence card**

Create `src/frontend/src/components/triage/TriageEvidenceCard.tsx`:

```tsx
'use client';

import { AlertTriangle, CheckCircle2, MapPin, RadioTower } from 'lucide-react';
import type { TriageReportEntry } from '@/lib/api';
import { isValidPhilippinesCoordinate } from './triageGeometry';
import { isTerminalStatus, stripHtml } from './useTriageModalState';

export interface TriageEvidenceCardProps {
  report: TriageReportEntry;
  selected?: boolean;
  suggested?: boolean;
  compact?: boolean;
  onClick?: (reportId: number) => void;
  onStartCorrection?: (report: TriageReportEntry) => void;
}

function statusTone(report: TriageReportEntry): string {
  if (report.safety_status) return 'border-red-300 bg-red-50 text-red-900';
  if (report.is_timeout_risk) return 'border-amber-300 bg-amber-50 text-amber-900';
  if (report.trust_breakdown.score >= 75) return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  return 'border-slate-200 bg-white text-slate-900';
}

export function TriageEvidenceCard({
  report,
  selected = false,
  suggested = false,
  compact = false,
  onClick,
  onStartCorrection,
}: TriageEvidenceCardProps) {
  const hasLocation = isValidPhilippinesCoordinate(report.latitude, report.longitude);
  const terminal = isTerminalStatus(report.status);
  const description = stripHtml(report.description ?? '').trim();

  return (
    <article
      data-testid={`triage-evidence-card-${report.report_id}`}
      aria-selected={selected}
      className={`rounded-xl border p-3 text-sm shadow-sm transition ${statusTone(report)} ${
        selected ? 'ring-2 ring-red-700 ring-offset-2 border-red-700' : ''
      }`}
      onClick={() => onClick?.(report.report_id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold text-slate-500">REPORT #{report.report_id}</p>
          <h3 className="mt-1 font-semibold text-slate-950">
            {report.category ?? 'Unclassified'}{report.sub_category ? ` / ${report.sub_category}` : ''}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {selected && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white">Selected</span>}
          {suggested && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">Suggested</span>}
          {terminal && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{report.status}</span>}
        </div>
      </div>

      {!compact && description && <p className="mt-2 line-clamp-3 text-slate-700">{description}</p>}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {report.safety_status && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 font-bold text-red-800">
            <AlertTriangle className="h-3 w-3" /> Life safety
          </span>
        )}
        {hasLocation ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
            <MapPin className="h-3 w-3" /> {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 font-bold text-slate-700">
            <MapPin className="h-3 w-3" /> No usable location
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
          <CheckCircle2 className="h-3 w-3" /> Trust {report.trust_breakdown.score}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
          <RadioTower className="h-3 w-3" /> {report.station.name ?? 'No station'}
        </span>
      </div>

      {onStartCorrection && terminal && (
        <button
          type="button"
          className="mt-3 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={(event) => {
            event.stopPropagation();
            onStartCorrection(report);
          }}
        >
          Correct terminal status
        </button>
      )}
    </article>
  );
}
```

- [ ] **Step 5: Export helpers/components**

Modify `src/frontend/src/components/triage/index.ts` to include:

```ts
export { TriageEvidenceCard } from './TriageEvidenceCard';
export type { TriageEvidenceCardProps } from './TriageEvidenceCard';
export {
  deriveClusterGeometry,
  getTriageItemIdentity,
  isValidPhilippinesCoordinate,
  sortTriageItemsByPriority,
};
export type { ClusterGeometry, TriageItemIdentity, TriageItemType, ValidReportCoordinate } from './triageGeometry';
```

Keep existing exports in the file; append these exports rather than replacing current exports.

- [ ] **Step 6: Run tests**

Run:

```bash
cd src/frontend && npx vitest run src/components/triage/triageGeometry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/components/triage/triageGeometry.ts src/frontend/src/components/triage/triageGeometry.test.ts src/frontend/src/components/triage/TriageEvidenceCard.tsx src/frontend/src/components/triage/index.ts
git commit -m "feat(triage): add spatial geometry and evidence card primitives"
```

---

### Task 2: Page Map Canvas and Investigation Board

**Files:**
- Create: `src/frontend/src/components/triage/TriageCanvasMap.tsx`
- Create: `src/frontend/src/components/triage/TriageCanvasMapInner.tsx`
- Create: `src/frontend/src/components/triage/TriageInvestigationBoard.tsx`
- Create: `src/frontend/src/components/triage/TriageInvestigationBoard.test.tsx`
- Modify: `src/frontend/src/components/triage/index.ts`

**Interfaces:**
- Consumes Task 1 helpers and `TriageEvidenceCard`.
- Produces:
  - `TriageCanvasMapProps`: `{ items; selectedIdentity; selectedReportId; onSelectItem; onSelectReport }`.
  - `TriageInvestigationBoardProps`: selected item board with `onInspect`, `onSelectItem`, `onSelectReport`, `onClaimCluster`.

- [ ] **Step 1: Write failing board test**

Create `src/frontend/src/components/triage/TriageInvestigationBoard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { TriageInvestigationBoard } from './TriageInvestigationBoard';

function report(overrides: Partial<TriageReportEntry>): TriageReportEntry {
  return {
    report_id: 10,
    latitude: 14.5,
    longitude: 121.0,
    category: 'STRUCTURAL',
    sub_category: 'RESIDENTIAL',
    reporting_context: 'someone_else_needs_help',
    safety_status: null,
    status: 'PENDING',
    status_explanation: null,
    description: 'Smoke near market',
    trust_breakdown: { score: 80, included_signals: [], missing_signals: [], gps_mismatch: false, duplicate_device_count_30m: 0 },
    severity: 'HIGH',
    related_count: 0,
    linked_count: 0,
    created_at: '2026-06-25T00:00:00Z',
    reported_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    previous_report_id: null,
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true },
    ...overrides,
  };
}

function cluster(overrides: Partial<TriageClusterEntry>): TriageClusterEntry {
  return {
    cluster_id: 42,
    anchor_report_id: 10,
    cluster_status: 'OPEN',
    assigned_to: null,
    review_started_at: null,
    member_count: 2,
    has_life_safety: true,
    severity: 'HIGH',
    avg_trust: 76,
    oldest_report_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: true,
    is_danger: false,
    related_count: 1,
    reports: [report({ report_id: 10 }), report({ report_id: 11, latitude: 0 as number, longitude: 0 as number })],
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true },
    ...overrides,
  };
}

describe('TriageInvestigationBoard', () => {
  it('renders selected cluster summary, evidence cards, no-location hint, and inspect CTA', async () => {
    const onInspect = vi.fn();
    const onSelectReport = vi.fn();

    render(
      <TriageInvestigationBoard
        items={[cluster({})]}
        selectedItem={cluster({})}
        selectedReportId={10}
        role="NATIONAL_VALIDATOR"
        claiming={null}
        onInspect={onInspect}
        onSelectItem={vi.fn()}
        onSelectReport={onSelectReport}
        onClaimCluster={vi.fn()}
      />,
    );

    expect(screen.getByText('Cluster #42')).toBeInTheDocument();
    expect(screen.getByText(/Life safety/)).toBeInTheDocument();
    expect(screen.getByTestId('triage-evidence-card-10')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/No usable location/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));
    expect(onInspect).toHaveBeenCalledWith(cluster({}));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/frontend && npx vitest run src/components/triage/TriageInvestigationBoard.test.tsx
```

Expected: FAIL because `TriageInvestigationBoard` does not exist.

- [ ] **Step 3: Implement map wrapper**

Create `src/frontend/src/components/triage/TriageCanvasMap.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import type { TriageClusterEntry } from '@/lib/api';
import type { TriageItemIdentity } from './triageGeometry';

const TriageCanvasMapInner = dynamic(() => import('./TriageCanvasMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[min(68vh,680px)] min-h-[420px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
      Loading triage map...
    </div>
  ),
});

export interface TriageCanvasMapProps {
  items: TriageClusterEntry[];
  selectedIdentity: TriageItemIdentity | null;
  selectedReportId: number | null;
  onSelectItem: (item: TriageClusterEntry) => void;
  onSelectReport: (reportId: number) => void;
}

export function TriageCanvasMap(props: TriageCanvasMapProps) {
  return <TriageCanvasMapInner {...props} />;
}
```

- [ ] **Step 4: Implement map inner**

Create `src/frontend/src/components/triage/TriageCanvasMapInner.tsx`:

```tsx
'use client';

import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import {
  deriveClusterGeometry,
  getTriageItemIdentity,
  isValidPhilippinesCoordinate,
  type TriageItemIdentity,
} from './triageGeometry';

interface TriageCanvasMapInnerProps {
  items: TriageClusterEntry[];
  selectedIdentity: TriageItemIdentity | null;
  selectedReportId: number | null;
  onSelectItem: (item: TriageClusterEntry) => void;
  onSelectReport: (reportId: number) => void;
}

function severityColor(severity: string): string {
  if (severity === 'HIGH') return '#b91c1c';
  if (severity === 'MEDIUM') return '#ea580c';
  return '#64748b';
}

function sameIdentity(a: TriageItemIdentity | null, b: TriageItemIdentity | null): boolean {
  return Boolean(a && b && a.type === b.type && a.id === b.id);
}

function offsetForIndex(value: number): [number, number] {
  const ring = value % 6;
  const delta = 0.00008;
  return [Math.cos(ring) * delta, Math.sin(ring) * delta];
}

export default function TriageCanvasMapInner({
  items,
  selectedIdentity,
  selectedReportId,
  onSelectItem,
  onSelectReport,
}: TriageCanvasMapInnerProps) {
  return (
    <MapContainer
      center={[12.8, 121.8]}
      zoom={6}
      style={{ height: 'min(68vh, 680px)', minHeight: '420px', width: '100%', borderRadius: '0.75rem' }}
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {items.map((item) => {
        const identity = getTriageItemIdentity(item);
        const selected = sameIdentity(identity, selectedIdentity);
        const geometry = deriveClusterGeometry(item);
        const isCluster = identity?.type === 'cluster';
        const color = severityColor(item.severity);

        if (isCluster && geometry.centroid && geometry.radiusMeters) {
          return (
            <Circle
              key={`cluster-${identity.id}`}
              center={geometry.centroid}
              radius={geometry.radiusMeters}
              eventHandlers={{ click: () => onSelectItem(item) }}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: selected ? 0.35 : 0.16,
                weight: selected ? 4 : 2,
              }}
            >
              <Popup>
                <div className="text-xs min-w-[160px]">
                  <p className="font-semibold text-sm">Cluster #{identity.id}</p>
                  <p>{item.member_count} report(s) · {item.severity}</p>
                  <button type="button" className="mt-2 text-red-700 font-semibold" onClick={() => onSelectItem(item)}>
                    Select cluster
                  </button>
                </div>
              </Popup>
            </Circle>
          );
        }

        const report = item.reports[0] as TriageReportEntry | undefined;
        if (!report || !isValidPhilippinesCoordinate(report.latitude, report.longitude)) return null;
        const [latOffset, lngOffset] = offsetForIndex(report.report_id);
        const selectedReport = report.report_id === selectedReportId || selected;

        return (
          <CircleMarker
            key={`report-${report.report_id}`}
            center={[report.latitude + latOffset, report.longitude + lngOffset]}
            radius={selectedReport ? 10 : 7}
            eventHandlers={{
              click: () => {
                onSelectItem(item);
                onSelectReport(report.report_id);
              },
            }}
            pathOptions={{
              color: selectedReport ? '#7f1d1d' : color,
              fillColor: color,
              fillOpacity: selectedReport ? 0.95 : 0.72,
              weight: selectedReport ? 4 : 2,
            }}
          >
            <Popup>
              <div className="text-xs min-w-[150px]">
                <p className="font-semibold text-sm">Report #{report.report_id}</p>
                <p>{report.category ?? 'Unclassified'}{report.sub_category ? ` / ${report.sub_category}` : ''}</p>
                <button type="button" className="mt-2 text-red-700 font-semibold" onClick={() => onSelectReport(report.report_id)}>
                  Select report
                </button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
```

- [ ] **Step 5: Implement investigation board**

Create `src/frontend/src/components/triage/TriageInvestigationBoard.tsx`:

```tsx
'use client';

import { AlertTriangle, ClipboardList, Clock, ShieldCheck } from 'lucide-react';
import type { TriageClusterEntry } from '@/lib/api';
import { TriageEvidenceCard } from './TriageEvidenceCard';
import { deriveClusterGeometry, getTriageItemIdentity, sortTriageItemsByPriority } from './triageGeometry';

interface TriageInvestigationBoardProps {
  items: TriageClusterEntry[];
  selectedItem: TriageClusterEntry | null;
  selectedReportId: number | null;
  role: string | null;
  claiming: number | null;
  onInspect: (item: TriageClusterEntry) => void;
  onSelectItem: (item: TriageClusterEntry) => void;
  onSelectReport: (reportId: number) => void;
  onClaimCluster: (clusterId: number) => void;
}

export function TriageInvestigationBoard({
  items,
  selectedItem,
  selectedReportId,
  role,
  claiming,
  onInspect,
  onSelectItem,
  onSelectReport,
  onClaimCluster,
}: TriageInvestigationBoardProps) {
  const selectedIdentity = selectedItem ? getTriageItemIdentity(selectedItem) : null;
  const geometry = selectedItem ? deriveClusterGeometry(selectedItem) : null;
  const ranked = sortTriageItemsByPriority(items).slice(0, 8);
  const canClaim =
    role === 'NATIONAL_VALIDATOR' &&
    selectedIdentity?.type === 'cluster' &&
    selectedItem?.cluster_id != null &&
    selectedItem.assigned_to === null;

  return (
    <aside data-testid="triage-investigation-board" className="flex h-full min-h-[420px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Investigation board</p>
        {selectedItem && selectedIdentity ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-950">
                {selectedIdentity.type === 'cluster' ? `Cluster #${selectedIdentity.id}` : `Report #${selectedIdentity.id}`}
              </h2>
              <p className="text-sm text-slate-600">
                {selectedItem.member_count} report(s) · {selectedItem.station.name ?? 'No station'} · trust {Math.round(selectedItem.avg_trust)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-800"
              onClick={() => onInspect(selectedItem)}
            >
              Inspect / Act
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Select a cluster or report on the map to inspect evidence.</p>
        )}
      </div>

      {selectedItem && (
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-700">{selectedItem.severity}</span>
            {selectedItem.has_life_safety && <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 font-bold text-red-800"><AlertTriangle className="h-3 w-3" /> Life safety</span>}
            {selectedItem.is_timeout_risk && <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 font-bold text-amber-800"><Clock className="h-3 w-3" /> Timeout risk</span>}
            {geometry?.invalidReports.length ? <span className="rounded-md bg-slate-200 px-2 py-1 font-bold text-slate-700">{geometry.invalidReports.length} no usable location</span> : null}
          </div>
          {canClaim && selectedItem.cluster_id != null && (
            <button
              type="button"
              disabled={claiming === selectedItem.cluster_id}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => onClaimCluster(selectedItem.cluster_id!)}
            >
              <ShieldCheck className="h-3 w-3" /> Claim cluster
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selectedItem ? (
          <div className="space-y-3">
            {selectedItem.reports.map((report) => (
              <TriageEvidenceCard
                key={report.report_id}
                report={report}
                selected={report.report_id === selectedReportId}
                onClick={onSelectReport}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Choose a marker or ranked item to begin.
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
          <ClipboardList className="h-4 w-4 text-red-700" /> Ranked queue
        </div>
        <div className="space-y-2">
          {ranked.map((item) => {
            const identity = getTriageItemIdentity(item);
            if (!identity) return null;
            const selected = selectedIdentity?.type === identity.type && selectedIdentity.id === identity.id;
            return (
              <button
                key={`${identity.type}-${identity.id}`}
                type="button"
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selected ? 'border-red-700 bg-red-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                onClick={() => onSelectItem(item)}
              >
                <span className="font-bold text-slate-950">{identity.type === 'cluster' ? `Cluster #${identity.id}` : `Report #${identity.id}`}</span>
                <span className="ml-2 text-slate-500">{item.severity} · {item.member_count} report(s)</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Export map and board**

Append to `src/frontend/src/components/triage/index.ts`:

```ts
export { TriageCanvasMap } from './TriageCanvasMap';
export type { TriageCanvasMapProps } from './TriageCanvasMap';
export { TriageInvestigationBoard } from './TriageInvestigationBoard';
```

- [ ] **Step 7: Run tests**

```bash
cd src/frontend && npx vitest run src/components/triage/TriageInvestigationBoard.test.tsx src/components/triage/triageGeometry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/src/components/triage/TriageCanvasMap.tsx src/frontend/src/components/triage/TriageCanvasMapInner.tsx src/frontend/src/components/triage/TriageInvestigationBoard.tsx src/frontend/src/components/triage/TriageInvestigationBoard.test.tsx src/frontend/src/components/triage/index.ts
git commit -m "feat(triage): add map canvas and investigation board"
```

---

### Task 3: Replace Page Tables with Spatial Workspace

**Files:**
- Modify: `src/frontend/src/app/incidents/triage/page.tsx`
- Modify: `src/frontend/src/app/incidents/triage/page.test.tsx`

**Interfaces:**
- Consumes Task 2 `TriageCanvasMap`, `TriageInvestigationBoard`, and Task 1 identity/sort helpers.
- Produces page-owned selection state and explicit `Inspect / Act` modal open flow.

- [ ] **Step 1: Update page tests to assert the new workspace contract**

In `src/frontend/src/app/incidents/triage/page.test.tsx`, add a mock for new map component near existing mocks:

```tsx
vi.mock('@/components/triage/TriageCanvasMap', () => ({
  TriageCanvasMap: ({ items, onSelectItem }: { items: TriageClusterEntry[]; onSelectItem: (item: TriageClusterEntry) => void }) => (
    <div data-testid="triage-canvas-map">
      {items.map((item) => (
        <button
          key={item.cluster_id ?? item.anchor_report_id ?? item.reports[0]?.report_id}
          type="button"
          onClick={() => onSelectItem(item)}
        >
          Select {item.cluster_id != null ? `cluster ${item.cluster_id}` : `report ${item.reports[0]?.report_id}`}
        </button>
      ))}
    </div>
  ),
}));
```

Replace table-specific tests with these tests:

```tsx
it('renders map canvas and investigation board instead of table-first sections', async () => {
  const { default: TriagePage } = await import('./page');
  render(<TriagePage />);

  expect(await screen.findByTestId('triage-canvas-map')).toBeInTheDocument();
  expect(screen.getByTestId('triage-investigation-board')).toBeInTheDocument();
  expect(screen.queryByTestId('clusters-table')).not.toBeInTheDocument();
  expect(screen.queryByTestId('singletons-table')).not.toBeInTheDocument();
});

it('selecting a map item updates the board without opening the modal', async () => {
  const { default: TriagePage } = await import('./page');
  render(<TriagePage />);

  await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));

  expect(screen.getByText('Cluster #1')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('opens inspection modal only from Inspect Act CTA', async () => {
  const { default: TriagePage } = await import('./page');
  render(<TriagePage />);

  await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
  await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));

  await waitFor(() => {
    expect(document.getElementById('triage-modal-title')?.textContent).toBe('Cluster 1');
  });
});
```

Keep modal behavior tests for Escape, Close, tab navigation, split/merge visibility, and two-step confirmation. Only update selectors if the modal rail relocation changes accessible names.

- [ ] **Step 2: Run page test to verify failures**

```bash
cd src/frontend && npx vitest run src/app/incidents/triage/page.test.tsx
```

Expected: FAIL because `page.tsx` still renders table sections and does not render `TriageCanvasMap` / `TriageInvestigationBoard`.

- [ ] **Step 3: Update page imports and state**

In `src/frontend/src/app/incidents/triage/page.tsx`, add imports:

```tsx
import {
  TriageCanvasMap,
  TriageInvestigationBoard,
  getTriageItemIdentity,
  sortTriageItemsByPriority,
  type TriageItemIdentity,
} from '@/components/triage';
```

Add page state after existing `openCluster` / `inspectionMode` state:

```tsx
const [selectedIdentity, setSelectedIdentity] = useState<TriageItemIdentity | null>(null);
const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
```

- [ ] **Step 4: Add selection helpers in page**

Add these functions before `openInspection`:

```tsx
function selectTriageItem(item: TriageClusterEntry) {
  const identity = getTriageItemIdentity(item);
  if (!identity) return;
  setSelectedIdentity(identity);
  setSelectedReportId(item.reports[0]?.report_id ?? null);
  setSelectionNotice(null);
}

function inspectSelectedItem(item: TriageClusterEntry) {
  const identity = getTriageItemIdentity(item);
  if (!identity) return;
  setSelectedIdentity(identity);
  setSelectedReportId(item.reports[0]?.report_id ?? null);
  void openInspection(item, identity.type);
}
```

Add derived selected item after sorted arrays:

```tsx
const allTriageItems = useMemo(() => {
  return sortTriageItemsByPriority([...sortedClusters, ...filteredSingletons]);
}, [sortedClusters, filteredSingletons]);

const selectedItem = useMemo(() => {
  if (!selectedIdentity) return allTriageItems[0] ?? null;
  return allTriageItems.find((item) => {
    const identity = getTriageItemIdentity(item);
    return identity?.type === selectedIdentity.type && identity.id === selectedIdentity.id;
  }) ?? null;
}, [allTriageItems, selectedIdentity]);
```

Add refresh selection repair:

```tsx
useEffect(() => {
  if (allTriageItems.length === 0) {
    setSelectedIdentity(null);
    setSelectedReportId(null);
    return;
  }

  if (!selectedIdentity) {
    const firstIdentity = getTriageItemIdentity(allTriageItems[0]);
    setSelectedIdentity(firstIdentity);
    setSelectedReportId(allTriageItems[0].reports[0]?.report_id ?? null);
    return;
  }

  const stillExists = allTriageItems.some((item) => {
    const identity = getTriageItemIdentity(item);
    return identity?.type === selectedIdentity.type && identity.id === selectedIdentity.id;
  });

  if (!stillExists) {
    const next = allTriageItems[0];
    setSelectedIdentity(getTriageItemIdentity(next));
    setSelectedReportId(next.reports[0]?.report_id ?? null);
    setSelectionNotice('Selected triage item changed after refresh. Showing the next highest-priority item.');
  }
}, [allTriageItems, selectedIdentity]);
```

- [ ] **Step 5: Replace table sections with workspace JSX**

Replace the two table blocks (`data-testid="clusters-table"` and `data-testid="singletons-table"`) with:

```tsx
{selectionNotice && (
  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
    {selectionNotice}
  </div>
)}

{loading ? (
  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
    <div className="flex h-[min(68vh,680px)] min-h-[420px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
      <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading investigation board...</div>
  </div>
) : allTriageItems.length === 0 ? (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600">
    No civilian reports matching current filters.
  </div>
) : (
  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label="Civilian triage map canvas">
      <TriageCanvasMap
        items={allTriageItems}
        selectedIdentity={selectedIdentity}
        selectedReportId={selectedReportId}
        onSelectItem={selectTriageItem}
        onSelectReport={setSelectedReportId}
      />
    </section>
    <TriageInvestigationBoard
      items={allTriageItems}
      selectedItem={selectedItem}
      selectedReportId={selectedReportId}
      role={role}
      claiming={claiming}
      onInspect={inspectSelectedItem}
      onSelectItem={selectTriageItem}
      onSelectReport={setSelectedReportId}
      onClaimCluster={(clusterId) => void claimCluster(clusterId)}
    />
  </div>
)}
```

- [ ] **Step 6: Run page tests**

```bash
cd src/frontend && npx vitest run src/app/incidents/triage/page.test.tsx
```

Expected: PASS after test selector updates.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/app/incidents/triage/page.tsx src/frontend/src/app/incidents/triage/page.test.tsx
git commit -m "feat(triage): replace queue tables with spatial workspace"
```

---

### Task 4: Refit Modal into Spatial / Evidence / Action Layout

**Files:**
- Create: `src/frontend/src/components/triage/TriageSpatialPanel.tsx`
- Create: `src/frontend/src/components/triage/TriageSpatialPanelInner.tsx`
- Modify: `src/frontend/src/components/triage/TriageInspectionModal.tsx`
- Modify: `src/frontend/src/components/triage/ReportsListPanel.tsx`
- Modify: `src/frontend/src/components/triage/triage-modal.css`
- Modify: modal-related tests in `src/frontend/src/app/incidents/triage/page.test.tsx` if selectors need updates

**Interfaces:**
- Consumes Task 1 geometry helpers and evidence card.
- Produces modal three-panel body: spatial panel, evidence panel, action rail with relocated tabs.

- [ ] **Step 1: Add failing modal assertions**

In `src/frontend/src/app/incidents/triage/page.test.tsx`, add:

```tsx
it('renders cluster modal with spatial, evidence, and action panels', async () => {
  const { default: TriagePage } = await import('./page');
  render(<TriagePage />);

  await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
  await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));

  expect(await screen.findByTestId('triage-spatial-panel')).toBeInTheDocument();
  expect(screen.getByTestId('triage-evidence-panel')).toBeInTheDocument();
  expect(screen.getByTestId('triage-action-rail')).toBeInTheDocument();
  expect(screen.getByTestId('triage-action-tabs')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run page test to verify it fails**

```bash
cd src/frontend && npx vitest run src/app/incidents/triage/page.test.tsx -t "renders cluster modal with spatial"
```

Expected: FAIL because `triage-spatial-panel`, `triage-evidence-panel`, and `triage-action-rail` do not exist.

- [ ] **Step 3: Implement modal spatial wrapper**

Create `src/frontend/src/components/triage/TriageSpatialPanel.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import type { TriageClusterEntry } from '@/lib/api';

const TriageSpatialPanelInner = dynamic(() => import('./TriageSpatialPanelInner'), {
  ssr: false,
  loading: () => (
    <div data-testid="triage-spatial-panel" className="flex h-full min-h-[280px] items-center justify-center bg-slate-100 text-sm text-slate-500">
      Loading report map...
    </div>
  ),
});

export interface TriageSpatialPanelProps {
  cluster: TriageClusterEntry;
  selectedReportId: number | null;
  suggestedReportIds: number[];
  inspectionMode: 'cluster' | 'singleton';
  onSelectReport: (reportId: number) => void;
}

export function TriageSpatialPanel(props: TriageSpatialPanelProps) {
  return <TriageSpatialPanelInner {...props} />;
}
```

- [ ] **Step 4: Implement modal spatial inner with invalidateSize**

Create `src/frontend/src/components/triage/TriageSpatialPanelInner.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import type { TriageClusterEntry } from '@/lib/api';
import { firePinIcon } from '@/components/map/leafletIcons';
import { deriveClusterGeometry } from './triageGeometry';

interface TriageSpatialPanelInnerProps {
  cluster: TriageClusterEntry;
  selectedReportId: number | null;
  suggestedReportIds: number[];
  inspectionMode: 'cluster' | 'singleton';
  onSelectReport: (reportId: number) => void;
}

function InvalidateSizeOnMount() {
  const map = useMap();
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  }, [map]);
  return null;
}

export default function TriageSpatialPanelInner({
  cluster,
  selectedReportId,
  suggestedReportIds,
  inspectionMode,
  onSelectReport,
}: TriageSpatialPanelInnerProps) {
  const geometry = deriveClusterGeometry(cluster);
  const center = geometry.centroid ?? [14.5995, 120.9842];
  const suggestedSet = new Set(suggestedReportIds);

  return (
    <div data-testid="triage-spatial-panel" className="triage-spatial-panel">
      <div className="triage-spatial-panel__header">
        <span>{inspectionMode === 'cluster' ? 'Cluster spatial spread' : 'Report location'}</span>
        {geometry.invalidReports.length > 0 && <strong>{geometry.invalidReports.length} no usable location</strong>}
      </div>
      <MapContainer center={center} zoom={14} style={{ height: '100%', minHeight: '320px', width: '100%' }} zoomControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <InvalidateSizeOnMount />
        {inspectionMode === 'cluster' && geometry.centroid && geometry.radiusMeters && (
          <Circle
            center={geometry.centroid}
            radius={geometry.radiusMeters}
            pathOptions={{ color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.08, weight: 2 }}
          />
        )}
        {geometry.validReports.map(({ report, lat, lng }) => (
          <Marker
            key={report.report_id}
            position={[lat, lng]}
            icon={firePinIcon}
            zIndexOffset={report.report_id === selectedReportId ? 1000 : suggestedSet.has(report.report_id) ? 500 : 0}
            title={`#${report.report_id}`}
            eventHandlers={{ click: () => onSelectReport(report.report_id) }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
```

- [ ] **Step 5: Refit modal JSX**

In `src/frontend/src/components/triage/TriageInspectionModal.tsx`, import `TriageSpatialPanel`:

```tsx
import { TriageSpatialPanel } from './TriageSpatialPanel';
```

Replace the current body structure:

```tsx
<div className="triage-modal__body">
  <aside className="triage-modal__rail">...</aside>
  <main className="triage-modal__center">...</main>
  <aside className="triage-modal__right">...</aside>
</div>
```

with:

```tsx
<div className="triage-modal__body">
  <aside className="triage-modal__spatial">
    <TriageSpatialPanel
      cluster={openCluster}
      selectedReportId={state.correctionReportId ?? reportIds[0] ?? null}
      suggestedReportIds={state.mergeCandidates.map((candidate) => candidate.anchor_report_id).filter((id): id is number => typeof id === 'number')}
      inspectionMode={inspectionMode}
      onSelectReport={(reportId) => {
        state.setSelected((current) => {
          const next = new Set(current);
          if (next.has(reportId)) next.delete(reportId);
          else next.add(reportId);
          return next;
        });
      }}
    />
  </aside>

  <main className="triage-modal__center" data-testid="triage-evidence-panel">
    <ReportsListPanel
      cluster={openCluster}
      inspectionMode={inspectionMode}
      selected={state.selected}
      onToggle={state.toggleReport}
      onStartCorrection={state.startCorrection}
      suggestedReportIds={state.mergeCandidates.map((candidate) => candidate.anchor_report_id).filter((id): id is number => typeof id === 'number')}
    />
  </main>

  <aside className="triage-modal__right" data-testid="triage-action-rail">
    <div className="triage-action-rail__tabs">
      <TriageActionTabs
        tab={state.tab}
        setTab={state.setTab}
        inspectionMode={inspectionMode}
        selectedCount={reportIds.length}
        totalCount={openCluster.reports.length}
        correctionReportId={state.correctionReportId}
        mergeCandidateCount={state.mergeCandidates.length}
      />
    </div>
    {/* keep the existing active action panel rendering below this line */}
  </aside>
</div>
```

When editing, move only the existing `TriageActionTabs` JSX into the right rail. Do not change the action panel switch, confirmation logic, Escape handling, or mutation calls.

- [ ] **Step 6: Update modal CSS grid**

In `src/frontend/src/components/triage/triage-modal.css`, update these selectors:

```css
.triage-modal__panel {
  width: min(95vw, 1600px);
  max-width: 1600px;
  height: min(90vh, 920px);
  max-height: calc(100vh - 2rem);
}

.triage-modal__body {
  display: grid;
  grid-template-columns: minmax(300px, 0.4fr) minmax(360px, 0.35fr) minmax(320px, 0.25fr);
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.triage-modal__spatial {
  background: #f8fafc;
  border-right: 1px solid #E5DCC9;
  min-width: 0;
  overflow: hidden;
}

.triage-spatial-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.triage-spatial-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid #E5DCC9;
  background: #fff;
  color: #334155;
  font-size: 0.78rem;
  font-weight: 700;
}

.triage-action-rail__tabs {
  border-bottom: 1px solid #E5DCC9;
  background: #F8F4ED;
  padding: 0.6rem;
}

@media (max-width: 1100px) {
  .triage-modal__body {
    grid-template-columns: 1fr;
  }

  .triage-modal__spatial {
    min-height: 320px;
    border-right: 0;
    border-bottom: 1px solid #E5DCC9;
  }

  .triage-modal__center,
  .triage-modal__right {
    border-right: 0;
  }
}
```

Remove or override the old mobile rule that hides `.triage-modal__rail, .triage-modal__right`. The action rail must remain reachable on smaller screens.

- [ ] **Step 7: Run modal/page tests**

```bash
cd src/frontend && npx vitest run src/app/incidents/triage/page.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/src/components/triage/TriageSpatialPanel.tsx src/frontend/src/components/triage/TriageSpatialPanelInner.tsx src/frontend/src/components/triage/TriageInspectionModal.tsx src/frontend/src/components/triage/ReportsListPanel.tsx src/frontend/src/components/triage/triage-modal.css src/frontend/src/app/incidents/triage/page.test.tsx
git commit -m "feat(triage): refit inspection modal with spatial panel"
```

---

### Task 5: Regression, Accessibility, and Documentation

**Files:**
- Modify: `system-wiki/frontend/route-map.md`
- Modify: `system-wiki/operations/civilian-triage-hci-polish.md`
- Modify: `system-wiki/log.md` if this repo's current wiki convention requires an entry for the implementation date

**Interfaces:**
- Consumes all previous tasks.
- Produces verified implementation and updated project-local documentation.

- [ ] **Step 1: Run focused frontend checks**

```bash
cd src/frontend && npx vitest run src/components/triage/triageGeometry.test.ts src/components/triage/TriageInvestigationBoard.test.tsx src/app/incidents/triage/page.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run lint**

```bash
cd src/frontend && npm run lint
```

Expected: PASS or existing warnings only. Any new lint error from triage files must be fixed before proceeding.

- [ ] **Step 3: Run full frontend test suite**

```bash
cd src/frontend && npx vitest run
```

Expected: PASS. If failures are unrelated and pre-existing, capture exact failing test names and output before asking for guidance.

- [ ] **Step 4: Update route map documentation**

In `system-wiki/frontend/route-map.md`, replace the `/incidents/triage` description with:

```md
| `/incidents/triage` | `incidents/triage/page.tsx` | Phase 2 civilian triage queue using `/api/triage/queue`, claim, cluster inspection, and terminal actions. The page is a map-first spatial triage workspace with a civilian triage canvas, investigation board, ranked queue fallback, and explicit `Inspect / Act` transition into the modal. The inspection modal at `components/triage/` is a large guarded action console with spatial panel, report evidence panel, and action rail. Terminal / Correct / Split / Merge / Activity behavior keeps two-step destructive confirmation, citizen-message previews, and the no-commit-keyboard-shortcut policy; see `frontend/validator-triage-shortcuts` and `operations/civilian-triage-hci-polish`. |
```

- [ ] **Step 5: Update HCI polish documentation**

Append to `system-wiki/operations/civilian-triage-hci-polish.md` before `## Related Files`:

```md
## Phase E — Spatial Triage Workspace

The queue page now uses a map-first triage canvas paired with an investigation board. Selecting a cluster or singleton marker updates the board without opening the modal. The modal opens only through the explicit `Inspect / Act` CTA.

The inspection modal is retained as the guarded action surface. Its body is refit into three regions:

1. spatial panel with derived cluster centroid/spread or singleton location
2. report evidence panel using shared evidence cards
3. action rail with Terminal / Correct / Split / Merge / Activity controls and existing confirmation safeguards

Cluster geometry is derived client-side from valid report coordinates. Reports with invalid or missing runtime coordinates remain visible in evidence/list surfaces and are omitted from map markers with a `No usable location` hint.
```

- [ ] **Step 6: Commit docs and verification fixes**

```bash
git add system-wiki/frontend/route-map.md system-wiki/operations/civilian-triage-hci-polish.md system-wiki/log.md src/frontend
git commit -m "docs: record civilian triage spatial workspace"
```

Only include `system-wiki/log.md` if it was actually modified.

---

## Final Verification Checklist

- [ ] `cd src/frontend && npx vitest run src/components/triage/triageGeometry.test.ts src/components/triage/TriageInvestigationBoard.test.tsx src/app/incidents/triage/page.test.tsx` passes.
- [ ] `cd src/frontend && npm run lint` passes or reports only pre-existing warnings.
- [ ] `cd src/frontend && npx vitest run` passes or unrelated pre-existing failures are documented.
- [ ] `git status --short` reviewed.
- [ ] `system-wiki/frontend/route-map.md` updated.
- [ ] `system-wiki/operations/civilian-triage-hci-polish.md` updated.

## Self-Review Notes

Spec coverage:

- Page map-first canvas: Task 2 + Task 3.
- Investigation board and explicit `Inspect / Act`: Task 2 + Task 3.
- Modal retained and refit with spatial/evidence/action columns: Task 4.
- Action safeguards preserved: Task 4 tests plus existing modal tests.
- Client-derived centroid/spread and runtime coordinate guards: Task 1.
- React Leaflet SSR/dynamic import and modal `invalidateSize()`: Task 2 + Task 4.
- Page tests rewritten and modal tests preserved: Task 3 + Task 4.
- Docs updated: Task 5.

No placeholders intentionally remain. If implementers discover type mismatches in existing `useTriageModalState` setter names, adjust only the local callback wiring and keep the task's interface names stable.
