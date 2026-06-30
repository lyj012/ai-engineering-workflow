---
name: ai-engineering-workflow
description: >-
  An autonomous software engineering workflow that takes one user requirement through repository analysis,
  implementation planning, coding, tests, independent review, fix loops, verification, and final delivery.
  Use for feature work, bug fixes, refactors, tests, and non-trivial engineering tasks when Codex should
  actively complete the workflow instead of only giving advice or guidelines.
---

# AI Engineering Workflow (Codex)

This skill is the Codex entry point for the shared AI Engineering Workflow. After the user selects
`ai-engineering-workflow` from `/skills` or invokes `$ai-engineering-workflow`, continue from the user's
natural-language requirement and run the full engineering loop by default:

`requirement -> repository analysis -> impact/risk analysis -> plan -> code -> tests -> independent review -> fix loop -> verification -> final delivery`.

Do not ask the user for a toolkit path, a skill path, `AIEW_HOME`, or a generated project `AGENTS.md` before
starting. Read project guidance when it exists, but treat it as optional project context, not as the workflow
launcher.

## 0.0 Workflow Mode Authority

When this skill is invoked, the current turn enters Workflow Mode:

- the engineering flow, subagent sequencing, validation gates, commit gate, and push gate are governed by
  this workflow contract;
- the user's latest explicit instruction still has highest priority;
- target project rules provide project facts, coding style, build/test commands, and safety constraints, but
  they do not replace this workflow's orchestration contract;
- global safety rules still apply, including no `git add`, `git commit`, or `git push` without explicit user
  confirmation.

Do not let a subagent reinterpret the run as an ordinary single-agent coding task.

## 0. Resolve The Toolkit Root

Resolve the toolkit root once, then use absolute paths derived from it for every deterministic command.

Priority:

1. If this skill is installed inside the `ai-engineering-workflow` repository, locate the repository root by
   resolving the real path of this `SKILL.md` first (follow symlinks/junctions), then walking upward until
   `core/`, `bin/`, `scripts/`, and `codex/` all exist.
2. If the user explicitly provides a toolkit path for this run, use it.
3. If `AIEW_HOME` is set, use it as a backwards-compatible override.
4. If none of the above locates the toolkit root, stop with a clear installation error. Do not ask for
   `AIEW_HOME` as normal setup.

The toolkit root is either the repository root that contains `core/`, `bin/`, `scripts/`, `codex/`, and this
skill's `.agents/skills/ai-engineering-workflow/SKILL.md` entry, or a self-contained user-level skill package
that contains `SKILL.md` alongside `core/`, `bin/`, `scripts/`, and `codex/`. Never hard-code a
machine-specific path.

Run the deterministic self-check before relying on the toolkit in a new environment:

```bash
node "<toolkit-root>/scripts/self-check.mjs"
```

If self-check fails, report the failure and continue only with the parts that are still safe and explicit.

## 0.1 Load And Obey The Pipeline Contract

After resolving `<toolkit-root>`, read these files before planning or coding:

1. `<toolkit-root>/codex/pipeline.md`
2. `<toolkit-root>/codex/plan-from-requirement.md`
3. `<toolkit-root>/codex/agent-role-map.json`

Treat them as the execution contract for this skill. Do not simplify the workflow into a normal direct-edit
coding task. The required shape is:

`plan-from-requirement (read-only) -> validated plan artifacts -> deliver-from-plan (sandbox only) -> independent review/fix/verify -> validated delivery artifacts + changes.diff -> optional publish`.

If this `SKILL.md` conflicts with those contracts, follow the contract files and report the mismatch.

## 0.1.1 Build Stable Execution Context

Before spawning any subagent, build one run-scoped execution context with absolute paths:

```bash
node "<toolkit-root>/bin/execution-context.mjs" \
  --workflow-root "<toolkit-root>" \
  --project-root "<target-project-root>" \
  --workspace-root "<target-project-root>" \
  --task-artifact-root "<plan-or-delivery-run-dir>"
```

The resulting `execution_context` must be passed verbatim to every subagent prompt:

```text
execution_context:
  workflowRoot: <absolute toolkit root>
  projectRoot: <absolute target project root>
  workspaceRoot: <absolute current workspace or sandbox root>
  taskArtifactRoot: <absolute artifact directory, or empty string before it exists>
  changedFiles: [...]
  workspaceBaseline:
    branch: ...
    head: ...
    statusShort: ...
    diffStat: ...
    untrackedFiles: [...]

Do not infer or search for the workflow root.
Use the exact absolute paths supplied above.
```

`WORKFLOW_ROOT`, `PROJECT_ROOT`, and `TASK_ARTIFACT_ROOT` are protocol values, not things a subagent should
rediscover. If a subagent reports that it cannot find the workflow, treat that as missing execution context,
not as a reason for the parent thread to implement or verify directly.

## 0.2 Mandatory Multi-Agent Preflight And Codex Subagents

This workflow requires real Codex subagent threads for every semantic stage in
`<toolkit-root>/codex/agent-role-map.json`.

Before modifying any project file, run the mandatory `MULTI_AGENT_PREFLIGHT`. This is a hard gate, not a
recommendation. It must:

1. load `<toolkit-root>/codex/agent-role-map.json`;
2. decide which mapped roles this mode requires;
3. confirm the mapped `aiew_*` Codex agents are installed and discoverable;
4. confirm the current Codex environment can spawn subagents;
5. spawn the first required real subagent and wait for a valid response;
6. initialize `agent-execution.json`;
7. record the starting workspace baseline: `git status --short`, `git diff`, untracked files, branch, and
   `HEAD`;
8. attach the same `execution_context` to the preflight record;
9. switch the parent thread into orchestrator-only mode.

If preflight cannot prove these facts, stop immediately with
`finalStatus=BLOCKED_MULTI_AGENT_UNAVAILABLE`. Do not modify business code, tests, config, docs for the
target task, or run the implementation phase. Do not silently fall back to single-agent execution.

The parent Codex agent may only orchestrate:

- load contracts and project context;
- run deterministic Node CLIs;
- Spawn the mapped Codex custom agent;
- give the subagent only the inputs allowed for its stage;
- include the stable `execution_context` with absolute `workflowRoot`, `projectRoot`, `workspaceRoot`, and
  `taskArtifactRoot`;
- Wait for that agent to complete;
- validate the returned structure/artifact;
- record execution evidence;
- decide the next gate from deterministic status code;
- ask the user only for clarification or git-choice gates.

The parent Codex agent must not:

- write business code;
- use `apply_patch` or file-writing shell commands for target business/test/config changes;
- simulate Implementer, Reviewer, Fixer, Verifier, Browser Verifier, or Publisher roles in the parent thread;
- implement, fix, review, or verify project code itself;
- replace a failed subagent with parent-agent work;
- call a second "perspective" in the same thread and claim it is independent;
- let Implementer review or verify its own work.

For every semantic stage:

1. Spawn the mapped `aiew_*` Codex custom agent from `codex/agent-role-map.json`.
2. Wait for completion.
3. Validate the result against the stage schema or artifact contract.
4. Record that the agent actually ran in `agent-execution.json`.
5. Continue only when the stage gate passes.

If any required Codex subagent is missing, cannot be spawned, fails to complete, or returns an invalid result,
stop with `finalStatus=BLOCKED_MULTI_AGENT_UNAVAILABLE`. If the parent agent performs work reserved for a
subagent, stop with `finalStatus=BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION`.

Specific hard failures:

- parent thread modifies project code before a real Implementer subagent completes:
  `BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION` with reason
  `PARENT_AGENT_IMPLEMENTED_BEFORE_IMPLEMENTER_SPAWN`;
- parent thread runs implementation tests without a real independent Verifier:
  `BLOCKED_MISSING_INDEPENDENT_VERIFIER`;
- only a Reviewer was spawned, or analysis/implementation/verification roles are missing:
  `BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION`;
