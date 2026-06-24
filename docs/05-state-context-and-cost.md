# 05 状态、上下文与成本控制

> 本文聚焦 Workflow 在"长任务、多子代理"场景下的三件事：**状态怎么存、上下文怎么不膨胀、成本怎么压住**。
> 所有 API 结论以 `evidence/01-workflow-api-ground-truth.md`（产品内一手规范）为准；编排原语、五构件职责边界详见 docs/01、docs/02，质量模式详见 docs/04，反模式案例详见 docs/07。
> 标注规则：复述一手规范的结论标 high；研究者的综合/数量建议标 inference 且为 medium；网络来源或未在本机核验的精确数字一律标注"未经本机验证"。

---

## 一、状态保存

Workflow 脚本体本身是**隔离的纯 JS 编排层，没有文件系统 / Node API 访问**（一手规范，high）。因此"保存状态"不是脚本直接写盘，而是三条互补的路径。

### 1.1 中间结果落 `evidence/`（经子代理，不在脚本体内 IO）

关键纪律：**脚本体不能直接读写文件**。脚本里写 `await Read('evidence/..')` / 写盘都会与"脚本体无文件系统访问"冲突——这是 docs/07 记录的一条被否决做法。落盘必须由**带工具的子代理**完成（子代理有自己的 Read/Write/Bash）。

- 写：把"整理某产物并写入 `evidence/NN-xxx.md`"作为子代理的任务，由它调用 Write 落盘。
- 读：需要回读既有证据时，派 `Explore`（只读广搜，读摘要而非整文件）或 `general-purpose` 子代理去读并回报摘要，而不是把整文件塞回脚本上下文。

本项目自身就是范例：环境扫描、研究、决策、运行报告、评审、返工、遗留风险都留存在 `evidence/`（见本项目 `CLAUDE.md` 第四条与 `evidence/` 目录现有文件 `00-environment-scan.md`、`01-workflow-api-ground-truth.md`、`02-research-findings.md`、`03-decision-log.md`、`research-raw.json`）。

### 1.2 结构化输出：让状态天然可校验、可传递

子代理带 `schema`（JSON Schema）时，会被强制调用 StructuredOutput 工具，返回**已校验对象**；不匹配会在工具层自动重试，脚本**不需要自己 parse**（一手规范，high）。

- 这把"解析与校验"从脚本上下文挪到了工具层，落进 `evidence/` 的中间结果天然是规整对象（如 `research-raw.json` 的逐条 finding：`sourceType` / `confidence` / `evidence`）。
- 没有 schema 时子代理返回最终文本（string）；用户跳过该 agent、或终态 API 错误重试后死亡，返回 `null`。
- `null` 处理边界（这是 docs/01 强调的一条 P0）：`.filter(Boolean)` **只能**作用于 `pipeline()/parallel()` 整体返回的**结果数组**；stage 内部只拿到单个标量 `prevResult`，对它调 filter 会报错，应 `if (!prev) return null` 短路。

### 1.3 可追踪记录

- 每个发现 / 结论标注 `sourceType ∈ {official-doc, product-spec, live-env, inference}` 与 `confidence ∈ {high, medium, low}`，可溯源、可复核（见 `02-research-findings.md`、`03-decision-log.md`）。
- 决策台账分"采用 / 否决 / 未决"，把"为什么这么定、否决了什么、还有什么没确认"留痕（`03-decision-log.md`）。
- 进度用 `log()` 向用户输出叙述行；**被丢弃 / 截断的覆盖面必须 `log()`**，不静默截断（一手规范的反模式，high）。

---

## 二、上下文管理（防上下文膨胀）

核心机制是**多层隔离**，让大块信息待在它该待的地方，不回灌主上下文。

### 2.1 子代理隔离

Subagent = 独立上下文窗口 + 自定义系统提示 + 受限工具 + 独立权限；**完成后返回压缩摘要而非堆中间结果**（official-doc，high）。

- 主编排上下文只看到子代理的返回值（文本或 schema 校验后的对象），看不到它内部翻过的几十个文件 / 网页。
- 只读广搜用 `Explore`（读摘要而非整文件），方案规划用 `Plan`（只读、无 Edit/Write），通用多步用 `general-purpose`——按职责选 agentType（内置清单见 docs/01），把大体量阅读关在子代理里。

