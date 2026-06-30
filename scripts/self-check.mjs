import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validatePlanArtifacts } from './validate-plan-artifacts.mjs'
import { validateDeliveryArtifacts } from './validate-delivery-artifacts.mjs'
import { validatePublishRecord } from './validate-publish-record.mjs'
import { computeDeliverStatus as coreComputeDeliverStatus } from '../core/deliver-status.mjs'
import { runDeliverStatusTests, CASES as DELIVER_STATUS_CASES } from './deliver-status.test.mjs'
import { runMultiAgentStatusTests } from './multi-agent-status.test.mjs'
import { computeReadiness as coreComputeReadiness } from '../core/readiness.mjs'
import { runReadinessTests, CASES as READINESS_CASES } from './readiness.test.mjs'
import { computePersistOutcome as coreComputePersistOutcome } from '../core/persist-outcome.mjs'
import { runPersistOutcomeTests, CASES as PERSIST_OUTCOME_CASES } from './persist-outcome.test.mjs'
import { compareRepoFingerprint as coreCompareRepoFingerprint } from '../core/repo-fingerprint.mjs'
import { runRepoFingerprintTests, CASES as REPO_FINGERPRINT_CASES } from './repo-fingerprint.test.mjs'
import { reconcileChangedFiles as coreReconcileChangedFiles } from '../core/changed-files.mjs'
import { runChangedFilesTests, CASES as CHANGED_FILES_CASES } from './changed-files.test.mjs'
import { applyPlanPatch as coreApplyPlanPatch } from '../core/plan-patch.mjs'
import { runPlanPatchTests, CASES as PLAN_PATCH_CASES } from './plan-patch.test.mjs'
import { computePublishStatus as coreComputePublishStatus } from '../core/publish-status.mjs'
import { runPublishStatusTests, CASES as PUBLISH_STATUS_CASES } from './publish-status.test.mjs'
import { runGitGuardTests } from './git-guard.test.mjs'
import { classifyProjectType as coreClassifyProjectType } from '../core/project-type.mjs'
import { runProjectTypeTests, CASES as PROJECT_TYPE_CASES } from './project-type.test.mjs'
import { runGitStateTests } from './git-state.test.mjs'
import { resolveBranchChoice as coreResolveBranchChoice } from '../core/branch-choice.mjs'
import { runBranchChoiceTests, CASES as BRANCH_CHOICE_CASES } from './branch-choice.test.mjs'
import { maskRemoteUrl as coreMaskRemoteUrl, hasEmbeddedCredentials as coreHasEmbeddedCredentials } from '../core/mask-remote-url.mjs'
import { runMaskRemoteUrlTests, CASES as MASK_REMOTE_URL_CASES } from './mask-remote-url.test.mjs'
import { verifyRemotePublish as coreVerifyRemotePublish, findForbiddenFiles as coreFindForbiddenFiles } from '../core/verify-remote-publish.mjs'
import { runVerifyRemotePublishTests, CASES as VERIFY_REMOTE_PUBLISH_CASES } from './verify-remote-publish.test.mjs'
import { runInspectRemoteTests } from './inspect-remote.test.mjs'
import { runScopeCheckTests } from './scope-check.test.mjs'
import { runSandboxPrepareTests } from './sandbox-prepare.test.mjs'
import { runPersistArtifactsTests } from './persist-artifacts.test.mjs'
import { runCoreCliInputTests } from './core-cli-input.test.mjs'
import { runExecutionContextTests } from './execution-context.test.mjs'
import { runDiffFromSandboxTests } from './diff-from-sandbox.test.mjs'
import { runUtf8ShellTests } from './utf8-shell.test.mjs'
import { runTestsFingerprintTests } from './tests-fingerprint.test.mjs'
import { runVerifyTestsTests } from './verify-tests.test.mjs'
import { runSafeRmTests } from './safe-rm.test.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warn = []

const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const exists = p => fs.existsSync(path.join(root, p))
const rel = p => path.relative(root, p).replaceAll(path.sep, '/')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    shell: false,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  }
}

function git(args, options = {}) {
  let result = run('git', args, options)
  if (result.error && process.platform === 'win32') {
    result = run('cmd.exe', ['/c', 'git', ...args], options)
  }
  return result
}

function allRepoFiles(dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const r = rel(full)
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue
      if (/^evidence\/(runs|plans|deliveries)\//.test(`${r}/`)) continue
      out.push(...allRepoFiles(full, []))
    } else {
      out.push(r)
    }
  }
  return out
}

