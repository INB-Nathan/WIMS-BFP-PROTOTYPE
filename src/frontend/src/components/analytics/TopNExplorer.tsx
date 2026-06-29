"use client";

import type { TopNItem } from '@/lib/api';
import { ArrowRight, ListChecks, MapPinned } from 'lucide-react';
import { TopNTable, formatTopNValue, getTopNSampleDetail } from './TopNTable';
import { getTopNDimensionLabel, type TopNDimension } from '@/lib/topNDrilldown';

export interface TopNExplorerProps {
  data: TopNItem[];
  metric: string;
  dimension: TopNDimension;
  selectedName?: string | null;
  onSelect: (name: string) => void;
  onShowMatchingIncidents: () => void;
  onViewOnMap: () => void;
  drilldownActive?: boolean;
  emptyMessage?: string;
}

function formatDelta(metric: string, value: number): string {
  if (metric === 'damage_cost') {
    return `₱${Math.abs(value).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
  }
  if (metric === 'response_time') {
    return `${Math.abs(value).toFixed(1)} min`;
  }
  return Math.abs(value).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

export function TopNExplorer({
  data,
  metric,
  dimension,
  selectedName,
  onSelect,
  onShowMatchingIncidents,
  onViewOnMap,
  drilldownActive = false,
  emptyMessage,
}: TopNExplorerProps) {
  if (!data || data.length === 0) {
    return <TopNTable data={data} metric={metric} emptyMessage={emptyMessage} />;
  }

  const selectedItem = data.find((item) => item.name === selectedName) ?? data[0];
  const selectedIndex = data.findIndex((item) => item.name === selectedItem.name);
  const leader = data[0];
  const previous = selectedIndex > 0 ? data[selectedIndex - 1] : null;
  const totalValue = data.reduce((sum, item) => sum + (typeof item.value === 'number' ? item.value : 0), 0);
  const shareOfVisibleTotal = totalValue > 0 && typeof selectedItem.value === 'number'
    ? (selectedItem.value / totalValue) * 100
    : null;
  const leaderGap = typeof selectedItem.value === 'number' && typeof leader.value === 'number'
    ? leader.value - selectedItem.value
    : null;
  const previousGap = previous && typeof selectedItem.value === 'number' && typeof previous.value === 'number'
    ? previous.value - selectedItem.value
    : null;
  const sampleDetail = getTopNSampleDetail(metric, selectedItem);
  const dimensionLabel = getTopNDimensionLabel(dimension);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Ranked hotspots</h3>
            <p className="text-xs text-gray-500">Select a ranked {dimensionLabel.toLowerCase()} to inspect matching incidents or pivot to map review.</p>
          </div>
        </div>
        <TopNTable
          data={data}
          metric={metric}
          selectedName={selectedItem.name}
          onSelect={onSelect}
          emptyMessage={emptyMessage}
        />
      </div>

      <aside className="rounded-lg border border-gray-200 bg-gray-50/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected hotspot</div>
            <h3 className="mt-1 text-lg font-bold text-gray-900">{selectedItem.name || 'Unspecified'}</h3>
            <p className="mt-1 text-sm text-gray-500">{dimensionLabel} ranked #{selectedIndex + 1} in the current Top-N result.</p>
          </div>
          {drilldownActive && (
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
              Evidence focused
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Metric value</div>
            <div className="mt-1 text-xl font-bold text-gray-900">{formatTopNValue(metric, selectedItem.value)}</div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Share of visible Top-N</div>
            <div className="mt-1 text-xl font-bold text-gray-900">{shareOfVisibleTotal == null ? 'N/A' : `${shareOfVisibleTotal.toFixed(1)}%`}</div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Gap vs leader</div>
            <div className="mt-1 text-xl font-bold text-gray-900">{leaderGap == null ? 'N/A' : leaderGap === 0 ? 'Leader' : formatDelta(metric, leaderGap)}</div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Gap vs previous</div>
            <div className="mt-1 text-xl font-bold text-gray-900">{previousGap == null ? 'N/A' : formatDelta(metric, previousGap)}</div>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Comparison note</div>
          <p className="mt-1 text-sm text-gray-700">
            {selectedIndex === 0
              ? `This ${dimensionLabel.toLowerCase()} currently leads the Top-N result and sets the benchmark for all lower-ranked hotspots.`
              : `This ${dimensionLabel.toLowerCase()} trails ${leader.name} by ${leaderGap == null ? 'an unavailable amount' : formatDelta(metric, leaderGap)} and sits ${previousGap == null ? 'just below the next rank' : `${formatDelta(metric, previousGap)} behind ${previous?.name}`}.`}
          </p>
          {sampleDetail && <p className="mt-2 text-xs font-medium text-gray-500">{sampleDetail}</p>}
          {selectedItem.incident_count != null && metric !== 'response_time' && (
            <p className="mt-2 text-xs font-medium text-gray-500">{selectedItem.incident_count.toLocaleString()} incidents contribute to this hotspot.</p>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onShowMatchingIncidents}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: '#991B1B' }}
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Show matching incidents
          </button>
          <button
            type="button"
            onClick={onViewOnMap}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <MapPinned className="h-4 w-4" aria-hidden="true" />
            View on map
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>Use <strong>Show matching incidents</strong> to narrow the evidence table to this {dimensionLabel.toLowerCase()}, or <strong>View on map</strong> to open the heatmap workflow with the same drilldown.</span>
        </div>
      </aside>
    </div>
  );
}
