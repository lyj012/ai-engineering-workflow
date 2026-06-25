// plan-from-requirement —— 客户需求 → 现有代码分析 → 可执行实现方案（只读；不写客户代码/不提交/不部署）
//
// 定位：客户提出开发需求后，本 Workflow 按需求分析现有项目代码，生成贴合现有架构、开发可直接照做的实现方案报告。
// 与 analyze-repo.js（通用仓库审计）不同：本工作流全程围绕一条具体需求，并按需求复杂度**分级处理**：
//   · 需求模糊 → 澄清闸门：产出"待确认清单"，不猜着出方案（status=NEEDS_CLARIFICATION）。
//   · 简单且无高风险 → 快路径（精简、省成本）。
//   · 中等/复杂/触及高风险（支付/权限/状态机/数据迁移…）→ 完整流程。
// 分级与"何时该问"默认参考本仓库自带 docs/ 与 workflow-designer Skill；如本机另有工程交付 Skill，可用 args.skillDir 显式覆盖。
//
// 运行：
//   Workflow({ scriptPath: ".../.claude/workflows/plan-from-requirement.js", args: {
//     requirement: "<客户需求，必填>", target: "<目标代码仓库，必填>", constraints: ["<约束>"],
//     mode: undefined,                  // 不传则按 Triage 复杂度自动选档(简单lite/中等standard/复杂deep)；传则覆盖
//     outDir: "<输出根目录>",            // 缺省 "evidence/plans"
//     skillDir: ".claude/skills/workflow-designer",
//     maxComponents, maxReworkRounds, useCustomAgents,
//     forceComplexity: null,            // 'simple'|'medium'|'complex' 覆盖自动分级（测试/已知时用）
//     skipClarificationGate: false,     // true 跳过澄清闸门（测试用）
//     forceFirstVerdict, injectComponentFailureIndex  // 故障注入自检（产物标注为测试）
//   }})
// 运行时事实：args 到脚本是 JSON 字符串需 parse；自定义 agentType 从他处 scriptPath 运行无法解析，默认内置 agentType + 角色说明等效复用 .claude/agents/*.md。

export const meta = {
  name: 'plan-from-requirement',
  description: '客户需求驱动：需求理解→分级(澄清闸门/简单快路径/复杂完整流程)→按需求分析现有代码→现状/目标差距→贴合架构的实现方案→风险→测试与验收→独立审查→(返工)→开发可直接实施的方案报告（只读，不写客户代码）',
  whenToUse: '客户提出开发/改造需求，需要在不动代码的前提下产出基于现有代码、含复用/修改/新增与影响面、风险、测试验收且经独立审查的可实施方案；需求模糊时先要澄清',
  phases: [
    { title: 'Preflight', detail: '校验 requirement 与 target 仓库可用' },
    { title: 'Requirement', detail: '需求理解：目标/角色/正常异常流/核心结果/非目标/歧义/验收信号' },
    { title: 'Triage', detail: '分级：清晰度(澄清闸门) + 复杂度(简单/中等/复杂) + 高风险域，参考 Skill 分级' },
    { title: 'Clarify', detail: '需求模糊时：产出待客户确认清单，不出方案' },
    { title: 'Locate', detail: '按需求定位现有相关代码与业务逻辑' },
    { title: 'Analyze', detail: '并行分析相关模块现状：行为/接口/数据/状态/权限（带证据）' },
    { title: 'Gap', detail: '现状与客户目标的差距：缺失/部分/冲突' },
    { title: 'Plan', detail: '实现方案：复用/修改/新增 + 影响面 + 步骤' },
    { title: 'Risk', detail: '方案风险（带证据/回滚）' },
    { title: 'TestPlan', detail: '测试方案 + 验收标准' },
    { title: 'Review', detail: '独立审查：需求理解/代码分析/方案设计是否可靠（含复评）' },
    { title: 'Rework', detail: '非 PASS 时按 mustFix 补充分析/方案（不写客户代码）' },
    { title: 'Report', detail: '汇总为开发可直接实施的方案报告' },
    { title: 'Persist', detail: '子代理把产物写入带时间戳运行目录' },
  ],
}

// ===================== 参数（args 为 JSON 字符串，先 parse）=====================
const A = (() => {
  let a = args
  if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } }
  return (a && typeof a === 'object') ? a : {}
})()
// [同源块·勿单边改] 与 analyze-repo.js 的 MODE_PRESETS 字节级一致；改此处务必同步另一脚本（详见 docs/04 同源块说明）
const MODE_PRESETS = {
  lite:     { maxComponents: 3, maxRework: 0, effortAnalyze: 'low',    effortHeavy: 'medium' },
  standard: { maxComponents: 5, maxRework: 1, effortAnalyze: 'medium', effortHeavy: 'high' },
  deep:     { maxComponents: 8, maxRework: 2, effortAnalyze: 'high',   effortHeavy: 'high' },
}
const requirement = A.requirement ? String(A.requirement) : null
const target = A.target ? String(A.target) : null
const constraints = Array.isArray(A.constraints) ? A.constraints.map(String) : (A.constraints ? [String(A.constraints)] : [])
const outDirBase = A.outDir ? String(A.outDir) : 'evidence/plans'
const SKILL_DIR = A.skillDir ? String(A.skillDir) : '.claude/skills/workflow-designer'
const useCustom = !!A.useCustomAgents
const userMode = MODE_PRESETS[String(A.mode || '').toLowerCase()] ? String(A.mode).toLowerCase() : null
const forceComplexity = ['simple', 'medium', 'complex'].includes(String(A.forceComplexity)) ? String(A.forceComplexity) : null
const skipClarify = !!A.skipClarificationGate
const forceFirstVerdict = A.forceFirstVerdict || null
const injectFailIdx = Number.isInteger(A.injectComponentFailureIndex) ? A.injectComponentFailureIndex : -1

// 深度档位：不传 mode 时由 Triage 复杂度决定；下面先给基线(早期阶段用)，Triage 后按复杂度重算
let MODE, PRE, MAX, MAX_REWORK, EFFORT
function applyDepth(modeName) {
  MODE = MODE_PRESETS[modeName] ? modeName : 'standard'
  PRE = MODE_PRESETS[MODE]
  MAX = Number(A.maxComponents) > 0 ? Number(A.maxComponents) : PRE.maxComponents
  MAX_REWORK = (Number.isFinite(Number(A.maxReworkRounds)) && Number(A.maxReworkRounds) >= 0) ? Number(A.maxReworkRounds) : PRE.maxRework
  EFFORT = { light: 'low', analyze: PRE.effortAnalyze, heavy: PRE.effortHeavy }
}
applyDepth(userMode || 'standard')
const complexityToMode = { simple: 'lite', medium: 'standard', complex: 'deep' }

// 参考文件（仅作分析维度参考，按实际项目动态裁剪，不机械套用；均为仓库内相对路径，可用 args 覆盖 skillDir）
const REF = {
  skill: `${SKILL_DIR}/SKILL.md`,
  requirement: 'docs/11-requirement-to-plan.md',
  delivery: 'docs/12-plan-to-coding-bridge.md',
  risk: 'docs/06-verification-and-retry.md',
}

