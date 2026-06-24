// analyze-repo —— 有证据、可追踪、有失败处理、能自动返工复评的仓库分析 Workflow（只读分析，不改目标代码）
//
// 运行（路径与输出目录全部经 args 传入，脚本内不硬编码个人绝对路径）。Quick Start 见 .claude/workflows/README.md：
//   Workflow({ scriptPath: ".../.claude/workflows/analyze-repo.js", args: {
//     target: "<目标目录，必填>",
//     mode: "standard",                 // 运行档位：lite(快/省) | standard(默认/均衡) | deep(深/全)
//     taskDescription: "<任务描述>",
//     maxComponents: undefined,         // 覆盖 mode 默认的组件数；不填用 mode 预设(lite3/std5/deep8)
//     outDir: "<输出根目录>",            // 落盘根目录（persist 子代理在其下建带时间戳子目录）；缺省 "evidence/runs"
//     useCustomAgents: false,           // true 仅当从 workflow/ 目录启动 Claude（否则自定义 agentType 无法解析，见下）
//     runVerification: false,           // 默认关闭：只读分析。开启才进入受限 Verify 阶段（命令由 JS 白名单硬校验）
//     maxReworkRounds: undefined,       // 覆盖 mode 默认的评审-返工上限(lite0/std1/deep2)，防无限循环
//     // —— 故障注入验证（用于自检控制流，产物会显式标注为测试，绝不冒充真实分析）——
//     forceFirstVerdict: null,          // 'CONDITIONAL_PASS'|'FAIL'：演练返工链路
//     injectComponentFailureIndex: null,// 让第 i 个组件分析失败，演练降级
//     injectVerifyCommands: null        // 字符串数组：演练 Verify 的 JS 白名单（含危险命令以验证被拒）
//   }})
//
// 运行时事实（已在本机 2.1.186 探针证实，2026-06-23）：自定义 agentType（.claude/agents/*.md）
//   仅在“从含该 .claude 的项目目录启动 Claude”时进注册表；通过 scriptPath 从他处运行时
//   `agentType:'repo-analyst'` 会报 “agent type not found”。故本脚本默认用内置 agentType
//   （general-purpose/Explore）+ 注入“对应 .claude/agents/X.md 角色说明”等效复用其定义；
//   useCustomAgents:true 时才改用自定义 agentType。绝不假装已接入。

export const meta = {
  name: 'analyze-repo',
  description: '仓库/软件只读分析：前置校验→理解→扫描→组件优选→分析→风险→测试方案→独立审查→(返工/复评)→(可选验证)→报告，全程证据可追踪、失败可降级',
  whenToUse: '需要在不改动目标代码的前提下，产出带证据链、可追踪、经独立审查与有界返工的仓库分析报告时',
  phases: [
    { title: 'Preflight', detail: '校验 target/args，确认可读' },
    { title: 'Understand', detail: '目标/范围/非目标/验收信号' },
    { title: 'Scan', detail: '只读扫描结构、组件、构建测试命令' },
    { title: 'Select', detail: '按相关性/入口/风险面优选组件，记录被排除项与覆盖风险' },
    { title: 'Analyze', detail: '并行分析选中组件（带证据/置信度，单个失败可降级）' },
    { title: 'Risk', detail: '全局风险识别（每条带 id/证据/验证状态）' },
    { title: 'TestPlan', detail: '测试用例引用风险 id，形成追踪链' },
    { title: 'Review', detail: '独立审查（含每轮复评，全新实例不自评）' },
    { title: 'Rework', detail: '非 PASS 时按 mustFix 补充分析（不改目标代码）' },
    { title: 'Verify', detail: '可选、默认关闭：白名单内安全命令执行' },
    { title: 'Report', detail: '只汇总既有结果，含追踪矩阵与最终状态' },
    { title: 'Persist', detail: '子代理把产物写入带时间戳的运行目录' },
  ],
}

// ===================== 参数 =====================
// 运行时事实（本机 2.1.186 探针证实，2026-06-23）：Workflow 的 args 传到脚本里是 **JSON 字符串**，
// 不是已解析对象（typeof args === 'string'）。因此必须先 JSON.parse；下面兼容字符串/对象/缺省三种情况。
const A = (() => {
  let a = args
  if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } }
  return (a && typeof a === 'object') ? a : {}
})()
// ---- 运行档位 mode：lite / standard / deep（控制成本与深度；显式 args 逐项可覆盖）----
// [同源块·勿单边改] 与 plan-from-requirement.js 的 MODE_PRESETS 字节级一致；改此处务必同步另一脚本（详见 docs/04 同源块说明）
const MODE_PRESETS = {
  lite:     { maxComponents: 3, maxRework: 0, effortAnalyze: 'low',    effortHeavy: 'medium' },
  standard: { maxComponents: 5, maxRework: 1, effortAnalyze: 'medium', effortHeavy: 'high' },
  deep:     { maxComponents: 8, maxRework: 2, effortAnalyze: 'high',   effortHeavy: 'high' },
}
const MODE = MODE_PRESETS[String(A.mode || 'standard').toLowerCase()] ? String(A.mode || 'standard').toLowerCase() : 'standard'
const P = MODE_PRESETS[MODE]

const target = A.target ? String(A.target) : null
const taskDescription = A.taskDescription ||
  '对目标做只读分析，产出带证据的风险与测试验证方案及最终报告（不改目标代码）。'
