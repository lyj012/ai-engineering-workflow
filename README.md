# AI Engineering Workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

AI development workflow contracts and adapters for keeping Claude Code and Codex changes scoped, practical,
verifiable, and easy to hand off. The default daily path is direct scoped development with guardrails: read only
relevant context, make the smallest useful change, run practical verification, and report what remains
unverified. The full audited pipeline remains available for high-risk modification or explicitly requested
full-flow work.

Claude Code and Codex now share the same daily routing contract and product positioning: a lightweight
`ai-engineering-workflow` entry, deterministic daily routing, pre-push safety checks, and escalation to the
existing Claude Code Dynamic Workflows when risk or explicit user intent requires it. `core/` owns the shared
route/status/safety decisions; `bin/` exposes cross-platform CLIs; `.claude/` and `.agents/` are adapter layers,
not separate methodologies. Codex Full Workflow is not positioned as a one-off experiment: it remains the
complete feature/project delivery path and is suitable for full project development. The current optimization is
about making everyday development smoother, cheaper, and less ceremonial while keeping the complete workflow
available when the task asks for it or risk requires it. In practice, the workflow is a daily router, not a
default full pipeline. Recorded validation includes a real Windows 10 + Codex multi-subagent end-to-end run with
analysis, implementation, independent review, fix, independent verification, tests, commit, and remote push.

## Daily Router

All adapters route through the shared Daily Router before heavy workflow contracts or agent fan-out:

```text
node "<toolkit-root>/bin/core.mjs" daily-route --stdin
```

Read-only intent is classified before high-risk modification escalation. High-risk terms inside analysis,
review, delivery summary, or pre-push requests stay read-only and are returned with warnings; they do not start
the full implementation pipeline unless the user separately asks for a modification.

