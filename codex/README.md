# Codex Adapter

This directory defines the OpenAI Codex adapter for AI Engineering Workflow.

The first phase is intentionally narrow: make Codex able to produce the same plan artifact contract as the existing Claude `plan-from-requirement` workflow, without changing the Claude implementation and without cloning the methodology into a second tree.

## Architecture

```text
core/
  schemas/plan-artifacts.schema.json
  status.json

.claude/
  workflows/
    plan-from-requirement.js
    deliver-from-plan.js
    analyze-repo.js

codex/
  AGENTS.template.md
  plan-from-requirement.md
```

`core/` owns shared artifact contracts. `.claude/` remains the Claude Dynamic Workflow adapter. `codex/` describes the Codex execution shape.

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

Verified in this repository:

- shared schema validates the existing example plan artifacts;
- self-check can consume the shared schema;
- Claude workflow files are left behavior-compatible.

Pending local Codex verification:

- exact `codex exec` command shape for this adapter;
- whether `--output-schema` is sufficient for every stage output;
- best sandbox flags for read-only target analysis;
- whether Codex Skills or Subagents improve this first phase enough to justify depending on them.
