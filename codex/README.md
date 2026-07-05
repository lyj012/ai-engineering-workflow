# Codex Adapter

This directory defines the OpenAI Codex adapter for AI Engineering Workflow.

Goal: let Codex (Desktop or CLI) run a mode-based AI Engineering Workflow. Daily tasks use the lightweight
constraint path: relevant context, minimal direct edit, light verification, and concise delivery notes.
Critical tasks can still run the **complete** workflow — requirement → analysis → plan → sandbox coding →
tests → independent review → fix → independent verify → diff → customer git-choice → commit → push — using
the **same** `core/` rules, schemas, statuses, risk gates and report shapes as the Claude adapter, without
changing the Claude implementation and without cloning the methodology into a second tree.

Build formal stages up in verified order, not all at once: a stage is "runnable in Codex" only after a real
`codex exec` run produces its artifacts and validation passes. `plan-from-requirement` (read-only) is the
safe first formal target; the deterministic surface that the critical pipeline rests on is already verified
here. Mode routing, full stage contracts, and the git-choice gate live in `pipeline.md`.

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
  core.mjs                    # dispatcher over every core/ decision, including multi-agent-gate
  execution-context.mjs       # absolute roots + starting workspace snapshot for every subagent

codex/agents/                 # Generated Codex custom subagents (aiew_*), sourced from Claude roles
  aiew_*.toml

scripts/
  validate-plan-artifacts.mjs # schema validation
  self-check.mjs              # integrity + inline-vs-core parity + unit tests

.claude/workflows/            # Claude Dynamic Workflow adapter (inlines core/ with self-check parity)
  plan-from-requirement.js deliver-from-plan.js publish-delivery.js auto-deliver.js analyze-repo.js

.agents/skills/               # Codex skill entry point (scanned by Codex CLI / IDE / Desktop app)
  ai-engineering-workflow/SKILL.md

codex/                        # Codex execution shape (no Claude runtime)
  AGENTS.template.md pipeline.md plan-from-requirement.md
```

`core/` owns the shared logic. `bin/` exposes it as cross-platform CLIs so Codex runs the **same** decisions
without any Claude `Workflow`/`agent()` runtime. `.claude/` inlines the same `core/` logic with
`self-check.mjs` parity locks. One source of truth, two adapters.

## Skill Entry Point (Codex)

`.agents/skills/ai-engineering-workflow/SKILL.md` is the recognizable Codex entry. Codex (CLI / IDE / app)
scans installed/user skills and workspace `.agents/skills`, so a user starts the whole flow via `/skills`
and choosing `ai-engineering-workflow`, by typing `$ai-engineering-workflow`, or by implicit selection from
the skill's `description`.

The skill is the mode router and workflow launcher, not just a guidance document. It resolves this toolkit
from its own installed location by walking upward until `core/`, `bin/`, `scripts/`, and `codex/` are found
when heavy tooling is needed. `AIEW_HOME` is retained only as an optional compatibility override. A target
project's `AGENTS.md` is optional project guidance: read it when present, continue when absent. Fast
Development does not require formal artifacts; Critical Check delegates every status / gate / git /
validation decision to `bin/` + `scripts/` (no logic copied into the prompt).

To use it in a customer project, install this repository's `ai-engineering-workflow` skill once:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex-skill.ps1
```

The default install creates a user-level link under `%USERPROFILE%\.agents\skills\ai-engineering-workflow`.
The Skill resolves the link's real target before walking upward, so it can locate the repository toolkit
without `AIEW_HOME`. For a self-contained copied install, use `-Mode Copy -Force`. After installing, restart
Codex or open a new thread, then open the customer project and invoke the skill. The same installer also
copies generated subagents to `%USERPROFILE%\.codex\agents\aiew_*.toml`; use `/agent` when available to
inspect runtime subagent activity for `/critical-check`. Do not require each project to copy the skill,
generate `AGENTS.md`, or set a toolkit environment variable as normal usage.

## Modes

| Command | Default Scope |
|---|---|
| `/dev-fast` | daily frontend/backend/full-stack edits with light verification |
| `/dev-feature` | ordinary small modules, API sets, CRUD features, or frontend-backend loops |
| `/review-changes` | review current diff only |
| `/delivery-summary` | handoff or merge summary |
| `/critical-check` | formal plan/sandbox/review/verify workflow for high-risk work |

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
  missing-target handling) is unit-tested and exercised live here;
- Windows-safe core input forms are supported: `readiness PASS`, `--input file.json`, and `--stdin`;
- `bin/diff-from-sandbox.mjs` generates applyable `changes.diff` files through an isolated baseline git
  repository instead of relying on `git diff --no-index --label`;
- `bin/core.mjs multi-agent-gate` fails closed when mandatory Codex subagents are unavailable, incomplete,
  non-independent, unverified, or replaced by parent-thread implementation;
- `bin/execution-context.mjs` records stable `workflowRoot` / `projectRoot` / `workspaceRoot` /
  `taskArtifactRoot` values and the starting git snapshot before subagents run;
- the Codex skill `.agents/skills/ai-engineering-workflow/SKILL.md` exists as a real, well-formed entry
  point (valid `name` + `description` frontmatter, the format Codex documents), includes mode routing, and
  every deterministic command it tells Critical Check to run is verified to work here.
- `scripts/install-codex-skill.ps1` installs the user-level Skill entry in link or copied mode.
- `scripts/generate-codex-agents.mjs` generates Codex `aiew_*` subagents from `codex/agent-role-map.json`
  and existing Claude role sources; `scripts/check-agent-parity.mjs` blocks drift.
- Windows 10 + Codex completed one real multi-subagent end-to-end validation against AgentProof, covering
  requirement analysis, repository/risk/test planning, implementation, independent review, fixer repair,
  independent verification, local tests, exact-file commit, remote push, and remote verification.

Still pending broader Codex verification:

- macOS / Linux Codex environments;
- more real projects and technology stacks beyond the AgentProof validation run;
- compatibility across different Codex versions;
- exact `codex exec` command shape, `--output-schema` sufficiency, and sandbox flags where CLI behavior
  changes by Codex version;
- additional long-running smoke runs that confirm generated `aiew_*` subagents remain discoverable through
  `/agent` after install/upgrade cycles.
