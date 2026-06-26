#!/usr/bin/env node
// bin/sandbox-prepare — deterministically copy a target repo into an isolated sandbox, stripping version
// history, build output, secrets and out-of-tree symlinks. Cross-platform (pure Node fs, no rsync/bash).
//
// Replaces the natural-language "scaffold" cleanup the Claude deliver engine asks a subagent to do, so the
// strip is a tested script, not a model judgment (closes the "sandbox cleanup never machine-verified" gap).
// Shared by Claude (subagent may call it) and Codex. READ-ONLY on the source; only writes under --dest.
//
// Usage: node bin/sandbox-prepare.mjs --src <targetRepo> --dest <sandboxDir>
// Prints a JSON report; exit 0 on success, 1 if the post-copy safety verification finds a leak, 2 on error.
import fs from 'node:fs'
import path from 'node:path'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.nuxt', 'target', '__pycache__'])
const SECRET_RE = [
  /^\.env$/i, /^\.env\..+/i, /\.(pem|key|p12|pfx|keystore|jks)$/i, /^id_rsa/i, /^id_ed25519/i,
  /^\.npmrc$/i, /^\.pypirc$/i, /credential.*\.json$/i, /secret.*\.json$/i, /\.(bak|dump|log)$/i, /\.sql\.gz$/i,
]
const isSecretName = (name) => SECRET_RE.some((re) => re.test(name))

function parseArgs(argv) {
  const a = { src: null, dest: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') a.src = argv[++i]
    else if (argv[i] === '--dest') a.dest = argv[++i]
  }
  return a
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.src || !a.dest) { process.stderr.write('usage: node bin/sandbox-prepare.mjs --src <repo> --dest <sandbox>\n'); process.exit(2) }
  const src = path.resolve(a.src)
  const dest = path.resolve(a.dest)
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) { process.stderr.write(`source not a directory: ${src}\n`); process.exit(2) }

  const strippedSecrets = [], skippedSymlinks = [], excludedDirs = []
  let copiedFiles = 0
  // start clean so the sandbox can't inherit stale files
  fs.rmSync(dest, { recursive: true, force: true })

  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter(s) {
      if (path.resolve(s) === src) return true
      const rel = path.relative(src, s).replace(/\\/g, '/')
      const base = path.basename(s)
      let st
      try { st = fs.lstatSync(s) } catch { return false }
      if (st.isSymbolicLink()) { skippedSymlinks.push(rel); return false }   // never copy symlinks (out-of-tree leak risk)
      if (st.isDirectory()) { if (EXCLUDE_DIRS.has(base)) { excludedDirs.push(rel); return false } return true }
      if (isSecretName(base)) { strippedSecrets.push(rel); return false }
      copiedFiles++
      return true
    },
  })

  // defense-in-depth: walk the result and fail loudly if any history/secret slipped through
  const leaks = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isSymbolicLink()) { leaks.push(`symlink: ${path.relative(dest, full)}`); continue }
      if (ent.isDirectory()) { if (EXCLUDE_DIRS.has(ent.name)) leaks.push(`dir: ${path.relative(dest, full)}`); else walk(full); continue }
      if (isSecretName(ent.name)) leaks.push(`secret: ${path.relative(dest, full)}`)
    }
  }
  if (fs.existsSync(dest)) walk(dest)

  const report = {
    ok: leaks.length === 0,
    src, dest, copiedFiles,
    excludedDirs, strippedSecrets, skippedSymlinks,
    leaks,
    note: leaks.length ? 'post-copy verification found leaks — sandbox is NOT clean' : 'sandbox prepared; history/build/secrets/symlinks stripped',
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(leaks.length ? 1 : 0)
}

try { main() } catch (e) {
  process.stderr.write(`sandbox-prepare failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
