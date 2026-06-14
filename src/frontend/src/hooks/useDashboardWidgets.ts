/**
 * useDashboardWidgets — localStorage-backed widget configuration hook.
 *
 * Reads/writes the ordered widget ID array for the current role.
 * Falls back to sensible defaults when no config exists in localStorage.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { DEFAULT_WIDGETS, WIDGET_STORAGE_KEY, type WidgetDefinition, availableWidgetsForRole } from "@/components/dashboard/widget-definitions";

export interface WidgetConfig {
  widgets: string[];
  addWidget: (id: string) => void;
  removeWidget: (id: string) => void;
  resetToDefaults: () => void;
  availableAdditions: WidgetDefinition[];
}

function loadWidgets(role: string | null): string[] {
  if (!role) return [];
  try {
    const raw = typeof window !== "undefined"
      ? localStorage.getItem(WIDGET_STORAGE_KEY)
      : null;
    if (raw) {
      const allConfigs = JSON.parse(raw) as Record<string, string[]>;
      if (Array.isArray(allConfigs[role])) {
        return allConfigs[role];
      }
    }
  } catch {
    // corrupted storage — fall through to defaults
  }
  return [...(DEFAULT_WIDGETS[role] ?? [])];
}

function saveWidgets(role: string | null, ids: string[]): void {
  if (!role || typeof window === "undefined") return;
  try {
    let allConfigs: Record<string, string[]> = {};
    const raw = localStorage.getItem(WIDGET_STORAGE_KEY);
    if (raw) {
      try { allConfigs = JSON.parse(raw) as Record<string, string[]>; } catch { /* start fresh */ }
    }
    allConfigs[role] = ids;
    localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(allConfigs));
  } catch {
    // storage quota exceeded or unavailable — silently fail
  }
}

/**
 * Hook for managing user-customizable dashboard widgets.
 *
 * @param role - The current user's role (e.g., "NATIONAL_VALIDATOR")
 */
export function useDashboardWidgets(role: string | null): WidgetConfig {
  const [widgets, setWidgets] = useState<string[]>(() => loadWidgets(role));

  // Sync when role changes
  useEffect(() => {
    setWidgets(loadWidgets(role));
  }, [role]);

  const addWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        saveWidgets(role, next);
        return next;
      });
    },
    [role],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        const next = prev.filter((w) => w !== id);
        saveWidgets(role, next);
        return next;
      });
    },
    [role],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = [...(DEFAULT_WIDGETS[role ?? ""] ?? [])];
    setWidgets(defaults);
    saveWidgets(role, defaults);
  }, [role]);

  const available = availableWidgetsForRole(role);
  const addedIds = new Set(widgets);
  const availableAdditions = available.filter((w) => !addedIds.has(w.id));

  return {
    widgets,
    addWidget,
    removeWidget,
    resetToDefaults,
    availableAdditions,
  };
}