// ===================== 角色 → agentType =====================
const ROLES = {
  preflight:   { custom: 'repo-analyst',        builtin: 'general-purpose', file: 'repo-analyst.md',        title: '只读分析专家',   brief: '只做前置校验，基于实际命令结果，不臆测。' },
  requirement: { custom: 'requirement-analyst', builtin: 'general-purpose', file: 'requirement-analyst.md', title: '客户需求分析专家', brief: '拆解需求为目标/角色/流/核心结果/非目标/歧义/验收，参考 requirement-analysis 维度但动态裁剪。' },
  triage:      { custom: 'requirement-analyst', builtin: 'general-purpose', file: 'requirement-analyst.md', title: '需求分级判定者',   brief: '判定需求清晰度(是否够出方案)与复杂度(简单/中等/复杂)及高风险域，参考 SKILL.md 分级与升级触发器，但按实际判断。' },
  locate:      { custom: 'repo-analyst',        builtin: 'Explore',         file: 'repo-analyst.md',        title: '只读分析专家',   brief: '按需求关键词/符号在仓库定位相关代码与业务逻辑，只读广搜。' },
  analyze:     { custom: 'repo-analyst',        builtin: 'general-purpose', file: 'repo-analyst.md',        title: '只读分析专家',   brief: '实际 Read 相关模块，给出现状行为/接口/数据/状态/权限/依赖与证据，不编造行号。' },
  gap:         { custom: 'repo-analyst',        builtin: 'general-purpose', file: 'repo-analyst.md',        title: '只读分析专家',   brief: '对比现状与客户目标，逐项判定 缺失/部分/冲突/已满足。' },
  plan:        { custom: 'solution-architect',  builtin: 'Plan',            file: 'solution-architect.md',  title: '实现方案架构师', brief: '产出贴合现有架构、可直接实施的方案：复用/修改/新增 + 影响面 + 有序步骤，参考 delivery-checklist 实现规则但按实际裁剪，不写代码。' },
  risk:        { custom: 'risk-auditor',        builtin: 'general-purpose', file: 'risk-auditor.md',        title: '工程风险审计专家', brief: '识别方案风险，参考 risk-review 维度，每条带 id 与证据，给回滚。' },
  testplan:    { custom: 'test-planner',        builtin: 'general-purpose', file: 'test-planner.md',        title: '测试方案专家',   brief: '产出用例(引用风险 id)与验收标准，按风险排序，标注覆盖缺口。' },
  review:      { custom: 'independent-reviewer',builtin: 'general-purpose', file: 'independent-reviewer.md',title: '独立审查者',     brief: '未参与产出，只读核查需求理解/代码分析/方案设计是否可靠可行；任何 P0→FAIL；不因规模抬分。' },
  rework:      { custom: 'solution-architect',  builtin: 'general-purpose', file: 'solution-architect.md',  title: '实现方案架构师', brief: '按 mustFix 做补充只读分析/方案细化，补证据/风险/用例，不写客户代码。' },
  report:      { custom: 'solution-architect',  builtin: 'general-purpose', file: 'solution-architect.md',  title: '实现方案架构师', brief: '只汇总既有分析/方案/评审，产出开发可直接实施的方案报告，不新增未经分析的结论。' },
  persist:     { custom: 'general-purpose',     builtin: 'general-purpose', file: '(内置)',                 title: '落盘代理',       brief: '把产物写入运行目录。' },
}
function resolveType(k) { return useCustom ? ROLES[k].custom : ROLES[k].builtin }
function roleBrief(k) {
  const r = ROLES[k]
  if (useCustom) return `\n（你承担 .claude/agents/${r.file} 定义的「${r.title}」角色。）`
  return `\n（角色说明：你承担 .claude/agents/${r.file} 定义的「${r.title}」角色：${r.brief} 本次因运行环境不支持自定义 agentType，以内置 ${r.builtin} + 本说明等效复用该定义。）`
}

// ===================== 执行辅助 =====================
const execLog = []
function note(m) { execLog.push(m); log(m) }
// [同源块·勿单边改] callAgent 在 analyze-repo.js / deliver-from-plan.js 同源；改此处需同步其它脚本
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
async function roleAgent(roleKey, prompt, { schema, label, phase: ph, required, effort }) {
  const opts = { schema, label, phase: ph, agentType: resolveType(roleKey) }
  if (effort) opts.effort = effort
  return callAgent(prompt + roleBrief(roleKey), opts, required)
}
function halt(stage, reason) { const e = new Error(`HALT@${stage}: ${reason}`); e.__halt = { stage, reason }; throw e }

// >>> READINESS-START — 与 core/readiness.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/readiness.test.mjs）；勿删本标记与 END 标记
// readinessForDev 由确定性代码从 finalStatus 推导，不由报告 agent 决定（堵死 FAILED/CONDITIONAL + ready 等非法组合）
function computeReadiness(finalStatus) {
  if (finalStatus === 'PASS' || finalStatus === 'PARTIAL') return 'ready'
  if (finalStatus === 'NEEDS_CLARIFICATION') return 'needs-clarification'
  return 'blocked'
}
// <<< READINESS-END

// >>> PERSIST-OUTCOME-START — 与 core/persist-outcome.mjs 同一逻辑（行为由 scripts/self-check.mjs 比对锁定，单测见 scripts/persist-outcome.test.mjs）；勿删本标记与 END 标记
// 落盘后据【独立回读】判定产物是否可靠在盘：缺失/损坏则把乐观状态降级（不信 persist agent 自报的 written）
function computePersistOutcome(input) {
  const i = input || {}
  const expected = Array.isArray(i.expectedFiles) ? i.expectedFiles : []
  const existing = new Set((Array.isArray(i.existing) ? i.existing : []).map(f => String(f).split('/').pop()))
  const unparseable = (Array.isArray(i.unparseable) ? i.unparseable : []).map(f => String(f).split('/').pop())
  const missing = expected.filter(f => !existing.has(f))
  const ok = missing.length === 0 && unparseable.length === 0
  let finalStatus = i.finalStatus
  if (!ok && (finalStatus === 'PASS' || finalStatus === 'PARTIAL')) finalStatus = 'FAILED'
  return { ok, missing, unparseable, finalStatus }
}
// <<< PERSIST-OUTCOME-END

// ===================== Schemas =====================
// >>> SCHEMA-CONTRACT-START — 本区块被 scripts/self-check.mjs 切出求值，与 core/schemas/plan-artifacts.schema.json 结构比对防漂移；勿删本标记与下方 END 标记
const EVIDENCE = { type: 'object', additionalProperties: false, properties: {
  path: { type: 'string' }, symbol: { type: 'string' },
  lineRange: { type: 'string', description: '如 "88-126"；不确定填 "unknown"，严禁编造' }, observation: { type: 'string' },
}, required: ['path', 'lineRange', 'observation'] }
const ITEM = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', description: '如 RISK-001' }, area: { type: 'string' },
  severity: { type: 'string', enum: ['high', 'medium', 'low'] },
  description: { type: 'string' }, impact: { type: 'string' }, mitigation: { type: 'string' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, evidence: { type: 'array', items: EVIDENCE },
}, required: ['id', 'area', 'severity', 'description', 'impact', 'mitigation', 'confidence', 'evidence'] }

const PREFLIGHT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  targetExists: { type: 'boolean' }, isReadable: { type: 'boolean' }, repoKind: { type: 'string' },
  requirementClear: { type: 'boolean' }, note: { type: 'string' },
}, required: ['targetExists', 'isReadable', 'repoKind', 'requirementClear', 'note'] }