- implementation evidence exists but no independent Reviewer completed:
  `BLOCKED_MISSING_INDEPENDENT_REVIEWER`;
- implementation/review evidence exists but no independent Verifier completed:
  `BLOCKED_MISSING_INDEPENDENT_VERIFIER`.

Only creating a Reviewer does not mean the multi-agent workflow ran. A post-hoc Reviewer cannot repair or
legitimize a parent-thread implementation that happened before the Implementer subagent was spawned. Such
changes are untrusted candidate changes, not valid workflow delivery.

Required independence:

- Implementer, Reviewer, Fixer, and Verifier must be different subagent executions.
- Fix after review must be followed by a fresh Reviewer execution or a clearly new independent reviewer thread.
- Verifier must not trust Implementer/Fixer self-reports; it must rerun tests and deterministic checks.
- The independent review stage and independent verification stage must be separate real subagent executions.
- Lite / Standard / Deep review lenses must follow `codex/pipeline.md` and `deliver-from-plan` semantics.
- Read-only reviewers may run in parallel; write agents must not concurrently modify the same sandbox.

Add or extend each plan/delivery manifest with:

```json
{
  "multiAgent": {
    "required": true,
    "requiredStages": ["analysis", "test-materialization", "implementation", "review", "verification"],
    "preflightPassed": true,
    "executed": true,
    "fallbackUsed": false,
    "parentAgentImplemented": false,
    "executionContext": {
      "workflowRoot": "<absolute toolkit root>",
      "projectRoot": "<absolute target project root>",
      "workspaceRoot": "<absolute workspace or sandbox root>",
      "taskArtifactRoot": "<absolute artifact directory>",
      "changedFiles": [],
      "workspaceBaseline": {
        "branch": "",
        "head": "",
        "statusShort": "",
        "diffStat": "",
        "untrackedFiles": []
      }
    },
    "roles": [
      {
        "stage": "implementation",
        "role": "implementer",
        "codexAgent": "aiew_implementer",
        "spawned": true,
        "completed": true,
        "resultValidated": true,
        "threadId": null
      }
    ]
  }
}
```

Also write `agent-execution.json` beside the plan/delivery artifacts. Do not fabricate thread IDs; use
`null` when the runtime does not expose one. `fallbackUsed=true`, missing Implementer/Reviewer/Verifier
evidence, or `multiAgent.executed !== true` is a blocking failure.

Use the deterministic gate before claiming delivery:

```bash
node "<toolkit-root>/bin/core.mjs" multi-agent-gate --input <agent-execution-or-manifest-json>
node "<toolkit-root>/bin/core.mjs" deliver-status --input <delivery-status-json>
```

Successful delivery requires all of the following to be true:

`multiAgent.required === true`, `multiAgent.preflightPassed === true`, `multiAgent.executed === true`,
`multiAgent.fallbackUsed === false`, `multiAgent.parentAgentImplemented === false`, Implementer completed,
Reviewer completed, Verifier completed, review passed, and verify passed. Otherwise do not return
`DELIVERED` or `PUBLISHED`.

## 1. Read The Current Repository Automatically

The current Codex workspace is the target repository unless the user names another target.

Inspect only task-relevant context, including:

- project structure and technology stack;
- dependency and build files such as `package.json`, `pom.xml`, `build.gradle`, `Makefile`, and CI files;
- README, CONTRIBUTING, CLAUDE.md, AGENTS.md, and other local project rules when present;
- existing code style, service/util/component patterns, tests, and git state.

`AGENTS.md` is optional. If present, read and obey the relevant project rules. If absent, continue with the
repository's observable conventions and this skill's workflow rules.

## 2. Default Execution Mode

Unless the user explicitly says "only analyze", "do not edit", or "plan only", execute the complete
delivery loop:

1. clarify only blockers that cannot be safely inferred;
2. run the read-only plan-from-requirement flow from `codex/plan-from-requirement.md`;
3. persist the required plan artifacts: `requirement.json`, `plan.json`, `risks.json`, `test-plan.json`,
   `final-plan.md`, and `run-manifest.json`;
