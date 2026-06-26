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
    if (!(report.strippedSecrets || []).includes('.env')) failures.push('.env not reported as stripped')
    if (!(report.excludedDirs || []).includes('.git')) failures.push('.git not reported as excluded')
    if (madeSymlink && fs.existsSync(path.join(dest, 'link-to-secret'))) failures.push('symlink leaked into the sandbox')
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
