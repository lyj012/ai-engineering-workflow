// Integration test for bin/inspect-remote.mjs: a raw credentialed remote URL must NEVER appear in the CLI
// output. Uses a mkdtemp throwaway git repo with a fake-credential remote — no real credentials, no network.
// Run: node scripts/inspect-remote.test.mjs ; also imported by scripts/self-check.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'bin', 'inspect-remote.mjs')

function run(args) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* leave null */ }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json }
}

export function runInspectRemoteTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'inspectrm-'))
    const repo = path.join(work, 'repo')
    fs.mkdirSync(repo)
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
    git('init', '-q')
    // a CREDENTIALED remote (fake token) — its raw form must never appear in CLI output
    git('remote', 'add', 'origin', 'https://x-token:FAKESECRET123@example.com/o/r.git')
    // a credential-free remote
    git('remote', 'add', 'clean', 'https://example.com/o/r.git')

    const cred = run(['--repo', repo, '--remote', 'origin'])
    if (!cred.json) { failures.push(`inspect-remote produced no JSON for credentialed remote: ${cred.stderr}`); return failures }
    if (cred.json.hasCredentials !== true) failures.push('credentialed remote not flagged hasCredentials=true')
    if (cred.json.safeUrl !== '') failures.push(`credentialed remote leaked safeUrl: ${cred.json.safeUrl}`)
    if (/FAKESECRET123/.test(cred.stdout) || /FAKESECRET123/.test(cred.stderr)) failures.push('RAW CREDENTIAL leaked into inspect-remote output')
    if (!/\*\*\*/.test(cred.json.maskedUrl)) failures.push(`credentialed maskedUrl not masked: ${cred.json.maskedUrl}`)

    const clean = run(['--repo', repo, '--remote', 'clean'])
    if (clean.json.hasCredentials !== false) failures.push('credential-free remote wrongly flagged')
    if (clean.json.safeUrl !== 'https://example.com/o/r.git') failures.push(`credential-free safeUrl wrong: ${clean.json.safeUrl}`)

    // --url direct mode, ssh password
    const sshpw = run(['--url', 'ssh://user:SSHPASS9@host/o/r.git'])
    if (sshpw.json.hasCredentials !== true || sshpw.json.safeUrl !== '' || /SSHPASS9/.test(sshpw.stdout)) failures.push(`ssh password not handled/leaked: ${sshpw.stdout}`)

    // missing remote -> resolved:false, exit 3, no leak
    const missing = run(['--repo', repo, '--remote', 'nope'])
    if (missing.status !== 3 || (missing.json && missing.json.resolved !== false)) failures.push(`missing remote not handled: status=${missing.status}`)

    // usage error
    const usage = run([])
    if (usage.status !== 2) failures.push(`no args should exit 2, got ${usage.status}`)
  } catch (e) {
    failures.push(`inspect-remote test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runInspectRemoteTests()
  if (failures.length) {
    console.error('INSPECT-REMOTE TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('INSPECT-REMOTE TESTS PASSED')
}
