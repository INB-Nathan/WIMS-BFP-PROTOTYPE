const DEFAULT_STAFF_ROUTES: Record<string, string> = {
  SYSTEM_ADMIN: '/admin/system',
  REGIONAL_ENCODER: '/dashboard/regional',
  ENCODER: '/dashboard/regional',
  NATIONAL_VALIDATOR: '/dashboard/validator',
  VALIDATOR: '/dashboard/validator',
  NATIONAL_ANALYST: '/dashboard/analyst',
};

const GENERIC_LOGIN_PATHS = new Set(['/login', '/callback', '/dashboard', '/home']);

export function defaultRouteForRole(role?: string | null): string {
  return role ? DEFAULT_STAFF_ROUTES[role] ?? '/dashboard' : '/dashboard';
}

export function resolvePostLoginRedirect(
  role: string | null | undefined,
  savedRedirect: string | null,
  origin: string,
): string {
  const defaultRoute = defaultRouteForRole(role);
  if (!savedRedirect) return defaultRoute;

  try {
    const target = new URL(savedRedirect, origin);
    if (target.origin !== origin) return defaultRoute;
    if (GENERIC_LOGIN_PATHS.has(target.pathname)) return defaultRoute;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return defaultRoute;
  }
}
