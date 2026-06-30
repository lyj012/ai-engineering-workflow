# AI Engineering Workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

AI engineering workflow contracts and adapters for turning a user requirement into a reviewed engineering plan, then into a sandboxed code diff with explicit verification evidence.

The Claude Code Dynamic Workflows adapter is the stable implementation. The Codex adapter exposes the same
workflow through a selectable Skill named `ai-engineering-workflow`; it shares the platform-neutral artifact
contracts in `core/` instead of duplicating methodology, schemas, or status definitions.

## What This Does

| Input | Workflow | Output |
|---|---|---|
| A user requirement plus a target repository | `plan-from-requirement` | `final-plan.md`, `plan.json`, risks, tests, and `readinessForDev` |
| A ready plan plus the same target repository | `deliver-from-plan` | sandboxed implementation, `changes.diff`, delivery report, verification notes |
| A verified delivery (diff + `DELIVERED` manifest) plus a git remote | `publish-delivery` | automatic branch/commit/push (no PR) with independent post-push remote verification |
| A repository audit request | `analyze-repo` | evidence-backed risk report and test plan |

The main chain is intentionally split:

1. `plan-from-requirement`: read-only requirement analysis and implementation plan.
2. Human gate: review `final-plan.md`; continue only when `readinessForDev=ready`.
3. `deliver-from-plan`: copy the target repo into a sandbox, materialize tests, implement inside the sandbox, review, verify, and emit a diff.
4. `publish-delivery` (optional): clone the remote into an isolated working copy, apply the verified diff, branch/commit/push, then verify the remote independently. Never force-pushes; refuses protected branches (`main`/`master`/`release`) and high-risk domains unless explicitly opted in; creates no PR.

`auto-deliver` chains all of the above end to end (`workflow()` one level deep): from a single requirement plus a target repository it runs plan → readiness gate → deliver → delivery gate → publish, stopping only on a NEEDS_CLARIFICATION requirement, a plan red line, or missing push permission. Each gate is deterministic; each engine still persists its own detailed artifacts.

## Capability Matrix

One shared deterministic core (`core/` + `bin/` + `scripts/`), two adapters. The Claude adapter inlines the
core with `self-check` parity locks; the Codex adapter calls the same core through cross-platform CLIs. No
business logic, status, schema, or report shape is maintained twice.

| Capability | Claude adapter (`.claude/workflows`) | Codex adapter (`.agents/skills` + `bin/`) | Deterministic source | Verified here |
|---|---|---|---|---|
| Requirement → plan (read-only) | `plan-from-requirement.js` | skill stage 1 + `codex exec` | `core/readiness` + schemas | ✅ Claude run |
| Plan → sandbox diff | `deliver-from-plan.js` | skill stage 2 | `core/deliver-status` | ✅ Claude run |
| Publish (branch/commit/push) | `publish-delivery.js` | skill stage 3 | `core/publish-status` | ✅ logic; ⚠️ no real-remote e2e |
| Git state + valid branch options | inline (parity) | `bin/git-state.mjs` | `core/git-state` + `core/branch-choice` | ✅ runs |
| Status / readiness / persist decisions | inline (parity) | `bin/core.mjs <fn>` | `core/*.mjs` | ✅ runs + parity |
| Customer git-choice gate | inline (parity) | `bin/git-state.mjs` | `core/branch-choice` | ✅ runs |
| SCOPE check | `core/changed-files` reconcile | `bin/core.mjs scope-check` | `core/scope-check` | ✅ runs |
| Sandbox cleanup (strip history/secrets) | subagent / `bin/sandbox-prepare` | `bin/sandbox-prepare.mjs` | cross-platform script | ✅ tested |
| Persist artifacts (write JSON/MD) | subagent / `bin/persist-artifacts` | `bin/persist-artifacts.mjs` | cross-platform script | ✅ tested |
| Schema validation (plan / delivery / publish) | `self-check` | `validate-*.mjs` | `core/schemas/` | ✅ runs |
| Git red-line guard (no force-push, …) | PreToolUse hook | `bin/core.mjs git-guard` | `core/git-guard` | ✅ runs |
| Codex Desktop recognizes & runs the skill | n/a | `.agents/skills/ai-engineering-workflow/SKILL.md` | — | ⚠️ NOT verified (no Codex Desktop here) |

