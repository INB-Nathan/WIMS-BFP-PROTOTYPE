/**
 * Shared API error class for both authenticated and public transports.
 *
 * Extracted from transport.ts (2026-06-22) to avoid pulling auth-refresh
 * logic into the public/civilian bundle. Both transport.ts and
 * public-transport.ts import from this file.
 */
export class ApiRequestError extends Error {
  status: number;
  detail?: unknown;
  retryAfter?: number;

  constructor(message: string, status: number, detail?: unknown, retryAfter?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

// Barrel re-exports preserved from the original errors.ts aggregator.
export { errorMessageFromJson } from './transport';
export { ApiParseError } from '@/lib/validation';
