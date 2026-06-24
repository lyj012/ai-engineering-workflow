# 决策记录（研究 → 交叉审查 → 分歧修正）

> 来源：`wf-methodology-research` Workflow（11 个 agent：1 任务定义 + 6 并行研究 + 3 独立交叉审查 + 1 分歧修正）。
> 完整原始结果见 `evidence/research-raw.json`。本文件是分歧修正后的**最终结论台账**：采用什么、否决什么、为什么、还有什么没确认。

## 评审过程概述
- **研究**：6 路并行（概念辨析 / 控制流技巧 / 状态与上下文 / 质量保障 / 成本控制 / Skill 转化），每条发现标注 sourceType + confidence。
- **交叉审查**：3 个独立审查者（实现者不自评），视角分别为「完整性与证据」「可执行性与过度设计」「成本与质量」，对全部 6 路研究做跨流审查。
- **分歧修正**：1 个 agent 汇总，产出 14 条采用结论、9 条否决、8 条未决、8 条跨切原则。

> **一条诚实的元教训**：分歧修正明确指出——本次 6 路研究中约 5 路高度同质（多在复述同一份 ground-truth，去重后约 1.5 路有效信息）。这正是"为展示规模堆 agent"反模式的现实警示，已写入 `docs/07-antipatterns.md`。改进做法：研究类 fan-out 应按"是否新增独立视角"而非"主题数量"切分。

## 一、采用的结论（14 条，已据 ground-truth 校正）
1. **脚本硬约束**：纯 JS；`meta` 纯字面量；`meta.phases[].title` 与 `phase()` 逐字一致；禁用 `Date.now()/Math.random()/无参 new Date()`；脚本体无文件系统/Node API，读写文件只能经子代理。
2. **phase title 不一致的后果留白**：规范只要求"逐字一致"，未明示后果——不得断言为"解析失败"或"进度混乱"（属推测且互相矛盾）。
3. **pipeline 默认 / parallel 栅栏**：选择依据是"是否需要全量跨 item 结果"，**与谁更快无关**；纯 transform 内联进 stage，不要用栅栏断开。
4. **null 与 `.filter(Boolean)` 的正确用法**（修正一条 P0 错误）：`.filter(Boolean)` 只能作用于 `pipeline()/parallel()` 整体返回的**结果数组**；stage 内部只收到单个标量 `prevResult`，对其调用 filter 会报错，应 `if(!prev) return null` 短路。
5. **并发/容量/预算硬上限**：并发 `min(16, CPU-2)`；总数 1000；单次 ≤4096 item；`budget` 是硬上限，超额在**下一次** `agent()` 调用时抛错（非整轮回滚），应主动查 `remaining()` 降级。
6. **schema 结构化输出**：传 schema → 强制 StructuredOutput，工具层校验+自动重试，脚本不自行 parse。
7. **断点恢复**：`{scriptPath, resumeFromRunId}`，未改动 `agent()` 前缀瞬时命中缓存；可低成本只重跑改动阶段及之后。
8. **五构件职责边界**：Skill=按需加载的方法/清单；Subagent=独立上下文专业执行者；Workflow=纯 JS 编排；Hooks=harness 确定性拦截（强制层）；CLAUDE.md=项目固定约束（上下文层）。
9. **CLAUDE.md/Skill 是顾问性上下文、非强制**：红线要无条件生效必须用 PreToolUse Hook（exit 2）或 `permissions.deny`。
10. **presubmit-scan.sh 归属**：脚本本体不能直接跑它（无文件系统访问），只能由带 Bash 的子代理调用回报；真正的提交前强制门禁应落到 PreToolUse Hook，但**具体配置须先读项目实际 settings.json**，不能照抄。
11. **8 阶段 → 4 phase 折叠**：把交付 Skill 的 8 阶段折叠为 4 个 phase 在**单个** workflow 内实现（因 `workflow()` 仅一层嵌套，不能父串多子）。
12. **质量模式 + 实现者不自评**：对抗式证伪 + 多视角 + loop-until-dry；实现 agent 与审查 agent 必须不同实例；任何 P0 判 FAIL；被丢弃覆盖面必须 `log()`。
13. **循环退出用固定可观测缺省值**：如最大 3 轮、某轮新增=0 即停、≥2/3 skeptic 标 FAIL 则否决，并标注这些是"示例缺省值，非 API 约束"；删除"重复率<10%"等不可测指标。
14. **成本控制以一手可观测量为准**：唯一可靠观测是 `budget.spent()/remaining()`；小样本试跑→线性外推留余量；agent 数按"是否新增独立视角"分配；effort/模型分层，worktree 默认不用。

