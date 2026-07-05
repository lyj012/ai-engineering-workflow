# Codex Mode-Based Adapter

How OpenAI Codex (Desktop and CLI) runs AI Engineering Workflow after the repositioning from a default
full-pipeline executor to a daily development constraint and delivery-record tool.

The default Codex path is now fast development: inspect relevant files, make minimal edits, run practical
verification, and report changed files plus unverified scope. The complete workflow — requirement → analysis
→ plan → coding → tests → independent review → fix → independent verify → diff → customer git-choice →
commit → push — is retained as the Critical Check path for high-risk work or explicit user commands.

When the Codex skill is invoked, the run is in Workflow Mode: this pipeline owns orchestration, subagent
sequencing, validation gates, git-delivery gates, and final status meanings only for the selected mode. The
latest explicit user instruction still wins, target project rules supply project facts/style/build/test
constraints, and global safety rules remain active.

> Current status discipline: the Codex Skill has completed one real Windows 10 + Codex multi-subagent
> end-to-end validation, including analysis, implementation, independent review/fix/verify, tests, commit,
> push, and remote verification. Exact `codex exec` flags, output-schema behavior, sandbox flags, and
> cross-platform compatibility still remain version/environment-sensitive and must be verified per install.
> The deterministic surface below (`bin/`, `scripts/`, `core/`) is plain Node and is verified by self-check.

## 1. The one rule that prevents drift

First choose the mode:

| Command / Trigger | Mode | Contract |
|---|---|---|
| `/dev-fast` or ordinary coding request | Fast Development | direct minimal edit, no mandatory multi-agent review, light verification |
| `/dev-feature` | Feature Development | concise plan, minimal ordinary feature path, light verification |
| `/review-changes` | Review Changes | review current diff only; no feature coding |
| `/delivery-summary` | Delivery Summary | handoff summary; no new implementation |
| `/critical-check` or high-risk trigger | Critical Check | full deterministic artifact, sandbox, multi-agent review/verify contract below |

High-risk triggers include payment, permissions, authentication, amount calculation, third-party callbacks,
member entitlements, database migration, production data/config, security, destructive file/data operations,
and multi-tenant isolation.

Ordinary database CRUD is not database migration. Normal query, mapper, DTO/VO, pagination, filter, and
non-destructive table read/write changes stay in `/dev-fast` or `/dev-feature` unless they also change
schema, migrate data, touch production data, change permissions, or hit another high-risk trigger.

For Fast Development and Feature Development, do not run the full stage map below unless the user explicitly
escalates. The invariant is smaller: task-relevant context only, smallest direct change, practical
verification, changed-file summary, and honest unverified scope.

- **Model work → `codex exec`**: requirement understanding, code-base analysis, implementation planning,
  risk identification, test planning, coding, independent review, fixing, independent verification.
- **Deterministic work → plain Node calling `core/`** (never the model): status/readiness/deliver/publish
  decisions, git-state + branch-choice, JSON validation, diff `git apply --check`, artifact writing.

The full model/deterministic split above is required for Critical Check and formal delivery runs. In Fast
Development, use normal Codex editing plus the target project's own build, lint, test, and smoke commands.

The deterministic decisions are **identical bytes of logic** to what the Claude workflow inlines, because
both call `core/`. Claude inlines `core/` with `// >>> X` parity blocks locked by `scripts/self-check.mjs`;
Codex calls `core/` through the CLIs below. One source of truth.

## 2. Deterministic surface (runnable today, cross-platform)

