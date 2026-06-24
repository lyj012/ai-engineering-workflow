# 06 验证、交叉审查、失败重试与退出条件

> 本篇讲"质量怎么靠编排保证"：验证如何编排、独立交叉审查、对抗式证伪与多视角、失败重试与降级、退出条件与最大轮次、评审-返工有界循环。
> 凡涉及 Workflow 脚本 API，以 `evidence/01-workflow-api-ground-truth.md` 为准。本篇所有循环上限/阈值/skeptic 数量均为**示例缺省值，非 API 约束**（依据 `evidence/03-decision-log.md` 采用结论第 13 条）。
> 评分维度细则详见 docs/08；反模式案例详见 docs/07。

## 一、核心原则：质量靠"独立性"而非"数量"

Workflow 的质量保障不是"多跑几个 agent""跑得久"就更好，而是建立在两条纪律上（`evidence/03-decision-log.md` 跨切原则第 6 条）：

1. **实现者不得自评**：产出成果的 agent 与评审成果的 agent 必须是**不同实例**。让实现者评自己的结果是明确的反模式（`evidence/01-workflow-api-ground-truth.md` §5）。
2. **循环必须有最大轮次与可观测退出条件**：防无限循环，且退出判据必须是脚本能观测到的量（如某轮新增数=0、verdict==PASS、`budget.remaining()` 跌破阈值），不能是"重复率<10%"这类不可测指标（已被否决，见 `03-decision-log.md` 否决项思想 / 采用第 13 条）。

下文所有模式都是这两条原则的具体落地。

## 二、验证如何编排

验证本身就是一次（或多次）`agent()` 调用，区别在于：验证 agent 拿到的是**待验证的成果 + 一个证伪/核查任务**，并以 `schema` 返回结构化判定，让脚本能据此分支。

关键编排要点：

- **验证与实现解耦**：不要在同一个 agent 的 prompt 里"先做再自查"。先用一个 agent 产出成果，再用**另一个** agent 验证。这样验证者没有"想让自己通过"的动机。
- **验证结果走结构化输出**：验证 agent 用 `schema`（StructuredOutput），脚本拿到已校验对象后直接读字段做分支，无需自己解析自然语言（`01-workflow-api-ground-truth.md` §2、§5）。
- **被丢弃的覆盖面必须 `log()`**：如果验证因采样、截断、跳过而没覆盖全部对象，必须用 `log()` 把"没验到哪些"明确说出来，不静默截断（`01-workflow-api-ground-truth.md` §5 反模式；`03-decision-log.md` 采用第 12 条）。

验证 agent 最小骨架（结构化判定 + 分支）：

```js
const CHECK = {
  type: 'object', additionalProperties: false,
  properties: {
    pass: { type: 'boolean' },
    falsified: { type: 'array', items: { type: 'string' } }, // 被证伪的具体点
    notes: { type: 'string' },
  },
  required: ['pass', 'falsified'],
}
const result = await agent('实现：产出 X，返回成果文本', { label: 'impl', phase: 'Build' })
const check = await agent(
  `这是待验证的成果：\n${result}\n请独立核查，尝试证伪，按 schema 返回。`,
  { label: 'verify', phase: 'Verify', schema: CHECK },
)
if (!check.pass) log(`验证未通过，被证伪点：${check.falsified.join('; ')}`)
```

## 三、独立交叉审查（实现者不自评，审查者全新实例）

"交叉审查"是把验证从"一个核查者"升级为"多个互不依赖的核查者"。原则：

- **审查者是全新实例**：每个审查 agent 都是独立 `agent()` 调用，拥有自己的上下文窗口，看不到实现者的内部推理，只看到最终成果（Subagent 返回压缩摘要、上下文隔离，见 `evidence/02-research-findings.md` §1）。
- **实现者不参与审查**：实现 agent 与审查 agent 不能是同一实例（`workflow/CLAUDE.md` 三-1；`03-decision-log.md` 采用第 12 条）。
- **审查阶段用 `phase()` 归组**：把审查 agent 显式归入审查 phase，避免在 `pipeline/parallel` 内竞争全局 phase 状态（`01-workflow-api-ground-truth.md` §2 `opts.phase`）。

