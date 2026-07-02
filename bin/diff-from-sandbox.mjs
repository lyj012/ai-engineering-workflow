#!/usr/bin/env node
// Generate a portable patch by committing a clean baseline copy, mirroring the sandbox over it, then using
// normal git diff. This avoids git diff --no-index --label compatibility gaps and keeps absolute paths out
// of changes.diff.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { guardOrExit } from './safe-rm.mjs'

const EXCLUDE_DIRS = new Set(['.git'])

function parseArgs(argv) {
  const a = { base: null, sandbox: null, out: null, work: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') a.base = argv[++i]
    else if (argv[i] === '--sandbox') a.sandbox = argv[++i]
    else if (argv[i] === '--out') a.out = argv[++i]
    else if (argv[i] === '--work') a.work = argv[++i]
  }
  return a
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`)
  return r
}

function copyFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(ent.name)) continue
    fs.cpSync(path.join(src, ent.name), path.join(dest, ent.name), {
      recursive: true,
      force: true,
      filter(s) {
        return !EXCLUDE_DIRS.has(path.basename(s))
      },
    })
  }
}

function applyCheck(base, diffPath, parentDir) {
  const applyWork = path.join(parentDir, 'apply-check')
  guardOrExit(applyWork, [base], 'diff apply-check work')
  fs.rmSync(applyWork, { recursive: true, force: true })
  copyFiltered(base, applyWork)
  const r = spawnSync('git', ['apply', '--check', diffPath], { cwd: applyWork, encoding: 'utf8' })
  return {
    passed: r.status === 0,
    exitCode: typeof r.status === 'number' ? r.status : 1,
    outputTail: ((r.stdout || '') + (r.stderr || '')).slice(-4000),
  }
}

function clearWorktree(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git') continue
    fs.rmSync(path.join(dir, ent.name), { recursive: true, force: true })
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.base || !a.sandbox || !a.out) {
    process.stderr.write('usage: node bin/diff-from-sandbox.mjs --base <clean-target> --sandbox <sandbox> --out <changes.diff> [--work <dir>]\n')
    process.exit(2)
  }
  const base = path.resolve(a.base)
  const sandbox = path.resolve(a.sandbox)
  const out = path.resolve(a.out)
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error(`base not a directory: ${base}`)
  if (!fs.existsSync(sandbox) || !fs.statSync(sandbox).isDirectory()) throw new Error(`sandbox not a directory: ${sandbox}`)

  const work = path.resolve(a.work || fs.mkdtempSync(path.join(os.tmpdir(), 'aiew-diff-')))
  // a caller-supplied --work must never overlap base/sandbox (or root) before we rm -rf + clearWorktree it
  guardOrExit(work, [base, sandbox], 'diff work')
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  copyFiltered(base, work)
  run('git', ['init'], work)
  run('git', ['config', 'core.autocrlf', 'false'], work)
  run('git', ['config', 'user.email', 'aiew@example.invalid'], work)
  run('git', ['config', 'user.name', 'AI Engineering Workflow'], work)
  run('git', ['add', '-A'], work)
  run('git', ['commit', '-m', 'baseline'], work)

  clearWorktree(work)
  copyFiltered(sandbox, work)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  run('git', ['rm', '-r', '--cached', '.'], work)
  run('git', ['add', '-A'], work)
  run('git', ['diff', '--cached', '--binary', '--output', out], work)
  const filesChanged = run('git', ['diff', '--cached', '--name-only'], work).stdout.split(/\r?\n/).filter(Boolean)
  const diffText = fs.readFileSync(out, 'utf8')
  const absoluteLeak = diffText.includes(base) || diffText.includes(sandbox) || diffText.includes(work)
  const check = applyCheck(base, out, work)
  const nonEmpty = filesChanged.length > 0
  const report = {
    ok: !absoluteLeak && nonEmpty && check.passed,
    out,
    filesChanged,
    absoluteLeak,
    diffApplyCheckPassed: check.passed,
    applyCheckExitCode: check.exitCode,
    applyCheckOutputTail: check.outputTail,
    work,
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(report.ok ? 0 : 1)
}

try { main() } catch (e) {
  process.stderr.write(`diff-from-sandbox failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
