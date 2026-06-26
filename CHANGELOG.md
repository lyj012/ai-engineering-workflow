# Changelog

## Unreleased

- Harden `deliver-from-plan` role separation and test integrity: the fixer is now an explicit independent role (minimal-scope, must not touch tests); the implementer and fixer are forbidden from editing the materialized tests; independent Verify re-materializes the new-feature checks from `test-plan.json` and re-runs them against the sandbox, blocking delivery when they fail (prevents weakening tests to make DONE pass); a frozen tests fingerprint flags in-tree test changes; review-completeness is now tracked cumulatively across rounds, not only the last.
- Remove default dependencies on author-local parent or sibling directories.
- Add public quick start, examples, sanitized artifacts, and repository self-checks.
- Add open-source project files for contribution and security reporting.

## 1.0.0 - 2026-06-24

- Initial public release of the Claude Code Dynamic Workflow methodology and scripts.
