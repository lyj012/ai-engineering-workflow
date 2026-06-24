# Claude Code Dynamic Workflow API —— 权威基线（一手）

> 来源：本机 Claude Code `2.1.186` 当前会话所挂载的 `Workflow` 工具官方规范（产品内一手定义）。
> 用途：作为研究 / 文档 / 示例阶段的**事实锚点**。凡涉及 Workflow 脚本 API 的结论，必须与本文件一致；不得凭训练记忆臆测 API 形态。
> 标注：以下均为产品内当前行为；若与网络旧文档冲突，以本文件（产品内规范）为准。

## 1. 脚本性质与入口

- Workflow 脚本是**纯 JavaScript**（非 TypeScript）。类型注解 / interface / 泛型会解析失败。
- 必须以 `export const meta = { ... }` 开头，且 `meta` 必须是**纯字面量**（不能有变量、函数调用、展开运算、模板插值）。
  - 必填：`name`、`description`。可选：`whenToUse`、`phases`（数组，每项 `{title, detail?, model?}`）、`model`。
  - `meta.phases[].title` 要与脚本里 `phase('...')` 调用的标题**逐字一致**。
- 脚本体在 async 上下文中运行，可直接 `await`。
- 标准 JS 内置可用（JSON/Math/Array…），**但** `Date.now()` / `Math.random()` / 无参 `new Date()` 会抛错（会破坏断点恢复）。需要时间戳就从 `args` 传入或在 workflow 返回后再打戳；需要随机性就用 index 变化 prompt/label。
- 无文件系统 / Node API 访问（脚本本体）；但**子代理**有自己的工具（含 Read/Write/Bash/WebFetch 等）。

## 2. 脚本体可用的编排原语

- `agent(prompt, opts?) -> Promise<any>`：派生一个子代理。
  - 无 `schema` 时返回其最终文本（string）。
  - 有 `schema`（JSON Schema）时，强制子代理调用 StructuredOutput 工具，返回**已校验对象**（无需自行解析；不匹配会自动重试）。
  - 若用户中途跳过该 agent，或终态 API 错误重试后死亡，返回 `null`（用 `.filter(Boolean)` 过滤）。
  - `opts`：`label`（显示名）、`phase`（显式归入某进度组，避免在 pipeline/parallel 内竞争全局 phase 状态）、`schema`、`model`（覆盖模型）、`effort`（'low'|'medium'|'high'|'xhigh'|'max'）、`isolation:'worktree'`（独立 git worktree，成本高，仅当并行改文件会冲突时用）、`agentType`（用自定义/内置子代理类型，如 'Explore'、'general-purpose'、'claude-code-guide'）。
- `pipeline(items, stage1, stage2, ...) -> Promise<any[]>`：每个 item 独立穿过所有 stage，**stage 间无栅栏**（item A 可在 stage3，item B 还在 stage1）。这是多阶段工作的**默认**选择。墙钟 = 最慢单条链，而非各 stage 最慢之和。stage 回调签名 `(prevResult, originalItem, index)`。stage 抛错则该 item 落 `null` 并跳过其余 stage。
- `parallel(thunks) -> Promise<any[]>`：并发执行一组 `() => Promise`，**是栅栏**（等全部完成）。thunk 抛错→该位 `null`（调用本身不 reject），用 `.filter(Boolean)`。仅当确实需要"全部结果一起"才用。
- `log(message)`：向用户输出一行进度（叙述行）。
- `phase(title)`：开启新阶段，后续 `agent()` 归入该组。
- `args`：Workflow 调用时传入的 `args` 原值（未传则 `undefined`）。传数组/对象要传真正的 JSON 值，不要传 JSON 字符串。
- `budget`：`{ total: number|null, spent(): number, remaining(): number }`。`total` 为本轮 Token 目标（无则 null → remaining 为 Infinity）。是**硬上限**：`spent()` 达到 `total` 后再调 `agent()` 会抛错。
- `workflow(nameOrRef, args?) -> Promise<any>`：内联运行另一个 workflow（按名或 `{scriptPath}`）。共享并发上限/计数/中断/预算。**仅一层**嵌套（子里再调 workflow 会抛错）。

## 3. 并发、上限与默认偏好

- 单 workflow 内并发 `agent()` 上限 = `min(16, CPU核数-2)`，超出排队。
- 全生命周期 agent 总数上限 = **1000**（防失控兜底，远超真实需求）。
- 单次 `parallel()/pipeline()` 最多 **4096** 个 item（超出报错，非静默截断）。
- **默认用 `pipeline()`**；只有当 stage N 真的需要 stage N-1 的**全量跨 item 结果**（去重/合并/全集早退/相互比较）时才用 `parallel()` 栅栏。
- 中间的纯 transform（flatten/map/filter，无跨 item 依赖）应放进 pipeline 的某个 stage，而不是用栅栏断开。

## 4. 运行、后台与断点恢复

- `Workflow` 工具调用**立即返回 runId 并在后台运行**；完成时通过 `<task-notification>` 通知。`/workflows` 可看实时进度。
- 每次调用都会把脚本持久化到会话目录并在结果中返回路径；迭代时编辑该文件再以 `{scriptPath}` 重跑。
- 断点恢复：`Workflow({scriptPath, resumeFromRunId})`，未改动的最长 `agent()` 前缀瞬时返回缓存结果，从首个改动/新增调用起实跑。同脚本同 args → 100% 命中。需先停掉前一次运行。
- 命名 workflow 放 `.claude/workflows/`（与 `{name:"..."}` 同一注册表）。`agentType` 自定义子代理从与 Agent 工具相同的注册表解析（项目 `.claude/agents/`）。

## 5. 子代理事实与质量模式（官方规范要点）

- 子代理被告知"你的最终文本就是返回值"，因此返回原始数据；结构化输出用 `schema`，校验在工具层完成（不匹配自动重试）。
- 推荐质量模式：对抗式验证（多个独立 skeptic 各自尝试**证伪**，多数证伪则否决）、多视角验证（每个验证者一个不同 lens）、评审团（N 个独立方案 + 并行打分 + 综合）、loop-until-dry（连续 K 轮无新增才停）、多模态扫描、完备性批评者、不静默截断（被丢弃的覆盖面要 `log()`）。
- 反模式：不必要的栅栏、为展示规模堆 agent、让实现者自评、静默截断 top-N/采样、简单计数器漏掉长尾。

## 6. 本会话可用的内置 agentType（一手）

`claude`（通配，全工具）、`claude-code-guide`（Claude Code/SDK/API 问答；工具 Bash/Read/WebFetch/WebSearch）、`Explore`（只读广搜，读摘要而非整文件）、`general-purpose`（通用多步，全工具）、`Plan`（架构方案，只读+无 Edit/Write）、`statusline-setup`。

> 注意：自定义 `agentType`（项目 `.claude/agents/*.md`）只有在 Claude 从该项目目录启动时才进注册表。若 workflow 需在任意目录可跑，应使用上述**内置** agentType 或省略 `agentType`（用默认 workflow 子代理），把角色专长写进 prompt。
