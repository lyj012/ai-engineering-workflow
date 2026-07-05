---
name: ai-engineering-workflow
description: >-
  A lightweight AI development constraint workflow and delivery record tool. Use for day-to-day coding with
  minimal scope control and practical verification, then escalate to review, delivery summary, or critical
  audit only when the user explicitly asks or the task is high risk.
---

# AI Engineering Workflow (Codex)

This skill is the Codex entry point for a daily AI development workflow. Its product position is:

`AI development process constraint + delivery record tool`

It is not a full engineering audit by default. The normal goal is:

- do not make unrelated changes;
- do not drift from the user's goal;
- produce a working change;
- run practical verification;
- leave enough notes to review or resume later.

Default execution is fast. Heavy review and delivery machinery is opt-in or risk-triggered.

## 0. Mode Routing

Choose the mode from the user's command and task risk before reading large workflow contracts or spawning
subagents.

| Command / Trigger | Mode | Use For | Default Behavior |
|---|---|---|---|
| `/dev-fast` or no explicit heavy command | Fast Development | frontend pages, components, styles, forms, DTOs, CRUD, ordinary APIs, small bug fixes | inspect relevant files, edit directly, light verification, short summary |
| `/dev-feature` | Feature Development | ordinary modules, a small set of APIs, frontend-backend loop, non-critical CRUD feature | concise plan, minimal closed path, light verification, changed-file summary |
| `/review-changes` | Review Changes | review the current diff only | no feature coding; findings first; inspect changed files and relevant context |
| `/delivery-summary` | Delivery Summary | prepare handoff, demo, merge notes, phase recap | summarize files, behavior, verification, unverified scope, risks |
| `/critical-check` | Critical Check | payment, permissions, auth, money, callbacks, migrations, production config, deletion, security, multi-tenant logic | run the full critical workflow contract, including sandbox and independent review/verification where available |

Also escalate to Critical Check when the task touches payment, authorization, authentication, amount
calculation, third-party callbacks, member entitlements, database migration, production data/config, security,
destructive file/data operations, or multi-tenant isolation.

Do not automatically enter the full engineering loop for ordinary frontend work, ordinary CRUD, DTO/VO
changes, mapper/service additions, button states, layout tweaks, form interactions, or interface field
alignment.

Ordinary database CRUD is not a database migration. Adding or adjusting normal queries, mapper methods,
DTO/VO fields, pagination, filters, or non-destructive table reads/writes must not trigger Critical Check
unless the task also changes schema, migrates data, touches production data, changes permissions, or has
another high-risk trigger.

## 1. Fast Development Mode

Fast Development is the default unless the user explicitly asks for review, delivery, critical, audit, or the
task matches the high-risk triggers above.

Process:

1. Read only task-relevant files and local project rules needed for the change.
2. State a short intent and any important assumption before substantial edits.
3. Make the smallest direct change in the target repository.
4. Avoid broad architecture suggestions, unrelated refactors, global scans, long reports, and multi-agent review.
5. Run light verification that fits the stack and change size.
6. Report what changed, commands run, unverified scope, and any practical risk.

Allowed light verification:

- frontend: `npm run build`, `npm run lint`, type check, focused component/page smoke check, or manual page
  acceptance notes when a browser cannot be run;
- backend: compile, focused unit tests, `mvn test`, `mvn compile`, service startup check, or a focused `curl`
  for the changed API when practical;
- full stack: build/compile plus one core path check when the app can be started locally.

Frontend defaults:

- only modify related components, styles, hooks, API calls, or local state;
- do not rewrite routing, global state, request wrappers, design systems, or layout foundations unless asked;
- prioritize the page running, visible states, and interaction correctness;
- style fine-tuning may be left as manual acceptance notes if automated visual validation is not practical.

Backend defaults:

- reuse existing controllers, services, mappers, DTO/VO patterns, exceptions, logging, and pagination helpers;
- keep API shape and compatibility unless the request explicitly changes them;
- avoid speculative abstractions and new dependencies for ordinary CRUD.

## 2. Feature Development Mode

`/dev-feature` is a slightly broader fast path for a small complete module or frontend-backend loop.

Use it for:

- a normal new CRUD module;
- a small set of ordinary backend APIs;
- a frontend page wired to existing or ordinary new APIs;
- DTO/VO/mapper/service/controller changes that form one business path.

Process:

1. Read related files and project docs that directly affect the feature.
2. Write a concise plan focused on the minimal closed path.
3. Implement directly in the target repository with scoped changes.
4. Run compile/build/lint/focused tests/startup/core API or page checks as practical.
5. Report changed files, verified path, unverified path, and follow-up risks.

Do not run independent review, sandbox delivery, full artifact generation, or multi-agent verification by
default. Escalate to Critical Check only when the feature includes a high-risk trigger.

## 3. Review Changes Mode

`/review-changes` is a review-only command. Do not add new product behavior unless the user separately asks
for fixes after the review.

Review only the current diff and directly relevant surrounding code. Lead with concrete findings ordered by
severity, with file and line references when possible. Focus on bugs, regressions, missing tests, permissions,
state consistency, API mismatch, and unsafe edge cases. Keep summaries brief.

## 4. Delivery Summary Mode

