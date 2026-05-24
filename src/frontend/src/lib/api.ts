/**
 * Compatibility barrel for the domain API slices in `src/lib/api/`.
 *
 * New code should import from a domain slice such as `@/lib/api/civilian`,
 * `@/lib/api/analytics`, or `@/lib/api/regional`. Existing `@/lib/api`
 * imports remain supported during migration.
 */

export * from './api/index';
