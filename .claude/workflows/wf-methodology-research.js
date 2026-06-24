export const meta = {
  name: 'wf-methodology-research',
  description: 'Research + cross-review + reconcile Claude Code Workflow methodology, grounded in official docs and the live product spec',
  phases: [
    { title: 'Charter', detail: 'task definition: goal/scope/non-goals/deliverables/criteria/risks' },
    { title: 'Research', detail: '6 parallel grounded research streams' },
    { title: 'Review', detail: '3 independent cross-reviewers (diverse lenses)' },
    { title: 'Reconcile', detail: 'resolve conflicts, log adopted/rejected/unresolved' },
  ],
}

// 路径参数化：默认从仓库根运行，所有默认路径都在当前公开仓库内；如要对外部 Skill 做研究，可用 args.skillDir 显式覆盖。
const A = (() => { let a = args; if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } } return (a && typeof a === 'object') ? a : {} })()
const WF = A.workflowDir || '.'
const SKILL_DIR = A.skillDir || '.claude/skills/workflow-designer'
const GT = `${WF}/evidence/01-workflow-api-ground-truth.md`
const SKILL = `${SKILL_DIR}/SKILL.md`
const SKILL_REF = `${SKILL_DIR}/references/`

const TASK_BRIEF = `公司要整理一套"Claude Code Workflow 技巧、设计规范、协作方式、质量评价方法"的方法论，并落地一个最小可运行示例，用于团队分享与排名评估。需要明确区分 Skill(方法/规范/清单) / Subagent(专业任务) / Workflow(阶段·循环·并行·分支·汇总·重试) / Hooks(确定性检查) / CLAUDE.md(项目固定约束)。已有资产是 ai-engineering-delivery-zh Skill(业务优先 8 阶段交付主干)，要复用其工程交付思想但不照搬。强调:不为展示规模堆 agent;不让实现者自评;先小范围再扩大;每阶段有输入/输出/完成标准;重要结论需独立复核;无法验证要如实说明;控制上下文与成本;成果要可被他人复用、适合向负责人展示。`

const COMMON = `你在为团队知识库研究 Claude Code Workflow 方法论。\n` +
  `权威事实锚点(必须先读): ${GT} 是本仓库保存的 Workflow 工具事实记录; ${SKILL} 是本仓库自带 Skill,${SKILL_REF} 是其 references。\n` +
  `对 Claude Code 概念(Skill/Subagent/Agent/Hooks/Dynamic CLAUDE.md)请用 WebSearch + WebFetch 抓取 docs.claude.com 等官方资料佐证。\n` +
  `硬规则: 不得把未经证据的推测写成事实;每条 keyFindings 必须标注 sourceType(official-doc/product-spec/live-env/inference)与 confidence;凡涉及 Workflow 脚本 API,以 ${GT} 为准,不得凭训练记忆臆测;官方资料优先。\n` +
  `任务背景: ${TASK_BRIEF}\n` +
  `输出用中文。只返回结构化结果,不要写文件。`

const RESEARCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    stream: { type: 'string' },
    summary: { type: 'string' },
    keyFindings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      claim: { type: 'string' }, evidence: { type: 'string' },
      confidence: { type: 'string', enum: ['high','medium','low'] },
      sourceType: { type: 'string', enum: ['official-doc','product-spec','live-env','inference'] }
    }, required: ['claim','evidence','confidence','sourceType'] } },
    executableGuidance: { type: 'array', items: { type: 'string' } },
    pitfalls: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title'] } }
  },
  required: ['stream','summary','keyFindings','executableGuidance','pitfalls','openQuestions','citations']
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      target: { type: 'string' }, severity: { type: 'string', enum: ['P0','P1','P2'] },
      description: { type: 'string' }, recommendation: { type: 'string' }
    }, required: ['target','severity','description','recommendation'] } },
    conflicts: { type: 'array', items: { type: 'string' } },
    overengineeringFlags: { type: 'array', items: { type: 'string' } },
    costConcerns: { type: 'array', items: { type: 'string' } },
    unverifiedClaims: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } }
  },
  required: ['lens','issues','conflicts','overengineeringFlags','costConcerns','unverifiedClaims','strengths']
}

const RECONCILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    adoptedConclusions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string' }, conclusion: { type: 'string' }, basis: { type: 'string' } }, required: ['topic','conclusion','basis'] } },
    rejectedApproaches: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { approach: { type: 'string' }, reason: { type: 'string' } }, required: ['approach','reason'] } },
    unresolved: { type: 'array', items: { type: 'string' } },
    crossCuttingPrinciples: { type: 'array', items: { type: 'string' } }
  },
  required: ['adoptedConclusions','rejectedApproaches','unresolved','crossCuttingPrinciples']
}

const CHARTER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    goal: { type: 'string' },
    scope: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    deliverables: { type: 'array', items: { type: 'string' } },
    evaluationCriteria: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } }
  },
  required: ['goal','scope','nonGoals','deliverables','evaluationCriteria','risks','openQuestions']
}