const REQUIREMENT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  goal: { type: 'string' }, actors: { type: 'array', items: { type: 'string' } },
  normalFlow: { type: 'array', items: { type: 'string' } }, exceptionFlow: { type: 'array', items: { type: 'string' } },
  coreOutcome: { type: 'string' }, nonGoals: { type: 'array', items: { type: 'string' } },
  ambiguities: { type: 'array', items: { type: 'string' } }, openQuestions: { type: 'array', items: { type: 'string' } },
  successCriteria: { type: 'array', items: { type: 'string' } }, searchHints: { type: 'array', items: { type: 'string' } },
}, required: ['goal', 'actors', 'normalFlow', 'exceptionFlow', 'coreOutcome', 'nonGoals', 'ambiguities', 'openQuestions', 'successCriteria', 'searchHints'] }

const TRIAGE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  clarity: { type: 'string', enum: ['sufficient', 'insufficient'], description: '是否清晰到足以负责任地出方案' },
  blockingQuestions: { type: 'array', items: { type: 'string' }, description: '必须先澄清、否则会实质影响方案的问题' },
  implementationAmbiguities: { type: 'array', items: { type: 'string' }, description: '会实质改变实现行为/接口/数据格式/语义的歧义（如匹配规则、大小写敏感、是否跨目录、字段结构）；非空则必须先澄清、不得直接出方案，也不得仅以 openQuestions 承接' },
  complexity: { type: 'string', enum: ['simple', 'medium', 'complex'] },
  riskFlags: { type: 'array', items: { type: 'string' }, description: '触及的高风险域，如 支付/会员/下载权限/认证/权限/状态机/数据迁移/文件/回调/定时任务/金额；无则 ["none"]' },
  recommendedDepth: { type: 'string', enum: ['lite', 'standard', 'deep'] },
  reasoning: { type: 'string' },
}, required: ['clarity', 'blockingQuestions', 'implementationAmbiguities', 'complexity', 'riskFlags', 'recommendedDepth', 'reasoning'] }

const LOCATE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  overview: { type: 'string' },
  relevant: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string' }, path: { type: 'string' }, whyRelevant: { type: 'string' }, relation: { type: 'string' },
  }, required: ['name', 'path', 'whyRelevant', 'relation'] } },
  entryPoints: { type: 'array', items: { type: 'string' } }, buildTestCommands: { type: 'array', items: { type: 'string' } },
  searchNotes: { type: 'array', items: { type: 'string' } }, possiblyRelevant: { type: 'array', items: { type: 'string' } },
}, required: ['overview', 'relevant', 'entryPoints', 'buildTestCommands', 'searchNotes', 'possiblyRelevant'] }

const COMPONENT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  component: { type: 'string' }, path: { type: 'string' }, currentBehavior: { type: 'string' },
  interfaces: { type: 'array', items: { type: 'string' } }, dataStructures: { type: 'array', items: { type: 'string' } },
  stateAndStatus: { type: 'array', items: { type: 'string' } }, permissions: { type: 'array', items: { type: 'string' } },
  dependencies: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: EVIDENCE },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}, required: ['component', 'path', 'currentBehavior', 'interfaces', 'dataStructures', 'stateAndStatus', 'permissions', 'dependencies', 'evidence', 'confidence'] }

const GAP_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  gaps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    aspect: { type: 'string' }, current: { type: 'string' }, desired: { type: 'string' },
    gapType: { type: 'string', enum: ['missing', 'partial', 'conflicting', 'ok'] }, note: { type: 'string' },
  }, required: ['aspect', 'current', 'desired', 'gapType', 'note'] } },
  summary: { type: 'string' }, overallFeasibility: { type: 'string' },
}, required: ['gaps', 'summary', 'overallFeasibility'] }

const PLAN_PROPS = {
  approach: { type: 'string' },
  reuse: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { target: { type: 'string' }, what: { type: 'string' } }, required: ['target', 'what'] } },
  modify: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, change: { type: 'string' }, why: { type: 'string' } }, required: ['path', 'change', 'why'] } },
  add: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, what: { type: 'string' }, why: { type: 'string' } }, required: ['path', 'what', 'why'] } },
  steps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { order: { type: 'number' }, action: { type: 'string' }, touches: { type: 'array', items: { type: 'string' } } }, required: ['order', 'action', 'touches'] } },
  affected: { type: 'object', additionalProperties: false, properties: {
    modules: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } },
    interfaces: { type: 'array', items: { type: 'string' } }, data: { type: 'array', items: { type: 'string' } },
    state: { type: 'array', items: { type: 'string' } }, permissions: { type: 'array', items: { type: 'string' } },
    frontend: { type: 'array', items: { type: 'string' } }, backend: { type: 'array', items: { type: 'string' } },
  }, required: ['modules', 'files', 'interfaces', 'data', 'state', 'permissions', 'frontend', 'backend'] },
  architectureFit: { type: 'string' }, assumptions: { type: 'array', items: { type: 'string' } },
  alternatives: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { option: { type: 'string' }, whyNot: { type: 'string' } }, required: ['option', 'whyNot'] } },
}
const PLAN_REQUIRED = ['approach', 'reuse', 'modify', 'add', 'steps', 'affected', 'architectureFit', 'assumptions', 'alternatives']
const PLAN_SCHEMA = { type: 'object', additionalProperties: false, properties: PLAN_PROPS, required: PLAN_REQUIRED }

const ACCEPT = { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, criterion: { type: 'string' }, linkedTo: { type: 'string' } }, required: ['id', 'criterion', 'linkedTo'] }
// 快路径：方案 + 简要风险(带证据) + 验收，单 agent 一次出（省去独立 Analyze/Gap/Risk/TestPlan）
const FAST_PLAN_SCHEMA = { type: 'object', additionalProperties: false,
  properties: Object.assign({}, PLAN_PROPS, { risks: { type: 'array', items: ITEM }, acceptanceCriteria: { type: 'array', items: ACCEPT } }),
  required: PLAN_REQUIRED.concat(['risks', 'acceptanceCriteria']) }

const RISK_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  risks: { type: 'array', items: ITEM }, rollback: { type: 'array', items: { type: 'string' } }, openConcerns: { type: 'array', items: { type: 'string' } },
}, required: ['risks', 'rollback', 'openConcerns'] }

const TESTCASE = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string' }, priority: { type: 'string', enum: ['P0', 'P1', 'P2'] }, riskIds: { type: 'array', items: { type: 'string' } },
  scenario: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, expected: { type: 'string' }, verificationType: { type: 'string' },
}, required: ['id', 'priority', 'riskIds', 'scenario', 'steps', 'expected', 'verificationType'] }
const TESTPLAN_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  testStrategy: { type: 'string' }, cases: { type: 'array', items: TESTCASE },
  acceptanceCriteria: { type: 'array', items: ACCEPT }, coverageGaps: { type: 'array', items: { type: 'string' } },
}, required: ['testStrategy', 'cases', 'acceptanceCriteria', 'coverageGaps'] }

const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  verdict: { type: 'string', enum: ['PASS', 'CONDITIONAL_PASS', 'FAIL'] }, score: { type: 'integer', minimum: 0, maximum: 100, description: '0–100 的整数评分；禁用 0–10 刻度' }, summary: { type: 'string' },
  requirementsCoverage: { type: 'array', items: { type: 'string' } },
  p0: { type: 'array', items: { type: 'string' } }, p1: { type: 'array', items: { type: 'string' } }, p2: { type: 'array', items: { type: 'string' } },
  mustFix: { type: 'array', items: { type: 'string' } }, missingEvidence: { type: 'array', items: { type: 'string' } },
  affectedPhases: { type: 'array', items: { type: 'string' } }, remainingRisks: { type: 'array', items: { type: 'string' } }, readyForReport: { type: 'boolean' },
}, required: ['verdict', 'score', 'summary', 'requirementsCoverage', 'p0', 'p1', 'p2', 'mustFix', 'missingEvidence', 'affectedPhases', 'remainingRisks', 'readyForReport'] }

