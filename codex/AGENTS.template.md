# Codex Adapter Guidance (AGENTS.md template)

This template is for a local OpenAI Codex `AGENTS.md` (Desktop or CLI). Generate the real `AGENTS.md` at the
target project root from this template; **keep the generated `AGENTS.md` out of git** — this public
repository tracks only the template. It consumes the platform-neutral contracts under `$AIEW_HOME/core/`
(see **Toolkit Path** below) and must **not** fork the engineering methodology into a second independent
copy. Full stage contracts: `$AIEW_HOME/codex/pipeline.md`.

The **recognizable entry point** is the Codex skill `.agents/skills/ai-engineering-delivery/` — selectable
via `/skills`, mentionable as `$ai-engineering-delivery`, or auto-selected by its `description`. That skill
orchestrates the flow (delegating every deterministic decision to `$AIEW_HOME/bin` + `$AIEW_HOME/scripts`)
and obeys the hard constraints in this `AGENTS.md`.

## Toolkit Path (`$AIEW_HOME`)

This `AGENTS.md` lives in the **customer project**, but the shared toolkit (`core/` + `bin/` + `scripts/` +
`codex/`) lives in the **methodology repo**. Resolve that repo's path into `AIEW_HOME` first; every command
below is `"$AIEW_HOME/..."`, **never a bare `bin/...`** — a bare path would look inside the customer project
(`customer/bin/core.mjs`) and fail. Never reference the toolkit by a relative path like `../core/`.

The Node scripts are cross-platform; only the variable syntax differs by shell:
- macOS / Linux (bash/zsh): `export AIEW_HOME=/path/to/ai-engineering-workflow`; call `node "$AIEW_HOME/bin/core.mjs" ...`
- Windows PowerShell: `$env:AIEW_HOME = "C:\path\to\ai-engineering-workflow"`; call `node "$env:AIEW_HOME\bin\core.mjs" ...`
- Windows CMD: `set AIEW_HOME=C:\path\to\ai-engineering-workflow`; call `node "%AIEW_HOME%\bin\core.mjs" ...`

(The commands below are written in POSIX form; translate the `$AIEW_HOME` reference to your shell.)

## Scope

The complete closed loop, identical in rules/artifacts/statuses to the Claude workflow:
requirement → code-base analysis → plan → coding → tests → independent review → fix → independent verify →
diff → **customer git-choice** → commit → push.

Build it up in verified order: do not claim a stage runnable in Codex until a real `codex exec` run has
produced its artifacts and the stage's validator passes — `validate-plan-artifacts.mjs` (plan) /
`validate-delivery-artifacts.mjs` (delivery) / `validate-publish-record.mjs` (publish), all under
`$AIEW_HOME/scripts/` — plus `node "$AIEW_HOME/scripts/self-check.mjs"`. `plan-from-requirement` (read-only)
is the safe first target; `deliver-from-plan` (sandbox) and `publish-delivery` (git) follow.

## Execution Rules

- One Codex invocation per stage; pass JSON files between stages in a timestamped run directory.
- Use `codex exec` **only** for model work: requirement understanding, code analysis, implementation
  planning, risk identification, test planning, coding, independent review, fixing, independent verification.
- Use plain Node for **all** deterministic work — never ask the model to do bookkeeping (all paths via `$AIEW_HOME`):
  - decisions: `node "$AIEW_HOME/bin/core.mjs" <readiness|deliver-status|publish-status|persist-outcome|repo-fingerprint|project-type|git-guard|branch-choice> '<json>'`
    - Windows PowerShell-safe forms: `node "$env:AIEW_HOME\bin\core.mjs" readiness PASS`, `node "$env:AIEW_HOME\bin\core.mjs" scope-check --input .\scope-check.json`, or `Get-Content .\scope-check.json -Raw | node "$env:AIEW_HOME\bin\core.mjs" scope-check --stdin`
  - git facts (read-only): `node "$AIEW_HOME/bin/git-state.mjs" --cwd <repo> [--mode <m>] [--target-branch <b>]`
  - diff generation: `node "$AIEW_HOME/bin/diff-from-sandbox.mjs" --base <target> --sandbox <sandbox> --out <delivery-dir>/changes.diff`
  - validation per stage: `node "$AIEW_HOME/scripts/validate-plan-artifacts.mjs" <plan-dir>` · `validate-delivery-artifacts.mjs <delivery-dir>` · `validate-publish-record.mjs <publish-dir>`; integrity: `node "$AIEW_HOME/scripts/self-check.mjs"`
- Keep Claude-specific `Workflow`, `phase()`, `agent()`, and resume semantics out of Codex prompts.
- Keep Codex-specific CLI flags and sandbox behavior out of `core/`.
- `plan-from-requirement` and `deliver-from-plan` never modify the target repository (deliver works in a
  sandbox copy and stops at a verified `changes.diff`).

## Customer Git-Choice Gate (publish stage — mandatory)

Before ANY branch op / commit / push:
1. Run `node "$AIEW_HOME/bin/git-state.mjs" --cwd <target> --mode <customer choice if any> --target-branch <name if any>`.
2. If the result's `branchChoice.needsChoice` is true → **stop and ask the customer**, offering **only** the
   options where `available` is true (never show an invalid one, never auto-pick). Treat this as
   `PUBLISH_NEEDS_CHOICE`; do not checkout, branch, commit, or push.
3. Strategies (offered only when valid in the current repo / worktree / HEAD state):
   `new-branch` (cut from current commit) · `switch-existing` (checkout a customer-named existing branch,
   needs `targetBranch`) · `current-branch` (commit on the current branch directly).

## Safety (unchanged across adapters)

Never `git push --force`/`-f`; never delete a remote branch or rewrite history (run every git command past
`node "$AIEW_HOME/bin/core.mjs" git-guard` first). Never stage `.env`/keys/`*.pem`/personal config. Protected branches
(main/master/release) require explicit opt-in. High-risk domains (payment/permission/secret/auth/
irreversible) hit a human gate. Block any change outside the planned SCOPE.

## Delivery Discipline (hard constraints)

- **Only modify SCOPE** — the files the plan declares; any out-of-SCOPE change is blocked.
- **The implementer never self-reviews** — independent review and independent verification are separate
  stages run by a fresh role; coding output is never graded by its own author.
- **Never deliver on failing tests** — the DONE command must pass, and the independent verifier's tests
  (re-materialized from the test-plan, not the in-tree copy) must pass, before a delivery is anything but
  BLOCKED.
- **Customer git-branch choice before any branch op / commit / push** (see the gate above) — never
  auto-decide; offer only options the current environment actually supports.
- **The customer project's existing conventions win** — match its code style, structure, test layout and
  tooling; do not impose this methodology's defaults over established project norms.

## Non-Goals

- No Cursor, Gemini, or generic adapter scaffolding. No UI.
- No duplicated schema/status/decision logic when `core/` already owns the contract — call `bin/`/`core/`.

## Capability Notes (verify before claiming runnable)

The design assumes public Codex support for a root `AGENTS.md` and non-interactive `codex exec`. Mark any
exact command line, `--output-schema`/JSON output mode, or sandbox flag as **verified only after a local
Codex run exercises it** in a real target repository. The deterministic surface (`bin/`, `scripts/`,
`core/`) is plain Node and already verified in this repository.
