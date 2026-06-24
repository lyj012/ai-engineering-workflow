# 通用 Workflow 编排脚本(.js)生成指南

> 配套:`build-workflow.md`(生成 workflow.md 的模板)、`build-prompt.md`(执行提示词)。
> 本文专讲**多 agent 编排脚本 `.js`** 怎么写好。源自多个实战项目的踩坑总结。
>
> 一句话定位:**workflow.md 是"流程",`.js` 是"多 agent 的剧本"**。
> 单 agent 模式根本不需要 `.js`;只有要多个 agent 协同时才写它。

---

## 0. 先判断:这个任务到底要不要 .js(多 agent)?
能切成"好几份能同时干的子任务",或需要"独立第三方复核/多方案竞标" → 写 .js(多 agent)。
就是一条线做到底、强顺序依赖、规模不大 → **别写 .js,用单 agent**(读 workflow.md 执行)即可。
> 多 agent 烧 token 成倍涨,且必须用户明确发起。不要为了多而多。

---

## 1. 黄金法则:workflow.md 是唯一真相源,.js 只管编排 ★
这是本次最重要的教训。**绝不要把流程细节(复核视角、验收标准、修复协议)抄进 .js**。
- `.js` 里每个 `agent()` 的 prompt 写成 **"读 workflow.md 的 §X,按它执行"**。
- `.js` 自己只保留**编排逻辑**:派几个 agent、谁并行谁串行、循环几次、什么条件下停。
- 好处:改流程**只改 workflow.md**,单 agent 和多 agent 行为自动一致,永不漂移。

> 前提:workflow.md 的 §7 必须是结构化的复核/修复真相源(§7.1 复核视角、§7.2 修复协议)。
> 用 `build-workflow.md` 生成的 workflow.md 已自带这一节,所以新项目天然支持。

---

## 2. .js 必备结构
```js
export const meta = {                          // 必须是纯字面量,不能用变量/函数
  name: 'task-name',                           // 触发名:"用 workflow 跑 task-name"
  description: '一句话:这个编排干嘛',
  phases: [                                    // 每个 phase() 一条,title 要对得上
    { title: 'Implement', detail: '...' },
    { title: 'Review',    detail: '...' },
    { title: 'Fix',       detail: '...' },
  ],
}
// 脚本体:纯 JS(不是 TS),async 上下文可直接 await。
// 禁用 Date.now()/Math.random()/new Date()(会破坏断点续跑)。
```

### API 速查
| 写法 | 作用 |
|---|---|
| `await agent(prompt, {label, phase, schema})` | 派 1 个子 agent;给了 schema 就返回校验过的对象 |
| `await parallel([()=>agent(...), ...])` | 并行派一批,**有 barrier**(等全部);失败项变 null,记得 `.filter(Boolean)` |
| `await pipeline(items, stage1, stage2)` | 每个 item 独立流过各阶段,**无 barrier**(默认多阶段用它) |
| `log('...')` | 给用户发一行进度 |
| `phase('Review')` | 开一个进度分组,后续 agent 归到这组 |

> 选择:Review 都依赖"已完成的产物" → 阶段间用串行 + Review 内部 `parallel`(收齐 3 份)。
> 多 item 各自跑多阶段、互不依赖 → 用 `pipeline`(墙钟更短)。

---

## 3. 通用骨架(Implement → Review → Fix,可直接改)
这是最常用的"实现→复核→修复"闭环。把 `ROOT` / 视角 / DONE 换成你的即可。
```js
export const meta = {
  name: 'TASK',
  description: '多 agent:实现→复核→修复。细节以 workflow.md 为唯一真相源,本脚本只编排。',
  phases: [
    { title: 'Implement', detail: '按 workflow.md 执行到 DONE 全绿(重试续上一轮)' },
    { title: 'Review',    detail: '按 workflow.md §7.1 多视角并行复核' },
    { title: 'Fix',       detail: '按 workflow.md §7.2 修复并重验(仅当 needs-work)' },
  ],
}
const ROOT = 'TASK-workflow'
const WF = `${ROOT}/workflow.md`

const PASS = { type:'object', required:['passed','summary'],
  properties:{ passed:{type:'boolean'}, summary:{type:'string'} } }
const REVIEW = { type:'object', required:['lens','findings','verdict'],
  properties:{ lens:{type:'string'}, findings:{type:'array',items:{type:'string'}},
               verdict:{type:'string',enum:['ok','needs-work']} } }

// 阶段一:实现。★ 重试要"续上一轮",不是从零重来
phase('Implement')
let impl = null
for (let attempt = 1; attempt <= 3; attempt++) {
  const resume = attempt === 1 ? ''
    : '⚠️ 上一轮未全绿:先读 state/progress.md 和现有产物,接着续修,不要重写。'
  impl = await agent(
    `你在 ${ROOT}/ 工作。读 ${WF},严格按其 §1–§8 执行到 DONE 全绿。${resume}\n`+
    `全程记 state/,不要停下来问人。返回是否通过。`,
    { label:`implement#${attempt}`, phase:'Implement', schema:PASS })
  if (impl?.passed) break
  log(`第 ${attempt} 轮未全绿,下一轮续修…`)
}
if (!impl?.passed) { log('⚠️ 三轮未过,交人看 state/progress.md'); return { ok:false, impl } }

