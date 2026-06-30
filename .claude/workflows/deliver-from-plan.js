// deliver-from-plan —— 方案 → 编码到测试全绿（桥接：plan-from-requirement 的产物 → 朱立明写码闭环）
//
// 定位：消费 plan-from-requirement 已落盘的方案目录，在【沙箱副本】里把代码写到测试全绿，产出 diff 交人工审。
//   绝不修改原仓库、绝不 commit/push/merge。设计真相源见 docs/12-plan-to-coding-bridge.md。
//   "写码闭环"的流程真相源是 vendor/zhuliming-templates/（已署名授权），本脚本只编排、不内联流程细节。
//
// 运行：
//   Workflow({ scriptPath: ".../.claude/workflows/deliver-from-plan.js", args: {
//     planDir: "<上游方案目录，必填，须 readinessForDev=ready>",
//     targetRepo: "<要落地的真实仓库；省略则取方案 manifest.target>",
//     outDir: "<落盘根目录>",                 // 缺省 "evidence/deliveries"
//     mode: "lite|standard|deep",            // 可省→按方案复杂度/风险自动选档（缩复审视角/effort/返工轮，验证锚点不缩）
//     vendorDir: "vendor/zhuliming-templates",
//     bridgeDoc: "docs/12-plan-to-coding-bridge.md",
//     maxImplRounds: 3, maxFixRounds: 2
//   }})
// 运行时事实：args 到脚本是 JSON 字符串需 parse；脚本体无文件系统访问，一切 IO 经子代理。

export const meta = {
  name: 'deliver-from-plan',
  description: '桥接：plan-from-requirement 的方案 → 在沙箱副本里把代码写到测试全绿 → 出 diff（不改原仓库/不提交）。就绪闸门→脚手架→测试物化(先红后绿)→编码→独立审查→独立修复→独立验证(含从 test-plan 重物化复测防改测试迁就)→交付。流程真相源为 docs/12 与 vendor/zhuliming-templates。',
  whenToUse: '已有一份 readinessForDev=ready 的实现方案，想把它真正实现并跑到测试全绿、产出可审查的 diff，但不希望自动提交或改动原仓库时',
  phases: [
    { title: 'Preflight', detail: '读方案 manifest，确定性就绪闸门（ready 才放行）' },
    { title: 'Scaffold', detail: '复制 targetRepo 到沙箱；建 task 目录；据模板+方案生成 coding-workflow.md 与 todo' },
    { title: 'MaterializeTests', detail: '把 test-plan 物化成可运行 tests/+DONE；先红后绿核验 DONE 可信' },
    { title: 'Implement', detail: '沙箱内按方案写码到 DONE 全绿（只改 SCOPE 内文件，越界/红线即停）' },
    { title: 'Review', detail: '独立多视角并行审查（实现者不自评）；Fix 后由全新实例重新复审' },
    { title: 'Fix', detail: '仅当 needs-work：由独立修复角色按意见最小修复并重验 DONE 仍绿（禁改测试）' },
    { title: 'Verify', detail: '独立子代理复跑 DONE + 从 test-plan 重物化独立复测 + 核对 diff 仅动 SCOPE（不信实现者自报、防改测试迁就）' },
    { title: 'BrowserVerify', detail: '仅 web 项目：独立角色判类型→探浏览器能力→起项目→真实交互/控制台/接口/截图→四态（失败=阻断、无能力=如实跳过不伪造）' },
    { title: 'Deliver', detail: '出 diff/报告/manifest 落盘到带时间戳目录' },
  ],
}

// ===================== 参数（args 为 JSON 字符串，先 parse）=====================
const A = (() => {
  let a = args
  if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } }
  return (a && typeof a === 'object') ? a : {}
})()
const planDir = A.planDir ? String(A.planDir) : null
const targetRepoArg = A.targetRepo ? String(A.targetRepo) : null
const outDirBase = A.outDir ? String(A.outDir) : 'evidence/deliveries'
const vendorDir = A.vendorDir ? String(A.vendorDir) : 'vendor/zhuliming-templates'
const bridgeDoc = A.bridgeDoc ? String(A.bridgeDoc) : 'docs/12-plan-to-coding-bridge.md'
// 共享确定性脚本目录（相对本工作流仓库根解析，同 vendorDir/bridgeDoc 约定）。测试指纹/复测运行/diff 生成统一走 bin/ 脚本，
// 不再让子代理各写一套自然语言口径——把这些机械操作收敛成与 Codex 适配器同一份、可单测、self-check 注册的确定性脚本。
const binDir = A.binDir ? String(A.binDir) : 'bin'
const allowStalePlan = !!A.allowStalePlan   // true 时即便目标仓库自方案生成后变更也放行（#5 stale-plan 闸门）
// 有界循环兜底轮数（防无限循环）：Implement 最多 MAX_IMPL 轮、Review↔Fix 最多 MAX_FIX 轮
const MAX_IMPL = (Number.isFinite(Number(A.maxImplRounds)) && Number(A.maxImplRounds) > 0) ? Number(A.maxImplRounds) : 3
const argMaxFix = (Number.isFinite(Number(A.maxFixRounds)) && Number(A.maxFixRounds) >= 0) ? Number(A.maxFixRounds) : null
// L1 模型分层：仅 schema 结构化返回的机械 agent（如项目类型探测）用轻模型省成本；推理/验证/安全 agent（实现/复审/独立验证/diff/scaffold 去敏等）一律留默认强模型。
// **落盘 agent 不降级**：deliver-persist 逐字写 delivery-manifest 等大 JSON，实测 haiku 会漏转义→不可解析，须留强模型保真。可经 args.lightModel 覆盖。
const LIGHT_MODEL = ['haiku', 'sonnet', 'opus', 'fable'].includes(String(A.lightModel)) ? String(A.lightModel) : 'haiku'
// 分档（建议1·治"不成比例"）：按方案复杂度/风险自动选档（args.mode 可覆盖），只缩减"仪式"——复审视角数 / impl·review
// effort / 返工轮；验证锚点 MaterializeTests 与独立 Verify 恒 high、不随档位下调（缩仪式不缩安全）。
const userMode = ['lite', 'standard', 'deep'].includes(String(A.mode || '').toLowerCase()) ? String(A.mode).toLowerCase() : null
const MODE_CFG = {
  lite:     { lenses: ['correctness', 'scope-conformance'], implEffort: 'medium', reviewEffort: 'medium', maxFix: 1 },
  standard: { lenses: ['correctness', 'robustness', 'scope-conformance', 'risk-coverage', 'readability', 'maintainability'], implEffort: 'high', reviewEffort: 'high', maxFix: 2 },
  deep:     { lenses: ['correctness', 'robustness', 'scope-conformance', 'risk-coverage', 'readability', 'maintainability', 'code-style', 'project-convention'], implEffort: 'high', reviewEffort: 'high', maxFix: 2 },
}
let mode = 'standard', CFG = MODE_CFG.standard, MAX_FIX = argMaxFix !== null ? argMaxFix : 2

const AT = 'general-purpose'   // 全工具内置 agentType（需 Read/Bash/Write/Edit），任意目录可跑

// ===================== 执行辅助 =====================
const execLog = []
function note(m) { execLog.push(m); log(m) }
async function callAgent(prompt, opts, required) {
  const attempts = required ? 2 : 1
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await agent(prompt, opts)
      if (r !== null && r !== undefined) return { ok: true, value: r }
      lastErr = 'agent 返回 null（跳过/终态失败）'
    } catch (e) { lastErr = String((e && e.message) || e).slice(0, 200) }
    if (i < attempts - 1) note(`  · ${opts.label} 第 ${i + 1} 次失败：${lastErr} → 重试`)
  }
  return { ok: false, error: lastErr }
}
function halt(stage, reason, status) { const e = new Error(`HALT@${stage}: ${reason}`); e.__halt = { stage, reason, status: status || 'FAILED' }; throw e }

