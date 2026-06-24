# Platform-Neutral Core

`core/` holds the pieces that should not drift between Claude Code and Codex adapters.

The core is intentionally small:

- `schemas/plan-artifacts.schema.json` defines the compatible plan artifact shape.
- `status.json` defines shared status meanings.
- deterministic scripts may validate artifacts against these files.

This directory is not a shared runtime for Claude Dynamic Workflow scripts. Claude workflow scripts currently keep their schemas inline because the Workflow JS surface is a pure orchestration environment rather than a normal Node module runtime. Keep those inline copies synchronized with this core contract until a real import path is proven safe.

## What Belongs Here

- JSON Schema for artifacts consumed by more than one adapter.
- Status and readiness enums.
- Platform-neutral safety and artifact protocol documents.
- Deterministic validation logic when it can run as a normal program.

## What Does Not Belong Here

- Claude `Workflow` calls, phases, `agent()` options, or resume mechanics.
- Codex `codex exec` command wrappers, prompt routing, or sandbox flags.
- Future adapters for tools that are not implemented in this repository.
- UI, dashboards, or marketplace packaging.

## Compatibility Rule

Claude and Codex should emit compatible artifact structures. They do not need to share the same internal execution model.