// 阶段二:复核。视角由 workflow.md §7.1 定义,脚本只负责"派几个、并行"
// ★ LENSES 须与 §7.1 对齐:改视角先改 §7.1,再同步这里(这里只是"派几个"的名单,细节不内联)
phase('Review')
const LENSES = ['correctness','robustness','readability']
const reviews = (await parallel(LENSES.map(lens => () =>
  agent(`读 ${WF} 的 §7.1,用「${lens}」视角复核 ${ROOT}/ 的产物(只读不许改),给 findings+verdict。`,
    { label:`review:${lens}`, phase:'Review', schema:REVIEW })
))).filter(Boolean)

// 阶段三:修复。★ 审查要有牙——按意见改 + 必须重验仍全绿
const needWork = reviews.filter(r => r.verdict === 'needs-work')
if (!needWork.length) { log('复核全 ok,无需修复'); return { ok:true, impl, reviews, fix:null } }
phase('Fix')
const findings = needWork.flatMap(r => r.findings.map(f => `[${r.lens}] ${f}`))
let fix = null
for (let attempt = 1; attempt <= 2; attempt++) {
  fix = await agent(
    `你在 ${ROOT}/ 工作。读 ${WF} 的 §7.2,按其协议处理以下意见:\n`+
    findings.map((f,i)=>`${i+1}. ${f}`).join('\n'),
    { label:`fix#${attempt}`, phase:'Fix', schema:PASS })
  if (fix?.passed) break
  log(`修复第 ${attempt} 轮未保持全绿,重试…`)
}
return { ok: fix?.passed ?? false, impl, reviews, fix }
```

### 另一种骨架:大规模并行(很多份独立的活)
当任务是"N 份独立子任务"(如反编译一个 DLL 的几十个函数),用 pipeline 铺开:
```js
const units = [...]   // 先扫描/拆出工作清单
const results = await pipeline(units,
  u => agent(`实现/处理 ${u.name},按 ${WF} 执行到该单元的 DONE`, {schema:PASS, isolation:'worktree'}),
  (r,u) => agent(`复核 ${u.name} 的产物,按 ${WF} §7.1`, {schema:REVIEW})
)
// 各单元独立流水,item A 在复核时 item B 还在实现,墙钟最短
```
> 并行改同一批文件会冲突时,加 `isolation:'worktree'`(每个 agent 独立 git 工作树)。

---

## 4. 本次踩过的坑 → 写 .js 检查清单
| 坑 | 症状 | 正确写法 |
|---|---|---|
| **瞎重试** | 重试 agent 从零重来,重复同样的错 | 每个 agent() 是全新上下文;重试 prompt 里写"先读 state/ 续上一轮" |
| **审查没牙** | 只 review、不 fix,findings 白挑 | 加 Fix 阶段:按 needs-work 改 + **重跑 DONE 仍全绿** |
| **流程抄进 .js** | workflow.md 改了,.js 行为不变,口径漂 | .js 只 `读 workflow.md §X`,不内联细节 |
| **该用 barrier 却 pipeline / 反之** | 复核拿不到完整产物,或白等 | 依赖全部前一阶段→parallel;各自独立→pipeline |
| **parallel 结果没过滤** | 某 agent 死掉返回 null 导致后续崩 | `.filter(Boolean)` |
| **DONE 不可信** | 永远 FAIL 的废脚本 / 永远 PASS 的水脚本 | 建好先双向验:无产物→FAIL,塞正确产物→PASS |
| **以为脚本能感知 cwd** | 换 cwd 找不到目录 | 脚本里没有文件系统/cwd 概念,`ROOT` 只是传给子 agent 的 prompt 文本;在 prompt 里给**绝对路径**或写清"相对谁",实际 cwd 由 agent 运行环境决定 |
| **meta 用了变量** | 脚本解析失败 | meta 必须纯字面量;phases.title 要和 phase() 调用对得上 |

---

## 5. 怎么触发
脚本放 `项目/.claude/workflows/<name>.js`(想按名字全局发现就放顶层 `.claude/workflows/`)。
- 触发:对 Claude Code 说 **「用 workflow 跑 <name>」**(这就是多 agent 的明确发起)。
- 后台运行,`/workflows` 看实时进度,跑完通知。

---

## 6. ★ 生成一个 .js 时你要提供的输入
| # | 项 | 说明 |
|---|---|---|
| 1 | 任务名 / ROOT 目录 | 触发名 + 产物所在目录 |
| 2 | 它引用哪个 workflow.md | 唯一真相源路径(`ROOT/workflow.md`) |
| 3 | DONE 命令 | 实现阶段跑到全绿的判据 |
| 4 | 阶段结构 | Implement→Review→Fix?还是 大规模并行(pipeline)? |
| 5 | 复核视角 | 默认 correctness/robustness/readability,可加 security/性能等 |
| 6 | 并行还是串行 | 哪些 agent 同时跑、哪些有先后依赖 |
| 7 | 是否需要 worktree 隔离 | 多 agent 并行改同一批文件时需要 |

---

## 7. 让 AI 帮你生成 .js 的提示词(复制改方括号)
```
读 {{WORKSPACE_ROOT}}/build-workflow-js.md,按它的"通用骨架"帮我生成一个 .js 编排脚本。
（{{WORKSPACE_ROOT}} = 模板所在目录，例如 `<repo>/vendor/zhuliming-templates`，替换成你的实际路径）

