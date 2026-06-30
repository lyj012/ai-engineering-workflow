// Unit tests for the deterministic Codex multi-agent gate.
// Run directly: node scripts/multi-agent-status.test.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeMultiAgentGate } from '../core/multi-agent-status.mjs'

const complete = {
  multiAgent: {
    required: true,
    requiredStages: ['analysis', 'test-materialization', 'implementation', 'review', 'verification'],
    preflightPassed: true,
    executed: true,
    fallbackUsed: false,
    parentAgentImplemented: false,
    roles: [
      { stage: 'analysis', role: 'repo_analyst', codexAgent: 'aiew_repo_analyst', spawned: true, completed: true, resultValidated: true, threadId: 'analysis-1' },
      { stage: 'test-materialization', role: 'test_materializer', codexAgent: 'aiew_test_materializer', spawned: true, completed: true, resultValidated: true, threadId: 'tests-1' },
      { stage: 'implementation', role: 'implementer', codexAgent: 'aiew_implementer', spawned: true, completed: true, resultValidated: true, threadId: 'implement-1' },
      { stage: 'review', role: 'independent_reviewer', codexAgent: 'aiew_independent_reviewer', spawned: true, completed: true, resultValidated: true, threadId: 'review-1' },
      { stage: 'verification', role: 'delivery_verifier', codexAgent: 'aiew_delivery_verifier', spawned: true, completed: true, resultValidated: true, threadId: 'verify-1' },
    ],
    workspaceBaseline: {
      preExistingUntracked: [],
      preflightStatusShort: '',
      head: 'abc123',
    },
  },
}

export const CASES = [
  ['correct chain -> ok', complete, null],
  ['required codex mode with no multiAgent -> incomplete', { requireMultiAgent: true }, 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION'],
  ['required false cannot deliver in forced mode', { multiAgent: { ...complete.multiAgent, required: false }, requireMultiAgent: true }, 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION'],
  ['parent implemented then reviewer -> contract violation', {
    multiAgent: {
      ...complete.multiAgent,
      parentAgentImplemented: true,
      parentAgentImplementedBeforeImplementerSpawn: true,
      roles: [
        { stage: 'review', role: 'independent_reviewer', codexAgent: 'aiew_independent_reviewer', spawned: true, completed: true, resultValidated: true, threadId: 'review-only' },
      ],
    },
  }, 'BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION'],
  ['only reviewer -> incomplete', {
    multiAgent: {
      ...complete.multiAgent,
      roles: [
        { stage: 'review', role: 'independent_reviewer', codexAgent: 'aiew_independent_reviewer', spawned: true, completed: true, resultValidated: true, threadId: 'review-only' },
      ],
    },
  }, 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION'],
  ['missing verifier -> missing verifier', {
    multiAgent: {
      ...complete.multiAgent,
      roles: complete.multiAgent.roles.filter(role => role.stage !== 'verification'),
    },
  }, 'BLOCKED_MISSING_INDEPENDENT_VERIFIER'],
  ['missing required test materializer -> incomplete', {
    multiAgent: {
      ...complete.multiAgent,
      roles: complete.multiAgent.roles.filter(role => role.stage !== 'test-materialization'),
    },
  }, 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION'],
  ['agent unavailable -> unavailable', {
    multiAgent: { ...complete.multiAgent, preflightPassed: false, spawnSupported: false },
  }, 'BLOCKED_MULTI_AGENT_UNAVAILABLE'],
  ['dirty baseline not parent violation -> ok', {
    multiAgent: {
      ...complete.multiAgent,
      parentAgentImplemented: false,
      workspaceBaseline: {
        preExistingUntracked: ['scratch.txt'],
        preflightStatusShort: '?? scratch.txt',
        head: 'abc123',
      },
    },
  }, null],
]

export function runMultiAgentStatusTests() {
  const failures = []
  for (const [name, input, expectedStatus] of CASES) {
    let got
    try {
      const result = computeMultiAgentGate(input)
      got = result.ok ? null : result.finalStatus
    } catch (e) {
      got = `threw: ${e.message}`
    }
    if (got !== expectedStatus) failures.push(`multi-agent-status "${name}": expected ${expectedStatus}, got ${got}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runMultiAgentStatusTests()
  if (failures.length) {
    console.error('MULTI-AGENT STATUS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`MULTI-AGENT STATUS TESTS PASSED (${CASES.length} cases)`)
}