let trackedFiles = []
const ls = git(['ls-files'])
if (ls.ok) {
  trackedFiles = ls.stdout.split(/\r?\n/).filter(Boolean)
} else {
  warn.push('git ls-files is unavailable; scanning repository files instead of tracked files')
  trackedFiles = allRepoFiles()
}

const required = [
  'README.md',
  'CLAUDE.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'scripts/self-check.mjs',
  'scripts/install-codex-skill.ps1',
  'scripts/generate-codex-agents.mjs',
  'scripts/check-agent-parity.mjs',
  'codex/agent-role-map.json',
  'examples/minimal-target/app.sh',
  'examples/minimal-target/README.md',
  'examples/requirements/simple-greeting.md',
  'examples/artifacts/plan-ready/final-plan.md',
  'examples/artifacts/plan-ready/requirement.json',
  'examples/artifacts/plan-ready/risks.json',
  'examples/artifacts/delivery-success/delivery-report.md',
  'vendor/zhuliming-templates/ATTRIBUTION.md',
]

for (const file of required) if (!exists(file)) errors.push(`missing required file: ${file}`)

const forbiddenPathPatterns = [
  /(^|\/)AGENTS\.md$/,
  /settings\.local\.json$/,
  /(^|\/)\.env(\.|$)/,
  /\.(pem|key|p12|pfx)$/i,
]

const forbiddenContentPatterns = [
  /\/data\/workspace\//,
  /liuyuanjian/,
  /\.\.\/liu\//,
  /\.\.\/CLAUDE\.md/,
]

const secretContentPatterns = [
  /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk_live_[A-Za-z0-9]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
]

for (const file of trackedFiles) {
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(file)) errors.push(`forbidden tracked path: ${file}`)
  }

  const full = path.join(root, file)
  if (!fs.existsSync(full) || fs.statSync(full).size > 1024 * 1024) continue
  let text = ''
  try { text = fs.readFileSync(full, 'utf8') } catch { continue }
  for (const pattern of forbiddenContentPatterns) {
    if (pattern.test(text) && file !== 'scripts/self-check.mjs') errors.push(`${file} contains forbidden local reference: ${pattern}`)
  }
  for (const pattern of secretContentPatterns) {
    if (pattern.test(text)) errors.push(`${file} appears to contain a secret: ${pattern}`)
  }
}

const workflowFiles = [
  '.claude/workflows/plan-from-requirement.js',
  '.claude/workflows/deliver-from-plan.js',
  '.claude/workflows/publish-delivery.js',
  '.claude/workflows/auto-deliver.js',
  '.claude/workflows/analyze-repo.js',
  '.claude/workflows/wf-methodology-research.js',
  '.claude/workflows/wf-docs-generation.js',
]

for (const file of workflowFiles) {
  if (!exists(file)) continue
  const text = read(file)
  if (!text.includes('export const meta')) errors.push(`${file} missing export const meta`)
  if (/Date\.now\(\)|Math\.random\(\)|new Date\(\)/.test(text)) errors.push(`${file} contains banned time/random API`)
  const transformed = text.replace('export const meta', 'const meta')
  try {
    new Function(`return (async function workflowSyntaxCheck(){\n${transformed}\n});`)
  } catch (error) {
    errors.push(`${file} has invalid Workflow JS syntax: ${error.message}`)
  }
}

// inline-vs-core schema parity: the Claude workflow inlines its plan-artifact schemas (the Workflow JS
// surface cannot import core/), and the Codex adapter targets core/. Nothing else proves they stay equal,
// so extract the four inline schemas from plan-from-requirement.js and structurally diff them against
// core/schemas/plan-artifacts.schema.json (refs resolved; doc-only string `description` ignored).
function normalizeSchemaShape(node, defs) {
  if (Array.isArray(node)) return node.map(n => normalizeSchemaShape(n, defs))
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') return normalizeSchemaShape(defs[node.$ref.replace('#/$defs/', '')], defs)
    const out = {}
    for (const key of Object.keys(node).sort()) {
      if (key === '$schema' || key === '$id' || key === 'title' || key === '$defs') continue
      const value = node[key]
      if (key === 'description' && typeof value === 'string') continue   // schema annotation, not part of the contract
      out[key] = (key === 'required' || key === 'enum') && Array.isArray(value) ? [...value].sort() : normalizeSchemaShape(value, defs)
    }
    return out
  }
  return node
}