// >>> DELIVER-STATUS-START — 与 core/deliver-status.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/deliver-status.test.mjs）；勿删本标记与 END 标记
// 确定性终态判定：BLOCKED 短路；唯有"全程干净 + diff 已落盘且 apply-check 通过且有变更文件"才给乐观态（#1/#2）
const DEFAULT_MULTI_AGENT_STAGES = ['analysis', 'implementation', 'review', 'verification']
function normalizeMultiAgentStage(stage) {
  return String(stage || '').trim().toLowerCase()
}
function multiAgentStageComplete(roles, stage) {
  return roles.some(role => normalizeMultiAgentStage(role.stage) === stage &&
    role.spawned === true &&
    role.completed === true &&
    role.resultValidated === true &&
    role.unverified !== true)
}
function multiAgentStageRole(roles, stage) {
  return roles.find(role => normalizeMultiAgentStage(role.stage) === stage &&
    role.spawned === true &&
    role.completed === true &&
    role.resultValidated === true &&
    role.unverified !== true) || null
}
function knownMultiAgentThreadId(role) {
  if (!role) return null
  const id = role.threadId ?? role.runtimeThreadId ?? role.executionId ?? null
  return id === undefined ? null : id
}
function sameKnownMultiAgentThread(a, b) {
  const aId = knownMultiAgentThreadId(a)
  const bId = knownMultiAgentThreadId(b)
  return aId !== null && bId !== null && String(aId) === String(bId)
}
function computeMultiAgentGate(input) {
  const i = input || {}
  const m = i.multiAgent || {}
  const reasons = []
  const requiredStages = Array.isArray(m.requiredStages) && m.requiredStages.length
    ? m.requiredStages.map(normalizeMultiAgentStage)
    : DEFAULT_MULTI_AGENT_STAGES
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
  const missing = requiredStages.filter(stage => !multiAgentStageComplete(roles, stage))
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
  const implementer = multiAgentStageRole(roles, 'implementation')
  const reviewer = multiAgentStageRole(roles, 'review')
  const verifier = multiAgentStageRole(roles, 'verification')
  if (sameKnownMultiAgentThread(implementer, reviewer)) {
    reasons.push('Implementer 与 Reviewer 使用了同一个已知线程，缺少独立审查。')
    return { ok: false, finalStatus: 'BLOCKED_MISSING_INDEPENDENT_REVIEWER', reasons, reasonCode: 'MISSING_INDEPENDENT_REVIEWER' }
  }
  if (sameKnownMultiAgentThread(implementer, verifier) || sameKnownMultiAgentThread(reviewer, verifier)) {
    reasons.push('Verifier 与其他语义阶段使用了同一个已知线程，缺少独立验证。')
    return { ok: false, finalStatus: 'BLOCKED_MISSING_INDEPENDENT_VERIFIER', reasons, reasonCode: 'MISSING_INDEPENDENT_VERIFIER' }
  }
  return { ok: true, finalStatus: null, reasons: [], reasonCode: null }
}
function computeDeliverStatus(input) {
  const i = input || {}
  const reasons = []
  if (i.priorStatus === 'BLOCKED') return { finalStatus: 'BLOCKED', reasons }
  const multiAgentGate = computeMultiAgentGate(i)
  if (!multiAgentGate.ok) return multiAgentGate

  const reviews = Array.isArray(i.reviews) ? i.reviews : []
  const verify = i.verify || null
  const verifiedGreen = !!(verify && verify.donePassedVerified === true && verify.scopeCleanVerified === true)
  const blockingReview = reviews.some(r => r && r.verdict === 'needs-work' && r.blocking)
  const redGreenUnconfirmed = !!(verify && verify.redGreenVerified === false)
  if (redGreenUnconfirmed) reasons.push('独立"先红后绿"未复现：DONE 可信度未被独立确认，降为带开环项交付。')

  const materializeOpenLoopItems = Array.isArray(i.materializeOpenLoopItems) ? i.materializeOpenLoopItems : []
  const gateOpenQuestions = Array.isArray(i.gateOpenQuestions) ? i.gateOpenQuestions : []
  const gateRemainingGaps = Array.isArray(i.gateRemainingGaps) ? i.gateRemainingGaps : []
  // browser verification (web projects only): applicable+failed BLOCKS below; skipped/error or carried open
  // items only downgrade to WITH_OPEN_ITEMS (honest skip, never faked); null / not-applicable = no effect.
  const browser = i.browser || null
  const browserOpenItems = (browser && Array.isArray(browser.openItems)) ? browser.openItems : []
  const browserDeferred = !!(browser && browser.applicable === true && (browser.status === 'skipped' || browser.status === 'error'))
  // 代码质量（全项目）：applicable+compileRan+!compilePassed 阻断（P0）；非编译类静态失败/未验证工具/引入新工具告警走 openItems→带开环；null/不适用=无影响
  const codeQuality = i.codeQuality || null
  const codeQualityOpenItems = (codeQuality && Array.isArray(codeQuality.openItems)) ? codeQuality.openItems : []
  const codeQualityCompileFailed = !!(codeQuality && codeQuality.applicable === true && codeQuality.compileRan === true && codeQuality.compilePassed === false)
  const codeQualityP0 = !!(codeQuality && codeQuality.applicable === true && codeQuality.hasP0Failure === true)
  // P1.4: these three also feed manifest.openItems in the engine, so they must downgrade here too —
  // otherwise finalStatus=DELIVERED with a non-empty openItems list (self-contradictory).
  const testsTampered = !!(verify && verify.testsIntact === false)   // in-tree tests changed since materialize
  const softStale = i.staleSeverity === 'soft'                       // target had uncommitted dirty diff vs plan
  const filesReconcileIssues = Array.isArray(i.filesReconcileIssues) ? i.filesReconcileIssues : []   // Verify/diff/SCOPE 三方对账不一致
  const hasOpenItems = materializeOpenLoopItems.length > 0 ||
    reviews.some(r => r && r.verdict === 'needs-work') ||
    redGreenUnconfirmed ||
    gateOpenQuestions.length > 0 || gateRemainingGaps.length > 0 ||
    browserOpenItems.length > 0 || browserDeferred ||
    codeQualityOpenItems.length > 0 ||
    testsTampered || softStale || filesReconcileIssues.length > 0

  if (!i.implementPassed) { reasons.push('实现未达全绿，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verify) { reasons.push('缺独立验证（Verify 失败），不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verifiedGreen) { reasons.push('独立验证未确认 DONE 真绿 / 只动 SCOPE，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (i.reviewIncomplete) { reasons.push('独立复审视角不齐，不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (blockingReview) { reasons.push('存在阻断性审查意见未关闭。'); return { finalStatus: 'BLOCKED', reasons } }
  if (browser && browser.applicable === true && browser.status === 'failed') { reasons.push('真实浏览器验证失败（web 项目：页面/交互/控制台/接口未通过），不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (codeQualityCompileFailed) { reasons.push('项目编译/构建失败（P0），不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (codeQualityP0) { reasons.push('代码质量检查存在 P0 级静态问题（必阻断），不交付。'); return { finalStatus: 'BLOCKED', reasons } }

  const diff = i.diff || null
  if (!diff || diff.ok !== true) { reasons.push('交付 diff 生成/落盘失败，状态降级 BLOCKED（不以 DELIVERED 收尾）。'); return { finalStatus: 'BLOCKED', reasons } }
  if (diff.diffApplyCheckPassed !== true) { reasons.push('diff 未通过 git apply --check，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!Array.isArray(diff.filesChanged) || diff.filesChanged.length === 0) { reasons.push('交付未产出任何变更文件，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }

  // delivery write is the very last fact: if the manifest/report failed to persist, do not claim DELIVERED
  if (i.deliveryPersisted === false) { reasons.push('交付产物落盘失败（delivery-manifest/报告未成功写入），状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }

  return { finalStatus: hasOpenItems ? 'DELIVERED_WITH_OPEN_ITEMS' : 'DELIVERED', reasons }
}
// <<< DELIVER-STATUS-END

// >>> FINGERPRINT-START — 与 core/repo-fingerprint.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/repo-fingerprint.test.mjs）；勿删本标记与 END 标记
// stale-plan 检测：比对方案生成时与交付时的目标仓库指纹；commit/treeHash 变更=hard（默认拒交付），仅 dirty 变更=soft
function compareRepoFingerprint(planFp, currentFp) {
  if (!planFp || !currentFp) {
    return { comparable: false, severity: 'unknown', stale: false, changed: [], reasons: ['缺少指纹，无法判定 stale（按可继续处理，但已标注）'] }
  }
  const changed = []
  const reasons = []
  let identityComparable = false
  if (planFp.commit && currentFp.commit) {
    identityComparable = true
    if (planFp.commit !== currentFp.commit) { changed.push('commit'); reasons.push(`commit 变更：方案基于 ${planFp.commit}，当前 ${currentFp.commit}`) }
  } else if (planFp.treeHash && currentFp.treeHash) {
    identityComparable = true
    if (planFp.treeHash !== currentFp.treeHash) { changed.push('treeHash'); reasons.push('文件树内容哈希变更') }
  }
  if ((planFp.dirtyDiffHash || '') !== (currentFp.dirtyDiffHash || '')) { changed.push('dirtyDiff'); reasons.push('未提交改动(dirty diff)与方案生成时不一致') }
  const hard = changed.includes('commit') || changed.includes('treeHash')
  const soft = !hard && changed.length > 0
  const severity = hard ? 'hard' : soft ? 'soft' : (identityComparable ? 'none' : 'unknown')
  if (!identityComparable) reasons.push('两侧均缺 commit/treeHash，身份不可比（仅比对了 dirty）')
  return { comparable: identityComparable, severity, stale: hard || soft, changed, reasons }
}
// <<< FINGERPRINT-END

// >>> CHANGED-FILES-START — 与 core/changed-files.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/changed-files.test.mjs）；勿删本标记与 END 标记
// 三方对账：独立 Verify 文件列表 / diff 文件列表 / SCOPE，不一致即列为遗留项
function reconcileChangedFiles(input) {
  const i = input || {}
  const verified = Array.isArray(i.verifiedFiles) ? i.verifiedFiles : []
  const diff = Array.isArray(i.diffFiles) ? i.diffFiles : []
  const scope = new Set([...(Array.isArray(i.scopeFiles) ? i.scopeFiles : []), ...(Array.isArray(i.optionalScopeFiles) ? i.optionalScopeFiles : [])])
  const issues = []
  const vSet = new Set(verified), dSet = new Set(diff)
  if (verified.length && diff.length) {
    const onlyVerify = verified.filter(f => !dSet.has(f))
    const onlyDiff = diff.filter(f => !vSet.has(f))
    if (onlyVerify.length || onlyDiff.length) {
      issues.push(`Verify 与 Diff 变更文件不一致：仅Verify[${onlyVerify.join(', ') || '无'}] 仅Diff[${onlyDiff.join(', ') || '无'}]`)
    }
  }
  if (scope.size && diff.length) {
    const outOfScope = diff.filter(f => !scope.has(f))
    if (outOfScope.length) issues.push(`Diff 超出 SCOPE：${outOfScope.join(', ')}`)
  }
  return { consistent: issues.length === 0, issues }
}
// <<< CHANGED-FILES-END

// >>> PROJECT-TYPE-START — 与 core/project-type.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/project-type.test.mjs）；勿删本标记与 END 标记
// 确定性项目类型判定：从客观仓库信号判 web/fullstack/non-web/unknown，决定该交付是否需要真实浏览器验证
const PT_FRONTEND = ['react', 'react-dom', 'vue', 'svelte', '@sveltejs/kit', '@angular/core', 'solid-js', 'preact', 'astro', 'next', 'nuxt', 'remix', '@remix-run/react', 'gatsby', 'vite', 'webpack', 'parcel', '@vitejs/plugin-react']
const PT_SERVER = ['express', 'koa', 'fastify', '@nestjs/core', 'hapi', '@hapi/hapi', 'next', 'nuxt', 'remix', '@remix-run/node', 'gatsby']
const PT_FULLSTACK = ['next', 'nuxt', 'remix', '@remix-run/react', '@remix-run/node', 'gatsby', '@sveltejs/kit']
const PT_PORT_GUESS = [['next', 3000], ['nuxt', 3000], ['gatsby', 8000], ['vite', 5173], ['@vitejs/plugin-react', 5173], ['react-scripts', 3000], ['@sveltejs/kit', 5173], ['astro', 4321]]
function classifyProjectType(input) {
  const i = input || {}
  const deps = (Array.isArray(i.deps) ? i.deps : []).map(d => String(d).toLowerCase())
  const scripts = (i.scripts && typeof i.scripts === 'object') ? i.scripts : {}
  const depSet = new Set(deps)
  const signals = []
  const matched = list => list.filter(x => depSet.has(x))
  const frontendHits = matched(PT_FRONTEND)
  const serverHits = matched(PT_SERVER)
  const fullstackHits = matched(PT_FULLSTACK)
  if (frontendHits.length) signals.push('frontend deps: ' + frontendHits.join(', '))
  if (serverHits.length) signals.push('server deps: ' + serverHits.join(', '))
  if (i.hasIndexHtml) signals.push('index.html present')
  if (i.hasServerEntry) signals.push('server entry present')
  const hasFrontend = frontendHits.length > 0 || !!i.hasIndexHtml
  const hasServer = serverHits.length > 0 || !!i.hasServerEntry
  const hasFullstackFramework = fullstackHits.length > 0
  let startCommand = null
  if (scripts.dev) startCommand = 'npm run dev'
  else if (scripts.start) startCommand = 'npm start'
  else if (scripts.serve) startCommand = 'npm run serve'
  if (startCommand) signals.push('start via "' + startCommand + '"')
  let baseUrlGuess = null
  for (const [name, port] of PT_PORT_GUESS) {
    if (depSet.has(name)) { baseUrlGuess = 'http://localhost:' + port; break }
  }
  let type
  if (!i.hasPackageJson && !i.hasIndexHtml) {
    type = 'non-web'
  } else if (hasFullstackFramework || (hasFrontend && hasServer)) {
    type = 'fullstack'
  } else if (hasFrontend) {
    type = 'web'
  } else if (i.hasPackageJson) {
    type = hasServer ? 'non-web' : 'unknown'
  } else {
    type = 'unknown'
  }
  const isWeb = type === 'web' || type === 'fullstack'
  return { type, isWeb, signals, startCommand: isWeb ? startCommand : null, baseUrlGuess: isWeb ? baseUrlGuess : null }
}
// <<< PROJECT-TYPE-END

const SAFETY = `【硬安全约束】(1) 只在沙箱目录内写文件，绝不修改原仓库 ${targetRepoArg || '(方案目标仓库)'} 之外或之内的任何原始文件；(2) 绝不执行 git commit/push/merge/reset、绝不删库删表、绝不执行真实的支付/权限变更/认证/删库/迁移等不可逆危险操作、绝不读写真实密钥——命中即停并在结构化结果里报告（此处指"执行真实副作用"：按 SCOPE 在沙箱内编写支付/权限/认证等领域的功能代码本身是允许的，高风险域的发布把关由 publish 阶段人工闸门负责）；(3) 只改方案 SCOPE(plan.affected.files)内的文件，越界即停。中文输出，只返回结构化结果。`

// ===================== Schemas =====================
const FINGERPRINT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  commit: { type: 'string' }, treeHash: { type: 'string' }, dirty: { type: 'boolean' }, dirtyDiffHash: { type: 'string' },
}, required: ['commit', 'treeHash', 'dirty', 'dirtyDiffHash'] }
const GATE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  finalStatus: { type: 'string' }, readinessForDev: { type: 'string' },
  requirementGoal: { type: 'string' }, manifestTarget: { type: 'string' },
  affectedFiles: { type: 'array', items: { type: 'string' } },
  remainingGaps: { type: 'array', items: { type: 'string' } },
  openQuestions: { type: 'array', items: { type: 'string' } },
  complexity: { type: 'string', description: 'manifest.triage.complexity（simple/medium/complex），无则填 medium' },
  riskFlags: { type: 'array', items: { type: 'string' }, description: 'manifest.triage.riskFlags，无则 ["none"]' },
  planFingerprint: FINGERPRINT_SCHEMA, currentFingerprint: FINGERPRINT_SCHEMA,
  targetReadable: { type: 'boolean' }, note: { type: 'string' },
}, required: ['finalStatus', 'readinessForDev', 'requirementGoal', 'manifestTarget', 'affectedFiles', 'remainingGaps', 'openQuestions', 'complexity', 'riskFlags', 'planFingerprint', 'currentFingerprint', 'targetReadable', 'note'] }

const SCAFFOLD_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, runDir: { type: 'string' }, sandboxDir: { type: 'string' },
  taskDir: { type: 'string' }, codingWorkflowPath: { type: 'string' },
  scopeFiles: { type: 'array', items: { type: 'string' }, description: '相对仓库根的 SCOPE 文件路径' },
  optionalScopeFiles: { type: 'array', items: { type: 'string' } },
  todoUnits: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'runDir', 'sandboxDir', 'taskDir', 'codingWorkflowPath', 'scopeFiles', 'optionalScopeFiles', 'todoUnits', 'note'] }

const MATERIALIZE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, doneCommand: { type: 'string' }, testsDir: { type: 'string' },
  testsFingerprint: { type: 'string', description: 'materialize 后冻结：tests/ 全部测试源文件的合并 sha256（前16位），供 Verify 比对实现/修复阶段是否篡改了测试' },
  redCommand: { type: 'string', description: 'DONE 的 --red 模式：只跑【新功能测试】（未实现时应红）；供 Implement 自检与 Verify 独立复现' },
  regressionCommand: { type: 'string', description: 'DONE 的 --regression 模式：只跑【回归测试】（任何版本都应绿）' },
  newFeatureTestsFailOnCurrent: { type: 'boolean', description: '新功能测试在【未实现的当前沙箱】上是否如预期 FAIL（红）' },
  regressionTestsPassOnCurrent: { type: 'boolean', description: '回归/既有行为测试在当前沙箱上是否如预期 PASS（绿）' },
  redExitCode: { type: 'number' }, autoVerifiableCount: { type: 'number' },
  openLoopItems: { type: 'array', items: { type: 'string' }, description: '无法自动验、转人工核对的项（如无 pwsh 的 .ps1）' },
  note: { type: 'string' },
}, required: ['ok', 'doneCommand', 'testsFingerprint', 'redCommand', 'regressionCommand', 'testsDir', 'newFeatureTestsFailOnCurrent', 'regressionTestsPassOnCurrent', 'redExitCode', 'autoVerifiableCount', 'openLoopItems', 'note'] }

