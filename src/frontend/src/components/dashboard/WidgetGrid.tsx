"use client";

import { useEffect, useState, useRef } from "react";
import { WifiOff } from "lucide-react";
import { fetchWidgetData, type WidgetDataMap } from "@/lib/api/widgets";
import { widgetById } from "./widget-definitions";
import { WidgetCard } from "./WidgetCard";
import { useNetworkStatus } from "@/lib/useNetworkStatus";

const WIDGET_CACHE_PREFIX = "wims:widget-cache:";

function loadCachedWidgets(role: string): WidgetDataMap | null {
  try {
    const raw = typeof window !== "undefined"
      ? localStorage.getItem(`${WIDGET_CACHE_PREFIX}${role}`)
      : null;
    return raw ? (JSON.parse(raw) as WidgetDataMap) : null;
  } catch {
    return null;
  }
}

function saveCachedWidgets(role: string, data: WidgetDataMap): void {
  try {
    localStorage.setItem(`${WIDGET_CACHE_PREFIX}${role}`, JSON.stringify(data));
  } catch {
    // storage quota — ignore
  }
}

export interface WidgetGridProps {
  widgetIds: string[];
  role: string | null;
  onRemoveWidget?: (id: string) => void;
}

/**
 * Responsive CSS grid of dashboard widgets.
 *
 * Fetches all visible widget data in a single batch request,
 * then renders independent WidgetCard components.
 * Skips the fetch entirely when offline to avoid "Failed to fetch" errors.
 *
 * Grid layout: 2 cols mobile, 3 cols tablet, 4 cols desktop.
 */
export function WidgetGrid({ widgetIds, role, onRemoveWidget }: WidgetGridProps) {
  const { isOnline } = useNetworkStatus();
  const [dataMap, setDataMap] = useState<WidgetDataMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Don't attempt network calls when offline — render already shows the offline placeholder.
    if (!isOnline) return;


    const idsKey = widgetIds.join(",");
    if (idsKey === "") return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setFromCache(false);

    fetchWidgetData(widgetIds)
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        setDataMap(result);
        // Persist fresh data so it's available when offline next time
        if (role) saveCachedWidgets(role, result);
        setFromCache(false);
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        // Network failed — try the localStorage cache before showing an error
        const cached = role ? loadCachedWidgets(role) : null;
        if (cached && Object.keys(cached).length > 0) {
          setDataMap(cached);
          setFromCache(true);
        } else {
          setError("Widget data unavailable offline");
        }
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [widgetIds.join(","), role, isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!role || widgetIds.length === 0) {
    return null;
  }

  if (!isOnline) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500 flex items-center gap-2">
        <WifiOff className="w-4 h-4 flex-shrink-0" />
        <span>Dashboard widgets are not available offline.</span>
      </div>
    );
  }

  if (error && !loading && Object.keys(dataMap).length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        {error}
      </div>
    );
  }

  return (
    <>
    {fromCache && (
      <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        Showing cached widget data — reconnect to refresh.
      </p>
    )}
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {widgetIds.map((wid) => {
        const wdef = widgetById(wid);
        if (!wdef) return null;

        return (
          <WidgetCard
            key={wid}
            widget={wdef}
            data={dataMap[wid]}
            loading={loading}
            error={!loading && !dataMap[wid] ? "No data" : null}
            onRemove={onRemoveWidget}
          />
        );
      })}
    </div>
    </>
  );
}