本项目把"独立审查"沉淀为专职子代理 `workflow-reviewer`（见第八节），它的设定就是"没有参与任何设计与实现，只评审"（`.claude/agents/workflow-reviewer.md` 第 8 行）。

## 四、对抗式证伪与多视角 lens

这是 `01-workflow-api-ground-truth.md` §5 与 `02-research-findings.md` §4 推荐的两种独立审查质量模式：

### 4.1 对抗式证伪（多 skeptic，多数证伪则否决）

派生多个**独立 skeptic**，每个都被要求**主动证伪**成果（找出它哪里错、哪里站不住），而不是"看看对不对"。然后按多数表决：

- 退出/否决判据用固定可观测缺省值，例如"≥2/3 的 skeptic 标 FAIL 则否决"（`03-decision-log.md` 采用第 13 条，标注为示例缺省值）。
- **skeptic 数量不要按风险开数量矩阵**（如低/中/高风险分别 2-3/4-5/6-8 个）——该做法无实测支撑、逼近并发上限、属"为展示堆 agent"，已被否决（`03-decision-log.md` 否决项第 5 条）。固定一个小而可解释的数量（如 3 个）即可。
- **聚合策略（多数/权重/一票否决）规范未给定**，须团队按风险约定（`03-decision-log.md` 未确认第 8 条）。本篇默认采用"多数证伪则否决"，属团队约定而非 API 约束。

```js
const SKEPTIC = {
  type: 'object', additionalProperties: false,
  properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, reasons: { type: 'array', items: { type: 'string' } } },
  required: ['verdict', 'reasons'],
}
const SKEPTICS = 3 // 示例缺省值，非 API 约束
// parallel 是栅栏：需要"全部 skeptic 结果一起"做多数表决，故用 parallel 而非 pipeline
const votes = (await parallel(
  Array.from({ length: SKEPTICS }, (_, i) => () =>
    agent(`你是第 ${i + 1} 个独立 skeptic，目标是证伪以下成果而非确认它：\n${result}`,
      { label: `skeptic-${i + 1}`, phase: 'Adversarial', schema: SKEPTIC })),
)).filter(Boolean) // .filter(Boolean) 只用于 parallel 整体返回的数组
const fails = votes.filter(v => v.verdict === 'FAIL').length
const rejected = fails * 2 >= votes.length // 多数（含半数以上）证伪则否决；示例判据
if (rejected) log(`对抗式证伪：${fails}/${votes.length} 标 FAIL，否决。`)
```

> `.filter(Boolean)` 只能作用于 `parallel()/pipeline()` 整体返回的结果数组，**不能**用在 stage 内部的标量 `prevResult` 上（`03-decision-log.md` 采用第 4 条，修正的 P0 错误）。

### 4.2 多视角验证（每个验证者一个不同 lens）

与"多个同质 skeptic"不同，多视角是给每个验证者**一个不同的审查 lens**，覆盖不同维度。本项目的独立评审就用了三种 lens：「完整性与证据」「可执行性与过度设计」「成本与质量」（见 `evidence/03-decision-log.md` 评审过程概述）。

```js
const LENSES = [
  { id: 'evidence', prompt: '只从"完整性与证据是否充分"的角度审查' },
  { id: 'overdesign', prompt: '只从"可执行性与是否过度设计"的角度审查' },
  { id: 'cost', prompt: '只从"成本与规模克制、质量独立性"的角度审查' },
]
const reviews = (await parallel(LENSES.map(l => () =>
  agent(`${l.prompt}：\n${result}`, { label: `lens-${l.id}`, phase: 'Review', schema: CHECK })))).filter(Boolean)
```

> 选 `parallel` 还是 `pipeline` 的依据是"是否需要全量跨 item 结果一起"，**与谁更快无关**（`03-decision-log.md` 采用第 3 条）。这里要把所有 lens / skeptic 的判定**汇总后**做表决，属于"需要全集"，所以用 `parallel` 栅栏。

