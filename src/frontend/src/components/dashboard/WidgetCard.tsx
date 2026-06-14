"use client";

import { useEffect, useState, useRef } from "react";
import { X } from "lucide-react";
import { fetchWidgetData, isCountData, isCategoryData, isErrorData, type WidgetData } from "@/lib/api/widgets";
import type { WidgetDefinition } from "./widget-definitions";

export interface WidgetCardProps {
  widget: WidgetDefinition;
  onRemove?: (id: string) => void;
  /** All active widget IDs — the card fetches its own data independently */
  data?: WidgetData;
  loading?: boolean;
  error?: string | null;
}

/**
 * A single dashboard widget card.
 *
 * Each widget fetches its data independently via GET /api/dashboard/widgets.
 * Displays loading skeleton, count value, categorical breakdown, or error state.
 */
export function WidgetCard({ widget, onRemove, data, loading, error }: WidgetCardProps) {
  const IconComp = widget.icon;

  if (loading) {
    return (
      <div
        className="bg-white rounded-2xl p-4 flex flex-col gap-3 animate-pulse"
        style={{ boxShadow: "var(--card-shadow)", border: "1px solid var(--border-color)" }}
      >
        <div className="w-10 h-10 rounded-xl bg-gray-200" />
        <div>
          <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
          <div className="h-6 w-12 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="bg-white rounded-2xl p-4 flex flex-col gap-3"
        style={{ boxShadow: "var(--card-shadow)", border: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center justify-between">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <IconComp className="w-5 h-5 text-red-400" />
          </div>
          {onRemove && (
            <button
              onClick={() => onRemove(widget.id)}
              className="p-1 rounded-md hover:bg-gray-100 transition-colors"
              aria-label={`Remove ${widget.label} widget`}
              title={`Remove ${widget.label}`}
            >
              <X className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
            </button>
          )}
        </div>
        <div>
          <div className="text-xs font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>
            {widget.label}
          </div>
          <div className="text-xs italic" style={{ color: "var(--text-muted)" }}>
            Error loading data
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  if (isErrorData(data)) {
    return (
      <div
        className="bg-white rounded-2xl p-4 flex flex-col gap-3"
        style={{ boxShadow: "var(--card-shadow)", border: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center justify-between">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <IconComp className="w-5 h-5 text-red-400" />
          </div>
          {onRemove && (
            <button
              onClick={() => onRemove(widget.id)}
              className="p-1 rounded-md hover:bg-gray-100 transition-colors"
              aria-label={`Remove ${widget.label} widget`}
            >
              <X className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
            </button>
          )}
        </div>
        <div>
          <div className="text-xs font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>
            {widget.label}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Error</div>
        </div>
      </div>
    );
  }

  if (isCountData(data)) {
    return (
      <div
        className="bg-white rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
        style={{ boxShadow: "var(--card-shadow)", border: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center justify-between">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#FEE2E2" }}
          >
            <IconComp className="w-5 h-5" style={{ color: "#991B1B" }} />
          </div>
          {onRemove && (
            <button
              onClick={() => onRemove(widget.id)}
              className="p-1 rounded-md hover:bg-gray-100 transition-colors"
              aria-label={`Remove ${widget.label} widget`}
              title={`Remove ${widget.label}`}
            >
              <X className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
            </button>
          )}
        </div>
        <div>
          <div className="text-xs font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>
            {widget.label}
          </div>
          <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {data.count.toLocaleString()}
          </div>
        </div>
      </div>
    );
  }

  if (isCategoryData(data)) {
    const total = data.categories.reduce((sum, c) => sum + c.count, 0);
    return (
      <div
        className="bg-white rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
        style={{ boxShadow: "var(--card-shadow)", border: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center justify-between">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#FEE2E2" }}
          >
            <IconComp className="w-5 h-5" style={{ color: "#991B1B" }} />
          </div>
          {onRemove && (
            <button
              onClick={() => onRemove(widget.id)}
              className="p-1 rounded-md hover:bg-gray-100 transition-colors"
              aria-label={`Remove ${widget.label} widget`}
              title={`Remove ${widget.label}`}
            >
              <X className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
            </button>
          )}
        </div>
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            {widget.label}
          </div>
          <div className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
            {total.toLocaleString()}
          </div>
          <div className="space-y-1">
            {data.categories.slice(0, 5).map((cat) => (
              <div key={cat.label} className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--text-secondary)" }}>{cat.label}</span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {cat.count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Self-fetching wrapper ─────────────────────────────────────────────────────

export interface SelfFetchingWidgetCardProps {
  widget: WidgetDefinition;
  onRemove?: (id: string) => void;
}

/**
 * A WidgetCard that fetches its own data on mount.
 * Used when the parent doesn't batch-fetch widget data.
 */
export function SelfFetchingWidgetCard({ widget, onRemove }: SelfFetchingWidgetCardProps) {
  const [data, setData] = useState<WidgetData | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-triggered loading
    setLoading(true);
    setError(null);

    fetchWidgetData([widget.id])
      .then((result) => {
        if (!mountedRef.current) return;
        const widgetData = result[widget.id];
        if (widgetData) {
          setData(widgetData);
        } else {
          setError("No data returned");
        }
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => {
      mountedRef.current = false;
    };
  }, [widget.id]);

  return (
    <WidgetCard
      widget={widget}
      onRemove={onRemove}
      data={data}
      loading={loading}
      error={error}
    />
  );
}
