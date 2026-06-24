# 04 · Subagent 协作与分工

> 本篇讲"谁来干、怎么分、怎么互不踩脚"。Workflow 脚本 API 形态见 `docs/01`（事实锚点 `evidence/01-workflow-api-ground-truth.md`）；控制流（pipeline/parallel/循环）见 `docs/02`；五构件职责边界见 `docs/03`；反模式见 `docs/07`。本篇只在协作必需处复述，其余交叉引用。

---

## 一、Subagent 的本质

Subagent（子代理）是 Workflow 脚本里用 `agent(prompt, opts?)` 派生出来的**独立执行单元**。它不是"同一个对话里多说几句话"，而是一个隔离的执行实体，具备五个本质特征（`evidence/02` §1 / `03` 采用结论 8，`official-doc`/high）：

1. **独立上下文窗口**：每个子代理有自己的上下文，不继承主脚本或兄弟代理的完整历史。这正是 fan-out 不撑爆上下文的根因——主脚本只持有各代理**返回的摘要**，而非它们读过的所有原始内容。
2. **自定义系统提示**：派生时把角色专长、证据纪律、输出要求写进 `prompt`，等价于给这个实例一份临时"岗位说明书"。
3. **受限工具集**：不同 `agentType` 工具面不同（如 `Explore` 只读、`Plan` 无 Edit/Write）。详见 §二。
4. **独立权限**：子代理在自己的权限边界内行动，主脚本本体**无文件系统 / Node API**，一切 IO（读 evidence、跑脚本、抓网页）必须经子代理（`03` 采用结论 1、跨切原则 4）。
5. **返回压缩摘要**：子代理被告知"你的最终文本就是返回值"，因此它返回**结论/数据**而非中间过程。无 `schema` 返回字符串；有 `schema` 则强制走 StructuredOutput，工具层校验+不匹配自动重试，脚本无需自行 parse（`03` 采用结论 6）。

> 一个直接推论：子代理是"用上下文隔离换取规模"的机制。让 10 个代理各读一个组件、各自只回一段结构化结论，远比让主上下文读 10 个组件更可控。

---

## 二、agentType：内置 vs 自定义

`agent()` 的 `opts.agentType` 决定派生哪一类子代理。它与 Agent 工具同一个注册表解析（`evidence/01` §4）。

### 2.1 内置 agentType（本会话一手确认，`evidence/01` §6）

| agentType | 定位 | 工具面 |
|---|---|---|
| `claude` | 通配，全工具 | 全部 |
| `general-purpose` | 通用多步执行 | 全工具 |
| `Explore` | 只读广搜，读摘要而非整文件 | 只读 |
| `Plan` | 架构方案 | 只读，无 Edit/Write |
| `claude-code-guide` | Claude Code/SDK/API 问答 | Bash/Read/WebFetch/WebSearch |
| `statusline-setup` | 状态栏配置 | 专用 |

省略 `agentType` 即用默认 workflow 子代理。

### 2.2 自定义 agentType 与"可移植性权衡"（核心）

自定义子代理是项目 `.claude/agents/*.md` 文件（YAML frontmatter 定义 `name`/`description`/`tools`/`model`，正文是系统提示）。**关键约束**（`evidence/01` §4 注 / `03` 未决 5）：

> 自定义 `agentType` **只有在 Claude 从该项目目录启动时才进注册表**。若 Workflow 以 `{scriptPath}` 形式从其它目录运行，`.claude/agents/` 不会被加载，引用自定义类型会解析不到。

由此产生一条必须当场决策的权衡：

- **要可移植（任意目录可跑）** → 用**内置 agentType + 把角色专长写进 prompt**。本项目 `CLAUDE.md` 二.5、`evidence/01` §6 注均要求这条做默认。
- **固定从仓库根启动、追求复用** → 可用自定义 agentType，把岗位说明书沉淀成 `.md` 文件，prompt 更短、定义可被多个 workflow 共享。

本项目的 `analyze-repo.js` 选了**可移植**这一侧：文件头注释明确"全部 agentType 使用内置类型(Explore/general-purpose)，可在任意目录运行；角色专长写进 prompt"，脚本里实际派生时清一色 `agentType: 'general-purpose'` / `'Explore'`，没有引用任何自定义类型。

**这正解释了一个容易困惑的现象**：本项目 `.claude/agents/` 下有 7 个 `.md` 定义，但运行态 `analyze-repo.js` 并不通过 `agentType` 引用它们——这些 `.md` 是**角色蓝本/可读规范**（也供从仓库根启动时按需用作自定义类型），运行时把同样的专长以内联 prompt 注入内置代理，从而兼顾"可移植"与"职责清晰"。

