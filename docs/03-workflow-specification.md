# 03 Workflow 设计规范与硬约束

> 本文是 Workflow 脚本的**规范层**：把"什么能写、什么不能写、原语怎么签名、上限是多少"一次说清。
> 所有 API 结论以 `evidence/01-workflow-api-ground-truth.md`（产品内一手规范）为准；与网络旧文档冲突，以一手锚点为准。
> 决策取舍与未决项见 `evidence/03-decision-log.md`；研究溯源见 `evidence/02-research-findings.md`。
> 编排时的**逐项落地清单**见 `.claude/skills/workflow-designer/references/design-checklist.md`（本文末尾"落地清单"再次指向它）。

---

## 1. 脚本硬约束清单（违反则解析/运行失败或破坏断点恢复）

下列每条都是**硬约束**，不是风格建议。写脚本前逐条对照。

### 1.1 脚本是纯 JavaScript（非 TypeScript）
- 不能写类型注解、`interface`、泛型、`as` 断言——会解析失败。
- 标准 JS 内置可用（`JSON` / `Math` / `Array` / `Object` / `Promise` …），但见 1.4 的两个例外。
- 脚本体在 async 上下文中运行，可直接 `await`，无需自己包 `async function`。

### 1.2 必须以纯字面量 `export const meta = {...}` 开头
- `meta` **必须是纯字面量**：不能含变量、函数调用、展开运算（`...`）、模板插值（`` `${}` ``）。
- 必填字段：`name`、`description`。
- 可选字段：`whenToUse`、`phases`（数组，每项 `{ title, detail?, model? }`）、`model`。
- 示例（合规）：

```js
export const meta = {
  name: "example-flow",
  description: "演示 meta 必须是纯字面量",
  whenToUse: "需要 X 时",
  phases: [
    { title: "调研" },
    { title: "汇总" }
  ]
};
```

- 反例（**会失败**）：`phases: [{ title: "调研 " + suffix }]`、`name: makeName()`、`...baseMeta`。

### 1.3 `meta.phases[].title` 与脚本里 `phase('...')` 调用逐字一致
- `meta` 中声明的每个 `title`，要和脚本体里 `phase('...')` 传入的字符串**逐字相同**（含中英文、空格、标点、大小写）。
- 规范只要求"逐字一致"，**未明示不一致的后果**——本文不把它断言为"解析失败"或"进度错乱"（属未经证据的推测，见 `03-decision-log.md` 采用结论 2）。结论：当成硬约束遵守即可，不要去赌后果。

### 1.4 禁用 `Date.now()` / `Math.random()` / 无参 `new Date()`
- 这三者在脚本体内调用会**抛错**，因为它们会破坏断点恢复（resume 时无法复现同一结果）。
- 需要时间戳：从 `args` 传入，或等 workflow 返回后在脚本外打戳。
- 需要随机性 / 多样性：用 stage 回调里的 `index` 去变化 prompt 或 `label`（例如不同 index 给不同提问角度），而不是抽随机数。

### 1.5 脚本体无文件系统 / 无 Node API
- 脚本本体**不能**直接读写文件、不能 `require`/`import` Node 模块、不能跑 shell。
- 一切 IO 必须经**子代理**完成：子代理自带工具（Read / Write / Bash / WebFetch / WebSearch 等）。
  - 例：要读 `evidence/xxx.md`，应派一个 `Explore` 子代理去读并回报，而**不是**在脚本里 `await Read(...)`（后者与本约束冲突，见 `03-decision-log.md` 否决项 4）。
  - 例：要跑 `presubmit-scan.sh`，由带 Bash 的子代理调用并回报；真正的提交前强制门禁应落 PreToolUse Hook（配置须先读项目实际 `settings.json`，不照抄）。

---

## 2. 编排原语速查表（签名 + 要点）

