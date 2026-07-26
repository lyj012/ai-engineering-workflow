#!/usr/bin/env node
// Read-only pre-push safety snapshot. Performs no git writes.
import { spawnSync } from 'node:child_process'
import { computePrePushStatus } from '../core/pre-push-status.mjs'
import { classifyGitState } from '../core/git-state.mjs'
import { inspectRemoteUrl } from '../core/mask-remote-url.mjs'

function arg(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function has(name) { return process.argv.includes(name) }

function git(cwd, args, options = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.error) return { ok: false, out: '', err: String(r.error.message || r.error) }
  const trim = options.trim !== false
  return {
    ok: r.status === 0,
    out: trim ? (r.stdout || '').trim() : (r.stdout || ''),
    err: trim ? (r.stderr || '').trim() : (r.stderr || ''),
  }
}

function lines(s) { return String(s || '').split(/\r?\n/).filter(line => line.trim()) }

function changedFilesFromPorcelain(text) {
  return lines(text).map(line => line.slice(3).trim()).map(f => {
    const arrow = f.indexOf(' -> ')
    return arrow >= 0 ? f.slice(arrow + 4) : f
  }).filter(Boolean)
}

function listFromArg(v) {
  if (!v) return []
  return String(v).split(',').map(x => x.trim()).filter(Boolean)
}

function main() {
  const cwd = arg('--cwd') || process.cwd()
  const publishIntent = !has('--snapshot-only')
  const allowProtectedBranchPublish = has('--allow-protected-branch-publish')
  const allowHighRiskPublish = has('--allow-high-risk-publish')
  const highRisk = has('--high-risk')
  const verificationPassed = has('--verification-passed') ? true : has('--verification-failed') ? false : undefined
  const verificationCommands = listFromArg(arg('--verification'))
  const taskFiles = listFromArg(arg('--task-files'))
  const unrelatedFiles = listFromArg(arg('--unrelated-files'))
  const unsafeFiles = listFromArg(arg('--unsafe-files'))

  const isRepo = git(cwd, ['rev-parse', '--is-inside-work-tree'])
  const branch = git(cwd, ['branch', '--show-current'])
  const head = git(cwd, ['rev-parse', '--short', 'HEAD'])
  const gitDir = git(cwd, ['rev-parse', '--git-dir'])
  const commonDir = git(cwd, ['rev-parse', '--git-common-dir'])
  const porcelain = git(cwd, ['status', '--porcelain'], { trim: false })
  const remoteName = arg('--remote') || 'origin'
  const remoteUrlRaw = git(cwd, ['remote', 'get-url', remoteName])
  const remoteInfo = inspectRemoteUrl(remoteUrlRaw.ok ? remoteUrlRaw.out : '')

  const changedFiles = changedFilesFromPorcelain(porcelain.out)
  const rawGit = {
    isRepo: isRepo.ok && isRepo.out === 'true',
    currentBranch: branch.ok && branch.out ? branch.out : (head.ok ? 'HEAD' : null),
    headSymbolicRef: branch.ok && branch.out ? `refs/heads/${branch.out}` : '',
    gitDir: gitDir.out,
    gitCommonDir: commonDir.out,
    statusShort: porcelain.out,
    dirty: changedFiles.length > 0,
    headSha: head.out,
  }

  const gitState = classifyGitState(rawGit)
  const result = computePrePushStatus({
    gitState,
    changedFiles,
    taskFiles,
    unrelatedFiles,
    unsafeFiles,
    verificationCommands,
    verificationPassed,
    publishIntent,
    highRisk,
    allowProtectedBranchPublish,
    allowHighRiskPublish,
    remote: {
      name: remoteName,
      url: remoteInfo.safeUrl || remoteInfo.maskedUrl,
      hasCredentials: remoteInfo.hasCredentials,
      readOk: remoteUrlRaw.ok,
    },
    remoteName,
    targetBranch: arg('--target-branch') || gitState.currentBranch,
    branchChoice: { resolvedMode: arg('--branch-mode') || null },
  })

  process.stdout.write(JSON.stringify({ cwd, ...result }, null, 2) + '\n')
}

try { main() } catch (e) {
  process.stderr.write(`pre-push-check failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