const STREAMS = [
  { key: 'concepts', type: 'claude-code-guide', q: '研究 Claude Code 的 Skill / Subagent(及 Agent Team 协作) / Dynamic Workflow / Hooks / CLAUDE.md 各自的定位、能做什么、不能做什么、以及它们之间的区别与配合边界。要给出"什么场景该用哪个"的判定。务必区分:Skill=方法/规范/清单(模型按需加载的知识), Subagent=承担专业任务的独立上下文代理, Workflow=确定性编排(阶段/循环/并行/分支/汇总/重试), Hooks=必须确定性发生的检查/自动化(由 harness 执行而非模型), CLAUDE.md=项目级固定约束。' },
  { key: 'structure', type: 'claude-code-guide', q: '研究 Workflow 的阶段拆分与控制流技巧:串行 pipeline、并行 parallel(栅栏)、分支(条件)、循环(loop-until-dry / loop-until-count / loop-until-budget)、扇出扇入、汇总。重点说明 pipeline 与 parallel 栅栏的取舍(默认 pipeline,何时才需要栅栏),以及每个阶段如何定义明确的输入/输出/完成标准。给出可直接照抄的最小代码骨架。' },
  { key: 'state', type: 'claude-code-guide', q: '研究状态保存、中间结果留存、上下文管理与断点恢复:structured output(schema)如何降低解析与上下文负担;evidence/中间产物文件如何作为可追踪记录;resumeFromRunId + scriptPath 断点恢复机制;主代理与子代理的上下文隔离;如何避免上下文膨胀。以 ground-truth 文件为 API 事实来源。' },
  { key: 'quality', type: 'claude-code-guide', q: '研究质量保障:测试/验证如何编排、独立交叉审查(实现者不自评)、对抗式验证(多 skeptic 证伪)、多视角验证、失败重试与降级、明确的退出条件与最大轮次(防无限循环)。给出"评审-返工-再评审"有界循环的设计要点与退出判据。' },
  { key: 'cost', type: 'claude-code-guide', q: '研究 Agent 数量、模型选择(opus/sonnet/haiku 分层)、effort 分层、Token 与成本控制:并发上限 min(16,cores-2)、总数上限 1000、单次 4096 item、budget 硬上限用法。重点给出"如何在不牺牲质量的前提下控制规模",以及"为展示规模而堆 agent / 只追运行时长或代码量"这类反模式的识别与规避。' },
  { key: 'skill-conversion', type: 'general-purpose', q: '研究如何把本仓库自带 workflow-designer Skill 与 docs/11、docs/12 的工程交付思想转化为可执行的工程交付 Workflow。要给出阶段到 Workflow phase 的映射、哪些应保留为 Skill(方法/清单)、哪些应做成 Subagent、哪个环节应由 Hooks 或脚本检查承担、哪些约束进 CLAUDE.md。强调复用而非复制。请实际读取 SKILL.md 与 references/ 后再下结论。' },
]

// ---- Phase 1: Charter ----
phase('Charter')
const charter = await agent(
  `${COMMON}\n\n本阶段=任务定义。基于任务背景与现有 Skill,产出本方法论项目的: 目标 / 范围 / 非目标 / 最终交付物 / 评价标准 / 风险 / 待确认问题。要具体、可核查。`,
  { label: 'charter', phase: 'Charter', agentType: 'general-purpose', schema: CHARTER_SCHEMA }
)

// ---- Phase 2: Research (parallel; barrier justified: reviewers need full set to detect cross-stream conflicts) ----
phase('Research')
const research = (await parallel(STREAMS.map(s => () =>
  agent(`${COMMON}\n\n研究方向(${s.key}): ${s.q}`,
    { label: `research:${s.key}`, phase: 'Research', agentType: s.type, schema: RESEARCH_SCHEMA, effort: 'high' })
))).filter(Boolean)

// ---- Phase 3: Cross-review (3 diverse lenses, each sees ALL research) ----
phase('Review')
const researchDigest = JSON.stringify(research)
const LENSES = [
  { lens: 'completeness-and-evidence', focus: '内容遗漏、概念混淆、把未验证推测当事实、缺少官方/产品证据、confidence 标注不实。' },
  { lens: 'executability-and-overdesign', focus: '不可执行/含糊的建议、过度设计、阶段缺少明确输入输出完成标准、与 ground-truth API 不符之处。' },
  { lens: 'cost-and-quality', focus: 'Agent 数量与成本失控、为展示规模堆 agent、只追运行时长或代码量而忽视质量、相互冲突的结论、实现者自评风险。' },
]
const reviews = (await parallel(LENSES.map(L => () =>
  agent(`你是独立交叉审查者,未参与上述研究的撰写。审查视角=${L.lens}。重点发现: ${L.focus}\n` +
    `参考事实锚点见 ${GT}。下面是 6 路研究的结构化结果(JSON):\n${researchDigest}\n\n` +
    `逐项给出问题(severity 用 P0/P1/P2)、跨流冲突、过度设计标记、成本担忧、未经证据的论断、以及值得保留的优点。中文输出,只返回结构化结果。`,
    { label: `review:${L.lens}`, phase: 'Review', agentType: 'general-purpose', schema: REVIEW_SCHEMA, effort: 'high' })
))).filter(Boolean)

// ---- Phase 4: Reconcile ----
phase('Reconcile')
const reconciliation = await agent(
  `你是分歧修正/汇总者。基于 6 路研究与 3 份独立审查,产出最终方法论结论。\n` +
  `研究(JSON):\n${researchDigest}\n\n审查(JSON):\n${JSON.stringify(reviews)}\n\n` +
  `针对重要分歧重新判断,产出: 最终采用的结论(topic/conclusion/basis,basis 要点明证据来源)、被否决的方案及否决原因、仍无法完全确认的问题、贯穿全局的跨切原则。\n` +
  `凡涉及 Workflow API,必须与 ${GT} 一致。中文输出,只返回结构化结果。`,
  { label: 'reconcile', phase: 'Reconcile', agentType: 'general-purpose', schema: RECONCILE_SCHEMA, effort: 'high' }
)

log(`research=${research.length} reviews=${reviews.length} adopted=${reconciliation.adoptedConclusions.length} rejected=${reconciliation.rejectedApproaches.length} unresolved=${reconciliation.unresolved.length}`)

return { charter, research, reviews, reconciliation }
