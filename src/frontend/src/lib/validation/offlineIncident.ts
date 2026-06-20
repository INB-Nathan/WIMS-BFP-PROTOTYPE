/**
 * Offline validation schemas for regional incident create/update/verify/correct/bulk-approve ops.
 *
 * Per D10: Validate payload before encryption (queue write) and before replay (sync).
 * These schemas are stricter than the main schemas because offline payloads must
 * be safe to encrypt and later replay against the server without unexpected failures.
 */

import { z } from "zod";
import {
  incidentCreateSchema,
  incidentUpdateSchema,
  verificationActionSchema,
  correctionSchema,
  bulkApproveSchema,
} from "./regionalIncident";

// ═══════════════════════════════════════════════════════════════════════════
// Offline operation validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for offline create operation payloads.
 * Used before encrypt (write) and before replay (sync deque).
 */
export const offlineCreateSchema = incidentCreateSchema;

/**
 * Schema for offline update operation payloads.
 * Used before encrypt (write) and before replay (sync deque).
 */
export const offlineUpdateSchema = incidentUpdateSchema;

/**
 * Schema for offline verify action payloads.
 */
export const offlineVerifySchema = verificationActionSchema;

/**
 * Schema for offline correction payloads.
 */
export const offlineCorrectionSchema = correctionSchema;

/**
 * Schema for offline bulk-approve payloads.
 */
export const offlineBulkApproveSchema = bulkApproveSchema;

// ═══════════════════════════════════════════════════════════════════════════
// Replay validation
// ═══════════════════════════════════════════════════════════════════════════

type OfflineOperation =
  | "create"
  | "update"
  | "verify"
  | "correct"
  | "bulk_approve";

const offlineSchemaMap: Record<OfflineOperation, z.ZodTypeAny> = {
  create: offlineCreateSchema,
  update: offlineUpdateSchema,
  verify: offlineVerifySchema,
  correct: offlineCorrectionSchema,
  bulk_approve: offlineBulkApproveSchema,
};

/**
 * Validate a decrypted offline payload before replay.
 * Returns the validated payload or throws with a descriptive error.
 * Used in syncEngine.ts when dequeuing pending ops.
 */
export function validateOfflinePayloadForReplay(
  operation: OfflineOperation,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const schema = offlineSchemaMap[operation];
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Offline ${operation} payload validation failed before replay: ${issues}`
    );
  }
  return result.data as Record<string, unknown>;
}

/**
 * Validate a payload before encrypting it for the offline queue.
 * Used in offlineStore.ts queueOfflineOp / updateOfflineOp.
 */
export function validateOfflinePayloadBeforeEncrypt(
  operation: OfflineOperation,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const schema = offlineSchemaMap[operation];
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Offline ${operation} payload validation failed before encrypt: ${issues}`
    );
  }
  return result.data as Record<string, unknown>;
}