下表只列签名与最关键要点；控制流的**选型决策**（何时 pipeline、何时 parallel）见 `docs` 中控制流文档（如已拆分则"详见对应文档"），本文聚焦"签名与硬语义"。

| 原语 | 签名 | 返回 | 关键要点 |
|---|---|---|---|
| `agent` | `agent(prompt, opts?)` | `Promise<any>` | 无 `schema` 返回最终文本(string)；有 `schema` 返回**已校验对象**；被跳过/终态错误死亡返回 `null` |
| `pipeline` | `pipeline(items, stage1, stage2, ...)` | `Promise<any[]>` | 每 item 独立穿过所有 stage，**stage 间无栅栏**；stage 回调签名 `(prevResult, originalItem, index)`；stage 抛错则该 item 落 `null` |
| `parallel` | `parallel(thunks)` | `Promise<any[]>` | 并发执行一组 `() => Promise`，**是栅栏**（等全部完成）；thunk 抛错→该位 `null`（调用本身不 reject） |
| `phase` | `phase(title)` | — | 开启新阶段，后续 `agent()` 归入该组；`title` 须与 `meta.phases[].title` 逐字一致 |
| `log` | `log(message)` | — | 向用户输出一行进度叙述（如被截断的覆盖面要在此显式说明） |
| `args` | `args`（变量，非函数） | 原值 | Workflow 调用时传入的 `args`；未传则 `undefined`；传数组/对象要传真正 JSON 值，不要传 JSON 字符串 |
| `budget` | `budget`（对象） | — | `{ total: number\|null, spent(): number, remaining(): number }`；硬上限，详见 §4 |
| `workflow` | `workflow(nameOrRef, args?)` | `Promise<any>` | 内联运行另一个 workflow（按名或 `{scriptPath}`）；共享并发/计数/中断/预算；**仅一层嵌套** |

### 2.1 `agent` 的 opts 字段
- `label`：显示名，便于 `/workflows` 追踪。
- `phase`：显式归入某进度组（在 `pipeline`/`parallel` 内尤其要用，避免竞争全局 phase 状态）。
- `schema`：JSON Schema，传入则强制子代理用 StructuredOutput 工具，工具层校验+不匹配自动重试，脚本**不需自己 parse**。
- `model`：覆盖模型。
- `effort`：`'low' | 'medium' | 'high' | 'xhigh' | 'max'`。
- `isolation: 'worktree'`：独立 git worktree，成本高，**仅当并行改文件会冲突时**才用，默认不用。
- `agentType`：内置或自定义子代理类型；内置含 `claude` / `claude-code-guide` / `Explore` / `general-purpose` / `Plan` / `statusline-setup`。任意目录可运行的 workflow 应用**内置** agentType 或省略（自定义 `.claude/agents/*.md` 仅从该项目目录启动才进注册表）。

### 2.2 `null` 与 `.filter(Boolean)` 的正确用法（高频踩坑）
- `.filter(Boolean)` **只能**作用于 `pipeline()` / `parallel()` 整体返回的**结果数组**，用来过滤被跳过/失败位的 `null`。
- **不能**在 stage 内部对 `prevResult` 调 `.filter(Boolean)`——stage 内收到的是**单个标量** `prevResult`，对标量调 filter 会报错。stage 内应这样短路：

```js
const results = await pipeline(
  items,
  (item) => agent("第一步：" + item),
  (prev) => {
    if (!prev) return null;        // 单条短路，禁止 prev.filter(Boolean)
    return agent("第二步：" + prev);
  }
);
const ok = results.filter(Boolean); // 仅在这里过滤整体数组
```

（此条修正了一个 P0 级常见错误，见 `03-decision-log.md` 采用结论 4 / 否决项 1。）

---

## 3. 并发与容量上限（硬数字）