### 2.2 schema 把负担下沉到工具层

承接 1.2：有 schema 时校验在工具层完成，脚本上下文里只留**规整、最小**的结果对象，而不是长文本 + 解析逻辑。这同时降低了解析负担和上下文占用（product-spec，high）。

### 2.3 Skill 按需加载

Skill 是**按需加载的知识库**：会话启动时只见其描述，**调用时才载入全文**（official-doc，high）。

- 把方法 / 清单 / 规范沉到 Skill，平时不占上下文，需要时才展开；编排逻辑进 Workflow，固定约束进 CLAUDE.md，确定性门禁进 Hook——四类职责不混淆（详见 docs/02）。
- 同理，`agent()` 的 prompt 应只带该子任务必需的信息，让子代理自己去 Read/Explore 取细节，而不是把全部背景预先拼进 prompt。

> 一句话：**隔离（子代理）+ 下沉（schema 进工具层）+ 按需（Skill / Explore 取细节）+ 外部化（中间结果落 `evidence/`）= 主上下文长期保持轻量。**

---

## 三、断点恢复（低成本只重跑改动阶段）

一手规范（high）：

- 每次 `Workflow` 调用都会把脚本**持久化到会话目录**，并在结果中返回 `scriptPath`；迭代时编辑该文件，再以 `{scriptPath}` 重跑。
- 恢复用 `Workflow({ scriptPath, resumeFromRunId })`：**未改动的最长 `agent()` 前缀瞬时返回缓存结果**，从首个改动 / 新增的调用起才实跑。
- **同脚本 + 同 args → 100% 命中**前缀缓存。
- 需先**停掉前一次运行**再恢复。

实践含义：

- 一条长链跑到后段失败 / 不满意，只改后段，前段命中缓存零成本复用，**只为改动阶段付费**（采用结论 7，product-spec，high）。
- 为最大化命中率，前段调用要稳定：这正是脚本体禁用 `Date.now()` / `Math.random()` / 无参 `new Date()` 的原因——它们会让"同脚本同 args"产生不同输入而**破坏缓存命中 / 断点恢复**（一手规范，high）。需要时间戳从 `args` 传入或 workflow 返回后再打戳；需要随机性用 index 变化 prompt / label。

> 未决留白：resume 对 `worktree` 缓存的恢复语义、`workflow()` 子调用 token 是否计入父 budget，一手锚点未逐条明确，列为开放问题（见 `03-decision-log.md` 三）。

---

## 四、成本控制

### 4.1 `budget` 是硬上限（一手规范，high）

`budget = { total: number|null, spent(): number, remaining(): number }`：

- `total` 是本轮 Token 目标；无则 `null` → `remaining()` 为 `Infinity`。
- 是**硬上限**：`spent()` 达到 `total` 后再调 `agent()` 会**抛错**——超额在**下一次** `agent()` 调用时触发，不是整轮回滚。
- 因此应在 fan-out 前主动查 `remaining()`，不足时主动降级（减少 item / 降 effort / 降模型），而不是撞上限抛错。

> **成本唯一可靠的观测量就是 `budget.spent()` / `budget.remaining()`**（采用结论 14）。其余都是估算。
> 留白：`budget.total` 的计量口径（仅输入，还是输入+输出）规范未定义；超限时已完成 agent 结果是否整轮回滚，语义未定（`03-decision-log.md` 三 2）。

### 4.2 ⚠️ 被否决的"伪精度"成本模型（必须明确写出）

以下两条来自研究阶段，已在分歧修正中**被否决**，不得作为结论或可执行规则呈现：

1. **"Workflow 总 token ≈ 单会话约 4 倍"** —— 仅来自单一社区博客、**非实测**，一手锚点无此数据。属未经本机验证的数字，**不采用**（否决 2 / 否决 8）。
2. **自创"规模系数"公式做成本预测** —— 系数未定义、缺乏实测，是**虚假精度**，**不采用**（否决 8）。

正确姿态：不追求"精确预测总量"，而是用 4.1 的可观测量做硬约束 + 用 4.3 的小样本外推做粗估。

