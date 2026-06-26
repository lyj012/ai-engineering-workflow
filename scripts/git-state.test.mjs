// Unit tests for the canonical git-state classification (core/git-state.mjs).
// Run directly: node scripts/git-state.test.mjs
// Also imported by scripts/self-check.mjs via runGitStateTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyGitState } from '../core/git-state.mjs'

const onMain = { isRepo: true, headSymbolicRef: 'refs/heads/main', currentBranch: 'main', headSha: 'abc1234def', gitDir: '.git', gitCommonDir: '.git', dirty: false }

export const CASES = [
  ['normal repo on a branch', onMain, { isRepo: true, detachedHead: false, currentBranch: 'main', isWorktree: false, dirty: false, unbornBranch: false }],
  ['dirty tree', { ...onMain, dirty: true }, { dirty: true, currentBranch: 'main' }],
  ['detached HEAD via null symbolic-ref', { ...onMain, headSymbolicRef: null, currentBranch: 'HEAD' }, { detachedHead: true, currentBranch: null }],
  ['detached HEAD via null currentBranch', { ...onMain, headSymbolicRef: null, currentBranch: null }, { detachedHead: true, currentBranch: null }],
  ['branch derived from symbolic-ref when abbrev is HEAD-ish', { ...onMain, currentBranch: '', headSymbolicRef: 'refs/heads/feature/x' }, { detachedHead: false, currentBranch: 'feature/x' }],
  ['linked worktree (gitDir != commonDir)', { ...onMain, currentBranch: 'feat', headSymbolicRef: 'refs/heads/feat', gitDir: '/repo/.git/worktrees/wt1', gitCommonDir: '/repo/.git' }, { isWorktree: true, currentBranch: 'feat' }],
  ['windows-style worktree paths normalize to worktree', { ...onMain, gitDir: 'C:\\repo\\.git\\worktrees\\wt', gitCommonDir: 'C:\\repo\\.git' }, { isWorktree: true }],
  ['main worktree is not a linked worktree', { ...onMain, gitDir: '/repo/.git', gitCommonDir: '/repo/.git' }, { isWorktree: false }],
  ['unborn branch (no commits yet)', { ...onMain, headSha: '' }, { unbornBranch: true, currentBranch: 'main', detachedHead: false }],
  ['not a git repo', { isRepo: false }, { isRepo: false, detachedHead: false, currentBranch: null, isWorktree: false }],
]

export function runGitStateTests() {
  const failures = []
  for (const [name, raw, expected] of CASES) {
    let got
    try { got = classifyGitState(raw) } catch (e) { failures.push(`git-state "${name}": threw ${e.message}`); continue }
    for (const k of Object.keys(expected)) {
      if (JSON.stringify(got[k]) !== JSON.stringify(expected[k])) failures.push(`git-state "${name}": ${k} expected ${JSON.stringify(expected[k])}, got ${JSON.stringify(got[k])}`)
    }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runGitStateTests()
  if (failures.length) {
    console.error('GIT-STATE TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`GIT-STATE TESTS PASSED (${CASES.length} cases)`)
}
