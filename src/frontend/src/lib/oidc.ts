/**
 * OIDC UserManager configuration for Keycloak.
 * Used by AuthContext for login redirect and callback handling.
 */
import { UserManager } from 'oidc-client-ts';

if (!process.env.NEXT_PUBLIC_AUTH_API_URL) {
  throw new Error('OIDC Authority URL is undefined');
}

if (!process.env.NEXT_PUBLIC_BASE_URL) {
  throw new Error('NEXT_PUBLIC_BASE_URL is required; do not fall back to 0.0.0.0 or request headers');
}

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const authority = `${process.env.NEXT_PUBLIC_AUTH_API_URL}/realms/bfp`;

export const oidcConfig = {
  authority,
  client_id: process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'wims-web',
  redirect_uri: process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI || `${baseUrl}/callback`,
  response_type: 'code' as const,
  scope: 'openid profile email',
};

export function createUserManager(): UserManager {
  return new UserManager({
    ...oidcConfig,
    post_logout_redirect_uri: baseUrl,
  });
}
