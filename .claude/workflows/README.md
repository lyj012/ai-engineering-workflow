# .claude/workflows/ —— 可复用 Workflow 脚本

本目录保存本方法论项目**实际运行过**的 Workflow 脚本，供他人照抄重跑。

## 脚本一览（定位）

| 脚本 | 定位 | 何时用 |
|---|---|---|
| **`plan-from-requirement.js`** ⭐主 | **客户需求 → 现有代码分析 → 可执行实现方案**（只读，不写客户代码） | 客户提出开发/改造需求，要产出开发可直接实施的方案报告 |
| **`deliver-from-plan.js`** 🔗桥接 | **方案 → 沙箱内写码到测试全绿 → 出 diff**（不改原仓库/不提交） | 已有 `readinessForDev=ready` 的方案，想真正实现并跑到测试全绿、产出可审查的 diff |
| `analyze-repo.js` | 通用**仓库审计**：理解→扫描→优选→分析→风险→测试方案→独立审查→报告 | 只想体检一个仓库/评估外部代码（不针对某条需求） |
| `wf-methodology-research.js` / `wf-docs-generation.js` | 一次性**元流程**：生产本方法论文档（研究/文档流水线） | 复刻/更新本方法论文档库时 |

> `plan-from-requirement` 与 `analyze-repo` 共享同一套引擎（lite/standard/deep 分档、证据链、确定性一致性校验、有界返工、独立审查、失败降级、带时间戳落盘），但 `plan-from-requirement` 全程围绕**一条客户需求**产出实现方案，`analyze-repo` 是不带需求的通用审计。
>
> **完整链路**：`plan-from-requirement`（需求→方案，只读）→ 就绪闸门 → `deliver-from-plan`（方案→编码到测试全绿，沙箱内，出 diff）→ 人工审 diff 决定落地。桥接把"写码闭环"的流程真相源交给 `vendor/zhuliming-templates/`（朱立明模板，已署名授权），脚本只编排。设计见 `docs/12-plan-to-coding-bridge.md`。

---

## 🚀 Quick Start（主用法：需求 → 实现方案）

```text
Workflow({ scriptPath: ".../.claude/workflows/plan-from-requirement.js", args: {
  requirement: "<客户要实现什么>",
  target: "<目标代码仓库>",
  constraints: ["<已知约束>"],
  mode: "standard",                 // lite | standard | deep
  outDir: "/abs/path/evidence/plans"
}})
```
流程：需求理解 → 按需求定位现有代码 → 相关模块现状分析 → 现状/目标差距 → 实现方案(复用/修改/新增+影响面+步骤) → 风险 → 测试与验收 → 独立审查 →(必要时返工)→ 开发可直接实施的方案报告 → 落盘。
产出在 `evidence/plans/<时间戳>/`（含 `final-plan.md` + requirement/located-code/gap/plan/risks/test-plan/review-history 等 JSON）。
> 参考材料默认来自本仓库 `docs/11-requirement-to-plan.md`、`docs/12-plan-to-coding-bridge.md` 与 workflow-designer Skill；外部 Skill 只能通过 `args.skillDir` 显式接入。

---

## 🔎 次用法：通用仓库审计（analyze-repo）

`analyze-repo.js` 支持三档 `mode`，按"成本 vs 深度"选：

| mode | 组件数 | 返工上限 | effort(分析/重活) | 适合 |
|---|---|---|---|---|
| **lite** | 3 | 0 | low/medium | 快速体检、CI 冒烟、先看个大概（最省 token） |
| **standard**（默认） | 5 | 1 | medium/high | 日常分析、接手陌生项目 |
| **deep** | 8 | 2 | high/high | 上线前/外部代码评估、要尽量全 |