const REWORK_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  addressed: { type: 'array', items: { type: 'string' } }, stillOpen: { type: 'array', items: { type: 'string' } },
  planRefinements: { type: 'array', items: { type: 'string' } }, addedRisks: { type: 'array', items: ITEM }, addedTestCases: { type: 'array', items: TESTCASE },
  notes: { type: 'array', items: { type: 'string' } }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}, required: ['addressed', 'stillOpen', 'planRefinements', 'addedRisks', 'addedTestCases', 'notes', 'confidence'] }

const REPORT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  markdown: { type: 'string' }, headline: { type: 'string' }, topRisks: { type: 'array', items: { type: 'string' } },
}, required: ['markdown', 'headline', 'topRisks'] }

const PERSIST_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  ok: { type: 'boolean' }, absOutDir: { type: 'string' }, written: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['ok', 'absOutDir', 'written', 'note'] }
// <<< SCHEMA-CONTRACT-END

const READBACK_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  existing: { type: 'array', items: { type: 'string' } }, unparseable: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
}, required: ['existing', 'unparseable', 'note'] }

const BASE = `客户需求: ${requirement}\n目标代码仓库: ${target}\n已知约束: ${constraints.length ? JSON.stringify(constraints) : '（无）'}\n` +
  `这是只读分析 + 方案设计：当前阶段**不编写客户项目代码、不提交/合并/部署**。关于现有代码的结论必须基于实际读到的内容并带证据(path/symbol/lineRange)，读不到/不确定要标注，绝不臆测、绝不编造行号(不确定填 "unknown")。中文输出，只返回结构化结果。`

// ===================== 状态收集 =====================
const failedStages = []
const reviewHistory = []
const reworkHistory = []
let finalStatus = 'PASS'
let consistency = null
let pathway = 'full'
let triage = null
function passedReview(rev) { return !!rev && rev.verdict === 'PASS' && (rev.p0 || []).length === 0 }
function runConsistencyChecks() {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail: detail || '' })
  const located = (locate && locate.relevant || []).length
  add('coverage 单调: analyzed ≤ located', componentAnalyses.length <= located, `analyzed=${componentAnalyses.length} located=${located}`)
  const riskIds = new Set((risk && risk.risks || []).map(r => r.id))
  const dangling = []
  for (const c of (testPlan && testPlan.cases || [])) for (const rid of (c.riskIds || [])) if (rid && !riskIds.has(rid)) dangling.push(`${c.id}→${rid}`)
  add('追踪链完整: 用例 riskIds 均存在于风险表', dangling.length === 0, dangling.length ? '悬挂: ' + dangling.slice(0, 8).join(', ') : '全部命中')
  const riskNoEv = (risk && risk.risks || []).filter(r => (r.evidence || []).length === 0).map(r => r.id)
  add('证据完整: 每条风险≥1 证据', riskNoEv.length === 0, riskNoEv.length ? '缺证据: ' + riskNoEv.slice(0, 8).join(', ') : 'ok')
  const planHasContent = !!plan && ((plan.reuse || []).length + (plan.modify || []).length + (plan.add || []).length) > 0
  add('方案非空: 复用/修改/新增 至少有一项', planHasContent, planHasContent ? 'ok' : '方案未提出任何可复用/修改/新增')
  const p0n = review ? (review.p0 || []).length : 0
  add('状态语义: 有 P0 不得判 PASS/PARTIAL/CONDITIONAL', !(p0n > 0 && ['PASS', 'PARTIAL', 'CONDITIONAL'].includes(finalStatus)), `p0=${p0n} status=${finalStatus}`)
  add('验收非空: 通过时应有验收标准', !(finalStatus === 'PASS' && (testPlan && testPlan.acceptanceCriteria || []).length === 0), `acceptance=${(testPlan && testPlan.acceptanceCriteria || []).length}`)
  const sc = review ? review.score : null
  add('评分刻度: score 为 0–100 整数且与 verdict 不矛盾(防 0–10 误用)',
    !review || (Number.isInteger(sc) && sc >= 0 && sc <= 100 && !(review.verdict === 'PASS' && sc < 60) && !(review.verdict === 'FAIL' && sc > 80)),
    `score=${sc} verdict=${review ? review.verdict : 'N/A'}`)
  return { ok: checks.every(c => c.ok), checks }
}

// ===================== 主流程 =====================
let requirementU = null, locate = null, gap = null, plan = null, risk = null, testPlan = null, review = null, report = null
let componentAnalyses = [], failedComponents = [], relevantComps = []

async function doReview(round, scope) {
  return roleAgent('review',
    `你是独立审查者，未参与上述工作，只负责审查可靠性（第 ${round} 轮，路径=${scope}）。${BASE}\n\n` +
    `审查维度：①需求理解是否准确(有无误解客户意图、漏掉验收信号)；②代码分析是否扎实(结论有无证据、有无编造行号、相关代码找全没)；③方案是否可靠(贴合现有架构、复用/修改/新增落到真实文件、影响面完整、步骤可执行)；④风险↔测试、需求↔验收 是否对应；⑤被排除/失败模块是否被误当已覆盖。\n` +
    `给出 verdict/score(**0–100 的整数**，禁用 0–10 刻度)/summary/requirementsCoverage/p0/p1/p2/mustFix/missingEvidence/affectedPhases(取值 Requirement|Locate|Analyze|Gap|Plan|Risk|TestPlan)/remainingRisks/readyForReport。硬规则：任何 P0→FAIL；关键 P1 未解决不得 PASS；不因 agent/文档/token 数量抬分。\n` +
    `需求:${JSON.stringify(requirementU)}\n定位:${JSON.stringify(locate)}\n现状:${JSON.stringify(componentAnalyses)}\n失败模块:${JSON.stringify(failedComponents)}\n差距:${JSON.stringify(gap)}\n方案:${JSON.stringify(plan)}\n风险:${JSON.stringify(risk)}\n测试验收:${JSON.stringify(testPlan)}`,
    { schema: REVIEW_SCHEMA, label: `review-r${round}`, phase: 'Review', required: true, effort: EFFORT.heavy })
}

