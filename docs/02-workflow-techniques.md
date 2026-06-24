# 02 Workflow 阶段拆分与控制流技巧

> 本文聚焦"如何把一项工作拆成阶段、用哪种控制流原语把它们串起来"。
> 所有 API 形态以 `evidence/01-workflow-api-ground-truth.md`（产品内一手规范）为准。脚本是**纯 JS**；`meta` 必须纯字面量；`meta.phases[].title` 与脚本里 `phase('...')` 调用**逐字一致**；脚本体内禁用 `Date.now()` / `Math.random()` / 无参 `new Date()`；脚本体无文件系统 / Node API，一切 IO 只能经子代理。
> 五构件职责边界、断点恢复、成本控制、反模式等不在本文展开，详见 docs/01、docs/05、docs/07（按项目实际编号）。

---

## 0. 一条贯穿全文的选择原则

> **选 `pipeline()` 还是 `parallel()`，看的是数据依赖，不是谁更快。**

- 只有当某个阶段真的需要**前一阶段全部 item 的跨条结果**（去重、合并、全集早退、相互比较）时，才用 `parallel()` 的栅栏把流水切断。
- 否则一律 `pipeline()`：每个 item 各自独立穿过所有阶段，阶段之间没有栅栏。
- 纯 transform（`flatMap` / `map` / `filter`，无跨 item 依赖）**内联进某个 stage 或 stage 之间的普通 JS**，不要为它单开一道 `parallel()` 栅栏。这是最常见的浪费墙钟的写法。

记住这一条，下面每种技巧都是它的具体落地。

---

## 1. phase 拆分：先切阶段，再选控制流

`phase(title)` 开启一个新阶段，之后派生的 `agent()` 归入该进度组，用户在 `/workflows` 里按 phase 看进度。拆分阶段时：

- **每个阶段要有明确的输入 / 输出 / 完成标准**；阶段是"工作的语义边界"，不是"为了显示分组而切"。
- `meta.phases` 里声明的 `title` 必须与脚本体内 `phase('...')` 调用**逐字一致**（规范只要求逐字一致，未明示不一致的后果，故此处不臆断后果，只照做）。
- 在 `pipeline()` / `parallel()` 内部派生的 `agent()`，应通过 `opts.phase` 显式归组，避免它们竞争全局 phase 状态（见后文骨架里的 `{ phase: 'S1' }`）。

最小骨架：

```js
export const meta = {
  name: 'my-workflow',
  description: '一句话说明这个 workflow 做什么',
  phases: [{ title: 'Collect' }, { title: 'Synthesize' }], // 与下面 phase() 逐字一致
}

phase('Collect')
const raw = await agent('收集 X 的原始材料，返回要点文本')

phase('Synthesize')
const out = await agent(`基于以下材料综合成结论：\n${raw}`)

return { out }
```

---

## 2. pipeline：多阶段的**默认**选择（无栅栏）

`pipeline(items, stage1, stage2, ...) -> Promise<any[]>`：每个 item 独立穿过所有 stage，**stage 之间无栅栏**——item A 可能已在 stage3，而 item B 还在 stage1。

- **墙钟 = 最慢单条链**，而不是"各 stage 最慢之和"。这正是默认用它的原因。
- **stage 回调签名**：`(prevResult, originalItem, index)`。第一个 stage 的 `prevResult` 即原始 item。
- 某 item 在某 stage 抛错 → 该 item 落 `null` 并**跳过其余 stage**，不影响其他 item。
- 单次最多 **4096** 个 item（超出报错，非静默截断）。

> **`.filter(Boolean)` 的位置（一个易错点）**：`.filter(Boolean)` 只能作用于 `pipeline()` 整体返回的**结果数组**，用于剔除失败落 `null` 的 item。stage 回调内部只拿到单个标量 `prevResult`，对它调 `.filter` 会报错；stage 内要短路就用 `if (!prev) return null`。

最小骨架：

```js
const S1 = { type: 'object', additionalProperties: false,
  properties: { x: { type: 'string' } }, required: ['x'] }
const S2 = { type: 'object', additionalProperties: false,
  properties: { y: { type: 'string' } }, required: ['y'] }

const results = await pipeline(
  items,
  (item) => agent(`阶段1 处理 ${item.name}`, { phase: 'S1', schema: S1 }),
  (s1, item, i) => {
    if (!s1) return null                                  // stage 内短路，不用 filter
    return agent(`阶段2 基于 ${s1.x} 处理 ${item.name}（第 ${i} 条）`,
      { phase: 'S2', schema: S2 })
  },
)
const ok = results.filter(Boolean)                          // filter 只用在整体返回数组上
```

---

## 3. parallel：栅栏（仅当确实需要"全部结果一起"）

`parallel(thunks) -> Promise<any[]>`：并发执行一组 `() => Promise`，**是栅栏**（等全部完成才返回）。

- 何时用：下一步必须基于**全量跨 item 结果**才能做——去重、合并、求全集、全集早退、item 之间相互比较。除此之外不要用。
- 某个 thunk 抛错 → 该位置落 `null`（`parallel()` 调用本身不会 reject），用 `.filter(Boolean)` 过滤。
- 同样受 4096 item 上限约束。

最小骨架（典型用途：先并发拿全量发现，再做需要全集的去重）：

```js
const FIND = { type: 'object', additionalProperties: false,
  properties: { findings: { type: 'array', items: { type: 'string' } } },
  required: ['findings'] }

const all = (await parallel(dims.map(d => () =>
  agent(d.prompt, { phase: 'Scan', schema: FIND })))).filter(Boolean)

const deduped = [...new Set(all.flatMap(r => r.findings))]  // 需要全集才能做的去重
```