`✅` = runs and is tested in this repository (`node scripts/self-check.mjs`). `⚠️` = implemented but not yet
exercised on a real remote / on Codex Desktop / on Windows-macOS — see `codex/README.md` Verified-vs-Pending.

## 3-Minute Quick Experience (no Claude or Codex required)

The deterministic core is plain Node — drive it right now without any AI tool:

```bash
git clone https://github.com/lyj012/ai-engineering-workflow && cd ai-engineering-workflow

node scripts/self-check.mjs                                          # 1. everything green (logic + parity + schemas + scripts)
node bin/git-state.mjs --cwd . --mode new-branch                     # 2. git state + which commit options are valid here
node bin/core.mjs readiness PASS                                     # 3. a deterministic decision (PASS -> ready)
node bin/core.mjs git-guard '"git push --force origin main"'        # 4. the git red-line guard (blocked: true)
node scripts/validate-plan-artifacts.mjs examples/artifacts/plan-ready              # 5. validate an example PLAN
node scripts/validate-delivery-artifacts.mjs examples/artifacts/delivery-success    # 6. validate an example DELIVERY
node bin/sandbox-prepare.mjs --src examples/minimal-target --dest /tmp/sb           # 7. prepare a clean sandbox (history + all symlinks stripped; secrets stripped by filename pattern, not a content scan)
```

For complex JSON on Windows PowerShell, prefer `--input file.json` or `--stdin`, for example
`node bin/core.mjs scope-check --input .\scope-check.json`; this avoids PowerShell 5 quote stripping. To then
run the *model* stages, use the Claude `Workflow` quick start below, or open a target project in Codex and
invoke the `ai-engineering-workflow` skill from `/skills` or by typing `$ai-engineering-workflow`.

## Requirements

- Claude Code with Dynamic Workflows enabled for the stable `.claude/` workflows.
- A visible `Workflow` tool in the Claude Code session for Claude runs.
- OpenAI Codex Desktop or CLI for the `ai-engineering-workflow` Skill adapter.
- `bash`, `git`, and common POSIX tools for the demo and self-check scripts.
- `pwsh` only when you want to verify PowerShell-specific behavior. If `pwsh` is missing, PowerShell checks must be marked as open manual verification.

Known version used to build this project: Claude Code `2.1.186`. Dynamic Workflows may be version- or environment-gated; check your local Claude Code release notes when the `Workflow` tool is not available.

Useful preflight checks:

```bash
claude --version
codex --version
git --version
bash --version
node --version
```

To confirm `Workflow` is available, start Claude Code from this repository root and check that the tool picker or tool list includes `Workflow`. If it does not, this repository can still be read as methodology, but the runnable workflows cannot be executed in that session.

## Codex Quick Start

Install the Skill once so Codex can discover it globally:

```powershell
cd <repo>
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex-skill.ps1
```

The default install mode creates a user-level link at:

```text
%USERPROFILE%\.codex\skills\ai-engineering-workflow
```

that points back to this repository's `.agents/skills/ai-engineering-workflow` directory. Because the Skill
resolves symlinks/junctions before walking upward, it can still find this repository's `core/`, `bin/`,
`scripts/`, and `codex/` directories. To install a fully copied, self-contained user-level package instead:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex-skill.ps1 -Mode Copy -Force
```

After installing, restart Codex or open a new thread so the Skill list refreshes. Then open any target
project in Codex and use either:

```text
/skills -> ai-engineering-workflow
```

or:

```text
$ai-engineering-workflow

