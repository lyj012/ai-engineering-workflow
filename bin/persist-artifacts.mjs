#!/usr/bin/env node
// bin/persist-artifacts — deterministically write an artifact bundle into a fresh timestamped run dir.
// Cross-platform (pure Node fs). Replaces the "persist" subagent hand-writing JSON: a script writes the
// JSON byte-for-byte, so a weak model can never corrupt it (this is exactly the class of bug that produced
// invalid run-manifest.json earlier). Shared by Claude (subagent may call it) and Codex.
//
// Usage:
//   node bin/persist-artifacts.mjs --out-base <dir> [--ts <stamp>] [--bundle <bundle.json>]
//   echo '<bundle-json>' | node bin/persist-artifacts.mjs --out-base <dir>
// bundle = { "<filename>": <content> }  — object content is written as pretty JSON; string content raw (UTF-8).
// Prints { ok, absOutDir, written } as JSON.
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const a = { outBase: null, ts: null, bundle: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out-base') a.outBase = argv[++i]
    else if (argv[i] === '--ts') a.ts = argv[++i]
    else if (argv[i] === '--bundle') a.bundle = argv[++i]
  }
  return a
}

function defaultStamp() {
  const d = new Date() // plain Node script — Date is allowed here (unlike a Workflow script body)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.outBase) { process.stderr.write('usage: node bin/persist-artifacts.mjs --out-base <dir> [--ts <stamp>] [--bundle <file>]\n'); process.exit(2) }
  const raw = a.bundle ? fs.readFileSync(a.bundle, 'utf8') : fs.readFileSync(0, 'utf8')
  let bundle
  try { bundle = JSON.parse(raw) } catch (e) { process.stderr.write(`invalid bundle JSON: ${e.message}\n`); process.exit(2) }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) { process.stderr.write('bundle must be an object { filename: content }\n'); process.exit(2) }

  const ts = a.ts || defaultStamp()
  const absOutDir = path.resolve(a.outBase, ts)
  fs.mkdirSync(absOutDir, { recursive: true })

  const written = []
  for (const [name, content] of Object.entries(bundle)) {
    if (name.includes('..') || path.isAbsolute(name)) { process.stderr.write(`unsafe artifact name rejected: ${name}\n`); process.exit(2) }
    const target = path.join(absOutDir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const text = (typeof content === 'string') ? content : JSON.stringify(content, null, 2) + '\n'
    fs.writeFileSync(target, text, 'utf8')
    written.push(name)
  }
  process.stdout.write(JSON.stringify({ ok: true, absOutDir, written }, null, 2) + '\n')
  process.exit(0)
}

try { main() } catch (e) {
  process.stderr.write(`persist-artifacts failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
