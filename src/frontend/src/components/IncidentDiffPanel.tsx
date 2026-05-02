"use client";

import type { IncidentDiffResponse } from "@/lib/api";

// Human-readable labels for nonsensitive_details fields shown in the diff view
const FIELD_LABELS: Record<string, string> = {
  distance_from_station_km: "Distance from Station (km)",
  notification_dt: "Notification Date/Time",
  alarm_level: "Alarm Level",
  general_category: "General Category",
  sub_category: "Sub-Category",
  specific_type: "Specific Type",
  occupancy_type: "Occupancy Type",
  estimated_damage_php: "Estimated Damage (PHP)",
  civilian_injured: "Civilians Injured",
  civilian_deaths: "Civilian Deaths",
  firefighter_injured: "Firefighters Injured",
  firefighter_deaths: "Firefighter Deaths",
  families_affected: "Families Affected",
  water_tankers_used: "Water Tankers Used",
  foam_liters_used: "Foam Used (L)",
  breathing_apparatus_used: "Breathing Apparatus Used",
  responder_type: "Responder Type",
  fire_origin: "Fire Origin",
  extent_of_damage: "Extent of Damage",
  structures_affected: "Structures Affected",
  households_affected: "Households Affected",
  individuals_affected: "Individuals Affected",
  fire_station_name: "Fire Station",
  total_response_time_minutes: "Response Time (min)",
  total_gas_consumed_liters: "Gas Consumed (L)",
  stage_of_fire: "Stage of Fire on Arrival",
  extent_total_floor_area_sqm: "Floor Area (sqm)",
  extent_total_land_area_hectares: "Land Area (ha)",
  vehicles_affected: "Vehicles Affected",
  recommendations: "Recommendations",
  longitude: "Longitude",
  latitude: "Latitude",
};

const REASON_LABELS: Record<string, string> = {
  REJECTED: "Rejected version",
  UPDATE_EXISTING_PENDING: "Previous pending version",
  SUPERSEDES_VERIFIED: "Verified incident",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface Props {
  diff: IncidentDiffResponse;
}

export default function IncidentDiffPanel({ diff }: Props) {
  if (!diff.diff_available || !diff.original || !diff.current) return null;

  const { original, current, changed_fields = [], snapshot_reason } = diff;
  const changedSet = new Set(changed_fields);

  const allKeys = Array.from(
    new Set([...Object.keys(original), ...Object.keys(current)])
  ).filter((k) => k in FIELD_LABELS);

  const changedKeys = allKeys.filter((k) => changedSet.has(k));
  const unchangedKeys = allKeys.filter((k) => !changedSet.has(k));
  const displayKeys = [...changedKeys, ...unchangedKeys];

  const beforeLabel = REASON_LABELS[snapshot_reason ?? ""] ?? "Before";

  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-yellow-700 font-semibold text-sm">
          This incident has been revised — review changes before deciding.
        </span>
        {changed_fields.length > 0 && (
          <span className="text-xs text-yellow-600 bg-yellow-100 border border-yellow-300 rounded px-2 py-0.5">
            {changed_fields.length} field{changed_fields.length !== 1 ? "s" : ""} changed
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-yellow-200">
              <th className="text-left py-2 pr-4 font-medium text-gray-600 w-1/4">Field</th>
              <th className="text-left py-2 pr-4 font-medium text-gray-600 w-3/8">
                {beforeLabel}
              </th>
              <th className="text-left py-2 font-medium text-gray-600 w-3/8">After (submitted)</th>
            </tr>
          </thead>
          <tbody>
            {displayKeys.map((key) => {
              const isChanged = changedSet.has(key);
              const rowClass = isChanged
                ? "bg-yellow-100 border-l-4 border-yellow-400"
                : "";
              return (
                <tr key={key} className={`border-b border-yellow-100 last:border-0 ${rowClass}`}>
                  <td className="py-1.5 pr-4 font-medium text-gray-700 pl-1">
                    {FIELD_LABELS[key] ?? key}
                  </td>
                  <td className={`py-1.5 pr-4 ${isChanged ? "text-red-700 line-through decoration-red-400" : "text-gray-600"}`}>
                    {formatValue(original[key])}
                  </td>
                  <td className={`py-1.5 ${isChanged ? "text-green-700 font-medium" : "text-gray-600"}`}>
                    {formatValue(current[key])}
                  </td>
                </tr>
              );
            })}
            {displayKeys.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-center text-gray-500">
                  No field-level changes detected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