```mermaid
flowchart TD
  A["Customer invokes workflow"] --> ROUTE["Shared Daily Router"]
  ROUTE --> B{"Explicit full flow requested?"}

  B -->|"Full Workflow / complete flow / strict audit / independent review+verify"| FULL["Full Workflow"]
  B -->|"Not explicit"| E{"Read-only intent?"}

  E -->|"Analyze / clarify / assess / explain"| ANALYZE["Analysis Flow"]
  E -->|"Review diff / PR / code"| REVIEW["Review Flow"]
  E -->|"Summary / retro / acceptance notes"| SUMMARY["Delivery Summary Flow"]
  E -->|"Pre-push check"| PREPUSH["Pre-Push Check"]
  E -->|"No"| C{"High-risk modification trigger?"}

  C -->|"payment / permission / auth / amount / callback / entitlement / migration / production config / security / delete data / multi-tenant"| FULL
  C -->|"No"| D{"Preparing formal submit / push / customer delivery?"}

  D -->|"Yes"| FDELIVERY["Formal Delivery Flow"]
  D -->|"No"| W{"What modification does the customer want?"}

  W -->|"New feature / page / API"| DEV["Development Flow"]
  W -->|"Bug / error / exception"| BUG["Bugfix Flow"]
  W -->|"Refactor / structural optimization"| REFACTOR["Refactor Flow"]
  W -->|"Commit / push / PR"| PUBLISH["Git Publish Flow"]

  ANALYZE --> A1["Read related files only"]
  A1 --> A2["Output analysis / risks / suggestions"]
  A2 --> STOP["Stop and wait for next customer step"]

  DEV --> D1{"Task size?"}
  D1 -->|"Small change"| FAST["Fast Dev"]
  D1 -->|"Ordinary feature loop"| FEATURE["Feature Dev"]

  FAST --> F1["Read related files"]
  F1 --> F2["Minimal code change"]
  F2 --> F3["Light verification"]
  F3 --> F4["Output changed files / verification / unverified scope"]
  F4 --> STOP

  FEATURE --> FE1["Read related code and necessary docs"]
  FE1 --> FE2["Short plan"]
  FE2 --> FE3["Implement minimal feature loop"]
  FE3 --> FE4["Core path verification"]
  FE4 --> FE5["Output changed files / verification / unverified scope"]
  FE5 --> STOP

  BUG --> B1["Read error / logs / symptom"]
  B1 --> B2["Identify root cause"]
  B2 --> B3["Minimal fix"]
  B3 --> B4["Targeted regression verification"]
  B4 --> B5["Output root cause / fix point / verification"]
  B5 --> STOP

  REFACTOR --> R1["Confirm refactor boundary"]
  R1 --> R2["Identify external behavior protection points"]
  R2 --> R3["Small-step refactor"]
  R3 --> R4["Regression verification"]
  R4 --> R5["Output refactor content / behavior preservation"]
  R5 --> STOP

  REVIEW --> RV1["Read diff / PR / specified files"]
  RV1 --> RV2["Read necessary context"]
  RV2 --> RV3["Output P0 / P1 / P2 findings"]
  RV3 --> STOP

  SUMMARY --> S1["Read current changes"]
  S1 --> S2["Summarize completed work / verification / unverified scope / risks"]
  S2 --> S3["Output delivery summary"]
  S3 --> STOP

  PREPUSH --> PP1["Check branch / remote / status"]
  PP1 --> PP2["Identify this task's files"]
  PP2 --> PP3["Check unrelated files / AGENTS.md / secrets / local config / debug output"]
  PP3 --> PP4["Output readiness / blockers / required confirmation"]
  PP4 --> STOP

  FDELIVERY --> FD1["Gather current changes"]
  FD1 --> FD2["Run necessary verification"]
  FD2 --> FD3["Review current changes"]
  FD3 --> FD4{"Must-fix issues?"}
  FD4 -->|"Yes"| FD5["Fix issues"]
  FD5 --> FD2
  FD4 -->|"No"| FD6["Generate delivery summary"]
  FD6 --> FD7{"Customer asks to push?"}
  FD7 -->|"No"| STOP
  FD7 -->|"Yes"| PUBLISH

  FULL --> FULL1["Full requirement analysis"]
  FULL1 --> FULL2["Full risk analysis"]
  FULL2 --> FULL3["Create plan"]
  FULL3 --> FULL4["Sandbox implementation"]
  FULL4 --> FULL5["Independent review"]
  FULL5 --> FULL6{"Issues found?"}
  FULL6 -->|"Yes"| FULL7["Fix issues"]
  FULL7 --> FULL8["Independent verification"]
  FULL6 -->|"No"| FULL8
  FULL8 --> FULL9["Generate delivery artifacts"]
  FULL9 --> FULL10["Generate delivery summary"]
  FULL10 --> FULL11{"Customer asks to push?"}
  FULL11 -->|"No"| STOP
  FULL11 -->|"Yes"| PUBLISH

  PUBLISH --> P0["Require explicit branch strategy"]
  P0 --> P1["Check git state"]
  P1 --> P2["Identify this task's changed files"]
  P2 --> P3["Exclude unrelated files / AGENTS.md / secrets / local config"]
  P3 --> P4["Show prepared file list"]
  P4 --> P5{"Customer confirms?"}
  P5 -->|"No"| STOP
  P5 -->|"Yes"| P6["Commit"]
  P6 --> P7["Push"]
  P7 --> P8{"PR needed?"}
  P8 -->|"Yes"| P9["Create PR"]
  P8 -->|"No"| P10["Verify remote commit"]
  P9 --> P10
  P10 --> P11["Output branch / commit / PR / remote status"]
  P11 --> STOP
```

## What This Does

For Codex daily work, ordinary development requests implicitly use the `/dev-fast` behavior. The primary
commands are:

| Command | Purpose | Output |
| --- | --- | --- |
| `/dev-fast` | Default fast development for pages, components, CRUD, DTOs, ordinary APIs, small fixes | minimal direct edit, light verification, changed files, unverified scope |
| `/dev-feature` | Ordinary feature path for small modules, API sets, CRUD features, or frontend-backend loops | concise plan, scoped implementation, light verification |
| `/review-changes` | Review the current diff only | findings ordered by severity |
| `/delivery-summary` | Prepare handoff/demo/merge notes | changed files, behavior, checks, risks |
| `/pre-push-check` | Check whether current changes are safe to commit or push | branch/remote, task files, unsafe files, verification gaps, required confirmation |
| `/critical-check` | Escalate high-risk modification work | full plan/sandbox/review/verify artifacts |

Critical triggers include payment, permissions, authentication, amount calculation, third-party callbacks,
entitlements, database migration, production config/data, deletion, security, and multi-tenant isolation. They
escalate modification tasks only; read-only analysis/review/summary/pre-push requests stay read-only with
warnings.

Ordinary database CRUD is not database migration. Normal query, mapper, DTO/VO, pagination, filter, and
non-destructive table read/write changes should use `/dev-fast` or `/dev-feature` unless they also change
schema, migrate data, touch production data, change permissions, or hit another high-risk trigger.

Phrases such as "complete page", "complete CRUD", or "complete feature" do not trigger Full Workflow by
themselves. Price labels, design tokens, JavaScript callbacks, token counts, and pricing-page styling are also
ordinary daily work unless paired with a real high-risk trigger.

## Verification Levels

