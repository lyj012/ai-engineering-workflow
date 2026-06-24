# 09 复用现有 ai-engineering-delivery-zh Skill

> 本文讲：把已经存在的 `ai-engineering-delivery-zh` 这套"业务交付方法论"接入 Workflow 体系，
> 哪些**借鉴思想**、哪些**留在原处**、哪些**搬到别的构件**，以及为什么**只能一层嵌套**、不能把 8 阶段做成父串多子的 workflow。
> 硬约束：**只读复用，绝不修改原 skill**（见 `workflow/CLAUDE.md` 第一条边界、`evidence/00-environment-scan.md`）。
> Workflow API 一律以 `evidence/01-workflow-api-ground-truth.md` 为准；本文 API 结论与其一致。

---

## 1. 现有 skill 结构与 8 阶段回顾

`ai-engineering-delivery-zh` 是一个**按需加载的方法论 Skill**——会话启动只见描述，被调用才载全文。其真实结构（一手证据见 `evidence/00-environment-scan.md`，本文撰写前已逐文件 Read 核实）：

```
SKILL.md                                 # 编排 8 阶段主干 + 任务三级分级 + "何时该问"唯一规则 + 规则优先级链
scripts/presubmit-scan.sh / .ps1         # 提交前只读扫描：改动文件/密钥(两级)/调试日志/SQL 风险/冲突标记/规则文件
references/requirement-analysis.md       # 阶段 1–4：业务理解 / 系统扫描 / 各流梳理 / 验收标准
references/delivery-checklist.md         # 阶段 5–6：实现规则 + 验证 + 提交前准备
references/risk-review.md                 # 阶段 7：一致性 / 状态机 / 幂等并发 / 回滚 / 发布就绪
references/retrospective-template.md      # 阶段 8：复盘沉淀模板
references/worked-example.md              # 全主干在一个小功能上的跑通示例
```

**8 阶段交付主干**（SKILL.md 原文逐字提炼）：

1. 理解业务与范围（目标 / 角色 / 正常流 / 异常流 / 核心结果 / Non-goals / 歧义 / 待确认）
2. 扫描现有系统（固定输出形状：已确认事实 / 合理推断 / 待确认问题 / 当前约束 / 影响范围）
3. 梳理各流（业务流 · 数据流 · 持久化/状态 · UI 面 · 接口设计）
4. 编码前定义验收标准（前置 / 操作 / 接口结果 / DB 变化 / 页面 / 日志 / 权限 / 异常）
5. 先规划再最小范围实现（复用优先、只动相关文件、不顺手重构）
6. 验证（跑能跑的最强检查；没跑的明确说明"未验证"及原因）
7. 风险审查（一致性 / 状态机 / 幂等并发 / 回滚，高风险域人工复核）
8. 总结与沉淀（技术笔记 / PR 摘要 / 知识库条目）

这套 skill 还内含四个**值得借鉴的设计思想**（下文第 4、6 节会区分"借鉴"与"不照搬"）：
任务三级分级（简单/中等/复杂）；references 按阶段**按需加载**而非一次全读；"何时该问 vs 直接做"只定义一次、其余文件引用（单一事实源 DRY）；规则优先级链（安全约束 > 用户本轮请求 > 个人硬约束 > 项目规则 > 仓库规则 > Skill > 偏好 > AI 假设）。

---

## 2. 8 阶段 → 4 phase 映射表

Workflow 的 `phase()` 是给人看的进度分组，不必和 skill 的 8 阶段一一对应。把语义相近、又能在同一波 fan-out 内完成的阶段**合并成 4 个 phase**，既保留方法论的覆盖面，又契合 Workflow"默认 pipeline、按需起 agent"的形态（折叠决策见 `evidence/03-decision-log.md` 采用结论第 11 条）。

| Workflow phase | 折叠自 skill 阶段 | 主要动作 | 承载 reference | 典型构件 |
|---|---|---|---|---|
| **分析与扫描** | 1·2·3·4 | 业务理解、系统扫描、各流梳理、定验收标准 | `requirement-analysis.md` | Explore / general-purpose 子代理（只读广搜，结构化回报） |
| **实现与验证** | 5·6 | 最小范围实现、跑最强检查 | `delivery-checklist.md` | 实现子代理 + 独立验证子代理（实现者不自评） |
| **风险审查** | 7 | 一致性 / 状态机 / 幂等并发 / 回滚 / 发布就绪 | `risk-review.md` | 独立 reviewer 子代理（对抗式证伪，P0 即 FAIL） |
| **复盘沉淀** | 8 | 交付摘要、技术笔记、PR/提交摘要 | `retrospective-template.md` | 汇总子代理写 evidence（脚本体不直接写文件） |

注意：

