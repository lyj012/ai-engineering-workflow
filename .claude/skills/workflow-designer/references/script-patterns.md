# Workflow 脚本骨架（可直接照抄）

> 全部与仓库内 `evidence/01-workflow-api-ground-truth.md` 一致。脚本是**纯 JS**；`meta` 必须纯字面量；脚本体禁用 `Date.now()/Math.random()/无参 new Date()`。

## 0. 最小骨架

```js
export const meta = {
  name: 'my-workflow',
  description: '一句话说明',
  phases: [{ title: 'Do' }],   // title 要与下面 phase('Do') 逐字一致
}
phase('Do')
const out = await agent('做这件事，返回结论文本')
return { out }
```

## 1. 结构化输出（强烈推荐：降解析、降上下文）

```js
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
  required: ['title', 'items'],
}
const r = await agent('分析 X，按 schema 返回', { schema: SCHEMA })  // r 是已校验对象
```

## 2. pipeline —— 多阶段默认（无栅栏，逐 item 流水）

```js
const results = await pipeline(
  items,
  (item) => agent(`阶段1 处理 ${item.name}`, { phase: 'S1', schema: S1 }),
  (s1, item, i) => agent(`阶段2 基于 ${s1.x} 处理 ${item.name}`, { phase: 'S2', schema: S2 }),
)
// item A 可在 S2，item B 还在 S1；墙钟=最慢单条链。stage 抛错→该 item 落 null。
const ok = results.filter(Boolean)
```

## 3. parallel —— 栅栏（仅当需要全量结果一起）

```js
const all = (await parallel(dims.map(d => () =>
  agent(d.prompt, { schema: FIND })))).filter(Boolean)     // 等全部完成
const deduped = dedupe(all.flatMap(r => r.findings))        // 需要全集才做的去重
```

## 4. loop-until-dry —— 未知规模发现（连续 K 轮无新增才停）

```js
const seen = new Set(), found = []
let dry = 0
while (dry < 2) {                       // 退出条件：连续 2 轮无新增
  const round = (await parallel(FINDERS.map(f => () =>
    agent(f.prompt, { phase: 'Find', schema: BUGS })))).filter(Boolean).flatMap(r => r.bugs)
  const fresh = round.filter(b => !seen.has(b.key))
  if (!fresh.length) { dry++; continue }
  dry = 0; fresh.forEach(b => seen.add(b.key)); found.push(...fresh)
}
```

## 5. loop-until-count / loop-until-budget

```js
const bugs = []
while (bugs.length < 10) {                                  // 累计到量
  const r = await agent('找 bug', { schema: BUGS }); bugs.push(...r.bugs)
}
// 按预算（无 budget.total 时 remaining()=Infinity，必须先判 total，否则会跑到 1000 上限）
while (budget.total && budget.remaining() > 50_000) {
  const r = await agent('继续深挖', { schema: BUGS }); bugs.push(...r.bugs)
}
```

## 6. 评审-返工 有界循环（实现者不自评，最多 2 轮返工）

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
while (round <= 2) {                                        // 初评 + 最多 2 轮复评
  // 评审者：每轮都是全新实例（独立、不自评）
  verdict = await agent(`独立评审交付物（第 ${round} 轮）。任何 P0 直接 FAIL。`,
    { label: `review-r${round}`, phase: 'Review', agentType: 'workflow-reviewer', schema: VERDICT })
  history.push({ round, verdict })
  const hasP0 = verdict.p0.length > 0
  if (verdict.verdict === 'PASS' && !hasP0) break           // 退出条件：PASS 且无 P0
  if (round === 2) break                                    // 上限：2 轮后仍不过则停（如实报告未完成）
  // 实现者（与评审者不同实例）按返工清单修改
  await agent(`按返工清单修改交付物：${JSON.stringify(verdict.mustFix)}`,
    { label: `rework-r${round + 1}`, phase: 'Rework', agentType: 'general-purpose' })
  round++
}
return { verdict, history, passed: verdict.verdict === 'PASS' && verdict.p0.length === 0 }
```

> 注意：`agentType: 'workflow-reviewer'` 仅在从含 `.claude/agents/workflow-reviewer.md` 的项目目录启动时可解析；否则改用内置 `agentType`（如 `general-purpose`）并把评审 rubric 写进 prompt。

## 7. 断点恢复

```text
首次：Workflow({ script })                          → 返回 runId
改脚本后续跑：Workflow({ scriptPath, resumeFromRunId: '<上次 runId>' })
            未改动的 agent() 前缀瞬时返回缓存，从首个改动处实跑。需先停掉上次运行。
```

## 8. 命令行直接跑（无 Workflow 工具时的等价手段）

`agent()` 的本质是子代理；脚本之外也可用 `claude -p "<prompt>"` 串起，或用 Agent 工具逐个派生——但会失去确定性编排与断点恢复，仅作降级。
