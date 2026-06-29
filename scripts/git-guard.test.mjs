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
  // --- P1.7: global options between `git` and the subcommand must not bypass the red line ---
  'git -c http.sslVerify=false push --force origin main',
  'git -C /repo push --force origin main',
  'git --git-dir=.git push --force origin main',
  'git -c x=y -C /repo push --delete origin feature',
  'git -C /repo reset --hard origin/main',
  // --- P1.7: quoted refspecs must not bypass force/delete detection ---
  'git push origin "+main"',
  'git push "origin" ":feature"',
  "git push origin '+refs/heads/main'",
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
  'git -C /repo push origin main',           // global option + normal (non-force) push must still be allowed
  'git -c user.name=x commit -m "force push later"',  // global option + non-push, message word must not trigger
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