`/delivery-summary` prepares a handoff record. It should not expand the implementation.

Include:

- changed files;
- user-visible behavior;
- important implementation notes;
- verification commands and actual results;
- unverified scope;
- residual risks and suggested manual checks.

Use deterministic helpers when useful, but do not force plan/delivery artifact generation unless the user asks
for a formal package.

## 5. Critical Check Mode

Critical Check is the only mode that uses the heavy workflow contract by default.

Before planning or coding in Critical Check, resolve the toolkit root and read:

1. `<toolkit-root>/codex/pipeline.md`
2. `<toolkit-root>/codex/plan-from-requirement.md`
3. `<toolkit-root>/codex/agent-role-map.json`

Treat those files as the critical execution contract. The critical shape remains:

`plan-from-requirement (read-only) -> validated plan artifacts -> deliver-from-plan (sandbox only) -> independent review/fix/verify -> validated delivery artifacts + changes.diff -> optional publish`.

Critical Check uses plan artifacts such as `requirement.json`, `plan.json`, `risks.json`, `test-plan.json`,
and `final-plan.md`, validates them with `validate-plan-artifacts.mjs`, performs implementation in a sandbox
copy, never by directly editing the target repository during the sandbox delivery stage, emits
`changes.diff`, `delivery-report.md`, and `delivery-manifest.json`, and validates delivery with
`validate-delivery-artifacts.mjs`.

Critical Check requires real Codex subagent threads when the environment supports them. The parent thread
must Spawn the mapped Codex custom agent, Wait for that agent to complete, validate the result, and record
`agent-execution.json`. It must not simulate independent roles in the parent thread.

The independent review stage and independent verification stage must be separate real executions in Critical
Check. If required subagents are unavailable or execution evidence is incomplete, report one of the existing
blocking statuses such as `BLOCKED_MULTI_AGENT_UNAVAILABLE`,
`BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION`, `BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION`, or
`BLOCKED_MISSING_INDEPENDENT_VERIFIER`. Do not fabricate success evidence. Records must include
`execution_context`, `execution-context.mjs` output, and `fallbackUsed=false` before claiming a critical
delivery is fully verified.

## 6. Toolkit Root For Heavy Commands

Resolve the toolkit root only when a mode needs deterministic workflow tooling. Priority:

1. If this skill is installed inside the `ai-engineering-workflow` repository, resolve the real path of this
   `SKILL.md` first, then walk upward until `core/`, `bin/`, `scripts/`, and `codex/` exist.
2. If the user explicitly provides a toolkit path for this run, use it.
3. If `AIEW_HOME` is set, use it as a backwards-compatible override.
4. If none of the above locates the toolkit root, continue Fast Development without heavy tooling, or stop
   Critical Check with a clear installation error.

Useful deterministic commands:

| Need | Command |
|---|---|
| self-check toolkit | `node "<toolkit-root>/scripts/self-check.mjs"` |
| execution context | `node "<toolkit-root>/bin/execution-context.mjs" --workflow-root "<toolkit-root>" --project-root "<target-project-root>" --workspace-root "<target-project-root>" --task-artifact-root "<run-dir>"` |
| git state and branch options | `node "<toolkit-root>/bin/git-state.mjs" --cwd <repo> [--mode <m>] [--target-branch <b>]` |
| plan readiness | `node "<toolkit-root>/bin/core.mjs" readiness <finalStatus>` |
| delivery / publish / persist status | `node "<toolkit-root>/bin/core.mjs" <deliver-status|publish-status|persist-outcome> --input <json-file>` |
| git red-line guard | `node "<toolkit-root>/bin/core.mjs" git-guard --stdin` |
| sandbox copy | `node "<toolkit-root>/bin/sandbox-prepare.mjs" --src <target> --dest <sandbox>` |
| portable diff | `node "<toolkit-root>/bin/diff-from-sandbox.mjs" --base <target> --sandbox <sandbox> --out <delivery-dir>/changes.diff` |
| validate plan artifacts | `node "<toolkit-root>/scripts/validate-plan-artifacts.mjs" <plan-dir>` |
| validate delivery artifacts | `node "<toolkit-root>/scripts/validate-delivery-artifacts.mjs" <delivery-dir>` |
| validate publish record | `node "<toolkit-root>/scripts/validate-publish-record.mjs" <publish-dir>` |

On Windows PowerShell, prefer `--input <json-file>` or `--stdin` for object inputs.

## 7. Git And Publish

Do not commit or push unless the user explicitly asks for it, except where a separately invoked workflow or
project rule grants that permission for the current task.

Before git writes:

1. inspect the working tree;
2. identify exactly which files belong to this task;
3. exclude unrelated or pre-existing changes;
4. reject `AGENTS.md`, secrets, personal config, generated local output, and out-of-scope files;
5. show the file list and key change summary to the user unless the active mode explicitly authorizes publish.

Never force-push, delete remote branches, stage with `git add .`, or publish protected-branch changes without
explicit opt-in.

## 8. Final Response

Keep the final response short and factual:

1. what changed;
2. files changed;
3. commands run and results;
4. unverified scope;
5. risks or manual checks that still matter.

Do not call work "verified", "delivered", or "published" unless that exact verification or remote action
actually ran and succeeded.
