// Unit tests for the git red-line classifier (core/git-guard.mjs).
// Run directly: node scripts/git-guard.test.mjs
// Also imported by scripts/self-check.mjs via runGitGuardTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyGitCommand } from '../core/git-guard.mjs'

// [command, shouldBlock]
const BLOCK = [
  'git push --force origin main',
  'git push origin main --force',
  'git push -f origin main',
  'git push --force-with-lease origin feature',
  'git push origin +main',
  'git push origin :feature',
  'git push --delete origin feature',
  'git push -d origin feature',
  'git push --mirror origin',
  'git reset --hard origin/main',
  'git reset --hard upstream/dev',
  'git filter-repo --path secret --invert-paths',     // history rewrite
  'git filter-branch --tree-filter rm HEAD',          // history rewrite
  'git branch -D feature',                            // force-delete a branch
  'git checkout x && git push --force origin main',   // forbidden part in a compound command
]
const ALLOW = [
  'git push origin main',
  'git push -u origin feature',
  'git push origin HEAD:refs/heads/main',   // normal src:dst refspec, not a delete
  'git push origin feature',
  'git reset --hard HEAD',                  // local reset, not remote
  'git reset --hard HEAD~1',
  'git commit -m "force the push through review"',
  'git log --oneline -5',
  'git fetch origin',
  'git status',
  'git push origin main && rm -f /tmp/x',    // unrelated -f after && must not false-positive
  'git push origin main && grep -f pats file',  // unrelated -f after && must not false-positive
  'git branch -d merged',                    // safe delete of a merged branch
  '',
]

export function runGitGuardTests() {
  const failures = []
  for (const cmd of BLOCK) {
    const r = classifyGitCommand(cmd)
    if (!r.blocked) failures.push(`git-guard should BLOCK but allowed: ${cmd}`)
  }
  for (const cmd of ALLOW) {
    const r = classifyGitCommand(cmd)
    if (r.blocked) failures.push(`git-guard should ALLOW but blocked (${r.rule}): ${cmd}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runGitGuardTests()
  if (failures.length) {
    console.error('GIT-GUARD TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`GIT-GUARD TESTS PASSED (${BLOCK.length} block + ${ALLOW.length} allow cases)`)
}
