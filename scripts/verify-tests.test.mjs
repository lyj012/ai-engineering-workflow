// Integration test for bin/verify-tests.mjs: the pass/fail comes from the command's REAL exit code, not a
// judgment. Run directly: node scripts/verify-tests.test.mjs ; also imported by scripts/self-check.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'verify-tests.mjs')

// run verify-tests with an argv command after `--`; returns { status, report }
function vt(cwd, cmd) {
  const r = spawnSync('node', [script, '--cwd', cwd, '--', ...cmd], { encoding: 'utf8' })
  let report = null
  try { report = JSON.parse(r.stdout) } catch { /* leave null */ }
  return { status: r.status, report }
}

export function runVerifyTestsTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-'))

    // passing command: exit 0 → passed true, exitCode 0, script exit 0
    const pass = vt(work, ['node', '-e', 'process.stdout.write("ok")'])
    if (!pass.report) { failures.push('verify-tests printed no JSON for passing command'); return failures }
    if (pass.report.passed !== true) failures.push(`passing command not reported passed: ${JSON.stringify(pass.report)}`)
    if (pass.report.exitCode !== 0) failures.push(`passing command exitCode != 0: ${pass.report.exitCode}`)
    if (pass.status !== 0) failures.push(`verify-tests should exit 0 on pass, got ${pass.status}`)

    // failing command: exit 3 → passed false, exitCode 3, script mirrors 3, output captured
    const fail = vt(work, ['node', '-e', 'console.log("boom-marker");process.exit(3)'])
    if (fail.report.passed !== false) failures.push('failing command wrongly reported passed')
    if (fail.report.exitCode !== 3) failures.push(`failing command exitCode != 3: ${fail.report.exitCode}`)
    if (fail.status !== 3) failures.push(`verify-tests should mirror exit code 3, got ${fail.status}`)
    if (!fail.report.outputTail.includes('boom-marker')) failures.push('failing command output not captured in outputTail')

    // cwd is honored: command observes the directory we passed
    const cwdr = vt(work, ['node', '-e', 'process.stdout.write(process.cwd())'])
    if (!cwdr.report.outputTail.includes(fs.realpathSync(work))) {
      // some platforms canonicalize tmp paths; accept basename match as a fallback
      if (!cwdr.report.outputTail.includes(path.basename(work))) failures.push(`--cwd not honored: report cwd output=${cwdr.report.outputTail}`)
    }

    // command not found: spawn failure → passed false, not a crash
    const missing = vt(work, ['this-command-does-not-exist-xyz', '--nope'])
    if (!missing.report) failures.push('verify-tests printed no JSON for missing command')
    else {
      if (missing.report.passed !== false) failures.push('missing command wrongly reported passed')
      if (missing.report.spawnFailed !== true) failures.push('missing command not flagged spawnFailed')
    }

    // usage error: no command after `--`
    const usage = spawnSync('node', [script, '--cwd', work], { encoding: 'utf8' })
    if (usage.status !== 2) failures.push(`missing command argv should exit 2, got ${usage.status}`)
  } catch (e) {
    failures.push(`verify-tests test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runVerifyTestsTests()
  if (failures.length) {
    console.error('VERIFY-TESTS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('VERIFY-TESTS TESTS PASSED')
}