<your development requirement>
```

The Skill resolves the toolkit from its own installed location, reads the current repository automatically,
and treats `AGENTS.md` as optional project guidance when present. Users do not need to set `AIEW_HOME`,
provide an absolute toolkit path, generate a project `AGENTS.md`, or manually run each stage. `AIEW_HOME`
remains only as a backwards-compatible override for older setups.

## Claude Quick Start

Clone into any directory name. The repository does not need to be named `workflow`.

Start Claude Code from the repository root, then run:

```text
Workflow({ scriptPath: "<repo>/.claude/workflows/plan-from-requirement.js", args: {
  requirement: "Add a CLI flag --greet <name> that prints Hello, <name>! and keeps the current default output unchanged.",
  target: "<repo>/examples/minimal-target",
  constraints: ["Keep the change minimal", "Add a regression check for the default output"],
  mode: "lite",
  outDir: "<repo>/evidence/plans"
}})
```

After reviewing the generated `final-plan.md`, continue only if the plan says `readinessForDev=ready`:

```text
Workflow({ scriptPath: "<repo>/.claude/workflows/deliver-from-plan.js", args: {
  planDir: "<repo>/evidence/plans/<timestamp>",
  targetRepo: "<repo>/examples/minimal-target",
  outDir: "<repo>/evidence/deliveries"
}})
```

The complete sample input and sanitized output shape are in `examples/`. See `codex/` for the Codex Skill
adapter design.

## Examples

- `examples/minimal-target/`: tiny shell project used as a safe target repository.
- `examples/requirements/simple-greeting.md`: copyable user requirement.
- `examples/artifacts/plan-ready/`: sanitized plan artifacts including `final-plan.md`, `run-manifest.json`, `plan.json`, and `test-plan.json`.
- `examples/artifacts/delivery-success/`: sanitized delivery artifacts including `changes.diff`, `delivery-report.md`, and `delivery-manifest.json`.

These examples are static, public, and safe to inspect. They are not customer output.

## Status Meanings

| Status | Meaning |
|---|---|
| `PASS` | Plan passed review and has no known blocking gaps. |
| `PARTIAL` | Plan passed but some coverage degraded or remains open; read `remainingGaps`. |
| `CONDITIONAL` | No P0 blocker, but important P1 issues remain; use human judgment before coding. |
| `FAILED_WITH_FINDINGS` | Review found blockers or the plan is not reliable enough to implement. |
| `BLOCKED` | Workflow stopped before a safe handoff, usually because prerequisites or verification were missing. |
| `DELIVERED` | Delivery workflow produced a verified sandbox diff with no open items. |
| `DELIVERED_WITH_OPEN_ITEMS` | Delivery produced a diff, but some verification remained manual or environment-dependent. |

## Repository Layout

```text
.
|-- core/                      # Platform-neutral schemas, statuses, and artifact contracts
|-- .claude/
|   |-- agents/                # Role prompts used by Claude workflows
|   |-- skills/workflow-designer
|   `-- workflows/             # Stable Claude Dynamic Workflow scripts
|-- codex/                     # First-phase Codex adapter design and guidance
|-- docs/                      # Methodology and design docs
|-- examples/                  # Minimal target project and sanitized artifacts
|-- evidence/                  # Curated public evidence; dynamic runs are ignored
|-- scripts/                   # Deterministic repository checks
|-- vendor/zhuliming-templates # Attributed third-party templates
|-- CLAUDE.md                  # Claude project-level rules for this public repo
`-- README.md
```

## Verification

Run the repository self-check before publishing changes:

```bash
node scripts/validate-plan-artifacts.mjs examples/artifacts/plan-ready
node scripts/self-check.mjs
```

The checks validate shared plan artifact schemas, public-repo hygiene, forbidden local paths, key file references, workflow metadata consistency, basic secret patterns, example artifacts, license/attribution files, and README command paths.

## Troubleshooting

- `Workflow` is unavailable: start Claude Code from the repository root and confirm your Claude Code build has Dynamic Workflows enabled.
- A workflow tries to read a missing path: make sure paths are absolute or relative to the repository root. Defaults in this repo do not require the directory to be named `workflow`.
- `deliver-from-plan` stops at the readiness gate: inspect `final-plan.md`, `run-manifest.json`, and `readinessForDev`.
- PowerShell checks are open: install `pwsh` or keep those items as manual verification in `residual-verification.md`.
- The diff contains absolute paths: treat that as a bug. `deliver-from-plan` should generate portable diff headers.

## Current Stable Scope

Stable:

- Platform-neutral plan artifact schema in `core`.
- Requirement-to-plan workflow.
- Plan-to-sandboxed-diff workflow.
- Repository analysis workflow.
- Public examples and deterministic repository self-check.

Experimental:

- Codex `plan-from-requirement` adapter design in `codex/`; exact CLI runner remains pending local Codex smoke verification.
- Methodology research and docs-generation workflows.
- Deep verification of environment-specific shell or PowerShell behavior.
- Any use of external Skills through `args.skillDir`.

## License And Attribution

This project is MIT licensed. See `LICENSE`.

`vendor/zhuliming-templates/` contains attributed third-party templates. See `vendor/zhuliming-templates/ATTRIBUTION.md` before redistributing or modifying that directory.

## Release Notes

See `CHANGELOG.md`.
