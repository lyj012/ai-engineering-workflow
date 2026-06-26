// Unit tests for the canonical branch-commit-strategy resolution (core/branch-choice.mjs).
// Run directly: node scripts/branch-choice.test.mjs
// Also imported by scripts/self-check.mjs via runBranchChoiceTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBranchChoice } from '../core/branch-choice.mjs'

const base = { requestedMode: '', targetBranch: null, detachedHead: false, targetBranchExists: null }

export const CASES = [
  ['no choice -> needs choice', base, { choiceProvided: false, needsChoice: true, resolvedMode: null }],
  ['unknown mode -> needs choice', { ...base, requestedMode: 'whatever' }, { choiceProvided: false, needsChoice: true }],
  ['new-branch chosen', { ...base, requestedMode: 'new-branch' }, { choiceProvided: true, needsChoice: false, resolvedMode: 'new-branch' }],
  ['current-branch chosen on a branch', { ...base, requestedMode: 'current-branch' }, { choiceProvided: true, resolvedMode: 'current-branch' }],
  ['legacy "direct" maps to current-branch', { ...base, requestedMode: 'direct' }, { choiceProvided: true, resolvedMode: 'current-branch' }],
  ['current-branch INVALID on detached HEAD', { ...base, requestedMode: 'current-branch', detachedHead: true }, { choiceProvided: false, needsChoice: true, blocked: true }],
  ['switch-existing without targetBranch -> not provided', { ...base, requestedMode: 'switch-existing' }, { choiceProvided: false, blocked: true }],
  ['switch-existing with non-existent targetBranch -> not provided', { ...base, requestedMode: 'switch-existing', targetBranch: 'dev', targetBranchExists: false }, { choiceProvided: false, blocked: true }],
  ['switch-existing with existing targetBranch -> provided', { ...base, requestedMode: 'switch-existing', targetBranch: 'dev', targetBranchExists: true }, { choiceProvided: true, resolvedMode: 'switch-existing' }],
  // availability surface (req: never present an invalid option)
  ['available options on a normal branch', base, { availableModes: ['new-branch', 'current-branch'] }],
  ['available options on detached HEAD (no current-branch)', { ...base, detachedHead: true }, { availableModes: ['new-branch'] }],
  ['available options include switch-existing when target exists', { ...base, targetBranch: 'dev', targetBranchExists: true }, { availableModes: ['new-branch', 'switch-existing', 'current-branch'] }],
]

export function runBranchChoiceTests() {
  const failures = []
  for (const [name, input, expected] of CASES) {
    let got
    try { got = resolveBranchChoice(input) } catch (e) { failures.push(`branch-choice "${name}": threw ${e.message}`); continue }
    for (const k of Object.keys(expected)) {
      let actual
      if (k === 'blocked') actual = got.blockedReason != null
      else if (k === 'availableModes') actual = got.availableOptions.filter((o) => o.available).map((o) => o.mode)
      else actual = got[k]
      if (JSON.stringify(actual) !== JSON.stringify(expected[k])) failures.push(`branch-choice "${name}": ${k} expected ${JSON.stringify(expected[k])}, got ${JSON.stringify(actual)}`)
    }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runBranchChoiceTests()
  if (failures.length) {
    console.error('BRANCH-CHOICE TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`BRANCH-CHOICE TESTS PASSED (${CASES.length} cases)`)
}
