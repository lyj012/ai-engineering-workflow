// Integration test for bin/sandbox-prepare.mjs: build a fixture target with history + secrets + a symlink,
// run the script, and assert the sandbox keeps source files but strips history/secrets/symlinks.
// Run directly: node scripts/sandbox-prepare.test.mjs ; also imported by scripts/self-check.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'sandbox-prepare.mjs')

function assertRelativeReportPaths(report, failures) {
  for (const key of ['excludedDirs', 'strippedSecrets', 'skippedSymlinks', 'leaks']) {
    for (const value of report[key] || []) {
      if (/[A-Za-z]:/.test(value) || value.includes('\\\\?\\') || value.includes('//?/')) failures.push(`${key} contains non-portable path: ${value}`)
      if (path.isAbsolute(value) || value.startsWith('/')) failures.push(`${key} contains absolute path: ${value}`)
      if (value.includes('\\')) failures.push(`${key} contains backslashes: ${value}`)
    }
  }
}

export function runSandboxPrepareTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'sbprep-'))
    const src = path.join(work, 'src')
    const dest = path.join(work, 'sandbox')
    fs.mkdirSync(path.join(src, '.git'), { recursive: true })
    fs.writeFileSync(path.join(src, '.git', 'config'), '[core]\n')
    fs.mkdirSync(path.join(src, 'app'), { recursive: true })
    fs.writeFileSync(path.join(src, 'app', 'main.js'), 'console.log(1)\n')   // source: must survive
    fs.writeFileSync(path.join(src, 'README.md'), '# readme\n')              // source: must survive
    fs.writeFileSync(path.join(src, '.env'), 'SECRET=1\n')                   // secret: must be stripped
    fs.writeFileSync(path.join(src, 'id_rsa'), 'PRIVATE\n')                  // secret: must be stripped
    fs.mkdirSync(path.join(src, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(src, 'nested', '.env.local'), 'SECRET=2\n')    // nested secret: must be stripped
    let madeSymlink = false
    try { fs.symlinkSync(path.join(src, '.env'), path.join(src, 'link-to-secret')); madeSymlink = true } catch { /* symlink may be unsupported */ }

    const r = spawnSync('node', [script, '--src', src, '--dest', dest], { encoding: 'utf8' })
    if (r.status !== 0) { failures.push(`sandbox-prepare exited ${r.status}: ${r.stderr || r.stdout}`); return failures }
    let report
    try { report = JSON.parse(r.stdout) } catch { failures.push('sandbox-prepare did not print JSON'); return failures }

    if (report.ok !== true) failures.push(`sandbox-prepare report.ok != true (leaks: ${JSON.stringify(report.leaks)})`)
    if (!fs.existsSync(path.join(dest, 'app', 'main.js'))) failures.push('source app/main.js was not copied into the sandbox')
    if (!fs.existsSync(path.join(dest, 'README.md'))) failures.push('source README.md was not copied into the sandbox')
    if (fs.existsSync(path.join(dest, '.git'))) failures.push('.git leaked into the sandbox')
    if (fs.existsSync(path.join(dest, '.env'))) failures.push('.env secret leaked into the sandbox')
    if (fs.existsSync(path.join(dest, 'id_rsa'))) failures.push('id_rsa secret leaked into the sandbox')
    if (fs.existsSync(path.join(dest, 'nested', '.env.local'))) failures.push('nested .env.local secret leaked into the sandbox')
    if (!(report.strippedSecrets || []).includes('.env')) failures.push('.env not reported as stripped')
    if (!(report.strippedSecrets || []).includes('nested/.env.local')) failures.push('nested .env.local not reported as stripped')
    if (!(report.excludedDirs || []).includes('.git')) failures.push('.git not reported as excluded')
    assertRelativeReportPaths(report, failures)
    if (madeSymlink && fs.existsSync(path.join(dest, 'link-to-secret'))) failures.push('symlink leaked into the sandbox')

    const r2 = spawnSync('node', [script, '--src', src.replace(/\\/g, '/'), '--dest', `${dest}-posix`], { encoding: 'utf8' })
    if (r2.status !== 0) failures.push(`sandbox-prepare with POSIX-style paths exited ${r2.status}: ${r2.stderr || r2.stdout}`)
    else {
      const report2 = JSON.parse(r2.stdout)
      if (!report2.strippedSecrets.includes('nested/.env.local')) failures.push('POSIX-style path run did not report nested secret')
      assertRelativeReportPaths(report2, failures)
    }
  } catch (e) {
    failures.push(`sandbox-prepare test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runSandboxPrepareTests()
  if (failures.length) {
    console.error('SANDBOX-PREPARE TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('SANDBOX-PREPARE TESTS PASSED')
}
