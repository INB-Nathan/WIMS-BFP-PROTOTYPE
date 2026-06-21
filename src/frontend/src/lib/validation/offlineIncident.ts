/**
 * Offline payload validation for regional incident create/update ops.
 *
 * Per D10: Validate payload before encryption (queue write) and before replay
 * (sync deque). Uses the same Zod schemas as the server-side API, so a payload
 * that passes here is guaranteed to survive the server's Pydantic validation.
 *
 * All three call sites (offlineStore.queue, offlineStore.update, syncEngine.replay)
 * use the single validateOfflinePayload() helper below — no duplicate functions.
 */

import { incidentCreateSchema, incidentUpdateSchema } from "./regionalIncident";

/**
 * Validate an offline op's payload against the appropriate Zod schema.
 *
 * @param op       Object with `operation` and `payload` fields (satisfied by
 *                 OfflineOpDecrypted in syncEngine or the parameter objects in
 *                 offlineStore.ts queueOfflineOp/updateOfflineOp).
 * @param phase    "encrypt" (pre-write) or "replay" (pre-sync). Used only for
 *                 the error message — the same schema is applied either way.
 *
 * Throws Error with joined Zod issue messages on validation failure.
 * Callers are expected to catch and surface. syncEngine wraps this in try/catch;
 * offlineStore lets it propagate to the UI hook layer (offlineRegionalActions
 * catches via the caller's own error boundary).
 */
export function validateOfflinePayload(
  op: { operation: string; payload: Record<string, unknown> },
  phase: "encrypt" | "replay",
): void {
  if (op.operation !== "create" && op.operation !== "update") return;
  const schema = op.operation === "create" ? incidentCreateSchema : incidentUpdateSchema;
  const result = schema.safeParse(op.payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid offline payload before ${phase}: ${issues}`);
  }
}