最小对照示例（两种写法，均符合 `docs/01` API）：

```js
// 可移植写法：内置类型 + 专长写进 prompt（analyze-repo.js 采用）
const scan = await agent(
  '你是只读代码分析专家，只理解不修改，结论须基于实际读到的内容。\n' +
  '本阶段=结构扫描：列出主要组件、构建/测试命令、入口点。',
  { label: 'scan', phase: 'Scan', agentType: 'Explore', schema: SCAN_SCHEMA }
)

// 复用写法：引用自定义类型（仅当从本项目目录启动才进注册表）
const scan2 = await agent(
  '本阶段=结构扫描：列出主要组件、构建/测试命令、入口点。',
  { label: 'scan', phase: 'Scan', agentType: 'repo-analyst', schema: SCAN_SCHEMA }
)
```

> 注：`agent()` 还可叠加 `model`（覆盖模型）、`effort`、`isolation:'worktree'` 等，按成本分层使用，详见 `docs/05`。

---

## 三、角色分工原则

分工的目标不是"开很多 agent 显得规模大"，而是让每个实例有**独立、可说明的职责**（本项目 `CLAUDE.md` 三.2、`03` 采用结论 12）。

1. **单一职责**：一个子代理只负责一件能独立说清的事（理解 / 扫描 / 分析单个组件 / 风险 / 测试方案 / 审查 / 汇总）。职责越窄，prompt 越聚焦，schema 越好定，返回越干净。
2. **无重复无遗漏**：阶段划分要覆盖完整链路又互不重叠。`workflow-reviewer` 的 12 项必查里第 5 项就是"是否存在职责重复或遗漏"——这是评审硬指标。
3. **按"是否新增独立视角"切分 fan-out，而非按"主题数量"**（`03` 采用结论 14、跨切原则 5）。`evidence/02` §同质性教训记录了真实反面案例：6 路研究中约 5 路高度同质（都在复述同一份 ground-truth，去重后约 1.5 路有效）。这被作为"为展示规模堆 agent"的现实警示写入 `docs/07`。
4. **数量克制**：受并发上限 `min(16, CPU-2)`、总数 1000、单次 ≤4096 item 约束（`docs/05`）；不为展示规模堆 agent，不以运行时长/代码量充当质量。

---

## 四、实现者与审查者必须不同实例

这是本项目最硬的协作纪律之一（`CLAUDE.md` 三.1、`03` 采用结论 12、跨切原则 6）：

> **实现 agent 与审查 agent 必须是不同实例；实现者不得自评自己的结果。任何 P0 直接判 FAIL。**

为什么硬性：自评的实例带着自己的"沉没成本"和盲区，倾向于确认而非证伪。质量靠**独立性**而非数量。落地有两个层级：

- **单 Workflow 内的交叉审查**：`analyze-repo.js` 的 stage6（`Review`）由一个**全新代理实例**承担，prompt 开头即声明"你是独立审查者，未参与前面任何分析工作"，并把前 5 个阶段的产出作为待审材料传入。这个实例不产出分析、只挑完整性/准确性/被忽略风险，给 `PASS/CONDITIONAL_PASS/FAIL`。对应角色蓝本 `independent-reviewer`。
- **整个交付物的最终质量门禁**：由 `workflow-reviewer` 承担，定位是"对整个交付物的最终质量门禁"，区别于 `independent-reviewer`（后者是单次运行内部的交叉审查）。它声明"你没有参与任何方案设计或实现"，必须**真实打开**文件核查、不采信"已验证"自述、任何 P0 直接 FAIL（详见其定义 §判级规则）。

- **写码闭环里的两道独立关**：`deliver-from-plan.js`（桥接，详见 `docs/12`）把这条边界推到极致——Fix 后由**全新实例重新复审**（非修复者自评），且收尾另有一个**独立 `Verify` 实例**亲手复跑 DONE、复算 diff，最终状态以它为准、不只信实现/修复者自报（视角集定义在该运行生成的 `coding-workflow.md` §7.1）。

推荐的更强质量模式（对抗式证伪 / 多视角 lens / 评审团 / loop-until-dry）见 `docs/06`，本篇只强调"独立实例"这条不可破坏的边界。

---

## 五、本项目 agents 清单与职责

以下 7 个角色蓝本位于 `.claude/agents/`（相对仓库根；已逐个 Read 核对）。它们既是可读的岗位规范，也可在从本项目目录启动时作自定义 `agentType`；`analyze-repo.js` 运行态以内联 prompt 复用其专长（见 §2.2）。

