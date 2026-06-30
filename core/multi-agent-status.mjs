// Deterministic multi-agent gate for the Codex adapter.
//
// This is pure data validation. It does not spawn agents or trust prose claims; it only decides whether
// recorded execution evidence is sufficient for the delivery gate to continue.

const DEFAULT_REQUIRED_STAGES = ['analysis', 'implementation', 'review', 'verification']

function normalizeStage(stage) {
  return String(stage || '').trim().toLowerCase()
}

function stageComplete(roles, stage) {
  return roles.some(role => normalizeStage(role.stage) === stage &&
    role.spawned === true &&
    role.completed === true &&
    role.resultValidated === true &&
    role.unverified !== true)
}

function stageRole(roles, stage) {
  return roles.find(role => normalizeStage(role.stage) === stage &&
    role.spawned === true &&
    role.completed === true &&
    role.resultValidated === true &&
    role.unverified !== true) || null
}

function knownThreadId(role) {
  if (!role) return null
  const id = role.threadId ?? role.runtimeThreadId ?? role.executionId ?? null
  return id === undefined ? null : id
}

function sameKnownThread(a, b) {
  const aId = knownThreadId(a)
  const bId = knownThreadId(b)
  return aId !== null && bId !== null && String(aId) === String(bId)
}

export function computeMultiAgentGate(input) {
  const i = input || {}
  const m = i.multiAgent || {}
  const reasons = []
  const requiredStages = Array.isArray(m.requiredStages) && m.requiredStages.length
    ? m.requiredStages.map(normalizeStage)
    : DEFAULT_REQUIRED_STAGES

  if (m.required !== true) {
    if (!i.multiAgent && i.requireMultiAgent !== true) return { ok: true, finalStatus: null, reasons: [], reasonCode: null }
    reasons.push('multiAgent.required 不是 true，不能视为多 Agent Workflow 交付。')
    return { ok: false, finalStatus: 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION', reasons, reasonCode: 'MULTI_AGENT_NOT_REQUIRED' }
  }

  if (m.fallbackUsed === true) {
    reasons.push('检测到单 Agent 降级 fallbackUsed=true。')
    return { ok: false, finalStatus: 'BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION', reasons, reasonCode: 'SINGLE_AGENT_FALLBACK_USED' }
  }

  if (m.parentAgentImplemented === true || m.parentAgentImplementedBeforeImplementerSpawn === true) {
    reasons.push('主线程在真实 Implementer Subagent 完成前修改了项目代码。')
    return { ok: false, finalStatus: 'BLOCKED_MULTI_AGENT_CONTRACT_VIOLATION', reasons, reasonCode: 'PARENT_AGENT_IMPLEMENTED_BEFORE_IMPLEMENTER_SPAWN' }
  }

  if (m.parentAgentRanTestsWithoutVerifier === true) {
    reasons.push('主线程运行了实现阶段测试，但缺少独立 Verifier 证据。')
    return { ok: false, finalStatus: 'BLOCKED_MISSING_INDEPENDENT_VERIFIER', reasons, reasonCode: 'MISSING_INDEPENDENT_VERIFIER' }
  }

  if (m.preflightPassed !== true || m.spawnSupported === false || m.agentsDiscoverable === false || m.unavailable === true) {
    reasons.push('MULTI_AGENT_PREFLIGHT 未通过，或 Codex Subagent 不可用/不可发现。')
    return { ok: false, finalStatus: 'BLOCKED_MULTI_AGENT_UNAVAILABLE', reasons, reasonCode: 'MULTI_AGENT_PREFLIGHT_FAILED' }
  }

  if (m.executed !== true) {
    reasons.push('multiAgent.executed 不是 true，缺少真实 Subagent 执行记录。')
    return { ok: false, finalStatus: 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION', reasons, reasonCode: 'INCOMPLETE_MULTI_AGENT_EXECUTION' }
  }

  const roles = Array.isArray(m.roles) ? m.roles : []
  if (roles.some(role => role && role.unverified === true)) {
    reasons.push('存在 unverified=true 的必需 Agent 执行记录，不能伪造成成功。')
    return { ok: false, finalStatus: 'BLOCKED_MULTI_AGENT_UNAVAILABLE', reasons, reasonCode: 'UNVERIFIED_AGENT_EXECUTION' }
  }

  const missing = requiredStages.filter(stage => !stageComplete(roles, stage))
  if (missing.includes('verification') && !missing.includes('implementation') && !missing.includes('review')) {
    reasons.push('缺少独立 Verifier Subagent 完成且结果已校验的证据。')
    return { ok: false, finalStatus: 'BLOCKED_MISSING_INDEPENDENT_VERIFIER', reasons, reasonCode: 'MISSING_INDEPENDENT_VERIFIER' }
  }
  if (missing.includes('review') && !missing.includes('implementation')) {
    reasons.push('缺少独立 Reviewer Subagent 完成且结果已校验的证据。')
    return { ok: false, finalStatus: 'BLOCKED_MISSING_INDEPENDENT_REVIEWER', reasons, reasonCode: 'MISSING_INDEPENDENT_REVIEWER' }
  }
  if (missing.length) {
    reasons.push(`多 Agent 执行链不完整，缺少阶段：${missing.join(', ')}。`)
    return { ok: false, finalStatus: 'BLOCKED_INCOMPLETE_MULTI_AGENT_EXECUTION', reasons, reasonCode: 'INCOMPLETE_MULTI_AGENT_EXECUTION' }
  }

  const implementer = stageRole(roles, 'implementation')
  const reviewer = stageRole(roles, 'review')
  const verifier = stageRole(roles, 'verification')
  if (sameKnownThread(implementer, reviewer)) {
    reasons.push('Implementer 与 Reviewer 使用了同一个已知线程，缺少独立审查。')
    return { ok: false, finalStatus: 'BLOCKED_MISSING_INDEPENDENT_REVIEWER', reasons, reasonCode: 'MISSING_INDEPENDENT_REVIEWER' }
  }
  if (sameKnownThread(implementer, verifier) || sameKnownThread(reviewer, verifier)) {
    reasons.push('Verifier 与其他语义阶段使用了同一个已知线程，缺少独立验证。')
    return { ok: false, finalStatus: 'BLOCKED_MISSING_INDEPENDENT_VERIFIER', reasons, reasonCode: 'MISSING_INDEPENDENT_VERIFIER' }
  }

  return { ok: true, finalStatus: null, reasons: [], reasonCode: null }
}
