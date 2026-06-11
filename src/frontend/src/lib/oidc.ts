/**
 * OIDC UserManager configuration for Keycloak.
 * Used by AuthContext for login redirect and callback handling.
 */
import { UserManager, type UserManagerSettings } from 'oidc-client-ts';

if (!process.env.NEXT_PUBLIC_AUTH_API_URL) {
  throw new Error('OIDC Authority URL is undefined');
}

if (!process.env.NEXT_PUBLIC_BASE_URL) {
  throw new Error('NEXT_PUBLIC_BASE_URL is required; do not fall back to 0.0.0.0 or request headers');
}

const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
const configuredAuthApiUrl = process.env.NEXT_PUBLIC_AUTH_API_URL;

function runtimeOrigin(): string {
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return configuredBaseUrl;
}

function resolveAuthApiUrl(origin: string): string {
  if (configuredAuthApiUrl.startsWith('/')) {
    return `${origin}${configuredAuthApiUrl}`;
  }

  const configured = new URL(configuredAuthApiUrl);
  const current = new URL(origin);

  // Local development should use the nginx same-origin /auth proxy. Direct
  // browser token exchange against localhost:8080 is rejected by Keycloak CORS
  // when the app is served from https://localhost.
  if (
    configured.hostname === 'localhost' &&
    configured.port === '8080' &&
    current.hostname === 'localhost'
  ) {
    return `${origin}/auth`;
  }

  return configured.toString().replace(/\/$/, '');
}

function resolveRedirectUri(origin: string): string {
  const configuredRedirectUri = process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI;
  if (!configuredRedirectUri) {
    return `${origin}/callback`;
  }

  const configured = new URL(configuredRedirectUri);
  const current = new URL(origin);

  if (configured.hostname === 'localhost' && current.hostname === 'localhost') {
    return `${origin}${configured.pathname}${configured.search}${configured.hash}`;
  }

  return configured.toString();
}

function buildOidcConfig(): UserManagerSettings {
  const baseUrl = runtimeOrigin();
  const authApiUrl = resolveAuthApiUrl(baseUrl);
  const authority = `${authApiUrl}/realms/bfp`;

  return {
    authority,
    client_id: process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'wims-web',
    redirect_uri: resolveRedirectUri(baseUrl),
    response_type: 'code' as const,
    scope: 'openid profile email',
    post_logout_redirect_uri: baseUrl,
    automaticSilentRenew: false,
  };
}

export function createUserManager(): UserManager {
  return new UserManager(buildOidcConfig());
}
