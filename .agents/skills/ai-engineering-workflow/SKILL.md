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
2. produce a concise internal plan grounded in the repository;
3. implement the smallest scoped change;
4. run the strongest practical tests/checks discovered from the repository;
5. independently review the result;
6. fix issues and rerun relevant checks, with a bounded loop;
7. deliver a short final report with changed files, tests, remaining risks, and unverified items.

Do not require the user to manually start plan, delivery, review, or verification stages. The stage names are
internal workflow structure.

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

The plan must identify the expected files, core logic, tests/checks, risks, and acceptance criteria. If the
user requested analysis only, stop after this plan.

## 5. Implementation

Implement conservatively:

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
2. review the diff against the requirement, scope, risk list, and tests;
3. fix discovered issues and rerun relevant checks;
4. stop after a reasonable bounded loop, normally two fix-review cycles unless a clear small fix remains.

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
