// Unit tests for the canonical persist-verification outcome (core/persist-outcome.mjs).
// Run directly: node scripts/persist-outcome.test.mjs
// Also imported by scripts/self-check.mjs via runPersistOutcomeTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computePersistOutcome } from '../core/persist-outcome.mjs'

const expected = ['run-manifest.json', 'plan.json', 'final-plan.md']

export const CASES = [
  ['all present + parseable -> ok, PASS kept',
    { expectedFiles: expected, existing: expected, unparseable: [], finalStatus: 'PASS' }, { ok: true, finalStatus: 'PASS' }],
  ['missing file downgrades PASS -> FAILED',
    { expectedFiles: expected, existing: ['run-manifest.json', 'plan.json'], unparseable: [], finalStatus: 'PASS' }, { ok: false, finalStatus: 'FAILED' }],
  ['unparseable json downgrades PARTIAL -> FAILED',
    { expectedFiles: expected, existing: expected, unparseable: ['plan.json'], finalStatus: 'PARTIAL' }, { ok: false, finalStatus: 'FAILED' }],
  ['schema-invalid downgrades PASS -> FAILED',
    { expectedFiles: expected, existing: expected, unparseable: [], schemaInvalid: ['plan.json'], finalStatus: 'PASS' }, { ok: false, finalStatus: 'FAILED' }],
  ['already FAILED stays FAILED',
    { expectedFiles: expected, existing: [], unparseable: [], finalStatus: 'FAILED' }, { ok: false, finalStatus: 'FAILED' }],
  ['NEEDS_CLARIFICATION not touched when persist ok',
    { expectedFiles: expected, existing: expected, unparseable: [], finalStatus: 'NEEDS_CLARIFICATION' }, { ok: true, finalStatus: 'NEEDS_CLARIFICATION' }],
  ['CONDITIONAL not upgraded, stays CONDITIONAL when persist ok',
    { expectedFiles: expected, existing: expected, unparseable: [], finalStatus: 'CONDITIONAL' }, { ok: true, finalStatus: 'CONDITIONAL' }],
  ['abs-path existing normalized by basename',
    { expectedFiles: expected, existing: ['/run/abc/run-manifest.json', '/run/abc/plan.json', '/run/abc/final-plan.md'], unparseable: [], finalStatus: 'PASS' }, { ok: true, finalStatus: 'PASS' }],
]

export function runPersistOutcomeTests() {
  const failures = []
  for (const [name, input, exp] of CASES) {
    const got = computePersistOutcome(input)
    if (got.ok !== exp.ok || got.finalStatus !== exp.finalStatus) {
      failures.push(`persist-outcome "${name}": expected ok=${exp.ok}/status=${exp.finalStatus}, got ok=${got.ok}/status=${got.finalStatus}`)
    }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runPersistOutcomeTests()
  if (failures.length) {
    console.error('PERSIST-OUTCOME TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`PERSIST-OUTCOME TESTS PASSED (${CASES.length} cases)`)
}
