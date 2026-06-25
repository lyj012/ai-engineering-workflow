// Unit tests for the canonical plan readiness mapping (core/readiness.mjs).
// Run directly: node scripts/readiness.test.mjs
// Also imported by scripts/self-check.mjs via runReadinessTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeReadiness, isValidStatusReadinessCombo } from '../core/readiness.mjs'

export const CASES = [
  ['PASS', 'ready'],
  ['PARTIAL', 'ready'],
  ['NEEDS_CLARIFICATION', 'needs-clarification'],
  ['CONDITIONAL', 'blocked'],
  ['FAILED_WITH_FINDINGS', 'blocked'],
  ['FAILED', 'blocked'],
  ['BLOCKED', 'blocked'],
  ['something-unexpected', 'blocked'],
]

// Combinations that must never be accepted as valid.
const ILLEGAL = [
  ['FAILED_WITH_FINDINGS', 'ready'],
  ['FAILED', 'ready'],
  ['CONDITIONAL', 'ready'],
  ['NEEDS_CLARIFICATION', 'ready'],
]

export function runReadinessTests() {
  const failures = []
  for (const [status, expected] of CASES) {
    const got = computeReadiness(status)
    if (got !== expected) failures.push(`readiness "${status}": expected ${expected}, got ${got}`)
  }
  for (const [status, readiness] of ILLEGAL) {
    if (isValidStatusReadinessCombo(status, readiness)) failures.push(`illegal status/readiness combo accepted: ${status} + ${readiness}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runReadinessTests()
  if (failures.length) {
    console.error('READINESS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`READINESS TESTS PASSED (${CASES.length} cases + ${ILLEGAL.length} illegal-combo guards)`)
}