const IMPLEMENT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  passed: { type: 'boolean', description: 'DONE 命令是否全绿' }, doneExitCode: { type: 'number' },
  filesChanged: { type: 'array', items: { type: 'string' } },
  scopeViolations: { type: 'array', items: { type: 'string' }, description: '改到 SCOPE 外文件的清单（应为空）' },
  redLineHit: { type: 'boolean' }, redLineReason: { type: 'string' },
  summary: { type: 'string' }, progressNote: { type: 'string' },
}, required: ['passed', 'doneExitCode', 'filesChanged', 'scopeViolations', 'redLineHit', 'redLineReason', 'summary', 'progressNote'] }

const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  lens: { type: 'string' }, verdict: { type: 'string', enum: ['ok', 'needs-work'] },
  findings: { type: 'array', items: { type: 'string' } },
  severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'none'], description: '本视角最高问题级别：P0=必须阻断（正确性错误/SCOPE 越界/架构分层破坏等）→blocking 必须为 true；P1=应修但不必阻断→verdict=needs-work 非阻断（计开环）；P2=轻微/建议→不单独阻断（verdict 可 ok，写进 note）；无问题=none' },
  blocking: { type: 'boolean', description: '是否阻断性（severity=P0 时必为 true；correctness/scope 越界等）' }, note: { type: 'string' },
}, required: ['lens', 'verdict', 'findings', 'severity', 'blocking', 'note'] }

const FIX_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  passed: { type: 'boolean', description: '修复后 needs-work 是否清零' }, donePassed: { type: 'boolean', description: '修复后 DONE 是否仍全绿' },
  addressed: { type: 'array', items: { type: 'string' } }, stillOpen: { type: 'array', items: { type: 'string' } },
  filesChanged: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
}, required: ['passed', 'donePassed', 'addressed', 'stillOpen', 'filesChanged', 'summary'] }

const VERIFY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  donePassedVerified: { type: 'boolean', description: '独立复跑最终 DONE 是否真绿（ALL PASSED / exit 0）' },
  doneExitCodeVerified: { type: 'number' },
  redGreenVerified: { type: 'boolean', description: '在未实现版上独立复现"新功能红 + 回归绿"' },
  independentTestsPassed: { type: 'boolean', description: '从 test-plan.json 独立重物化的新功能验收检查（不复用在树 tests/）在沙箱上是否全过——防"改测试迁就实现"的硬闸门' },
  testsIntact: { type: 'boolean', description: '在树 tests/ 测试源指纹是否与物化时冻结的一致（false=疑似实现/修复阶段改动了测试）' },
  changedFilesVerified: { type: 'array', items: { type: 'string' }, description: '实测变更的文件' },
  scopeCleanVerified: { type: 'boolean', description: '实测变更是否只落在 SCOPE 内' },
  note: { type: 'string' },
}, required: ['donePassedVerified', 'doneExitCodeVerified', 'redGreenVerified', 'independentTestsPassed', 'testsIntact', 'changedFilesVerified', 'scopeCleanVerified', 'note'] }

const DIFF_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean', description: '是否成功生成可用 diff（无任何变更文件时为 false）' },
  diffStat: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' }, description: 'target-root-relative 路径' },
  diffApplyCheckPassed: { type: 'boolean' }, note: { type: 'string' },
}, required: ['ok', 'diffStat', 'filesChanged', 'diffApplyCheckPassed', 'note'] }
const DELIVER_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, absOutDir: { type: 'string' }, written: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'absOutDir', 'written', 'note'] }
const DELIVER_READBACK_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  readbackOk: { type: 'boolean', description: 'delivery-manifest.json 真实存在、非空、可 JSON.parse' },
  diskFinalStatus: { type: 'string', description: '磁盘 delivery-manifest.json 顶层 finalStatus 字段值；读不到填空串' },
  contentConsistent: { type: 'boolean', description: '磁盘内容与本阶段提供的 finalStatus/filesChanged/diffApplyCheckPassed 逐一深度一致' },
  note: { type: 'string' },
}, required: ['readbackOk', 'diskFinalStatus', 'contentConsistent', 'note'] }

// BrowserVerify：客观项目信号（供确定性分类器判 web/非web）
const BROWSER_SIGNALS_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  hasPackageJson: { type: 'boolean' },
  deps: { type: 'array', items: { type: 'string' }, description: 'package.json dependencies+devDependencies 的包名' },
  devScript: { type: 'string', description: 'scripts.dev 命令，无则空串' },
  startScript: { type: 'string', description: 'scripts.start 命令，无则空串' },
  serveScript: { type: 'string', description: 'scripts.serve 命令，无则空串' },
  hasIndexHtml: { type: 'boolean', description: '根/public/src 有无 index.html' },
  hasServerEntry: { type: 'boolean', description: '有无 server.js/app.js/app.py/main.go 等 HTTP 服务入口' },
}, required: ['hasPackageJson', 'deps', 'devScript', 'startScript', 'serveScript', 'hasIndexHtml', 'hasServerEntry'] }

// BrowserVerify：独立真实浏览器验证结果（四态 + 完整证据记录）
const BROWSER_VERIFY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  adapterUsed: { type: 'string', description: '实际使用的浏览器能力：playwright-mcp / playwright-cli / codex / none(skipped)' },
  projectStarted: { type: 'boolean' }, startLogTail: { type: 'string' },
  pageOpened: { type: 'boolean' }, baseUrl: { type: 'string' },
  opsExecuted: { type: 'array', items: { type: 'string' }, description: '已执行的关键用户操作（点击/输入/跳转/刷新…）' },
  checks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' },
  }, required: ['name', 'passed', 'detail'] }, description: '表单/按钮/弹窗/跳转/刷新后状态/结果是否符合需求' },
  consoleErrors: { type: 'array', items: { type: 'string' } },
  failedKeyRequests: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    url: { type: 'string' }, status: { type: 'number' },
  }, required: ['url', 'status'] } },
  screenshots: { type: 'array', items: { type: 'string' }, description: '截图文件路径' },
  evidenceDir: { type: 'string' },
  finalBrowserStatus: { type: 'string', enum: ['passed', 'failed', 'skipped-no-capability', 'error'] },
  note: { type: 'string' },
}, required: ['adapterUsed', 'projectStarted', 'startLogTail', 'pageOpened', 'baseUrl', 'opsExecuted', 'checks', 'consoleErrors', 'failedKeyRequests', 'screenshots', 'evidenceDir', 'finalBrowserStatus', 'note'] }

// CodeQuality（S3）：跑项目【既有】静态工具 + 编译/构建，记录真实命令/退出码/输出尾；无工具如实跳过，绝不引新工具或批量改格式
const CODE_QUALITY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  applicable: { type: 'boolean', description: '项目是否有可运行的既有静态工具或编译/构建命令；都没有则 false（→ 如实跳过）' },
  specSource: { type: 'string', description: '本次风格判定依据的优先级实际取值（客户规范 > 项目现有风格 > 阿里 Java[仅当真接入] > 通用最佳实践）；阿里规范当前占位未接入须如实写"阿里规范：未接入（占位）"' },
  language: { type: 'string', description: '主语言，判不出填 unknown' }, buildTool: { type: 'string', description: '构建工具，判不出填 unknown' },
  compileRan: { type: 'boolean', description: '是否真的执行了项目的编译/构建命令' },
  compilePassed: { type: 'boolean', description: '编译/构建是否通过（compileRan=false 时本字段无意义，置 false 并在 note 说明未跑）' },
  compileCommand: { type: 'string' }, compileExitCode: { type: 'number', description: '未跑填 -1' }, compileOutputTail: { type: 'string', description: '真实输出尾（截断），绝不编造' },
  staticChecks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    tool: { type: 'string' }, command: { type: 'string' }, exitCode: { type: 'number' },
    status: { type: 'string', enum: ['passed', 'failed', 'skipped', 'unverified'], description: '能跑且退出码0=passed；能跑但非0=failed；工具在但本环境跑不起来=unverified；本档主动跳过=skipped' },
    severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'unknown'], description: '初判严重度（精细 P0/P1/P2 分级在审查阶段 S4 接管）；编译/构建类=P0' },
    outputTail: { type: 'string', description: '真实输出尾（截断），绝不编造' }, note: { type: 'string' },
  }, required: ['tool', 'command', 'exitCode', 'status', 'severity', 'outputTail', 'note'] }, description: '逐个已运行/跳过的项目既有静态工具' },
  introducedNewTool: { type: 'boolean', description: '是否引入了项目原本没有的格式化/静态工具或做了批量改格式（必须为 false：S3 只跑既有工具、不引新工具、不 --fix/批量改写）' },
  summary: { type: 'string' }, note: { type: 'string', description: '探测/执行过程；无能力时写明依据与剩余风险' },
}, required: ['applicable', 'specSource', 'language', 'buildTool', 'compileRan', 'compilePassed', 'compileCommand', 'compileExitCode', 'compileOutputTail', 'staticChecks', 'introducedNewTool', 'summary', 'note'] }

// ===================== 状态收集 =====================
let finalStatus = 'FAILED'
let gate = null, scaffold = null, materialize = null, implement = null, reviews = [], fix = null, verify = null, deliver = null
let trustworthy = false, reviewIncomplete = false, halted = false, diffResult = null, staleCmp = null, browserResult = null, codeQuality = null
const failedStages = [], fixHistory = []

