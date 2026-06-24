export const meta = {
  name: 'wf-docs-generation',
  description: 'Generate methodology docs 01-09 from reconciled evidence + real artifacts (one independent writer per doc)',
  phases: [{ title: 'WriteDocs', detail: '9 parallel doc-writers, each grounded in evidence + actual files' }],
}

// 路径参数化（去除个人绝对路径）：args 为 JSON 字符串需先 parse；默认相对路径，相对运行 cwd 解析，可经 args 覆盖。
const A = (() => { let a = args; if (typeof a === 'string') { try { a = a.trim() ? JSON.parse(a) : {} } catch (e) { a = {} } } return (a && typeof a === 'object') ? a : {} })()
const R = A.workflowDir || 'workflow'
const SRC_SKILL = A.skillDir || 'liu/ai-engineering-delivery-zh'
const GT = `${R}/evidence/01-workflow-api-ground-truth.md`
const FIND = `${R}/evidence/02-research-findings.md`
const DEC = `${R}/evidence/03-decision-log.md`
const SKILL = `${R}/.claude/skills/workflow-designer`
const AGENTS = `${R}/.claude/agents`

const COMMON = `你是技术文档撰写专家，只负责写**一篇**指定文档。\n` +
  `必读（先 Read 再写，凡 Workflow API 以 ${GT} 为准）：\n- ${GT}\n- ${FIND}\n- ${DEC}\n` +
  `硬规则：\n` +
  `1) 内容必须基于已核实证据与仓库里**真实存在**的文件；引用某文件前先 Read 确认其存在且内容一致。\n` +
  `2) 不把未经证据的推测写成结论；网络来源/未验证的精确数字要标注"未经本机验证"。\n` +
  `3) 代码示例必须符合 ${GT} 的 API（纯 JS；meta 纯字面量；phase title 逐字一致；禁 Date.now/Math.random；.filter(Boolean) 只用于 pipeline/parallel 整体返回数组、不能进 stage 内部；脚本体不能直接读写文件）。\n` +
  `4) 结构清晰、减少与其他文档重复，重复处写"详见 docs/NN"。UTF-8 中文，不得乱码。\n` +
  `5) 用 Write 写到指定路径。完成后一句话回报：文件名 + 行数 + 覆盖要点。`

