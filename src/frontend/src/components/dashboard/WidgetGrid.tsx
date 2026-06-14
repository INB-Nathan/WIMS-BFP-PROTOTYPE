"use client";

import { useEffect, useState, useRef } from "react";
import { fetchWidgetData, type WidgetDataMap } from "@/lib/api/widgets";
import { widgetById } from "./widget-definitions";
import { WidgetCard } from "./WidgetCard";

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
 *
 * Grid layout: 2 cols mobile, 3 cols tablet, 4 cols desktop.
 */
export function WidgetGrid({ widgetIds, role, onRemoveWidget }: WidgetGridProps) {
  const [dataMap, setDataMap] = useState<WidgetDataMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Create a stable key for the current widget set to detect changes
    const idsKey = widgetIds.join(",");
    if (idsKey === "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on empty
      setDataMap({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchWidgetData(widgetIds)
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        setDataMap(result);
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard widgets");
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [widgetIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!role || widgetIds.length === 0) {
    return null;
  }

  if (error && !loading && Object.keys(dataMap).length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
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
  );
}
