/**
 * Shared Zod validation schemas for regional incident create/update payloads.
 *
 * Mirrors backend Pydantic constraints in src/backend/schemas/regional.py:
 * - D4 string length tiers: 255 (labels), 2000 (descriptions), 10000 (narratives)
 * - D11 semantic date validation: no future dates beyond 5-min clock-skew tolerance
 * - Coordinate bounds: lat [-90,90], lon [-180,180]
 * - Non-negative numeric bounds: ge=0 on counts/casualties/damage/response-time/distance
 *
 * Use z.infer<typeof incidentCreateSchema> for TypeScript types.
 */

import { z, ZodIssueCode } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

const LABEL_MAX = 255;
const DESC_MAX = 2000;
const NARRATIVE_MAX = 10000;
const D11_TOLERANCE_MINUTES = 5;

/**
 * Refinement that rejects ISO datetime strings whose value exceeds
 * `now() + toleranceMinutes` UTC. Skips null/undefined.
 */
function notFutureDate(toleranceMinutes = D11_TOLERANCE_MINUTES) {
  return (value: string | null | undefined, ctx: z.RefinementCtx) => {
    if (value == null) return;
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message: `Invalid ISO datetime string: ${value}`,
      });
      return;
    }
    const cutoff = Date.now() + toleranceMinutes * 60 * 1000;
    if (parsed.getTime() > cutoff) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message: `Date must not be more than ${toleranceMinutes} minutes in the future (got ${value})`,
      });
    }
  };
}

/** Shared coordinate field — latitude or longitude with bounds. */
const latField = z.number().gte(-90).lte(90);
const lonField = z.number().gte(-180).lte(180);

/** Common string label field (D4: 255). */
const labelField = z.string().max(LABEL_MAX).nullable().optional();

/** Common string description field (D4: 2000). */
const descField = z.string().max(DESC_MAX).nullable().optional();

/** Common string narrative field (D4: 10000). */
const narrativeField = z.string().max(NARRATIVE_MAX).nullable().optional();

/** Non-negative integer count. */
const nonNegInt = z.number().int().gte(0);

/** Non-negative optional integer. */
const nonNegIntOpt = z.number().int().gte(0).nullable().optional();

/** Non-negative optional float. */
const nonNegFloatOpt = z.number().gte(0).nullable().optional();

// ═══════════════════════════════════════════════════════════════════════════
// IncidentCreateSchema
// ═══════════════════════════════════════════════════════════════════════════

export const incidentCreateSchema = z.object({
  // Coordinates (required)
  latitude: latField,
  longitude: lonField,

  // Numeric identifiers
  region_id: z.number().int().nullable().optional(),
  city_id: z.number().int().nullable().optional(),
  parent_incident_id: z.number().int().nullable().optional(),

  // Date/time (D11)
  notification_dt: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .superRefine(notFutureDate()),

  // String labels (D4: 255)
  alarm_level: labelField,
  general_category: labelField,
  sub_category: labelField,
  specific_type: labelField,
  occupancy_type: labelField,
  responder_type: labelField,
  fire_origin: labelField,
  extent_of_damage: labelField,
  stage_of_fire: labelField,
  fire_station_name: labelField,
  province_district: labelField,
  city_municipality: labelField,
  barangay: labelField,
  incident_type_code: labelField,
  street_address: labelField,
  landmark: labelField,
  caller_name: labelField,
  caller_number: labelField,
  establishment_name: labelField,
  owner_name: labelField,
  occupant_name: labelField,
  receiver_name: labelField,
  prepared_by_officer: labelField,
  noted_by_officer: labelField,

  // String descriptions (D4: 2000)
  recommendations: descField,
  remarks: descField,

  // String narrative (D4: 10000)
  narrative_report: narrativeField,

  // Non-negative counts (defaults 0)
  civilian_injured: nonNegInt.default(0),
  civilian_deaths: nonNegInt.default(0),
  firefighter_injured: nonNegInt.default(0),
  firefighter_deaths: nonNegInt.default(0),
  families_affected: nonNegInt.default(0),
  structures_affected: nonNegInt.default(0),
  households_affected: nonNegInt.default(0),
  individuals_affected: nonNegInt.default(0),

  // Non-negative optional numerics
  distance_from_station_km: nonNegFloatOpt,
  estimated_damage_php: nonNegFloatOpt,
  total_response_time_minutes: nonNegIntOpt,

  // Idempotency
  client_id: z.string().max(LABEL_MAX).nullable().optional(),
});

export type IncidentCreate = z.infer<typeof incidentCreateSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// IncidentUpdateSchema
// ═══════════════════════════════════════════════════════════════════════════

export const incidentUpdateSchema = z.object({
  // Date/time (D11)
  notification_dt: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .superRefine(notFutureDate()),

  // String labels (D4: 255)
  alarm_level: labelField,
  general_category: labelField,
  sub_category: labelField,
  specific_type: labelField,
  occupancy_type: labelField,
  responder_type: labelField,
  fire_origin: labelField,
  extent_of_damage: labelField,
  stage_of_fire: labelField,
  general_description_of_involved: descField,
  fire_station_name: labelField,
  province_district: labelField,
  city_municipality: labelField,
  barangay: labelField,
  incident_type_code: labelField,
  street_address: labelField,
  landmark: labelField,
  caller_name: labelField,
  caller_number: labelField,
  establishment_name: labelField,
  owner_name: labelField,
  occupant_name: labelField,
  receiver_name: labelField,
  prepared_by_officer: labelField,
  noted_by_officer: labelField,
  disposition: labelField,

  // String descriptions (D4: 2000)
  recommendations: descField,
  remarks: descField,

  // String narrative (D4: 10000)
  narrative_report: narrativeField,

  // Non-negative optional counts
  civilian_injured: nonNegIntOpt,
  civilian_deaths: nonNegIntOpt,
  firefighter_injured: nonNegIntOpt,
  firefighter_deaths: nonNegIntOpt,
  families_affected: nonNegIntOpt,
  structures_affected: nonNegIntOpt,
  households_affected: nonNegIntOpt,
  individuals_affected: nonNegIntOpt,
  vehicles_affected: nonNegIntOpt,

  // Non-negative optional floats
  distance_from_station_km: nonNegFloatOpt,
  estimated_damage_php: nonNegFloatOpt,
  extent_total_floor_area_sqm: z.number().nullable().optional(),
  extent_total_land_area_hectares: z.number().nullable().optional(),
  total_response_time_minutes: nonNegIntOpt,

  // Numeric identifiers
  city_id: z.number().int().nullable().optional(),

  // Coordinates (optional on update)
  latitude: latField.nullable().optional(),
  longitude: lonField.nullable().optional(),

  // Structured blobs (no deep validation)
  alarm_timeline: z.record(z.unknown()).nullable().optional(),
  resources_deployed: z.record(z.unknown()).nullable().optional(),
  problems_encountered: z.array(z.unknown()).nullable().optional(),
  other_personnel: z.array(z.unknown()).nullable().optional(),
  personnel_on_duty: z.record(z.unknown()).nullable().optional(),
  casualty_details: z.record(z.unknown()).nullable().optional(),

  // Sync / idempotency
  client_updated_at: z.string().nullable().optional(),
  force_update: z.boolean().default(false),
});

export type IncidentUpdate = z.infer<typeof incidentUpdateSchema>;
