# Codex Adapter Guidance

This template is for a local OpenAI Codex `AGENTS.md`. Keep the generated `AGENTS.md` out of git; this public repository tracks only the template. It consumes the platform-neutral contracts in `../core/` and must not fork the engineering methodology into a second independent copy.

## Current Scope

The first supported target is `plan-from-requirement`: a read-only requirement-to-plan flow that emits artifacts compatible with the Claude workflow examples.

Do not implement the full delivery chain here until the plan flow has been run against a real target repository with Codex and its artifacts pass `node scripts/validate-plan-artifacts.mjs <plan-dir>`.

## Execution Rules

- Prefer one Codex invocation per stage, with JSON files passed between stages.
- Use `codex exec` only for model work: requirement understanding, code analysis, implementation planning, risk identification, test planning, and independent review.
- Use normal programs for deterministic work: JSON validation, path checks, status calculation, artifact writing, diff generation, and `git apply --check`.
- Keep Claude-specific `Workflow`, `phase()`, `agent()`, and resume semantics out of Codex prompts.
- Keep Codex-specific CLI flags and sandbox behavior out of `core/`.
- Never modify the target repository during `plan-from-requirement`.

## Non-Goals

- No Cursor, Gemini, or generic adapter scaffolding.
- No UI.
- No Codex delivery/diff workflow in the first phase.
- No duplicated schema or status definitions when `core/` already owns the contract.

## Capability Notes

The design assumes public Codex support for `AGENTS.md`, Skills, Subagents, and non-interactive `codex exec`. These capabilities are suitable inputs to the adapter design, but this repository should mark any exact command line, JSON output mode, or sandbox mode as verified only after it is exercised locally.
