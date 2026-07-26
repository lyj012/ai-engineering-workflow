---
name: ai-engineering-workflow
description: >-
  Claude Code daily development router for scoped coding with workflow guardrails. Use for ordinary development,
  bugfix, refactor, review, delivery summary, pre-push safety checks, and git publish routing. Escalate to the
  existing full Claude Workflow chain only when explicitly requested or high risk.
---

# AI Engineering Workflow (Claude Code)

This is the Claude Code daily entry for the same product shape as the Codex `ai-engineering-workflow` Skill:

direct development router + process guardrails + delivery record tool.

It is not a redesign of Claude Workflow. Keep the existing full workflow chain as the escalation backend:

- `.claude/workflows/plan-from-requirement.js`
- `.claude/workflows/deliver-from-plan.js`
- `.claude/workflows/publish-delivery.js`
- `.claude/workflows/auto-deliver.js`

## Routing

Route before loading heavy workflow contracts or spawning agents.

1. If the customer explicitly asks for complete flow, formal full delivery, strict audit, `/critical-check`, independent review plus independent verification, sandbox delivery, or formal audit artifacts, use Full Workflow.
2. Otherwise, if the task hits a high-risk trigger, use Full Workflow.
3. Otherwise, if the customer is preparing a formal handoff, formal submission, merge, release, or customer delivery, use Formal Delivery Flow.
4. Otherwise, route by intent: Analysis, Fast Dev, Feature Dev, Bugfix, Refactor, Review, Delivery Summary, Pre-Push Check, or Git Publish.

High-risk triggers:

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

Ordinary CRUD is not data migration. Normal query, mapper, DTO/VO, pagination, filter, and non-destructive table read/write changes stay in daily development unless schema migration, production data, permissions, or another high-risk trigger is present.

## Daily Flows

| Intent / Command | Flow | Behavior |
|---|---|---|
| analyze / clarify / assess | Analysis | read-only related files, conclusions, risks, suggestions |
| `/dev-fast` or ordinary small change | Fast Dev | read related files, minimal edit, light verification, concise handoff |
| `/dev-feature` or ordinary feature loop | Feature Dev | concise plan, scoped implementation, core-path verification |
| bug / error / exception | Bugfix | root cause, minimal fix, targeted regression verification |
| refactor / optimize structure | Refactor | behavior-preserving scoped refactor and regression verification |
| `/review-changes` | Review | review current diff only, P0/P1/P2 findings |
| `/delivery-summary` | Delivery Summary | changed files, behavior, verification, unverified scope, risks |
| `/pre-push-check` | Pre-Push Check | branch/remote/status, task files, unsafe files, verification gaps |
| commit / push / open PR | Git Publish | exact-file commit/push only after explicit customer authorization and clear safety gates |
| `/critical-check` or high-risk | Full Workflow | existing plan -> deliver -> publish workflow chain |

## Deterministic Helpers

Use these shared helpers when useful; they are pure/read-only unless explicitly documented otherwise:

- `node bin/core.mjs daily-route --stdin`
- `node bin/core.mjs pre-push-status --input <json-file>`
- `node bin/pre-push-check.mjs --cwd <repo>` (publish-intent gate by default; use `--snapshot-only` only for read-only git safety snapshots)
- `node bin/git-state.mjs --cwd <repo>`
- `node bin/core.mjs git-guard --stdin`
- `node bin/core.mjs branch-choice --stdin`
- `node bin/core.mjs publish-status --input <json-file>`
- `node bin/core.mjs verify-remote-publish --input <json-file>`

Use `--input <json-file>` or `--stdin` for object inputs on Windows PowerShell.

## Git Safety

Stop before git writes when:

- the customer has not explicitly authorized the specific commit, push, or PR action in the current context;
- the customer says not to commit or not to push;
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
| high-risk logic | Full Workflow with analysis, plan, sandbox implementation, independent review, independent verification |

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
