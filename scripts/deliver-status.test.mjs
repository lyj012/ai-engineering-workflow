// Unit tests for the canonical deliver final-status decision (core/deliver-status.mjs).
// Run directly: node scripts/deliver-status.test.mjs
// Also imported by scripts/self-check.mjs via runDeliverStatusTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeDeliverStatus } from '../core/deliver-status.mjs'

// A fully clean run with a delivered, apply-checked, non-empty diff (priorStatus is the 'FAILED'
// initial placeholder used by the workflow on the non-halt path — NOT a real failure).
const clean = {
  priorStatus: 'FAILED',
  implementPassed: true,
  verify: { donePassedVerified: true, scopeCleanVerified: true, redGreenVerified: true },
  reviews: [{ verdict: 'ok', blocking: false }],
  reviewIncomplete: false,
  materializeOpenLoopItems: [],
  gateOpenQuestions: [],
  gateRemainingGaps: [],
  diff: { ok: true, diffApplyCheckPassed: true, filesChanged: ['app.sh'] },
}

export const CASES = [
  ['clean run -> DELIVERED', clean, 'DELIVERED'],
  ['prior BLOCKED short-circuits', { ...clean, priorStatus: 'BLOCKED' }, 'BLOCKED'],
  ['implement not green -> BLOCKED', { ...clean, implementPassed: false }, 'BLOCKED'],
  ['no independent verify -> BLOCKED', { ...clean, verify: null }, 'BLOCKED'],
  ['verify not green -> BLOCKED', { ...clean, verify: { donePassedVerified: true, scopeCleanVerified: false } }, 'BLOCKED'],
  ['review incomplete -> BLOCKED', { ...clean, reviewIncomplete: true }, 'BLOCKED'],
  ['blocking review unresolved -> BLOCKED', { ...clean, reviews: [{ verdict: 'needs-work', blocking: true }] }, 'BLOCKED'],
  // --- #1 / #2: delivery / apply-check is the final fact ---
  ['#1 diff missing -> BLOCKED', { ...clean, diff: null }, 'BLOCKED'],
  ['#1 diff not ok -> BLOCKED', { ...clean, diff: { ok: false, diffApplyCheckPassed: false, filesChanged: [] } }, 'BLOCKED'],
  ['#2 apply-check failed -> BLOCKED', { ...clean, diff: { ok: true, diffApplyCheckPassed: false, filesChanged: ['app.sh'] } }, 'BLOCKED'],
  ['no changed files -> BLOCKED', { ...clean, diff: { ok: true, diffApplyCheckPassed: true, filesChanged: [] } }, 'BLOCKED'],
  ['#1 delivery persist failed -> BLOCKED', { ...clean, deliveryPersisted: false }, 'BLOCKED'],
  ['delivery persisted ok -> DELIVERED', { ...clean, deliveryPersisted: true }, 'DELIVERED'],
  // --- open-item downgrades (still delivered, but not clean) ---
  ['materialize open loop item -> WITH_OPEN_ITEMS', { ...clean, materializeOpenLoopItems: ['no pwsh .ps1'] }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['non-blocking needs-work -> WITH_OPEN_ITEMS', { ...clean, reviews: [{ verdict: 'needs-work', blocking: false }] }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['redGreen unconfirmed -> WITH_OPEN_ITEMS', { ...clean, verify: { donePassedVerified: true, scopeCleanVerified: true, redGreenVerified: false } }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['gate open question -> WITH_OPEN_ITEMS', { ...clean, gateOpenQuestions: ['confirm field shape'] }, 'DELIVERED_WITH_OPEN_ITEMS'],
  // --- P1.4: these open-item sources must also downgrade (they go into manifest.openItems, so DELIVERED
  // with a non-empty openItems list would be self-contradictory; route them all through hasOpenItems) ---
  ['tests tampered (testsIntact=false) -> WITH_OPEN_ITEMS', { ...clean, verify: { ...clean.verify, testsIntact: false } }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['testsIntact true -> DELIVERED', { ...clean, verify: { ...clean.verify, testsIntact: true } }, 'DELIVERED'],
  ['soft-stale plan -> WITH_OPEN_ITEMS', { ...clean, staleSeverity: 'soft' }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['stale severity none -> DELIVERED', { ...clean, staleSeverity: 'none' }, 'DELIVERED'],
  ['filesReconcile issue -> WITH_OPEN_ITEMS', { ...clean, filesReconcileIssues: ['Diff 超出 SCOPE: x.js'] }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['empty filesReconcile -> DELIVERED', { ...clean, filesReconcileIssues: [] }, 'DELIVERED'],
  // --- real-browser verification (web projects only): four states ---
  ['browser passed (web) -> DELIVERED', { ...clean, browser: { applicable: true, status: 'passed', openItems: [] } }, 'DELIVERED'],
  ['browser failed (web) -> BLOCKED', { ...clean, browser: { applicable: true, status: 'failed', openItems: [] } }, 'BLOCKED'],
  ['browser skipped no-capability -> WITH_OPEN_ITEMS', { ...clean, browser: { applicable: true, status: 'skipped', openItems: ['web project but no browser capability'] } }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['browser error (web) -> WITH_OPEN_ITEMS', { ...clean, browser: { applicable: true, status: 'error', openItems: [] } }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['browser not-applicable (non-web) -> DELIVERED', { ...clean, browser: { applicable: false, status: null, openItems: [] } }, 'DELIVERED'],
  ['no browser field -> DELIVERED (backward compatible)', { ...clean }, 'DELIVERED'],
  // --- code quality (S3): compile fail BLOCKS (P0); non-compile static items downgrade; no-tools/clean = no effect ---
  ['codeQuality compile failed -> BLOCKED', { ...clean, codeQuality: { applicable: true, compileRan: true, compilePassed: false, openItems: [] } }, 'BLOCKED'],
  ['codeQuality P0 static failure -> BLOCKED', { ...clean, codeQuality: { applicable: true, compileRan: true, compilePassed: true, hasP0Failure: true, openItems: ['critical security finding'] } }, 'BLOCKED'],
  ['codeQuality compile passed clean -> DELIVERED', { ...clean, codeQuality: { applicable: true, compileRan: true, compilePassed: true, openItems: [] } }, 'DELIVERED'],
  ['codeQuality static failures -> WITH_OPEN_ITEMS', { ...clean, codeQuality: { applicable: true, compileRan: false, compilePassed: false, openItems: ['checkstyle 3 violations'] } }, 'DELIVERED_WITH_OPEN_ITEMS'],
  ['codeQuality not-applicable (no tools) -> DELIVERED', { ...clean, codeQuality: { applicable: false, compileRan: false, compilePassed: false, openItems: [] } }, 'DELIVERED'],
  ['codeQuality compile not-run no-items -> DELIVERED', { ...clean, codeQuality: { applicable: true, compileRan: false, compilePassed: false, openItems: [] } }, 'DELIVERED'],
  ['no codeQuality field -> DELIVERED (backward compatible)', { ...clean }, 'DELIVERED'],
]

export function runDeliverStatusTests() {
  const failures = []
  for (const [name, input, expected] of CASES) {
    let got
    try { got = computeDeliverStatus(input).finalStatus } catch (e) { got = `threw: ${e.message}` }
    if (got !== expected) failures.push(`deliver-status "${name}": expected ${expected}, got ${got}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runDeliverStatusTests()
  if (failures.length) {
    console.error('DELIVER-STATUS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`DELIVER-STATUS TESTS PASSED (${CASES.length} cases)`)
}
