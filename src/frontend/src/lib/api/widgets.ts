/**
 * Dashboard widget API client.
 *
 * Fetches lightweight widget data from GET /api/dashboard/widgets?ids=...
 */

import { apiFetch } from "./transport";

export interface WidgetCountData {
  count: number;
}

export interface WidgetCategoryData {
  categories: Array<{ label: string; count: number }>;
}

export interface WidgetErrorData {
  error: string;
}

export type WidgetData = WidgetCountData | WidgetCategoryData | WidgetErrorData;

export type WidgetDataMap = Record<string, WidgetData>;

/**
 * Fetch widget data for a set of widget IDs.
 *
 * The backend returns only data for widgets available to the user's role.
 * Unavailable or non-existent widget IDs are silently omitted.
 */
export async function fetchWidgetData(ids: string[]): Promise<WidgetDataMap> {
  if (ids.length === 0) return {};
  const qs = new URLSearchParams();
  qs.set("ids", ids.join(","));
  const data = await apiFetch<WidgetDataMap>(`/dashboard/widgets?${qs.toString()}`);
  return data ?? {};
}

/** Check if a widget data object is a count response. */
export function isCountData(data: WidgetData): data is WidgetCountData {
  return typeof (data as WidgetCountData).count === "number";
}

/** Check if a widget data object is a categories response. */
export function isCategoryData(data: WidgetData): data is WidgetCategoryData {
  return Array.isArray((data as WidgetCategoryData).categories);
}

/** Check if a widget data object represents an error. */
export function isErrorData(data: WidgetData): data is WidgetErrorData {
  return typeof (data as WidgetErrorData).error === "string";
}
