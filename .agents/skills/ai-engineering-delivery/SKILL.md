---
name: ai-engineering-delivery
description: >-
  Use to take a real customer requirement through the full engineered delivery pipeline in a target git
  repository: requirement analysis → code-base analysis → implementation plan → sandboxed coding → tests →
  independent review & fix → independent verification → diff delivery → customer git-branch choice → commit →
  push. Trigger when the user wants this whole flow (or any later stage from an existing plan/delivery dir).
  Do NOT trigger for trivial one-line edits, pure questions, or tasks needing no plan/sandbox/review.
---

# AI Engineering Delivery (Codex)

This skill is the **Codex entry point** for the shared AI-engineering workflow. It is the **same**
methodology, rules, schemas, statuses and report shapes as the Claude `.claude/workflows` adapter — because
all of them call the **one** shared deterministic core. This skill only orchestrates; it must not re-decide
anything the core already decides, and must not copy business logic into the prompt.

## 0. Prerequisites (resolve once, fail loudly if missing)

- The shared toolkit (this methodology repo: `core/` + `bin/` + `scripts/` + `codex/`) must be available.
  Resolve its path into `AIEW_HOME`: use `$AIEW_HOME` if set, else the repo that contains this skill, else
  ask the user for the checkout path. All deterministic calls below use `"$AIEW_HOME/..."`.
- A project `AGENTS.md` (generated from `$AIEW_HOME/codex/AGENTS.template.md`) carries the **hard
  constraints**. Read it first and obey it; it overrides anything here on conflict.
- Sanity-check the toolkit: `node "$AIEW_HOME/scripts/self-check.mjs"` must pass before relying on it.

## 1. Deterministic surface — ALWAYS call these, NEVER hand-judge them

Every status, gate, git fact and validation is decided by code, not by you. Run the command and use its
JSON verdict verbatim. (This is what keeps Codex and Claude from drifting.)

| Need | Command |
|---|---|
| git state (branch / detached HEAD / worktree / dirty) + valid commit options | `node "$AIEW_HOME/bin/git-state.mjs" --cwd <repo> [--mode <m>] [--target-branch <b>]` |
| plan readiness | `node "$AIEW_HOME/bin/core.mjs" readiness '"<finalStatus>"'` |
| delivery / publish / persist status | `node "$AIEW_HOME/bin/core.mjs" <deliver-status|publish-status|persist-outcome> '<json>'` |
| stale-plan detection | `node "$AIEW_HOME/bin/core.mjs" repo-fingerprint '<json>'` |
| project type (web vs not, for browser-verify) | `node "$AIEW_HOME/bin/core.mjs" project-type '<json>'` |
| git red-line guard (run BEFORE every git command) | `node "$AIEW_HOME/bin/core.mjs" git-guard '"<command>"'` |
| branch-choice resolution | `node "$AIEW_HOME/bin/core.mjs" branch-choice '<json>'` |
| validate a plan/delivery artifact dir against the shared schema | `node "$AIEW_HOME/scripts/validate-plan-artifacts.mjs" <dir>` |

You do the **judgment** work (understanding, analysis, planning, coding, review, fixing, verifying); the
CLIs do the **decisions**. If you ever feel like computing a status or a branch option in your head — stop
and call the CLI instead.

## 2. Stages, I/O and completion (full contracts: `$AIEW_HOME/codex/pipeline.md`)

Run one model stage at a time, passing JSON files between stages in a timestamped run dir. Artifact names
and schemas are exactly the Claude ones (`$AIEW_HOME/core/schemas/`). Detailed per-stage contracts,
reference checklists and the requirement→plan flow live in `codex/pipeline.md` and
`codex/plan-from-requirement.md` — read them, do not restate them here.

1. **plan-from-requirement** (read-only, never touches the target) → `requirement/plan/risks/test-plan.json`
   + `final-plan.md` + `run-manifest.json`. **Done** when `readiness` (from `bin/core readiness`) is `ready`
   and `validate-plan-artifacts.mjs` passes. Materially-ambiguous requirements → `NEEDS_CLARIFICATION`
   (pause, ask), not a guessed plan.
2. **deliver-from-plan** (sandbox copy, never touches the target) → scaffold (strip `.git`+secrets) →
   materialize tests (red→green) → implement → independent review → fix → independent verify (re-materialize
   tests from test-plan) → `changes.diff` + `delivery-manifest.json`. **Status** from `bin/core
   deliver-status`. **Stops at the verified diff. No commit, no push.**
3. **publish-delivery** (the only stage that writes git) → see §3 gate first → clone/prepare → branch op →
   `git apply` the verified diff → commit → push → independent remote verify. **Status** from `bin/core
   publish-status`.

## 3. STOP and ask the customer — these are mandatory pauses

- **NEEDS_CLARIFICATION**: a materially-ambiguous requirement (API/data/security/permission/migration/
  destructive). Pause and ask before planning.
- **High-risk domain** (payment / permission / secret / auth / irreversible): pause for human confirmation
  before auto-publishing.
- **Customer git-branch choice (before ANY branch op / commit / push)** — REQUIRED:
  1. Run `node "$AIEW_HOME/bin/git-state.mjs" --cwd <target> --mode <customer's choice if given> --target-branch <name if given>`.
  2. If `branchChoice.needsChoice` is true → **stop and ask**, offering **only** the options where
     `available` is true (never show an invalid option; never pick for the customer):
     - `new-branch` — new branch from the current commit;
     - `switch-existing` — checkout a customer-named existing branch (needs `targetBranch`);
     - `current-branch` — commit on the current branch directly.
  3. Do **not** create/switch a branch, commit, or push until a valid choice comes back.

## 4. Hard constraints — obey AGENTS.md

`AGENTS.md` (from `codex/AGENTS.template.md`) is authoritative: only modify SCOPE; implementer never
self-reviews (review/verify are independent stages); never deliver on failing tests; never `git push
--force`; never commit `.env`/keys/personal config; customer git-choice before any git op; the customer
project's existing conventions win over defaults.

## 5. Honesty

Never report a stage as passing without the deterministic check that proves it (DONE command, validator,
remote verify). Never claim a status you did not get from `bin/core`/`bin/git-state`. If a capability is not
actually exercised, say so.
