// Validate a deliver-from-plan delivery directory against core/schemas/delivery-artifacts.schema.json.
// Run: node scripts/validate-delivery-artifacts.mjs <delivery-dir>
// Reuses the JSON-schema engine from validate-plan-artifacts.mjs (the delivery schema is flat / no $ref),
// so the validation logic is shared, not duplicated. Imported by scripts/self-check.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validate } from './validate-plan-artifacts.mjs'
import { computeMultiAgentGate } from '../core/multi-agent-status.mjs'
import { computeDeliverStatus } from '../core/deliver-status.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(fs.readFileSync(path.join(root, 'core/schemas/delivery-artifacts.schema.json'), 'utf8'))

function sortedUnique(values) {
  return [...new Set((values || []).filter(Boolean))].sort()
}

function diffFiles(diffText) {
  const files = []
  for (const line of diffText.split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (match) files.push(match[2] || match[1])
  }
  return sortedUnique(files)
}

function sameSet(a, b) {
  const left = sortedUnique(a)
  const right = sortedUnique(b)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function comparableMultiAgent(value) {
  if (!value || typeof value !== 'object') return value
  return {
    required: value.required,
    requiredStages: value.requiredStages || [],
    preflightPassed: value.preflightPassed,
    executed: value.executed,
    fallbackUsed: value.fallbackUsed,
    parentAgentImplemented: value.parentAgentImplemented,
    parentAgentImplementedBeforeImplementerSpawn: value.parentAgentImplementedBeforeImplementerSpawn,
    parentAgentRanTestsWithoutVerifier: value.parentAgentRanTestsWithoutVerifier,
    spawnSupported: value.spawnSupported,
    agentsDiscoverable: value.agentsDiscoverable,
    roles: value.roles || [],
  }
}

function normalizedBrowser(value) {
  if (!value) return value
  return {
    applicable: value.applicable,
    status: value.finalBrowserStatus === 'skipped-no-capability'
      ? 'skipped'
      : (value.finalBrowserStatus || value.status),
    openItems: value.openItems || [],
  }
}

function normalizedCodeQuality(value) {
  if (!value) return value
  const staticChecks = Array.isArray(value.staticChecks) ? value.staticChecks : []
  return {
    applicable: value.applicable,
    compileRan: value.compileRan,
    compilePassed: value.compilePassed,
    hasP0Failure: value.hasP0Failure === true || staticChecks.some(c => c && c.status === 'failed' && c.severity === 'P0'),
    openItems: value.openItems || [],
  }
}

function statusInputConsistencyErrors(manifest, dir) {
  const errors = []
  const s = manifest.statusInput && typeof manifest.statusInput === 'object' && !Array.isArray(manifest.statusInput)
    ? manifest.statusInput
    : null
  if (!s) return errors
  const mismatch = (name, a, b) => { if (!sameJson(a, b)) errors.push(`${dir}.${name}: statusInput mismatch`) }
  const verify = manifest.independentVerify || {}
  const statusVerify = s.verify || {}
  mismatch('independentVerify.donePassedVerified', verify.donePassedVerified, statusVerify.donePassedVerified)
  mismatch('independentVerify.scopeCleanVerified', verify.scopeCleanVerified, statusVerify.scopeCleanVerified)
  mismatch('independentVerify.redGreenVerified', verify.redGreenVerified, statusVerify.redGreenVerified)
  mismatch('independentVerify.testsIntact', verify.testsIntact, statusVerify.testsIntact)
  mismatch('multiAgent', comparableMultiAgent(manifest.multiAgent), comparableMultiAgent(s.multiAgent))
  mismatch('implementPassed', manifest.implementPassed, s.implementPassed)
  mismatch('scopeViolations', manifest.scopeViolations || [], s.scopeViolations || [])
  mismatch('filesReconcileIssues', manifest.filesReconcileIssues || [], s.filesReconcileIssues || [])
  mismatch('diffApplyCheckPassed', manifest.diffApplyCheckPassed, s.diff && s.diff.diffApplyCheckPassed)
  mismatch('filesChanged', manifest.filesChanged || [], s.diff ? (s.diff.filesChanged || []) : [])
  mismatch('deliveryPersisted', manifest.deliveryPersisted, s.deliveryPersisted)
  mismatch('reviewComplete', manifest.reviewComplete, s.reviewIncomplete === false)
  const statusReviews = Array.isArray(s.reviews) ? s.reviews : []
  const topReviews = (manifest.reviewVerdicts || []).map(r => ({ verdict: r.verdict, blocking: r.blocking }))
  mismatch('reviewVerdicts', topReviews, statusReviews)
  mismatch('browserVerify', normalizedBrowser(manifest.browserVerify || manifest.browser || null), normalizedBrowser(s.browser || null))
  mismatch('codeQuality', normalizedCodeQuality(manifest.codeQuality || null), normalizedCodeQuality(s.codeQuality || null))
  return errors
}

function deliverStatusInput(manifest) {
  if (manifest.statusInput && typeof manifest.statusInput === 'object' && !Array.isArray(manifest.statusInput)) {
    return manifest.statusInput
  }
  const verify = manifest.independentVerify || null
  return {
    priorStatus: 'FAILED',
    multiAgent: manifest.multiAgent,
    implementPassed: manifest.implementPassed,
    verify,
    reviews: manifest.reviewVerdicts || [],
    reviewIncomplete: manifest.reviewComplete !== true,
    materializeOpenLoopItems: manifest.materializeOpenLoopItems || [],
    gateOpenQuestions: manifest.gateOpenQuestions || [],
    gateRemainingGaps: manifest.gateRemainingGaps || [],
    staleSeverity: manifest.staleSeverity,
    scopeViolations: manifest.scopeViolations || [],
    filesReconcileIssues: manifest.filesReconcileIssues || [],
    browser: manifest.browserVerify || manifest.browser || null,
    codeQuality: manifest.codeQuality || null,
    diff: {
      ok: true,
      diffApplyCheckPassed: manifest.diffApplyCheckPassed,
      filesChanged: manifest.filesChanged || [],
    },
    deliveryPersisted: manifest.deliveryPersisted,
  }
}

function isLegacyMissingError(error) {
  return error.includes('.filesReconcileIssues: missing required property') ||
    error.includes('.deliveryPersisted: missing required property') ||
    error.includes('.persistVerification: missing required property') ||
    error.includes('.statusInput: missing required property') ||
    error.includes('.independentVerify.testsIntact: missing required property')
}

function applyCheck(baseDir, diffPath) {
  const result = spawnSync('git', ['apply', '--check', diffPath], { cwd: baseDir, encoding: 'utf8' })
  return {
    ok: result.status === 0,
    status: typeof result.status === 'number' ? result.status : 1,
    output: ((result.stdout || '') + (result.stderr || '')).slice(-4000),
  }
}

export function validateDeliveryManifestSemantics(manifest, options = {}) {
  const label = options.label || 'delivery-manifest.json'
  const errors = []
  errors.push(...statusInputConsistencyErrors(manifest, label))
  const statusInput = deliverStatusInput(manifest)
  const recomputeInput = options.assumeDeliveryPersisted === true
    ? { ...statusInput, deliveryPersisted: true }
    : statusInput
  const recomputed = computeDeliverStatus({ ...recomputeInput, allowLegacyUnverifiedDelivery: options.allowLegacy === true })
  if (recomputed.finalStatus !== manifest.finalStatus) {
    const suffix = options.assumeDeliveryPersisted === true ? ' with deliveryPersisted=true' : ''
    errors.push(`${label}.finalStatus: recomputed ${recomputed.finalStatus}${suffix}, manifest says ${manifest.finalStatus}`)
  }
  const openItems = Array.isArray(manifest.openItems) ? manifest.openItems : []
  if (manifest.finalStatus === 'DELIVERED' && openItems.length > 0) {
    errors.push(`${label}.openItems: DELIVERED requires openItems to be empty`)
  }
  if (manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS' && openItems.length === 0) {
    errors.push(`${label}.openItems: DELIVERED_WITH_OPEN_ITEMS requires at least one open item`)
  }
  return errors
}

export function validateDeliveryArtifactsDetailed(deliveryDir, options = {}) {
  const dir = path.resolve(deliveryDir)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'delivery-manifest.json'), 'utf8'))
  const warnings = []
  let legacyUnverified = false
  let errors = validate(manifest, schema, dir)
  if (options.allowLegacy === true) {
    const strictErrors = errors.filter(error => !isLegacyMissingError(error))
    if (strictErrors.length !== errors.length) {
      legacyUnverified = true
      warnings.push(`${dir}: legacyUnverified=true (missing strict delivery verification fields)`)
    }
    errors = strictErrors
  }
  errors.push(...validateDeliveryManifestSemantics(manifest, { label: dir, allowLegacy: options.allowLegacy === true }))
  if (manifest.finalStatus === 'DELIVERED' || manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS') {
    const gate = computeMultiAgentGate({ multiAgent: manifest.multiAgent, requireMultiAgent: true })
    if (!gate.ok) errors.push(`${dir}.multiAgent: ${gate.finalStatus} ${gate.reasonCode || ''}`.trim())
    if (!(options.allowLegacy === true && legacyUnverified)) {
      if (manifest.deliveryPersisted !== true) errors.push(`${dir}.deliveryPersisted: delivered manifests require deliveryPersisted=true`)
      if (!manifest.persistVerification || manifest.persistVerification.ok !== true) errors.push(`${dir}.persistVerification.ok: delivered manifests require persistVerification.ok=true`)
      if (!manifest.independentVerify || manifest.independentVerify.testsIntact !== true) errors.push(`${dir}.independentVerify.testsIntact: delivered manifests require testsIntact=true`)
      if (Array.isArray(manifest.scopeViolations) && manifest.scopeViolations.length > 0) errors.push(`${dir}.scopeViolations: delivered manifests require no scope violations`)
      if (Array.isArray(manifest.filesReconcileIssues) && manifest.filesReconcileIssues.length > 0) errors.push(`${dir}.filesReconcileIssues: delivered manifests require no file reconciliation issues`)
    }
  }
  const diffPath = path.join(dir, 'changes.diff')
  if (fs.existsSync(diffPath)) {
    const filesFromDiff = diffFiles(fs.readFileSync(diffPath, 'utf8'))
    if (!sameSet(filesFromDiff, manifest.filesChanged || [])) {
      errors.push(`${dir}.filesChanged: changes.diff files ${JSON.stringify(filesFromDiff)} do not match manifest filesChanged ${JSON.stringify(sortedUnique(manifest.filesChanged || []))}`)
    }
    if (options.baseDir) {
      const check = applyCheck(path.resolve(options.baseDir), diffPath)
      if (!check.ok) errors.push(`${dir}/changes.diff: git apply --check failed against ${path.resolve(options.baseDir)} (exit ${check.status}): ${check.output}`)
    } else if (manifest.finalStatus === 'DELIVERED' || manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS') {
      warnings.push(`${dir}/changes.diff: apply check not independently reverified (pass --base <clean-base-dir> to re-run git apply --check)`)
    }
  } else if (manifest.finalStatus === 'DELIVERED' || manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS') {
    errors.push(`${dir}/changes.diff: missing for delivered manifest`)
  }
  return { errors, warnings, legacyUnverified }
}

export function validateDeliveryArtifacts(deliveryDir, options = {}) {
  return validateDeliveryArtifactsDetailed(deliveryDir, options).errors
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  let deliveryDir = null
  let baseDir = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow-legacy') continue
    if (args[i] === '--base') { baseDir = args[++i]; continue }
    if (!deliveryDir) deliveryDir = args[i]
  }
  const allowLegacy = args.includes('--allow-legacy')
  if (!deliveryDir) {
    console.error('usage: node scripts/validate-delivery-artifacts.mjs <delivery-dir> [--allow-legacy] [--base <clean-base-dir>]')
    process.exit(2)
  }
  const result = validateDeliveryArtifactsDetailed(deliveryDir, { allowLegacy, baseDir })
  const errors = result.errors
  if (errors.length) {
    console.error('DELIVERY ARTIFACT VALIDATION FAILED')
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }
  if (result.legacyUnverified) {
    console.log('DELIVERY ARTIFACT VALIDATION LEGACY_UNVERIFIED')
    for (const warning of result.warnings) console.log(`WARN: ${warning}`)
  } else {
    console.log('DELIVERY ARTIFACT VALIDATION PASSED')
    for (const warning of result.warnings) console.log(`WARN: ${warning}`)
  }
}