- `meta.phases[].title` 必须与脚本里 `phase('...')` 调用**逐字一致**（`evidence/01` 第 1 节）。规范只要求"逐字一致"，**未明示不一致的后果**——本文不臆测为"解析失败/进度混乱"（`evidence/03` 采用结论第 2 条）。
- 阶段 1–4 折叠进同一个分析 phase，是因为它们都是**只读、可并行扇出、彼此无栅栏依赖**的扫描类工作，天然适合 `pipeline()`。
- 阶段 5（实现）与阶段 6（验证）必须是**不同的 agent 实例**：实现者不能自评（`workflow/CLAUDE.md` 质量纪律第 1 条）。
- 折叠后**对外是否仍按 8 阶段逐项打分**，规范未定，属未决事项（`evidence/03` 未确认第 7 条），需与负责人确认评估口径。

> Workflow 控制流原语与 phase 用法详见 docs/02、docs/03；本表只讲映射关系，不重复 API 细节。

---

## 3. 角色归位：哪个东西放进哪个构件

Workflow 体系有五类构件，职责边界互不重叠（`evidence/03` 采用结论第 8 条）。把现有 skill 的各部分**归位**到最合适的构件，是复用的核心动作。

| skill 里的东西 | 归位到 | 理由 |
|---|---|---|
| 8 阶段主干、references、任务分级、"何时该问"、规则优先级链 | **留在 Skill**（按需加载的方法清单） | 这是顾问性方法库，本就该按需加载、不进任何强制层；保持原样、零修改 |
| 阶段 2 大型代码库扫描 | **Subagent**（Explore / general-purpose） | 独立上下文 + 只读广搜，回报结构化结果，避免主上下文膨胀 |
| 阶段 5/6/7 的实现、验证、审查 | **Subagent**（各自独立实例） | 专业执行 + 独立上下文；实现者与审查者必须不同实例 |
| `presubmit-scan.sh` 的**调用** | **Subagent**（带 Bash） | 脚本体无文件系统/Node 访问，不能直接跑脚本；只能由带 Bash 的子代理调用并回报（`evidence/03` 采用第 10 条） |
| `presubmit-scan.sh` 想做成**强制门禁** | **PreToolUse Hook**（harness 执行，exit 2 阻断） | CLAUDE.md/Skill 是顾问性上下文、非强制；红线要无条件生效必须靠 Hook 或 `permissions.deny`（`evidence/03` 采用第 9 条） |
| "只复用不改 skill / 文件落 workflow 子树 / UTF-8" 等固定约束 | **CLAUDE.md** | 每次启动都生效、不随对话变化的项目固定约束（见 `workflow/CLAUDE.md`） |

关于 presubmit-scan 落 Hook 的两个**前置条件**（不可照抄）：

1. 该脚本是**只读**扫描，"NEVER modifies, stages, or commits anything"（脚本头注释原文），高置信度密钥 → 退出码 2，其余（字段名/调试日志/SQL/TODO）仅警告。把它当门禁是合理的，但
2. **配置前必须先读项目实际的 `.claude/settings.json`**：判断是新增 Hook 还是合入现有 Hook、matcher 对 `git commit` 各种调用形式的覆盖等。本项目根 `.claude/settings.json` 现状未读（`evidence/03` 未确认第 4 条），故本文不给可照抄的 Hook 配置；落地时按实际 settings 定。

> Hook 强制层与 CLAUDE.md 上下文层的差别、子代理 schema 用法详见 docs/04、docs/05；本节只讲"哪个东西去哪"。

---

## 4. 借鉴思想 vs 不照搬业务 8 阶段——明确边界

复用这套 skill 的正确姿势是**借鉴它的设计思想**，而不是把业务化的 8 阶段当成 Workflow 的固定模板照搬（`evidence/02` 第 6 路、`evidence/03` 采用第 11 条）。

**借鉴（搬思想）：**

- **按需加载** → Workflow 走到某 phase 才让子代理 Read 对应 reference，对应 Token/上下文控制。
- **单一事实源（DRY）** → "何时该问"只定义一次、其余引用；Workflow 体系里同理：API 事实只认 `evidence/01`，规则只认 CLAUDE.md，不在多处复制。
- **任务分级** → 小任务更轻、风险任务更严；Workflow 可据此决定起几个 agent、是否开 reviewer，而非一刀切重流程。
- **规则优先级链** → 直接沿用作为冲突裁决顺序。
- **实现者不自评 / 验证要有证据** → 对应 Workflow 的"独立 reviewer + 对抗式证伪"质量模式。

**不照搬（不当模板）：**

