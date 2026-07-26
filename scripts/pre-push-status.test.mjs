import { computePrePushStatus } from '../core/pre-push-status.mjs'

const clean = {
  gitState: { isRepo: true, detachedHead: false, currentBranch: 'feature/a', dirty: true },
  changedFiles: ['src/app.js', 'test/app.test.js'],
  taskFiles: ['src/app.js', 'test/app.test.js'],
  verificationCommands: ['npm test'],
  verificationPassed: true,
  remote: { name: 'origin', url: 'https://github.com/acme/repo.git' },
  branchChoice: { resolvedMode: 'current-branch' },
  publishIntent: true,
}

export const CASES = [
  ['clean pre-push is ready', clean, 'PREPUSH_READY'],
  ['detached head blocks', { ...clean, gitState: { ...clean.gitState, detachedHead: true } }, 'PREPUSH_BLOCKED'],
  ['unsafe env file blocks', { ...clean, taskFiles: ['src/app.js', '.env'] }, 'PREPUSH_BLOCKED'],
  ['unrelated without task isolation blocks', { ...clean, taskFiles: [], unrelatedFiles: ['scratch.js'] }, 'PREPUSH_BLOCKED'],
  ['failed verification blocks', { ...clean, verificationPassed: false }, 'PREPUSH_BLOCKED'],
  ['protected branch blocks without opt-in', { ...clean, targetBranch: 'main' }, 'PREPUSH_BLOCKED'],
  ['protected branch allowed with opt-in', { ...clean, targetBranch: 'main', allowProtectedBranchPublish: true }, 'PREPUSH_READY'],
  ['credentialed remote blocks', { ...clean, remote: { name: 'origin', url: 'https://TOKEN@github.com/acme/repo.git' } }, 'PREPUSH_BLOCKED'],
  ['verification command without success blocks', { ...clean, verificationPassed: undefined }, 'PREPUSH_BLOCKED'],
  ['remote name without URL blocks publish', { ...clean, remote: { name: 'origin', url: '' } }, 'PREPUSH_BLOCKED'],
  ['remote read failure blocks publish', { ...clean, remote: { name: 'origin', url: '', readOk: false } }, 'PREPUSH_BLOCKED'],
  ['invalid remote URL blocks publish', { ...clean, remote: { name: 'origin', url: 'not a url' } }, 'PREPUSH_BLOCKED'],
  ['branch strategy not required without publish intent', { ...clean, publishIntent: false, branchChoice: {} }, 'PREPUSH_READY'],
  ['branch strategy required with publish intent', { ...clean, branchChoice: {} }, 'PREPUSH_BLOCKED'],
  ['remote not required for snapshot-only pre-push status', { ...clean, publishIntent: false, remote: { name: 'origin', url: '', readOk: false } }, 'PREPUSH_READY'],
  ['partial task-file mismatch blocks unsafe env change', { ...clean, changedFiles: ['src/app.js', '.env'], taskFiles: ['src/app.js', '.env'] }, 'PREPUSH_BLOCKED'],
  ['task file not in changed files blocks', { ...clean, changedFiles: ['src/app.js'], taskFiles: ['src/app.js', 'test/app.test.js'] }, 'PREPUSH_BLOCKED'],
]

export function runPrePushStatusTests() {
  const failures = []
  for (const [name, input, expected] of CASES) {
    const result = computePrePushStatus(input)
    if (result.finalStatus !== expected) failures.push(`pre-push-status ${name}: expected ${expected}, got ${result.finalStatus} (${result.reasons.join('; ')})`)
    if (result.remote?.hasCredentials && result.remote?.maskedUrl?.includes('TOKEN')) failures.push(`pre-push-status ${name}: leaked remote credential`)
  }
  const ready = computePrePushStatus(clean)
  if (!ready.note.includes('does not mean PUBLISHED')) failures.push('PREPUSH_READY note must not imply PUBLISHED')
  const scoped = computePrePushStatus({ ...clean, changedFiles: ['src/app.js', 'scratch.js'], taskFiles: ['src/app.js'] })
  if (scoped.finalStatus !== 'PREPUSH_READY' || scoped.taskFiles.length !== 1 || scoped.taskFiles[0] !== 'src/app.js') failures.push('scoped task files should allow unrelated unselected changed files')
  return failures
}

if (process.argv[1] && process.argv[1].endsWith('pre-push-status.test.mjs')) {
  const failures = runPrePushStatusTests()
  if (failures.length) {
    console.error('PRE-PUSH-STATUS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('PRE-PUSH-STATUS TESTS PASSED')
}