try {
  if (!planDir) halt('Preflight', 'args.planDir 缺失（必填）')

  // ---- Preflight：读 manifest + 确定性就绪闸门 ----
  phase('Preflight')
  const pf = await callAgent(
    `你是只读分析者。读取方案目录 ${planDir} 下的 run-manifest.json（必要时再看 requirement.json / plan.json）。${SAFETY}\n` +
    `回报：finalStatus、readinessForDev、requirementGoal(需求一句话目标)、manifestTarget(manifest.target 即被分析的目标仓库绝对路径)、affectedFiles(plan.affected.files，原样)、remainingGaps、openQuestions、complexity(manifest.triage.complexity，无则 medium)、riskFlags(manifest.triage.riskFlags，无则 ["none"])、targetReadable(用 Bash 确认 ${targetRepoArg || 'manifestTarget'} 存在且可读)。\n` +
    `另：planFingerprint=manifest.repoFingerprint（原样；无则各字段留空/false）；currentFingerprint=重新计算目标仓库 ${targetRepoArg || 'manifestTarget'} 当前版本指纹（git 则 commit=\`git rev-parse HEAD\`、treeHash=\`git rev-parse HEAD^{tree}\`、dirty=\`git status --porcelain\` 非空、dirtyDiffHash=dirty 时 \`git diff HEAD|sha256sum\` 前16位；非 git 则 treeHash=\`find . -type f -not -path './.git/*' -print0|sort -z|xargs -0 sha256sum 2>/dev/null|sha256sum\` 前16位，其余留空/false）。不要改任何文件。`,
    { schema: GATE_SCHEMA, label: 'preflight-gate', phase: 'Preflight', agentType: AT, effort: 'low' }, true)
  if (!pf.ok) { failedStages.push('Preflight'); halt('Preflight', pf.error) }
  gate = pf.value
  const targetRepo = targetRepoArg || gate.manifestTarget
  const gateOk = ['PASS', 'PARTIAL'].includes(gate.finalStatus) && gate.readinessForDev === 'ready'
  staleCmp = compareRepoFingerprint(gate.planFingerprint, gate.currentFingerprint)
  note(`就绪闸门：finalStatus=${gate.finalStatus}，readinessForDev=${gate.readinessForDev} → ${gateOk ? '放行' : '拦截'}；目标仓库=${targetRepo}（可读=${gate.targetReadable}）；stale=${staleCmp.severity}${staleCmp.changed.length ? '(' + staleCmp.changed.join('/') + ')' : ''}`)
  if (!gateOk) { finalStatus = 'BLOCKED'; note('方案未就绪（需 PASS/PARTIAL 且 readinessForDev=ready），不进入编码。请回到需求澄清或方案返工。') }
  else if (!gate.targetReadable) { finalStatus = 'BLOCKED'; note('目标仓库不可读，无法建立沙箱。') }
  else if (staleCmp.severity === 'hard' && !allowStalePlan) { finalStatus = 'BLOCKED'; note(`⛔ Stale plan：目标仓库自方案生成后已变更（${staleCmp.reasons.join('；')}）。方案可能不再贴合当前代码，拒绝交付。确认要在变更后的代码上继续，请传 allowStalePlan:true。`) }
  else {
    if (staleCmp.severity === 'hard' && allowStalePlan) note('⚠ 目标仓库已变更但 allowStalePlan=true，按用户要求在变更后的代码上继续（stale 风险已知）。')
    else if (staleCmp.severity === 'soft') note('⚠ 目标仓库有未提交改动差异(soft stale)，记录为开环项后继续。')

    // ---- 分档（建议1）：按方案复杂度/风险自动选档，args.mode 可覆盖；高风险至少 standard ----
    const cplx = String(gate.complexity || 'medium')
    const hasRisk = (gate.riskFlags || []).some(f => f && f !== 'none')
    mode = userMode || (cplx === 'simple' && !hasRisk ? 'lite' : cplx === 'complex' ? 'deep' : 'standard')
    CFG = MODE_CFG[mode]; MAX_FIX = argMaxFix !== null ? argMaxFix : CFG.maxFix
    note(`分档：复杂度=${cplx}${hasRisk ? '+高风险(' + (gate.riskFlags || []).join('/') + ')' : ''} → mode=${mode}（${userMode ? '用户指定' : '自动'}）：复审视角 ${CFG.lenses.length}、impl/review effort=${CFG.implEffort}/${CFG.reviewEffort}、返工上限 ${MAX_FIX}（命门 MaterializeTests/Verify 恒 high 不降）。`)

    // ---- Scaffold：复制沙箱 + 建 task 目录 + 生成 coding-workflow.md ----
    phase('Scaffold')
    const sc = await callAgent(
      `你负责脚手架搭建。${SAFETY}\n` +
      `步骤(全部用 Bash/Write，绝不碰原仓库)：\n` +
      `1) ts=$(date +%Y%m%d-%H%M%S)；runDir="${outDirBase}/$ts"（相对你的 cwd）；mkdir -p "$runDir"；用 realpath 取绝对路径。\n` +
      `2) 沙箱：用确定性共享脚本创建（与 diff 生成步、Codex 适配器【同一份排除集】，避免口径不一致导致构建产物混入 diff）——在本工作流仓库根执行 \`node ${binDir}/sandbox-prepare.mjs --src ${targetRepo} --dest "$runDir/sandbox"\`。该脚本会把 targetRepo 复制进沙箱并剥除：版本历史(.git)、构建产物(node_modules/dist/build/.next/.nuxt/coverage/target/__pycache__)、密钥与敏感物(.env/.env.*/*.pem/*.key/id_rsa*/id_ed25519*/*.p12/*.pfx/*.keystore/*.jks/.npmrc/.pypirc/*credential*.json/*secret*.json/*.bak/*.dump/*.log/*.sql.gz)、以及指向树外的 symlink，并做复制后防泄漏二次核验。读其 JSON：要求 ok=true、leaks 为空、copiedFiles>0（否则停下报告，绝不在不干净/空沙箱上继续）。不要再自己手写 rsync/cp 与 find 删除——排除集以该脚本为唯一权威。\n` +
      `3) task 目录：mkdir -p "$runDir/task-workflow/"{input,output,tests,state}；mkdir -p "$runDir/task-workflow/state/scratch"。\n` +
      `4) 把方案产物（final-plan.md 若有、plan.json、test-plan.json、requirement.json、risks.json、project-code-style.json 若有）从 ${planDir} 复制到 "$runDir/task-workflow/input/"。\n` +
      `5) 读 vendored 模板 ${vendorDir}/build-workflow.md，按其结构生成一份**填好的** "$runDir/task-workflow/coding-workflow.md"：\n` +
      `   - §1 GOAL=需求目标；§2 VARIABLES：INPUT=task-workflow/input/、OUTPUT=沙箱内被改文件、DONE=见 MaterializeTests 产出的命令（先写占位"见 tests/，由桥接物化；入口支持 --red/--regression 按类筛选与可选目标目录"）、SCOPE=【只许改下列文件】、CONTRACT=保持 .sh/.ps1 行为一致与既有退出码语义；\n` +
      `   - §3 在通用红线外，追加本任务红线（来自 risks.json 高危项）；§4 LOOP 的 todo 用 plan.json.steps；\n` +
      `   - §7.1 复核视角写明四个：correctness / robustness / scope-conformance / risk-coverage（见 ${bridgeDoc} §5.5）。\n` +
      `6) SCOPE 规整：把 plan.affected.files 与 plan.modify[].path/plan.add[].path 统一规整成【相对仓库根】的路径；拒绝绝对路径、../ 目录穿越、指向沙箱外的符号链接；去掉 ${targetRepo} 前缀；把带"(可选)/optional"标记的归入 optionalScopeFiles。\n` +
      `7) 生成 "$runDir/task-workflow/state/todo.md"（每条 step 一行未勾选）与空的 progress.md。\n` +
      `回报 ok/runDir(绝对)/sandboxDir/taskDir/codingWorkflowPath/scopeFiles(相对仓库根)/optionalScopeFiles/todoUnits/note。`,
      { schema: SCAFFOLD_SCHEMA, label: 'scaffold', phase: 'Scaffold', agentType: AT, effort: 'medium' }, true)
    if (!sc.ok) { failedStages.push('Scaffold'); halt('Scaffold', sc.error) }
    scaffold = sc.value
    if (!scaffold.ok || !scaffold.sandboxDir) halt('Scaffold', 'scaffold 未成功建立沙箱/目录：' + scaffold.note)
    note(`Scaffold：runDir=${scaffold.runDir}；SCOPE(${scaffold.scopeFiles.length})=${scaffold.scopeFiles.join(', ')}${scaffold.optionalScopeFiles.length ? '；可选=' + scaffold.optionalScopeFiles.join(', ') : ''}；todo ${scaffold.todoUnits.length} 项。`)
    const runDir = scaffold.runDir, sandboxDir = scaffold.sandboxDir, taskDir = scaffold.taskDir

    // ---- MaterializeTests：物化可运行 tests/ + DONE，并"先红后绿"核验可信 ----
    phase('MaterializeTests')
    const mt = await callAgent(
      `你负责把测试规格物化成【可运行的测试】并核验其可信。${SAFETY}\n` +
      `输入：方案的 test-plan.json（在 ${taskDir}/input/）。沙箱：${sandboxDir}（当前为【未实现新功能】的原始代码副本）。\n` +
      `步骤：\n` +
      `1) 把 test-plan.json 的用例物化到 ${taskDir}/tests/，并写一个 DONE 入口（如 ${taskDir}/tests/run_verify.sh）：默认（无参数）跑全部测试，全过则 echo "ALL PASSED" 并 exit 0，否则非0退出。测试要对【沙箱里的脚本】跑（用绝对/相对沙箱路径）。\n` +
      `2) 把测试分两类，并让 DONE 入口支持【按类筛选 + 指定目标】（硬契约：Verify 要靠它在原仓库新副本上独立复现"红/绿"）：①【新功能测试】针对本次要实现的行为（未实现时应红）；②【回归测试】针对既有且不该被破坏的行为（如既有退出码语义，应一直绿）。DONE 入口必须支持开关 \`--red\`（只跑①）与 \`--regression\`（只跑②），并接受一个可选的【目标目录】参数（默认沙箱 ${sandboxDir}），使同一套测试能对任意代码副本运行。\n` +
      `3) verificationType 无法自动验的（如本机无 pwsh 的 .ps1 行为：先 command -v pwsh 探测）→ 不要硬塞进 DONE，列入 openLoopItems 作人工核对，并在 note 说明。\n` +
      `4) **先红后绿核验**（关键）：在当前未实现的沙箱上，用 --red 跑①确认其为红、用 --regression 跑②确认其为绿；报告 newFeatureTestsFailOnCurrent、regressionTestsPassOnCurrent、redExitCode(①的退出码)。\n` +
      `5) **冻结测试基线**（防改测试迁就实现）：上述测试全部跑完后，用确定性脚本计算 tests/ 指纹——在本工作流仓库根执行 \`node ${binDir}/tests-fingerprint.mjs --dir ${taskDir}/tests\`，取其 JSON 输出的 fingerprint 字段作为 testsFingerprint。这是该指纹的【唯一权威算法】，Verify 阶段会用同一脚本复算比对；不要自己另写 find/sha256 口径（口径不一会造成假阳/假阴）。务必让测试把临时输出写到 ${taskDir}/state/ 或 mktemp、不要写进 tests/，以保证该指纹在后续实现/修复阶段保持稳定。\n` +
      `回报 ok/doneCommand(默认跑全部)/testsFingerprint(冻结基线)/redCommand(只跑新功能,--red 的完整命令)/regressionCommand(只跑回归,--regression 的完整命令)/testsDir/newFeatureTestsFailOnCurrent/regressionTestsPassOnCurrent/redExitCode/autoVerifiableCount/openLoopItems/note。`,
      { schema: MATERIALIZE_SCHEMA, label: 'materialize-tests', phase: 'MaterializeTests', agentType: AT, effort: 'high' }, true)
    if (!mt.ok) { failedStages.push('MaterializeTests'); halt('MaterializeTests', mt.error) }
    materialize = mt.value
    // 确定性可信判定（不只信 agent 自述）：新功能红 且 回归绿
    trustworthy = materialize.newFeatureTestsFailOnCurrent === true && materialize.regressionTestsPassOnCurrent === true
    note(`测试物化：DONE=\`${materialize.doneCommand}\`；先红后绿核验：新功能红=${materialize.newFeatureTestsFailOnCurrent} / 回归绿=${materialize.regressionTestsPassOnCurrent} → DONE可信=${trustworthy}；自动用例 ${materialize.autoVerifiableCount}，开环人工项 ${materialize.openLoopItems.length}。`)
    if (materialize.openLoopItems.length) note(`开环人工核对项（未自动覆盖）：${materialize.openLoopItems.join(' | ')}`)
    if (!trustworthy) { finalStatus = 'BLOCKED'; note('DONE 未通过"先红后绿"可信核验（新功能未红或回归未绿），不蒙着写码。已落保留沙箱/测试供人工接手。') }
    else {

      // ---- Implement：沙箱内写码到 DONE 全绿（有界循环，重试续上一轮）----
      phase('Implement')
      const scopeList = scaffold.scopeFiles.join(', ')
      let implRound = 0
      while (implRound < MAX_IMPL) {
        implRound++
        const resume = implRound === 1 ? '' : `⚠️ 第 ${implRound - 1} 轮 DONE 未全绿：先读 ${taskDir}/state/progress.md 与现有沙箱改动，【续上一轮】继续修，不要从零重写。\n`
        const im = await callAgent(
          `你是实现工程师，在【沙箱】${sandboxDir} 里写代码。${SAFETY}\n${resume}` +
          `真相源：读 ${scaffold.codingWorkflowPath} 的 §1–§8 严格执行（流程细节以它为准，本提示不重复）。方案在 ${taskDir}/input/（plan.json 的 modify/add/steps/reuse 是落点）。\n` +
          `【遵循项目既有规范】先读 ${taskDir}/input/project-code-style.json（若有）：新代码遵循其识别的命名/分层/统一响应/异常/日志/注释等既有风格；优先复用既有 Service/Util/组件/枚举，不重复造轮子；规范优先级 客户>项目>阿里[仅当真接入]>通用（阿里占位按未接入）；不做无据重构、不引入与既有分层冲突的结构、只动 SCOPE；与既有规范确有冲突在 ${taskDir}/state/progress.md 记录，不擅自大范围重写。\n` +
          `【SCOPE：只许改这些沙箱内文件】${scopeList}（相对仓库根；对应沙箱路径=${sandboxDir}/<相对路径>）。改到 SCOPE 外即属越界，必须停。\n` +
          `【测试边界·硬约束】绝不修改/删除/新增 ${taskDir}/tests/ 下任何测试文件——它们由独立测试角色物化、是本次验收基线；通过改测试让 DONE 变绿会被独立验证判定为篡改并 BLOCKED。测试若产生临时输出，写到 ${taskDir}/state/ 或 mktemp，不要写进 tests/。\n` +
          `循环：取下一个未完成 step → 在 state/scratch 想清楚 → 改沙箱内 SCOPE 文件 → 跑 DONE：\`${materialize.doneCommand}\` → 把这一轮写进 ${taskDir}/state/progress.md（追加，不删）。直到 DONE 全绿(exit 0/ALL PASSED)。\n` +
          `回报 passed(DONE是否全绿)/doneExitCode/filesChanged(沙箱内改了哪些，相对仓库根)/scopeViolations(改到SCOPE外的，应空)/redLineHit/redLineReason/summary/progressNote。`,
          { schema: IMPLEMENT_SCHEMA, label: `implement#${implRound}`, phase: 'Implement', agentType: AT, effort: CFG.implEffort }, true)
        if (!im.ok) { failedStages.push(`Implement#${implRound}`); halt('Implement', im.error) }
        implement = im.value
        if (implement.redLineHit) { finalStatus = 'BLOCKED'; note(`⛔ 触及红线，停止：${implement.redLineReason}`); break }
        if ((implement.scopeViolations || []).length) { finalStatus = 'BLOCKED'; note(`⛔ SCOPE 越界，停止：${implement.scopeViolations.join(', ')}`); break }
        note(`Implement r${implRound}：DONE ${implement.passed ? '全绿✅' : '未绿(exit ' + implement.doneExitCode + ')'}；改动 ${implement.filesChanged.join(', ') || '无'}。`)
        if (implement.passed) break
        if (implRound >= MAX_IMPL) note(`已达实现轮次上限 ${MAX_IMPL}，DONE 仍未全绿。`)
      }

      if (implement && implement.passed && finalStatus !== 'BLOCKED') {
        // ---- Review ↔ Fix 有界循环：实现者不自评；每次 Fix 后必由【全新独立实例】重新复审（C5）----
        const LENSES_ALL = [
          { lens: 'correctness', focus: '对照 plan 与验收标准，改动是否真满足需求、边界是否出错' },
          { lens: 'robustness', focus: '异常/边界/坏输入是否会崩溃、卡死或被吞' },
          { lens: 'scope-conformance', focus: '是否只改了 plan.affected.files、是否符合 plan.modify 的 why、有无夹带无关改动' },
          { lens: 'risk-coverage', focus: 'risks.json 高危项是否被测试真覆盖、既有退出码等语义是否被破坏' },
          { lens: 'readability', focus: '命名/结构/复杂度：是否清晰达意、无过深嵌套与重复，贴合项目既有可读性风格' },
          { lens: 'maintainability', focus: '是否复用既有 Service/Util/组件/枚举而非重复造轮子、职责单一低耦合、无无据重构扩大维护面' },
          { lens: 'code-style', focus: '对照 input/project-code-style.json 识别出的项目规范核对编码风格（命名/分层/统一响应/异常模型/日志/注释等）；规范优先级 客户>项目>阿里[仅当真接入]>通用，阿里占位按未接入不据其判定' },
          { lens: 'project-convention', focus: '是否遵循目标项目既有约定（目录布局/分层落点/DTO-VO-Entity/统一返回/事务/SQL-ORM 用法），新代码贴合而非引入冲突分层；与既有规范冲突应记录而非大范围重构' },
        ]
        const LENSES = LENSES_ALL.filter(L => CFG.lenses.includes(L.lens))   // 按档位裁剪复审视角（lite 仅 correctness+scope-conformance）
        // L2 增量复审：doReview 接受可选 lensSubset；Fix 后只重审上一轮 needs-work 的视角，已 ok 的视角沿用结论（独立性不破——被触及关切仍由全新独立实例审）。显式注入 lens 保证 carry-forward/合并可靠。
        async function doReview(round, lensSubset) {
          const lensesToRun = lensSubset || LENSES
          const rv = await parallel(lensesToRun.map(L => () =>
            callAgent(
              `你是独立审查者（视角=${L.lens}，第 ${round} 轮），未参与实现/修复，只读不许改。${SAFETY}\n` +
              `按 ${scaffold.codingWorkflowPath} 的 §7.1 与 ${bridgeDoc} §5.5 的「${L.lens}」视角，审查沙箱 ${sandboxDir} 的当前改动（对照 ${taskDir}/input/ 的方案）。聚焦：${L.focus}。\n` +
              `${['readability', 'maintainability', 'code-style', 'project-convention'].includes(L.lens) ? `本视角属风格/规范类：先读 ${taskDir}/input/project-code-style.json（若有）按其识别的项目既有风格与分层判定；规范优先级 客户>项目>阿里[仅当真接入]>通用，阿里规范当前占位按未接入、绝不据其判定；不得据低优先级规范要求对客户既有代码做大范围重构，冲突记为 finding 而非"应重写"。\n` : ''}` +
              `可只读跑 DONE（\`${materialize.doneCommand}\`）佐证。给 findings + verdict(ok/needs-work) + severity(P0/P1/P2/none) + blocking + note。【分级】P0=必阻断（须 blocking=true 且 verdict=needs-work）；P1=应修不必阻断（verdict=needs-work、blocking=false，计开环）；P2=轻微建议（verdict 可 ok，仅写 note、不必判 needs-work）；无问题=none。`,
              { schema: REVIEW_SCHEMA, label: `review-r${round}:${L.lens}`, phase: 'Review', agentType: AT, effort: CFG.reviewEffort }, true)
              .then(r => r.ok ? { ...r.value, lens: L.lens } : null)
          ))
          const got = rv.filter(Boolean)
          // C17（逐轮累计）：任一轮（含增量轮）视角不齐即累计标记独立复审缺失，不只看末轮
          if (got.length < lensesToRun.length) { reviewIncomplete = true; note(`⚠ 复审 r${round} 视角不齐：仅 ${got.length}/${lensesToRun.length} 返回，累计标记独立复审缺失（C17）。`) }
          return got
        }

        phase('Review')
        reviews = await doReview(0)
        note(`Review r0：${reviews.length}/${LENSES.length} 视角，needs-work ${reviews.filter(r => r.verdict === 'needs-work').length}。`)
        let fixRound = 0
        while (reviews.filter(r => r.verdict === 'needs-work').length && fixRound < MAX_FIX) {
          fixRound++
          const needWork = reviews.filter(r => r.verdict === 'needs-work')
          const findings = needWork.flatMap(r => r.findings.map(f => `[${r.lens}] ${f}`))
          phase('Fix')   // C6：Fix 是独立阶段，显式起 phase 并记 fixHistory
          const fx = await callAgent(
            `你是【独立修复工程师】（全新实例，未参与本次实现 implement 与评审），在沙箱 ${sandboxDir} 里改（第 ${fixRound} 轮）。${SAFETY}\n` +
            `职责【仅限】按下列独立评审意见做【最小修复】：先读 ${taskDir}/state/progress.md 与现有改动理解现状，再针对意见改；不得借机重写实现脉络、不得扩大改动范围、不得改动 ${taskDir}/tests/ 下任何测试文件（改测试迁就实现将被独立验证判定为篡改并 BLOCKED）。\n` +
            `修复同样遵循 ${taskDir}/input/project-code-style.json（若有）的项目既有风格与分层、优先复用既有能力，不无据重构、不引入冲突分层。\n` +
            `按 ${scaffold.codingWorkflowPath} 的 §7.2 修复协议处理以下审查意见，只改 SCOPE 内文件：\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` +
            `改完【必须重跑 DONE 仍全绿】(\`${materialize.doneCommand}\`)——修复不得破坏已通过部分。把改动记进 ${taskDir}/state/progress.md。\n` +
            `回报 passed/donePassed(DONE是否仍绿)/addressed/stillOpen/filesChanged/summary。`,
            { schema: FIX_SCHEMA, label: `fix#${fixRound}`, phase: 'Fix', agentType: AT, effort: CFG.implEffort }, false)
          if (!fx.ok) { failedStages.push(`Fix#${fixRound}`); note(`Fix r${fixRound} 失败：${fx.error}`); break }
          fix = fx.value
          fixHistory.push({ round: fixRound, addressed: fix.addressed, stillOpen: fix.stillOpen, donePassed: fix.donePassed })
          note(`Fix r${fixRound}：处理 ${fix.addressed.length}，仍开放 ${fix.stillOpen.length}，DONE仍绿=${fix.donePassed}。`)
          if (!fix.donePassed) { note('修复破坏了 DONE，停止并交人工。'); break }
          // 关键（C5）：Fix 后绝不由修复者自评，必由全新独立实例重新复审
          phase('Review')
          // L2 增量复审：仅重审上一轮仍 needs-work 的视角（needWork）；上一轮已 ok 的视角沿用其结论。被触及关切仍由全新实例独立审，独立性不破；Fix 可能在已通过视角上引入的新回归，由后续独立 Verify（DONE 复跑 + 从 test-plan 重物化复测 + SCOPE diff）兜底。
          const staleLenses = LENSES.filter(L => needWork.some(r => r.lens === L.lens))
          const carried = reviews.filter(r => r.verdict !== 'needs-work')
          reviews = [...carried, ...await doReview(fixRound, staleLenses)]
          note(`复审 r${fixRound}（增量：重审 ${staleLenses.length}/${LENSES.length} 视角，沿用上轮通过 ${carried.length} 个）：needs-work ${reviews.filter(r => r.verdict === 'needs-work').length}。`)
        }
        // C17：复审完整性闸门已改为【逐轮累计】（见 doReview）——任一轮视角不齐即 reviewIncomplete=true，不只看末轮
        if (reviewIncomplete) note(`独立复审完整性：曾出现视角不齐（reviewIncomplete=true），computeDeliverStatus 将据此拒绝乐观交付。`)

        // ---- 独立 Verify（C4）：全新只读实例亲手复跑 DONE + 独立核对 diff 仅动 SCOPE，不信实现/修复者自报 ----
        phase('Verify')
        const vf = await callAgent(
          `你是独立验证者，未参与实现/修复/审查，只复核客观事实、不打分、不改任何文件。${SAFETY}\n` +
          `【硬规则·过没过由脚本退出码裁决，不得自评】下列复跑一律用确定性运行器 \`node ${binDir}/verify-tests.mjs --cwd <目标目录> -- <命令>\`（在本工作流仓库根执行），布尔字段取其 JSON 的 passed、退出码取其 exitCode；严禁凭"看起来过了"自行判定。\n` +
          `1) 亲手复跑最终 DONE：\`node ${binDir}/verify-tests.mjs --cwd ${sandboxDir} -- ${materialize.doneCommand}\`，donePassedVerified=其 passed、doneExitCodeVerified=其 exitCode。\n` +
          `2) 先红后绿独立复核：把原仓库 ${targetRepo} 复制到一个 mktemp -d 临时副本（不含本次实现）；用运行器对该副本跑 --red（命令形如 \`${materialize ? materialize.redCommand : '<redCommand>'}\`，目标目录指向该副本）确认新功能测试在【未实现版】上为红（运行器 passed=false）；再跑 --regression（形如 \`${materialize ? materialize.regressionCommand : '<regressionCommand>'}\`）确认回归为绿（passed=true）。两者都成立才 redGreenVerified=true。\n` +
          `3) 独立算 diff：diff -ruN "${targetRepo}" "${sandboxDir}"（忽略 .git），列出真正变更的文件，判断是否【只动了 SCOPE】=${JSON.stringify(scaffold.scopeFiles)}（可选 ${JSON.stringify(scaffold.optionalScopeFiles)}）。\n` +
          `4) 【独立复测·防改测试迁就实现，硬闸门】不要复用沙箱旁的 ${taskDir}/tests/。改为从 ${taskDir}/input/test-plan.json 自己重新物化【新功能验收检查】到一个 mktemp -d 全新目录（物化是你的职责），再用运行器执行 \`node ${binDir}/verify-tests.mjs --cwd ${sandboxDir} -- <你物化的复测命令>\`：independentTestsPassed=其 passed（脚本退出码裁决，非自评）。false=实现未真正满足验收，或在树测试被改弱。\n` +
          `5) 【测试基线完整性】用与物化阶段【同一脚本】复算指纹：\`node ${binDir}/tests-fingerprint.mjs --dir ${taskDir}/tests\`，取其 fingerprint 与物化时冻结的 testsFingerprint=\`${materialize ? materialize.testsFingerprint : '<none>'}\` 比对：一致则 testsIntact=true，否则 false（疑似实现/修复阶段改动了测试）。\n` +
          `回报 donePassedVerified(最终DONE是否真绿)/doneExitCodeVerified/redGreenVerified(先红后绿是否独立复现)/independentTestsPassed(从test-plan独立重物化复测沙箱是否全过)/testsIntact(在树tests指纹是否未变)/changedFilesVerified(实测变更文件)/scopeCleanVerified(是否只动SCOPE)/note。`,
          { schema: VERIFY_SCHEMA, label: 'independent-verify', phase: 'Verify', agentType: AT, effort: 'high' }, true)
        if (!vf.ok) { failedStages.push('Verify'); note(`独立验证失败：${vf.error}`) }
        verify = vf.ok ? vf.value : null
        if (verify) note(`独立验证：DONE真绿=${verify.donePassedVerified}(exit ${verify.doneExitCodeVerified})、先红后绿复现=${verify.redGreenVerified}、独立复测过=${verify.independentTestsPassed}、测试未篡改=${verify.testsIntact}、只动SCOPE=${verify.scopeCleanVerified}。`)
        // G4 测试/实现职责边界（硬闸门）：独立验证用自己从 test-plan 重物化的测试复测，不过=实现真错或被改测试迁就→BLOCKED（不信在树测试）
        if (verify && verify.independentTestsPassed === false) { finalStatus = 'BLOCKED'; note('⛔ 独立复测未过（Verify 从 test-plan.json 重物化、不复用在树 tests/）：实现未真正满足验收，或曾改测试迁就实现。拒绝交付。') }
        else if (verify && verify.testsIntact === false) { note('⚠ 在树 tests/ 指纹与物化时不一致（疑似被改动）：已记为开环项；终态以独立复测为准。') }

        // ---- BrowserVerify（仅 web 项目）：独立角色判类型→探浏览器能力→起项目→真实交互→四态（失败=阻断、无能力=如实跳过；喂入 computeDeliverStatus 的 browser 闸门）----
        if (finalStatus !== 'BLOCKED') {
          phase('BrowserVerify')
          // 1) 客观信号采集（独立只读 agent）→ 脚本用确定性分类器判 web/非web（同源块 classifyProjectType）
          const ds = await callAgent(
            `你是只读项目类型探测者。读取沙箱 ${sandboxDir} 根目录，如实回报客观信号（不臆测、不改文件）：` +
            `hasPackageJson；deps(package.json 的 dependencies+devDependencies 包名数组，无则[])；` +
            `devScript/startScript/serveScript(package.json scripts 里 dev/start/serve 的命令，无则空串)；` +
            `hasIndexHtml(根/public/src 有无 index.html)；hasServerEntry(有无 server.js/app.js/app.py/main.go 等 HTTP 服务入口)。`,
            { schema: BROWSER_SIGNALS_SCHEMA, label: 'detect-project-type', phase: 'BrowserVerify', agentType: AT, effort: 'low', model: LIGHT_MODEL }, false)
          const sig = ds.ok ? ds.value : { hasPackageJson: false, deps: [], devScript: '', startScript: '', serveScript: '', hasIndexHtml: false, hasServerEntry: false }
          const pt = classifyProjectType({ hasPackageJson: sig.hasPackageJson, deps: sig.deps, scripts: { dev: sig.devScript, start: sig.startScript, serve: sig.serveScript }, hasIndexHtml: sig.hasIndexHtml, hasServerEntry: sig.hasServerEntry })
          note(`BrowserVerify：项目类型=${pt.type}（isWeb=${pt.isWeb}）${pt.startCommand ? '，startCommand=' + pt.startCommand : ''}。`)
          if (!pt.isWeb) {
            browserResult = { applicable: false, status: 'not-applicable', finalBrowserStatus: 'not-applicable', value: null, openItems: [] }
            note('非 web 项目 → 浏览器验证不适用（not-applicable），跳过。')
          } else {
            // 2) 独立真实浏览器验证者（工具无关；无能力如实跳过、绝不伪造）
            const bv = await callAgent(
              `你是【独立真实浏览器验证者】，未参与实现/修复，对已实现的 web 项目沙箱 ${sandboxDir} 做真实浏览器验证。${SAFETY}\n` +
              `需求目标：${gate ? gate.requirementGoal : ''}。项目类型=${pt.type}，建议启动命令=${pt.startCommand || '(自行从 package.json 推断)'}。\n` +
              `【能力探测·按优先级、工具无关】依次探测并选第一个【真的能起浏览器】的能力：(a) 浏览器类 MCP（如 Playwright MCP）——用 ToolSearch 查 "browser playwright"；(b) Playwright CLI（command -v playwright；npx --no-install playwright --version；ls ~/.cache/ms-playwright；必要时 npx playwright install chromium，但必须实跑一次冒烟确认浏览器真能启动）；(c) Codex 内置浏览器（command -v codex）；(d) 其它可控现代浏览器（注意：只能"渲染+截图"而无法脚本化交互的适配器——如 firefox --headless --screenshot——只能验证页面加载/渲染/控制台，不能验证点击/填表单等交互，须据此在 finalBrowserStatus 分流，绝不冒充已验交互）。adapterUsed 记录所用能力及其是否支持脚本交互。\n` +
              `【无能力 → 如实跳过，绝不伪造】以上都不可用（或浏览器装了也起不来）则 finalBrowserStatus='skipped-no-capability'，note 写：探测过程与依据、缺失能力、剩余风险（UI/交互/JS 未经真实浏览器验证）、补全建议。严禁用 WebFetch 静态文本冒充浏览器验证。\n` +
              `【有能力 → 真实验证，像真实用户】(1) 沙箱内起项目（先装依赖，用 ${pt.startCommand || 'npm run dev/start'}，轮询端口就绪、带超时，记 startLogTail/baseUrl/projectStarted）；(2) 打开页面 pageOpened；(3) 执行本次需求涉及的关键交互（表单/按钮/弹窗/跳转/刷新后状态），记 opsExecuted；(4) 逐条核对 checks(name/passed/detail)：页面是否正常加载、交互结果是否符合需求、刷新后状态；(5) 收集 console 错误 consoleErrors、关键接口失败 failedKeyRequests(url/status)；(6) 保存截图 screenshots 到 ${scaffold.runDir}/browser-evidence/（evidenceDir），用低 Token 策略（浅快照/仅 console error/过滤网络/关键步骤截图）；(7) 用完清理启动的进程。\n` +
              `finalBrowserStatus 判定（四态分流，绝不伪造）：① 项目起来、页面正常渲染、本次需求【在所用适配器能力范围内】的关键 checks 全过、无 console 错、关键接口正常 → 'passed'；② 页面渲染/加载失败（空白/崩溃）、或已验证的关键 check 不过、或 console 有错、或关键接口失败 → 'failed'；③ 所用适配器只能渲染/截图、无法脚本化驱动本次需求的关键交互（点击/填表单/弹窗），而渲染本身无问题 → 'error'，并在 note 逐条列出"未能验证的交互项及原因（适配器不支持脚本交互）"，checks 只放真正验证过的项——绝不把未验证的交互项写成 passed；④ 中途崩溃/超时/环境问题无法完成 → 'error'。\n` +
              `回报 adapterUsed/projectStarted/startLogTail/pageOpened/baseUrl/opsExecuted/checks/consoleErrors/failedKeyRequests/screenshots/evidenceDir/finalBrowserStatus/note。`,
              { schema: BROWSER_VERIFY_SCHEMA, label: 'browser-verify', phase: 'BrowserVerify', agentType: AT, effort: 'high' }, false)
            if (!bv.ok) {
              browserResult = { applicable: true, status: 'error', finalBrowserStatus: 'error', value: null, openItems: ['浏览器验证子代理失败（未完成，非"已通过"）：' + bv.error] }
              note(`BrowserVerify：子代理失败，记为 error（不伪造通过）：${bv.error}`)
            } else {
              const v = bv.value
              const mapped = v.finalBrowserStatus === 'skipped-no-capability' ? 'skipped' : v.finalBrowserStatus
              const openItems = []
              if (mapped === 'skipped') openItems.push('web 项目但环境无可用浏览器能力，浏览器验证已如实跳过（剩余风险：UI/交互/JS 未经真实浏览器验证）：' + v.note)
              if (mapped === 'error') openItems.push('浏览器验证未能完成（error）：' + v.note)
              browserResult = { applicable: true, status: mapped, finalBrowserStatus: v.finalBrowserStatus, value: v, openItems }
              note(`BrowserVerify：adapter=${v.adapterUsed}，启动=${v.projectStarted}，开页=${v.pageOpened}，checks ${v.checks.filter(c => c.passed).length}/${v.checks.length} 过，console错 ${v.consoleErrors.length}，接口失败 ${v.failedKeyRequests.length}，截图 ${v.screenshots.length} → ${v.finalBrowserStatus}。`)
              if (mapped === 'failed') { finalStatus = 'BLOCKED'; note('⛔ 真实浏览器验证失败（web 项目页面/交互/控制台/接口未通过），拒绝交付。') }
            }
          }
        }

        // ---- CodeQuality（S3）：跑项目【既有】静态工具 + 编译/构建，记录真实命令/退出码/输出尾；无工具如实跳过、绝不引新工具/批量改格式。编译失败=P0→BLOCKED；非编译类静态失败/未验证/引新工具→开环项（喂入 computeDeliverStatus 的 codeQuality 闸门）。精细 P0/P1/P2 分级与 style 审查视角在 S4 接管。----
        if (finalStatus !== 'BLOCKED') {
          phase('CodeQuality')
          const cq = await callAgent(
            `你是【独立代码质量检查者】，未参与实现/修复，对沙箱 ${sandboxDir} 的产出做静态质量检查（只读+只跑工具，绝不改源码、绝不动原仓库、绝不 commit/push）。${SAFETY}\n` +
            `【既有工具清单与规范来源】优先读 ${taskDir}/input/project-code-style.json（plan 阶段产出的项目规范识别，若存在）取其 staticTools[]（name/command/configFile）与 specSource；不存在则自行在沙箱探测既有工具：pom.xml/build.gradle 的 checkstyle/spotless/pmd 插件、package.json scripts 的 lint/format 与 eslint/prettier/stylelint 配置、ruff/black/flake8、gofmt/golangci-lint、以及项目自带的 lint/check 脚本。\n` +
            `【规范优先级】客户项目规范 > 项目现有风格 > 阿里 Java 规范【仅当真接入】> 通用最佳实践；阿里规范当前为占位 → 一律按"未接入"，specSource 写"阿里规范：未接入（占位）"，绝不声称已按其检查。\n` +
            `【只跑既有、绝不引新工具/批量改格式】仅运行项目【本来就配置了】的静态工具与其【既有命令】；严禁安装/引入项目原本没有的格式化或静态工具，严禁 --fix/--write/格式化批量改写源码（introducedNewTool 必须=false；若你确实动了则如实置 true 并说明，供人工复核）。\n` +
            `【编译/构建】若项目有明确且不依赖缺失环境的编译/构建命令（如 mvn -q compile、gradle compileJava、tsc --noEmit、go build ./...、cargo check），执行一次：记 compileRan/compileCommand/compileExitCode/compileOutputTail(真实输出尾)/compilePassed。无法跑（无命令/缺环境）则 compileRan=false 并在 note 说明，绝不臆断通过。\n` +
            `【静态工具】对每个既有工具跑其既有命令，逐个记 staticChecks(tool/command/exitCode/status/severity/outputTail/note)：能跑且退出码0→passed；能跑但退出码非0（有告警/错误）→failed；工具存在但本环境跑不起来→unverified；本档主动略过→skipped；项目没有该类工具→不必列。severity 先粗判（编译/构建类、以及致命级静态问题[安全漏洞/必崩溃/数据损坏]=P0；一般 lint/风格问题 P1 或 P2），精细分级在后续审查阶段。outputTail 必须是真实输出截断，绝不编造。\n` +
            `【成本】这是确定性工具执行，不要为此再派生子代理。${mode === 'lite' ? '当前 lite 档：只跑项目自带的主 lint/检查命令 + 编译，重型扫描可记 skipped。' : '逐个跑项目已配置的静态工具。'}\n` +
            `【无能力/无工具 → 如实跳过】项目没有任何既有静态工具且无可跑编译命令 → applicable=false，note 写明依据与剩余风险（静态质量未经工具校验），绝不伪造已检查。\n` +
            `回报 applicable/specSource/language/buildTool/compileRan/compilePassed/compileCommand/compileExitCode/compileOutputTail/staticChecks/introducedNewTool/summary/note。`,
            { schema: CODE_QUALITY_SCHEMA, label: 'code-quality', phase: 'CodeQuality', agentType: AT, effort: 'low', model: LIGHT_MODEL }, false)
          if (!cq.ok) {
            codeQuality = { applicable: false, specSource: '阿里规范：未接入（占位）', language: 'unknown', buildTool: 'unknown', compileRan: false, compilePassed: false, compileCommand: '', compileExitCode: -1, compileOutputTail: '', staticChecks: [], introducedNewTool: false, summary: '代码质量检查子代理失败', note: '代码质量检查未完成（非"已通过"）：' + cq.error }
            note(`CodeQuality：子代理失败，记为未检查（不伪造通过）：${cq.error}`)
          } else {
            codeQuality = cq.value
            const cqFailed = codeQuality.staticChecks.filter(c => c.status === 'failed')
            note(`CodeQuality：specSource=${codeQuality.specSource}；编译 ${codeQuality.compileRan ? (codeQuality.compilePassed ? '通过' : '未过') : '未跑'}；静态工具 ${codeQuality.staticChecks.length} 个（failed ${cqFailed.length}），引入新工具=${codeQuality.introducedNewTool}。`)
            if (codeQuality.introducedNewTool === true) note('⚠ CodeQuality 报告引入了项目原本没有的工具或批量改了格式：违反"只跑既有"约束，需人工复核（已如实记录，不据此判过）。')
            if (codeQuality.applicable === true && codeQuality.compileRan === true && codeQuality.compilePassed === false) { finalStatus = 'BLOCKED'; note('⛔ 项目编译/构建失败（P0），拒绝交付。') }
            else if (codeQuality.applicable === true && codeQuality.staticChecks.some(c => c.status === 'failed' && c.severity === 'P0')) { finalStatus = 'BLOCKED'; note('⛔ 静态检查存在 P0 级问题（必阻断），拒绝交付。') }
          }
        }
      }
    }
  }

  // 终态延后到 Deliver 阶段用 computeDeliverStatus 计算：diff 落盘 + apply-check 也是判定输入（#1/#2）。

} catch (e) {
  if (e && e.__halt) { finalStatus = e.__halt.status; halted = true; note(`流程在 ${e.__halt.stage} 终止：${e.__halt.reason}。输出已有结果，不伪造后续。`) }
  else { throw e }
}

