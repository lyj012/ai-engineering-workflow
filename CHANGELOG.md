# Changelog

## Unreleased

- Add `auto-deliver` end-to-end orchestrator: from a single requirement plus a target repository it chains `plan-from-requirement` → readiness gate → `deliver-from-plan` → delivery gate → `publish-delivery` using one level of `workflow()` (the three engines never call `workflow()` themselves, so the one-level-nesting limit is respected). Gates are deterministic; the run pauses only on a NEEDS_CLARIFICATION requirement, a plan red line, or missing push permission, and otherwise advances automatically.
- Add `publish-delivery` workflow: turn a verified delivery (changes.diff + `DELIVERED`/`DELIVERED_WITH_OPEN_ITEMS` manifest) into an automatic git branch/commit/push, then verify the remote independently (branch SHA matches the commit, committed files match the delivery, no forbidden files, clean tree). Clones the remote into an isolated working copy (the original target repo is never touched), never force-pushes, refuses to push `main`/`master`/`release` unless `gitPolicy.allowMainPush`, keeps high-risk domains (payment/permission/secret/auth) behind a human gate by default, and never embeds credentials (push relies on the ambient SSH/credential helper). Deterministic status decision lives in `core/publish-status.mjs` with unit tests and self-check parity; no PR is created.
- Harden `deliver-from-plan` role separation and test integrity: the fixer is now an explicit independent role (minimal-scope, must not touch tests); the implementer and fixer are forbidden from editing the materialized tests; independent Verify re-materializes the new-feature checks from `test-plan.json` and re-runs them against the sandbox, blocking delivery when they fail (prevents weakening tests to make DONE pass); a frozen tests fingerprint flags in-tree test changes; review-completeness is now tracked cumulatively across rounds, not only the last.
- Remove default dependencies on author-local parent or sibling directories.
- Add public quick start, examples, sanitized artifacts, and repository self-checks.
- Add open-source project files for contribution and security reporting.

## 1.0.0 - 2026-06-24

- Initial public release of the Claude Code Dynamic Workflow methodology and scripts.
