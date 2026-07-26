# Platform-Neutral Core

`core/` holds deterministic contracts and logic that should not drift between Claude Code and Codex adapters.

The core is intentionally small:

- `schemas/plan-artifacts.schema.json` defines the compatible plan artifact shape.
- `schemas/daily-route.schema.json` defines the daily router output contract.
- `status.json` defines shared readiness, delivery, publish, route, and pre-push status meanings.
- `daily-route.mjs` classifies ordinary daily work into Fast Dev, Feature Dev, Bugfix, Refactor, Review,
  Delivery Summary, Pre-Push Check, Git Publish, Formal Delivery, or Full Workflow escalation.
- `pre-push-status.mjs` evaluates read-only pre-push readiness; `PREPUSH_READY` means exact-file confirmation
  may proceed and never means published.
- deterministic scripts may validate artifacts and cross-adapter behavior against these files.

Claude Workflow scripts still keep some schemas inline because the Workflow JS surface is a pure orchestration
environment rather than a normal Node module runtime. Keep inline copies synchronized with this core contract
until a real import path is proven safe.

## CLI Entry Points

- `node bin/core.mjs daily-route --stdin` classifies a request with the shared daily router. Adapters should use
  this result as the truth source before loading heavy workflow contracts or spawning agents.
- `node bin/core.mjs pre-push-status --input <json-file>` evaluates a structured pre-push snapshot.
- `node bin/pre-push-check.mjs --cwd <repo> --branch-mode <current-branch|new-branch|switch-existing>` gathers a
  read-only git snapshot and applies the shared pre-push gate with publish intent enabled by default. Omitting
  `--branch-mode` blocks publish readiness because the branch strategy is ambiguous; pass `--snapshot-only` only
  when you want a non-publish safety snapshot.

## Routing Semantics

- Read-only intents (`ROUTE_ANALYSIS`, `ROUTE_REVIEW`, `ROUTE_DELIVERY_SUMMARY`, `ROUTE_PRE_PUSH_CHECK`) are
  resolved before high-risk modification escalation.
- High-risk terms inside read-only requests are preserved as warnings and do not trigger Full Workflow by
  themselves.
- High-risk triggers escalate modification tasks only: payment, permissions/authorization, authentication/login,
  amount calculation, third-party callback handling, entitlements, data migration, production config/data,
  security, data deletion/destructive operations, and multi-tenant isolation.
- Ordinary price labels, design tokens, JavaScript callbacks, token counts, pricing-page styling, CRUD, query,
  mapper, DTO/VO, pagination, filter, and non-destructive table changes stay in daily development unless paired
  with a real high-risk trigger.

## What Belongs Here

- JSON Schema for artifacts consumed by more than one adapter.
- Status and readiness enums.
- Platform-neutral route, safety, and artifact protocol documents.
- Deterministic validation logic when it can run as a normal program.

## What Does Not Belong Here

- Claude `Workflow` calls, phases, `agent()` options, or resume mechanics.
- Codex `codex exec` command wrappers, prompt routing, or sandbox flags.
- Future adapters for tools that are not implemented in this repository.
- UI, dashboards, or marketplace packaging.

## Compatibility Rule

Claude and Codex should emit compatible artifact structures and share deterministic daily route / git safety
decisions. They do not need to share the same internal execution model.