## 五、失败重试与降级（agent 返回 null 的处理）

`agent()` 在两种情况返回 `null`（`01-workflow-api-ground-truth.md` §2）：

1. 用户中途**跳过**了该 agent；
2. 终态 API 错误、重试后仍失败（**这里的"重试"由 StructuredOutput / 平台层完成**，schema 不匹配会自动重试；脚本拿到的已是最终结果）。

脚本侧的处理纪律：

- **整体数组用 `.filter(Boolean)` 过滤掉 null**（`pipeline/parallel` 返回数组）。
- **`pipeline` 的 stage 内部不能 filter**：stage 抛错会让该 item 落 `null` 并跳过其余 stage；在 stage 内部对单个 `prevResult` 判空要用短路 `if (!prev) return null`，而不是 `.filter`（`03-decision-log.md` 采用第 4 条）。
- **降级而非硬失败**：当验证/审查 agent 返回 null 导致样本不足，应记录覆盖缺口并降级（如减少表决基数、标注"部分未覆盖"），而不是假装通过。
- **预算降级**：`budget` 是硬上限，超额会在**下一次** `agent()` 调用时抛错（非整轮回滚）。fan-out 前应主动查 `budget.remaining()`，不够就少开 skeptic / 降 effort / 跳过非关键验证，而不是撞上限（`01-workflow-api-ground-truth.md` §2、§3；`03-decision-log.md` 采用第 5、14 条）。

```js
const round = (await parallel(FINDERS.map(f => () =>
  agent(f.prompt, { phase: 'Find', schema: BUGS })))).filter(Boolean) // 丢弃 null
if (round.length < FINDERS.length) {
  log(`本轮 ${FINDERS.length - round.length} 个验证者无结果（跳过/失败），按现有 ${round.length} 个降级表决。`)
}
```

> 注：`StructuredOutput` 自动重试是否有次数上限，以及 `budget.total` 的计量口径/超限是否整轮回滚，规范均未明确，属开放问题（`03-decision-log.md` 未确认第 2、6 条），不应写成确定结论。

## 六、退出条件与最大轮次（防无限循环）

任何循环（loop-until-dry / loop-until-count / loop-until-budget / 评审-返工）都必须同时具备：

1. **一个可观测的成功退出条件**（如连续 K 轮无新增、累计到量、verdict==PASS）。
2. **一个硬性的最大轮次/预算上限**（防止永远达不到成功条件时无限循环）。

骨架与具体写法见 `script-patterns.md` §4–§6，本篇不重复。要点提醒：

- `budget.total` 为 null 时 `remaining()` 返回 `Infinity`，按预算循环前**必须先判 `budget.total`**，否则会一路跑到 1000 个 agent 的全局兜底上限（`script-patterns.md` §5；`01-workflow-api-ground-truth.md` §2、§3）。
- 所有阈值（最大 3 轮、连续 2 轮无新增、≥2/3 否决）都是**示例缺省值，非 API 约束**，必须在文档/注释里标注，且不要使用不可测指标（`03-decision-log.md` 采用第 13 条）。
- 上限触发时不是"成功退出"，应**如实记录"达到上限仍未满足成功条件"**并据此报告，而不是把"跑满轮次"当成通过。

## 七、评审-返工有界循环（≤2 轮，任何 P0→FAIL）

这是把第二～六节合成的完整质量门禁循环，与 `script-patterns.md` §6、`review-rubric.md` 评审-返工流程一致：

1. **全新实例评审 → 出 verdict**（PASS / CONDITIONAL_PASS / FAIL）。
2. **非 PASS**：把 `mustFix` 发给**实现者**（与评审者不同实例）返工。
3. **新的**评审实例复评——重新独立核查，**不信"已改"的自述**。
4. **最多 2 轮返工**；仍不过 → **如实输出未完成报告，不得声称完成**。
5. **任何 P0 → FAIL**，无论分数高低（`review-rubric.md` 判级；`workflow-reviewer.md` 判级规则）。

