# Codex Adapter

This directory defines the OpenAI Codex adapter for AI Engineering Workflow.

Goal: let Codex (Desktop or CLI) run the **complete** workflow — requirement → analysis → plan → coding →
tests → independent review → fix → independent verify → diff → customer git-choice → commit → push — using
the **same** `core/` rules, schemas, statuses, risk gates and report shapes as the Claude adapter, without
changing the Claude implementation and without cloning the methodology into a second tree.

Build it up in verified order, not all at once: a stage is "runnable in Codex" only after a real `codex exec`
run produces its artifacts and validation passes. `plan-from-requirement` (read-only) is the safe first
target; the deterministic surface that the whole pipeline rests on is already verified here. Full stage
contracts and the git-choice gate live in `pipeline.md`.

## Architecture

```text
core/                         # platform-neutral single source of truth (pure, unit-tested)
  schemas/plan-artifacts.schema.json
  status.json
  readiness.mjs deliver-status.mjs publish-status.mjs persist-outcome.mjs
  repo-fingerprint.mjs changed-files.mjs project-type.mjs plan-patch.mjs
  git-state.mjs branch-choice.mjs git-guard.mjs

bin/                          # cross-platform deterministic CLIs (Codex calls these; Win/macOS/Linux)
  git-state.mjs               # read-only git state + valid commit options
  core.mjs                    # dispatcher over every core/ decision

scripts/
  validate-plan-artifacts.mjs # schema validation
  self-check.mjs              # integrity + inline-vs-core parity + unit tests

.claude/workflows/            # Claude Dynamic Workflow adapter (inlines core/ with self-check parity)
  plan-from-requirement.js deliver-from-plan.js publish-delivery.js auto-deliver.js analyze-repo.js

codex/                        # Codex execution shape (no Claude runtime)
  AGENTS.template.md pipeline.md plan-from-requirement.md
```

`core/` owns the shared logic. `bin/` exposes it as cross-platform CLIs so Codex runs the **same** decisions
without any Claude `Workflow`/`agent()` runtime. `.claude/` inlines the same `core/` logic with
`self-check.mjs` parity locks. One source of truth, two adapters.

## First Runnable Target

`plan-from-requirement` should eventually run as independent stages:

1. `preflight`
2. `requirement`
3. `locate`
4. `analyze`
5. `plan`
6. `risk`
7. `test-plan`
8. `review`
9. `assemble`

Each stage reads JSON from the previous stage and writes JSON for the next stage. The final assembled directory must contain:

- `final-plan.md`
- `requirement.json`
- `plan.json`
- `risks.json`
- `test-plan.json`
- `run-manifest.json`

## Validation

Plan artifacts must pass:

```bash
node scripts/validate-plan-artifacts.mjs examples/artifacts/plan-ready
node scripts/self-check.mjs
```

## Verified And Pending

Verified in this repository (plain Node, runs here):

- shared schema validates the existing example plan artifacts; self-check consumes the shared schema;
- Claude workflow files are left behavior-compatible (self-check green; no engine changes);
- the deterministic surface runs and is correct: `bin/git-state.mjs` (git state + valid options),
  `bin/core.mjs <fn>` (every `core/` decision), backed by `core/git-state.mjs` + `core/branch-choice.mjs`
  with unit tests in `scripts/git-state.test.mjs` (10) and `scripts/branch-choice.test.mjs` (12);
- the git-choice gate logic (three strategies, environment-valid options only, detached-HEAD / worktree /
  missing-target handling) is unit-tested and exercised live here.

Pending local Codex verification (not yet exercised — do not claim runnable until proven):

- exact `codex exec` command shape, `--output-schema` sufficiency, and sandbox flags per stage;
- that Codex Desktop reads a root `AGENTS.md` and one-invocation-per-stage is workable end to end;
- a real Codex run that produces a plan/delivery directory passing `validate-plan-artifacts.mjs`;
- the cross-platform CLIs are written with `spawnSync`/argv (no single-shell dep) but have only been run on
  Linux here — Windows/macOS execution is designed, not yet verified.