try {
  if (!requirement) halt('Preflight', 'args.requirement 缺失（必填）')
  if (!target) halt('Preflight', 'args.target 缺失（必填）')

  // ---- Preflight ----
  phase('Preflight')
  const pf = await roleAgent('preflight',
    `${BASE}\n\n本阶段=前置校验。用 Bash 确认目标仓库存在且可读，判断仓库类型/技术栈；并初判这条需求是否足够清晰(requirementClear)。`,
    { schema: PREFLIGHT_SCHEMA, label: 'preflight', phase: 'Preflight', required: true, effort: EFFORT.light })
  if (!pf.ok) { failedStages.push('Preflight'); halt('Preflight', pf.error) }
  if (!pf.value.targetExists || !pf.value.isReadable) halt('Preflight', `目标仓库不可用：${pf.value.note}`)
  note(`Preflight ok：${pf.value.repoKind}；需求初判清晰度=${pf.value.requirementClear ? '足够' : '偏模糊'} — ${pf.value.note}`)

  // ---- Requirement（需求理解；参考 Skill 的 requirement-analysis 维度）----
  phase('Requirement')
  const rq = await roleAgent('requirement',
    `${BASE}\n\n本阶段=需求理解。把客户需求拆成 目标/角色/正常流/异常流/核心结果/非目标/歧义/待确认/验收信号，并给 searchHints(到代码里找相关实现的关键词/符号/路径)。\n` +
    `参考：可 Read ${REF.requirement} 当**维度清单参考**，但按本仓库实际技术栈与这条需求动态裁剪，不照搬后端分层术语。会实质影响方案的歧义放进 openQuestions。`,
    { schema: REQUIREMENT_SCHEMA, label: 'requirement', phase: 'Requirement', required: true, effort: EFFORT.heavy })
  if (!rq.ok) { failedStages.push('Requirement'); halt('Requirement', rq.error) }
  requirementU = rq.value

  // ---- Triage（分级：清晰度闸门 + 复杂度 + 高风险域；参考 Skill 分级）----
  phase('Triage')
  const tg = await roleAgent('triage',
    `${BASE}\n\n本阶段=需求分级。基于需求理解，判定三件事：\n` +
    `(1) clarity：需求是否清晰到足以**负责任地**出实现方案？若关键点不明（会实质改变方案的范围/数据/接口/状态/权限/外部依赖）→ insufficient，并把必须先澄清的问题放进 blockingQuestions。另：凡【会实质改变实现行为/接口/数据格式/语义】的歧义（如匹配规则、大小写敏感、是否跨目录、字段结构）必须列入 implementationAmbiguities——这类未拍板即不应进入编码，**不得仅以 openQuestions 承接**（无则空数组）。\n` +
    `(2) complexity：simple（改动小、影响面窄、无高风险）/ medium / complex（跨模块、架构敏感、数据或状态变更大）。\n` +
    `(3) riskFlags：是否触及高风险域（支付/会员/下载权限/认证/权限/状态机/数据迁移/文件/回调/定时任务/金额），无则 ["none"]。再给 recommendedDepth 与 reasoning。\n` +
    `**故障安全默认（建议3）**：任一项拿不准时一律按更保守处理——clarity 倾向 insufficient、complexity 取更高档、riskFlags 宁可多标不可漏标。本判定是整条链的单点，宁可多澄清/多分析，绝不乐观放行。\n` +
    `参考：可 Read ${REF.skill} 的「先给任务分级」（简单/中等/复杂）与「升级到复杂的情形」、「何时该问 vs 直接做」规则作为**判定参考**，但按本需求与本仓库实际裁剪，不机械套用。\n` +
    `需求理解:${JSON.stringify(requirementU)}\nPreflight初判:${JSON.stringify({ requirementClear: pf.value.requirementClear, repoKind: pf.value.repoKind })}`,
    { schema: TRIAGE_SCHEMA, label: 'triage', phase: 'Triage', required: true, effort: EFFORT.heavy })
  if (!tg.ok) { failedStages.push('Triage'); halt('Triage', tg.error) }
  triage = tg.value

  // ---- 路由 + 深度选档 ----
  const complexity = forceComplexity || triage.complexity
  const highRisk = (triage.riskFlags || []).filter(f => f && f !== 'none').length > 0
  // C1 兜底：会实质改变实现语义的歧义未拍板，必须先澄清，不得静默进编码（并入 blockingQuestions 让澄清流程展示）
  const implAmbig = (triage.implementationAmbiguities || []).filter(Boolean)
  // 语义级歧义并入待澄清清单（去重）——完整披露，而非仅在 blockingQuestions 为空时才用
  if (implAmbig.length) triage.blockingQuestions = Array.from(new Set([...(triage.blockingQuestions || []), ...implAmbig]))
  // clarity=insufficient 即应澄清（即便 triage 未列出具体问题也不静默放行）；或存在语义级歧义
  if (!skipClarify && (triage.clarity === 'insufficient' || implAmbig.length > 0)) pathway = 'clarify'
  else if (complexity === 'simple' && !highRisk) pathway = 'fast'
  else pathway = 'full'
  if (!userMode) applyDepth(complexityToMode[complexity] || 'standard')   // 自动选档（用户未显式指定时）
  note(`Triage：清晰度=${triage.clarity}，复杂度=${complexity}${highRisk ? '（高风险:' + triage.riskFlags.join('/') + '）' : ''} → 路径=${pathway}，深度档=${MODE}（${userMode ? '用户指定' : '自动'}）`)

  if (pathway === 'clarify') {
    // ===== 澄清闸门：不猜着出方案 =====
    phase('Clarify')
    finalStatus = 'NEEDS_CLARIFICATION'
    const cl = await roleAgent('report',
      `${BASE}\n\n本阶段=澄清清单。需求当前不够明确，**不能负责任地直接出实现方案**。请产出一份给客户的"待确认清单"markdown：\n` +
      `1 我对需求的当前理解（已能确定的部分）；2 必须先澄清的阻断性问题（逐条说明为什么它会实质影响方案）；3 每个问题的可能选项/我的倾向（帮助客户快速回答）；4 澄清后预计可走的方案方向（只给方向，不展开具体方案）。\n` +
      `需求理解:${JSON.stringify(requirementU)}\n分级与阻断问题:${JSON.stringify(triage)}`,
      { schema: REPORT_SCHEMA, label: 'clarify-report', phase: 'Clarify', required: true, effort: EFFORT.heavy })
    report = cl.ok ? cl.value : { markdown: '# 需求需澄清\n\n生成失败，阻断问题：\n- ' + (triage.blockingQuestions || []).join('\n- '), headline: '需求需澄清', topRisks: [] }
    note(`澄清闸门触发：列出 ${(triage.blockingQuestions || []).length} 个阻断性待确认问题，未出方案。`)

  } else {
    // ===== Locate（fast + full 都需要）=====
    phase('Locate')
    const lc = await roleAgent('locate',
      `${BASE}\n\n本阶段=按需求定位现有相关代码。用 ls/find/grep 结合 searchHints 找出与本需求相关的模块/文件/业务逻辑（实现点、调用点、数据、配置、相邻、入口、可用构建测试命令），说明每处为何相关(relation)；忽略编译产物/第三方 vendored。列出可能相关但本轮未细看的(possiblyRelevant)。\n需求理解:${JSON.stringify(requirementU)}`,
      { schema: LOCATE_SCHEMA, label: 'locate', phase: 'Locate', required: true, effort: EFFORT.analyze })
    if (!lc.ok) { failedStages.push('Locate'); halt('Locate', lc.error) }
    locate = lc.value
    // 快路径不做 per-component 扇出（架构师直接读相关文件），故不按 MAX 收紧输入：取全部相关(上限 FAST_LOCATE_CAP)，
    // 避免"定位数 > 档位上限"被误判为覆盖降级（修复：简单任务应能干净判 PASS）。完整路径仍按 MAX 控扇出成本。
    const FAST_LOCATE_CAP = 8
    const locCap = (pathway === 'fast') ? Math.min((locate.relevant || []).length, FAST_LOCATE_CAP) : MAX
    relevantComps = (locate.relevant || []).slice(0, locCap)
    if ((locate.relevant || []).length > locCap) note(`定位到 ${locate.relevant.length} 处相关，取前 ${locCap} 深入；其余记为可能相关未细看。`)
    note(`Locate：相关 ${relevantComps.length}（${relevantComps.map(c => c.name).join(', ')}）；possiblyRelevant ${(locate.possiblyRelevant || []).length}。`)

    if (pathway === 'fast') {
      // ===== 快路径：架构师直接读相关代码出精简方案(含简要风险+验收)，单次审查，无返工 =====
      phase('Plan')
      const fp = await roleAgent('plan',
        `${BASE}\n\n本阶段=快路径实现方案（需求简单、无高风险）。直接 Read 下列相关文件后，产出精简但可执行的方案：approach/reuse/modify/add/steps/affected/architectureFit/assumptions/alternatives；并附 risks(简要，每条带 id 'RISK-xxx' 与证据)与 acceptanceCriteria(验收标准)。贴合现有架构、最小改动、不写完整代码。\n` +
        `参考：可 Read ${REF.delivery} 的实现规则，按实际裁剪。\n相关文件:${JSON.stringify(relevantComps)}\n需求:${JSON.stringify(requirementU)}`,
        { schema: FAST_PLAN_SCHEMA, label: 'fast-plan', phase: 'Plan', required: true, effort: EFFORT.heavy })
      if (!fp.ok) { failedStages.push('Plan'); halt('Plan', fp.error) }
      const fpv = fp.value
      plan = { approach: fpv.approach, reuse: fpv.reuse, modify: fpv.modify, add: fpv.add, steps: fpv.steps, affected: fpv.affected, architectureFit: fpv.architectureFit, assumptions: fpv.assumptions, alternatives: fpv.alternatives }
      risk = { risks: fpv.risks || [], rollback: [], openConcerns: [] }
      testPlan = { testStrategy: '快路径：以验收标准为主，按需补单测/手测', cases: [], acceptanceCriteria: fpv.acceptanceCriteria || [], coverageGaps: ['快路径未做完整测试用例分解（简单需求）'] }
      gap = { gaps: [], summary: '快路径未单独做差距分析（差距已并入方案）', overallFeasibility: '简单需求，可行' }
      note(`快路径：精简方案 reuse/modify/add=${plan.reuse.length}/${plan.modify.length}/${plan.add.length}，简要风险 ${risk.risks.length}，验收 ${testPlan.acceptanceCriteria.length}。`)

      phase('Review')
      const r0 = await doReview(0, 'fast')
      if (!r0.ok) { failedStages.push('Review'); halt('Review', r0.error) }
      review = r0.value
      reviewHistory.push({ round: 0, verdict: review.verdict, score: review.score, p0: review.p0.length, p1: review.p1.length, mustFix: review.mustFix })

    } else {
      // ===== 完整流程：Analyze → Gap → Plan → Risk → TestPlan → Review →(Rework)=====
      phase('Analyze')
      if (relevantComps.length > 0) {
        const results = await parallel(relevantComps.map((c, i) => () => {
          if (i === injectFailIdx) { note(`[测试注入] 相关模块 ${c.name} 模拟分析失败（返回 null）以演练降级`); return null }
          return roleAgent('analyze',
            `${BASE}\n\n本阶段=相关模块现状分析。仅分析：${c.name} (${c.path})，与需求关系：${c.whyRelevant}。实际 Read 后给出：当前行为/对外接口/数据结构/状态与状态流转/权限/依赖/证据/confidence。聚焦与本需求相关部分。`,
            { schema: COMPONENT_SCHEMA, label: `analyze:${c.name}`, phase: 'Analyze', required: false, effort: EFFORT.analyze })
            .then(r => (r.ok ? r.value : null))
        }))
        results.forEach((r, i) => { if (r) componentAnalyses.push(r); else failedComponents.push(relevantComps[i].name) })
        if (failedComponents.length) note(`相关模块分析降级：失败 ${failedComponents.length}（${failedComponents.join(', ')}），记为覆盖缺口。`)
      } else { note('未定位到相关代码：可能是全新功能，Gap/Plan 将按"新增为主"处理。') }

      phase('Gap')
      const gp = await roleAgent('gap',
        `${BASE}\n\n本阶段=现状与目标差距。逐项对比"客户目标(验收信号)"与"现有实现现状"，判定 缺失/部分/冲突/已满足，给整体可行性。\n需求:${JSON.stringify(requirementU)}\n现状:${JSON.stringify(componentAnalyses)}\n定位概览:${JSON.stringify(locate.overview)}`,
        { schema: GAP_SCHEMA, label: 'gap', phase: 'Gap', required: true, effort: EFFORT.heavy })
      if (!gp.ok) { failedStages.push('Gap'); halt('Gap', gp.error) }
      gap = gp.value

      phase('Plan')
      const pl = await roleAgent('plan',
        `${BASE}\n\n本阶段=实现方案。基于需求/现状/差距，产出贴合现有架构、开发可直接照做的方案：approach；reuse(可复用)；modify(path/改什么/为什么)；add(path/做什么/为什么)；steps(有序，每步 touches 哪些文件/模块)；affected(模块/文件/接口/数据/状态/权限/前端/后端)；architectureFit；assumptions；alternatives(备选及放弃原因)。\n` +
        `参考：可 Read ${REF.delivery} 当**实现规则参考**(最小改动/复用优先/接口稳定/字段一致/权限后端/DB 显式)，按实际架构裁剪，不机械套用。不要写完整代码，只给方案与落点。\n需求:${JSON.stringify(requirementU)}\n现状:${JSON.stringify(componentAnalyses)}\n差距:${JSON.stringify(gap)}`,
        { schema: PLAN_SCHEMA, label: 'plan', phase: 'Plan', required: true, effort: EFFORT.heavy })
      if (!pl.ok) { failedStages.push('Plan'); halt('Plan', pl.error) }
      plan = pl.value

      phase('Risk')
      const rk = await roleAgent('risk',
        `${BASE}\n\n本阶段=方案风险。识别**实施这套方案**的风险：一致性/状态流转/幂等并发/权限/数据迁移/向后兼容/前后端契约/异常边界。每条 risk 带唯一 id 'RISK-xxx'、证据、confidence；给 rollback 与 openConcerns。\n参考：可 Read ${REF.risk} 当**风险维度参考**，按实际裁剪。\n方案:${JSON.stringify(plan)}\n现状:${JSON.stringify(componentAnalyses)}\n差距:${JSON.stringify(gap)}`,
        { schema: RISK_SCHEMA, label: 'risk', phase: 'Risk', required: true, effort: EFFORT.heavy })
      if (!rk.ok) { failedStages.push('Risk'); halt('Risk', rk.error) }
      risk = rk.value

      phase('TestPlan')
      const tp = await roleAgent('testplan',
        `${BASE}\n\n本阶段=测试与验收。基于方案与风险产出：用例(id/priority/riskIds 引用 RISK-xxx/scenario/steps/expected/verificationType)；验收标准(acceptanceCriteria，对齐需求成功信号，linkedTo 指向需求点/方案点)；覆盖缺口。\n方案:${JSON.stringify(plan)}\n风险:${JSON.stringify(risk)}\n需求验收信号:${JSON.stringify(requirementU.successCriteria)}`,
        { schema: TESTPLAN_SCHEMA, label: 'testplan', phase: 'TestPlan', required: false, effort: EFFORT.analyze })
      testPlan = tp.ok ? tp.value : { testStrategy: '(测试方案阶段失败，降级为空)', cases: [], acceptanceCriteria: [], coverageGaps: ['测试方案生成失败'] }
      if (!tp.ok) { failedStages.push('TestPlan(降级)'); note('TestPlan 失败，降级为空并标注缺口。') }

      phase('Review')
      if (forceFirstVerdict) {
        note(`[测试注入] 首轮评审强制为 ${forceFirstVerdict} 以演练返工链路；后续复评为真实评审。`)
        review = { verdict: forceFirstVerdict, score: 0, summary: '[测试注入] 强制首轮非 PASS，验证返工控制流，非真实结论。',
          requirementsCoverage: [], p0: forceFirstVerdict === 'FAIL' ? ['[测试注入] 演练用 P0'] : [], p1: ['[测试注入] 要求补充方案某步的证据'],
          p2: [], mustFix: ['[测试注入] 为关键风险补证据并补对应用例；细化方案某步的落点文件'], missingEvidence: ['[测试注入] 关键改动点缺行号级证据'],
          affectedPhases: ['Plan', 'Risk', 'TestPlan'], remainingRisks: [], readyForReport: false }
      } else {
        const r0 = await doReview(0, 'full')
        if (!r0.ok) { failedStages.push('Review'); halt('Review', r0.error) }
        review = r0.value
      }
      reviewHistory.push({ round: 0, verdict: review.verdict, score: review.score, p0: review.p0.length, p1: review.p1.length, mustFix: review.mustFix })

      let round = 0
      while (!passedReview(review) && round < MAX_REWORK) {
        round++
        phase('Rework')
        const rw = await roleAgent('rework',
          `${BASE}\n\n本阶段=返工补充（第 ${round} 轮）。针对评审 mustFix/missingEvidence 做补充只读分析与方案细化：addressed/stillOpen/planRefinements/addedRisks(带 id 证据)/addedTestCases(带 riskIds)/notes。不写客户代码。\n` +
          `mustFix:${JSON.stringify(review.mustFix)}\nmissingEvidence:${JSON.stringify(review.missingEvidence)}\naffectedPhases:${JSON.stringify(review.affectedPhases)}\n现有方案:${JSON.stringify(plan)}\n现有风险:${JSON.stringify(risk.risks)}\n现有用例:${JSON.stringify(testPlan.cases)}`,
          { schema: REWORK_SCHEMA, label: `rework-r${round}`, phase: 'Rework', required: false, effort: EFFORT.heavy })
        if (rw.ok) {
          risk.risks.push(...(rw.value.addedRisks || []))
          testPlan.cases.push(...(rw.value.addedTestCases || []))
          if ((rw.value.planRefinements || []).length) plan.assumptions = [...(plan.assumptions || []), ...rw.value.planRefinements.map(s => `[返工细化] ${s}`)]
          reworkHistory.push({ round, mustFix: review.mustFix, addressed: rw.value.addressed, stillOpen: rw.value.stillOpen, planRefinements: rw.value.planRefinements, addedRisks: (rw.value.addedRisks || []).length, addedTestCases: (rw.value.addedTestCases || []).length })
          note(`Rework r${round}：处理 ${rw.value.addressed.length}，仍开放 ${rw.value.stillOpen.length}，方案细化 ${(rw.value.planRefinements || []).length}，补风险 ${(rw.value.addedRisks || []).length}/补用例 ${(rw.value.addedTestCases || []).length}。`)
        } else {
          reworkHistory.push({ round, mustFix: review.mustFix, addressed: [], stillOpen: ['返工 agent 失败'], planRefinements: [], addedRisks: 0, addedTestCases: 0 })
          note(`Rework r${round} 失败，记录后继续复评。`)
        }
        phase('Review')
        const rr = await doReview(round, 'full')
        if (!rr.ok) { failedStages.push(`Review-r${round}`); note(`第 ${round} 轮复评失败，停止返工。`); break }
        review = rr.value
        reviewHistory.push({ round, verdict: review.verdict, score: review.score, p0: review.p0.length, p1: review.p1.length, mustFix: review.mustFix })
      }
    }

    // ---- 最终状态（fast/full 共用）----
    // FAILED_WITH_FINDINGS=确属不合格(含 P0 或 verdict=FAIL)；CONDITIONAL=无 P0 但复评 CONDITIONAL_PASS(有可修 P1)，非失败；
    // PARTIAL=通过但有降级(失败组件/阶段、相关代码未细看)；PASS=通过且无降级。
    const reviewPassed = passedReview(review)              // PASS 且无 P0
    const hasP0 = review ? (review.p0 || []).length > 0 : true
    const conditional = !reviewPassed && !hasP0 && !!review && review.verdict === 'CONDITIONAL_PASS'
    const hasDegradation = failedComponents.length > 0 || failedStages.length > 0 || (locate && (locate.relevant || []).length > relevantComps.length)
    if (reviewPassed) finalStatus = hasDegradation ? 'PARTIAL' : 'PASS'
    else if (conditional) finalStatus = 'CONDITIONAL'
    else finalStatus = 'FAILED_WITH_FINDINGS'
    consistency = runConsistencyChecks()
    if (!consistency.ok) { note(`一致性校验未全过：${consistency.checks.filter(c => !c.ok).map(c => c.name).join('；')}`); if (finalStatus === 'PASS') finalStatus = 'PARTIAL' }
    else note('一致性校验全过。')

    // ---- Report（开发可直接实施的方案；只汇总）----
    phase('Report')
    const rp = await roleAgent('report',
      `${BASE}\n\n本阶段=最终方案报告（只汇总既有分析/方案/评审，**不新增**未经分析的结论）。面向开发可直接实施，中文 markdown，含：1 需求理解(目标/范围/非目标/验收) 2 待向客户确认的问题 3 相关代码现状(带证据) 4 现状与目标差距 5 实现方案总体思路 6 可复用 7 需修改(文件+改什么+为什么) 8 需新增 9 有序实施步骤 10 涉及的模块/文件/接口/数据/状态/权限/前后端影响 11 方案风险与回滚 12 测试方案 13 验收标准 14 风险↔测试、需求↔验收 追踪矩阵 15 评审历史与采纳 16 返工历史 17 最终状态(readinessForDev 由系统按 finalStatus 确定性判定，不在此处自评) 18 遗留与未验证项。本次路径=${pathway}、深度档=${MODE}。\n` +
      `最终状态:${finalStatus}\n分级:${JSON.stringify(triage)}\n需求:${JSON.stringify(requirementU)}\n定位:${JSON.stringify(locate)}\n现状:${JSON.stringify(componentAnalyses)}\n失败模块:${JSON.stringify(failedComponents)}\n差距:${JSON.stringify(gap)}\n方案:${JSON.stringify(plan)}\n风险:${JSON.stringify(risk)}\n测试验收:${JSON.stringify(testPlan)}\n评审历史:${JSON.stringify(reviewHistory)}\n返工历史:${JSON.stringify(reworkHistory)}\n最终评审:${JSON.stringify(review)}`,
      { schema: REPORT_SCHEMA, label: 'report', phase: 'Report', required: true, effort: EFFORT.heavy })
    if (!rp.ok) { failedStages.push('Report'); halt('Report', rp.error) }
    report = rp.value
  }

} catch (e) {
  if (e && e.__halt) { finalStatus = 'FAILED'; note(`流程在必需阶段终止：${e.__halt.stage} —— ${e.__halt.reason}。输出已有结果，不伪造后续。`) }
  else { throw e }
}