### 4.3 先小样本试跑再外推

- 大 fan-out 前，先用**很小的样本**（如几个 item）实跑，读 `budget.spent()`，**线性外推到全量并留余量**（inference，medium）。
- 这是工程上"先最小闭环、再逐步扩展"的体现：拿到真实可观测数据，而非套公式臆测。

### 4.4 effort 与 model 分层

- `agent()` 支持 `effort`（`'low' | 'medium' | 'high' | 'xhigh' | 'max'`）与 `model`（覆盖模型）逐调用覆盖（一手规范，high）。
- 按子任务难度分层：广搜 / 抽取 / 简单整理用低 effort + 轻模型；方案设计 / 对抗式证伪 / 综合判断用高 effort + 强模型。把预算花在真正需要推理深度的环节。

### 4.5 并发上限与容量边界（一手规范，high）

- 单 workflow 内并发 `agent()` 上限 = `min(16, CPU核数 - 2)`，超出**排队**（不报错）。
- 全生命周期 agent 总数上限 = **1000**（防失控兜底）。
- 单次 `parallel()` / `pipeline()` 最多 **4096** 个 item，超出**报错**（非静默截断）。
- 默认用 `pipeline()`（墙钟 = 最慢单条链，stage 间无栅栏），少用 `parallel()` 栅栏——这也省时间成本（控制流详见 docs/03）。

### 4.6 worktree 默认不用

- `agent()` 的 `isolation: 'worktree'`（独立 git worktree）**成本高**，仅当并行子代理会改同一批文件、确有冲突风险时才用；**默认不用**（一手规范 + 采用结论 14，high / inference）。

### 4.7 不为展示规模堆 agent

- agent 数量按"**是否新增独立视角**"分配，而非按"主题数量"或为展示规模而堆（采用结论 14 / 跨切原则 5）。
- 真实教训：本项目研究阶段 6 路里约 5 路高度同质（多在复述同一份 ground-truth，去重后约 1.5 路有效信息），是"为展示规模堆 agent"的现实案例——详见 docs/07。

---

## 五、最小可照抄示例（符合一手 API）

下面示例演示：schema 结构化输出 + `null` 短路 + 进度 `log()` + 预算感知降级。仅作 API 用法示意，不含任何 `Date.now()` / `Math.random()`，IO 全部交给子代理。

```js
export const meta = {
  name: "evidence-pipeline-demo",
  description: "演示状态外部化、结构化输出与预算感知降级",
  phases: [
    { title: "Extract" },
    { title: "Persist" }
  ]
};

const schema = {
  type: "object",
  properties: {
    sourceType: { type: "string" },
    confidence: { type: "string" },
    summary: { type: "string" }
  },
  required: ["sourceType", "confidence", "summary"]
};

phase("Extract");
log("budget remaining at start: " + budget.remaining());

const items = args && args.items ? args.items : [];

const findings = await pipeline(
  items,
  async (prev, item, index) => {
    // 预算感知：不足则降级到 low effort（仍是粗略策略，真值看 budget）
    const lowOnBudget = budget.remaining() < 50000;
    return await agent(
      "抽取该来源的关键发现并标注 sourceType / confidence：" + JSON.stringify(item),
      {
        label: "extract-" + index,
        schema,
        effort: lowOnBudget ? "low" : "medium"
      }
    );
  }
);

// .filter(Boolean) 只用于 pipeline/parallel 整体返回的结果数组
const ok = findings.filter(Boolean);
log("kept " + ok.length + " / " + findings.length + " findings (dropped logged for traceability)");

phase("Persist");
// 脚本体不能写盘：落 evidence/ 交给带 Write 的子代理
await agent(
  "把以下已校验发现整理为 Markdown 并写入 evidence/findings.md：" + JSON.stringify(ok),
  { label: "persist", agentType: "general-purpose" }
);

log("budget spent total: " + budget.spent());
```

要点对照：`meta` 纯字面量、`phases[].title` 与 `phase()` 逐字一致、无禁用全局 API、`schema` 下沉解析、`.filter(Boolean)` 只用于整体数组、写盘经子代理、用 `budget.remaining()/spent()` 做唯一可靠的成本观测。