| 角色 (.md) | model / tools | 单一职责 | 不做什么 | 用在哪 |
|---|---|---|---|---|
| `repo-analyst` | sonnet / Read·Bash·Grep·Glob | 只读理解仓库/组件：职责、关键逻辑、依赖、风险、代码异味 | 绝不改代码；不发散无关文件 | analyze-repo 扫描/组件分析 |
| `risk-auditor` | sonnet / Read·Bash·Grep·Glob | 工程风险审计（一致性/状态机/幂等并发/权限/异常/边界）；复用 `ai-engineering-delivery-zh` 风险思想 | 不改代码、不写文件 | analyze-repo 风险阶段、高风险评审 |
| `test-planner` | sonnet / Read·Bash·Grep·Glob | 产出可执行、按风险排序的验证方案（用例/命令/覆盖缺口） | 不暗示已验证；不改代码 | analyze-repo 测试方案阶段 |
| `independent-reviewer` | sonnet / Read·Bash·Grep·Glob | 单次运行内部的交叉审查：完整性/准确性/被忽略风险 | 未参与被审分析；不改代码 | analyze-repo 审查阶段 |
| `methodology-researcher` | sonnet / Read·Bash·Grep·Glob·WebFetch·WebSearch | Claude Code 方法论研究，带 sourceType+confidence 的结构化发现 | 不臆测；API 一律以 ground-truth 为准；不写文件 | wf-methodology-research 研究阶段 |
| `doc-writer` | sonnet / Read·Write·Bash·Grep·Glob | 把已核实结论写成低重复的中文文档（只写被指派的一篇） | 不把推测写成结论；引用前先 Read 确认 | 研究后的文档生成阶段 |
| `workflow-reviewer` | opus / Read·Bash·Grep·Glob·WebFetch | 整个交付物的**最终质量门禁**：12 项必查 + 100 分制 + 覆盖矩阵 + P0/P1/P2 + 返工项 | 不参与设计/实现；不改交付物；不放水 | 交付物最终评审 |

职责划分体现了 §三：

- **无重复**：`independent-reviewer`（单次运行内交叉审查）与 `workflow-reviewer`（整个交付物最终门禁）作用域不同、明确互斥；两者均与实现者解耦（§四）。
- **无遗漏**：分析链路覆盖 理解→扫描/组件分析(repo-analyst)→风险(risk-auditor)→测试(test-planner)→审查(independent-reviewer)→汇总，方法论链路覆盖 研究(methodology-researcher)→撰写(doc-writer)→门禁(workflow-reviewer)。
- **工具与模型按职责分层**：只读分析类统一只读工具面；`doc-writer` 才有 `Write`；`workflow-reviewer` 用 opus 且加 `WebFetch` 以核查官方资料。

> 注意（与 §2.2 一致）：上表 7 个 `.md` 仅在从本项目目录启动时进注册表；要任意目录可跑，仍以内置 agentType + prompt 内联专长为准（`analyze-repo.js` 即如此）。

---

## 六、协作纪律速查

- 一切 IO 经子代理，主脚本本体不读写文件（`docs/01` / `03` 跨切原则 4）。
- 子代理优先 `schema` 返回结构化结果，降低解析与上下文负担。
- 实现者绝不自评；审查必须是独立实例；任何 P0 → FAIL。
- fan-out 按"是否新增独立视角"切分，不为规模堆 agent；被丢弃的覆盖面必须 `log()`（不静默截断）。
- 要可移植就用内置 agentType + prompt；自定义 `.md` 只在仓库根启动时进注册表。

## 六、跨脚本同源块（防漂移）

Workflow 脚本体无法 `require` 公共模块，故 `plan-from-requirement.js` / `analyze-repo.js` / `deliver-from-plan.js` 之间存在多处**字节级同源的复制块**（如 `callAgent` 重试包装、`MODE_PRESETS` 档位预设、`runConsistencyChecks` 一致性校验、`EVIDENCE`/`ITEM`/`REVIEW_SCHEMA` 等 schema、persist 落盘 prompt）。源码里以 `// [同源块·勿单边改]` 标注。

**纪律**：改动任一同源块必须同步其它脚本，否则会出现"改一处忘另一处"的行为漂移（已发生过 persist prompt 的真实漂移）。**有意保留的差异**（如 `plan` 的 `ITEM` 故意不含 `verificationStatus`——只读方案无 Verify 阶段）应就近注释说明，避免被误当漂移"修平"。