const planContractFile = '.claude/workflows/plan-from-requirement.js'
if (exists(planContractFile) && exists('core/schemas/plan-artifacts.schema.json')) {
  const src = read(planContractFile)
  const startMarker = '// >>> SCHEMA-CONTRACT-START'
  const endMarker = '// <<< SCHEMA-CONTRACT-END'
  const start = src.indexOf(startMarker)
  const end = src.indexOf(endMarker)
  if (start === -1 || end === -1 || end <= start) {
    errors.push(`${planContractFile} is missing SCHEMA-CONTRACT markers required for the inline-vs-core schema parity check`)
  } else {
    // skip the remainder of the START marker line (it carries a trailing comment) so the block begins at clean code
    const blockStart = src.indexOf('\n', start)
    const block = src.slice(blockStart, end)
    let inlineSchemas = null
    try {
      inlineSchemas = new Function(`${block}\n; return { requirement: REQUIREMENT_SCHEMA, plan: PLAN_SCHEMA, risks: RISK_SCHEMA, testPlan: TESTPLAN_SCHEMA };`)()
    } catch (error) {
      errors.push(`failed to evaluate inline schemas in ${planContractFile}: ${error.message}`)
    }
    if (inlineSchemas) {
      const coreSchema = JSON.parse(read('core/schemas/plan-artifacts.schema.json'))
      const coreDefs = coreSchema.$defs || {}
      for (const key of ['requirement', 'plan', 'risks', 'testPlan']) {
        const inlineShape = JSON.stringify(normalizeSchemaShape(inlineSchemas[key], {}))
        const coreShape = JSON.stringify(normalizeSchemaShape(coreSchema.properties[key], coreDefs))
        if (inlineShape !== coreShape) {
          errors.push(`schema drift: ${planContractFile} ${key} schema no longer matches core/schemas/plan-artifacts.schema.json (properties.${key})`)
        }
      }
    }
  }
}

// deliver final-status logic (#6): run the unit tests, and behaviour-diff the workflow's inline copy
// against the canonical core/deliver-status.mjs over fixed vectors so they cannot drift (covers #1/#2).
for (const failure of runMultiAgentStatusTests()) errors.push(failure)
for (const failure of runDeliverStatusTests()) errors.push(failure)

const deliverWf = '.claude/workflows/deliver-from-plan.js'
if (exists(deliverWf)) {
  const src = read(deliverWf)
  const s = src.indexOf('// >>> DELIVER-STATUS-START')
  const e = src.indexOf('// <<< DELIVER-STATUS-END')
  if (s === -1 || e === -1 || e <= s) {
    errors.push(`${deliverWf} is missing DELIVER-STATUS markers required for the inline-vs-core parity check`)
  } else {
    const block = src.slice(src.indexOf('\n', s), e)
    let inlineFn = null
    try { inlineFn = new Function(`${block}\n; return computeDeliverStatus;`)() } catch (error) { errors.push(`failed to evaluate inline computeDeliverStatus in ${deliverWf}: ${error.message}`) }
    if (inlineFn) {
      for (const [name, input] of DELIVER_STATUS_CASES) {
        const inlineOut = JSON.stringify(inlineFn(input)), coreOut = JSON.stringify(coreComputeDeliverStatus(input))
        if (inlineOut !== coreOut) errors.push(`deliver-status drift on "${name}" (whole-object): inline=${inlineOut} core=${coreOut}`)
      }
    }
  }
}

// publish final-status logic: run the unit tests, and behaviour-diff the publish workflow's inline copy
// against the canonical core/publish-status.mjs over fixed vectors so they cannot drift.
for (const failure of runPublishStatusTests()) errors.push(failure)

const publishWf = '.claude/workflows/publish-delivery.js'
if (exists(publishWf)) {
  const src = read(publishWf)
  const s = src.indexOf('// >>> PUBLISH-STATUS-START')
  const e = src.indexOf('// <<< PUBLISH-STATUS-END')
  if (s === -1 || e === -1 || e <= s) {
    errors.push(`${publishWf} is missing PUBLISH-STATUS markers required for the inline-vs-core parity check`)
  } else {
    const block = src.slice(src.indexOf('\n', s), e)
    let inlineFn = null
    try { inlineFn = new Function(`${block}\n; return computePublishStatus;`)() } catch (error) { errors.push(`failed to evaluate inline computePublishStatus in ${publishWf}: ${error.message}`) }
    if (inlineFn) {
      for (const [name, input] of PUBLISH_STATUS_CASES) {
        const inlineStatus = inlineFn(input).finalStatus
        const coreStatus = coreComputePublishStatus(input).finalStatus
        if (inlineStatus !== coreStatus) errors.push(`publish-status drift on "${name}": inline=${inlineStatus} core=${coreStatus}`)
      }
    }
  }
}

