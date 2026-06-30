# Codex Full-Pipeline Adapter

How OpenAI Codex (Desktop and CLI) runs the **complete** workflow — requirement → analysis → plan →
coding → tests → independent review → fix → independent verify → diff → customer git-choice → commit →
push — using the **same** `core/` rules, schemas, statuses, risk gates and report shapes as the Claude
Dynamic Workflow adapter. No second methodology, no Claude-specific runtime.

> First-phase status discipline (kept from `README.md`): treat any exact `codex exec` flag, output-schema
> mode, or sandbox flag as **assumed** until a local Codex smoke run proves it in this repository. The
> deterministic surface below (`bin/`, `scripts/`, `core/`) is plain Node and is already verified here.

## 1. The one rule that prevents drift

- **Model work → `codex exec`**: requirement understanding, code-base analysis, implementation planning,
  risk identification, test planning, coding, independent review, fixing, independent verification.
- **Deterministic work → plain Node calling `core/`** (never the model): status/readiness/deliver/publish
  decisions, git-state + branch-choice, JSON validation, diff `git apply --check`, artifact writing.

The deterministic decisions are **identical bytes of logic** to what the Claude workflow inlines, because
both call `core/`. Claude inlines `core/` with `// >>> X` parity blocks locked by `scripts/self-check.mjs`;
Codex calls `core/` through the CLIs below. One source of truth.

## 2. Deterministic surface (runnable today, cross-platform)

| Command | Purpose | Backed by |
|---|---|---|
| `node bin/git-state.mjs [--cwd d] [--mode m] [--target-branch b] [--remote r]` | git state (branch / detached HEAD / worktree / dirty) + valid commit options | `core/git-state.mjs`, `core/branch-choice.mjs` |
| `node bin/core.mjs readiness PASS` | plan readiness from final status | `core/readiness.mjs` |
| `node bin/core.mjs deliver-status '<json>'` | delivery final status | `core/deliver-status.mjs` |
| `node bin/core.mjs publish-status '<json>'` | publish final status | `core/publish-status.mjs` |
| `node bin/core.mjs persist-outcome '<json>'` | persist read-back outcome / downgrade | `core/persist-outcome.mjs` |
| `node bin/core.mjs repo-fingerprint '<json>'` | stale-plan detection | `core/repo-fingerprint.mjs` |
| `node bin/core.mjs project-type '<json>'` | web vs non-web (browser-verify scoping) | `core/project-type.mjs` |
| `node bin/core.mjs git-guard '"<command>"'` | red-line git command guard (force-push, delete remote, …) | `core/git-guard.mjs` |
| `node bin/core.mjs branch-choice '<json>'` | resolve the customer commit-strategy choice | `core/branch-choice.mjs` |
| `node bin/core.mjs scope-check '<json>'` | changed files vs the plan's SCOPE | `core/scope-check.mjs` |
| `node bin/sandbox-prepare.mjs --src <t> --dest <s>` | copy target→sandbox; strip history/build/secrets/symlinks | (cross-platform fs) |
| `node bin/diff-from-sandbox.mjs --base <t> --sandbox <s> --out <changes.diff>` | generate portable applyable patch without `git diff --no-index --label` | isolated baseline git repo |
| `node bin/tests-fingerprint.mjs --dir <testsDir>` | canonical, order-independent fingerprint of the tests/ tree (the freeze and the verify-time recompute agree by construction) | `node:crypto` sha256 |
| `node bin/verify-tests.mjs --cwd <d> -- <cmd...>` | run a test/DONE command; report its REAL exit code as the pass/fail fact (no model judgment) | `spawnSync` exit code |
| `node bin/persist-artifacts.mjs --out-base <d> [--ts <s>]` | write a JSON/MD bundle to a fresh timestamped run dir | (cross-platform fs) |
| `node scripts/validate-plan-artifacts.mjs <plan-dir>` | validate PLAN artifacts (requirement/plan/risks/test-plan) | `core/schemas/plan-artifacts.schema.json` |
| `node scripts/validate-delivery-artifacts.mjs <delivery-dir>` | validate the DELIVERY contract (delivery-manifest.json) | `core/schemas/delivery-artifacts.schema.json` |
| `node scripts/validate-publish-record.mjs <publish-dir>` | validate the PUBLISH record (final-delivery.json) | `core/schemas/publish-record.schema.json` |

