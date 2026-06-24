# Claude Code Workflow 方法论项目 —— 项目级固定约束

> 本文件演示 **CLAUDE.md 的定位**：保存“项目级固定约束”——每次在本目录启动都生效、不随对话变化的硬规则。
> 方法/清单放 Skill，专业任务放 Subagent，编排放 Workflow，确定性检查放 Hooks，**固定约束放这里**。
> 本项目是可独立克隆的公开仓库。所有路径默认相对仓库根解析，不依赖作者机器上的父目录、兄弟目录或个人全局配置。

## 一、不可破坏的边界
1. **不得依赖仓库外部文件作为默认运行条件**：外部 Skill、父目录规则、个人 harness 配置只能作为显式可选输入，不得成为默认路径。
2. 本项目所有新增/修改文件一律落在当前仓库根目录内。
3. 文件一律 UTF-8，中文不得乱码/转义。
4. 个人 harness 配置、个人记忆、密钥、客户代码副本、临时运行产物不得入库。
   > **公开发布边界**：本仓库中的 `.claude/workflows`、`.claude/agents`、`.claude/skills`、`docs/`、`examples/`、`scripts/` 是项目自有资产，应随公开仓库发布；`.claude/settings.local.json`、`AGENTS.md`、`**/memory/`、真实客户仓库副本、`evidence/runs|plans|deliveries` 等仍应排除。

## 二、Workflow 脚本硬约束（与 evidence/01-workflow-api-ground-truth.md 一致）
1. 脚本是**纯 JS**；以纯字面量 `export const meta = {...}` 开头；`meta.phases[].title` 与 `phase()` 调用逐字一致。
2. 脚本体内禁用 `Date.now()` / `Math.random()` / 无参 `new Date()`（破坏断点恢复）。
3. **默认用 `pipeline()`**；仅当 stage 需要全量跨 item 结果（去重/合并/早退/相互比较）才用 `parallel()` 栅栏。
4. 子代理优先用 `schema` 返回结构化结果，降低解析与上下文负担。
5. 任意目录可运行的 Workflow 必须使用**内置 agentType**（Explore/general-purpose 等）或省略，把角色专长写进 prompt；自定义 `.claude/agents/*.md` 仅在从本项目目录启动时进注册表。

## 三、质量与成本纪律
1. **实现者不得自评**：成果必须由独立 `workflow-reviewer` 评审；任何 P0 判 FAIL。
2. 不为展示规模堆 agent；不以运行时长或代码量充当质量。每个 agent 必须有独立、可说明的职责。
3. 每个阶段必须有**明确输入 / 输出 / 完成标准**；循环必须有最大轮次与退出条件（防无限循环）。
4. 无法真实验证时必须如实写“未验证”及原因，禁止谎称“已验证/测试通过”。
5. 控制上下文与成本：按需加载、结构化中间结果、必要时分层选模型与 effort。

## 四、证据与可复用
1. 关键产物与运行记录留存在 `evidence/`（环境扫描、研究、决策、运行报告、评审、返工、遗留风险）。
2. 交付物要能被他人从零复用：路径自洽、运行命令可照抄、依赖说明清楚。
