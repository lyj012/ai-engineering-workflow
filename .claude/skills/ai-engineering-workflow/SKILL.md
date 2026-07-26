---
name: ai-engineering-workflow
description: >-
  Claude Code daily development router for scoped coding with workflow guardrails. Use for ordinary development,
  bugfix, refactor, review, delivery summary, pre-push safety checks, and git publish routing. Escalate to the
  existing full Claude Workflow chain only when explicitly requested or high-risk modification is requested.
---

# AI Engineering Workflow (Claude Code)

This is the Claude Code daily entry for the same product shape as the Codex `ai-engineering-workflow` Skill:

`direct development router + process guardrails + delivery record tool`

It is not a redesign of Claude Workflow. Keep the existing full workflow chain as the escalation backend:

- `.claude/workflows/plan-from-requirement.js`
- `.claude/workflows/deliver-from-plan.js`
- `.claude/workflows/publish-delivery.js`
- `.claude/workflows/auto-deliver.js`

## Toolkit Root

Before deterministic routing or git safety checks, resolve the toolkit root. Priority:

1. If this skill is installed inside the `ai-engineering-workflow` repository, resolve the real path of this `SKILL.md`, then walk upward until `core/`, `bin/`, `scripts/`, and `.claude/` exist.
2. If the user explicitly provides a toolkit path for this run, use it.
3. If `AIEW_HOME` is set, use it as a backwards-compatible override.
4. If no toolkit root is found, continue only lightweight read/edit flows that do not require deterministic tooling, or stop Full Workflow / Git Publish with a clear installation error.

Use `node "<toolkit-root>/bin/core.mjs" ...` and `node "<toolkit-root>/bin/pre-push-check.mjs" ...`; do not assume Claude Code was launched from the toolkit repository.

## Routing

Route every request through the shared Daily Router before loading heavy workflow contracts or spawning agents:

```text
node "<toolkit-root>/bin/core.mjs" daily-route --stdin
```

Use the router result as the truth source for `finalStatus`, `route`, `verificationLevel`, `warnings`, and `stopBeforeGitWrites`.

1. If the shared router returns `ROUTE_FULL_WORKFLOW`, use Full Workflow.
2. If it returns `ROUTE_FORMAL_DELIVERY`, use Formal Delivery Flow.
3. If it returns a read-only route (`ROUTE_ANALYSIS`, `ROUTE_REVIEW`, `ROUTE_DELIVERY_SUMMARY`, or `ROUTE_PRE_PUSH_CHECK`), do not edit, commit, push, or create PRs even when high-risk terms appear; report the router warnings.
4. Otherwise, execute the selected daily flow: Fast Dev, Feature Dev, Bugfix, Refactor, or Git Publish.

High-risk triggers escalate modification tasks, not pure read-only requests:

- payment;
- permissions or authorization;
- authentication or login;
- amount calculation;
- third-party callback;
- entitlements;
- data migration;
- production config or production data;
- security;
- data deletion or destructive operation;
- multi-tenant isolation.

Ordinary CRUD is not data migration. Normal query, mapper, DTO/VO, pagination, filter, non-destructive table read/write changes, price labels, design tokens, JavaScript callbacks, token counts, and pricing-page styling stay in daily development unless schema migration, production data, permissions, credential handling, third-party callback handling, or another high-risk trigger is present.

## Daily Flows

| Intent / Command | Flow | Behavior |
|---|---|---|
| analyze / clarify / assess / explain | Analysis | read-only related files, conclusions, risks, suggestions |
| `/dev-fast` or ordinary small change | Fast Dev | read related files, minimal edit, light verification, concise handoff |
| `/dev-feature` or ordinary feature loop | Feature Dev | concise plan, scoped implementation, core-path verification |
| bug / error / exception | Bugfix | root cause, minimal fix, targeted regression verification |
| refactor / optimize structure | Refactor | behavior-preserving scoped refactor and regression verification |
| `/review-changes` | Review | review current diff only, P0/P1/P2 findings |
| `/delivery-summary` | Delivery Summary | changed files, behavior, verification, unverified scope, risks |
| `/pre-push-check` | Pre-Push Check | branch/remote/status, task files, unsafe files, verification gaps |
| commit / push / open PR | Git Publish | exact-file commit/push only after explicit customer authorization and clear safety gates |
| `/critical-check` or explicit Full Workflow | Full Workflow | existing plan -> deliver -> publish workflow chain |