All read JSON in / print JSON out, run on bare `node` (Windows / macOS / Linux), and contain no author paths.

## 3. Stage map (same artifacts/statuses as Claude)

Each model stage is one `codex exec` run reading the previous stage's JSON and writing the next stage's
JSON into a timestamped run directory; each deterministic step is a CLI above. The artifact filenames and
the schemas they satisfy are exactly the Claude ones (`core/schemas/plan-artifacts.schema.json`).

Codex model stages must run through real Codex custom subagents from `codex/agents/aiew_*.toml`, generated
from `codex/agent-role-map.json`. The parent skill is an orchestrator only: spawn the mapped agent, wait for
it, validate its result, and record the execution. It must not simulate semantic roles in the parent thread.

Required failure modes:

- required subagent missing / spawn failed / result invalid -> `BLOCKED_MULTI_AGENT_UNAVAILABLE`;
- parent thread performs subagent-reserved code, review, fix, verify, browser verify, or publish work ->
  `BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION`;
- `multiAgent.required === true` and `multiAgent.executed !== true` -> BLOCKED;
- `fallbackUsed === true` -> BLOCKED.

Each plan/delivery/publish run must write `agent-execution.json` or embed the same `multiAgent` record in
the manifest. Runtime thread IDs are recorded only when Codex exposes them; otherwise use `null`.

### 3a. plan-from-requirement (read-only — never writes the target)
`preflight → requirement → locate → analyze → gap → plan → risk → test-plan → review → (rework) → assemble`
- Deterministic: triage routing, `readiness` from final status (`bin/core readiness`), artifact validation,
  `run-manifest.json` assembly, `final-plan.md`. A plan is `readinessForDev=ready` only per
  `core/status.json` rules; materially-ambiguous requirements emit `NEEDS_CLARIFICATION`, not a guess.
- Subagents: `aiew_requirement_analyst`, `aiew_repo_analyst`, `aiew_solution_architect`,
  `aiew_risk_auditor`, `aiew_test_planner`, and `aiew_independent_reviewer`.

