# AI 软件工程 Workflow —— 需求 → 方案 → 编码到测试全绿

一套面向真实软件工程任务的 **Claude Code Dynamic Workflow** 方法论与可运行实现：把"一句客户需求"一路推到"经过测试验证的代码改动 diff"，每一步都**有据可查（行号证据）、有独立复核（实现者不自评）、有沙箱兜底（不动原仓库、不自动提交）**。

> 适用于：把模糊需求转成工程任务、分析陌生代码库、控制 AI 不盲目生成代码、对 AI 输出做独立审查、建立可验证的开发闭环。

---

## 能做什么（场景）

| 场景 | 工作流 | 产出 |
|---|---|---|
| 需求 → 可落地方案（只读，不写码） | `plan-from-requirement` | `final-plan.md` + 结构化 JSON（复用/修改/新增/步骤/风险/验收） |
| 方案 → 沙箱内编码到测试全绿 → diff | `deliver-from-plan` | `changes.diff` + 测试全绿 + 交付报告（不改原仓库/不提交） |
| 一句需求 → 经测试验证的代码 diff | 上面两者串联（中间留就绪闸门） | 端到端交付 |
| 陌生/外部仓库体检 | `analyze-repo` | 带证据的风险清单 + 测试方案 |
| 复刻本方法论文档 | `wf-methodology-research` / `wf-docs-generation` | `docs/01–12` |

链路：`客户需求 →[plan-from-requirement]→ 方案 →(就绪闸门)→[deliver-from-plan]→ 沙箱代码+diff → 人工审 diff 决定落地`

---

## 环境要求

- **Claude Code** `2.1.186`+，已启用 **Dynamic Workflows**（`Workflow` 工具）。
- 运行 demo/测试需 `bash`、`git`、`python3`、常规 GNU 工具。
- PowerShell（`.ps1`）相关验证需 `pwsh`；**缺失时桥接会如实把 `.ps1` 半部标为"开环人工核对"**，不假装已验证。
- 不需要编译环境（方案/分析为只读静态分析）。

## 快速开始

```text
# 1) 需求 → 方案（只读）
Workflow({ scriptPath: "<abs>/.claude/workflows/plan-from-requirement.js", args: {
  requirement: "<客户要实现什么>",
  target: "<目标代码仓库>",
  constraints: ["<已知约束>"],
  mode: "standard",                 // 可省→自动选档 lite|standard|deep
  outDir: "<abs>/evidence/plans"
}})

# 2) 方案 → 编码到测试全绿（沙箱内、出 diff、不提交）
Workflow({ scriptPath: "<abs>/.claude/workflows/deliver-from-plan.js", args: {
  planDir: "<abs>/evidence/plans/<ts>",   // 须 readinessForDev=ready
  targetRepo: "<abs>/目标仓库",            // 被复制进沙箱，原仓库不被写
  outDir: "<abs>/evidence/deliveries"
}})
```

各工作流的完整参数/产物说明见 `.claude/workflows/README.md`；方法论与设计真相源见 `docs/01–12`。

---

## 目录结构

```
workflow/
├── README.md                 ← 本文件
├── LICENSE                   ← MIT（vendor/ 另行署名）
├── .gitignore                ← 排除运行数据/客户副本/个人配置
├── 目标说明.md                ← 项目目标与完成标准
├── CLAUDE.md                 ← 项目固定约束（含"公开发布边界"说明）
├── docs/                     ← 方法论文档 01–12（概念→设计→实现→质量→链路）
├── .claude/
│   ├── workflows/            ← 可运行编排脚本（plan-from-requirement / deliver-from-plan / analyze-repo / 元流程）
│   ├── agents/               ← 子代理角色定义
│   └── skills/               ← workflow-designer 方法论 Skill
├── vendor/zhuliming-templates/  ← 第三方"写码闭环"模板（已署名授权，见 ATTRIBUTION.md）
└── evidence/                 ← 策展证据（00–03/评审/决策/遗留风险）+ 运行输出（runs/plans/deliveries，已 gitignore）
```

## 设计原则（一句话）

- **证据链**：结论带 `path/symbol/lineRange`，不确定填 `unknown`、**严禁编造行号**。
- **实现者不自评**：独立实例审查；任何 P0→不通过；有界返工；Fix 后由全新实例重新复审。
- **确定性优先**：状态以**独立验证子代理**复跑结果为准，不只信实现者自报。
- **安全兜底**：写码只进沙箱副本、复制后清除 `.git`/密钥、不 commit/merge；支付/权限/密钥/认证等高风险域**有意只分析、编码须人工**。
- **诚实**：没真验证就如实写"未验证/开环人工核对"，不撒谎；未确认的语义歧义不静默放行。

## 边界与已知限制

- 桥接**不自动提交**：只产 diff，是否落地由人工决定。
- 无 `pwsh` 时 `.ps1` 行为无法自动验 → 落为开环人工核对项。
- 高风险安全域（支付/权限/密钥/认证/不可逆）桥接**只接受分析、编码须人工**（落实安全纵深，非能力缺口）。
- 详见 `evidence/final-residual-risks.md` 与 `docs/12` §9。

## 许可与署名

- 本项目（刘远键）以 **MIT** 许可（见 `LICENSE`）。
- `vendor/zhuliming-templates/` 为**朱立明**所作、经授权署名复用，单独适用其授权条款（见 `vendor/zhuliming-templates/ATTRIBUTION.md`）。

## 版本

- v1（2026-06）：方法论 docs 01–12；工作流 plan-from-requirement / deliver-from-plan / analyze-repo / 元流程；需求→方案→编码到测试全绿链路已端到端真实运行并独立复核。