// readiness logic (#2): run unit tests + behaviour-diff the plan workflow inline copy against core/readiness.mjs.
for (const failure of runReadinessTests()) errors.push(failure)

const planWf = '.claude/workflows/plan-from-requirement.js'
if (exists(planWf)) {
  const src = read(planWf)
  const s = src.indexOf('// >>> READINESS-START')
  const e = src.indexOf('// <<< READINESS-END')
  if (s === -1 || e === -1 || e <= s) {
    errors.push(`${planWf} is missing READINESS markers required for the inline-vs-core parity check`)
  } else {
    const block = src.slice(src.indexOf('\n', s), e)
    let inlineReadiness = null
    try { inlineReadiness = new Function(`${block}\n; return computeReadiness;`)() } catch (error) { errors.push(`failed to evaluate inline computeReadiness in ${planWf}: ${error.message}`) }
    if (inlineReadiness) {
      for (const [status] of READINESS_CASES) {
        const inlineR = inlineReadiness(status)
        const coreR = coreComputeReadiness(status)
        if (inlineR !== coreR) errors.push(`readiness drift on "${status}": inline=${inlineR} core=${coreR}`)
      }
    }
  }
}

// persist-outcome logic (#4): run unit tests + behaviour-diff the plan workflow inline copy against core/persist-outcome.mjs.
for (const failure of runPersistOutcomeTests()) errors.push(failure)
{
  const planWf = '.claude/workflows/plan-from-requirement.js'
  if (exists(planWf)) {
    const src = read(planWf)
    const s = src.indexOf('// >>> PERSIST-OUTCOME-START')
    const e = src.indexOf('// <<< PERSIST-OUTCOME-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${planWf} is missing PERSIST-OUTCOME markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inlineFn = null
      try { inlineFn = new Function(`${block}\n; return computePersistOutcome;`)() } catch (error) { errors.push(`failed to evaluate inline computePersistOutcome in ${planWf}: ${error.message}`) }
      if (inlineFn) {
        for (const [name, input] of PERSIST_OUTCOME_CASES) {
          const a = JSON.stringify(inlineFn(input)), b = JSON.stringify(coreComputePersistOutcome(input))
          if (a !== b) errors.push(`persist-outcome drift on "${name}" (whole-object): inline=${a} core=${b}`)
        }
      }
    }
  }
}

// repo-fingerprint logic (#5): run unit tests + behaviour-diff the deliver workflow inline copy against core.
for (const failure of runRepoFingerprintTests()) errors.push(failure)
{
  const dWf = '.claude/workflows/deliver-from-plan.js'
  if (exists(dWf)) {
    const src = read(dWf)
    const s = src.indexOf('// >>> FINGERPRINT-START')
    const e = src.indexOf('// <<< FINGERPRINT-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${dWf} is missing FINGERPRINT markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inlineFn = null
      try { inlineFn = new Function(`${block}\n; return compareRepoFingerprint;`)() } catch (error) { errors.push(`failed to evaluate inline compareRepoFingerprint in ${dWf}: ${error.message}`) }
      if (inlineFn) {
        for (const [name, planFp, currentFp] of REPO_FINGERPRINT_CASES) {
          const a = JSON.stringify(inlineFn(planFp, currentFp)), b = JSON.stringify(coreCompareRepoFingerprint(planFp, currentFp))
          if (a !== b) errors.push(`repo-fingerprint drift on "${name}" (whole-object): inline=${a} core=${b}`)
        }
      }
    }
  }
}

// changed-files reconciliation (#4): run unit tests + behaviour-diff the deliver workflow inline copy.
for (const failure of runChangedFilesTests()) errors.push(failure)
{
  const dWf = '.claude/workflows/deliver-from-plan.js'
  if (exists(dWf)) {
    const src = read(dWf)
    const s = src.indexOf('// >>> CHANGED-FILES-START')
    const e = src.indexOf('// <<< CHANGED-FILES-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${dWf} is missing CHANGED-FILES markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inlineFn = null
      try { inlineFn = new Function(`${block}\n; return reconcileChangedFiles;`)() } catch (error) { errors.push(`failed to evaluate inline reconcileChangedFiles in ${dWf}: ${error.message}`) }
      if (inlineFn) {
        for (const [name, input] of CHANGED_FILES_CASES) {
          const a = JSON.stringify(inlineFn(input)), b = JSON.stringify(coreReconcileChangedFiles(input))
          if (a !== b) errors.push(`changed-files drift on "${name}" (whole-object): inline=${a} core=${b}`)
        }
      }
    }
  }
}

