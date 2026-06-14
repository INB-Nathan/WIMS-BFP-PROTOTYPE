/**
 * Widget definitions for customizable dashboards (issue #235).
 *
 * Each widget has:
 * - id: unique widget identifier (shared with backend endpoint)
 * - label: human-readable title
 * - roles: set of roles that can use this widget
 * - defaultIcon: lucide icon name to use in the card
 * - isCategorical: true if the widget returns categories[] instead of count
 */

import {
  Flame,
  Users,
  CheckCircle,
  Activity,
  BarChart3,
  XCircle,
  FileText,
  CalendarDays,
  Clock,
  AlertTriangle,
  MapPin,
  type LucideIcon,
} from "lucide-react";

export interface WidgetDefinition {
  id: string;
  label: string;
  roles: ReadonlySet<string>;
  icon: LucideIcon;
  isCategorical: boolean;
}

// ── National Validator widgets ────────────────────────────────────────────────
const awaiting_validation: WidgetDefinition = {
  id: "awaiting_validation",
  label: "Awaiting Validation",
  roles: new Set(["NATIONAL_VALIDATOR"]),
  icon: Clock,
  isCategorical: false,
};
const citizen_reports: WidgetDefinition = {
  id: "citizen_reports",
  label: "Citizen Reports",
  roles: new Set(["NATIONAL_VALIDATOR"]),
  icon: Users,
  isCategorical: false,
};
const verified_today: WidgetDefinition = {
  id: "verified_today",
  label: "Verified Today",
  roles: new Set(["NATIONAL_VALIDATOR"]),
  icon: CheckCircle,
  isCategorical: false,
};
const active_operations: WidgetDefinition = {
  id: "active_operations",
  label: "Active Operations",
  roles: new Set(["NATIONAL_VALIDATOR"]),
  icon: Activity,
  isCategorical: false,
};
const by_category_v: WidgetDefinition = {
  id: "by_category",
  label: "By Category",
  roles: new Set(["NATIONAL_VALIDATOR", "REGIONAL_ENCODER", "NATIONAL_ANALYST", "SYSTEM_ADMIN"]),
  icon: BarChart3,
  isCategorical: true,
};
const rejected: WidgetDefinition = {
  id: "rejected",
  label: "Rejected",
  roles: new Set(["NATIONAL_VALIDATOR"]),
  icon: XCircle,
  isCategorical: false,
};

// ── Regional Encoder widgets ──────────────────────────────────────────────────
const total_incidents: WidgetDefinition = {
  id: "total_incidents",
  label: "Total Incidents",
  roles: new Set(["REGIONAL_ENCODER", "NATIONAL_ANALYST", "SYSTEM_ADMIN"]),
  icon: Flame,
  isCategorical: false,
};
const drafts: WidgetDefinition = {
  id: "drafts",
  label: "Drafts",
  roles: new Set(["REGIONAL_ENCODER"]),
  icon: FileText,
  isCategorical: false,
};
const submitted_today: WidgetDefinition = {
  id: "submitted_today",
  label: "Submitted Today",
  roles: new Set(["REGIONAL_ENCODER"]),
  icon: CalendarDays,
  isCategorical: false,
};
const pending_validation: WidgetDefinition = {
  id: "pending_validation",
  label: "Pending Validation",
  roles: new Set(["REGIONAL_ENCODER"]),
  icon: Clock,
  isCategorical: false,
};
const by_alarm_level: WidgetDefinition = {
  id: "by_alarm_level",
  label: "By Alarm Level",
  roles: new Set(["REGIONAL_ENCODER"]),
  icon: AlertTriangle,
  isCategorical: true,
};

// ── National Analyst widgets ───────────────────────────────────────────────────
const verified_month: WidgetDefinition = {
  id: "verified_month",
  label: "Verified This Month",
  roles: new Set(["NATIONAL_ANALYST", "SYSTEM_ADMIN"]),
  icon: CalendarDays,
  isCategorical: false,
};
const by_region: WidgetDefinition = {
  id: "by_region",
  label: "By Region (Top 5)",
  roles: new Set(["NATIONAL_ANALYST", "SYSTEM_ADMIN"]),
  icon: MapPin,
  isCategorical: true,
};
const avg_response_time: WidgetDefinition = {
  id: "avg_response_time",
  label: "Avg Response Time",
  roles: new Set(["NATIONAL_ANALYST", "SYSTEM_ADMIN"]),
  icon: Activity,
  isCategorical: false,
};

/** All widget definitions indexed by role for quick lookup. */
export const ALL_WIDGETS: WidgetDefinition[] = [
  awaiting_validation,
  citizen_reports,
  verified_today,
  active_operations,
  by_category_v,
  rejected,
  total_incidents,
  drafts,
  submitted_today,
  pending_validation,
  by_alarm_level,
  verified_month,
  by_region,
  avg_response_time,
];

/** Deduplicated widget definitions keyed by id. */
export const WIDGETS_BY_ID: Map<string, WidgetDefinition> = new Map(
  ALL_WIDGETS.map((w) => [w.id, w]),
);

/** Default widget layout per role. */
export const DEFAULT_WIDGETS: Record<string, string[]> = {
  NATIONAL_VALIDATOR: [
    "awaiting_validation",
    "citizen_reports",
    "active_operations",
    "by_category",
  ],
  REGIONAL_ENCODER: [
    "total_incidents",
    "drafts",
    "submitted_today",
    "by_category",
  ],
  ENCODER: [
    "total_incidents",
    "drafts",
    "submitted_today",
    "by_category",
  ],
  NATIONAL_ANALYST: [
    "total_incidents",
    "verified_month",
    "by_region",
    "by_category",
  ],
  SYSTEM_ADMIN: [
    "total_incidents",
    "verified_month",
    "by_region",
    "by_category",
  ],
};

/** localStorage key for widget configuration. */
export const WIDGET_STORAGE_KEY = "wims:dashboard:widgets";

/** Get available widget IDs for a role. */
export function availableWidgetsForRole(role: string | null): WidgetDefinition[] {
  if (!role) return [];
  return ALL_WIDGETS.filter((w) => w.roles.has(role));
}

/** Get a widget definition by id. */
export function widgetById(id: string): WidgetDefinition | undefined {
  return WIDGETS_BY_ID.get(id);
}