```text
# 快速体检（最省）
Workflow({ scriptPath: ".../.claude/workflows/analyze-repo.js",
           args: { target: "/path/to/repo", mode: "lite" } })

# 日常分析（默认，可省略 mode）
Workflow({ scriptPath: ".../analyze-repo.js",
           args: { target: "/path/to/repo", taskDescription: "看懂架构并找风险" } })

# 深度分析 + 开启受限验证（命令由 JS 白名单硬校验）
Workflow({ scriptPath: ".../analyze-repo.js",
           args: { target: "/path/to/repo", mode: "deep", runVerification: true,
                   outDir: "/abs/path/evidence/runs" } })
```
> 显式 `maxComponents` / `maxReworkRounds` 会覆盖 mode 预设。`outDir` 缺省 `evidence/runs`（相对子代理 cwd）；跨目录运行建议传绝对 `outDir`。产物落 `evidence/runs/<时间戳>/`，不覆盖历史。

### 故障注入自检（验证控制流，不冒充真实分析）
```text
# 演练 返工→复评 链路 + 组件降级
args: { target: "/path/to/repo", mode: "standard",
        forceFirstVerdict: "CONDITIONAL_PASS", injectComponentFailureIndex: 1 }

# 演练 Verify 的 JS 白名单（含危险命令以验证被拒）
args: { target: "/path/to/repo", mode: "lite", runVerification: true,
        injectVerifyCommands: ["bash -n x.sh", "rm -rf /tmp/x", "ls; cat /etc/passwd", "git status"] }
```
注入项在所有产物中均显式标注为 `[测试注入]`。

---

## 7 阶段 → 脚本映射

| 阶段（任务要求） | 由谁实现 | 真实运行记录 |
|---|---|---|
| 1 任务定义 | `wf-methodology-research.js` 的 `Charter` phase | `evidence/research-raw.json`（charter） |
| 2 并行研究 | `wf-methodology-research.js` 的 `Research` phase（6 路并行） | 同上（research[]） |
| 3 交叉审查 | `wf-methodology-research.js` 的 `Review` phase（3 独立视角） | 同上（reviews[]） |
| 4 分歧修正 | `wf-methodology-research.js` 的 `Reconcile` phase | 同上（reconciliation）；`evidence/03-decision-log.md` |
| 5 文档生成 | `wf-docs-generation.js`（9 并行 doc-writer，写 docs/01-09） | `docs/01-09`（doc 10 由主代理据真实运行补写） |
| 6 最小示例 | `analyze-repo.js`（7 阶段只读分析 demo） | `evidence/demo-run-report.md`、`demo-run-raw.json` |
| 7 验证 | 独立 `workflow-reviewer` 评审门禁（≤2 轮返工） | `evidence/review-report-round*.md`、`rework-log.md` |

> 设计说明：任务要求的 7 阶段被**有意拆成 3 个可独立运行/恢复的脚本** + 1 个评审门禁，而非塞进一个巨型脚本——因为 `workflow()` 仅一层嵌套（不能父串多子，见 `docs/09`），且分段脚本更易断点恢复与单独复用。运行元数据（runId/taskId/agent 数）见 `evidence/demo-run-meta.json`。

## 运行方式

```text
# 1) 研究流水线（任务定义→研究→交叉审查→分歧修正）
Workflow({ scriptPath: ".../.claude/workflows/wf-methodology-research.js" })

# 2) 文档流水线（读 evidence/ 生成 docs/01-09）
Workflow({ scriptPath: ".../.claude/workflows/wf-docs-generation.js" })

# 3) 最小示例（只读分析任意目标）
Workflow({ scriptPath: ".../.claude/workflows/analyze-repo.js",
           args: { target: "<目标目录>", taskDescription: "<任务>", maxComponents: 6 } })

# 从仓库根目录启动 Claude 时，可用命名形式： Workflow({ name: "analyze-repo", args: {...} })
```

## 复用注意
- 脚本是**纯 JS**、`meta` 纯字面量、禁 `Date.now()/Math.random()`、脚本体不直接读写文件（详见 `docs/03`、`evidence/01-workflow-api-ground-truth.md`）。
- 研究/文档脚本中的子代理用**内置 agentType**（claude-code-guide/Explore/general-purpose），可在任意目录运行；它们引用的角色专长也对应 `.claude/agents/*.md`（从仓库根目录启动时可作自定义 agentType）。
- 断点恢复：`Workflow({ scriptPath, resumeFromRunId })`，未改动的 `agent()` 前缀命中缓存（详见 `docs/05`）。
