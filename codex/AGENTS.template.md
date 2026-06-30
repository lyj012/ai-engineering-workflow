# Optional Codex Project Guidance (AGENTS.md template)

This template is optional project-level guidance for teams that want extra local rules. It is no longer the
workflow launcher. The normal entry point is the Codex skill:

```text
/skills -> ai-engineering-workflow
```

or:

```text
$ai-engineering-workflow
```

If you generate a target project's `AGENTS.md` from this template, **keep it out of git** unless your team
explicitly wants to share it. The public repository tracks only this template.

The `ai-engineering-workflow` skill resolves the shared toolkit from its own installed location. `AIEW_HOME`
may still be used as a backwards-compatible override, but it is not required for normal use.

## Toolkit Root

The shared toolkit is the repository containing `core/`, `bin/`, `scripts/`, `codex/`, and
`.agents/skills/ai-engineering-workflow/SKILL.md`. Commands below use `<toolkit-root>` as a placeholder for
the path resolved by the skill. Never hard-code a personal machine path.

## Scope

The complete closed loop, identical in rules/artifacts/statuses to the Claude workflow:
requirement → code-base analysis → plan → coding → tests → independent review → fix → independent verify →
diff → **customer git-choice** → commit → push.

Build it up in verified order: do not claim a stage runnable in Codex until a real Codex run has
produced its artifacts and the stage's validator passes — `validate-plan-artifacts.mjs` (plan) /
`validate-delivery-artifacts.mjs` (delivery) / `validate-publish-record.mjs` (publish), all under
`<toolkit-root>/scripts/` — plus `node "<toolkit-root>/scripts/self-check.mjs"`. `plan-from-requirement` (read-only)
is the safe first target; `deliver-from-plan` (sandbox) and `publish-delivery` (git) follow.

## Execution Rules

- One Codex invocation per stage; pass JSON files between stages in a timestamped run directory.
- Use `codex exec` **only** for model work: requirement understanding, code analysis, implementation
  planning, risk identification, test planning, coding, independent review, fixing, independent verification.
- Use plain Node for **all** deterministic work — never ask the model to do bookkeeping (all paths via `<toolkit-root>`):
  - decisions: `node "<toolkit-root>/bin/core.mjs" <readiness|deliver-status|publish-status|persist-outcome|repo-fingerprint|project-type|git-guard|branch-choice> --input <json-file>`
    - Windows PowerShell-safe forms: `node "<toolkit-root>\bin\core.mjs" readiness PASS`, `node "<toolkit-root>\bin\core.mjs" scope-check --input .\scope-check.json`, or `Get-Content .\scope-check.json -Raw | node "<toolkit-root>\bin\core.mjs" scope-check --stdin`
  - git facts (read-only): `node "<toolkit-root>/bin/git-state.mjs" --cwd <repo> [--mode <m>] [--target-branch <b>]`
  - diff generation: `node "<toolkit-root>/bin/diff-from-sandbox.mjs" --base <target> --sandbox <sandbox> --out <delivery-dir>/changes.diff`
  - validation per stage: `node "<toolkit-root>/scripts/validate-plan-artifacts.mjs" <plan-dir>` · `validate-delivery-artifacts.mjs <delivery-dir>` · `validate-publish-record.mjs <publish-dir>`; integrity: `node "<toolkit-root>/scripts/self-check.mjs"`
- Keep Claude-specific `Workflow`, `phase()`, `agent()`, and resume semantics out of Codex prompts.
- Keep Codex-specific CLI flags and sandbox behavior out of `core/`.
- `plan-from-requirement` and `deliver-from-plan` never modify the target repository (deliver works in a
  sandbox copy and stops at a verified `changes.diff`).

## Customer Git-Choice Gate (publish stage — mandatory)

Before ANY branch op / commit / push:
1. Run `node "<toolkit-root>/bin/git-state.mjs" --cwd <target> --mode <customer choice if any> --target-branch <name if any>`.
2. If the result's `branchChoice.needsChoice` is true → **stop and ask the customer**, offering **only** the
   options where `available` is true (never show an invalid one, never auto-pick). Treat this as
   `PUBLISH_NEEDS_CHOICE`; do not checkout, branch, commit, or push.
3. Strategies (offered only when valid in the current repo / worktree / HEAD state):
   `new-branch` (cut from current commit) · `switch-existing` (checkout a customer-named existing branch,
   needs `targetBranch`) · `current-branch` (commit on the current branch directly).

## Safety (unchanged across adapters)

Never `git push --force`/`-f`; never delete a remote branch or rewrite history (run every git command past
`node "<toolkit-root>/bin/core.mjs" git-guard` first). Never stage `.env`/keys/`*.pem`/personal config. Protected branches
(main/master/release) require explicit opt-in. High-risk domains (payment/permission/secret/auth/
irreversible) hit a human gate. Block any change outside the planned SCOPE.

## Delivery Discipline (hard constraints)

- **Only modify SCOPE** — the files the plan declares; any out-of-SCOPE change is blocked.
- **The implementer never self-reviews** — independent review and independent verification are separate
  stages run by a fresh role; coding output is never graded by its own author.
- **Never deliver on failing tests** — the DONE command must pass, and the independent verifier's tests
  (re-materialized from the test-plan, not the in-tree copy) must pass, before a delivery is anything but
  BLOCKED.
- **Customer git-branch choice before any branch op / commit / push** (see the gate above) — never
  auto-decide; offer only options the current environment actually supports.
- **The customer project's existing conventions win** — match its code style, structure, test layout and
  tooling; do not impose this methodology's defaults over established project norms.

## Non-Goals

- No Cursor, Gemini, or generic adapter scaffolding. No UI.
- No duplicated schema/status/decision logic when `core/` already owns the contract — call `bin/`/`core/`.

## Capability Notes (verify before claiming runnable)

This template only adds optional project rules. Mark any exact Codex command line, `--output-schema`/JSON
output mode, or sandbox flag as **verified only after a local Codex run exercises it** in a real target
repository. The deterministic surface (`bin/`, `scripts/`, `core/`) is plain Node and already verified in
this repository.
