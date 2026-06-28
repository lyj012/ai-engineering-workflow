// CLI-level tests for bin/core.mjs input modes, especially Windows PowerShell-safe forms.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'core.mjs')

function run(args, opts = {}) {
  return spawnSync('node', [script, ...args], { encoding: 'utf8', input: opts.input || undefined })
}

export function runCoreCliInputTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'corecli-'))
    const scopeFile = path.join(work, 'scope-check.json')
    const branchFile = path.join(work, 'branch-choice.json')
    const projectFile = path.join(work, 'project-type.json')
    const deliverFile = path.join(work, 'deliver-status.json')
    fs.writeFileSync(scopeFile, JSON.stringify({ changedFiles: ['app.sh'], scopeFiles: ['app.sh'] }))
    fs.writeFileSync(branchFile, JSON.stringify({ requestedMode: 'new-branch', detachedHead: false, targetBranchExists: false }))
    fs.writeFileSync(projectFile, JSON.stringify({ files: ['app.sh', 'test.sh'], packageJson: null }))
    fs.writeFileSync(deliverFile, JSON.stringify({
      implementPassed: true,
      verify: { donePassedVerified: true, scopeCleanVerified: true, redGreenVerified: true },
      reviews: [{ verdict: 'ok', blocking: false }],
      reviewIncomplete: false,
      diff: { ok: true, diffApplyCheckPassed: true, filesChanged: ['app.sh'] },
      codeQuality: { applicable: false },
    }))

    const readiness = run(['readiness', 'PASS'])
    if (readiness.status !== 0 || !readiness.stdout.includes('"ready"')) failures.push(`readiness PASS failed: ${readiness.stderr || readiness.stdout}`)

    const guard = run(['git-guard', JSON.stringify('git push --force origin main')])
    if (guard.status !== 0 || !guard.stdout.includes('"blocked": true')) failures.push(`git-guard json argv failed: ${guard.stderr || guard.stdout}`)

    const scope = run(['scope-check', '--input', scopeFile])
    if (scope.status !== 0 || !scope.stdout.includes('"ok": true')) failures.push(`scope-check --input failed: ${scope.stderr || scope.stdout}`)

    const branch = run(['branch-choice', '--stdin'], { input: fs.readFileSync(branchFile, 'utf8') })
    if (branch.status !== 0 || !branch.stdout.includes('"resolvedMode": "new-branch"')) failures.push(`branch-choice --stdin failed: ${branch.stderr || branch.stdout}`)

    const project = run(['project-type', '--input', projectFile])
    if (project.status !== 0 || !project.stdout.includes('"type": "non-web"')) failures.push(`project-type --input failed: ${project.stderr || project.stdout}`)

    const deliver = run(['deliver-status', '--input', deliverFile])
    if (deliver.status !== 0 || !deliver.stdout.includes('"finalStatus": "DELIVERED"')) failures.push(`deliver-status --input failed: ${deliver.stderr || deliver.stdout}`)

    const invalid = run(['scope-check', '{bad-json'])
    if (invalid.status === 0 || !invalid.stderr.includes('invalid JSON input')) failures.push('invalid JSON did not fail with a clear error')
  } catch (e) {
    failures.push(`core-cli-input test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runCoreCliInputTests()
  if (failures.length) {
    console.error('CORE-CLI-INPUT TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('CORE-CLI-INPUT TESTS PASSED')
}
