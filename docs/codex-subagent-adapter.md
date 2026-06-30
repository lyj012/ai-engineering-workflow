# Codex Subagent Adapter

This document records how the Codex adapter maps the existing Claude Workflow agent system into Codex
custom subagents. It is an adapter contract, not a new role design.

## Source Of Truth

Role prompts come from the existing Claude assets:

- `.claude/agents/*.md` for named semantic roles.
- `.claude/workflows/deliver-from-plan.js` and `.claude/workflows/publish-delivery.js` for inline stage roles
  that never existed as separate `.claude/agents` files.
- `codex/agent-role-map.json` records the mapping and is consumed by `scripts/generate-codex-agents.mjs`.

Generated Codex agent files live in `codex/agents/aiew_*.toml`. Do not edit them by hand; run:

```bash
node scripts/generate-codex-agents.mjs
node scripts/check-agent-parity.mjs
```

## Role Mapping

| Claude source | Claude workflow phases | Codex agent | Isolation |
|---|---|---|---|
| `.claude/agents/requirement-analyst.md` | Requirement, Triage | `aiew_requirement_analyst` | independent read-only |
| `.claude/agents/repo-analyst.md` | Preflight, Locate, ProjectStyle, Analyze, Gap | `aiew_repo_analyst` | independent read-only |
| `.claude/agents/solution-architect.md` | Plan, Rework, Report | `aiew_solution_architect` | independent read-only |
| `.claude/agents/risk-auditor.md` | Risk | `aiew_risk_auditor` | independent read-only |
| `.claude/agents/test-planner.md` | TestPlan | `aiew_test_planner` | independent read-only |
| `.claude/agents/independent-reviewer.md` | plan Review, delivery review lenses | `aiew_independent_reviewer` | independent read-only |
| `.claude/agents/verification-runner.md` | Verify, CodeQuality command execution | `aiew_verification_runner` | independent command runner |
| `.claude/agents/workflow-reviewer.md` | final workflow review | `aiew_workflow_reviewer` | independent read-only |
| `.claude/agents/doc-writer.md` | docs generation | `aiew_doc_writer` | independent writer |
| `.claude/agents/methodology-researcher.md` | methodology research | `aiew_methodology_researcher` | independent read-only |
| `deliver-from-plan.js#MaterializeTests` | MaterializeTests | `aiew_test_materializer` | independent sandbox writer |
| `deliver-from-plan.js#Implement` | Implement | `aiew_implementer` | independent sandbox writer |
| `deliver-from-plan.js#Fix` | Fix | `aiew_fixer` | independent sandbox writer |
| `deliver-from-plan.js#Verify` | Verify | `aiew_delivery_verifier` | independent verifier |
| `deliver-from-plan.js#BrowserVerify` | BrowserVerify | `aiew_browser_verifier` | independent verifier |
| `publish-delivery.js#Clone/Branch/Apply/Commit/Push` | publish write stages | `aiew_publisher` | isolated publish writer |
| `publish-delivery.js#RemoteVerify` | RemoteVerify | `aiew_remote_publish_verifier` | independent read-only verifier |

Mechanical operations remain deterministic Node commands and are not model roles: readiness, deliver-status,
publish-status, repo/test fingerprints, scope-check, git-state, branch-choice, git-guard, diff generation,
artifact validators, and remote publish recomputation.

## Runtime Contract

The parent `ai-engineering-workflow` skill is only an orchestrator. For each semantic stage it must:

1. Spawn the mapped `aiew_*` Codex custom agent.
2. Provide only the stage inputs allowed by `codex/pipeline.md`.
3. Wait for completion.
4. Validate the stage result or artifact.
5. Record the execution in `agent-execution.json`.
6. Continue only when deterministic gates pass.

The parent must not simulate Implementer, Reviewer, Fixer, Verifier, Browser Verifier, or Publisher work.
If a required subagent is unavailable or invalid, the workflow stops with
`BLOCKED_MULTI_AGENT_UNAVAILABLE`. If the parent performs work reserved for a subagent, it stops with
`BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION`.

## Installation

`scripts/install-codex-skill.ps1` installs:

- the Skill entry under `%USERPROFILE%\.agents\skills\ai-engineering-workflow`;
- the generated Codex agents under `%USERPROFILE%\.codex\agents\aiew_*.toml`.

`-Force` only replaces files in the `aiew_` namespace and does not touch user-owned agents.

## Verification Status

Verified here:

- deterministic agent generation;
- generated TOML parity against `codex/agent-role-map.json` and Claude sources;
- installer copies the generated agent files;
- `node scripts/self-check.mjs` includes the parity check.

Not yet verified here:

- a real Codex Desktop/CLI run showing multiple `aiew_*` subagent threads in `/agent`;
- end-to-end plan/delivery artifacts produced by those runtime subagents.
