# Codex Plan From Requirement

This is the Codex adapter design for the read-only requirement-to-plan flow.

It should emit artifacts compatible with `core/schemas/plan-artifacts.schema.json`. It does not implement delivery, sandboxed coding, or diff generation.

## Inputs

```json
{
  "requirement": "User requirement text",
  "target": "/absolute/path/to/target/repo",
  "constraints": ["Optional constraints"],
  "outDir": "evidence/plans"
}
```

## Stage Contract

Each stage should be an independent `codex exec` run. A deterministic wrapper should:

1. create a timestamped run directory;
2. write the input JSON;
3. invoke Codex for one stage;
4. validate the stage JSON;
5. write the stage output;
6. calculate the next status without asking the model to do deterministic bookkeeping.

The model should only do judgment-heavy work:

- understand the requirement;
- inspect relevant code;
- explain current behavior;
- design the implementation plan;
- identify risks;
- propose tests;
- perform independent review.

The wrapper should do deterministic work:

- ensure target paths stay readable and inside allowed scope;
- validate JSON;
- compute final status/readiness;
- assemble `final-plan.md`;
- write `run-manifest.json`.

## Minimal Stage Outputs

The final `assemble` stage must write:

- `requirement.json` matching `core.schemas.requirement`;
- `plan.json` matching `core.schemas.plan`;
- `risks.json` matching `core.schemas.risks`;
- `test-plan.json` matching `core.schemas.testPlan`;
- `final-plan.md`;
- `run-manifest.json` with the final status and readiness.

## Status Rules

Use `core/status.json` for status meanings. A plan may be `readinessForDev=ready` only when:

- final status is `PASS` or `PARTIAL`;
- no P0 review finding remains open;
- required JSON artifacts validate;
- remaining gaps are explicit and non-blocking.

Ambiguous requirements that materially affect API shape, data shape, security, permissions, migration, or destructive behavior must produce `NEEDS_CLARIFICATION` instead of a speculative implementation plan.

## Codex Capability Assumptions

The design assumes Codex can be invoked non-interactively through `codex exec` and that the
`ai-engineering-workflow` Skill can read repository guidance files when present. A local `AGENTS.md` may add
project rules, but it is not required to start the workflow. Exact command flags should be treated as pending
until a local smoke run proves them in this repository.

Do not claim the Codex adapter is runnable until a real command has produced a plan artifact directory and the validation command passes.
