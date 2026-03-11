# SKILL: OIDC & PKCE AUTHENTICATION FLOW

## 1. THE ARCHITECTURE
We do not use generic NextAuth.js magic. We implement a strict Authorization Code Flow with PKCE bridged through our FastAPI backend.

## 2. THE FLOW (FRONTEND RESPONSIBILITY)
1. **Initiate:** Generate a cryptographically secure `code_verifier` and `state`. Hash the verifier into a `code_challenge`.
2. **Store:** Save `code_verifier` and `state` in secure, HttpOnly, SameSite=Lax cookies.
3. **Redirect:** Send the user to the Keycloak Authorization Endpoint.

## 3. THE HANDSHAKE (BACKEND RESPONSIBILITY)
1. **Callback:** Next.js catches Keycloak's redirect at `/api/auth/callback`.
2. **Bridge:** Next.js extracts `code` and `state` from the URL, and retrieves the `code_verifier` from cookies.
3. **Exchange:** Next.js sends `code` and `code_verifier` to the FastAPI backend (`POST /api/auth/login`).
4. **Validation:** FastAPI verifies the Keycloak RS256 JWT signature.

## 4. SECURITY CONSTRAINTS
- Never expose the `access_token` or `refresh_token` to the client browser's `localStorage`. Store them in secure, HttpOnly cookies.