// ===================== Deliver（先生成 diff + apply-check，据此定终态，再落盘）=====================
phase('Deliver')
// step 1：独立生成 target-root-relative diff 并做 git apply --check —— 这是终态判定的最后一项事实
if (scaffold && scaffold.runDir && finalStatus !== 'BLOCKED' && !halted) {
  const gd = await callAgent(
    `你负责生成交付 diff（只在 ${scaffold.runDir} 内写，绝不动原仓库、绝不 commit/push）。${SAFETY}\n` +
    `1) 生成 target-root-relative diff（用确定性脚本，避免 git diff --no-index 的兼容缺口；与 Codex 适配器同一机制）：\n` +
    `   a. 先备一份与沙箱【同套净化规则】的干净 base：在本工作流仓库根执行 \`node ${binDir}/sandbox-prepare.mjs --src ${targetRepoArg || (gate && gate.manifestTarget)} --dest <tmp>/diff-base\`（剥 .git/构建产物/密钥/symlink，使 base 与沙箱可比——不会把 node_modules 等误算成整体删除）。\n` +
    `   b. 生成可移植补丁：\`node ${binDir}/diff-from-sandbox.mjs --base <tmp>/diff-base --sandbox ${scaffold.sandboxDir} --out "${scaffold.runDir}/changes.diff"\`，读其 JSON：filesChanged 即变更文件（已是 target-root-relative）；要求 ok=true 且 absoluteLeak=false（脚本已保证标准 a/ b/ 前缀、含 --binary、diff 头不含绝对路径/sandbox/base 前缀）。若 filesChanged 为空（无任何变更）则置 ok=false。diffStat 用变更文件数/行数概述。\n` +
    `2) 检查 diff 可应用：把 <tmp>/diff-base 再复制一份到临时 apply-check 目录（它与生成补丁所用 base 同一内容），在该目录执行 git apply --check "${scaffold.runDir}/changes.diff"；通过则 diffApplyCheckPassed=true，否则 false。若 diff 为空（无任何变更文件）则 ok=false。\n` +
    `只产出 changes.diff 并回报事实，不要写 manifest 或报告。回报 ok/diffStat/filesChanged(target-root-relative)/diffApplyCheckPassed/note。`,
    { schema: DIFF_SCHEMA, label: 'generate-diff', phase: 'Deliver', agentType: AT, effort: 'medium' }, true)
  diffResult = gd.ok ? gd.value : { ok: false, diffStat: '', filesChanged: [], diffApplyCheckPassed: false, note: gd.error }
  note(`Diff：${diffResult.ok ? '已生成 changes.diff（' + diffResult.diffStat + '），apply-check=' + diffResult.diffApplyCheckPassed : '失败：' + diffResult.note}`)
} else if (scaffold && scaffold.runDir) {
  note('前置已 BLOCKED/halt，跳过 diff 生成（无可交付实现）。')
} else {
  note('未建立 runDir（就绪闸门或前置失败），无 diff 可生成。')
}

