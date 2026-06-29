#!/usr/bin/env node
// bin/inspect-remote — read a git remote's URL and emit ONLY its masked form + a credential flag, so a raw
// URL (which may embed a token/password) never leaves this CLI into an agent transcript, log or artifact.
//
// R2-2: the publish Preflight previously had a subagent run `git remote get-url`, putting the raw (possibly
// credentialed) URL into the agent's Bash output. This CLI reads the raw URL internally and prints only
// { maskedUrl, hasCredentials, safeUrl }. safeUrl equals the raw URL ONLY when it is credential-free; for a
// credentialed URL safeUrl is empty (the raw is never returned). Cross-platform (spawnSync argv, no shell).
//
// Usage:
//   node bin/inspect-remote.mjs --repo <dir> --remote <name>   # read targetRepo's remote URL via git
//   node bin/inspect-remote.mjs --url <url>                     # inspect a URL directly (no git read)
// Prints JSON to stdout; exit 0 on success, 2 on bad usage, 3 when the remote could not be read.
import { spawnSync } from 'node:child_process'
import { inspectRemoteUrl } from '../core/mask-remote-url.mjs'

function parseArgs(argv) {
  const a = { repo: null, remote: 'origin', url: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') a.repo = argv[++i]
    else if (argv[i] === '--remote') a.remote = argv[++i]
    else if (argv[i] === '--url') a.url = argv[++i]
  }
  return a
}

function readRemoteUrl(repo, remote) {
  const r = spawnSync('git', ['-C', repo, 'remote', 'get-url', remote], { encoding: 'utf8', shell: false })
  if (r.status !== 0) return null
  return (r.stdout || '').trim()
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  let raw
  if (a.url != null) raw = a.url
  else if (a.repo) raw = readRemoteUrl(a.repo, a.remote)
  else { process.stderr.write('usage: node bin/inspect-remote.mjs (--repo <dir> [--remote <name>] | --url <url>)\n'); process.exit(2) }

  if (raw == null) {
    // could not resolve the remote — emit a credential-free empty result, never leak anything
    process.stdout.write(JSON.stringify({ maskedUrl: '', hasCredentials: false, safeUrl: '', resolved: false }, null, 2) + '\n')
    process.exit(3)
  }
  const out = inspectRemoteUrl(raw)
  // hard guarantee: stdout carries only the inspected (masked / credential-free) fields, never the raw URL
  process.stdout.write(JSON.stringify({ ...out, resolved: true }, null, 2) + '\n')
  process.exit(0)
}

try { main() } catch (e) {
  process.stderr.write(`inspect-remote failed: ${String((e && e.message) || e).slice(0, 200)}\n`)
  process.exit(2)
}