// plan-patch logic (#2): run unit tests + behaviour-diff the plan workflow inline copy against core.
for (const failure of runPlanPatchTests()) errors.push(failure)
{
  const pWf = '.claude/workflows/plan-from-requirement.js'
  if (exists(pWf)) {
    const src = read(pWf)
    const s = src.indexOf('// >>> PLAN-PATCH-START')
    const e = src.indexOf('// <<< PLAN-PATCH-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${pWf} is missing PLAN-PATCH markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inlineFn = null
      try { inlineFn = new Function(`${block}\n; return applyPlanPatch;`)() } catch (error) { errors.push(`failed to evaluate inline applyPlanPatch in ${pWf}: ${error.message}`) }
      if (inlineFn) {
        for (const [name, plan, patch] of PLAN_PATCH_CASES) {
          if (JSON.stringify(inlineFn(plan, patch)) !== JSON.stringify(coreApplyPlanPatch(plan, patch))) errors.push(`plan-patch drift on "${name}"`)
        }
      }
    }
  }
}

// git red-line guard (auto-publish hard enforcement): run classifier tests + confirm the PreToolUse hook is wired.
for (const failure of runGitGuardTests()) errors.push(failure)

// project-type classifier (for browser-verification scoping): run unit tests + behaviour-diff the deliver inline copy against core.
for (const failure of runProjectTypeTests()) errors.push(failure)
{
  const ptWf = '.claude/workflows/deliver-from-plan.js'
  if (exists(ptWf)) {
    const src = read(ptWf)
    const s = src.indexOf('// >>> PROJECT-TYPE-START')
    const e = src.indexOf('// <<< PROJECT-TYPE-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${ptWf} is missing PROJECT-TYPE markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inlineFn = null
      try { inlineFn = new Function(`${block}\n; return classifyProjectType;`)() } catch (error) { errors.push(`failed to evaluate inline classifyProjectType in ${ptWf}: ${error.message}`) }
      if (inlineFn) {
        for (const [name, input] of PROJECT_TYPE_CASES) {
          const a = JSON.stringify(inlineFn(input)), b = JSON.stringify(coreClassifyProjectType(input))
          if (a !== b) errors.push(`project-type drift on "${name}" (whole-object): inline=${a} core=${b}`)
        }
      }
    }
  }
}

