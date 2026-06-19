/**
 * Validation foundation — shared error types and Zod schema skeleton.
 *
 * GH #386: Frontend Validation Foundation
 */

/**
 * Thrown by publicApiFetch / apiFetch when the server responds with a
 * body that cannot be parsed as JSON (e.g. HTML error page, connection
 * reset garbage, or syntactically invalid JSON).
 */
export class ApiParseError extends Error {
  /** HTTP status code received from the server (e.g. 200, 502). */
  public readonly status: number;

  /** Raw response body text, if available. */
  public readonly originalBody?: string;

  /** The underlying parse error or network error, if any. */
  public readonly cause?: unknown;

  constructor(message: string, status: number, originalBody?: string, cause?: unknown) {
    super(message);
    this.name = 'ApiParseError';
    this.status = status;
    this.originalBody = originalBody;
    this.cause = cause;
  }
}

// ── Shared Zod schema skeleton (empty — domain schemas added in future issues) ──
export {};
