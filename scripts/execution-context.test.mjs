// Unit/integration tests for execution_context construction.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildExecutionContext, compareWorkspaceSnapshots } from '../core/execution-context.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, '..', 'bin', 'execution-context.mjs')

export function runExecutionContextTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'aiew-ctx-'))
    const project = path.join(work, 'project')
    const toolkit = path.join(work, 'toolkit')
    fs.mkdirSync(project)
    fs.mkdirSync(toolkit)

    const ctx = buildExecutionContext({
      workflowRoot: toolkit,
      projectRoot: project,
      changedFiles: ['src/app.js'],
      workspaceBaseline: { statusShort: '?? scratch.txt', untrackedFiles: ['scratch.txt'] },
    }).executionContext
    if (!path.isAbsolute(ctx.workflowRoot)) failures.push('workflowRoot must be absolute')
    if (!path.isAbsolute(ctx.projectRoot)) failures.push('projectRoot must be absolute')
    if (ctx.changedFiles[0] !== 'src/app.js') failures.push('changedFiles not preserved')
    if (ctx.workspaceBaseline.untrackedFiles[0] !== 'scratch.txt') failures.push('baseline untracked files not preserved')

    const cmp = compareWorkspaceSnapshots(
      { head: 'a', statusShort: '?? old.txt', untrackedFiles: ['old.txt'] },
      { head: 'a', statusShort: '?? old.txt\n?? new.txt', untrackedFiles: ['old.txt', 'new.txt'] },
    )
    if (cmp.preExistingUntracked.join(',') !== 'old.txt') failures.push('preExistingUntracked mismatch')
    if (cmp.newUntracked.join(',') !== 'new.txt') failures.push('newUntracked mismatch')
    if (!cmp.sameHead) failures.push('sameHead should be true')

    const cliRun = spawnSync(process.execPath, [cli, '--workflow-root', toolkit, '--project-root', project, '--changed-files', '["README.md"]'], { encoding: 'utf8' })
    if (cliRun.status !== 0) failures.push(`execution-context CLI failed: ${cliRun.stderr || cliRun.stdout}`)
    else {
      const parsed = JSON.parse(cliRun.stdout)
      if (parsed.executionContext.changedFiles[0] !== 'README.md') failures.push('CLI changedFiles not parsed')
      if (!path.isAbsolute(parsed.executionContext.workspaceRoot)) failures.push('CLI workspaceRoot must be absolute')
    }
  } catch (e) {
    failures.push(`execution-context test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runExecutionContextTests()
  if (failures.length) {
    console.error('EXECUTION-CONTEXT TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('EXECUTION-CONTEXT TESTS PASSED')
}