| Command | Purpose | Backed by |
|---|---|---|
| `node bin/git-state.mjs [--cwd d] [--mode m] [--target-branch b] [--remote r]` | git state (branch / detached HEAD / worktree / dirty) + valid commit options | `core/git-state.mjs`, `core/branch-choice.mjs` |
| `node bin/core.mjs readiness PASS` | plan readiness from final status | `core/readiness.mjs` |
| `node bin/core.mjs deliver-status '<json>'` | delivery final status | `core/deliver-status.mjs` |
| `node bin/core.mjs multi-agent-gate '<json>'` | mandatory Codex Subagent preflight/execution gate | `core/multi-agent-status.mjs` |
| `node bin/core.mjs publish-status '<json>'` | publish final status | `core/publish-status.mjs` |
| `node bin/core.mjs persist-outcome '<json>'` | persist read-back outcome / downgrade | `core/persist-outcome.mjs` |
| `node bin/core.mjs repo-fingerprint '<json>'` | stale-plan detection | `core/repo-fingerprint.mjs` |
| `node bin/core.mjs project-type '<json>'` | web vs non-web (browser-verify scoping) | `core/project-type.mjs` |
| `node bin/core.mjs git-guard '"<command>"'` | red-line git command guard (force-push, delete remote, …) | `core/git-guard.mjs` |
| `node bin/core.mjs branch-choice '<json>'` | resolve the customer commit-strategy choice | `core/branch-choice.mjs` |
| `node bin/core.mjs scope-check '<json>'` | changed files vs the plan's SCOPE | `core/scope-check.mjs` |
| `node bin/execution-context.mjs --workflow-root <w> --project-root <p>` | run-scoped absolute roots + starting workspace snapshot for every subagent | `core/execution-context.mjs` |
| `node bin/sandbox-prepare.mjs --src <t> --dest <s>` | copy target→sandbox; strip history/build/secrets/symlinks | (cross-platform fs) |
| `node bin/diff-from-sandbox.mjs --base <t> --sandbox <s> --out <changes.diff>` | generate portable applyable patch without `git diff --no-index --label` | isolated baseline git repo |
| `node bin/tests-fingerprint.mjs --dir <testsDir>` | canonical, order-independent fingerprint of the tests/ tree (the freeze and the verify-time recompute agree by construction) | `node:crypto` sha256 |
| `node bin/verify-tests.mjs --cwd <d> -- <cmd...>` | run a test/DONE command; report its REAL exit code as the pass/fail fact (no model judgment) | `spawnSync` exit code |
| `node bin/persist-artifacts.mjs --out-base <d> [--ts <s>]` | write a JSON/MD bundle to a fresh timestamped run dir | (cross-platform fs) |
| `node scripts/validate-plan-artifacts.mjs <plan-dir>` | validate PLAN artifacts (requirement/plan/risks/test-plan) | `core/schemas/plan-artifacts.schema.json` |
| `node scripts/validate-delivery-artifacts.mjs <delivery-dir> [--base <clean-base-dir>]` | validate the DELIVERY contract (delivery-manifest.json); `--base` independently re-runs `git apply --check` | `core/schemas/delivery-artifacts.schema.json` |
| `node scripts/validate-publish-record.mjs <publish-dir>` | validate the PUBLISH record (final-delivery.json) | `core/schemas/publish-record.schema.json` |

All read JSON in / print JSON out, run on bare `node` (Windows / macOS / Linux), and contain no author paths.

## 3. Critical Stage Map (same artifacts/statuses as Claude)

This section applies only to `/critical-check`, explicit formal delivery, or high-risk tasks. Each model
stage is one `codex exec` run reading the previous stage's JSON and writing the next stage's JSON into a
timestamped run directory; each deterministic step is a CLI above. The artifact filenames and the schemas
they satisfy are exactly the Claude ones (`core/schemas/plan-artifacts.schema.json`).

At workflow start, the parent must build one stable `execution_context` with `bin/execution-context.mjs`:

```json
{
  "workflowRoot": "<absolute ai-engineering-workflow toolkit root>",
  "projectRoot": "<absolute target project root>",
  "workspaceRoot": "<absolute current target workspace or sandbox root>",
  "taskArtifactRoot": "<absolute run artifact directory, or empty string before it exists>",
  "changedFiles": [],
  "workspaceBaseline": {
    "branch": "",
    "head": "",
    "statusShort": "",
    "diffStat": "",
    "untrackedFiles": []
  }
}
```

The parent must inject this object into every subagent prompt and update only the fields that actually
change, such as `workspaceRoot`, `taskArtifactRoot`, and `changedFiles`. Subagents must use these absolute
paths and must not infer or search for the workflow root. Starting and ending workspace snapshots are
compared in the final report so pre-existing user files are not mislabeled as workflow output.

Codex model stages must run through real Codex custom subagents from `codex/agents/aiew_*.toml`, generated
from `codex/agent-role-map.json`. The parent skill is an orchestrator only: spawn the mapped agent, wait for
it, validate its result, and record the execution. It must not simulate semantic roles in the parent thread.

Before any target business, test, or config file can be modified, the parent skill must run
`MULTI_AGENT_PREFLIGHT`: load the Claude-to-Codex role map, verify required `aiew_*` agents are installed and
discoverable, verify the runtime can spawn subagents, create and validate the first required subagent
response, initialize `agent-execution.json`, and record the workspace baseline (`git status --short`,
`git diff`, untracked files, current branch, and `HEAD`). A failed preflight stops the workflow before
planning-to-implementation handoff; the parent must not take over as a single-agent implementer.

Required failure modes:

- required subagent missing / spawn failed / result invalid -> `BLOCKED_MULTI_AGENT_UNAVAILABLE`;
- parent thread performs subagent-reserved code, review, fix, verify, browser verify, or publish work ->
  `BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION`;
- parent thread modified project code before a real Implementer completed ->
  `BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION` / `PARENT_AGENT_IMPLEMENTED_BEFORE_IMPLEMENTER_SPAWN`;
- only Reviewer ran, or any of analysis / implementation / review / verification is missing ->
  `BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION`;
- implementation exists but no independent Reviewer completed ->
  `BLOCKED_MISSING_INDEPENDENT_REVIEWER`;
- implementation or tests were run without an independent Verifier ->
  `BLOCKED_MISSING_INDEPENDENT_VERIFIER`;
- `multiAgent.required === true` and `multiAgent.executed !== true` -> BLOCKED;
- `fallbackUsed === true` -> BLOCKED.

