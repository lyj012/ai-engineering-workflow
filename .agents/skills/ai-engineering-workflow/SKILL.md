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

This is a daily-use optimization, not a downgrade of the complete workflow. Full Workflow is already the
complete feature/project delivery path and can be used for full project development; daily modes exist to
avoid forcing every ordinary edit through the most expensive contract.

## 0. Top-Level Routing

Route every request before reading large workflow contracts or spawning subagents.

1. If the customer explicitly asks for a complete flow, formal full delivery, strict audit, or full review,
   use Full Workflow.
2. Otherwise, if the task hits a high-risk trigger, use Full Workflow.
3. Otherwise, if the customer is preparing a formal handoff, formal submission, merge, release, or customer
   delivery, use Formal Delivery Flow.
4. Otherwise, route by intent: Analysis, Development, Bugfix, Refactor, Review, Delivery Summary, or Git
   Publish.

High-risk triggers:

- payment;
- permissions or authorization;
- authentication or login;
- amount calculation;
- third-party callback;
- data migration;
- production config or production data;
- security;
- data deletion or destructive operation;
- multi-tenant isolation.

Ordinary database CRUD is not data migration. Adding or adjusting normal queries, mapper methods, DTO/VO
fields, pagination, filters, or non-destructive table reads/writes must not trigger Full Workflow unless the
task also changes schema, migrates data, touches production data, changes permissions, or has another
high-risk trigger.

Do not automatically enter the full engineering loop for ordinary frontend work, ordinary CRUD, DTO/VO
changes, mapper/service additions, button states, layout tweaks, form interactions, or interface field
alignment.

| Intent / Command | Flow | Default Behavior |
|---|---|---|
| only analyze / clarify / assess | Analysis Flow | read-only related files, output conclusions/risks/suggestions, stop |
| `/dev-fast` or small development | Fast Dev | read related files, minimal edit, light verification, changed files + unverified scope |
| `/dev-feature` or ordinary feature loop | Feature Dev | short plan, minimal feature loop, core path verification, changed files + unverified scope |
| fix bug / error / exception | Bugfix Flow | read symptom/logs, identify root cause, minimal fix, targeted regression verification |
| refactor / optimize structure | Refactor Flow | confirm boundary, protect external behavior, small-step refactor, regression verification |
| `/review-changes`, diff/PR/code review | Review Flow | read diff/PR/files and necessary context, output P0/P1/P2 findings, stop |
| `/delivery-summary`, summary/retro/acceptance notes | Delivery Summary Flow | read current changes, summarize completed work, verification, unverified scope, risks |
| commit / push / open PR | Git Publish Flow | inspect git state, isolate task files, exclude unsafe files, confirm, commit, push, optional PR |
| formal handoff / formal delivery / ready to submit | Formal Delivery Flow | summarize changes, run needed verification, review current changes, fix blockers, delivery summary |
| complete flow / strict audit / `/critical-check` / high-risk trigger | Full Workflow | full analysis, risk analysis, plan, sandbox implementation, independent review, independent verification, artifacts |

## 1. Analysis Flow

Use Analysis Flow when the customer only wants analysis, clarification, evaluation, design thinking, or risk
assessment.

Process:

1. Read only related files and relevant project guidance.
2. Do not edit files.
3. Output analysis conclusions, risks, suggestions, and concrete next-step options.
4. Stop and wait for the customer's next instruction.

## 2. Fast Development Mode

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

## 3. Feature Development Mode

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
default. Escalate to Full Workflow only when the feature includes a high-risk trigger.

## 4. Bugfix Flow

Use Bugfix Flow when the customer reports a bug, error, exception, failed command, broken behavior, or
regression.

Process:

1. Read the error, logs, failing behavior, and directly related code.
2. Identify the root cause before editing when practical.
3. Apply the smallest fix that addresses the root cause.
4. Run targeted regression verification such as the failing command, focused test, build, lint, compile, or
   a narrow manual check.
5. Report root cause, fix point, commands run, and remaining unverified scope.

## 5. Refactor Flow

Use Refactor Flow when the customer asks to restructure, simplify, optimize organization, rename, or improve
maintainability without changing behavior.

Process:

1. Confirm the refactor boundary.
2. Identify external behavior that must stay unchanged.
3. Refactor in small steps and avoid unrelated cleanup.
4. Run regression verification that protects the unchanged behavior.
5. Report what changed and whether external behavior was kept unchanged based on the checks run.

## 6. Review Changes Mode

`/review-changes` is a review-only command. Do not add new product behavior unless the user separately asks
for fixes after the review.

Review only the current diff and directly relevant surrounding code. Lead with concrete findings ordered by
severity, with file and line references when possible. Focus on bugs, regressions, missing tests, permissions,
state consistency, API mismatch, and unsafe edge cases. Keep summaries brief.

Use P0/P1/P2 severity:

- P0: must fix before merge/release/customer delivery.
- P1: should fix before normal delivery unless explicitly accepted.
- P2: improvement, cleanup, or lower-risk follow-up.

