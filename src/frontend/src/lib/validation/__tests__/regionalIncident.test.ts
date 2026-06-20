/**
 * Tests for regional incident Zod validation schemas.
 *
 * Mirrors backend schema tests in test_regional_schema_validation.py.
 *
 * Run: cd src/frontend && npx vitest run src/lib/validation/__tests__/regionalIncident.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  incidentCreateSchema,
  incidentUpdateSchema,
  verificationActionSchema,
  correctionSchema,
  bulkApproveSchema,
} from "../regionalIncident";
import {
  validateOfflinePayloadForReplay,
  validateOfflinePayloadBeforeEncrypt,
} from "../offlineIncident";

// ═══════════════════════════════════════════════════════════════════════════
// VerificationActionSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("verificationActionSchema", () => {
  // ── Action enum validation ─────────────────────────────────────────────

  it.each(["accept", "accept_replace", "pending", "reject"])(
    "accepts valid action: %s",
    (action) => {
      const r = verificationActionSchema.safeParse({ action });
      expect(r.success).toBe(true);
    }
  );

  it.each(["", "approve", "deny", "maybe", "ACCEPT", 123])(
    "rejects invalid action: %s",
    (action) => {
      const r = verificationActionSchema.safeParse({ action });
      expect(r.success).toBe(false);
    }
  );

  it("rejects missing action", () => {
    const r = verificationActionSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  // ── Notes max_length ───────────────────────────────────────────────────

  it("accepts notes at max length (2000)", () => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      notes: "x".repeat(2000),
    });
    expect(r.success).toBe(true);
  });

  it("rejects notes exceeding max length", () => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      notes: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it("accepts null notes", () => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      notes: null,
    });
    expect(r.success).toBe(true);
  });

  // ── original_incident_id validation ────────────────────────────────────

  it.each([0, 1, 100])("accepts original_incident_id: %i", (val) => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      original_incident_id: val,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative original_incident_id", () => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      original_incident_id: -1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts null original_incident_id", () => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      original_incident_id: null,
    });
    expect(r.success).toBe(true);
  });

  // ── client_id ──────────────────────────────────────────────────────────

  it("accepts null client_id", () => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      client_id: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts valid UUID client_id", () => {
    const r = verificationActionSchema.safeParse({
      action: "accept",
      client_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CorrectionSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("correctionSchema", () => {
  it("accepts valid corrections dict", () => {
    const r = correctionSchema.safeParse({
      corrections: { alarm_level: "5th Alarm" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts empty corrections dict", () => {
    const r = correctionSchema.safeParse({ corrections: {} });
    expect(r.success).toBe(true);
  });

  it("rejects missing corrections", () => {
    const r = correctionSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects corrections as non-dict", () => {
    const r = correctionSchema.safeParse({ corrections: "not-a-dict" });
    expect(r.success).toBe(false);
  });

  it("accepts notes at max length", () => {
    const r = correctionSchema.safeParse({
      corrections: { alarm_level: "5th Alarm" },
      notes: "x".repeat(2000),
    });
    expect(r.success).toBe(true);
  });

  it("rejects notes exceeding max length", () => {
    const r = correctionSchema.safeParse({
      corrections: { alarm_level: "5th Alarm" },
      notes: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it("accepts null notes", () => {
    const r = correctionSchema.safeParse({
      corrections: { alarm_level: "5th Alarm" },
      notes: null,
    });
    expect(r.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BulkApproveSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("bulkApproveSchema", () => {
  it("accepts list of positive ints", () => {
    const r = bulkApproveSchema.safeParse({ incident_ids: [1, 2, 3] });
    expect(r.success).toBe(true);
  });

  it("accepts single positive int", () => {
    const r = bulkApproveSchema.safeParse({ incident_ids: [42] });
    expect(r.success).toBe(true);
  });

  it("rejects empty list", () => {
    const r = bulkApproveSchema.safeParse({ incident_ids: [] });
    expect(r.success).toBe(false);
  });

  it.each([0, -1, -100])("rejects non-positive value: %i", (val) => {
    const r = bulkApproveSchema.safeParse({ incident_ids: [val] });
    expect(r.success).toBe(false);
  });

  it("rejects mix of positive and zero", () => {
    const r = bulkApproveSchema.safeParse({ incident_ids: [1, 0, 3] });
    expect(r.success).toBe(false);
  });

  it("rejects missing incident_ids", () => {
    const r = bulkApproveSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts notes at max length", () => {
    const r = bulkApproveSchema.safeParse({
      incident_ids: [1, 2, 3],
      notes: "x".repeat(2000),
    });
    expect(r.success).toBe(true);
  });

  it("rejects notes exceeding max length", () => {
    const r = bulkApproveSchema.safeParse({
      incident_ids: [1, 2, 3],
      notes: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it("accepts null notes", () => {
    const r = bulkApproveSchema.safeParse({
      incident_ids: [1, 2, 3],
      notes: null,
    });
    expect(r.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Offline validation — verify / correct / bulk_approve
// ═══════════════════════════════════════════════════════════════════════════

describe("validateOfflinePayloadBeforeEncrypt — verify/correct/bulk_approve", () => {
  it("validates a valid verify payload", () => {
    const payload = { action: "accept", notes: "Looks good" };
    const result = validateOfflinePayloadBeforeEncrypt("verify", payload);
    expect(result.action).toBe("accept");
  });

  it("throws on invalid verify payload", () => {
    const payload = { action: "BAD_ACTION" };
    expect(() => validateOfflinePayloadBeforeEncrypt("verify", payload)).toThrow(
      /Offline verify payload validation failed/
    );
  });

  it("validates a valid correct payload", () => {
    const payload = { corrections: { alarm_level: "5th Alarm" } };
    const result = validateOfflinePayloadBeforeEncrypt("correct", payload);
    expect(result.corrections).toEqual({ alarm_level: "5th Alarm" });
  });

  it("throws on invalid correct payload (non-dict corrections)", () => {
    const payload = { corrections: "not-a-dict" };
    expect(() => validateOfflinePayloadBeforeEncrypt("correct", payload)).toThrow(
      /Offline correct payload validation failed/
    );
  });

  it("validates a valid bulk_approve payload", () => {
    const payload = { incident_ids: [1, 2, 3] };
    const result = validateOfflinePayloadBeforeEncrypt("bulk_approve", payload);
    expect(result.incident_ids).toEqual([1, 2, 3]);
  });

  it("throws on invalid bulk_approve payload (empty list)", () => {
    const payload = { incident_ids: [] };
    expect(() => validateOfflinePayloadBeforeEncrypt("bulk_approve", payload)).toThrow(
      /Offline bulk_approve payload validation failed/
    );
  });
});

describe("validateOfflinePayloadForReplay — verify/correct/bulk_approve", () => {
  it("validates a valid verify payload before replay", () => {
    const payload = { action: "reject", notes: "Duplicate" };
    const result = validateOfflinePayloadForReplay("verify", payload);
    expect(result.action).toBe("reject");
  });

  it("throws on invalid verify payload before replay", () => {
    const payload = { action: "invalid_action" };
    expect(() => validateOfflinePayloadForReplay("verify", payload)).toThrow(
      /Offline verify payload validation failed before replay/
    );
  });

  it("validates a valid correct payload before replay", () => {
    const payload = { corrections: { civilian_injured: 5 } };
    const result = validateOfflinePayloadForReplay("correct", payload);
    expect(result.corrections).toEqual({ civilian_injured: 5 });
  });

  it("throws on invalid correct payload before replay", () => {
    const payload = { corrections: null };
    expect(() => validateOfflinePayloadForReplay("correct", payload)).toThrow(
      /Offline correct payload validation failed before replay/
    );
  });

  it("validates a valid bulk_approve payload before replay", () => {
    const payload = { incident_ids: [10, 20] };
    const result = validateOfflinePayloadForReplay("bulk_approve", payload);
    expect(result.incident_ids).toEqual([10, 20]);
  });

  it("throws on invalid bulk_approve payload before replay (empty)", () => {
    const payload = { incident_ids: [] };
    expect(() => validateOfflinePayloadForReplay("bulk_approve", payload)).toThrow(
      /Offline bulk_approve payload validation failed before replay/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Offline validation — create / update (existing)
// ═══════════════════════════════════════════════════════════════════════════

describe("validateOfflinePayloadBeforeEncrypt", () => {
  it("validates a valid create payload", () => {
    const payload = { latitude: 14.5995, longitude: 120.9842, civilian_injured: 2 };
    const result = validateOfflinePayloadBeforeEncrypt("create", payload);
    expect(result.latitude).toBe(14.5995);
  });

  it("throws on invalid create payload", () => {
    const payload = { latitude: 999, longitude: 120.9842 };
    expect(() => validateOfflinePayloadBeforeEncrypt("create", payload)).toThrow(
      /Offline create payload validation failed/
    );
  });

  it("validates a valid update payload", () => {
    const payload = { civilian_injured: 5 };
    const result = validateOfflinePayloadBeforeEncrypt("update", payload);
    expect(result.civilian_injured).toBe(5);
  });

  it("throws on invalid update payload", () => {
    const payload = { civilian_injured: -1 };
    expect(() => validateOfflinePayloadBeforeEncrypt("update", payload)).toThrow(
      /Offline update payload validation failed/
    );
  });
});

describe("validateOfflinePayloadForReplay", () => {
  it("validates a valid create payload before replay", () => {
    const payload = { latitude: 14.5995, longitude: 120.9842 };
    const result = validateOfflinePayloadForReplay("create", payload);
    expect(result.latitude).toBe(14.5995);
  });

  it("throws on invalid create payload before replay", () => {
    const payload = { latitude: 999, longitude: 120.9842 };
    expect(() => validateOfflinePayloadForReplay("create", payload)).toThrow(
      /Offline create payload validation failed before replay/
    );
  });

  it("throws on invalid update payload before replay", () => {
    const payload = { latitude: 999 };
    expect(() => validateOfflinePayloadForReplay("update", payload)).toThrow(
      /Offline update payload validation failed before replay/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IncidentCreateSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("incidentCreateSchema", () => {
  // ── Coordinate bounds ──────────────────────────────────────────────────

  it("accepts valid latitude", () => {
    const r = incidentCreateSchema.safeParse({ latitude: 14.5995, longitude: 120.9842 });
    expect(r.success).toBe(true);
  });

  it.each([-90, 0, 90])("accepts latitude boundary: %f", (lat) => {
    const r = incidentCreateSchema.safeParse({ latitude: lat, longitude: 120.9842 });
    expect(r.success).toBe(true);
  });

  it.each([-90.1, 90.1, 999, -999])("rejects out-of-bounds latitude: %f", (lat) => {
    const r = incidentCreateSchema.safeParse({ latitude: lat, longitude: 120.9842 });
    expect(r.success).toBe(false);
  });

  it.each([-180, 0, 180])("accepts longitude boundary: %f", (lon) => {
    const r = incidentCreateSchema.safeParse({ latitude: 14.5995, longitude: lon });
    expect(r.success).toBe(true);
  });

  it.each([-180.1, 180.1, 999])("rejects out-of-bounds longitude: %f", (lon) => {
    const r = incidentCreateSchema.safeParse({ latitude: 14.5995, longitude: lon });
    expect(r.success).toBe(false);
  });

  // ── Non-negative numerics ──────────────────────────────────────────────

  it.each(["civilian_injured", "civilian_deaths", "firefighter_injured",
    "firefighter_deaths", "families_affected", "structures_affected",
    "households_affected", "individuals_affected"])(
    "accepts non-negative %s",
    (field) => {
      const r = incidentCreateSchema.safeParse({
        latitude: 14.5995, longitude: 120.9842, [field]: 5,
      });
      expect(r.success).toBe(true);
    }
  );

  it.each(["civilian_injured", "civilian_deaths", "firefighter_injured",
    "firefighter_deaths", "families_affected", "structures_affected",
    "households_affected", "individuals_affected"])(
    "rejects negative %s",
    (field) => {
      const r = incidentCreateSchema.safeParse({
        latitude: 14.5995, longitude: 120.9842, [field]: -1,
      });
      expect(r.success).toBe(false);
    }
  );

  it("accepts non-negative estimated_damage_php", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, estimated_damage_php: 1000.50,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative estimated_damage_php", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, estimated_damage_php: -1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts non-negative distance_from_station_km", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, distance_from_station_km: 5.2,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative distance_from_station_km", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, distance_from_station_km: -0.1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts non-negative total_response_time_minutes", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, total_response_time_minutes: 30,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative total_response_time_minutes", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, total_response_time_minutes: -1,
    });
    expect(r.success).toBe(false);
  });

  // ── Defaults ───────────────────────────────────────────────────────────

  it("defaults counts to 0", () => {
    const r = incidentCreateSchema.parse({ latitude: 14.5995, longitude: 120.9842 });
    expect(r.civilian_injured).toBe(0);
    expect(r.civilian_deaths).toBe(0);
    expect(r.firefighter_injured).toBe(0);
    expect(r.firefighter_deaths).toBe(0);
  });

  // ── String max_length ──────────────────────────────────────────────────

  it.each([
    ["alarm_level", 255],
    ["general_category", 255],
    ["fire_station_name", 255],
    ["caller_name", 255],
    ["street_address", 255],
    ["recommendations", 2000],
    ["narrative_report", 10000],
  ])("accepts %s at max length %d", (field, limit) => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, [field]: "x".repeat(limit),
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["alarm_level", 255],
    ["general_category", 255],
    ["fire_station_name", 255],
    ["caller_name", 255],
    ["street_address", 255],
    ["recommendations", 2000],
  ])("rejects %s exceeding max length %d", (field, limit) => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, [field]: "x".repeat(limit + 1),
    });
    expect(r.success).toBe(false);
  });

  // ── Date validation ────────────────────────────────────────────────────

  it("accepts recent past notification_dt", () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, notification_dt: past,
    });
    expect(r.success).toBe(true);
  });

  it("accepts notification_dt within 5-min tolerance", () => {
    const nearFuture = new Date(Date.now() + 240000).toISOString(); // 4 min
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, notification_dt: nearFuture,
    });
    expect(r.success).toBe(true);
  });

  it("rejects notification_dt beyond 5-min tolerance", () => {
    const farFuture = new Date(Date.now() + 600000).toISOString(); // 10 min
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, notification_dt: farFuture,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-ISO notification_dt", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, notification_dt: "not-a-date",
    });
    expect(r.success).toBe(false);
  });

  it("accepts null notification_dt", () => {
    const r = incidentCreateSchema.safeParse({
      latitude: 14.5995, longitude: 120.9842, notification_dt: null,
    });
    expect(r.success).toBe(true);
  });

  // ── Missing required fields ────────────────────────────────────────────

  it("rejects missing latitude", () => {
    const r = incidentCreateSchema.safeParse({ longitude: 120.9842 });
    expect(r.success).toBe(false);
  });

  it("rejects missing longitude", () => {
    const r = incidentCreateSchema.safeParse({ latitude: 14.5995 });
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IncidentUpdateSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("incidentUpdateSchema", () => {
  // ── Empty update passes ────────────────────────────────────────────────

  it("accepts empty object (all optional)", () => {
    const r = incidentUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  // ── Coordinate bounds ──────────────────────────────────────────────────

  it.each([-90, 0, 90])("accepts latitude boundary: %f", (lat) => {
    const r = incidentUpdateSchema.safeParse({ latitude: lat });
    expect(r.success).toBe(true);
  });

  it.each([-90.1, 90.1, 999])("rejects out-of-bounds latitude: %f", (lat) => {
    const r = incidentUpdateSchema.safeParse({ latitude: lat });
    expect(r.success).toBe(false);
  });

  it("accepts null latitude", () => {
    const r = incidentUpdateSchema.safeParse({ latitude: null });
    expect(r.success).toBe(true);
  });

  // ── Non-negative numerics ──────────────────────────────────────────────

  it.each([
    "civilian_injured", "civilian_deaths", "firefighter_injured",
    "firefighter_deaths", "families_affected", "structures_affected",
    "households_affected", "individuals_affected", "vehicles_affected",
  ])("rejects negative %s", (field) => {
    const r = incidentUpdateSchema.safeParse({ [field]: -1 });
    expect(r.success).toBe(false);
  });

  it.each([
    "civilian_injured", "civilian_deaths", "firefighter_injured",
    "firefighter_deaths", "families_affected", "structures_affected",
    "households_affected", "individuals_affected", "vehicles_affected",
  ])("accepts null %s", (field) => {
    const r = incidentUpdateSchema.safeParse({ [field]: null });
    expect(r.success).toBe(true);
  });

  // ── Date validation ────────────────────────────────────────────────────

  it("rejects notification_dt beyond 5-min tolerance", () => {
    const farFuture = new Date(Date.now() + 600000).toISOString();
    const r = incidentUpdateSchema.safeParse({ notification_dt: farFuture });
    expect(r.success).toBe(false);
  });

  it("accepts null notification_dt", () => {
    const r = incidentUpdateSchema.safeParse({ notification_dt: null });
    expect(r.success).toBe(true);
  });

  // ── force_update defaults ──────────────────────────────────────────────

  it("defaults force_update to false", () => {
    const r = incidentUpdateSchema.parse({});
    expect(r.force_update).toBe(false);
  });
});