- 8 阶段是**业务交付**专用流程（支付/会员/权限/状态机等），不是通用 Workflow 骨架。研究/文档/数据处理类 Workflow 不该被强行套进这 8 步。
- 不把 references 里的业务术语（controller/service/mapper、订单/会员/下载配额）当作每个 Workflow 必有的检查项——skill 自己也说"把术语映射到项目真正用的东西，纯前端/库/非分层架构就保留意图、丢掉不适用术语"。
- 不为了"看起来走完 8 阶段"而堆 8 波 agent——那正是"为展示规模堆 agent"的反模式（详见 docs/07）。phase 数量服从任务实际，4 phase 是折叠结果而非硬性要求。

一句话边界：**搬"按需加载 / 单一事实源 / 分级 / 不自评 / 优先级链"这些可迁移的工程纪律；不搬"必须依次走完业务化 8 步"这个具体流程外壳。**

---

## 5. 为什么不能做成父 workflow 串多个子 workflow

一个直觉的（错误的）设计是：把 8 阶段拆成 8 个独立子 workflow，再写一个父 workflow 依次 `workflow(...)` 串起来。**这行不通**，原因是 API 硬约束：

> `workflow(nameOrRef, args?)` 内联运行另一个 workflow，共享并发上限/计数/中断/预算，**但仅一层嵌套——子 workflow 里再调 `workflow()` 会抛错**。（`evidence/01` 第 2 节、`evidence/03` 采用第 11 条 / 否决第 6 条）

因此：

- **不能**做"父 workflow → 阶段子 workflow → 阶段内再调子 workflow"这种多层串联。父里可以调一层子 workflow，但子里不能再往下调，链路会在第二层断掉并报错。
- **正确做法**：把折叠后的 4 phase 放进**同一个 workflow** 内，用 `phase()` 分组、用 `pipeline()`/`parallel()` 编排子代理。阶段间的串行/并行靠脚本控制流表达，而不是靠嵌套 workflow。
- 真正需要复用某个独立 workflow（比如已有一个通用"研究 workflow"）时，**只用一层** `workflow()` 内联调用即可，且要清楚它共享父的并发计数与预算（`budget` 子调用是否计入父预算锚点未逐条明确，列为开放问题，见 `evidence/03` 未确认第 6 条）。

> 嵌套限制与 `budget`/并发上限的完整说明详见 docs/03、docs/06；本节只解释"为什么 8 阶段必须折进单 workflow"。

---

## 6. 复用落地清单

按下面顺序落地，全程**只读复用、不改原 skill**：

1. **确认零修改边界**：复用对象是 `../liu/ai-engineering-delivery-zh`（软链接见 `.claude/skills/`，真实路径见 `evidence/00`）。所有新增文件落在 `workflow/` 子树内，不碰原 skill 任何文件（`workflow/CLAUDE.md` 边界第 1、2 条）。
2. **把 8 阶段折成 4 phase**：按第 2 节映射表，在**单个** workflow 的 `meta.phases` 里声明 4 个 phase，`title` 与脚本 `phase()` 调用逐字一致。
3. **角色归位**：扫描/实现/验证/审查/复盘各派**独立** Subagent（实现者≠验证者≠审查者）；用内置 agentType（Explore/general-purpose）或省略并把角色专长写进 prompt，保证 Workflow 任意目录可跑（`workflow/CLAUDE.md` 脚本硬约束第 5 条）。
4. **references 按需加载**：每个 phase 让子代理只 Read 它需要的那一个 reference（分析→requirement-analysis、实现验证→delivery-checklist、风险→risk-review、复盘→retrospective-template），不一次全读。
5. **presubmit-scan 两段式接入**：日常由带 Bash 的子代理调用脚本回报结果；若要做成不可绕过的提交前门禁，**先读项目实际 `.claude/settings.json`**，再决定如何配 PreToolUse Hook（本文不提供可照抄配置，原因见第 3 节）。
6. **质量与成本纪律**：独立 reviewer + 对抗式证伪，任何 P0 判 FAIL；循环设最大轮次与可观测退出；fan-out 前设 `budget`、按"是否新增独立视角"分配 agent，而非按主题数量堆 agent（`evidence/03` 采用第 12–14 条）。
7. **证据外部化**：脚本体不直接读写文件，中间产物与运行记录由子代理写入 `evidence/`，保证可追踪、可从零复用（`workflow/CLAUDE.md` 证据与可复用条款）。

---

## 7. 一句话总结

把 `ai-engineering-delivery-zh` 当成**只读的方法论库**：思想（按需加载 / 单一事实源 / 分级 / 不自评 / 优先级链）借鉴进 Workflow 体系，8 个业务阶段**折叠成 4 个 phase 放进单个 workflow**（因为 `workflow()` 仅一层嵌套，不能父串多子），扫描/实现/验证/审查/复盘归位为独立 Subagent，确定性提交门禁交给 PreToolUse Hook（配置须先读项目实际 settings），固定约束写进 CLAUDE.md——**全程不修改原 skill 的任何一个字节**。