// CodeQuality 开环项（S3）：仅当 applicable 时把非编译类静态失败/未验证工具/引新工具告警计为开环（编译失败已在阶段内 BLOCKED；无工具=如实跳过不降级）。供 status 闸门与 manifest.openItems 共用，保持"有开环↔带开环态"一致。
const cqOpenItems = (codeQuality && codeQuality.applicable === true) ? [
  ...codeQuality.staticChecks.filter(c => c.status === 'failed').map(c => `静态检查未通过[${c.severity}] ${c.tool}：${c.note || c.command}`),
  ...codeQuality.staticChecks.filter(c => c.status === 'unverified').map(c => `静态工具本环境未能运行（未验证）${c.tool}：${c.note || c.command}`),
  ...(codeQuality.introducedNewTool === true ? ['代码质量检查报告引入了项目原本没有的工具或批量改了格式（违反"只跑既有"约束），需人工复核'] : []),
] : []

// 三方对账（#4）：Verify / diff / SCOPE 文件列表一致性 —— 必须在终态计算之前求值（P1.4：其 issues 是开环来源，要进终态）
const filesReconcile = reconcileChangedFiles({
  verifiedFiles: (verify && verify.changedFilesVerified) || [],
  diffFiles: (diffResult && diffResult.filesChanged) || [],
  scopeFiles: (scaffold && scaffold.scopeFiles) || [],
  optionalScopeFiles: (scaffold && scaffold.optionalScopeFiles) || [],
})

