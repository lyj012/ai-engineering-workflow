// Unit tests for core/verify-remote-publish.mjs — the script-side recompute of the publish hard gates.
// Proves a "lying agent" (booleans say all-good) is caught by deterministic recompute from raw materials.
// Pure data only; no git, no remote, no credentials. Run: node scripts/verify-remote-publish.test.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRemotePublish, findForbiddenFiles } from '../core/verify-remote-publish.mjs'

// shared fixed vectors — also imported by self-check for the inline↔core parity diff
export const CASES = [
  // [name, input, expected partial { branchShaMatches, committedFilesMatch, noForbiddenFiles, workTreeClean }]
  ['all good', { commitSha: 'aaaa', remoteSha: 'aaaa', manifestFilesChanged: ['src/a.js'], remoteFiles: ['src/a.js'], committedFiles: ['src/a.js'], workTreeStatus: '' },
    { branchShaMatches: true, committedFilesMatch: true, noForbiddenFiles: true, workTreeClean: true }],
  ['sha mismatch', { commitSha: 'bbbb', remoteSha: 'aaaa', manifestFilesChanged: ['src/a.js'], remoteFiles: ['src/a.js'], committedFiles: ['src/a.js'], workTreeStatus: '' },
    { branchShaMatches: false, committedFilesMatch: true, noForbiddenFiles: true, workTreeClean: true }],
  ['file set mismatch (extra remote file)', { commitSha: 'aaaa', remoteSha: 'aaaa', manifestFilesChanged: ['src/a.js'], remoteFiles: ['src/a.js', 'src/b.js'], committedFiles: ['src/a.js', 'src/b.js'], workTreeStatus: '' },
    { branchShaMatches: true, committedFilesMatch: false, noForbiddenFiles: true, workTreeClean: true }],
  ['forbidden .env committed', { commitSha: 'aaaa', remoteSha: 'aaaa', manifestFilesChanged: ['src/a.js', '.env'], remoteFiles: ['src/a.js', '.env'], committedFiles: ['src/a.js', '.env'], workTreeStatus: '' },
    { branchShaMatches: true, committedFilesMatch: true, noForbiddenFiles: false, workTreeClean: true }],
  ['forbidden key in subdir', { commitSha: 'aaaa', remoteSha: 'aaaa', manifestFilesChanged: ['deploy/id_rsa'], remoteFiles: ['deploy/id_rsa'], committedFiles: ['deploy/id_rsa'], workTreeStatus: '' },
    { branchShaMatches: true, committedFilesMatch: true, noForbiddenFiles: false, workTreeClean: true }],
  ['dirty work tree (porcelain non-empty)', { commitSha: 'aaaa', remoteSha: 'aaaa', manifestFilesChanged: ['src/a.js'], remoteFiles: ['src/a.js'], committedFiles: ['src/a.js'], workTreeStatus: ' M src/a.js' },
    { branchShaMatches: true, committedFilesMatch: true, noForbiddenFiles: true, workTreeClean: false }],
]

export function runVerifyRemotePublishTests() {
  const failures = []
  try {
    for (const [name, input, exp] of CASES) {
      const r = verifyRemotePublish(input)
      for (const k of Object.keys(exp)) {
        if (r[k] !== exp[k]) failures.push(`verifyRemotePublish "${name}".${k}: got ${r[k]} want ${exp[k]}`)
      }
    }
    // the "lying agent" scenario: agent claims all-true, but raw says sha mismatch + a forbidden file present
    const lying = verifyRemotePublish({ commitSha: 'bbbb2222', remoteSha: 'aaaa1111', manifestFilesChanged: ['src/a.js'], remoteFiles: ['src/a.js', '.env'], committedFiles: ['src/a.js', '.env'], workTreeStatus: '' })
    if (lying.branchShaMatches !== false) failures.push('lying agent: sha mismatch not caught by recompute')
    if (lying.committedFilesMatch !== false) failures.push('lying agent: file-set mismatch not caught (.env extra)')
    if (lying.noForbiddenFiles !== false) failures.push('lying agent: forbidden .env not caught by recompute')
    if (!lying.forbiddenFound.includes('.env')) failures.push('lying agent: forbiddenFound should list .env')
    // findForbiddenFiles
    if (findForbiddenFiles(['a.js', 'config/app.pem', 'README.md']).join() !== 'config/app.pem') failures.push('findForbiddenFiles missed .pem')
    if (findForbiddenFiles(['src/main.js']).length !== 0) failures.push('findForbiddenFiles false positive on clean files')
  } catch (e) {
    failures.push(`verify-remote-publish test threw: ${e.message}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runVerifyRemotePublishTests()
  if (failures.length) {
    console.error('VERIFY-REMOTE-PUBLISH TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`VERIFY-REMOTE-PUBLISH TESTS PASSED (${CASES.length} cases)`)
}
