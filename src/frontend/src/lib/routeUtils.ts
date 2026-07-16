/**
 * Route constants and helpers for the public/civilian surface.
 * Centralises route matching used by LayoutShell to avoid duplication.
 * Issue #609 (PR feat/609-shared-header-nav)
 */

export const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/report',
  '/callback',
  '/verify-sent',
  '/verify',
] as const satisfies readonly string[];

export const PUBLIC_ROUTE_PREFIXES = [
  '/tracking',
  '/fire-stations',
  '/privacy',
] as const satisfies readonly string[];

export const CIVILIAN_ROUTES = [
  '/contributor',
  '/information',
] as const satisfies readonly string[];

export function isPublicRoute(pathname: string): boolean {
  return (
    (PUBLIC_ROUTES as readonly string[]).includes(pathname) ||
    (PUBLIC_ROUTE_PREFIXES as readonly string[]).some((prefix) =>
      pathname.startsWith(prefix),
    )
  );
}

export function isCivilianRoute(pathname: string): boolean {
  return (CIVILIAN_ROUTES as readonly string[]).includes(pathname);
}