| 限制项 | 上限 | 超出行为 |
|---|---|---|
| 单 workflow 内并发 `agent()` | `min(16, CPU核数-2)` | 超出**排队**（不报错） |
| 全生命周期 agent 总数 | **1000** | 防失控兜底（远超真实需求） |
| 单次 `parallel()` / `pipeline()` 的 item 数 | **4096** | **报错**（非静默截断） |

- 实际并发取决于本机 CPU：8 核机器 = `min(16, 6) = 6` 路并发；18 核及以上才能吃满 16。
- 1000 与 4096 是兜底，正常设计远到不了；若逼近上限说明 fan-out 失控，应回头收敛任务粒度。
- `workflow()` 子调用与父**共享**同一并发上限与计数器（不是各自独立配额）。

---

## 4. `budget` 硬上限语义

- `budget` 是对象：`{ total: number|null, spent(): number, remaining(): number }`。
- `total` 是本轮 Token 目标；未设时为 `null`，此时 `remaining()` 为 `Infinity`。
- **硬上限**：`spent()` 达到 `total` 后，**下一次** `agent()` 调用会抛错（在该次调用点抛，**不是**整轮回滚）。
- 正确用法：fan-out 前主动查 `remaining()`，不足则降级（少派 agent / 降 effort / 降模型），不要等它抛错：

```js
if (budget.total !== null && budget.remaining() < threshold) {
  log("预算不足，降级为单 agent 汇总");
  // 走精简分支
}
```

- **未决/留白**（见 `03-decision-log.md` 未确认项 2、6）：`total` 的计量口径（仅输入 or 输入+输出）规范未定义；超限时已完成 agent 结果是否整轮回滚的语义未明确；`workflow()` 子调用 token 是否计入父 budget 未逐条明确。这些不要当成已知结论使用。
- 唯一可靠的成本观测量就是 `budget.spent()/remaining()`；网络博客的"总 token≈单会话 4 倍""规模系数公式"等**已被否决**（无实测、虚假精度，见否决项 2、8），不得引用为结论。

---

## 5. 每个 phase 的"输入 / 输出 / 完成标准"模板

每开一个 `phase()`，都要先回答下面三问；建议在脚本里用注释固化，并在设计文档里成表。

**模板（复制即用）**

```text
phase: <与 meta.phases[].title 逐字一致的标题>
  输入(Input)   : 这一阶段消费什么 —— 上一阶段产物 / args / 由子代理读入的文件
  输出(Output)  : 产出什么 —— 优先是 schema 结构化对象（便于下游免解析）
  完成标准(Done): 怎样算这一阶段做完 —— 可观察、可验收，不是"做得好"这种主观判断
```

**填写示例**

```text
phase: 调研
  输入   : args.topic（字符串），由 Explore 子代理读取 evidence/ 下相关文件
  输出   : { findings: [{ claim, sourceType, confidence }], openQuestions: [] }（schema 校验）
  完成标准: 每条 finding 都带 sourceType 与 confidence；openQuestions 已列全；无未引用断言
```

**填写要点**
- 输出尽量用 `schema`，让校验落在工具层，下游 stage 直接拿对象。
- "完成标准"必须可观察。涉及循环的 phase 还要写明**最大轮次 + 退出条件**（如 loop-until-dry：连续 K 轮无新增即停；这些阈值是"示例缺省值，非 API 约束"）。
- 截断 / 采样（top-N、抽样）必须用 `log()` 显式说明被丢弃的覆盖面，禁止静默截断。
- 实现 agent 与审查 agent **必须不同实例**（实现者不自评）；任何 P0 判 FAIL。

---

## 落地清单（编排时逐项过）

本文是"规范与硬约束"；动手编排时请逐项对照 **`.claude/skills/workflow-designer/references/design-checklist.md`**（A 任务定义 / B 阶段拆分 / C 控制流 / D Subagent 分工 / E 质量门禁 / F 状态恢复 / G 成本规模 / H 验证交付）。两者配合使用：本文回答"规则是什么"，清单回答"我这次有没有逐条做到"。
