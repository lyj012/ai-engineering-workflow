// Integration test for bin/diff-from-sandbox.mjs: generate an applyable, path-portable patch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'diff-from-sandbox.mjs')

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8' })
}

export function runDiffFromSandboxTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'diffsb-'))
    const base = path.join(work, 'base')
    const sandbox = path.join(work, 'sandbox')
    const out = path.join(work, 'changes.diff')
    fs.mkdirSync(path.join(base, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(base, 'app.sh'), '#!/usr/bin/env bash\necho old\n')
    fs.writeFileSync(path.join(base, 'delete.txt'), 'remove me\n')
    fs.writeFileSync(path.join(base, 'nested', 'keep.txt'), 'keep\n')
    fs.cpSync(base, sandbox, { recursive: true })
    fs.writeFileSync(path.join(sandbox, 'app.sh'), '#!/usr/bin/env bash\necho new\n')
    fs.writeFileSync(path.join(sandbox, 'added.txt'), 'new file\n')
    fs.writeFileSync(path.join(sandbox, 'bin.dat'), Buffer.from([0, 1, 2, 3, 255]))
    fs.rmSync(path.join(sandbox, 'delete.txt'))

    const r = run('node', [script, '--base', base, '--sandbox', sandbox, '--out', out])
    if (r.status !== 0) { failures.push(`diff-from-sandbox exited ${r.status}: ${r.stderr || r.stdout}`); return failures }
    const report = JSON.parse(r.stdout)
    if (report.diffApplyCheckPassed !== true) failures.push('diff report did not record diffApplyCheckPassed=true')
    if (report.applyCheckExitCode !== 0) failures.push(`diff report applyCheckExitCode expected 0, got ${report.applyCheckExitCode}`)
    if (report.ok !== true) failures.push('diff report ok should be true for applyable non-empty diff')
    for (const expected of ['app.sh', 'added.txt', 'bin.dat', 'delete.txt']) {
      if (!report.filesChanged.includes(expected)) failures.push(`diff report missing ${expected}`)
    }
    const diff = fs.readFileSync(out, 'utf8')
    if (diff.includes(base) || diff.includes(sandbox) || /[A-Za-z]:[\\/]/.test(diff)) failures.push('diff contains local absolute path')
    if (!diff.includes('diff --git a/app.sh b/app.sh')) failures.push('diff missing standard a/b app.sh header')

    const applyCopy = path.join(work, 'apply-copy')
    fs.cpSync(base, applyCopy, { recursive: true })
    const check = run('git', ['apply', '--check', out], applyCopy)
    if (check.status !== 0) failures.push(`git apply --check failed: ${check.stderr || check.stdout}`)
    const apply = run('git', ['apply', out], applyCopy)
    if (apply.status !== 0) failures.push(`git apply failed: ${apply.stderr || apply.stdout}`)
    if (!fs.existsSync(path.join(applyCopy, 'added.txt'))) failures.push('added file was not applied')
    if (fs.existsSync(path.join(applyCopy, 'delete.txt'))) failures.push('deleted file still exists after apply')
    if (!fs.existsSync(path.join(applyCopy, 'bin.dat'))) failures.push('binary file was not applied')

    const emptyOut = path.join(work, 'empty.diff')
    const emptySandbox = path.join(work, 'empty-sandbox')
    fs.cpSync(base, emptySandbox, { recursive: true })
    const empty = run('node', [script, '--base', base, '--sandbox', emptySandbox, '--out', emptyOut])
    if (empty.status === 0) failures.push('diff-from-sandbox should exit non-zero for empty diff')
    else {
      const emptyReport = JSON.parse(empty.stdout)
      if (emptyReport.ok !== false) failures.push('empty diff report ok should be false')
      if (emptyReport.diffApplyCheckPassed !== false) failures.push('empty diff should not record apply-check success')
      if (emptyReport.filesChanged.length !== 0) failures.push('empty diff filesChanged should be empty')
    }
  } catch (e) {
    failures.push(`diff-from-sandbox test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runDiffFromSandboxTests()
  if (failures.length) {
    console.error('DIFF-FROM-SANDBOX TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('DIFF-FROM-SANDBOX TESTS PASSED')
}