骨架（与 `script-patterns.md` §6 一致，逐字对照其结构）：

```js
const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'CONDITIONAL_PASS', 'FAIL'] },
    score: { type: 'number' },
    p0: { type: 'array', items: { type: 'string' } },
    mustFix: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'score', 'p0', 'mustFix'],
}
let round = 0, verdict = null
const history = []
while (round <= 2) {                                        // 初评 + 最多 2 轮复评（示例上限，非 API 约束）
  // 评审者：每轮都是全新实例（独立、不自评）
  verdict = await agent(`独立评审交付物（第 ${round} 轮）。任何 P0 直接 FAIL。`,
    { label: `review-r${round}`, phase: 'Review', agentType: 'workflow-reviewer', schema: VERDICT })
  history.push({ round, verdict })
  const hasP0 = verdict.p0.length > 0
  if (verdict.verdict === 'PASS' && !hasP0) break           // 成功退出：PASS 且无 P0
  if (round === 2) break                                    // 硬上限：2 轮后仍不过则停（如实报告未完成）
  // 实现者（与评审者不同实例）按返工清单修改
  await agent(`按返工清单修改交付物：${JSON.stringify(verdict.mustFix)}`,
    { label: `rework-r${round + 1}`, phase: 'Rework', agentType: 'general-purpose' })
  round++
}
return { verdict, history, passed: verdict.verdict === 'PASS' && verdict.p0.length === 0 }
```

要点：

- `index`/`round` 用来制造逐轮变化的 prompt/label（不用 `Date.now()/Math.random()`，它们会破坏断点恢复，`01-workflow-api-ground-truth.md` §1）。
- 返工与评审用**不同 `agentType`**（`workflow-reviewer` 评审、`general-purpose` 返工），从机制上保证实现者不自评。
- 退出时 `passed` 只在"PASS 且无 P0"时为真；两轮仍不过则 `passed` 为假，调用方应据此**如实报告未完成**（`workflow/CLAUDE.md` 三-4、`review-rubric.md` 第 4 步）。

> `agentType: 'workflow-reviewer'` 仅在从含 `.claude/agents/workflow-reviewer.md` 的项目目录启动时才可解析；否则改用内置 `agentType`（如 `general-purpose`）并把评审 rubric 写进 prompt（`script-patterns.md` §6 注；`01-workflow-api-ground-truth.md` §4、§6）。

## 八、workflow-reviewer agent 的角色

`workflow-reviewer`（`.claude/agents/workflow-reviewer.md`）是本项目的**独立评审专职子代理**，在上面的有界循环里充当"全新实例评审者"。它的关键设定：

- **只评审、不设计不实现**，专为杜绝"实现者自评"而设（定义第 8 行）。
- 工具受限为只读核查类：`Read, Bash, Grep, Glob, WebFetch`，模型 `opus`——它**不能修改任何交付物**（纪律第 1 条）。
- 必须**实际打开**文档/脚本/运行记录/证据真实核查，对"可运行"一项必须看到**真实运行记录与产物**，否则按"未验证"处理，不采信"已验证"的自述（工作方式第 1、2 条）。
- 凡涉及 Workflow API 的判断，以 `evidence/01-workflow-api-ground-truth.md` 为准（工作方式第 3 条）。
- 输出结构化结果：`verdict / score / coverageMatrix / issues(P0/P1/P2) / missingEvidence / mustFix / repassConditions / summary`（必须输出 1–8）。
- **判级硬规则**：任何 P0 → FAIL；无 P0 但有阻断 P1 或关键证据缺失 → CONDITIONAL_PASS；无 P0、无阻断 P1、证据齐全、分数达标 → PASS（判级规则；与 `review-rubric.md` 一致）。
- **复评纪律**：每轮重新独立核查，不能只信"已按返工清单修改"的说法（纪律第 3 条）。

它使用的 100 分制评分维度与权重见 docs/08（评审 rubric 深度版），本篇不重复展开。