## 二、被否决的方案（9 条，含原因）
1. 在每个 pipeline stage 内 `.filter(Boolean)`（Stream2）——**P0**，与 stage 标量签名冲突会报错。
2. "Workflow 总 token≈单会话 4 倍"当量化结论（Stream5）——单一社区博客、非实测，一手锚点无此数据。
3. 在 settings.json 的 `skillOverrides` 键配 `disable-model-invocation:true`（Stream3）——**P0**，该键无证据疑为臆造。
4. 在脚本体内 `await Read('evidence/..')` 直接读文件——与"脚本体无文件系统访问"冲突，须经 Explore 子代理。
5. 按风险开 2-3/4-5/6-8 个 skeptic 的数量矩阵（Stream4）——无实测支撑，高风险堆 skeptic 逼近并发上限、违反反模式。
6. 把 8 阶段做成多个子 workflow 父串联——`workflow()` 仅一层嵌套，会抛错。
7. 最小示例搞十步法 + 四象限/五维量化排名 + 高风险多 skeptic 全开——"为评估而评估"、违反"先最小闭环"。
8. 成本预测引入"规模系数"公式（Stream6）——系数未定义、虚假精度。
9. 把读本机资产标为 `official-doc`——应标 `live-env`，official-doc 仅指 Anthropic 官方文档。

## 三、仍未确认（8 条，须留白/降置信/后续核实）
1. 网络来源精确阈值（预加载~20K token、上下文>60% 降速、CLAUDE.md 首 200 行/25KB、Hook 返回 10KB 上限）——本环境无法核验、易随版本变化，统一降为 medium 并标注"网络来源、未验证"。
2. `budget.total` 计量口径（仅输入 or 输入+输出）规范未定义；超限时已完成 agent 结果"是否整轮回滚"语义未定，留白。
3. `disable-model-invocation` 确切配置位置（SKILL.md frontmatter vs settings 键名）须对照本机官方 skills 规范。
4. 项目 `.claude/settings.json` 现状未读；presubmit 门禁是新增还是合入现有 Hook、matcher 对 `git commit` 各调用形式的覆盖，须读实际 settings 后定。
5. 自定义 agentType 仅从项目目录启动才进注册表；工程交付子代理做成自定义 agentType（不可移植）还是内置+prompt（可移植），取决于团队是否固定从仓库根启动。
6. StructuredOutput 重试是否有次数上限、resume 对 worktree 缓存的恢复、`workflow()` 子调用 token 是否计入父 budget——锚点未逐条明确，列开放问题。
7. 8 阶段折叠为 4 phase 后，对外展示是否需按 8 阶段逐项打分，须与负责人确认评估口径。
8. 多 skeptic 意见不一致时的聚合策略（多数/权重/一票否决）规范未给，须团队按风险约定。

## 四、跨切原则（8 条，贯穿全部文档）
1. **一手锚点优先**：Workflow API 结论须与 `01-workflow-api-ground-truth.md` 逐字一致，与网络旧文档冲突以锚点为准。
2. **区分证据强度与置信度**：复述一手原文可 high；综合/设计/数量建议须标 inference 且降为 medium，经独立 skeptic 证伪后再定级。
3. **复用而非复制**：清单留 Skill、编排进 Workflow、确定性门禁进 Hook、固定约束进 CLAUDE.md，四类职责不混淆。
4. **脚本体是隔离纯 JS 编排层**：一切 IO 与确定性脚本必须经子代理或 Hook。
5. **成本与规模克制**：默认 pipeline；agent 数按"新增独立视角"分配；fan-out 前设 budget；effort/模型分层。
6. **质量靠独立性而非数量**：实现者不自评；循环须有最大轮次与可观测退出；不静默截断。
7. **越证据的后果/数字必须留白或标注**：规范未明示的后果、网络阈值、自创公式一律不以 high/可执行规则呈现。
8. **CLAUDE.md/Skill 非强制**：红线靠 Hook/permissions 技术强制，CLAUDE.md 同步写明意图。