4. run `validate-plan-artifacts.mjs` and compute readiness with `bin/core.mjs readiness`;
5. continue to implementation only when readiness is `ready`;
6. run deliver-from-plan in a sandbox copy, never by directly editing the target repository;
7. perform independent review, fix, and independent verification as real subagent stages, with a bounded loop;
8. produce `changes.diff`, `delivery-report.md`, and `delivery-manifest.json`;
9. run `validate-delivery-artifacts.mjs` and the applicable deterministic delivery checks;
10. write `agent-execution.json` and deliver a short final report with changed files, tests, remaining risks, and unverified items.

Do not require the user to manually start plan, delivery, review, or verification stages. The stage names are
internal workflow structure.

The target repository must remain unchanged through plan and delivery. The only allowed direct write to the
target repository is the optional publish stage after the user explicitly asks for publishing and the git
choice gate has passed.

## 3. Deterministic Decisions

Use the shared CLIs for status, git facts, branch choices, diff generation, artifact validation, and safety
decisions. Do not re-implement these decisions in prose.

Use paths derived from `<toolkit-root>`:

| Need | Command |
|---|---|
| git state and valid commit options | `node "<toolkit-root>/bin/git-state.mjs" --cwd <repo> [--mode <m>] [--target-branch <b>]` |
| plan readiness | `node "<toolkit-root>/bin/core.mjs" readiness <finalStatus>` |
| delivery / publish / persist status | `node "<toolkit-root>/bin/core.mjs" <deliver-status\|publish-status\|persist-outcome> --input <json-file>` |
| stale-plan detection | `node "<toolkit-root>/bin/core.mjs" repo-fingerprint --input <json-file>` |
| project type | `node "<toolkit-root>/bin/core.mjs" project-type --input <json-file>` |
| git red-line guard before git writes | `node "<toolkit-root>/bin/core.mjs" git-guard --stdin` |
| branch-choice resolution | `node "<toolkit-root>/bin/core.mjs" branch-choice --input <json-file>` |
| SCOPE check | `node "<toolkit-root>/bin/core.mjs" scope-check --input <json-file>` |
| sandbox copy | `node "<toolkit-root>/bin/sandbox-prepare.mjs" --src <target> --dest <sandbox>` |
| portable diff | `node "<toolkit-root>/bin/diff-from-sandbox.mjs" --base <target> --sandbox <sandbox> --out <delivery-dir>/changes.diff` |
| persist artifacts | `node "<toolkit-root>/bin/persist-artifacts.mjs" --out-base <dir> [--ts <stamp>]` |
| validate plan artifacts | `node "<toolkit-root>/scripts/validate-plan-artifacts.mjs" <plan-dir>` |
| validate delivery artifacts | `node "<toolkit-root>/scripts/validate-delivery-artifacts.mjs" <delivery-dir>` |
| validate publish record | `node "<toolkit-root>/scripts/validate-publish-record.mjs" <publish-dir>` |

On Windows PowerShell, prefer `--input <json-file>` or `--stdin` for object inputs to avoid inline JSON
quoting problems.

## 4. Analysis And Plan

Analyze the user's real goal, affected modules, inputs/outputs, business/data/state flows, permissions,
idempotency, concurrency, compatibility, database/API/config/file implications, rollback risk, and tests.

Ask only when a missing answer would materially change API shape, data shape, security, permissions,
migrations, destructive behavior, money movement, or irreversible side effects. Avoid low-value question
lists.

The plan must identify the expected files, core logic, tests/checks, risks, and acceptance criteria. It is
not complete until all required plan artifacts exist and `validate-plan-artifacts.mjs` passes. If the user
requested analysis only, stop after this validated plan.

## 5. Sandbox Implementation

Implement only inside the sandbox prepared by `bin/sandbox-prepare.mjs`. Do not directly edit the target
repository during delivery. Generate the final patch with `bin/diff-from-sandbox.mjs`, then verify it can be
applied to the target baseline before reporting delivery.

Implement conservatively inside the sandbox:

- match existing structure and style;
- reuse existing services, utilities, components, enums, and tests;
- avoid unrelated refactors and speculative dependencies;
- keep backwards compatibility unless the user requested otherwise;
- handle meaningful exceptions and boundary cases;
- add comments only where they clarify non-obvious critical logic.

For higher-risk domains such as payment, auth, permissions, SQL, files, secrets, callbacks, scheduling, or
amount calculations, use human review gates before publish and clearly state any residual risk.

## 6. Tests And Review Loop

Discover checks from the target repository instead of asking the user for commands:

- package scripts, test files, build files, Makefile, CI, README, and existing project docs;
- unit/integration tests, type checks, lint, builds, and focused scripts relevant to the change.

After implementation:

1. run the smallest relevant checks first, then broader checks when practical;
2. Spawn `aiew_independent_reviewer` for plan review and `aiew_independent_reviewer` per required code-review lens for delivery review;
3. Spawn `aiew_fixer` for discovered issues in the sandbox and rerun relevant checks;
4. Spawn `aiew_delivery_verifier` for independent verification that re-materializes or re-checks the tests from `test-plan.json`;
5. stop after a reasonable bounded loop, normally two fix-review cycles unless a clear small fix remains;
6. validate `delivery-manifest.json` with `validate-delivery-artifacts.mjs` before final delivery.

Never report passing tests or verification that did not actually run.

Verifier input must be self-contained. Give the verifier the goal, acceptance criteria, changed files,
allowed validation commands, project root or sandbox root, "do not modify code", and required evidence
format. The verifier should not need to locate or read the workflow installation to run tests.

## 7. Git Delivery / Publish Gate

Do not commit or push unless the user explicitly asks for publishing.

`DELIVERED` means the workflow produced and verified a local delivery diff. It does not mean remote delivery
is complete. After independent verification passes, compute the git-delivery preflight:

1. compare the starting and ending workspace snapshots;
2. identify exactly which files belong to this task;
3. exclude pre-existing unrelated changes and untracked files;
4. reject `AGENTS.md`, secrets, personal config, generated local output, and any out-of-scope file;
5. present the exact file list and key change summary to the user;
6. stop as `PUBLISH_READY` until the user confirms commit/push.

Before any branch operation, commit, or push:

1. run git state via `<toolkit-root>/bin/git-state.mjs`;
2. if `branchChoice.needsChoice` is true, stop and present only available options;
3. use precise pathspecs for staging; never use `git add .`;
4. run every write-oriented git command through the git red-line guard first;
5. never force-push, delete remote branches, commit secrets, or publish protected-branch changes without
   explicit opt-in.

After commit/push, verify the remote commit. Only then may the workflow report `PUBLISHED` or
`PUBLISHED_WITH_OPEN_ITEMS`. If push or remote verification fails, report local implementation complete but
remote delivery incomplete (`PUBLISH_BLOCKED` or `PUBLISH_UNVERIFIED`), not complete success.

## 8. Final Delivery

Keep the final response high signal:

1. what changed;
2. core files changed;
3. key implementation approach;
4. tests/checks run and results;
5. unverified items;
6. known risks or user actions.

Completion terms are strict:

- code complete is not full delivery;
- tests passing is not full delivery;
- local commit is not remote delivery;
- `DELIVERED` is local verified diff only;
- `PUBLISH_READY` is verified and waiting for user-confirmed git delivery;
- `PUBLISHED` requires commit, push, and independent remote verification.

When published, include commit hash, branch, remote, push status, remote verification status, and test
results. When not published, say what remains.

When reporting untracked files, distinguish baseline facts from inference. If no starting snapshot exists,
say that whether a file existed before the task cannot be proven from the current state alone.

If a subagent initially fails due to missing `execution_context` and then succeeds after corrected context
injection, include a short flow exception note with failure, recovery, and final impact.

Do not dump process logs. Mention old compatibility only when it matters: the former
`ai-engineering-delivery` name has been replaced by `ai-engineering-workflow`; `AIEW_HOME` remains only an
optional backwards-compatible override.