Each plan/delivery/publish run must write `agent-execution.json` or embed the same `multiAgent` record in
the manifest. Runtime thread IDs are recorded only when Codex exposes them; otherwise use `null`.
Unknown IDs are not success evidence by themselves; each role also needs `spawned`, `completed`, and
`resultValidated` to be true. If Codex cannot provide verifiable execution evidence, mark the role
`unverified=true` and block instead of inventing a successful run.

Run the pure gate whenever `agent-execution.json` or a manifest is assembled:

```bash
node bin/core.mjs multi-agent-gate --input <json-file>
node bin/core.mjs deliver-status --input <json-file>
```

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
- The exact normalized object passed to `bin/core.mjs deliver-status` must be persisted verbatim as
  `delivery-manifest.json.statusInput`. The manifest must also carry the top-level mirror fields
  (`independentVerify`, `reviewVerdicts`, `scopeViolations`, `filesReconcileIssues`, `filesChanged`,
  `diffApplyCheckPassed`, `deliveryPersisted`, `browserVerify`, `codeQuality`) so
  `scripts/validate-delivery-artifacts.mjs` can recompute the status and reject any top-level/statusInput
  drift. Do not reconstruct this object later from report prose.
- **Stops at a verified `changes.diff` + `delivery-manifest.json`. No commit, no push.** (Same as Claude.)
- Subagents: `aiew_test_materializer`, `aiew_implementer`, `aiew_independent_reviewer`, `aiew_fixer`,
  `aiew_delivery_verifier`, `aiew_browser_verifier` when applicable, and `aiew_verification_runner` for
  safe command execution.
- Verifier inputs are self-contained: goal, acceptance criteria, changed files, allowed commands,
  project/sandbox root, no-code-modification rule, and evidence schema. Verifiers must not rediscover the
  workflow installation just to run tests.

### 3c. publish-delivery / Git Delivery (git — the only stage that writes git)
`DELIVERED` is a local verified diff, not a remote delivery. Before any git write, the workflow must compare
the starting and ending workspace snapshots, identify exactly which files belong to this task, exclude
pre-existing unrelated changes and untracked files, reject `AGENTS.md` / secrets / personal config /
out-of-scope files, and present the exact file list plus change summary to the user. Until the user confirms
commit/push, the status is `PUBLISH_READY`.

**Customer git-choice gate runs FIRST, before any branch op / commit / push:**
1. `node bin/git-state.mjs --cwd <target> --mode <customer's choice or omitted> --target-branch <name>`.
2. If `branchChoice.needsChoice === true` → **STOP and ask the customer**, presenting **only**
   `branchChoice.availableOptions` where `available === true` (req 9: never show an invalid option, never
   auto-decide). Record the result as `PUBLISH_NEEDS_CHOICE`. Do **not** checkout / branch / commit / push.
   The three strategies (offered only when valid in the current repo):
   - `new-branch` — cut a fresh branch from the current commit, then commit/push;
   - `switch-existing` — checkout a customer-named existing branch (`targetBranch`), then commit/push;
   - `current-branch` — stay on the current branch and commit/push directly.
3. Once a valid choice and explicit publish confirmation are in, proceed: clone/prepare → branch op per
   choice → `git apply` the verified diff → stage exact pathspecs only (never `git add .`) → commit (reject
   staging `.env`/keys/personal config) → push (**never `--force`**; the agent must screen
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

Completion meanings are intentionally separate:

- `DELIVERED`: local verified diff exists.
- `PUBLISH_READY`: verified delivery is ready for exact-file git delivery but awaits user confirmation.
- `PUBLISHED`: commit + normal push + independent remote verification completed.
- `PUBLISH_BLOCKED` / `PUBLISH_UNVERIFIED`: local implementation may be complete, but remote delivery is not.

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
4. For daily work, use `/dev-fast` or just enter the development requirement. The skill reads only relevant
   repository context, edits directly, and runs light verification.
5. Use `/dev-feature` for a normal small module, API set, CRUD feature, or frontend-backend loop that needs a
   concise plan but not full review machinery.
6. Use `/review-changes` when you want review only, `/delivery-summary` for handoff notes, and
   `/critical-check` for the full analysis → plan → sandbox code → test → review → fix → verify loop.
7. At any publish stage Codex stops at the **git-choice gate** and asks you to pick a valid strategy before
   any commit/push.

## 7. Capability assumptions — verify per environment (req 14)

Verified: one Windows 10 + Codex run has exercised the full multi-subagent loop through commit, push, and
remote verification. Still pending broader evidence: macOS / Linux Codex environments, more real projects
and technology stacks, different Codex versions, and long-running install/upgrade smoke runs that confirm
generated `aiew_*` agents remain discoverable.

Per the repo discipline: a new environment should not be called validated until a real Codex run has
produced artifacts that pass the matching validator (`validate-plan-artifacts.mjs` for plan,
`validate-delivery-artifacts.mjs` for delivery, `validate-publish-record.mjs` for the publish record) plus
`node scripts/self-check.mjs`.

Windows note: PowerShell 5 may strip JSON quotes in inline arguments. Use `node bin/core.mjs readiness PASS`
for simple status values and `--input file.json` or `--stdin` for objects, for example
`node bin/core.mjs scope-check --input .\scope-check.json`.
