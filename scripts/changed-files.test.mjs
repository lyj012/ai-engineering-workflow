// Unit tests for canonical changed-files reconciliation (core/changed-files.mjs).
// Run directly: node scripts/changed-files.test.mjs
// Also imported by scripts/self-check.mjs via runChangedFilesTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileChangedFiles } from '../core/changed-files.mjs'

export const CASES = [
  ['consistent: verify==diff, all in scope',
    { verifiedFiles: ['a.sh'], diffFiles: ['a.sh'], scopeFiles: ['a.sh'], optionalScopeFiles: [] }, true],
  ['verify != diff -> issue',
    { verifiedFiles: ['a.sh'], diffFiles: ['a.sh', 'b.sh'], scopeFiles: ['a.sh', 'b.sh'], optionalScopeFiles: [] }, false],
  ['diff out of scope -> issue',
    { verifiedFiles: ['a.sh', 'x.sh'], diffFiles: ['a.sh', 'x.sh'], scopeFiles: ['a.sh'], optionalScopeFiles: [] }, false],
  ['empty verify skips verify-vs-diff check',
    { verifiedFiles: [], diffFiles: ['a.sh'], scopeFiles: ['a.sh'], optionalScopeFiles: [] }, true],
  ['optional scope counts as in-scope',
    { verifiedFiles: ['a.sh', 'o.sh'], diffFiles: ['a.sh', 'o.sh'], scopeFiles: ['a.sh'], optionalScopeFiles: ['o.sh'] }, true],
  ['no scope info skips scope check',
    { verifiedFiles: ['a.sh'], diffFiles: ['a.sh'], scopeFiles: [], optionalScopeFiles: [] }, true],
]

export function runChangedFilesTests() {
  const failures = []
  for (const [name, input, expectedConsistent] of CASES) {
    const got = reconcileChangedFiles(input).consistent
    if (got !== expectedConsistent) failures.push(`changed-files "${name}": expected consistent=${expectedConsistent}, got ${got}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runChangedFilesTests()
  if (failures.length) {
    console.error('CHANGED-FILES TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`CHANGED-FILES TESTS PASSED (${CASES.length} cases)`)
}
