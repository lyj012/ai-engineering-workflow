#!/usr/bin/env node
// Verify delivery-manifest.json from disk and, optionally, atomically mark persistVerification.ok=true.
// This makes manifest persistence a filesystem fact instead of a model-judged boolean.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from '../scripts/validate-plan-artifacts.mjs'
import { computeDeliverStatus } from '../core/deliver-status.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const deliverySchema = JSON.parse(fs.readFileSync(path.join(root, 'core/schemas/delivery-artifacts.schema.json'), 'utf8'))

function parseArgs(argv) {
  const a = {
    dir: null,
    finalStatus: null,
    filesChangedJson: null,
    diffApplyCheckPassed: null,
    markOk: false,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') a.dir = argv[++i]
    else if (argv[i] === '--final-status') a.finalStatus = argv[++i]
    else if (argv[i] === '--files-changed-json') a.filesChangedJson = argv[++i]
    else if (argv[i] === '--diff-apply-check-passed') a.diffApplyCheckPassed = argv[++i] === 'true'
    else if (argv[i] === '--mark-ok') a.markOk = true
  }
  return a
}

function sameArray(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index])
}

function writeAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

function pushMismatch(out, name, a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${name} mismatch`)
}

function comparableMultiAgent(value) {
  if (!value || typeof value !== 'object') return value
  return {
    required: value.required,
    requiredStages: value.requiredStages || [],
    preflightPassed: value.preflightPassed,
    executed: value.executed,
    fallbackUsed: value.fallbackUsed,
    parentAgent: value.parentAgent,
    roles: value.roles || [],
  }
}

function semanticErrors(manifest, label) {
  const errors = validate(manifest, deliverySchema, label)
  const statusInput = manifest.statusInput && typeof manifest.statusInput === 'object' && !Array.isArray(manifest.statusInput)
    ? manifest.statusInput
    : null
  if (!statusInput) {
    errors.push(`${label}.statusInput: missing normalized deliver-status input`)
    return errors
  }
  const expectedStatusInput = { ...statusInput, deliveryPersisted: true }
  const recomputed = computeDeliverStatus(expectedStatusInput)
  if (recomputed.finalStatus !== manifest.finalStatus) {
    errors.push(`${label}.finalStatus: recomputed ${recomputed.finalStatus} with deliveryPersisted=true, manifest says ${manifest.finalStatus}`)
  }
  const verify = manifest.independentVerify || {}
  const statusVerify = statusInput.verify || {}
  pushMismatch(errors, `${label}.independentVerify.donePassedVerified/statusInput.verify.donePassedVerified`, verify.donePassedVerified, statusVerify.donePassedVerified)
  pushMismatch(errors, `${label}.independentVerify.scopeCleanVerified/statusInput.verify.scopeCleanVerified`, verify.scopeCleanVerified, statusVerify.scopeCleanVerified)
  pushMismatch(errors, `${label}.independentVerify.redGreenVerified/statusInput.verify.redGreenVerified`, verify.redGreenVerified, statusVerify.redGreenVerified)
  pushMismatch(errors, `${label}.independentVerify.testsIntact/statusInput.verify.testsIntact`, verify.testsIntact, statusVerify.testsIntact)
  pushMismatch(errors, `${label}.multiAgent/statusInput.multiAgent`, comparableMultiAgent(manifest.multiAgent), comparableMultiAgent(statusInput.multiAgent))
  pushMismatch(errors, `${label}.scopeViolations/statusInput.scopeViolations`, manifest.scopeViolations || [], statusInput.scopeViolations || [])
  pushMismatch(errors, `${label}.filesReconcileIssues/statusInput.filesReconcileIssues`, manifest.filesReconcileIssues || [], statusInput.filesReconcileIssues || [])
  pushMismatch(errors, `${label}.diffApplyCheckPassed/statusInput.diff.diffApplyCheckPassed`, manifest.diffApplyCheckPassed, statusInput.diff && statusInput.diff.diffApplyCheckPassed)
  pushMismatch(errors, `${label}.filesChanged/statusInput.diff.filesChanged`, manifest.filesChanged || [], statusInput.diff ? (statusInput.diff.filesChanged || []) : [])
  if (manifest.deliveryPersisted !== false && manifest.deliveryPersisted !== true) errors.push(`${label}.deliveryPersisted: expected boolean`)
  return errors
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.dir || !a.finalStatus || !a.filesChangedJson || a.diffApplyCheckPassed === null) {
    process.stderr.write('usage: node bin/verify-delivery-persist.mjs --dir <delivery-dir> --final-status <status> --files-changed-json <json-array> --diff-apply-check-passed <true|false> [--mark-ok]\n')
    process.exit(2)
  }

  const dir = path.resolve(a.dir)
  const manifestPath = path.join(dir, 'delivery-manifest.json')
  let expectedFiles
  try { expectedFiles = JSON.parse(a.filesChangedJson) } catch (e) {
    process.stderr.write(`invalid --files-changed-json: ${e.message}\n`)
    process.exit(2)
  }

  const report = {
    ok: false,
    manifestPath,
    exists: false,
    parseOk: false,
    readbackOk: false,
    diskFinalStatus: null,
    contentConsistent: false,
    persistOkOnDisk: false,
    deliveryPersistedOnDisk: false,
    semanticOk: false,
    semanticErrors: [],
    note: '',
  }

  if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size === 0) {
    report.note = 'delivery-manifest.json missing or empty'
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exit(1)
  }
  report.exists = true

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    report.parseOk = true
  } catch (e) {
    report.note = `delivery-manifest.json is not parseable JSON: ${e.message}`
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exit(1)
  }

  report.diskFinalStatus = manifest.finalStatus || null
  report.contentConsistent = manifest.finalStatus === a.finalStatus &&
    sameArray(manifest.filesChanged, expectedFiles) &&
    manifest.diffApplyCheckPassed === a.diffApplyCheckPassed
  report.readbackOk = report.parseOk && report.contentConsistent
  report.semanticErrors = semanticErrors(manifest, manifestPath)
  report.semanticOk = report.semanticErrors.length === 0

  if (report.readbackOk && report.semanticOk && a.markOk) {
    manifest.deliveryPersisted = true
    manifest.persistVerification = {
      ...(manifest.persistVerification || {}),
      ok: true,
      readbackOk: true,
      diskFinalStatus: manifest.finalStatus,
      contentConsistent: true,
    }
    if (manifest.statusInput && typeof manifest.statusInput === 'object') {
      manifest.statusInput.deliveryPersisted = true
    }
    writeAtomic(manifestPath, manifest)
    const confirmed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    report.persistOkOnDisk = confirmed.persistVerification && confirmed.persistVerification.ok === true
    report.deliveryPersistedOnDisk = confirmed.deliveryPersisted === true
  } else {
    report.persistOkOnDisk = manifest.persistVerification && manifest.persistVerification.ok === true
    report.deliveryPersistedOnDisk = manifest.deliveryPersisted === true
  }

  report.ok = report.readbackOk && report.semanticOk && (a.markOk ? (report.persistOkOnDisk && report.deliveryPersistedOnDisk) : true)
  report.note = report.ok ? 'delivery manifest readback verified' : 'delivery manifest readback or semantic validation failed'
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(report.ok ? 0 : 1)
}

try { main() } catch (e) {
  process.stderr.write(`verify-delivery-persist failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
