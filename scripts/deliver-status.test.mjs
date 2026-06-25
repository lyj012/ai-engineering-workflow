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
