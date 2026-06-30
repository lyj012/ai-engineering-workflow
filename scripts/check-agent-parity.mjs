import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mapPath = path.join(root, 'codex/agent-role-map.json')
const generatedDir = path.join(root, 'codex/agents')

function runNode(args, cwd = root) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', shell: false })
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8')
}

function main() {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
  const errors = []
  if (map.namespace !== 'aiew_') errors.push('agent namespace must be aiew_')
  if (map.statusOnUnavailable !== 'BLOCKED_MULTI_AGENT_UNAVAILABLE') errors.push('missing unavailable status')
  if (map.statusOnContractViolation !== 'BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION') errors.push('missing contract violation status')
  if (map.statusOnIncompleteExecution !== 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION') errors.push('missing incomplete execution status')
  if (map.statusOnMissingIndependentReviewer !== 'BLOCKED_MISSING_INDEPENDENT_REVIEWER') errors.push('missing missing-reviewer status')
  if (map.statusOnMissingIndependentVerifier !== 'BLOCKED_MISSING_INDEPENDENT_VERIFIER') errors.push('missing missing-verifier status')

  const names = new Set()
  for (const role of map.roles || []) {
    if (!role.semantic) continue
    if (!role.codexAgent || !role.codexAgent.startsWith(map.namespace)) errors.push(`role ${role.id} has invalid codexAgent`)
    if (names.has(role.codexAgent)) errors.push(`duplicate codexAgent ${role.codexAgent}`)
    names.add(role.codexAgent)
    if (!role.independentThreadRequired) errors.push(`semantic role ${role.id} must require an independent thread`)
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(role.sandboxMode)) errors.push(`role ${role.id} has invalid sandboxMode`)
    if (!role.source || !fs.existsSync(path.join(root, role.source.path))) errors.push(`role ${role.id} source missing: ${role.source && role.source.path}`)
    const toml = path.join(generatedDir, `${role.codexAgent}.toml`)
    if (!fs.existsSync(toml)) errors.push(`missing generated Codex agent ${path.relative(root, toml)}`)
    else {
      const txt = fs.readFileSync(toml, 'utf8')
      for (const needle of [`name = "${role.codexAgent}"`, 'description = ', 'developer_instructions = ', role.source.path]) {
        if (!txt.includes(needle)) errors.push(`${path.relative(root, toml)} missing ${needle}`)
      }
      for (const needle of ['execution_context', 'workflowRoot', 'Do not infer, search for, or guess the workflow root']) {
        if (!txt.includes(needle)) errors.push(`${path.relative(root, toml)} missing execution context contract: ${needle}`)
      }
      if (/C:\\Users\\lenovo|D:\\JavaWeb/.test(txt)) errors.push(`${path.relative(root, toml)} contains machine absolute path`)
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiew-agents-'))
  try {
    fs.cpSync(root, tmp, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`),
    })
    const gen = runNode(['scripts/generate-codex-agents.mjs'], tmp)
    if (gen.status !== 0) errors.push(`generator failed in temp copy: ${gen.stderr || gen.stdout}`)
    for (const role of map.roles || []) {
      if (!role.semantic) continue
      const rel = `codex/agents/${role.codexAgent}.toml`
      const expected = fs.readFileSync(path.join(tmp, rel), 'utf8')
      const actual = read(rel)
      if (actual !== expected) errors.push(`${rel} is stale; run node scripts/generate-codex-agents.mjs`)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  const skill = read('.agents/skills/ai-engineering-workflow/SKILL.md')
  for (const needle of [
    'real Codex subagent threads',
    'Spawn the mapped Codex custom agent',
    'Wait for that agent to complete',
    'BLOCKED_MULTI_AGENT_UNAVAILABLE',
    'BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION',
    'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION',
    'BLOCKED_MISSING_INDEPENDENT_VERIFIER',
    'agent-execution.json',
    'execution_context',
    'execution-context.mjs',
    'fallbackUsed',
  ]) {
    if (!skill.includes(needle)) errors.push(`SKILL.md missing multi-agent contract phrase: ${needle}`)
  }

  const installer = read('scripts/install-codex-skill.ps1')
  if (!installer.includes('.codex\\agents')) errors.push('installer must install Codex agents under ~/.codex/agents')
  if (!installer.includes('aiew_*.toml')) errors.push('installer must limit overwrites to aiew_*.toml')

  if (errors.length) {
    for (const e of errors) fail(`- ${e}`)
    process.exit(1)
  }
  console.log(`AGENT PARITY PASSED (${names.size} agents)`)
}

main()