const DOCS = [
  { file: 'docs/01-workflow-overview.md', label: '01-overview',
    extra: `还要读: ${SKILL}/SKILL.md。`,
    spec: `写《01 Workflow 总览与构件选型》。章节: (1) 什么是 Dynamic Workflow 及它解决什么问题; (2) 五构件对照表(Skill/Subagent/Workflow/Hooks/CLAUDE.md, 每行: 一句话定义·谁持决策权·加载/执行时机·是否强制·典型适用·反例); (3) 选型决策树 + 口诀"知识找 Skill, 干活找 Subagent, 编排找 Workflow, 必然发生找 Hooks, 固定约束找 CLAUDE.md"; (4) 全套文档导航(01-10 各讲什么)。` },
  { file: 'docs/02-workflow-techniques.md', label: '02-techniques',
    extra: `还要读: ${SKILL}/references/script-patterns.md。`,
    spec: `写《02 Workflow 阶段拆分与控制流技巧》。章节: phase 拆分; pipeline(默认, 无栅栏, 墙钟=最慢单链, 回调签名); parallel(栅栏, 仅需全量跨item结果时用); 分支(条件); 循环(loop-until-dry/count/budget, 必须有最大轮次与可观测退出); 扇出扇入; 汇总。每种给可照抄最小 JS 骨架(与 ground-truth 一致)。强调"选 pipeline/parallel 看数据依赖, 不看谁更快""纯 transform 内联进 stage"。` },
  { file: 'docs/03-workflow-specification.md', label: '03-spec',
    extra: `还要读: ${SKILL}/references/design-checklist.md。`,
    spec: `写《03 Workflow 设计规范与硬约束》。章节: 脚本硬约束清单(纯JS/meta纯字面量/phase title逐字一致/禁Date.now·Math.random/脚本体无文件系统); 编排原语速查表(agent/pipeline/parallel/phase/log/args/budget/workflow 各自签名与要点); 并发与容量上限(min(16,CPU-2)/1000/4096); budget 硬上限语义; 每个 phase 的"输入/输出/完成标准"模板。指向 design-checklist.md 作为落地清单。` },
  { file: 'docs/04-agent-coordination.md', label: '04-coordination',
    extra: `还要读: 用 ls 看 ${AGENTS}/ 下的 agent 定义并 Read 其中 workflow-reviewer.md、repo-analyst.md。`,
    spec: `写《04 Subagent 协作与分工》。章节: Subagent 本质(独立上下文/自定义提示/受限工具/独立权限/返回摘要); agentType(内置 claude/Explore/general-purpose/claude-code-guide/Plan; 自定义 .claude/agents/*.md 仅从项目目录启动才进注册表——跨目录用内置+prompt 的可移植性权衡); 角色分工原则(单一职责、无重复无遗漏); 实现者与审查者必须不同实例; 本项目 agents 清单与各自职责。` },
  { file: 'docs/05-state-context-and-cost.md', label: '05-state-cost',
    extra: ``,
    spec: `写《05 状态、上下文与成本控制》。章节: 状态保存(中间结果落 evidence/、结构化输出、可追踪记录); 上下文管理(子代理隔离 + schema + Skill 按需加载, 防上下文膨胀); 断点恢复(scriptPath+resumeFromRunId, 未改动前缀命中缓存, 低成本只重跑改动阶段); 成本控制(budget 硬上限/先小样本试跑外推/effort 与 model 分层/并发上限/worktree 默认不用)。明确写出"被否决: 总token≈4倍、规模系数公式——虚假精度", 成本唯一可靠观测是 budget.spent()/remaining()。` },
  { file: 'docs/06-verification-and-retry.md', label: '06-verify',
    extra: `还要读: ${SKILL}/references/review-rubric.md、${SKILL}/references/script-patterns.md、${AGENTS}/workflow-reviewer.md。`,
    spec: `写《06 验证、交叉审查、失败重试与退出条件》。章节: 验证如何编排; 独立交叉审查(实现者不自评, 审查者全新实例); 对抗式证伪(多 skeptic 多数证伪则否决)与多视角 lens; 失败重试与降级(agent 返回 null 的处理); 退出条件与最大轮次(防无限循环, 固定可观测缺省值且标注非API约束); 评审-返工有界循环(≤2轮, 任何P0→FAIL, 两轮不过如实报告未完成)——给出与 script-patterns §6 一致的骨架, 并说明 workflow-reviewer agent 的角色。` },
  { file: 'docs/07-antipatterns.md', label: '07-antipatterns',
    extra: ``,
    spec: `写《07 反模式》。逐条列(每条: 症状 / 为什么坏 / 正确做法): 不必要的 parallel 栅栏; 为展示规模堆 agent; 让实现者自评; 静默截断 top-N/采样(应 log); 简单计数器漏长尾(应 loop-until-dry); 无退出条件的循环; 把未验证当已验证; 越证据写后果/数字; 脚本体内直接 IO; 多层 workflow 嵌套; 在 stage 内 .filter(Boolean)(P0); 照抄未核实的 settings 键。必须收录两个**真实案例**: (a) 本次 6 路研究约 5 路同质的"堆 agent"教训; (b) 决策记录中被否决的 9 个方案作为反例索引。` },
  { file: 'docs/08-evaluation-rubric.md', label: '08-rubric',
    extra: `还要读: ${SKILL}/references/review-rubric.md、${AGENTS}/workflow-reviewer.md。`,
    spec: `写《08 质量评价与排名评估标准》。章节: 评分维度与权重(100分制: 需求覆盖与正确性30/可运行与真实证据25/阶段职责设计15/健壮性10/复用Skill10/成本规模克制10); 判级规则(任何P0→FAIL; CONDITIONAL_PASS; PASS); 需求覆盖矩阵模板; 每维"达标证据 vs 反模式"; 如何用于团队**排名评估**(可量化、要证据、防只追时长/代码量); 与 workflow-reviewer agent 的关系。` },
  { file: 'docs/09-existing-skill-integration.md', label: '09-integration',
    extra: `还要读: ${SRC_SKILL}/SKILL.md 以及 ${SRC_SKILL}/references/ 下文件(用 ls 后按需 Read), 以及 ${R}/evidence/00-environment-scan.md。`,
    spec: `写《09 复用现有 ai-engineering-delivery-zh Skill》。章节: 现有 skill 结构与 8 阶段回顾; 8阶段→4 phase 映射表(1-4分析扫描/5-6实现验证/7风险审查/8复盘); 角色归位(哪些留 Skill 当方法清单、哪些做 Subagent、presubmit-scan 进 PreToolUse Hook、哪些进 CLAUDE.md); "借鉴思想 vs 不照搬业务8阶段"的明确边界; 为什么不能做成父workflow串多子workflow(仅一层嵌套); 复用落地清单。强调只读复用、不改原 skill。` },
]

phase('WriteDocs')
const results = (await parallel(DOCS.map(d => () =>
  agent(`${COMMON}\n\n${d.extra}\n\n目标文件: ${R}/${d.file}\n\n${d.spec}`,
    { label: d.label, phase: 'WriteDocs', agentType: 'general-purpose', effort: 'high' })
))).filter(Boolean)

log(`docs written: ${results.length}/9`)
return { written: results.length, reports: results }