---

## 4. 分支（条件控制流）

分支就是普通 JS 的 `if/else`——决定"下一步跑什么"的是脚本，不是模型。常见做法：先用一个 agent（最好带 `schema`）做出**结构化判定**，脚本再据此选择后续路径。

```js
const TRIAGE = { type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['simple', 'complex'] } },
  required: ['kind'] }

phase('Triage')
const t = await agent('判定任务属于 simple 还是 complex，按 schema 返回', { schema: TRIAGE })

phase('Handle')
let result
if (t.kind === 'complex') {
  result = await agent('按复杂路径处理：先方案再实现', { effort: 'high' })
} else {
  result = await agent('按简单路径直接处理')
}
return { kind: t.kind, result }
```

> 把判定做成 `schema` 的枚举字段，分支条件就稳定可读；不要让脚本去解析自由文本来决定走向。

---

## 5. 循环（必须有最大轮次与可观测退出）

> **铁律**：任何循环都必须有**最大轮次**和**可观测的退出条件**，防止无限循环跑到 1000 个 agent 的兜底上限。下面的缺省值（连续 2 轮、累计 10 条等）是**示例值，非 API 约束**，按任务调整。

### 5.1 loop-until-dry（连续 K 轮无新增才停，适合规模未知的发现类）

```js
const BUGS = { type: 'object', additionalProperties: false,
  properties: { bugs: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    properties: { key: { type: 'string' }, desc: { type: 'string' } },
    required: ['key', 'desc'] } } },
  required: ['bugs'] }

const seen = new Set(), found = []
let dry = 0, round = 0
while (dry < 2 && round < 5) {                              // 退出：连续 2 轮无新增 或 满 5 轮
  const got = (await parallel(FINDERS.map(f => () =>
    agent(f.prompt, { phase: 'Find', schema: BUGS }))))
    .filter(Boolean).flatMap(r => r.bugs)
  const fresh = got.filter(b => !seen.has(b.key))
  if (!fresh.length) { dry++; round++; continue }
  dry = 0; round++
  fresh.forEach(b => seen.add(b.key)); found.push(...fresh)
}
log(`发现 ${found.length} 条，共 ${round} 轮（dry=${dry}）`)  // 可观测退出
```

### 5.2 loop-until-count / loop-until-budget

```js
// 累计到量（带轮次上限兜底）
const bugs = []
let r = 0
while (bugs.length < 10 && r < 5) {
  const got = await agent('找 bug', { schema: BUGS })
  bugs.push(...got.bugs); r++
}

// 按预算：无 budget.total 时 remaining() 为 Infinity，必须先判 total，
// 否则会一直跑到 1000 上限。budget 是硬上限，spent() 达 total 后再调 agent() 会抛错。
while (budget.total && budget.remaining() > 50_000) {
  const got = await agent('继续深挖', { schema: BUGS })
  bugs.push(...got.bugs)
}
```

> 循环里被丢弃 / 截断的覆盖面要 `log()` 出来，不要静默截断（详见 docs/07 反模式）。

---

## 6. 扇出 / 扇入（fan-out / fan-in）

"扇出"= 一次派生多个并发 agent；"扇入"= 把它们的结果收回脚本归并。关键判断仍是第 0 节那条原则：

- **扇出后立即需要全量结果归并** → 用 `parallel()`（栅栏），扇入就是 `.filter(Boolean)` 后的 `flatMap` / 归并。见第 3 节骨架。
- **扇出的每条结果还要各自继续走后续阶段，且彼此独立** → 用 `pipeline()`，让每条链各自流动，不要用栅栏卡齐。见第 2 节骨架。

扇出规模受三道上限约束（详见 docs/05 成本控制）：单次 `parallel/pipeline` ≤ 4096 item；同时并发 `agent()` ≤ `min(16, CPU核数-2)`（超出排队）；全生命周期 agent 总数 ≤ 1000。

---

## 7. 汇总（synthesize）

汇总是"扇入"之后的收口阶段：把多条结果合成一份产物。两点纪律：

1. **汇总用独立 agent，不要让实现者自评自总**——综合 / 评审应由与产出者不同的实例完成（质量靠独立性，详见 docs/04）。
2. **纯 transform 的归并内联进脚本即可**，不必为它再开一个 agent；只有当合成需要"理解与再创作"（如把多份调研写成一篇结论）时才派生 agent。

```js
phase('Synthesize')
const merged = ok.flatMap(r => r.findings)                 // 纯 transform：内联，无需 agent
const report = await agent(
  `把下面 ${merged.length} 条发现综合成一份结构化结论，去重并标注分歧：\n` +
  JSON.stringify(merged),
  { phase: 'Synthesize' })
return { count: merged.length, report }
```

---

## 8. 速查：选型对照

| 场景 | 用什么 | 关键依据 |
| --- | --- | --- |
| 多阶段、各 item 独立 | `pipeline()`（默认） | 无跨 item 依赖；墙钟=最慢单链 |
| 下一步需要全量跨 item 结果 | `parallel()`（栅栏） | 去重/合并/全集早退/相互比较 |
| 纯 `map/flatMap/filter` | 内联进 stage / 脚本 | 不为它单开栅栏 |
| 按结构化判定选路径 | JS `if/else` + `schema` 枚举 | 脚本决定走向，非模型 |
| 规模未知的发现 | loop-until-dry | 连续 K 轮无新增（+最大轮次） |
| 攒够数量 / 花完预算 | loop-until-count / -budget | 必须有轮次或 total 兜底 |

> 一句话总结：**默认 pipeline，栅栏要省着用；纯 transform 内联进 stage；循环必须有最大轮次和可观测退出；选型看数据依赖，不看谁更快。**
