---
name: workflow-designer
description: 设计与编排 Claude Code Dynamic Workflow 的方法论。当需要把一个需要长时间、多步骤、需并行/分支/循环/独立审查的任务，拆成可运行、可追踪、成本可控的 Workflow（含阶段划分、Subagent 分工、状态保存、失败重试、退出条件、独立评审）时使用。也用于评估“该用 Skill / Subagent / Workflow / Hooks / CLAUDE.md 中的哪一个”。不适用于一行小改、单纯解释、或一个 agent 单步即可完成的任务。
---

# Workflow 设计器

把一个复杂任务编排成**确定性、可追踪、成本可控**的 Claude Code Dynamic Workflow。本 Skill 提供方法与清单，不替代项目规则与 `CLAUDE.md`，叠加在其上。

涉及 Workflow 脚本 API 的一切，以 `workflow/evidence/01-workflow-api-ground-truth.md`（产品内一手规范）为准。深度方法论见 `workflow/docs/01`–`10`。

## 第一步：先判断该不该用 Workflow

- **一个 agent 单步能干完** → 直接做，别上 Workflow。
- **需要分解+覆盖、独立多视角、或单个上下文装不下**（迁移、审计、广扫、长流程）→ 用 Workflow。
- 先**贴边侦察**（列文件/定范围）再编排：你不必在做任务前就知道形状，只需在**编排那一步前**知道工作清单。

## 五种构件怎么选（详见 docs/01）

- **Skill**：方法 / 规范 / 清单（模型按需加载的知识）。← 本文件就是 Skill。
- **Subagent**：承担某类专业任务的独立上下文代理（研究/分析/审查…）。
- **Workflow**：确定性编排——阶段、串行、并行、分支、循环、汇总、重试。
- **Hooks**：必须确定性发生的检查/自动化，由 harness 执行（如提交前扫描、格式化）。
- **CLAUDE.md**：项目级固定约束（每次启动都生效，不随对话变化）。

口诀：**知识找 Skill，干活找 Subagent，编排找 Workflow，必然发生找 Hooks，固定约束找 CLAUDE.md。**

## Workflow 设计主干

复杂编排按这些步推进，逐项落实 `references/design-checklist.md`：

1. **定义任务**：目标 / 范围 / 非目标 / 交付物 / 评价标准 / 风险 / 待确认。
2. **拆阶段**：每个 `phase` 写清**输入 / 输出 / 完成标准**；阶段标题与 `meta.phases` 一致。
3. **选控制流**（详见 docs/02 与 `references/script-patterns.md`）：
   - **默认 `pipeline()`**（逐 item 穿过所有 stage，无栅栏）。
   - 仅当 stage 需要**全量跨 item 结果**（去重/合并/全集早退/相互比较）才用 `parallel()` 栅栏。
   - 未知规模的发现用 **loop-until-dry**；累计到量用 **loop-until-count**；按预算用 **loop-until-budget**。
4. **定 Subagent 分工**：每个 agent 一个清晰职责，无重复无遗漏；用 `schema` 让其返回结构化结果。
5. **质量门禁**（详见 docs/06）：**实现者不自评**——独立 agent 审查；高风险结论用对抗式/多视角验证；评审-返工有界循环（最多 N 轮）。
6. **状态与恢复**（详见 docs/05）：中间结果落 `evidence/`；可用 `resumeFromRunId` 断点恢复；上下文靠 schema 与子代理隔离收敛。
7. **成本与规模**（详见 docs/05）：不为展示堆 agent；按需分层选 `model`/`effort`；`budget` 设硬上限；并发受 `min(16, cores-2)` 限。
8. **验证与交付**：真实跑一遍、留运行记录；无法验证如实标注。

## 反模式（详见 docs/07）

不必要的栅栏 · 为展示规模堆 agent · 让实现者自评 · 静默截断（被丢弃的覆盖面要 `log()`）· 简单计数器漏长尾 · 无退出条件的循环 · 把未验证当已验证。

## 参考文件（按需加载，别一次全读）

- `references/design-checklist.md` —— 拆阶段、定分工、质量门禁、成本的逐项清单（设计 Workflow 时加载）。
- `references/script-patterns.md` —— 可直接照抄的 JS 脚本骨架（写脚本时加载，必须与 ground-truth API 一致）。
- `references/review-rubric.md` —— 独立评审的评分与判级标准（做质量门禁/最终评审时加载，配合 `workflow-reviewer` agent）。

## 复用现有工程交付 Skill

业务/风险敏感的实现类 Workflow，复用 `ai-engineering-delivery-zh` 的 8 阶段交付思想与风险清单（见 docs/09），不要照搬：把它的“理解→扫描→各流→验收→实现→验证→风险→复盘”映射成 Workflow 的 phase，把 presubmit 扫描做成 Hook。