// git-state classification + branch-choice resolution (shared cross-adapter git gate): run unit tests.
// No inline-vs-core parity yet — these become parity-locked once a workflow inlines them; today the bin/
// CLI and the Codex adapter consume core/ directly (single copy), so there is nothing to drift against.
for (const failure of runGitStateTests()) errors.push(failure)
for (const failure of runBranchChoiceTests()) errors.push(failure)
// scriptified mechanical ops (shared deterministic bin/ scripts): SCOPE check + sandbox cleanup + persist
for (const failure of runScopeCheckTests()) errors.push(failure)
for (const failure of runSandboxPrepareTests()) errors.push(failure)
for (const failure of runPersistArtifactsTests()) errors.push(failure)
for (const failure of runCoreCliInputTests()) errors.push(failure)
for (const failure of runExecutionContextTests()) errors.push(failure)
for (const failure of runDiffFromSandboxTests()) errors.push(failure)
for (const failure of runUtf8ShellTests()) errors.push(failure)
// test-integrity primitives (test/impl boundary hole): canonical tests fingerprint + deterministic test runner
for (const failure of runTestsFingerprintTests()) errors.push(failure)
for (const failure of runVerifyTestsTests()) errors.push(failure)
// rm-path safety guard for the destructive bin scripts (refuse src/root/overlap/symlink delete targets)
for (const failure of runSafeRmTests()) errors.push(failure)
{
  const r = run(process.execPath, ['scripts/check-agent-parity.mjs'])
  if (!r.ok) errors.push(`agent parity check failed: ${(r.stderr || r.stdout).trim()}`)
}
// branch-choice resolution: behaviour-diff the publish workflow inline copy against core/branch-choice.mjs
// (whole-object deep compare over fixed vectors) so Claude and the Codex adapter cannot drift apart.
{
  const bcWf = '.claude/workflows/publish-delivery.js'
  if (exists(bcWf)) {
    const src = read(bcWf)
    const s = src.indexOf('// >>> BRANCH-CHOICE-START')
    const e = src.indexOf('// <<< BRANCH-CHOICE-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${bcWf} is missing BRANCH-CHOICE markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inlineFn = null
      try { inlineFn = new Function(`${block}\n; return resolveBranchChoice;`)() } catch (error) { errors.push(`failed to evaluate inline resolveBranchChoice in ${bcWf}: ${error.message}`) }
      if (inlineFn) {
        for (const [name, input] of BRANCH_CHOICE_CASES) {
          if (JSON.stringify(inlineFn(input)) !== JSON.stringify(coreResolveBranchChoice(input))) errors.push(`branch-choice drift on "${name}"`)
        }
      }
    }
  }
}
// remote-URL credential redaction: run unit tests + behaviour-diff the publish workflow inline copy against
// core/mask-remote-url.mjs (mask string + hasEmbeddedCredentials bool over fixed vectors) so they cannot drift.
for (const failure of runMaskRemoteUrlTests()) errors.push(failure)
{
  const mWf = '.claude/workflows/publish-delivery.js'
  if (exists(mWf)) {
    const src = read(mWf)
    const s = src.indexOf('// >>> MASK-REMOTE-URL-START')
    const e = src.indexOf('// <<< MASK-REMOTE-URL-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${mWf} is missing MASK-REMOTE-URL markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inline = null
      try { inline = new Function(`${block}\n; return { maskRemoteUrl, hasEmbeddedCredentials };`)() } catch (error) { errors.push(`failed to evaluate inline mask-remote-url in ${mWf}: ${error.message}`) }
      if (inline) {
        for (const [name, url] of MASK_REMOTE_URL_CASES) {
          if (inline.maskRemoteUrl(url) !== coreMaskRemoteUrl(url)) errors.push(`mask-remote-url drift on "${name}": inline=${inline.maskRemoteUrl(url)} core=${coreMaskRemoteUrl(url)}`)
          if (inline.hasEmbeddedCredentials(url) !== coreHasEmbeddedCredentials(url)) errors.push(`hasEmbeddedCredentials drift on "${name}": inline=${inline.hasEmbeddedCredentials(url)} core=${coreHasEmbeddedCredentials(url)}`)
        }
      }
    }
  }
}
// post-push remote-verify recompute: run unit tests + behaviour-diff the publish workflow inline copy against
// core/verify-remote-publish.mjs (recomputed booleans + forbidden-file scan over fixed vectors) so they cannot drift.
for (const failure of runVerifyRemotePublishTests()) errors.push(failure)
// inspect-remote CLI: a raw credentialed remote URL must never leave the CLI into agent/log/artifact
for (const failure of runInspectRemoteTests()) errors.push(failure)
{
  const vWf = '.claude/workflows/publish-delivery.js'
  if (exists(vWf)) {
    const src = read(vWf)
    const s = src.indexOf('// >>> VERIFY-REMOTE-PUBLISH-START')
    const e = src.indexOf('// <<< VERIFY-REMOTE-PUBLISH-END')
    if (s === -1 || e === -1 || e <= s) {
      errors.push(`${vWf} is missing VERIFY-REMOTE-PUBLISH markers required for the inline-vs-core parity check`)
    } else {
      const block = src.slice(src.indexOf('\n', s), e)
      let inline = null
      try { inline = new Function(`${block}\n; return { verifyRemotePublish, findForbiddenFiles };`)() } catch (error) { errors.push(`failed to evaluate inline verify-remote-publish in ${vWf}: ${error.message}`) }
      if (inline) {
        for (const [name, input] of VERIFY_REMOTE_PUBLISH_CASES) {
          if (JSON.stringify(inline.verifyRemotePublish(input)) !== JSON.stringify(coreVerifyRemotePublish(input))) errors.push(`verify-remote-publish drift on "${name}"`)
        }
        for (const probe of [['.env', 'src/a.js'], ['deploy/id_rsa', 'ok.txt'], ['config/x.pem']]) {
          if (JSON.stringify(inline.findForbiddenFiles(probe)) !== JSON.stringify(coreFindForbiddenFiles(probe))) errors.push(`findForbiddenFiles drift on ${JSON.stringify(probe)}`)
        }
      }
    }
  }
}
if (!exists('scripts/git-guard-hook.mjs')) errors.push('missing scripts/git-guard-hook.mjs (git red-line PreToolUse hook entry)')
// Codex skill entry point: the recognizable `.agents/skills` entry must exist with valid name+description
// frontmatter (the format Codex documents), so the entry can't silently break or disappear.
{
  const skillFile = '.agents/skills/ai-engineering-workflow/SKILL.md'
  const oldSkillFile = '.agents/skills/ai-engineering-delivery/SKILL.md'
  if (exists(oldSkillFile)) errors.push(`old Codex skill entry must not be kept in parallel: ${oldSkillFile}`)
  if (!exists(skillFile)) errors.push(`missing Codex skill entry ${skillFile}`)
  else {
    const skillText = read(skillFile)
    const fm = /^---\n([\s\S]*?)\n---/.exec(skillText)
    if (!fm) errors.push(`${skillFile} is missing YAML frontmatter`)
    else if (!/(^|\n)name:\s*\S/.test(fm[1]) || !/(^|\n)description:\s*\S/.test(fm[1])) errors.push(`${skillFile} frontmatter must include name and description`)
    else {
      if (!/(^|\n)name:\s*ai-engineering-workflow\s*(\n|$)/.test(fm[1])) errors.push(`${skillFile} frontmatter name must be ai-engineering-workflow`)
      if (!/autonomous software engineering workflow/i.test(fm[1])) errors.push(`${skillFile} description must identify the skill as an autonomous engineering workflow`)
    }
    for (const needle of [
      '<toolkit-root>/codex/pipeline.md',
      '<toolkit-root>/codex/plan-from-requirement.md',
      'validate-plan-artifacts.mjs',
      'validate-delivery-artifacts.mjs',
      'sandbox copy',
      'never by directly editing the target repository',
      'changes.diff',
      'delivery-manifest.json',
      'requirement.json',
      'test-plan.json',
      'independent review stage',
      'independent verification stage',
    ]) {
      if (!skillText.includes(needle)) errors.push(`${skillFile} must enforce pipeline contract detail: ${needle}`)
    }
  }
  // the skill + AGENTS template orchestrate these shared assets — none may be a dangling reference
  for (const ref of [
    'bin/core.mjs', 'bin/git-state.mjs', 'bin/execution-context.mjs', 'bin/sandbox-prepare.mjs', 'bin/persist-artifacts.mjs', 'core/scope-check.mjs',
    'bin/diff-from-sandbox.mjs', 'bin/tests-fingerprint.mjs', 'bin/verify-tests.mjs', 'bin/safe-rm.mjs', 'bin/inspect-remote.mjs',
    'scripts/validate-plan-artifacts.mjs', 'scripts/validate-delivery-artifacts.mjs', 'scripts/validate-publish-record.mjs',
    'core/schemas/plan-artifacts.schema.json', 'core/schemas/delivery-artifacts.schema.json', 'core/schemas/publish-record.schema.json',
    'codex/pipeline.md', 'codex/plan-from-requirement.md', 'codex/AGENTS.template.md',
  ]) if (!exists(ref)) errors.push(`Codex skill/AGENTS references a missing file: ${ref}`)
}
if (exists('.claude/settings.json')) {
  let settingsText = ''
  try { settingsText = read('.claude/settings.json') } catch { settingsText = '' }
  if (!settingsText.includes('git-guard-hook')) errors.push('.claude/settings.json exists but does not wire the git-guard PreToolUse hook (auto-publish git red lines would be unenforced)')
} else {
  warn.push('.claude/settings.json absent: the git red-line PreToolUse hook is not installed; auto-publish runs without hard git enforcement')
}

