// Integration test for bin/verify-delivery-persist.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'verify-delivery-persist.mjs')

function run(args) {
  return spawnSync('node', [script, ...args], { encoding: 'utf8' })
}

export function runVerifyDeliveryPersistTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-persist-'))
    const manifestPath = path.join(work, 'delivery-manifest.json')
    const multiAgent = {
      required: true,
      requiredStages: ['analysis', 'implementation', 'review', 'verification'],
      preflightPassed: true,
      executed: true,
      fallbackUsed: false,
      parentAgentImplemented: false,
      roles: [
        { stage: 'analysis', role: 'repo', codexAgent: 'aiew_repo_analyst', spawned: true, completed: true, resultValidated: true, threadId: 'a' },
        { stage: 'implementation', role: 'impl', codexAgent: 'aiew_implementer', spawned: true, completed: true, resultValidated: true, threadId: 'i' },
        { stage: 'review', role: 'review', codexAgent: 'aiew_independent_reviewer', spawned: true, completed: true, resultValidated: true, threadId: 'r' },
        { stage: 'verification', role: 'verify', codexAgent: 'aiew_delivery_verifier', spawned: true, completed: true, resultValidated: true, threadId: 'v' },
      ],
    }
    const statusInput = {
      priorStatus: 'FAILED',
      multiAgent,
      implementPassed: true,
      verify: { donePassedVerified: true, scopeCleanVerified: true, redGreenVerified: true, testsIntact: true },
      reviews: [{ verdict: 'ok', blocking: false }],
      reviewIncomplete: false,
      materializeOpenLoopItems: [],
      gateOpenQuestions: [],
      gateRemainingGaps: [],
      staleSeverity: null,
      scopeViolations: [],
      filesReconcileIssues: [],
      diff: { ok: true, diffApplyCheckPassed: true, filesChanged: ['app.sh'] },
      browser: null,
      codeQuality: null,
      deliveryPersisted: false,
    }
    const manifest = {
      schemaVersion: '1.0',
      workflow: 'deliver-from-plan',
      finalStatus: 'DELIVERED',
      gate: { finalStatus: 'PASS', readinessForDev: 'ready' },
      scope: { scopeFiles: ['app.sh'] },
      implementPassed: true,
      filesChanged: ['app.sh'],
      scopeViolations: [],
      filesReconcileIssues: [],
      reviewVerdicts: [{ lens: 'correctness', verdict: 'ok', blocking: false }],
      reviewComplete: true,
      independentVerify: { donePassedVerified: true, scopeCleanVerified: true, redGreenVerified: true, testsIntact: true },
      multiAgent,
      diffApplyCheckPassed: true,
      deliveryPersisted: false,
      statusInput,
      persistVerification: { ok: false },
      openItems: [],
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    const ok = run([
      '--dir', work,
      '--final-status', 'DELIVERED',
      '--files-changed-json', JSON.stringify(['app.sh']),
      '--diff-apply-check-passed', 'true',
      '--mark-ok',
    ])
    if (ok.status !== 0) { failures.push(`verify-delivery-persist exited ${ok.status}: ${ok.stderr || ok.stdout}`); return failures }
    const report = JSON.parse(ok.stdout)
    if (report.ok !== true || report.persistOkOnDisk !== true || report.deliveryPersistedOnDisk !== true) failures.push('persist verification did not report ok=true and deliveryPersisted=true on disk')
    const marked = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (!marked.persistVerification || marked.persistVerification.ok !== true) failures.push('persistVerification.ok was not atomically written to disk')
    if (marked.deliveryPersisted !== true) failures.push('deliveryPersisted=true was not atomically written to disk')
    if (!marked.statusInput || marked.statusInput.deliveryPersisted !== true) failures.push('statusInput.deliveryPersisted=true was not atomically written to disk')

    const tampered = { ...marked, independentVerify: { ...marked.independentVerify, testsIntact: false }, deliveryPersisted: false, persistVerification: { ok: false } }
    tampered.statusInput = { ...marked.statusInput, deliveryPersisted: false }
    fs.writeFileSync(manifestPath, JSON.stringify(tampered, null, 2), 'utf8')
    const badSemantic = run([
      '--dir', work,
      '--final-status', 'DELIVERED',
      '--files-changed-json', JSON.stringify(['app.sh']),
      '--diff-apply-check-passed', 'true',
      '--mark-ok',
    ])
    if (badSemantic.status === 0) failures.push('persist verification accepted manifest with independentVerify/statusInput drift')
    else {
      const badReport = JSON.parse(badSemantic.stdout)
      if (badReport.semanticOk !== false) failures.push('tampered manifest should report semanticOk=false')
    }

    const mismatch = run([
      '--dir', work,
      '--final-status', 'BLOCKED',
      '--files-changed-json', JSON.stringify(['app.sh']),
      '--diff-apply-check-passed', 'true',
    ])
    if (mismatch.status === 0) failures.push('persist verification accepted mismatched finalStatus')
    else {
      const mismatchReport = JSON.parse(mismatch.stdout)
      if (mismatchReport.contentConsistent !== false) failures.push('mismatch report should set contentConsistent=false')
    }

    const missingDir = path.join(work, 'missing')
    fs.mkdirSync(missingDir)
    const missing = run([
      '--dir', missingDir,
      '--final-status', 'DELIVERED',
      '--files-changed-json', '[]',
      '--diff-apply-check-passed', 'true',
    ])
    if (missing.status === 0) failures.push('persist verification accepted missing manifest')
  } catch (e) {
    failures.push(`verify-delivery-persist test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runVerifyDeliveryPersistTests()
  if (failures.length) {
    console.error('VERIFY-DELIVERY-PERSIST TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('VERIFY-DELIVERY-PERSIST TESTS PASSED')
}
