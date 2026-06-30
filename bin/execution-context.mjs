#!/usr/bin/env node
// Build the stable execution_context object shared with every workflow subagent.
// The command is read-only: it resolves absolute roots and records a git workspace snapshot.
import { spawnSync } from 'node:child_process'
import { buildExecutionContext } from '../core/execution-context.mjs'

function parseArgs(argv) {
  const a = { workflowRoot: '', projectRoot: '', workspaceRoot: '', taskArtifactRoot: '', changedFiles: [] }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--workflow-root') a.workflowRoot = argv[++i] || ''
    else if (k === '--project-root') a.projectRoot = argv[++i] || ''
    else if (k === '--workspace-root') a.workspaceRoot = argv[++i] || ''
    else if (k === '--task-artifact-root') a.taskArtifactRoot = argv[++i] || ''
    else if (k === '--changed-files') {
      const raw = argv[++i] || '[]'
      try { a.changedFiles = JSON.parse(raw) } catch { a.changedFiles = raw.split(',').map(s => s.trim()).filter(Boolean) }
    }
  }
  return a
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.error) return { ok: false, out: '', err: String(r.error.message || r.error) }
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

function workspaceBaseline(cwd) {
  const isRepo = git(cwd, ['rev-parse', '--is-inside-work-tree']).out === 'true'
  if (!isRepo) return { branch: '', head: '', statusShort: '', diffStat: '', untrackedFiles: [] }
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const head = git(cwd, ['rev-parse', 'HEAD'])
  const status = git(cwd, ['status', '--short'])
  const diffStat = git(cwd, ['diff', '--stat'])
  const untrackedFiles = status.out
    .split(/\r?\n/)
    .filter(line => line.startsWith('?? '))
    .map(line => line.slice(3).trim())
    .filter(Boolean)
  return {
    branch: branch.ok ? branch.out : '',
    head: head.ok ? head.out : '',
    statusShort: status.ok ? status.out : '',
    diffStat: diffStat.ok ? diffStat.out : '',
    untrackedFiles,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.workflowRoot || !args.projectRoot) {
    process.stderr.write('usage: node bin/execution-context.mjs --workflow-root <dir> --project-root <dir> [--workspace-root <dir>] [--task-artifact-root <dir>] [--changed-files <json-array>]\n')
    process.exit(2)
  }
  const workspaceRoot = args.workspaceRoot || args.projectRoot
  const out = buildExecutionContext({
    ...args,
    workspaceRoot,
    workspaceBaseline: workspaceBaseline(workspaceRoot),
  })
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
}

try { main() } catch (e) {
  process.stderr.write(`execution-context failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
