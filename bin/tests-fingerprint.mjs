#!/usr/bin/env node
// bin/tests-fingerprint — deterministically fingerprint a tests/ directory so "were the tests tampered
// with?" is a script-computed fact, not a model-judged one. Cross-platform (pure Node, no shell/find).
//
// Replaces the natural-language "find tests -type f | sort | sha256sum each | sha256sum the result | take
// the first 16" the Claude deliver engine asked two different subagents (materialize + independent verify)
// to re-implement in prose — two chances to drift. Now both stages, and the Codex adapter, call this one
// canonical algorithm, so the frozen baseline and the verify-time recompute agree by construction.
// READ-ONLY: never writes anything.
//
// Canonical algorithm (stable across OS / FS enumeration order):
//   files   = every regular file under <dir>, recursively (symlinks skipped, never followed)
//   lines   = for each file, in ascending relative-POSIX-path order: `${sha256hex(content)}  ${relpath}`
//   digest  = sha256hex( lines.join('\n') + '\n' )
//   fingerprint = digest.slice(0, 16)
//   (an empty/absent dir yields a fixed fingerprint for the empty file set, never an error)
//
// Usage: node bin/tests-fingerprint.mjs --dir <testsDir>
// Prints a JSON report; exit 0 on success, 2 on bad usage / unreadable dir.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const toPosix = (p) => String(p || '').replace(/\\/g, '/')
const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex')

function parseArgs(argv) {
  const a = { dir: null, len: 16 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') a.dir = argv[++i]
    else if (argv[i] === '--len') a.len = Number(argv[++i]) || 16
  }
  return a
}

function listFiles(dir, base = dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isSymbolicLink()) continue          // never follow / include symlinks (out-of-tree leak risk)
    if (ent.isDirectory()) listFiles(full, base, out)
    else if (ent.isFile()) out.push(toPosix(path.relative(base, full)))
  }
  return out
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.dir) { process.stderr.write('usage: node bin/tests-fingerprint.mjs --dir <testsDir> [--len 16]\n'); process.exit(2) }
  const dir = path.resolve(a.dir)
  const present = fs.existsSync(dir) && fs.statSync(dir).isDirectory()

  const relPaths = present ? listFiles(dir).sort() : []
  const lines = relPaths.map((rel) => `${sha256hex(fs.readFileSync(path.join(dir, rel)))}  ${rel}`)
  const digest = sha256hex(lines.join('\n') + '\n')
  const fingerprint = digest.slice(0, Math.max(1, a.len))

  const report = { ok: true, dir, present, fileCount: relPaths.length, files: relPaths, fingerprint }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(0)
}

try { main() } catch (e) {
  process.stderr.write(`tests-fingerprint failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