| Scenario | Recommended verification |
| --- | --- |
| Text, style, small component, small field | `git diff --check`, then the smallest relevant build/lint/test item |
| Ordinary frontend change | build/lint or focused page smoke check covering the core loading, interaction, or error state |
| Ordinary backend change | compile or focused test; smoke one core API when practical |
| Ordinary frontend-backend loop | request parameters, response fields, loading state, error message, and duplicate-submit behavior |
| Before submit, handoff, commit, or push | git status, task-file scope, unsafe files, actual verification commands, delivery summary |
| High-risk modification logic | Full Workflow with analysis, plan, sandbox implementation, independent review, and independent verification |

Daily final responses should stay short:

```text
Changed:
Verified:
Unverified:
Risk:
Files:
```

## Daily Closed-Loop Delivery

When the `ai-engineering-workflow` Skill is explicitly invoked for a modification task, the default result is
not just edited files. The daily closed-loop path is:

```text
implement -> verify -> pre-push check -> commit exact task files -> push normally -> verify remote HEAD
```

This is still the lightweight daily path, not Full Workflow. It does not create formal plan artifacts, use a
sandbox implementation, or require independent review/verification unless the task hits a Full Workflow
trigger.

The loop stops before git writes when:

- the user says not to commit, not to push, not to publish, not to open/create a PR, or asks to only
  check/review/analyze;
- unrelated or unsafe changes cannot be separated confidently;
- required verification fails;
- branch, remote, or publish strategy is ambiguous;
- `AGENTS.md`, `.env`, token/key files, personal config, generated local output, debug logs, or other unsafe
  files would be included;
- the publish target is protected or high risk and needs explicit opt-in.

The publish-intent Pre-Push Check requires an explicit branch strategy. Use:

```text
node "<toolkit-root>/bin/pre-push-check.mjs" --cwd <repo> --branch-mode <current-branch|new-branch|switch-existing>
```

Omitting `--branch-mode` blocks publish readiness with an explicit-branch-strategy reason. Use `--snapshot-only`
only for a non-publish safety snapshot.

## Daily Examples

### Frontend Button, Form, Or Page Change

Use:

```text
/dev-fast
Adjust the order form loading and empty states.
```

Expected behavior: read the related page/component files, make the smallest UI/state change, run build/lint
or state the manual page checks, then report changed files and unverified interactions.

### Ordinary Backend CRUD Or DTO/API Change

Use `/dev-fast` for small field/DTO/query changes, or `/dev-feature` for a small closed CRUD path:

```text
/dev-feature
Add a normal admin CRUD endpoint for coupon categories with pagination.
```

Expected behavior: concise plan, reuse existing controller/service/mapper patterns, compile or run focused
tests, optionally smoke the core API. No independent review or sandbox delivery by default.

### Payment, Permission, Callback, Or Migration

Use:

```text
/critical-check
Change the payment callback idempotency and member entitlement activation flow.
```

Expected behavior: full critical flow with plan artifacts, sandbox delivery, independent review and
verification when available, and explicit remaining risk.

## Formal Pipeline

The formal artifact pipeline is retained for `/critical-check`, explicit formal delivery, and the Claude
adapter:

| Input | Workflow | Output |
| --- | --- | --- |
| A user requirement plus a target repository | `plan-from-requirement` | `final-plan.md`, `plan.json`, risks, tests, and `readinessForDev` |
| A ready plan plus the same target repository | `deliver-from-plan` | sandboxed implementation, `changes.diff`, delivery report, verification notes |
| A verified delivery (diff + `DELIVERED` manifest) plus a git remote | `publish-delivery` | automatic branch/commit/push (no PR) with independent post-push remote verification |
| A repository audit request | `analyze-repo` | evidence-backed risk report and test plan |

The main chain is intentionally split:

1. `plan-from-requirement`: read-only requirement analysis and implementation plan.
2. Human gate: review `final-plan.md`; continue only when `readinessForDev=ready`.
3. `deliver-from-plan`: sandbox implementation from the approved plan.
4. Human gate: inspect `delivery-report.md`, `changes.diff`, and verification notes.
5. `publish-delivery`: optional automatic branch/commit/push when the manifest is `DELIVERED` and the customer
   authorizes publishing.

Run the repository self-check before publishing workflow changes:

```text
node scripts/self-check.mjs
```

Claude Code Dynamic Workflows can also be resumed from a saved workflow script when needed:

```text
Workflow({ scriptPath: "<path-to-workflow.js>" })
```

See [examples/minimal-target](examples/minimal-target/) for the tiny deterministic fixture used by the workflow
artifact tests.
