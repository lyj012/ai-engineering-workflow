// Unit tests for canonical stale-plan detection (core/repo-fingerprint.mjs).
// Run directly: node scripts/repo-fingerprint.test.mjs
// Also imported by scripts/self-check.mjs via runRepoFingerprintTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareRepoFingerprint } from '../core/repo-fingerprint.mjs'

const fp = (over = {}) => ({ commit: 'aaa', treeHash: 't1', dirty: false, dirtyDiffHash: '', ...over })

export const CASES = [
  ['identical -> none', fp(), fp(), { severity: 'none', stale: false }],
  ['commit changed -> hard', fp(), fp({ commit: 'bbb' }), { severity: 'hard', stale: true }],
  ['same commit, dirty diff differs -> soft', fp(), fp({ dirty: true, dirtyDiffHash: 'deadbeef' }), { severity: 'soft', stale: true }],
  ['non-git treeHash changed -> hard', fp({ commit: '', treeHash: 'x' }), fp({ commit: '', treeHash: 'y' }), { severity: 'hard', stale: true }],
  ['non-git treeHash same -> none', fp({ commit: '', treeHash: 'x' }), fp({ commit: '', treeHash: 'x' }), { severity: 'none', stale: false }],
  ['no comparable identity -> unknown', fp({ commit: '', treeHash: '' }), fp({ commit: '', treeHash: '' }), { severity: 'unknown', stale: false }],
  ['plan fingerprint missing -> unknown', null, fp(), { severity: 'unknown', stale: false }],
  ['current fingerprint missing -> unknown', fp(), null, { severity: 'unknown', stale: false }],
  ['commit takes precedence over dirty -> hard', fp({ dirty: true, dirtyDiffHash: 'z' }), fp({ commit: 'bbb' }), { severity: 'hard', stale: true }],
]

export function runRepoFingerprintTests() {
  const failures = []
  for (const [name, planFp, currentFp, exp] of CASES) {
    const got = compareRepoFingerprint(planFp, currentFp)
    if (got.severity !== exp.severity || got.stale !== exp.stale) {
      failures.push(`repo-fingerprint "${name}": expected severity=${exp.severity}/stale=${exp.stale}, got severity=${got.severity}/stale=${got.stale}`)
    }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runRepoFingerprintTests()
  if (failures.length) {
    console.error('REPO-FINGERPRINT TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`REPO-FINGERPRINT TESTS PASSED (${CASES.length} cases)`)
}
