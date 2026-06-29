// Integration test for bin/tests-fingerprint.mjs: a canonical, deterministic, order-independent fingerprint
// of a tests/ directory. Run directly: node scripts/tests-fingerprint.test.mjs ; also imported by self-check.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'tests-fingerprint.mjs')

function fp(dir) {
  const r = spawnSync('node', [script, '--dir', dir], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`tests-fingerprint exited ${r.status}: ${r.stderr || r.stdout}`)
  return JSON.parse(r.stdout)
}

export function runTestsFingerprintTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'tfp-'))

    // dir A: two files, created in one order
    const a = path.join(work, 'a')
    fs.mkdirSync(path.join(a, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(a, 'one.test.js'), 'assert(1)\n')
    fs.writeFileSync(path.join(a, 'nested', 'two.test.js'), 'assert(2)\n')

    // dir B: identical content, files written in the opposite order (order independence)
    const b = path.join(work, 'b')
    fs.mkdirSync(path.join(b, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(b, 'nested', 'two.test.js'), 'assert(2)\n')
    fs.writeFileSync(path.join(b, 'one.test.js'), 'assert(1)\n')

    const ra = fp(a)
    if (ra.fingerprint.length !== 16) failures.push(`fingerprint not 16 chars: ${ra.fingerprint}`)
    if (ra.fileCount !== 2) failures.push(`fileCount expected 2, got ${ra.fileCount}`)
    if (!ra.files.includes('nested/two.test.js')) failures.push('nested file missing from files list (or not POSIX path)')

    if (fp(a).fingerprint !== ra.fingerprint) failures.push('fingerprint not deterministic across runs')
    if (fp(b).fingerprint !== ra.fingerprint) failures.push('fingerprint depends on file creation order (should not)')

    // content change → fingerprint changes
    const c = path.join(work, 'c')
    fs.cpSync(a, c, { recursive: true })
    fs.writeFileSync(path.join(c, 'one.test.js'), 'assert(999)\n')
    if (fp(c).fingerprint === ra.fingerprint) failures.push('fingerprint unchanged after a test file content changed')

    // added file → fingerprint changes
    const d = path.join(work, 'd')
    fs.cpSync(a, d, { recursive: true })
    fs.writeFileSync(path.join(d, 'three.test.js'), 'assert(3)\n')
    const rd = fp(d)
    if (rd.fingerprint === ra.fingerprint) failures.push('fingerprint unchanged after a test file was added')
    if (rd.fileCount !== 3) failures.push(`fileCount expected 3 after add, got ${rd.fileCount}`)

    // absent dir → ok, stable empty-set fingerprint, fileCount 0 (never an error)
    const missing = fp(path.join(work, 'does-not-exist'))
    if (missing.ok !== true || missing.present !== false || missing.fileCount !== 0) failures.push(`absent dir not handled gracefully: ${JSON.stringify(missing)}`)
    if (missing.fingerprint.length !== 16) failures.push('absent dir produced no stable fingerprint')
  } catch (e) {
    failures.push(`tests-fingerprint test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runTestsFingerprintTests()
  if (failures.length) {
    console.error('TESTS-FINGERPRINT TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('TESTS-FINGERPRINT TESTS PASSED')
}
