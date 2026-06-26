// Integration test for bin/persist-artifacts.mjs: write a bundle (with embedded quotes / non-ASCII), then
// re-read the files and assert byte-faithful JSON. This is the regression guard for the class of bug where
// a model hand-writing JSON drops an escape and produces an unparseable artifact.
// Run directly: node scripts/persist-artifacts.test.mjs ; also imported by scripts/self-check.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'persist-artifacts.mjs')

export function runPersistArtifactsTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-'))
    // a bundle whose JSON values contain the exact thing a weak model mis-escapes: inner double quotes + 中文
    const manifest = { goal: '为 app.sh 新增 "--greet" 标志', openQuestions: ['"缺名字" 时如何表现？'], nested: { a: 1 } }
    const bundle = { 'run-manifest.json': manifest, 'final-plan.md': '# 方案\n\n含 "引号" 与中文。\n' }
    const r = spawnSync('node', [script, '--out-base', work, '--ts', '20200101-000000'], { input: JSON.stringify(bundle), encoding: 'utf8' })
    if (r.status !== 0) { failures.push(`persist-artifacts exited ${r.status}: ${r.stderr || r.stdout}`); return failures }
    let report
    try { report = JSON.parse(r.stdout) } catch { failures.push('persist-artifacts did not print JSON'); return failures }
    if (report.ok !== true) failures.push('persist-artifacts report.ok != true')
    const outDir = path.join(work, '20200101-000000')

    // the JSON artifact must re-parse and deep-equal the original (no corruption of the embedded quotes)
    let back
    try { back = JSON.parse(fs.readFileSync(path.join(outDir, 'run-manifest.json'), 'utf8')) } catch (e) { failures.push(`run-manifest.json unparseable: ${e.message}`); back = null }
    if (back && JSON.stringify(back) !== JSON.stringify(manifest)) failures.push('run-manifest.json round-trip mismatch')
    // the markdown artifact must be written raw, byte-faithful
    const md = fs.existsSync(path.join(outDir, 'final-plan.md')) ? fs.readFileSync(path.join(outDir, 'final-plan.md'), 'utf8') : null
    if (md !== '# 方案\n\n含 "引号" 与中文。\n') failures.push('final-plan.md not written byte-faithful')
    if (!(report.written || []).includes('run-manifest.json')) failures.push('run-manifest.json not reported as written')
    // path-traversal guard
    const evil = spawnSync('node', [script, '--out-base', work, '--ts', 't2'], { input: JSON.stringify({ '../escape.json': { x: 1 } }), encoding: 'utf8' })
    if (evil.status === 0) failures.push('persist-artifacts accepted a path-traversal artifact name')
  } catch (e) {
    failures.push(`persist-artifacts test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runPersistArtifactsTests()
  if (failures.length) {
    console.error('PERSIST-ARTIFACTS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('PERSIST-ARTIFACTS TESTS PASSED')
}