const deliveryAgentExecution = {
  required: true,
  requiredStages: ['test-materialization', 'implementation', 'review', 'verification'],
  preflightPassed: true,
  executed: true,
  fallbackUsed: false,
  parentAgentImplemented: false,
  roles: [
    ...(materialize ? [{ stage: 'test-materialization', role: 'deliver-from-plan:MaterializeTests', codexAgent: 'claude:agent', spawned: true, completed: true, resultValidated: materialize.doneTrustworthy !== false, threadId: null }] : []),
    ...(implement ? [{ stage: 'implementation', role: 'deliver-from-plan:Implement', codexAgent: 'claude:agent', spawned: true, completed: true, resultValidated: !!implement.passed, threadId: null }] : []),
    ...reviews.map(r => ({ stage: 'review', role: 'independent-reviewer', codexAgent: 'claude:agent', spawned: true, completed: true, resultValidated: !!r.verdict, threadId: null })),
    ...(fix ? [{ stage: 'fix', role: 'deliver-from-plan:Fix', codexAgent: 'claude:agent', spawned: true, completed: true, resultValidated: !!fix.passed, threadId: null }] : []),
    ...(verify ? [{ stage: 'verification', role: 'deliver-from-plan:Verify', codexAgent: 'claude:agent', spawned: true, completed: true, resultValidated: !!verify.donePassedVerified, threadId: null }] : []),
    ...(browserResult ? [{ stage: 'browser-verification', role: 'deliver-from-plan:BrowserVerify', codexAgent: 'claude:agent', spawned: true, completed: true, resultValidated: browserResult.status !== 'error', threadId: null }] : []),
  ],
}

// step 2：确定性终态（纯函数；非 halt 路径才重算；diff 也是判定输入 —— #1/#2 不再以 DELIVERED 收尾失败交付）
let statusInput = null
if (!halted) {
  statusInput = {
    priorStatus: finalStatus,
    multiAgent: deliveryAgentExecution,
    implementPassed: !!(implement && implement.passed),
    verify: verify ? { donePassedVerified: verify.donePassedVerified, scopeCleanVerified: verify.scopeCleanVerified, redGreenVerified: verify.redGreenVerified, testsIntact: verify.testsIntact } : null,
    reviews: reviews.map(r => ({ verdict: r.verdict, blocking: r.blocking })),
    reviewIncomplete,
    materializeOpenLoopItems: materialize ? materialize.openLoopItems : [],
    gateOpenQuestions: (gate && gate.openQuestions) || [],
    gateRemainingGaps: (gate && gate.remainingGaps) || [],
    staleSeverity: staleCmp ? staleCmp.severity : null,
    filesReconcileIssues: filesReconcile.issues,
    diff: (scaffold && scaffold.runDir) ? diffResult : null,
    browser: browserResult ? { applicable: browserResult.applicable, status: browserResult.status, openItems: browserResult.openItems } : null,
    codeQuality: codeQuality ? { applicable: codeQuality.applicable, compileRan: codeQuality.compileRan, compilePassed: codeQuality.compilePassed, hasP0Failure: codeQuality.staticChecks.some(c => c.status === 'failed' && c.severity === 'P0'), openItems: cqOpenItems } : null,
  }
  const sr = computeDeliverStatus(statusInput)
  finalStatus = sr.finalStatus
  sr.reasons.forEach(note)
}