- 任务名/ROOT:[task-name]
- 引用的真相源:[task-name]-workflow/workflow.md
- DONE 命令:[如 bash tests/run_verify.sh / python3 tests/run_verify.py]
- 阶段结构:[Implement→Review→Fix / 大规模并行 pipeline]
- 复核视角:[默认 correctness/robustness/readability,或加：...]
- 特殊要求:[如 实现阶段并行改文件需 worktree 隔离 / 某阶段串行]

硬要求:① 流程细节不准抄进 .js,每个 agent 都"读 workflow.md §X 执行";
② 实现重试要"续上一轮"不是从零;③ 有复核就要有修复+重验(审查要有牙);
④ parallel 结果 filter(Boolean);⑤ meta 用纯字面量。
生成后存到 [task-name]-workflow/.claude/workflows/[task-name].js,先别跑,给我看。
```

---

## 8. 进阶 API(基础骨架之外的能力)

§2 速查覆盖了常用 80%,以下是写大型/可复用 workflow 时会用到的进阶能力。

### 8.1 `budget`——按 token 预算动态扩缩 ★(控制"多 agent 烧 token")
用户用 `+500k` 之类指令给本回合设的 token 目标,脚本里通过全局 `budget` 读取。
| 字段 | 含义 |
|---|---|
| `budget.total` | 本回合目标(没设则为 `null`) |
| `budget.spent()` | 已花的 output token(主循环+所有 workflow 共享一个池) |
| `budget.remaining()` | `max(0, total-spent())`;没设目标时返回 `Infinity` |

`total` 是**硬上限**:`spent()` 到顶后再 `agent()` 会抛错。两种用法:
```js
// ① 动态循环:必须用 budget.total 守门,否则没设目标时 remaining()=Infinity 会跑到 1000 agent 上限
const bugs = []
while (budget.total && budget.remaining() > 50_000) {
  const r = await agent('找 bug', { schema: BUGS })
  bugs.push(...r.bugs)
  log(`已找到 ${bugs.length},剩 ${Math.round(budget.remaining()/1000)}k`)
}
// ② 静态扩缩:按预算决定派几个
const FLEET = budget.total ? Math.floor(budget.total / 100_000) : 5
```

### 8.2 `args`——让 workflow 可参数化
工具调用时传入的 `args` 原样暴露为全局 `args`(没传则 `undefined`)。
命名 workflow 复用时关键:把研究问题/目标路径/配置对象直接传进来,不用走文件旁路。
```js
const target = args?.path ?? 'src/'      // 用 workflow 跑时:args:{path:'lib/'}
```
> 注意:传数组/对象要传**真正的 JSON 值**(`args:["a.ts","b.ts"]`),不要传 JSON 字符串,否则 `args.map/filter` 会炸。

### 8.3 `workflow()`——把别的 workflow 当子步骤(仅一层)
```js
const r1 = await workflow('其他已存 workflow 名', { 给它的 args })
const r2 = await workflow({ scriptPath: '之前写好的脚本.js' }, argsObj)
```
子 workflow 共享本次的并发上限/agent 计数/中止信号/token 预算,其 agent 在 `/workflows` 里归到 `▸ 名字` 分组。**嵌套只允许一层**(子里再 `workflow()` 会抛错)。名字未知/脚本读不到/语法错会抛,需要时 `try/catch`。

### 8.4 断点续跑——工具层的 resume(不是 prompt 技巧)
§3 讲的"重试续上一轮"是 **prompt 层**的话术;这里是**工具层**真正的缓存续跑:
- 每次调用 Workflow 都会把脚本**落盘**,并在结果里返回 `scriptPath` 和 `runId`。
- 迭代脚本:用 Write/Edit 改那个文件,再以 `{scriptPath}` 重跑,不必重发整段。
- 续跑:`Workflow({scriptPath, resumeFromRunId})`——**最长未改前缀**的 `agent()` 调用瞬间返回缓存结果,从第一个改动/新增的调用起才真跑。同脚本+同 args → 100% 命中。
- 这正是禁用 `Date.now()/Math.random()/new Date()` 的原因:它们会破坏续跑的确定性。
> 续跑前先 `TaskStop` 停掉上一次运行。仅限同一 session。

### 8.5 `agent()` 的其余 opts
| opt | 作用 | 默认 / 建议 |
|---|---|---|
| `model` | 覆盖该 agent 的模型 | **默认省略**,继承主循环模型;非常确定某档更合适才设 |
| `effort` | 覆盖推理强度 `'low'..'max'` | 省略=继承;机械活用 `'low'`,最难的 verify/judge 才上高档 |
| `agentType` | 用自定义子 agent(如 `'Explore'`、`'code-reviewer'`) | 与 `schema` 可组合;不填用默认 workflow 子 agent |

### 8.6 硬性上限(写大规模 pipeline 必知)
- **并发**:每个 workflow 同时最多 `min(16, 核数-2)` 个 agent;超出的排队,不会丢。
- **生命周期总数**:单个 workflow 最多 1000 个 agent(防失控兜底,远高于正常用量)。
- **单次调用**:一次 `parallel()`/`pipeline()` 最多 4096 项,超了直接报错(不是静默截断)。
- **子 agent 返回值**:子 agent 被告知"你的最终文本就是返回值",所以返回**裸数据**;要结构化就用 `schema`(在工具层校验、不匹配会让模型重试)。

---

## 9. 质量模式(按需组合,提升结果可信度)

§3 的 Implement→Review→Fix 已是其中一种(独立第三方复核)。其余官方推荐模式,按任务挑用:

| 模式 | 用法 | 何时用 |
|---|---|---|
| **adversarial verify** | 每个发现派 N 个独立 skeptic,prompt 要求"尽力反驳,拿不准默认 refuted=true",过半反驳就毙掉 | 防"看着对其实错"的发现混过去 |
| **perspective-diverse verify** | 一个发现可能多种死法时,给每个 verifier 不同视角(correctness/security/perf/能否复现),而非 N 个一样的反驳者 | 冗余抓不到的失败模式 |
| **judge panel** | 从不同角度生成 N 个方案,并行打分,从胜者综合并嫁接亚军亮点 | 解空间宽、单方案迭代不够好 |
| **loop-until-dry** | 持续派 finder,直到连续 K 轮没有新发现才停 | 未知规模的发现(bug/边角),简单计数会漏尾巴 |
| **multi-modal sweep** | 多个 agent 各用不同检索角度(按容器/按内容/按实体/按时间),彼此盲查 | 单一角度搜不全 |
| **completeness critic** | 收尾派一个 agent 问"还缺什么——没跑的模态、没验的断言、没读的源",其发现作为下一轮工作 | 防止"看着覆盖全了其实没有" |

```js
// adversarial verify 示例:3 个 skeptic 投票,≥2 个不反驳才算站得住
const votes = await parallel(Array.from({length:3}, () => () =>
  agent(`尝试反驳:${claim}。拿不准就 refuted=true。`, { schema: VERDICT })))
const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
```
> 规模匹配诉求:"找下 bug"→几个 finder、单票;"彻底审计/要全面"→更大 finder 池 + 3–5 票 adversarial + 综合阶段。
> **别静默截断**:若做了 top-N / 不重试 / 抽样等限界,用 `log()` 说明丢了什么,否则读起来像"全覆盖"了。

---

## 10. 三份文件的分工(全景)
| 文件 | 角色 |
|---|---|
| `build-workflow.md` | 生成 **workflow.md**(流程,§1–§10,含 §7 复核/修复真相源)的模板 |
| `build-prompt.md` | **执行提示词**(单 agent ②、多 agent 触发 ③ 等) |
| `build-workflow-js.md`(本文) | 生成 **.js 编排脚本**(多 agent 剧本)的指南 |

> 心智模型:workflow.md=流程,prompt=怎么发起,.js=多 agent 怎么协同。
> 改流程只改 workflow.md;要多 agent 才写 .js,且 .js 只编排不抄流程。
