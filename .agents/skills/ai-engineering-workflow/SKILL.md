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

## 0.2 Mandatory Codex Subagents

This workflow requires real Codex subagent threads for every semantic stage in
`<toolkit-root>/codex/agent-role-map.json`.

The parent Codex agent may only orchestrate:

- load contracts and project context;
- run deterministic Node CLIs;
- Spawn the mapped Codex custom agent;
- give the subagent only the inputs allowed for its stage;
- Wait for that agent to complete;
- validate the returned structure/artifact;
- record execution evidence;
- decide the next gate from deterministic status code;
- ask the user only for clarification or git-choice gates.

The parent Codex agent must not:

- write business code;
- simulate Implementer, Reviewer, Fixer, Verifier, Browser Verifier, or Publisher roles in the parent thread;
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
    "executed": true,
    "fallbackUsed": false,
    "roles": [
      {
        "stage": "Implement",
        "role": "implementer",
        "codexAgent": "aiew_implementer",
        "spawned": true,
        "completed": true,
        "resultValidated": true,
        "runtimeThreadId": null
      }
    ]
  }
}
```

Also write `agent-execution.json` beside the plan/delivery artifacts. Do not fabricate thread IDs; use
`null` when the runtime does not expose one. `fallbackUsed=true`, missing Implementer/Reviewer/Verifier
evidence, or `multiAgent.executed !== true` is a blocking failure.

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

## 7. Publish Gate

Do not commit or push unless the user explicitly asks for publishing.

Before any branch operation, commit, or push:

1. run git state via `<toolkit-root>/bin/git-state.mjs`;
2. if `branchChoice.needsChoice` is true, stop and present only available options;
3. run every write-oriented git command through the git red-line guard first;
4. never force-push, delete remote branches, commit secrets, or publish protected-branch changes without
   explicit opt-in.

## 8. Final Delivery

Keep the final response high signal:

1. what changed;
2. core files changed;
3. key implementation approach;
4. tests/checks run and results;
5. unverified items;
6. known risks or user actions.

Do not dump process logs. Mention old compatibility only when it matters: the former
`ai-engineering-delivery` name has been replaced by `ai-engineering-workflow`; `AIEW_HOME` remains only an
optional backwards-compatible override.
