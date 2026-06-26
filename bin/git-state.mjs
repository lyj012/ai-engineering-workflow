#!/usr/bin/env node
// bin/git-state — deterministic, cross-platform git-state + branch-choice probe (READ-ONLY).
//
// Part of the platform-neutral deterministic surface shared by every adapter:
//   - Codex (Desktop / CLI) calls this instead of any Claude-specific Workflow runtime;
//   - the Claude workflow may also call it, or inline the same core/ logic with self-check parity.
// It only READS git state (no checkout / branch / commit / push) and prints JSON. The branch decision
// itself is the pure core/ logic (core/git-state.mjs + core/branch-choice.mjs) — this wrapper only
// gathers facts by running git, so the rules stay identical across tools and operating systems.
//
// Cross-platform: uses spawnSync('git', ...) which works on Windows / macOS / Linux when git is on PATH.
// No author-machine paths, no shell-specific syntax (git is invoked as an argv array, not via a shell).
//
// Usage:
//   node bin/git-state.mjs [--cwd <dir>] [--mode <new-branch|switch-existing|current-branch|direct>] \
//                          [--target-branch <name>] [--remote <name=origin>]
// Exit code is always 0 on a successful probe (the JSON carries the verdict); 2 only on internal error.
import { spawnSync } from 'node:child_process'
import { classifyGitState } from '../core/git-state.mjs'
import { resolveBranchChoice } from '../core/branch-choice.mjs'

function parseArgs(argv) {
  const a = { cwd: process.cwd(), mode: '', targetBranch: null, remote: 'origin' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--cwd') a.cwd = argv[++i]
    else if (k === '--mode') a.mode = argv[++i] || ''
    else if (k === '--target-branch') a.targetBranch = argv[++i] || null
    else if (k === '--remote') a.remote = argv[++i] || 'origin'
  }
  return a
}

// Run git read-only. Returns { ok, out } — ok=false when git exits non-zero (e.g. detached HEAD,
// unborn branch, not a repo). Never throws on a non-zero git exit; only a missing git binary throws.
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.error) return { ok: false, out: '', err: String(r.error.message || r.error) }
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const isRepo = git(a.cwd, ['rev-parse', '--is-inside-work-tree']).out === 'true'

  let raw = { isRepo: false, headSymbolicRef: null, currentBranch: null, headSha: '', gitDir: '', gitCommonDir: '', dirty: false }
  if (isRepo) {
    const sym = git(a.cwd, ['symbolic-ref', '-q', 'HEAD']) // ok=false when detached
    const abbrev = git(a.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const sha = git(a.cwd, ['rev-parse', 'HEAD'])
    const gd = git(a.cwd, ['rev-parse', '--git-dir'])
    const gcd = git(a.cwd, ['rev-parse', '--git-common-dir'])
    const status = git(a.cwd, ['status', '--porcelain'])
    raw = {
      isRepo: true,
      headSymbolicRef: sym.ok ? sym.out : null,
      currentBranch: abbrev.ok ? abbrev.out : null,
      headSha: sha.ok ? sha.out : '',
      gitDir: gd.ok ? gd.out : '',
      gitCommonDir: gcd.ok ? gcd.out : '',
      dirty: status.ok && status.out.length > 0,
    }
  }
  const state = classifyGitState(raw)

  // probe target-branch existence (local first, then the remote) only when one was named
  let targetBranchExists = null
  if (a.targetBranch) {
    const local = git(a.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${a.targetBranch}`])
    if (local.ok && local.out) targetBranchExists = true
    else {
      const remote = git(a.cwd, ['ls-remote', '--heads', a.remote, a.targetBranch])
      targetBranchExists = !!(remote.ok && remote.out)
    }
  }

  const choice = resolveBranchChoice({
    requestedMode: a.mode,
    targetBranch: a.targetBranch,
    detachedHead: state.detachedHead,
    targetBranchExists,
  })

  process.stdout.write(JSON.stringify({
    gitState: state,
    targetBranch: a.targetBranch,
    targetBranchExists,
    branchChoice: choice,
  }, null, 2) + '\n')
  process.exit(0)
}

try { main() } catch (e) {
  process.stderr.write(`git-state probe failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
