// Unit tests for the canonical SCOPE check (core/scope-check.mjs).
// Run directly: node scripts/scope-check.test.mjs ; also imported by scripts/self-check.mjs.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkScope } from '../core/scope-check.mjs'

export const CASES = [
  ['all in scope -> ok', { changedFiles: ['app.sh', 'test.sh'], scopeFiles: ['app.sh', 'test.sh'], optionalScopeFiles: [] }, { ok: true, violations: [] }],
  ['optional scope counts', { changedFiles: ['app.sh', 'README.md'], scopeFiles: ['app.sh'], optionalScopeFiles: ['README.md'] }, { ok: true, violations: [] }],
  ['out-of-scope file -> violation', { changedFiles: ['app.sh', 'secrets.txt'], scopeFiles: ['app.sh'], optionalScopeFiles: [] }, { ok: false, violations: ['secrets.txt'] }],
  ['path normalization (./ and backslashes)', { changedFiles: ['./src\\a.js'], scopeFiles: ['src/a.js'], optionalScopeFiles: [] }, { ok: true, violations: [] }],
  ['nothing changed -> ok', { changedFiles: [], scopeFiles: ['app.sh'], optionalScopeFiles: [] }, { ok: true, violations: [] }],
  ['empty scope, a change -> violation', { changedFiles: ['x'], scopeFiles: [], optionalScopeFiles: [] }, { ok: false, violations: ['x'] }],
]

export function runScopeCheckTests() {
  const failures = []
  for (const [name, input, expected] of CASES) {
    let got
    try { got = checkScope(input) } catch (e) { failures.push(`scope-check "${name}": threw ${e.message}`); continue }
    for (const k of Object.keys(expected)) {
      if (JSON.stringify(got[k]) !== JSON.stringify(expected[k])) failures.push(`scope-check "${name}": ${k} expected ${JSON.stringify(expected[k])}, got ${JSON.stringify(got[k])}`)
    }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runScopeCheckTests()
  if (failures.length) {
    console.error('SCOPE-CHECK TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`SCOPE-CHECK TESTS PASSED (${CASES.length} cases)`)
}