// step 3：据最终事实构建 manifest（filesChanged 以独立验证为准 —— #3；记录 diff apply-check 结果）
const verifiedChanged = (verify && Array.isArray(verify.changedFilesVerified) && verify.changedFilesVerified.length) ? verify.changedFilesVerified : null
// filesReconcile 已在终态计算前求值（见上，P1.4），此处直接复用
const deliverManifest = {
  schemaVersion: '1.0',
  workflow: 'deliver-from-plan', planDir, targetRepo: targetRepoArg || (gate && gate.manifestTarget) || null,
  finalStatus, mode, modeLenses: CFG.lenses,
  gate: gate ? { finalStatus: gate.finalStatus, readinessForDev: gate.readinessForDev, requirementGoal: gate.requirementGoal } : null,
  scope: scaffold ? { scopeFiles: scaffold.scopeFiles, optionalScopeFiles: scaffold.optionalScopeFiles } : null,
  doneCommand: materialize ? materialize.doneCommand : null,
  doneTrustworthy: trustworthy,
  doneTrustEvidence: materialize ? { redCommand: materialize.redCommand, regressionCommand: materialize.regressionCommand, newFeatureTestsFailOnCurrent: materialize.newFeatureTestsFailOnCurrent, regressionTestsPassOnCurrent: materialize.regressionTestsPassOnCurrent, redExitCode: materialize.redExitCode, testsFingerprint: materialize.testsFingerprint } : null,
  implementPassed: !!(implement && implement.passed),
  filesChanged: verifiedChanged || (diffResult ? diffResult.filesChanged : []) || (implement ? implement.filesChanged : []),
  filesChangedSource: verifiedChanged ? 'independent-verify' : ((diffResult && diffResult.filesChanged.length) ? 'diff' : 'implementer-self-report'),
  scopeViolations: implement ? implement.scopeViolations : [],
  redLine: implement && implement.redLineHit ? implement.redLineReason : null,
  diffApplyCheckPassed: diffResult ? diffResult.diffApplyCheckPassed : null,
  diffStat: diffResult ? diffResult.diffStat : null,
  reviewVerdicts: reviews.map(r => ({ lens: r.lens, verdict: r.verdict, severity: r.severity, blocking: r.blocking })),
  fix: fix ? { passed: fix.passed, donePassed: fix.donePassed, stillOpen: fix.stillOpen } : null,
  fixHistory,
  reviewComplete: !reviewIncomplete,
  independentVerify: verify ? { donePassedVerified: verify.donePassedVerified, doneExitCodeVerified: verify.doneExitCodeVerified, redGreenVerified: verify.redGreenVerified, independentTestsPassed: verify.independentTestsPassed, testsIntact: verify.testsIntact, scopeCleanVerified: verify.scopeCleanVerified } : null,
  multiAgent: deliveryAgentExecution,
  browserVerify: browserResult ? { applicable: browserResult.applicable, finalBrowserStatus: browserResult.finalBrowserStatus, adapterUsed: browserResult.value ? browserResult.value.adapterUsed : null, evidenceDir: browserResult.value ? browserResult.value.evidenceDir : null, checksPassed: browserResult.value ? browserResult.value.checks.filter(c => c.passed).length : 0, checksTotal: browserResult.value ? browserResult.value.checks.length : 0, consoleErrorCount: browserResult.value ? browserResult.value.consoleErrors.length : 0, failedKeyRequests: browserResult.value ? browserResult.value.failedKeyRequests : [], screenshots: browserResult.value ? browserResult.value.screenshots : [] } : null,
  codeQuality: codeQuality ? { applicable: codeQuality.applicable, specSource: codeQuality.specSource, language: codeQuality.language, buildTool: codeQuality.buildTool, compileRan: codeQuality.compileRan, compilePassed: codeQuality.compilePassed, compileCommand: codeQuality.compileCommand, compileExitCode: codeQuality.compileExitCode, compileOutputTail: codeQuality.compileOutputTail, staticChecks: codeQuality.staticChecks.map(c => ({ tool: c.tool, command: c.command, exitCode: c.exitCode, status: c.status, severity: c.severity, outputTail: c.outputTail })), introducedNewTool: codeQuality.introducedNewTool, summary: codeQuality.summary } : null,
  openItems: [
    ...(materialize ? materialize.openLoopItems : []),
    ...((gate && gate.openQuestions) || []).map(q => `方案待确认: ${q}`),
    ...((gate && gate.remainingGaps) || []).map(g => `方案遗留: ${g}`),
    ...reviews.filter(r => r.verdict === 'needs-work').flatMap(r => r.findings.map(f => `审查未关闭[${r.lens}/${r.severity}]: ${f}`)),
    ...(verify && verify.redGreenVerified === false ? ['独立"先红后绿"未复现：DONE 可信度未独立确认'] : []),
    ...(verify && verify.independentTestsPassed === false ? ['独立复测未过：实现未满足验收或改测试迁就实现（已 BLOCKED）'] : []),
    ...(verify && verify.testsIntact === false ? ['在树 tests/ 指纹与物化时不一致（疑似被改动），需人工核对'] : []),
    ...((browserResult && browserResult.openItems) || []),
    ...cqOpenItems,
    ...(diffResult && diffResult.diffApplyCheckPassed === false ? ['diff 未通过 git apply --check'] : []),
    ...(staleCmp && staleCmp.severity === 'soft' ? ['目标仓库 soft stale：有未提交改动差异（方案基于略有不同的工作区）'] : []),
    ...filesReconcile.issues.map(s => `变更文件对账: ${s}`),
  ],
  stalePlan: staleCmp ? { severity: staleCmp.severity, changed: staleCmp.changed, reasons: staleCmp.reasons } : null,
  filesReconcile: { consistent: filesReconcile.consistent, issues: filesReconcile.issues },
  failedStages,
}
// R2-1 持久化协议：persistVerification.ok 初始【必须 false】；仅在"完整写入→独立回读→内容深度一致"后才原子升 true，
// 升后再回读确认；任一不过则保持/退回 false。下游 publish 对【非 true（含缺失）】默认拒绝（除非 allowLegacyUnverifiedDelivery）。
deliverManifest.persistVerification = { ok: false, readbackOk: null, diskFinalStatus: null, contentConsistent: null }

// step 4：落盘（diff 已生成；本步只写 manifest/报告/日志，不重新生成 diff）
if (scaffold && scaffold.runDir) {
  const dl = await callAgent(
    `你负责把交付产物落盘（只在 ${scaffold.runDir} 内写，绝不动原仓库、绝不 commit/push）。${SAFETY}\n` +
    `changes.diff 已由上一步生成（git apply --check=${diffResult ? diffResult.diffApplyCheckPassed : 'N/A'}），不要重新生成或修改它。最终状态已确定为 ${finalStatus}，原样写入、不要更改。\n` +
    `步骤：\n` +
    `1) 写 ${scaffold.runDir}/delivery-manifest.json（规范 JSON，用下方对象原样写入）。\n` +
    `2) 写 ${scaffold.runDir}/delivery-report.md（中文）：含 1 最终状态(=${finalStatus}) 2 来源方案 3 就绪闸门结果 4 DONE 命令与"先红后绿"可信证据 5 变更文件(filesChanged，来源=${deliverManifest.filesChangedSource})与 SCOPE 合规 6 diff apply check 结果(=${diffResult ? diffResult.diffApplyCheckPassed : 'N/A'}；未通过须写明这就是未给 DELIVERED 的原因) 7 各视角审查结论(逐视角列 verdict 与 severity：P0=阻断/P1=开环/P2=记录) 8 代码质量与静态检查(取 manifest.codeQuality：specSource[阿里占位须如实写"未接入"]、编译/构建结果与命令/退出码、逐个静态工具的命令/退出码/状态/severity、是否引入新工具；无既有工具则写"如实跳过"及剩余风险——绝不声称已检查) 9 修复 10 开环人工核对项(逐条) 11 红线/越界停点(若有) 12 如何应用 diff(人工 patch 步骤) + 明确"桥接未 commit/merge"。\n` +
    `3) 写 ${scaffold.runDir}/execution-log.md（用下方日志数组）。\n` +
    `4) 写 ${scaffold.runDir}/residual-verification.md：把 manifest.openItems 每个开环/未验证项整理成"换到具备相应环境的机器上照着做即可闭环"的【可执行清单】（无 pwsh 的 .ps1 → 给装 pwsh 后的命令/对拍；需特定运行时的用例 → 给环境与命令；待拍板歧义 → 列成待确认问题）。\n` +
    `回报 ok/absOutDir/written(文件名列表)/note。\n` +
    `delivery-manifest(JSON):\n${JSON.stringify(deliverManifest)}\nexecution-log(JSON):\n${JSON.stringify(execLog)}`,
    { schema: DELIVER_SCHEMA, label: 'deliver-persist', phase: 'Deliver', agentType: AT, effort: 'medium' }, true)   // 落盘逐字写大 JSON：不降级，保真
  deliver = dl.ok
    ? { ...dl.value, diffStat: diffResult ? diffResult.diffStat : '', filesChanged: deliverManifest.filesChanged, diffApplyCheckPassed: diffResult ? diffResult.diffApplyCheckPassed : false }
    : { ok: false, absOutDir: scaffold.runDir, written: [], note: dl.error, diffStat: '', filesChanged: [], diffApplyCheckPassed: false }
  note(`Deliver 落盘：${deliver.ok ? '已写入 ' + deliver.absOutDir + '（' + deliver.written.length + ' 文件）' : '失败：' + deliver.note}`)

  // R2-1 步骤①：独立回读 —— 磁盘真实存在/可解析、finalStatus 一致、内容深度一致（filesChanged/diffApplyCheckPassed 逐一吻合）。
  let readbackOk = false, diskFinalStatus = '', contentConsistent = false
  if (deliver.ok) {
    const rb = await callAgent(
      `你是独立校验者，只读不写。检查 ${scaffold.runDir}/delivery-manifest.json：(1) 真实存在且非空、能 JSON.parse；(2) 取顶层 finalStatus；(3) 内容深度一致——其 finalStatus 是否 === "${finalStatus}"、filesChanged 是否逐一等于 ${JSON.stringify(deliverManifest.filesChanged)}、diffApplyCheckPassed 是否 === ${JSON.stringify(deliverManifest.diffApplyCheckPassed)}（全部吻合才 contentConsistent=true）。回报 readbackOk/diskFinalStatus/contentConsistent/note。绝不创建或修改任何文件。`,
      { schema: DELIVER_READBACK_SCHEMA, label: 'deliver-readback', phase: 'Deliver', agentType: AT, effort: 'low' }, true)
    if (rb.ok) { readbackOk = rb.value.readbackOk === true; diskFinalStatus = rb.value.diskFinalStatus || ''; contentConsistent = rb.value.contentConsistent === true }
    else note(`交付落盘回读校验失败：${rb.error}（按未通过校验处理）`)
  }
  deliverManifest.persistVerification.readbackOk = readbackOk
  deliverManifest.persistVerification.diskFinalStatus = diskFinalStatus
  deliverManifest.persistVerification.contentConsistent = contentConsistent
  // 完整写入 + 回读通过 + finalStatus 一致 + 内容深度一致，才有资格把 ok 从 false 升 true
  const writeVerified = !!(deliver && deliver.ok) && readbackOk && diskFinalStatus === finalStatus && contentConsistent

  if (writeVerified) {
    // R2-1 步骤②：原子替换为 ok=true（先写同目录临时文件再 mv 覆盖）
    deliverManifest.persistVerification.ok = true
    const flip = await callAgent(
      `把 ${scaffold.runDir}/delivery-manifest.json 用【原子方式】覆盖写为下面的规范 JSON：先写同目录临时文件（如 delivery-manifest.json.tmp）、写完后 mv 覆盖目标，不改其它文件。回报 ok/absOutDir/written/note。\ndelivery-manifest.json:\n${JSON.stringify(deliverManifest)}`,
      { schema: DELIVER_SCHEMA, label: 'deliver-persist-confirm', phase: 'Deliver', agentType: AT, effort: 'low' }, true)
    // R2-1 步骤③：替换后再次回读，确认磁盘 persistVerification.ok===true 真已落地
    let confirmOk = false
    if (flip.ok) {
      const rb2 = await callAgent(
        `你是独立校验者，只读不写。JSON.parse ${scaffold.runDir}/delivery-manifest.json 后：其 persistVerification.ok 是否 === true、顶层 finalStatus 是否 === "${finalStatus}"。readbackOk 填"persistVerification.ok 是否===true"、diskFinalStatus 填磁盘 finalStatus 值、contentConsistent 填 true 占位。绝不改文件。`,
        { schema: DELIVER_READBACK_SCHEMA, label: 'deliver-persist-confirm-readback', phase: 'Deliver', agentType: AT, effort: 'low' }, true)
      confirmOk = rb2.ok && rb2.value.readbackOk === true && (rb2.value.diskFinalStatus || '') === finalStatus
    }
    if (!confirmOk) { deliverManifest.persistVerification.ok = false; note('⚠ persistVerification 升 ok=true 后再回读未确认（写入/再读未坐实），退回 ok=false。') }
    else note('persistVerification：完整写入→独立回读→内容一致→原子升 ok=true→再回读确认，已坐实。')
  }

  // 最终 persisted = 磁盘 persistVerification.ok 确为 true
  const persisted = deliverManifest.persistVerification.ok === true
  deliverManifest.deliveryPersisted = persisted
  if (!halted && statusInput && !persisted) {
    const sr2 = computeDeliverStatus({ ...statusInput, deliveryPersisted: false })
    if (sr2.finalStatus !== finalStatus) { note(`⚠ 交付落盘/回读未坐实（写验=${writeVerified}，磁盘=${diskFinalStatus || '缺失'}），最终状态由 ${finalStatus} 降级为 ${sr2.finalStatus}。`); finalStatus = sr2.finalStatus; deliverManifest.finalStatus = finalStatus }
    // 降级时原子回写磁盘（临时文件+mv），使磁盘 finalStatus + persistVerification.ok=false 与返回值一致
    if (deliver && deliver.ok) {
      const pf = await callAgent(
        `把 ${scaffold.runDir}/delivery-manifest.json 用原子方式（同目录临时文件+mv 覆盖）写为下面的规范 JSON，不改其它文件。回报 ok/absOutDir/written/note。\ndelivery-manifest.json:\n${JSON.stringify(deliverManifest)}`,
        { schema: DELIVER_SCHEMA, label: 'deliver-manifest-fix', phase: 'Deliver', agentType: AT, effort: 'low' }, true)
      note(`回写磁盘 manifest（降级）：${pf.ok ? '已更新为 ' + finalStatus + '（persistVerification.ok=false）' : '失败：' + pf.error}`)
    }
  }
} else {
  note('未建立 runDir（就绪闸门或前置失败），无产物可落盘。')
  deliverManifest.deliveryPersisted = null
}

log(`deliver-from-plan 完成。最终状态=${finalStatus}；DONE可信=${trustworthy}；实现全绿=${!!(implement && implement.passed)}；审查 ${reviews.length} 视角；开环遗留 ${deliverManifest.openItems.length} 项；失败阶段 [${failedStages.join(', ') || '无'}]。`)

return { finalStatus, runDir: scaffold ? scaffold.runDir : null, gate, scaffold, materialize, trustworthy, implement, reviews, fix, deliver, manifest: deliverManifest }