## Execution Protocol

- Analysis: read only relevant files and project rules; do not edit; output conclusions, risks, and next-step options.
- Fast Dev: read task-relevant files, make the smallest direct change, run light verification, and report changed files and unverified scope.
- Feature Dev: write a concise plan, implement the minimal closed path, run core-path verification, and avoid independent review or sandbox delivery by default.
- Bugfix: inspect the symptom/log/error, identify root cause before editing when practical, apply the smallest fix, and run targeted regression verification.
- Refactor: keep behavior unchanged, constrain the boundary, refactor in small steps, and run regression checks for the affected surface.
- Review: inspect current diff/PR/files only; output P0/P1/P2 findings; do not add product behavior unless the user separately asks for fixes.
- Delivery Summary: read current changes and summarize completed work, verification, unverified scope, and risks; do not expand implementation.
- Pre-Push Check: inspect branch/remote/status, isolate task files, flag unsafe or unrelated files, and report readiness/blockers only.
- Formal Delivery: summarize current changes, run necessary verification, review blockers, fix must-fix issues only when requested by the flow, then hand off or route to Git Publish if the user asks.
- Full Workflow: use `plan-from-requirement.js -> deliver-from-plan.js -> publish-delivery.js` only for explicit full workflow, `/critical-check`, independent review plus independent verification, formal audit, sandbox delivery, or high-risk modification requests.

## Deterministic Helpers

Use these shared helpers as required by the selected route; they are pure/read-only unless explicitly documented otherwise:

- `node "<toolkit-root>/bin/core.mjs" daily-route --stdin`
- `node "<toolkit-root>/bin/core.mjs" pre-push-status --input <json-file>`
- `node "<toolkit-root>/bin/pre-push-check.mjs" --cwd <repo> --branch-mode <current-branch|new-branch|switch-existing>` (publish-intent gate by default; use `--snapshot-only` only for non-publish safety snapshots)
- `node "<toolkit-root>/bin/git-state.mjs" --cwd <repo>`
- `node "<toolkit-root>/bin/core.mjs" git-guard --stdin`
- `node "<toolkit-root>/bin/core.mjs" branch-choice --stdin`
- `node "<toolkit-root>/bin/core.mjs" publish-status --input <json-file>`
- `node "<toolkit-root>/bin/core.mjs" verify-remote-publish --input <json-file>`

Use `--input <json-file>` or `--stdin` for object inputs on Windows PowerShell.

## Git Safety

Stop before git writes when:

- the customer has not explicitly authorized the specific commit, push, or PR action in the current context;
- the customer says not to commit, not to push, not to publish, not to open/create a PR, or asks to only check/review/analyze;
- unrelated or unsafe changes cannot be separated confidently;
- required verification fails;
- branch, remote, or publish strategy is ambiguous;
- `AGENTS.md`, `.env`, token/key/secret files, personal config, generated local output, debug logs, or unrelated files would be included;
- the publish target is protected or high risk and lacks explicit opt-in.

Hard rules:

- Git publish is a gated close-loop route, not an implicit side effect of ordinary Claude Code edits.
- The Codex adapter may complete the daily commit/push loop when its Skill is explicitly invoked; Claude Code preserves the same shared safety contract but still requires explicit customer authorization for outward git writes.
- No `git add .`.
- No force-push.
- No protected branch publishing without explicit opt-in.
- Remote URLs must be masked; embedded credentials must not be logged.
- `PREPUSH_READY` means ready for exact-file confirmation; it does not mean `PUBLISHED`.

## Verification Levels

| Scenario | Recommended verification |
|---|---|
| text, style, small component, small field | `git diff --check`, then the smallest relevant build/lint/test item |
| ordinary frontend change | build/lint or focused page smoke check for loading, interaction, or error state |
| ordinary backend change | compile or focused test; smoke one core API when practical |
| ordinary frontend-backend loop | request parameters, response fields, loading state, error message, duplicate-submit behavior |
| before submit, handoff, commit, or push | git status, task-file scope, unsafe files, actual verification commands, delivery summary |
| high-risk modification logic | Full Workflow with analysis, plan, sandbox implementation, independent review, independent verification |

## Final Response

Keep daily responses short and factual:

```text
Changed:
Verified:
Unverified:
Risk:
Files:
```

Do not claim delivered, published, or verified unless that exact step actually ran and succeeded.
