# WIMS-BFP: PROJECT CONSTITUTION

## 1. THE SUPREME DIRECTIVE: FORENSIC STABILITY
You are building a Tier 3, mission-critical system for the Bureau of Fire Protection. "Works on my machine" is a failure state. Every feature must be quantified, resilient, and deterministic. 

## 2. ZERO VIBE-CODING (DESIGN & UI)
- **No Hardcoded Colors/Spacings:** You must never use raw Tailwind hexes (e.g., `bg-[#ff0000]`) or generic palette aliases (e.g., `text-white`) in component files. 
- **Semantic Tokens Only:** Use `--color-theme-*` and `bg-theme-*`.
- **The Fail-Safe Rule:** Every `var()` call in CSS MUST have a comma-separated fallback (e.g., `var(--spacing-32, 8rem)`). If you write a `var()` without a fallback, you have violated the Constitution.

## 3. RED STATE / GREEN STATE (TDD)
- You are not allowed to write implementation code until a failing test (Red State) exists that proves the feature is missing or broken.
- Tests must be adversarial. Test for concurrency, missing environment variables, and malformed inputs.

## 4. ENVIRONMENTAL PURITY
- Never hardcode localhost URLs, API endpoints, or Keycloak realms in the codebase.
- Rely strictly on `NEXT_PUBLIC_*` for the frontend and os.environ for the backend. Fail loudly if an environment variable is missing.