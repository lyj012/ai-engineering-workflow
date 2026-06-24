# AI Engineering Workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

AI engineering workflow contracts and adapters for turning a user requirement into a reviewed engineering plan, then into a sandboxed code diff with explicit verification evidence.

The Claude Code Dynamic Workflows adapter is the stable implementation. The Codex adapter is being added in phases and shares the platform-neutral artifact contracts in `core/` instead of duplicating methodology, schemas, or status definitions.

## What This Does

| Input | Workflow | Output |
|---|---|---|
| A user requirement plus a target repository | `plan-from-requirement` | `final-plan.md`, `plan.json`, risks, tests, and `readinessForDev` |
| A ready plan plus the same target repository | `deliver-from-plan` | sandboxed implementation, `changes.diff`, delivery report, verification notes |
| A repository audit request | `analyze-repo` | evidence-backed risk report and test plan |

The main chain is intentionally split:

1. `plan-from-requirement`: read-only requirement analysis and implementation plan.
2. Human gate: review `final-plan.md`; continue only when `readinessForDev=ready`.
3. `deliver-from-plan`: copy the target repo into a sandbox, materialize tests, implement inside the sandbox, review, verify, and emit a diff.

## Requirements

- Claude Code with Dynamic Workflows enabled for the stable `.claude/` workflows.
- A visible `Workflow` tool in the Claude Code session for Claude runs.
- OpenAI Codex CLI for the experimental `codex/` adapter.
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

## Quick Start

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

The complete sample input and sanitized output shape are in `examples/`. See `codex/` for the first-phase Codex plan adapter design.

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
