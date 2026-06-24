# 返工记录（Rework Log）

> 记录"独立评审 → 返工 → 再评审"有界循环（最多 2 轮返工）的每一步改动，确保实现者不自评、改动可追溯。

## Round 0 评审结论
- 评审者：独立 `workflow-reviewer` 实例（未参与设计与实现）。报告：`evidence/review-report-round0.md`。
- 判级：**CONDITIONAL_PASS**，89/100，P0=0，P1=2，P2=3。
- 评审者实证亮点：在临时目录**独立复现**了最小示例发现的 presubmit-scan 高危缺陷（非 git 目录静默 exit 0）；核实原 Skill 8 文件零修改；确认脚本 API 合规、未把网络数字当事实、未为展示堆 agent。

## Round 1 返工（实现者=主代理，评审者=另一独立实例，二者分离）

| 项 | 严重度 | 评审意见 | 本轮处理 | 证据 |
|---|---|---|---|---|
| P1-1 | 阻断 | doc-01 导航表标题与实际文件错位，且第 110 行谎称"仅 01 已落地" | 重写导航表三列与实际 H1 对齐；改为"01–10 共 10 篇均已落地"，并补可复用脚本指引 | `docs/01-workflow-overview.md` §4 |
| P1-2 | 阻断 | 需求 #4 的 7 阶段方法论 Workflow 脚本未入库（仅 analyze-repo.js） | 把实际跑过的 `wf-methodology-research.js`(阶段1-4) 与 `wf-docs-generation.js`(阶段5) 补存进 `.claude/workflows/`，新增 `README.md` 做 7 阶段→脚本映射 | `.claude/workflows/{wf-methodology-research.js, wf-docs-generation.js, README.md}` |
| P2-1 | 改进 | demo runId 仅在叙述 md、未落机器产物 | 新增 `evidence/demo-run-meta.json`，含三次运行 + 评审的 runId/taskId/agentCount | `evidence/demo-run-meta.json` |
| P2-2 | 改进 | analyze-repo stage3 用 parallel 的取舍建议加注释 | 在脚本 stage3 前补注释，说明"因 stage4 需全量组件结果才用栅栏" | `.claude/workflows/analyze-repo.js` |
| P2-3 | 改进 | 8→4 折叠的评分口径需与负责人对齐 | 维持如实留白（属未决项，展示前对齐即可），不强改 | `docs/09`、`03-decision-log.md` |

### 未采纳/留白说明
- P2-3 属"需与负责人确认评估口径"，非实现缺陷，保持诚实留白。
- `.ps1` 动态行为因本机 `pwsh` 缺失，维持"未验证"标注（评审者亦认定为合理留白，非过失）。

## 下一步
启动**新的** `workflow-reviewer` 独立实例做 Round 1 复评（不采信"已改"自述，重新独立核查 doc-01 导航与 `.claude/workflows/` 内容）。结果记入 `evidence/review-report-round1.md` 并在此续写。

---

## Round 1 复评结论
- 评审者：**全新**独立 `workflow-reviewer` 实例（与 Round 0、与实现者均不同）。报告：`evidence/review-report-round1.md`。
- 判级：**PASS**，96/100（较 Round 0 升 7 分），P0=0，P1=0，P2=1。
- 两条 mustFix 均**经实证复核**修复：
  - P1-1：逐篇 `head -1 docs/0X-*.md` 与导航表 10 行比对全部一致；"仅 01 已落地"已改正、grep 无残留矛盾。
  - P1-2：`.claude/workflows/` 现含 3 脚本 + README（7 阶段映射、零死链）；脚本 `return` 键集与 `research-raw.json` 完全一致、agentCount=11=1+6+3+1，证明对应真实运行而非补造；API 全合规。
- 无新增/回归问题。唯一遗留 P2-3（8→4 评分口径需与负责人对齐）属未决项、非缺陷。
- 结论：**建议向负责人展示**（展示时附本复评报告与遗留项）。

> 返工轮次：1 轮（上限 2 轮），第 1 轮即通过，循环正常收敛。
