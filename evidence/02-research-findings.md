# 研究发现汇编（6 路并行研究）

> 这是 `wf-methodology-research` 研究阶段的**条目化汇编**（已被交叉审查与分歧修正校正，最终结论见 `03-decision-log.md`）。
> 完整逐条发现、每条的 evidence/sourceType/confidence、各流引用见 `research-raw.json`。本文件供人快速查阅与溯源。

## 研究方法与证据纪律
- 每条发现标注 `sourceType` ∈ {official-doc, product-spec, live-env, inference} 与 `confidence` ∈ {high, medium, low}。
- 凡 Workflow 脚本 API，一律以 `01-workflow-api-ground-truth.md`（产品内一手规范）为准；网络资料仅用于 Claude Code **概念**佐证，不用于 API 形态。
- 复述一手原文可 high；研究者的综合/设计/数量建议标 inference 且降为 medium，经独立 skeptic 证伪后再定级。

## 六路研究方向与核心确认结论

### 1. 概念辨析（Skill / Subagent / Workflow / Hooks / CLAUDE.md）
- Skill = 按需加载的知识库（会话启动只见描述，调用才载全文）。`official-doc`/high。
- Subagent = 独立上下文窗口 + 自定义系统提示 + 受限工具 + 独立权限；完成后返回压缩摘要而非堆中间结果。`official-doc`/high。
- Workflow = 纯 JS 编排脚本，持久化、可断点恢复，可协调数十～上百子代理；决定"下一步跑什么"的是**脚本**而非模型。`live-env`/high。
- Hooks = 生命周期特定点的确定性自动化，由 **harness** 执行（exit 2 阻断）；是强制层。`official-doc`/high。
- CLAUDE.md = 项目级固定约束，每会话启动加载，跨 /clear 与重启存活；是**上下文**非强制。`official-doc`/high。

### 2. 控制流技巧（串/并/分支/循环）
- `pipeline()` 默认；stage 间无栅栏，墙钟=最慢单条链；回调签名 `(prevResult, originalItem, index)`。`product-spec`/high。
- `parallel()` 是栅栏，仅当需要全量跨 item 结果（去重/合并/全集早退/相互比较）才用。`product-spec`/high。
- 循环模式：loop-until-dry（连续 K 轮无新增）/ loop-until-count / loop-until-budget；须有最大轮次与可观测退出。`product-spec`+`inference`。

### 3. 状态、上下文与断点恢复
- 脚本持久化到会话目录，`{scriptPath, resumeFromRunId}` 恢复，未改动 `agent()` 前缀命中缓存。`product-spec`/high。
- schema + StructuredOutput 把解析与上下文负担降到工具层。`product-spec`/high。
- 多层隔离（脚本/子代理/Skill/CLAUDE.md）+ evidence 外部化文件 = 可追踪且防上下文膨胀。`product-spec`+`inference`。

### 4. 质量保障（测试/审查/重试/退出）
- 推荐：对抗式证伪（多 skeptic 多数证伪则否决）+ 多视角 lens + 评审团；实现者不自评。`product-spec`/high。
- 退出条件须固定可观测（示例缺省值非 API 约束）；被丢弃覆盖面必须 `log()`。`product-spec`+`inference`。

### 5. 成本与规模控制
- 并发 `min(16, CPU-2)`；总数 1000；单次 ≤4096。`product-spec`/high。
- 唯一可靠成本观测是 `budget.spent()/remaining()`；小样本试跑→外推；effort/模型分层、worktree 默认不用。`product-spec`+`inference`。
- ⚠️ 被否决：网络博客的"总 token≈单会话 4 倍"、自创"规模系数"公式——无实测、虚假精度。

### 6. 现有 Skill 转化（价值最高的一路）
- 8 阶段折叠为 4 phase 在单 workflow 内实现（`workflow()` 仅一层嵌套，不能父串多子）。`product-spec`+`inference`。
- presubmit-scan.sh 由带 Bash 的子代理调用回报；真正强制门禁落 PreToolUse Hook，但配置须先读项目实际 settings.json。`live-env`+`official-doc`。
- 复用 Skill 的"按需加载/单一事实源/任务分级/规则优先级链"思想，不照搬业务 8 阶段。

## 关键官方引用（研究阶段抓取）
- Skills: https://code.claude.com/docs/en/skills.md
- Subagents: https://code.claude.com/docs/en/subagents.md
- Dynamic Workflows: https://code.claude.com/docs/en/workflows.md
- Hooks: https://code.claude.com/docs/en/hooks.md
- Memory / CLAUDE.md: https://code.claude.com/docs/en/memory.md
- How Claude Code works: https://code.claude.com/docs/en/how-claude-code-works.md
- Blog: Introducing Dynamic Workflows in Claude Code（claude.com/blog）

> 注：以上 URL 为研究子代理 WebFetch/WebSearch 所得，结构与可达性可能随时间变化；本机一手锚点 `01-workflow-api-ground-truth.md` 是 API 的最终事实源。

## 同质性教训（诚实记录）
6 路中约 5 路高度同质（多在复述同一份 ground-truth）。这是"为展示规模堆 agent"的现实案例：研究类 fan-out 应按"是否新增独立视角"切分，而非按"主题数量"。已在 `docs/07-antipatterns.md` 作为真实案例呈现。