const MAX = Number(A.maxComponents) > 0 ? Number(A.maxComponents) : P.maxComponents
const outDirBase = A.outDir ? String(A.outDir) : 'evidence/runs'
const useCustom = !!A.useCustomAgents
const runVerification = !!A.runVerification
const MAX_REWORK = (Number.isFinite(Number(A.maxReworkRounds)) && Number(A.maxReworkRounds) >= 0) ? Number(A.maxReworkRounds) : P.maxRework
const forceFirstVerdict = A.forceFirstVerdict || null
const injectFailIdx = Number.isInteger(A.injectComponentFailureIndex) ? A.injectComponentFailureIndex : -1
const injectVerifyCommands = Array.isArray(A.injectVerifyCommands) ? A.injectVerifyCommands.map(String) : null
const EFFORT = { light: 'low', analyze: P.effortAnalyze, heavy: P.effortHeavy }

// ---- 安全命令白名单：由 JS 硬校验（不依赖 Agent 自觉）。命令必须以白名单只读前缀起头，且不含危险 token/shell 元字符 ----
const CMD_WHITELIST = ['bash -n', 'node --check', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'file', 'git status', 'git diff --stat', 'git log', 'shellcheck', 'cmake --version']
const CMD_DENY = [/[>|]/, /&&|\|\||;|`|\$\(/, /-delete\b/, /-exec(dir)?\b/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\bdd\b/, /\bsudo\b/, /\bchmod\b/, /\bchown\b/, /\bln\b/, /\bmkfs/, /\bkill\b/, /\bapt\b/, /\bpip\b/, /\bnpm\b/, /\bmake\b/, /\bcurl\b/, /\bwget\b/, /\bnc\b/, /\bgit\s+(commit|push|reset|checkout|clean|rm|mv|add|stash)\b/]
function isCommandAllowed(cmd) {
  const c = String(cmd || '').trim()
  if (!c) return false
  if (CMD_DENY.some(re => re.test(c))) return false                 // 危险 token / 重定向 / 管道 / 链接 / 命令替换 → 拒
  return CMD_WHITELIST.some(p => c === p || c.startsWith(p + ' '))   // 必须以只读白名单前缀起头
}

// ===================== 角色 → agentType 映射（含内置降级 + 角色说明） =====================
const ROLES = {
  preflight: { custom: 'repo-analyst', builtin: 'general-purpose', file: 'repo-analyst.md', title: '只读分析专家', brief: '只做前置校验，基于实际命令/读取结果，不臆测。' },
  understand:{ custom: 'repo-analyst', builtin: 'general-purpose', file: 'repo-analyst.md', title: '只读分析专家', brief: '基于实际读到的内容界定范围，区分已确认/推断/待确认。' },
  scan:      { custom: 'repo-analyst', builtin: 'Explore',        file: 'repo-analyst.md', title: '只读分析专家', brief: '只读广搜，列与任务最相关的组件与构建/测试命令。' },
  select:    { custom: 'repo-analyst', builtin: 'general-purpose', file: 'repo-analyst.md', title: '只读分析专家', brief: '按相关性/入口/核心/被依赖/风险面优选组件，记录被排除项。' },
  analyze:   { custom: 'repo-analyst', builtin: 'general-purpose', file: 'repo-analyst.md', title: '只读分析专家', brief: '实际 Read 组件，给出带证据(path/symbol/lineRange/observation)与置信度的发现，不编造行号。' },
  risk:      { custom: 'risk-auditor', builtin: 'general-purpose', file: 'risk-auditor.md', title: '工程风险审计专家', brief: '一致性/状态/幂等并发/权限/边界视角，每条风险带 id 与证据。' },
  testplan:  { custom: 'test-planner', builtin: 'general-purpose', file: 'test-planner.md', title: '测试方案专家', brief: '用例引用风险 id(riskIds)，按风险排序，标注覆盖缺口。' },
  review:    { custom: 'independent-reviewer', builtin: 'general-purpose', file: 'independent-reviewer.md', title: '独立审查者', brief: '未参与产出，只读核查完整性/证据/风险↔测试对应；任何 P0→FAIL；不因规模抬分。' },
  rework:    { custom: 'repo-analyst', builtin: 'general-purpose', file: 'repo-analyst.md', title: '只读分析专家', brief: '按 mustFix 做补充只读分析，补证据/补风险/补用例，不改目标代码。' },
  verify:    { custom: 'verification-runner', builtin: 'general-purpose', file: 'verification-runner.md', title: '验证命令执行器', brief: '只跑白名单安全命令，记录退出码与输出，不打分。' },
  report:    { custom: 'repo-analyst', builtin: 'general-purpose', file: 'repo-analyst.md', title: '只读分析专家', brief: '只汇总既有分析与评审结果，不新增未经分析的结论。' },
  persist:   { custom: 'general-purpose', builtin: 'general-purpose', file: '(内置)', title: '落盘代理', brief: '把产物写入运行目录。' },
}
function resolveType(k) { return useCustom ? ROLES[k].custom : ROLES[k].builtin }
function roleBrief(k) {
  const r = ROLES[k]
  if (useCustom) return `\n（你承担 .claude/agents/${r.file} 定义的「${r.title}」角色。）`
  return `\n（角色说明：你承担 .claude/agents/${r.file} 定义的「${r.title}」角色：${r.brief} 本次因运行环境不支持自定义 agentType，以内置 ${r.builtin} + 本说明等效复用该定义。）`
}

// ===================== 执行辅助：失败/重试/降级 =====================
const execLog = []
function note(m) { execLog.push(m); log(m) }

// [同源块·勿单边改] callAgent 在 plan-from-requirement.js / deliver-from-plan.js 同源；改此处需同步其它脚本
async function callAgent(prompt, opts, required) {
  const attempts = required ? 2 : 1   // 必需阶段失败自动重试一次
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
async function roleAgent(roleKey, prompt, { schema, label, phase: ph, required, effort }) {
  const opts = { schema, label, phase: ph, agentType: resolveType(roleKey) }
  if (effort) opts.effort = effort
  return callAgent(prompt + roleBrief(roleKey), opts, required)
}
function halt(stage, reason) { const e = new Error(`HALT@${stage}: ${reason}`); e.__halt = { stage, reason }; throw e }

// ===================== Schemas =====================
const EVIDENCE = { type: 'object', additionalProperties: false, properties: {
  path: { type: 'string' }, symbol: { type: 'string' },
  lineRange: { type: 'string', description: '如 "88-126"；不确定填 "unknown"，严禁编造' },
  observation: { type: 'string' },
}, required: ['path', 'lineRange', 'observation'] }

const ITEM = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', description: '如 RISK-001 / FND-001' },
  area: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
  description: { type: 'string' }, impact: { type: 'string' }, mitigation: { type: 'string' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  verificationStatus: { type: 'string', enum: ['static-analysis-only', 'verified', 'unverified'],
    description: 'static-analysis-only=仅静态推断；verified=分析/返工期已在隔离环境实测复现(非 Verify 阶段)；unverified=未做。注意它与受控 Verify 阶段(runVerification)是两回事。' },
  evidence: { type: 'array', items: EVIDENCE },
}, required: ['id', 'area', 'severity', 'description', 'impact', 'mitigation', 'confidence', 'verificationStatus', 'evidence'] }

const PREFLIGHT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  targetExists: { type: 'boolean' }, isReadable: { type: 'boolean' }, kind: { type: 'string' }, note: { type: 'string' },
}, required: ['targetExists', 'isReadable', 'kind', 'note'] }

const UNDERSTAND_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  goal: { type: 'string' }, inScope: { type: 'array', items: { type: 'string' } },
  outOfScope: { type: 'array', items: { type: 'string' } }, acceptanceSignals: { type: 'array', items: { type: 'string' } },
  assumptions: { type: 'array', items: { type: 'string' } }, openQuestions: { type: 'array', items: { type: 'string' } },
}, required: ['goal', 'inScope', 'outOfScope', 'acceptanceSignals', 'assumptions', 'openQuestions'] }

const SCAN_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  overview: { type: 'string' }, kind: { type: 'string' },
  components: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string' }, path: { type: 'string' }, kind: { type: 'string' }, purpose: { type: 'string' },
  }, required: ['name', 'path', 'kind', 'purpose'] } },
  buildTestCommands: { type: 'array', items: { type: 'string' } }, entryPoints: { type: 'array', items: { type: 'string' } },
}, required: ['overview', 'kind', 'components', 'buildTestCommands', 'entryPoints'] }

const SELECT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  selected: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string' }, path: { type: 'string' }, reason: { type: 'string' },
    signals: { type: 'array', items: { type: 'string' }, description: '相关性/入口/核心/被依赖/状态权限写入外调/安全一致性 等命中信号' },
  }, required: ['name', 'path', 'reason', 'signals'] } },
  dropped: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string' }, path: { type: 'string' }, reason: { type: 'string' },
  }, required: ['name', 'path', 'reason'] } },
  selectionReason: { type: 'string' }, coverageRisk: { type: 'string' },
}, required: ['selected', 'dropped', 'selectionReason', 'coverageRisk'] }

const COMPONENT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  component: { type: 'string' }, path: { type: 'string' }, responsibility: { type: 'string' },
  keyFiles: { type: 'array', items: { type: 'string' } }, keySymbols: { type: 'array', items: { type: 'string' } },
  dependencies: { type: 'array', items: { type: 'string' } },
  findings: { type: 'array', items: ITEM }, risks: { type: 'array', items: ITEM },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}, required: ['component', 'path', 'responsibility', 'keyFiles', 'keySymbols', 'dependencies', 'findings', 'risks', 'confidence'] }

const RISK_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  risks: { type: 'array', items: ITEM },
  consistencyChecks: { type: 'array', items: { type: 'string' } },
  idempotencyConcerns: { type: 'array', items: { type: 'string' } },
  boundaryCases: { type: 'array', items: { type: 'string' } },
}, required: ['risks', 'consistencyChecks', 'idempotencyConcerns', 'boundaryCases'] }

const TESTCASE = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string' }, priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
  riskIds: { type: 'array', items: { type: 'string' } }, scenario: { type: 'string' },
  preconditions: { type: 'array', items: { type: 'string' } }, steps: { type: 'array', items: { type: 'string' } },
  expected: { type: 'string' }, verificationType: { type: 'string' },
}, required: ['id', 'priority', 'riskIds', 'scenario', 'preconditions', 'steps', 'expected', 'verificationType'] }

const TESTPLAN_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  testStrategy: { type: 'string' }, cases: { type: 'array', items: TESTCASE },
  verificationCommands: { type: 'array', items: { type: 'string' } }, coverageGaps: { type: 'array', items: { type: 'string' } },
}, required: ['testStrategy', 'cases', 'verificationCommands', 'coverageGaps'] }

const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  verdict: { type: 'string', enum: ['PASS', 'CONDITIONAL_PASS', 'FAIL'] }, score: { type: 'integer', minimum: 0, maximum: 100, description: '0–100 的整数评分；禁用 0–10 刻度' }, summary: { type: 'string' },
  requirementsCoverage: { type: 'array', items: { type: 'string' } },
  p0: { type: 'array', items: { type: 'string' } }, p1: { type: 'array', items: { type: 'string' } }, p2: { type: 'array', items: { type: 'string' } },
  mustFix: { type: 'array', items: { type: 'string' } }, missingEvidence: { type: 'array', items: { type: 'string' } },
  affectedPhases: { type: 'array', items: { type: 'string' } }, remainingRisks: { type: 'array', items: { type: 'string' } },
  readyForReport: { type: 'boolean' },
}, required: ['verdict', 'score', 'summary', 'requirementsCoverage', 'p0', 'p1', 'p2', 'mustFix', 'missingEvidence', 'affectedPhases', 'remainingRisks', 'readyForReport'] }

const REWORK_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  addressed: { type: 'array', items: { type: 'string' } }, stillOpen: { type: 'array', items: { type: 'string' } },
  addedRisks: { type: 'array', items: ITEM }, addedTestCases: { type: 'array', items: TESTCASE },
  supplementalNotes: { type: 'array', items: { type: 'string' } }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}, required: ['addressed', 'stillOpen', 'addedRisks', 'addedTestCases', 'supplementalNotes', 'confidence'] }

const VERIFY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  results: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    command: { type: 'string' }, allowed: { type: 'boolean' }, exitCode: { type: 'number' },
    stdoutTail: { type: 'string' }, stderrTail: { type: 'string' },
    status: { type: 'string', enum: ['ran', 'refused', 'timeout', 'error'] }, note: { type: 'string' },
  }, required: ['command', 'allowed', 'exitCode', 'stdoutTail', 'stderrTail', 'status', 'note'] } },
  summary: { type: 'string' },
}, required: ['results', 'summary'] }

const REPORT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  markdown: { type: 'string' }, headline: { type: 'string' }, topRisks: { type: 'array', items: { type: 'string' } },
}, required: ['markdown', 'headline', 'topRisks'] }

const PERSIST_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, absOutDir: { type: 'string' }, written: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'absOutDir', 'written', 'note'] }

const BASE = `目标对象路径: ${target}\n任务描述: ${taskDescription}\n这是只读分析，禁止修改目标代码。所有结论必须基于实际读到的内容；读不到/不确定要明确标注，绝不臆测、绝不编造行号(不确定填 "unknown")。中文输出，只返回结构化结果。`

// ===================== 运行状态收集 =====================
const failedStages = []
const reviewHistory = []
const reworkHistory = []
let finalStatus = 'PASS'
let consistency = null   // 确定性产物一致性校验结果（模块作用域，便于 catch 外的 manifest 引用）

function passedReview(rev) { return !!rev && rev.verdict === 'PASS' && (rev.p0 || []).length === 0 }

// 确定性产物一致性校验（纯 JS，不依赖 agent；在状态计算后调用）
function runConsistencyChecks() {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail: detail || '' })
  const totalScanned = (scan && scan.components || []).length
  add('coverage 单调: analyzed ≤ selected ≤ scanned',
    componentAnalyses.length <= selectedComps.length && selectedComps.length <= totalScanned,
    `analyzed=${componentAnalyses.length} selected=${selectedComps.length} scanned=${totalScanned}`)
  // riskId 全集 = 全局风险 ∪ 组件级风险，避免合法的组件级 RISK-id 被误判为悬挂引用
  const riskIds = new Set([...(risk && risk.risks || []).map(r => r.id), ...componentAnalyses.flatMap(c => (c.risks || []).map(r => r.id))])
  const dangling = []
  for (const c of (testPlan && testPlan.cases || [])) for (const rid of (c.riskIds || [])) if (rid && !riskIds.has(rid)) dangling.push(`${c.id}→${rid}`)
  add('追踪链完整: 用例 riskIds 均存在于风险表', dangling.length === 0, dangling.length ? '悬挂引用: ' + dangling.slice(0, 8).join(', ') : '全部命中')
  const riskNoEv = (risk && risk.risks || []).filter(r => (r.evidence || []).length === 0).map(r => r.id)
  add('证据完整: 每条风险≥1 条证据', riskNoEv.length === 0, riskNoEv.length ? '缺证据: ' + riskNoEv.slice(0, 8).join(', ') : 'ok')
  const p0n = review ? (review.p0 || []).length : 0
  add('状态语义: 有 P0 不得判 PASS/PARTIAL/CONDITIONAL', !(p0n > 0 && ['PASS', 'PARTIAL', 'CONDITIONAL'].includes(finalStatus)), `p0=${p0n} status=${finalStatus}`)
  add('Verify 合规: 无越过白名单的策略违规', !(verify && (verify.policyViolations || []).length > 0),
    (verify && (verify.policyViolations || []).length) ? '违规命令: ' + verify.policyViolations.join(', ') : 'ok')
  const sc = review ? review.score : null
  add('评分刻度: score 为 0–100 整数且与 verdict 不矛盾(防 0–10 误用)',
    !review || (Number.isInteger(sc) && sc >= 0 && sc <= 100 && !(review.verdict === 'PASS' && sc < 60) && !(review.verdict === 'FAIL' && sc > 80)),
    `score=${sc} verdict=${review ? review.verdict : 'N/A'}`)
  return { ok: checks.every(c => c.ok), checks }
}

// ===================== 主流程 =====================
let understand = null, scan = null, select = null, risk = null, testPlan = null, review = null, verify = null, report = null
let componentAnalyses = [], failedComponents = [], droppedComponents = [], selectedComps = []

try {
  if (!target) halt('Preflight', 'args.target 缺失（必填），无法分析')

  // ---- Preflight ----
  phase('Preflight')
  const pf = await roleAgent('preflight',
    `${BASE}\n\n本阶段=前置校验。用 Bash 检查目标路径是否存在且可读（如 test -d / ls -la / head），判断它是文件还是目录、大致类型。`,
    { schema: PREFLIGHT_SCHEMA, label: 'preflight', phase: 'Preflight', required: true, effort: EFFORT.light })
  if (!pf.ok) { failedStages.push('Preflight'); halt('Preflight', pf.error) }
  if (!pf.value.targetExists || !pf.value.isReadable) halt('Preflight', `目标不可用：${pf.value.note}`)
  note(`Preflight ok：${pf.value.kind} — ${pf.value.note}`)

  // ---- Understand ----
  phase('Understand')
  const u = await roleAgent('understand', `${BASE}\n\n本阶段=任务理解。粗看目标后产出目标/范围内/范围外/验收信号/假设/待确认。`,
    { schema: UNDERSTAND_SCHEMA, label: 'understand', phase: 'Understand', required: true, effort: EFFORT.light })
  if (!u.ok) { failedStages.push('Understand'); halt('Understand', u.error) }
  understand = u.value

  // ---- Scan ----
  phase('Scan')
  const s = await roleAgent('scan', `${BASE}\n\n本阶段=结构扫描(只读)。摸清目录结构，列出主要组件(name/path/kind/purpose)、构建/测试命令、入口点，给一句话总览。`,
    { schema: SCAN_SCHEMA, label: 'scan', phase: 'Scan', required: true, effort: EFFORT.light })
  if (!s.ok) { failedStages.push('Scan'); halt('Scan', s.error) }
  scan = s.value
  const allComponents = scan.components || []

  // ---- Select（替代粗暴 slice）----
  phase('Select')
  if (allComponents.length === 0) {
    note('扫描未发现组件，Select 跳过，后续以“无组件”降级继续。')
    select = { selected: [], dropped: [], selectionReason: '扫描无组件', coverageRisk: '无组件可分析' }
  } else {
    const sel = await roleAgent('select',
      `${BASE}\n\n本阶段=组件优选。从下列组件中，按(1)与任务相关性 (2)是否程序入口 (3)是否核心业务模块 (4)被依赖程度 (5)是否涉及状态/权限/数据写入/外部调用 (6)潜在安全与一致性风险 (7)是否影响主流程，挑出最多 ${MAX} 个最该深入分析的组件；每个选中项说明理由与命中信号；同时列出被排除的重要组件与覆盖风险，避免最终报告误以为已完整覆盖。\n组件清单: ${JSON.stringify(allComponents)}`,
      { schema: SELECT_SCHEMA, label: 'select', phase: 'Select', required: true, effort: EFFORT.analyze })
    if (!sel.ok) { failedStages.push('Select'); halt('Select', sel.error) }
    select = sel.value
    selectedComps = (select.selected || []).slice(0, MAX)
    droppedComponents = select.dropped || []
    note(`Select：选中 ${selectedComps.length}/${allComponents.length}（${selectedComps.map(c => c.name).join(', ')}）；排除 ${droppedComponents.length} 个；覆盖风险：${select.coverageRisk}`)
  }

  // ---- Analyze（并行；单个失败降级）----
  phase('Analyze')
  if (selectedComps.length > 0) {
    // 注：parallel() 的 thunk 若**同步 throw** 会让整个 workflow 崩溃（只有异步 reject 才被收成 null）。
    // 故这里用“返回 null”模拟组件分析失败（与真实失败 agent 返回 null 等价），由下方 forEach 记为降级缺口。
    const results = await parallel(selectedComps.map((c, i) => () => {
      if (i === injectFailIdx) { note(`[测试注入] 组件 ${c.name} 模拟分析失败（返回 null）以演练降级`); return null }
      return roleAgent('analyze',
        `${BASE}\n\n本阶段=组件分析。仅分析组件：${c.name} (${c.path})。实际 Read 后给出: 职责 / 关键文件 / 关键符号 / 依赖 / findings(每条带 id 'FND-xxx'、证据 path·symbol·lineRange·observation、confidence、verificationStatus) / risks(每条带 id 'RISK-xxx'…同结构) / 该组件整体 confidence。行号不确定填 "unknown"，严禁编造。`,
        { schema: COMPONENT_SCHEMA, label: `analyze:${c.name}`, phase: 'Analyze', required: false, effort: EFFORT.analyze })
        .then(r => (r.ok ? r.value : null))
    }))
    results.forEach((r, i) => { if (r) componentAnalyses.push(r); else failedComponents.push(selectedComps[i].name) })
    if (failedComponents.length) note(`组件分析降级：失败 ${failedComponents.length} 个（${failedComponents.join(', ')}），标记为覆盖缺口并继续。`)
  }

  // ---- Risk（必需）----
  phase('Risk')
  const rk = await roleAgent('risk',
    `${BASE}\n\n本阶段=全局风险识别。结合理解/扫描/组件分析，用一致性/状态/幂等并发/权限/异常/边界视角识别风险；每条 risk 必须带唯一 id 'RISK-xxx'、证据(path/symbol/lineRange/observation)、confidence、verificationStatus。\n理解:${JSON.stringify(understand)}\n扫描:${JSON.stringify(scan)}\n组件分析:${JSON.stringify(componentAnalyses)}\n已知覆盖缺口(被排除/失败组件):${JSON.stringify({ droppedComponents, failedComponents })}`,
    { schema: RISK_SCHEMA, label: 'risk', phase: 'Risk', required: true, effort: EFFORT.heavy })
  if (!rk.ok) { failedStages.push('Risk'); halt('Risk', rk.error) }
  risk = rk.value

  // ---- TestPlan（用例引用风险 id）----
  phase('TestPlan')
  const tp = await roleAgent('testplan',
    `${BASE}\n\n本阶段=测试方案。基于风险与组件分析产出用例：每个用例 id/priority/riskIds(引用上面 RISK-xxx)/scenario/preconditions/steps/expected/verificationType；并给总体策略、verificationCommands(只读安全命令优先)、覆盖缺口。形成 风险→测试 的追踪链。\n风险:${JSON.stringify(risk)}\n扫描(构建测试命令):${JSON.stringify(scan)}`,
    { schema: TESTPLAN_SCHEMA, label: 'testplan', phase: 'TestPlan', required: false, effort: EFFORT.analyze })
  testPlan = tp.ok ? tp.value : { testStrategy: '(测试方案阶段失败，降级为空)', cases: [], verificationCommands: [], coverageGaps: ['测试方案生成失败'] }
  if (!tp.ok) { failedStages.push('TestPlan(降级)'); note('TestPlan 失败，降级为空方案并标注缺口。') }

  // ---- Review + 有界返工/复评 ----
  async function doReview(round) {
    return roleAgent('review',
      `你是独立审查者，未参与上述分析，只负责审查其质量（第 ${round} 轮）。${BASE}\n\n` +
      `审查维度：完整性、证据充分性(每条 finding/risk 是否带可核查证据与置信度、有无编造行号)、风险↔测试是否对应(riskIds 串得起来)、被排除/失败组件是否被误当已覆盖、测试是否可执行且按风险排序。\n` +
      `给出 verdict/score(0-100)/summary/requirementsCoverage/p0/p1/p2/mustFix/missingEvidence/affectedPhases(取值用阶段名 Analyze|Risk|TestPlan)/remainingRisks/readyForReport。硬规则：任何 P0→FAIL；关键 P1 未解决不得 PASS；不得因 agent/文档/token 数量抬分。\n` +
      `理解:${JSON.stringify(understand)}\n选组件:${JSON.stringify(select)}\n组件分析:${JSON.stringify(componentAnalyses)}\n失败组件:${JSON.stringify(failedComponents)}\n风险:${JSON.stringify(risk)}\n测试:${JSON.stringify(testPlan)}`,
      { schema: REVIEW_SCHEMA, label: `review-r${round}`, phase: 'Review', required: true, effort: EFFORT.heavy })
  }

  phase('Review')
  if (forceFirstVerdict) {
    // 测试注入：演练返工链路（明确标注为测试，绝不冒充真实评审）
    note(`[测试注入] 首轮评审被强制为 ${forceFirstVerdict} 以演练返工-复评链路；后续复评为真实评审。`)
    review = { verdict: forceFirstVerdict, score: 0, summary: '[测试注入] 强制首轮非 PASS，用于验证返工控制流，非真实评审结论。',
      requirementsCoverage: [], p0: forceFirstVerdict === 'FAIL' ? ['[测试注入] 演练用 P0'] : [],
      p1: ['[测试注入] 要求补充某组件的证据'], p2: [], mustFix: ['[测试注入] 为关键风险补充 path/symbol/lineRange 证据并补对应测试用例'],
      missingEvidence: ['[测试注入] 关键风险缺行号级证据'], affectedPhases: ['Risk', 'TestPlan'], remainingRisks: [], readyForReport: false }
  } else {
    const r0 = await doReview(0)
    if (!r0.ok) { failedStages.push('Review'); halt('Review', r0.error) }
    review = r0.value
  }
  reviewHistory.push({ round: 0, verdict: review.verdict, score: review.score, p0: review.p0.length, p1: review.p1.length, mustFix: review.mustFix })

  let round = 0
  while (!passedReview(review) && round < MAX_REWORK) {
    round++
    // ---- Rework：按 mustFix 补充只读分析（不改目标代码）----
    phase('Rework')
    const rw = await roleAgent('rework',
      `${BASE}\n\n本阶段=返工补充分析（第 ${round} 轮）。针对评审 mustFix 与 missingEvidence 做**补充只读分析**（可再 Read 目标文件补证据/行号），产出: addressed(已解决项)/stillOpen(仍未解决)/addedRisks(补充的风险,带 id 证据)/addedTestCases(补充用例,带 riskIds)/supplementalNotes。不得修改目标代码。\n` +
      `mustFix:${JSON.stringify(review.mustFix)}\nmissingEvidence:${JSON.stringify(review.missingEvidence)}\naffectedPhases:${JSON.stringify(review.affectedPhases)}\n现有风险:${JSON.stringify(risk.risks)}\n现有用例:${JSON.stringify(testPlan.cases)}`,
      { schema: REWORK_SCHEMA, label: `rework-r${round}`, phase: 'Rework', required: false, effort: EFFORT.heavy })
    if (rw.ok) {
      risk.risks.push(...(rw.value.addedRisks || []))
      testPlan.cases.push(...(rw.value.addedTestCases || []))
      reworkHistory.push({ round, mustFix: review.mustFix, addressed: rw.value.addressed, stillOpen: rw.value.stillOpen, addedRisks: (rw.value.addedRisks || []).length, addedTestCases: (rw.value.addedTestCases || []).length })
      note(`Rework r${round}：已处理 ${rw.value.addressed.length} 项，仍开放 ${rw.value.stillOpen.length} 项，补风险 ${(rw.value.addedRisks || []).length}/补用例 ${(rw.value.addedTestCases || []).length}。`)
    } else {
      reworkHistory.push({ round, mustFix: review.mustFix, addressed: [], stillOpen: ['返工 agent 失败'], addedRisks: 0, addedTestCases: 0 })
      note(`Rework r${round} 失败，记录后继续复评。`)
    }
    // ---- Review again（全新实例）----
    phase('Review')
    const rr = await doReview(round)
    if (!rr.ok) { failedStages.push(`Review-r${round}`); note(`第 ${round} 轮复评失败，停止返工。`); break }
    review = rr.value
    reviewHistory.push({ round, verdict: review.verdict, score: review.score, p0: review.p0.length, p1: review.p1.length, mustFix: review.mustFix })
  }

  // ---- Verify（可选、默认关闭；命令白名单由 JS 硬校验，不依赖 agent 自觉）----
  phase('Verify')
  if (runVerification) {
    // injectVerifyCommands 用于自检白名单（含危险命令以验证被拒）；否则取测试方案里的验证命令
    const VERIFY_CMD_CAP = 12
    const allCandidates = (injectVerifyCommands || testPlan.verificationCommands || [])
    const candidates = allCandidates.slice(0, VERIFY_CMD_CAP)
    if (allCandidates.length > VERIFY_CMD_CAP) note(`Verify：候选命令 ${allCandidates.length} 条，按上限取前 ${VERIFY_CMD_CAP} 条，丢弃 ${allCandidates.length - VERIFY_CMD_CAP} 条（不静默截断）。`)
    const allowedCmds = candidates.filter(isCommandAllowed)        // JS 硬过滤：只有放行的才交给 agent
    const rejectedByJs = candidates.filter(c => !isCommandAllowed(c))
    if (rejectedByJs.length) note(`Verify：JS 白名单拒绝 ${rejectedByJs.length} 条不安全命令 → ${rejectedByJs.join(' | ')}`)
    let agentResults = []
    if (allowedCmds.length) {
      const vr = await roleAgent('verify',
        `${BASE}\n\n本阶段=受限验证执行。下列命令**已由调用方 JS 白名单硬校验通过**，请逐条执行（每条超时 60s，只读），如实返回 command/allowed/exitCode/stdoutTail/stderrTail/status/note；不做质量判断。若你判断某条仍不安全可标 refused。\n命令:${JSON.stringify(allowedCmds)}`,
        { schema: VERIFY_SCHEMA, label: 'verify', phase: 'Verify', required: false, effort: EFFORT.light })
      agentResults = vr.ok ? (vr.value.results || []) : []
    }
    // 防御纵深：对 agent 回报结果再用同一 JS 校验复核，任何越过白名单者标记为策略违规
    const executed = agentResults.map(r => ({ ...r, jsAllowed: isCommandAllowed(r.command), policyViolation: !isCommandAllowed(r.command) }))
    const policyViolations = executed.filter(r => r.policyViolation).map(r => r.command)
    verify = { executed, rejectedByJs, policyViolations,
      summary: `候选 ${candidates.length}；JS 放行 ${allowedCmds.length}、拒绝 ${rejectedByJs.length}；agent 实跑 ${agentResults.length}${policyViolations.length ? `；检出越权 ${policyViolations.length} 条(已标违规)` : ''}。` }
    note(`Verify：JS 放行 ${allowedCmds.length}/${candidates.length}，实跑 ${agentResults.length}，越权 ${policyViolations.length}。`)
  } else {
    verify = { executed: [], rejectedByJs: [], policyViolations: [], summary: 'runVerification=false（默认只读分析，未执行任何命令）。测试计划 ≠ 已验证。' }
  }

  // ---- 计算最终状态（语义）----
  //  FAILED              : 必需阶段失败、流程提前终止（见 catch），无可用分析。
  //  FAILED_WITH_FINDINGS: 跑完全程但确属不合格（复评含任何 P0，或 verdict=FAIL）→ 有产出但不可用。
  //  CONDITIONAL         : 无 P0、但复评为 CONDITIONAL_PASS（有可修 P1，返工上限内未消解）→ 有条件可用，非失败。
  //  PARTIAL             : 复评通过，但存在降级（失败组件、失败的可降级阶段）或一致性校验未全过 → 可用但不完整。
  //  PASS                : 复评通过、无降级、一致性全过。
  //  注：按设计只优选 top-MAX、主动排除(dropped)是正常采样，不算降级；未覆盖项经 coverageRisk/remainingGaps 如实呈现。
  const reviewPassed = passedReview(review)              // PASS 且无 P0
  const hasP0 = review ? (review.p0 || []).length > 0 : true
  const conditional = !reviewPassed && !hasP0 && !!review && review.verdict === 'CONDITIONAL_PASS'
  const hasDegradation = failedComponents.length > 0 || failedStages.length > 0
  if (reviewPassed) finalStatus = hasDegradation ? 'PARTIAL' : 'PASS'
  else if (conditional) finalStatus = 'CONDITIONAL'
  else finalStatus = 'FAILED_WITH_FINDINGS'
  // 确定性产物一致性校验（纯 JS）；不通过则把 PASS 降级为 PARTIAL，并记录
  consistency = runConsistencyChecks()
  if (!consistency.ok) {
    note(`一致性校验未全过：${consistency.checks.filter(c => !c.ok).map(c => c.name).join('；')}`)
    if (finalStatus === 'PASS') finalStatus = 'PARTIAL'
  } else {
    note('一致性校验全过（coverage 单调 / 追踪链完整 / 证据完整 / 状态语义 / Verify 合规）。')
  }

  // ---- Report（只汇总，不新增结论）----
  phase('Report')
  const coverage = { selected: selectedComps.length, analyzed: componentAnalyses.length, dropped: droppedComponents.length, failed: failedComponents.length, totalScanned: allComponents.length }
  const rp = await roleAgent('report',
    `${BASE}\n\n本阶段=最终报告（只汇总既有分析与评审，**不得新增**未经前面分析/评审的新结论）。产出中文 markdown，必须含这些小节：1 任务目标 2 分析范围 3 未分析范围 4 项目结构 5 选择的组件及原因 6 被排除组件与覆盖风险 7 主要发现 8 风险清单 9 风险证据 10 测试方案 11 风险↔测试追踪矩阵(表格: RISK-id | 关联用例 id | 是否覆盖) 12 验证结果 13 评审历史 14 返工历史 15 最终状态 16 未解决问题 17 剩余风险 18 下一步建议。\n` +
    `最终状态:${finalStatus}\n覆盖:${JSON.stringify(coverage)}\n理解:${JSON.stringify(understand)}\n选组件:${JSON.stringify(select)}\n组件分析:${JSON.stringify(componentAnalyses)}\n失败组件:${JSON.stringify(failedComponents)}\n风险:${JSON.stringify(risk)}\n测试:${JSON.stringify(testPlan)}\n验证:${JSON.stringify(verify)}\n评审历史:${JSON.stringify(reviewHistory)}\n返工历史:${JSON.stringify(reworkHistory)}\n最终评审:${JSON.stringify(review)}`,
    { schema: REPORT_SCHEMA, label: 'report', phase: 'Report', required: true, effort: EFFORT.analyze })
  if (!rp.ok) { failedStages.push('Report'); halt('Report', rp.error) }
  report = rp.value

} catch (e) {
  if (e && e.__halt) {
    finalStatus = 'FAILED'
    note(`流程在必需阶段终止：${e.__halt.stage} —— ${e.__halt.reason}。输出已有结果，不伪造后续产物。`)
  } else { throw e }
}

// ===================== Persist（落盘交子代理；脚本体无文件系统访问）=====================
const manifest = {
  workflow: 'analyze-repo', target, taskDescription, mode: MODE,
  params: { mode: MODE, maxComponents: MAX, maxReworkRounds: MAX_REWORK, effort: EFFORT, useCustomAgents: useCustom, runVerification, forceFirstVerdict, injectComponentFailureIndex: injectFailIdx, injectVerifyCommands: injectVerifyCommands || null },
  finalStatus, failedStages, failedComponents, droppedComponents: droppedComponents.map(d => d.name),
  coverage: { totalScanned: (scan && scan.components || []).length, selected: selectedComps.length, analyzed: componentAnalyses.length },
  consistency: consistency || { ok: false, checks: [{ name: '未运行(流程提前终止)', ok: false, detail: '' }] },
  verifySummary: verify ? verify.summary : null,
  reviewHistory, reworkHistory,
  remainingGaps: [...failedComponents.map(n => `组件未分析: ${n}`), ...((review && review.remainingRisks) || []), ((scan && (scan.components || []).length) > selectedComps.length ? '存在未选中组件，未全量覆盖' : ''), ...(consistency && !consistency.ok ? ['产物一致性校验未全过'] : [])].filter(Boolean),
}
const artifacts = {
  'run-manifest.json': manifest,
  'execution-log.md': execLog,
  'understand.json': understand, 'scan.json': scan, 'selected-components.json': select,
  'component-analyses.json': componentAnalyses, 'risks.json': risk, 'test-plan.json': testPlan,
  'verification-result.json': verify, 'review-history.json': reviewHistory, 'rework-history.json': reworkHistory,
  'final-report.md': report ? report.markdown : '(报告未生成：流程在必需阶段终止)',
}

phase('Persist')
const persistPrompt =
  `本阶段=落盘。请把下面的产物写入一个**新的、带时间戳的运行目录**，避免覆盖历史运行。\n` +
  `步骤：(1) 用 Bash 计算时间戳 ts=$(date +%Y%m%d-%H%M%S)；(2) 目标目录 = "${outDirBase}/${'${ts}'}"（相对路径相对你的当前工作目录；请 mkdir -p 并用 realpath 取绝对路径回报）；(3) 把 artifacts 里每个键作为文件名写入该目录（*.json 用规范 JSON、*.md 直接写文本，UTF-8）；(4) 返回 ok / absOutDir(绝对路径) / written(文件名列表) / note。\n` +
  `不要修改目标仓库；只在输出目录内创建文件。\nartifacts(JSON):\n${JSON.stringify(artifacts)}`
const pr = await callAgent(persistPrompt, { label: 'persist', phase: 'Persist', agentType: resolveType('persist'), schema: PERSIST_SCHEMA, effort: EFFORT.light }, true)
const persisted = pr.ok ? pr.value : { ok: false, absOutDir: '(写盘失败)', written: [], note: pr.error }
note(`Persist：${persisted.ok ? '已写入 ' + persisted.absOutDir + '（' + persisted.written.length + ' 个文件）' : '失败：' + persisted.note}`)

// 落盘后：确定性核对“期望写出的文件”是否都已写出（不依赖 agent 自述）
const expectedFiles = Object.keys(artifacts)
// 取 basename 再比：persist 子代理可能返回绝对路径或裸文件名，避免误报"缺失"
const writtenBase = (persisted.written || []).map(w => String(w).split('/').pop())
const missingFiles = expectedFiles.filter(f => !writtenBase.includes(f))
const persistConsistent = persisted.ok && missingFiles.length === 0
note(persistConsistent
  ? `落盘一致性：期望 ${expectedFiles.length} 个文件均已写出。`
  : `⚠ 落盘一致性：${missingFiles.length ? '缺少文件 ' + missingFiles.join(', ') : '落盘失败'}。`)

log(`analyze-repo 完成。mode=${MODE}，最终状态=${finalStatus}；组件 ${componentAnalyses.length}/${selectedComps.length} 分析、风险 ${(risk && risk.risks || []).length}、用例 ${(testPlan && testPlan.cases || []).length}、评审轮次 ${reviewHistory.length}、返工 ${reworkHistory.length}、一致性=${consistency ? (consistency.ok ? 'OK' : '未全过') : 'N/A'}；失败阶段 [${failedStages.join(', ') || '无'}]。`)

return { finalStatus, mode: MODE, manifest, persisted, persistConsistent, missingFiles, consistency, understand, scan, select, componentAnalyses, failedComponents, risk, testPlan, verify, reviewHistory, reworkHistory, review, report }
