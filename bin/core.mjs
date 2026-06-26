#!/usr/bin/env node
// bin/core — deterministic decision dispatcher over the shared core/ modules (cross-platform).
//
// This is the runtime-neutral surface every adapter shares. The Claude Dynamic Workflow inlines these
// same core/ functions (with self-check parity); the Codex adapter cannot rely on a Claude runtime, so
// it calls these decisions here instead — identical logic, one source of truth, no drift (req 4).
//
// Pure decisions only: NO git writes, NO file IO, NO model calls. Input JSON in, decision JSON out.
// (Git *reads* live in bin/git-state.mjs; artifact validation in scripts/validate-plan-artifacts.mjs.)
//
// Usage:
//   node bin/core.mjs <fn> ['<json>']         # json from argv, or piped on stdin
//   echo '<json>' | node bin/core.mjs <fn>
// Examples:
//   node bin/core.mjs readiness '"PASS"'
//   node bin/core.mjs publish-status '{"deliverableStatus":"DELIVERED", ...}'
//   node bin/core.mjs git-guard '"git push --force origin main"'
//   node bin/core.mjs branch-choice '{"requestedMode":"new-branch","detachedHead":false}'
import { readFileSync } from 'node:fs'
import { computeReadiness, isValidStatusReadinessCombo } from '../core/readiness.mjs'
import { computeDeliverStatus } from '../core/deliver-status.mjs'
import { computePublishStatus } from '../core/publish-status.mjs'
import { computePersistOutcome } from '../core/persist-outcome.mjs'
import { compareRepoFingerprint } from '../core/repo-fingerprint.mjs'
import { reconcileChangedFiles } from '../core/changed-files.mjs'
import { resolveBranchChoice } from '../core/branch-choice.mjs'
import { classifyGitState } from '../core/git-state.mjs'
import { classifyProjectType } from '../core/project-type.mjs'
import { classifyGitCommand } from '../core/git-guard.mjs'
import { applyPlanPatch } from '../core/plan-patch.mjs'

const HANDLERS = {
  'readiness': (i) => ({ readinessForDev: computeReadiness(i) }),
  'status-combo': (i) => ({ valid: isValidStatusReadinessCombo(i.finalStatus, i.readiness) }),
  'deliver-status': (i) => computeDeliverStatus(i),
  'publish-status': (i) => computePublishStatus(i),
  'persist-outcome': (i) => computePersistOutcome(i),
  'repo-fingerprint': (i) => compareRepoFingerprint(i.planFp, i.currentFp),
  'changed-files': (i) => reconcileChangedFiles(i),
  'branch-choice': (i) => resolveBranchChoice(i),
  'git-state': (i) => classifyGitState(i),
  'project-type': (i) => classifyProjectType(i),
  'git-guard': (i) => classifyGitCommand(i),
  'plan-patch': (i) => applyPlanPatch(i.plan, i.patch),
}

function main() {
  const fn = process.argv[2]
  if (!fn || !HANDLERS[fn]) {
    process.stderr.write(`unknown or missing fn. available: ${Object.keys(HANDLERS).join(', ')}\n`)
    process.exit(2)
  }
  let rawInput = process.argv[3]
  if (rawInput === undefined) { try { rawInput = readFileSync(0, 'utf8') } catch { rawInput = '' } }
  rawInput = (rawInput || '').trim()
  let input
  try { input = rawInput ? JSON.parse(rawInput) : undefined } catch (e) {
    process.stderr.write(`invalid JSON input for "${fn}": ${e.message}\n`); process.exit(2)
  }
  const out = HANDLERS[fn](input)
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  process.exit(0)
}

try { main() } catch (e) {
  process.stderr.write(`core dispatch failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