// ===================== Persist =====================
// readinessForDev 由确定性代码从 finalStatus 推导（不由报告 agent 决定；堵死 FAILED/CONDITIONAL + ready 等非法组合）
let readinessForDev = computeReadiness(finalStatus)
const manifest = {
  schemaVersion: '1.0',
  workflow: 'plan-from-requirement', requirement, target, constraints, mode: MODE, pathway,
  triage: triage ? { clarity: triage.clarity, complexity: forceComplexity || triage.complexity, riskFlags: triage.riskFlags, recommendedDepth: triage.recommendedDepth } : null,
  params: { mode: userMode || `auto:${MODE}`, maxComponents: MAX, maxReworkRounds: MAX_REWORK, effort: EFFORT, skillDir: SKILL_DIR, useCustomAgents: useCustom, forceComplexity, skipClarificationGate: skipClarify, forceFirstVerdict, injectComponentFailureIndex: injectFailIdx },
  finalStatus, readinessForDev, failedStages, failedComponents,
  coverage: { located: (locate && locate.relevant || []).length, analyzed: componentAnalyses.length },
  consistency: consistency || { ok: true, checks: [{ name: '(澄清/提前终止路径，未跑完整分析)', ok: true, detail: pathway }] },
  reviewHistory, reworkHistory,
  blockingQuestions: (triage && triage.blockingQuestions) || [],
  openQuestions: (requirementU && requirementU.openQuestions) || [],
  remainingGaps: [...failedComponents.map(n => `相关模块未分析: ${n}`), ...((review && review.remainingRisks) || []), ((locate && (locate.relevant || []).length > relevantComps.length) ? '存在相关代码未细看' : ''), ...(consistency && !consistency.ok ? ['产物一致性未全过'] : [])].filter(Boolean),
}
const artifacts = {
  'run-manifest.json': manifest, 'execution-log.md': execLog,
  'requirement.json': requirementU, 'triage.json': triage, 'located-code.json': locate, 'component-analyses.json': componentAnalyses,
  'gap.json': gap, 'plan.json': plan, 'risks.json': risk, 'test-plan.json': testPlan,
  'review-history.json': reviewHistory, 'rework-history.json': reworkHistory,
  [pathway === 'clarify' ? 'clarification.md' : 'final-plan.md']: report ? report.markdown : '(未生成：流程在必需阶段终止)',
}
phase('Persist')
const persistPrompt =
  `本阶段=落盘。把下列产物写入一个**新的、带时间戳的运行目录**，避免覆盖历史运行。\n` +
  `步骤：(1) Bash 计算 ts=$(date +%Y%m%d-%H%M%S)；(2) 目标目录 = "${outDirBase}/${'${ts}'}"（相对你的 cwd；mkdir -p 并 realpath 取绝对路径回报）；(3) 把 artifacts 每个键作为文件名写入（*.json 规范 JSON、*.md 文本，UTF-8）；(4) 返回 ok/absOutDir/written/note。不要修改目标仓库，只在输出目录内创建文件。\nartifacts(JSON):\n${JSON.stringify(artifacts)}`