## 7. Delivery Summary Mode

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

## 8. Formal Delivery Flow

Use Formal Delivery Flow when the customer is preparing a formal handoff, formal submission, merge, release,
or customer delivery, but has not asked for the complete high-risk workflow.

Process:

1. Read the current changes and identify this task's files.
2. Run necessary verification for the changed surface.
3. Review the current changes for blockers.
4. If must-fix issues exist, fix them and rerun the needed verification.
5. Generate a delivery summary with completed work, verification results, unverified scope, and risks.
6. If the customer asks to push, route to Git Publish Flow. Otherwise stop.

This flow reviews the current changes; it does not require sandbox delivery, formal plan artifacts, or
multi-agent independent verification by default.

## 9. Full Workflow

Use Full Workflow when the customer explicitly asks for a complete flow, formal full delivery, strict audit,
or when the high-risk trigger list is matched.

Full Workflow is the complete feature/project development path. It is not experimental fallback behavior; it
is the mode for complete delivery, strict audit, high-risk changes, and any task where the customer wants the
full analysis -> plan -> sandbox implementation -> independent review -> independent verification loop.

Before planning or coding in Full Workflow, resolve the toolkit root and read:

1. `<toolkit-root>/codex/pipeline.md`
2. `<toolkit-root>/codex/plan-from-requirement.md`
3. `<toolkit-root>/codex/agent-role-map.json`

Treat those files as the full execution contract. The shape remains:

`plan-from-requirement (read-only) -> validated plan artifacts -> deliver-from-plan (sandbox only) -> independent review/fix/verify -> validated delivery artifacts + changes.diff -> optional publish`.

Full Workflow steps:

1. Full requirement analysis.
2. Full risk analysis.
3. Plan creation.
4. Sandbox implementation.
5. Independent review stage.
6. Fix any discovered issue.
7. Independent verification stage.
8. Generate delivery artifacts.
9. Generate delivery summary.
10. If the customer asks to push, route to Git Publish Flow. Otherwise stop.

Full Workflow uses plan artifacts such as `requirement.json`, `plan.json`, `risks.json`, `test-plan.json`,
and `final-plan.md`, validates them with `validate-plan-artifacts.mjs`, performs implementation in a sandbox
copy, never by directly editing the target repository during the sandbox delivery stage, emits
`changes.diff`, `delivery-report.md`, and `delivery-manifest.json`, and validates delivery with
`validate-delivery-artifacts.mjs`.

Full Workflow requires real Codex subagent threads when the environment supports them. The parent thread
must Spawn the mapped Codex custom agent, Wait for that agent to complete, validate the result, and record
`agent-execution.json`. It must not simulate independent roles in the parent thread.

The independent review stage and independent verification stage must be separate real executions in Full
Workflow. If required subagents are unavailable or execution evidence is incomplete, report one of the existing
blocking statuses such as `BLOCKED_MULTI_AGENT_UNAVAILABLE`,
`BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION`, `BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION`, or
`BLOCKED_MISSING_INDEPENDENT_VERIFIER`. Do not fabricate success evidence. Records must include
`execution_context`, `execution-context.mjs` output, and `fallbackUsed=false` before claiming a full delivery
is fully verified.

## 10. Toolkit Root For Heavy Commands

Resolve the toolkit root only when a mode needs deterministic workflow tooling. Priority:

1. If this skill is installed inside the `ai-engineering-workflow` repository, resolve the real path of this
   `SKILL.md` first, then walk upward until `core/`, `bin/`, `scripts/`, and `codex/` exist.
2. If the user explicitly provides a toolkit path for this run, use it.
3. If `AIEW_HOME` is set, use it as a backwards-compatible override.
4. If none of the above locates the toolkit root, continue lightweight flows without heavy tooling, or stop
   Full Workflow with a clear installation error.

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

## 11. Git Publish Flow

Do not commit or push unless the user explicitly asks for it, except where a separately invoked workflow or
project rule grants that permission for the current task.

Process:

1. inspect the working tree;
2. identify exactly which files belong to this task;
3. exclude unrelated or pre-existing changes;
4. reject `AGENTS.md`, secrets, personal config, generated local output, and out-of-scope files;
5. show the prepared file list and key change summary to the customer;
6. stop unless the customer has already clearly confirmed commit/push in the current task;
7. commit using exact pathspecs only;
8. push normally;
9. create a PR only when requested;
10. verify the remote commit or PR state;
11. output branch, commit, PR link when any, and remote status.

Never force-push, delete remote branches, stage with `git add .`, or publish protected-branch changes without
explicit opt-in.

## 12. Final Response

Keep the final response short and factual:

1. what changed;
2. files changed;
3. commands run and results;
4. unverified scope;
5. risks or manual checks that still matter.

Do not call work "verified", "delivered", or "published" unless that exact verification or remote action
actually ran and succeeded.
