/**
 * Domain API slices with compatibility exports.
 *
 * `legacy.ts` retains implementation during migration; domain files are the
 * stable import surface for new code.
 */

export { API_BASE, ApiRequestError, apiFetch, errorMessageFromJson } from './transport';
export { publicApiFetch } from './public-transport';

export * from './admin';
export * from './analytics';
export * from './civilian';
export * from './reference';
export * from './regional';
export * from './triage';
export * from './map';