### 3b. deliver-from-plan (sandbox — never writes the target)
`readiness gate → scaffold(sandbox copy, strip .git + secrets) → materialize tests(red→green) → implement →
independent review → fix → independent verify(re-materialize tests from test-plan) → deliver-status → diff`
- Deterministic: the readiness gate (`bin/core readiness` / `status-combo`), `deliver-status`
  (`bin/core deliver-status`), `bin/tests-fingerprint.mjs` (freeze + verify-time tests-integrity fingerprint)
  and `bin/verify-tests.mjs` (DONE / red-green / independent re-test pass-fail decided by the real exit code,
  not a model's self-report), `bin/diff-from-sandbox.mjs` for `changes.diff`, and the final `git apply --check`.
- **Stops at a verified `changes.diff` + `delivery-manifest.json`. No commit, no push.** (Same as Claude.)
- Subagents: `aiew_test_materializer`, `aiew_implementer`, `aiew_independent_reviewer`, `aiew_fixer`,
  `aiew_delivery_verifier`, `aiew_browser_verifier` when applicable, and `aiew_verification_runner` for
  safe command execution.

### 3c. publish-delivery (git — the only stage that writes git)
**Customer git-choice gate runs FIRST, before any branch op / commit / push:**
1. `node bin/git-state.mjs --cwd <target> --mode <customer's choice or omitted> --target-branch <name>`.
2. If `branchChoice.needsChoice === true` → **STOP and ask the customer**, presenting **only**
   `branchChoice.availableOptions` where `available === true` (req 9: never show an invalid option, never
   auto-decide). Record the result as `PUBLISH_NEEDS_CHOICE`. Do **not** checkout / branch / commit / push.
   The three strategies (offered only when valid in the current repo):
   - `new-branch` — cut a fresh branch from the current commit, then commit/push;
   - `switch-existing` — checkout a customer-named existing branch (`targetBranch`), then commit/push;
   - `current-branch` — stay on the current branch and commit/push directly.
3. Once a valid choice is in, proceed: clone/prepare → branch op per choice → `git apply` the verified diff →
   commit (reject staging `.env`/keys/personal config) → push (**never `--force`**; the agent must screen
   every git command with `bin/core git-guard` first — on the Codex side this is a **convention**, not a
   runtime block; only the Claude adapter has a PreToolUse hook that enforces the same red lines at runtime)
   → independent remote verify → `publish-status` (`bin/core publish-status`).
- Safety unchanged (req 10): no force-push, no secret commit, protected-branch block (main/master/release
  need explicit opt-in), high-risk-domain human gate, SCOPE-overflow block.
- Subagents: `aiew_publisher` for isolated publish writer stages and `aiew_remote_publish_verifier` for
  independent remote verification. Git red-line checks remain deterministic via `bin/core.mjs git-guard`.

## 4. Output parity (req 11)

Codex and Claude emit the same fields because they come from the same `core/` + `core/status.json` +
`core/schemas/`:
- `finalStatus` (plan / delivery / publish / auto enums in `core/status.json`);
- `delivery-manifest.json`, `publish-report.md`, `execution-log.md`;
- the git branch-choice record (`branchChoice.resolvedMode` + original vs final branch + created/switched).

## 5. Local repos & worktrees, detached HEAD, cross-platform (reqs 5/6/12)

`bin/git-state.mjs` reports `isWorktree` (linked worktree when `git-dir ≠ git-common-dir`), `detachedHead`,
`currentBranch`, `unbornBranch`, `dirty`. `core/branch-choice.mjs` then withholds invalid options (e.g.
`current-branch` on a detached HEAD; `switch-existing` when the target branch exists neither locally nor on
the remote). Git is invoked as an argv array via `spawnSync` (no single-shell dependency), so the same
commands run on Windows and macOS.

## 6. How a user starts it in Codex Desktop

1. Open the customer project in Codex Desktop.
2. If the Skill has not been installed on this machine, run
   `powershell -ExecutionPolicy Bypass -File <toolkit-root>\scripts\install-codex-skill.ps1`, then restart
   Codex or open a new thread.
3. Select `/skills -> ai-engineering-workflow`, or type `$ai-engineering-workflow`.
4. Enter the development requirement. The skill reads the current repository, optional project guidance such
   as `AGENTS.md` when present, and runs the analysis → plan → code → test → review → fix → verify loop.
5. At the publish stage Codex stops at the **git-choice gate** and asks you to pick a valid strategy before
   any commit/push.

## 7. Capability assumptions — verify locally before claiming runnable (req 14)

Assumed and **pending a local Codex smoke run**: exact Codex Desktop `/skills` refresh/discovery behavior
after installation; the exact `codex exec` invocation and output-schema/sandbox flags; that one skill
invocation can drive the complete loop end to end with bounded internal stages.
Per the repo discipline: **do not claim the Codex adapter is runnable until a real Codex run has produced a
plan/delivery directory that passes the matching validator** (`validate-plan-artifacts.mjs` for plan,
`validate-delivery-artifacts.mjs` for delivery, `validate-publish-record.mjs` for the publish record) **+
`node scripts/self-check.mjs`.** The deterministic surface (`bin/`, `scripts/`, `core/`) is already verified
in this repository.

Windows note: PowerShell 5 may strip JSON quotes in inline arguments. Use `node bin/core.mjs readiness PASS`
for simple status values and `--input file.json` or `--stdin` for objects, for example
`node bin/core.mjs scope-check --input .\scope-check.json`.
