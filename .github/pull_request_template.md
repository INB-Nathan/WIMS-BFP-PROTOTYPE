## Pull Request — WIMS-BFP

### Description
<!-- What changed and why? -->

### Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code cleanup
- [ ] Documentation update
- [ ] CI/CD change
- [ ] Database migration

### Linked Issue
<!-- Closes #N or Relates to #N -->

### Branch convention
| Type     | Pattern                                | Example                               |
|----------|-----------------------------------------|----------------------------------------|
| Feature  | `feature/<module>-<short-desc>`         | `feature/module-2-offline-pwa`         |
| Fix      | `fix/<module>-<short-desc>`             | `fix/auth-jwt-kid-validation`          |
| Refactor | `refactor/<module>-<short-desc>`        | `refactor/module-8-xai-hitl`           |
| Hotfix   | `hotfix/<module>-<short-desc>`          | `hotfix/infra-critical-ci-fail`        |
| Docs     | `docs/<module>-<short-desc>`            | `docs/general-pr-process`              |

### Testing Done
- [ ] Frontend builds without errors (`npm run build`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Ruff linter passes (`ruff check .`)
- [ ] Ruff formatter check passes (`ruff format --check .`)
- [ ] pytest passes (`pytest -v`)
- [ ] Manual smoke test (describe what you tested)

### Screenshots / Recordings
<!-- Paste UI changes, error traces, or recordings here -->

### Anything the reviewer should know?
<!-- E.g., migration commands, env var changes, breaking changes, deploy steps -->

### Checklist
- [ ] My code follows the project's style guidelines (ESLint + Ruff)
- [ ] I have performed a self-review of my own code
- [ ] I have commented hard-to-understand code
- [ ] I have updated documentation if needed
- [ ] My changes do not introduce new warnings or lint errors
- [ ] Tests added/updated where appropriate
- [ ] All CI checks pass before requesting review