const pr = await callAgent(persistPrompt, { label: 'persist', phase: 'Persist', agentType: resolveType('persist'), schema: PERSIST_SCHEMA, effort: EFFORT.light }, true)
const persisted = pr.ok ? pr.value : { ok: false, absOutDir: '(写盘失败)', written: [], note: pr.error }
const expectedFiles = Object.keys(artifacts)
// 落盘后由【独立只读子代理】回读校验，不信 persist agent 自报的 written（#4）
let persistVerify = { existing: [], unparseable: [], note: '(未回读)' }
if (persisted.ok && persisted.absOutDir && persisted.absOutDir !== '(写盘失败)') {
  const rb = await callAgent(
    `你是独立校验者，只读不写。逐个检查目录 ${persisted.absOutDir} 下这些文件是否【真实存在且非空】、且 .json 能被 JSON.parse 成功解析：${JSON.stringify(expectedFiles)}。\n` +
    `回报 existing(确实存在且非空的文件名)/unparseable(存在但 JSON 解析失败的 .json 文件名)/note。绝不创建或修改任何文件。`,
    { label: 'persist-readback', phase: 'Persist', agentType: resolveType('persist'), schema: READBACK_SCHEMA, effort: EFFORT.light }, true)
  if (rb.ok) persistVerify = rb.value
  else note(`Persist 回读校验失败：${rb.error}（按未通过校验处理）`)
}
const persistOutcome = computePersistOutcome({ expectedFiles, existing: persistVerify.existing, unparseable: persistVerify.unparseable, finalStatus })
const missingFiles = persistOutcome.missing
manifest.persistVerification = { ok: persistOutcome.ok, missing: persistOutcome.missing, unparseable: persistOutcome.unparseable }
note(`Persist：${persisted.ok ? '已写入 ' + persisted.absOutDir : '失败：' + persisted.note}；回读校验 existing=${(persistVerify.existing || []).length}/${expectedFiles.length}${persistOutcome.missing.length ? '，缺 ' + persistOutcome.missing.join(', ') : ''}${persistOutcome.unparseable.length ? '，损坏 ' + persistOutcome.unparseable.join(', ') : ''}。`)
if (persistOutcome.finalStatus !== finalStatus) {
  note(`⚠ 落盘未通过回读校验：产物缺失/损坏，最终状态由 ${finalStatus} 降级为 ${persistOutcome.finalStatus}（不以可用状态收尾未可靠落盘的方案）。`)
  finalStatus = persistOutcome.finalStatus
  readinessForDev = computeReadiness(finalStatus)
  manifest.finalStatus = finalStatus; manifest.readinessForDev = readinessForDev; manifest.persistVerification.ok = false
  if (persisted.ok && persisted.absOutDir && persisted.absOutDir !== '(写盘失败)') {
    const pf = await callAgent(
      `把 ${persisted.absOutDir}/run-manifest.json 覆盖写为下面这个规范 JSON（UTF-8），不要改其它文件。回报 ok/absOutDir/written/note。\nrun-manifest.json:\n${JSON.stringify(manifest)}`,
      { label: 'persist-manifest-fix', phase: 'Persist', agentType: resolveType('persist'), schema: PERSIST_SCHEMA, effort: EFFORT.light }, true)
    note(`回写 manifest：${pf.ok ? '已更新为降级状态 ' + finalStatus : '失败：' + pf.error}`)
  }
}

log(`plan-from-requirement 完成。路径=${pathway}，mode=${MODE}，最终状态=${finalStatus}，readinessForDev=${readinessForDev}；分级=${triage ? (forceComplexity || triage.complexity) : 'N/A'}/清晰度=${triage ? triage.clarity : 'N/A'}；相关模块 ${componentAnalyses.length}/${relevantComps.length}、风险 ${(risk && risk.risks || []).length}、用例 ${(testPlan && testPlan.cases || []).length}、验收 ${(testPlan && testPlan.acceptanceCriteria || []).length}、评审 ${reviewHistory.length} 轮、返工 ${reworkHistory.length}；失败阶段 [${failedStages.join(', ') || '无'}]。`)

return { finalStatus, pathway, mode: MODE, triage, readinessForDev, manifest, persisted, missingFiles, consistency, requirement: requirementU, locate, componentAnalyses, failedComponents, gap, plan, risk, testPlan, reviewHistory, reworkHistory, review, report }