errors.push(...validatePlanArtifacts(path.join(root, 'examples/artifacts/plan-ready')))
errors.push(...validateDeliveryArtifacts(path.join(root, 'examples/artifacts/delivery-success')))
errors.push(...validatePublishRecord(path.join(root, 'examples/artifacts/publish-record-example')))

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiew-delivery-schema-'))
  try {
    const src = path.join(root, 'examples/artifacts/delivery-success')
    fs.cpSync(src, tmp, { recursive: true })
    const manifestPath = path.join(tmp, 'delivery-manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.multiAgent.required = false
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    const negative = validateDeliveryArtifacts(tmp)
    if (!negative.some(error => error.includes('BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION'))) {
      errors.push('delivery validation must reject DELIVERED manifests with multiAgent.required=false')
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiew-delivery-semantic-'))
  try {
    const src = path.join(root, 'examples/artifacts/delivery-success')
    fs.cpSync(src, tmp, { recursive: true })
    const manifestPath = path.join(tmp, 'delivery-manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.finalStatus = 'DELIVERED_WITH_OPEN_ITEMS'
    manifest.openItems = []
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    const negative = validateDeliveryArtifacts(tmp)
    if (!negative.some(error => error.includes('recomputed DELIVERED')) ||
        !negative.some(error => error.includes('DELIVERED_WITH_OPEN_ITEMS requires at least one open item'))) {
      errors.push('delivery validation must semantically reject DELIVERED_WITH_OPEN_ITEMS with empty openItems')
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiew-publish-semantic-'))
  try {
    const src = path.join(root, 'examples/artifacts/publish-record-example')
    fs.cpSync(src, tmp, { recursive: true })
    const recordPath = path.join(tmp, 'final-delivery.json')
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    record.finalStatus = 'PUBLISHED'
    record.deliverableStatus = 'DELIVERED_WITH_OPEN_ITEMS'
    record.openItems = []
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8')
    const negative = validatePublishRecord(tmp)
    if (!negative.some(error => error.includes('recomputed PUBLISH_BLOCKED'))) {
      errors.push('publish validation must recompute and reject contradictory delivered-with-open-items records')
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

for (const file of ['app.sh', 'test.sh']) {
  const plan = JSON.parse(read('examples/artifacts/plan-ready/plan.json'))
  if (!plan.affected.files.includes(file)) errors.push(`plan.json affected.files missing ${file}`)
}

const deliveryManifest = JSON.parse(read('examples/artifacts/delivery-success/delivery-manifest.json'))
if (deliveryManifest.diffApplyCheckPassed !== true) errors.push('delivery manifest must record diffApplyCheckPassed=true')
for (const file of deliveryManifest.filesChanged || []) {
  if (file.startsWith('examples/') || path.isAbsolute(file)) errors.push(`delivery filesChanged must be target-root-relative: ${file}`)
}

function findBash() {
  const candidates = process.platform === 'win32'
    ? ['D:/Git/bin/bash.exe', 'D:/Git/usr/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe', 'bash']
    : ['bash']
  for (const candidate of candidates) {
    const result = run(candidate, ['--version'])
    if (result.ok) return candidate
  }
  return null
}

const bash = findBash()
if (!bash) {
  errors.push('bash is required for example test execution')
} else {
  const test = run(bash, ['-lc', 'cd examples/minimal-target && bash ./test.sh'])
  if (!test.ok) errors.push(`example test failed: ${test.stderr || test.stdout}`)
}

const applyCheck = git(['apply', '--check', path.resolve(root, 'examples/artifacts/delivery-success/changes.diff')], {
  cwd: path.join(root, 'examples/minimal-target'),
})
if (!applyCheck.ok) errors.push(`example diff is not applicable from target root: ${applyCheck.stderr || applyCheck.stdout}`)

const readme = read('README.md')
const readmeMust = [
  'Claude Code Dynamic Workflows',
  'plan-from-requirement',
  'deliver-from-plan',
  'Workflow({ scriptPath:',
  'examples/minimal-target',
  'node scripts/self-check.mjs',
]
for (const needle of readmeMust) if (!readme.includes(needle)) errors.push(`README.md missing expected content: ${needle}`)

const ciPaths = ['.github/workflows/ci.yml', '.github/workflows/ci.yaml']
for (const ciPath of ciPaths) {
  if (!exists(ciPath)) continue
  const ci = read(ciPath)
  if (!ci.includes('node scripts/self-check.mjs')) errors.push(`${ciPath} does not run self-check`)
}

if (errors.length) {
  console.error('SELF-CHECK FAILED')
  for (const e of errors) console.error(`- ${e}`)
  process.exit(1)
}

console.log('SELF-CHECK PASSED')
console.log(`tracked files scanned: ${trackedFiles.length}`)
console.log('checks: paths/secrets, Workflow JS syntax, inline-vs-core schema parity, multi-agent gate, deliver-status logic+parity, publish-status logic+parity, readiness logic+parity, persist-outcome logic+parity, repo-fingerprint logic+parity, changed-files logic+parity, plan-patch logic+parity, git red-line guard, project-type logic+parity, git-state logic, branch-choice logic+parity, remote-url credential mask+parity, remote-verify recompute+parity, scope-check logic, execution-context, sandbox+persist scripts, core CLI input modes, portable diff generation, UTF-8 shell materialization, tests-fingerprint, deterministic test-runner, rm-path guards, codex skill entry + refs, delivery+publish schema, example schemas, example test, diff apply')
for (const w of warn) console.log(`WARN: ${w}`)
