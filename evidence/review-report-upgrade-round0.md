# 独立评审报告 —— analyze-repo Workflow 升级（round0）

> 评审者：全新独立 workflow-reviewer（未参与本次设计/实现）
> 评审基准：`.claude/agents/workflow-reviewer.md`、`evidence/01-workflow-api-ground-truth.md`、项目 `CLAUDE.md`
> 评审方式：Read/Bash/Grep 亲自核查代码与运行产物，不采信任何自述
> 日期：2026-06-23

---

## verdict

**PASS**

无 P0；无阻断性 P1；证据链完整、可追踪；JS 真正控制返工-复评有界循环；失败/降级处理真实存在；Verify 默认关闭且安全；产物落带时间戳目录、未覆盖历史、未改目标仓库；无硬编码个人路径；自定义 Agent 降级如实未夸大。

---

## score（100 制，分项 + 总分）

| 维度 | 权重 | 得分 | 依据 |
|---|---|---|---|
| 需求覆盖与正确性 | 30 | 29 | 升级目标 9 项全部 met（见覆盖矩阵）；仅 §12 报告对 `verified` 状态的口径有轻微可改进点 |
| 可运行性与真实证据 | 25 | 24 | 真实产物齐全、数字自洽、行号经源码二次核验属实、目标仓库 mtime 证明零改动；扣 1 因部分 `verified` 风险缺独立命令日志文件 |
| 阶段/职责设计清晰度 | 15 | 15 | 12 阶段各有输入/输出/完成标准；agent 职责分离（执行 vs 只读评审）无矛盾 |
| 健壮性（状态/重试/退出/无死循环/降级） | 10 | 9 | while 有 `MAX_REWORK` 上限、复评失败 break；必需阶段重试+halt、可降级记缺口；扣 1 因 line 367 死分支（不影响行为，仅冗余） |
| 复用现有 Skill 的合理性 | 10 | 10 | 仅复用 ai-engineering-delivery-zh 作分析目标，零改动；新增 1 个 agent |
| 成本与规模克制 | 10 | 9 | 仅新增 verification-runner 一个 agent；成本如实记录并提示质量模式增本；扣 1 因 demo 单次约 64 万 token（已诚实标注并给控本建议） |
| **总分** | **100** | **96** | |

---

## 需求覆盖矩阵（对照本次升级目标各项）

| 升级目标项 | 状态 | 证据（文件/产物） | 备注 |
|---|---|---|---|
| Select 阶段替代 slice | met | `analyze-repo.js:253-267` Select 阶段；`selected-components.json`（选中 4 带 reason+signals、排除 4 带覆盖风险） | 真正的相关性/入口/风险面优选，非截断 |
| 证据字段(path/symbol/lineRange/observation) | met | `analyze-repo.js:109-113` EVIDENCE schema；`risks.json` 12 风险/28 证据条目全有 path+lineRange+observation | RISK-001 行 54-68、RISK-002 行 99-102、RISK-004 行 88 经 sed 核验与源码完全一致 |
| 不编造行号约束 | met | schema 注释「不确定填 unknown，严禁编造」；产物含 1 条 `unknown` | 抽查行号属实；保留 unknown 体现非编造纪律 |
| 风险带 id | met | `risks.json` RISK-001..RISK-012 | 12 条全带唯一 id |
| 用例带 riskIds | met | `test-plan.json` 23 用例 riskIds 全非空；双向交叉无悬挂引用 | 12 风险全部被用例覆盖，无 uncovered |
| JS 控制 评审→返工→新实例复评循环 | met | `analyze-repo.js:302-350`；`passedReview`(220) 任何 P0 或非 PASS 均不通过；`while(round<MAX_REWORK)`(327)；每轮 `doReview(round)` 全新实例 | `review-history.json` 两轮（r0 CONDITIONAL_PASS→r1 PASS 91），不同轮次 |
| 无限循环防护 | met | `MAX_REWORK` 默认 2（57 行带 Number.isFinite 归一化）；round++ 在循环首；复评失败 break(347) | 不存在死循环路径 |
| 两轮不过→FAILED_WITH_FINDINGS 且仍出报告 | met | line 367 非 PASS→`FAILED_WITH_FINDINGS`；Report(372) 在循环外、不被 gate；catch 仅 halt 时才空报告 | 行为正确（但 367 三元两分支同值，见 P2） |
| 失败/降级：必需 halt+重试 / 可降级记 failedComponents | met | `callAgent`(90) required→重试 1 次；halt(106/234/242/249/262/290/378)；Analyze 可降级(281)、TestPlan 降级(298) | `run-manifest.json` failedComponents=[ps1]、coverage analyzed=3 |
| status 枚举(PASS/PARTIAL/FAILED/FAILED_WITH_FINDINGS) | met | 364-369 + catch 383 设 FAILED | 本次产出 PARTIAL（复评 PASS 但有降级） |
| Verify runVerification 默认 false | met | `analyze-repo.js:56`；`verification-result.json` results=[] summary 明示未执行 | "测试计划 ≠ 已验证" 显式写入 |
| Verify 白名单存在 | met | `CMD_WHITELIST`(62) 仅只读/安全前缀；verify prompt 强制 refused 其余 | 与 verification-runner.md 安全规则一致 |
| 不把测试计划夸大成已验证 | met（轻微可改进） | 报告 §12 + `remainingGaps` 标 static-analysis-only | 见缺失证据：部分风险自标 `verified` 缺独立命令日志 |
| 无硬编码个人绝对路径 | met | grep `/data//home//Users/` 脚本内零命中；target/outDir 全来自 args | 产物中的 /data/ 路径是运行时 args 传入，非脚本硬编码 |
| args JSON 字符串归一化 | met | `analyze-repo.js:45-49` typeof==='string' 则 JSON.parse，兼容三态 | 与运行时事实一致 |
| 真实运行（带时间戳、不覆盖历史、不改目标） | met | `evidence/runs/20260623-154359/` 12 文件齐全；目标 mtime 2026-06-18 < 运行 2026-06-23；非 git 仓库无改动 | v1 历史 demo-run-* 保留 |
| 自定义 Agent 降级如实、未假装接入 | met | 16-20、79-84 注释与 roleBrief；默认内置 agentType + 注入角色说明；useCustomAgents 默认 false | 与 ground-truth §6 一致，绝不假装已接入 |
| 文档与代码/产物一致 | met | `docs/10-demo-workflow.md` 数字（12 风险/23 用例/PARTIAL/8→4/dropped4/failed1/两轮 CONDITIONAL_PASS→PASS91）逐项与产物吻合 | runId/agent 数仅在文档（脚本无法取，符合无 Date.now 约束） |
| Reviewer/Runner 职责分离 | met | `independent-reviewer.md`（Read/Grep/Glob 只读不执行）vs `verification-runner.md`（Read/Bash 执行不打分） | 无矛盾、无重复 |
| 不破坏原 Skill / 不堆 agent | met | ai-engineering-delivery-zh 零改动；agents 目录仅新增 verification-runner（15:04），independent-reviewer 改只读 | 方法论文档 docs/01-09、evidence/00-03 完整 |

---

## P0 / P1 / P2 问题

### P0（阻断 → FAIL）
- 无。

### P1（影响质量但有可行修复；本轮均非阻断）
- 无阻断性 P1。

### P2（改进项，不阻断）

1. **[P2｜代码冗余｜不阻断] `analyze-repo.js:367` 三元表达式两分支同值**
   `if (!reviewPassed) finalStatus = (review.p0||[]).length>0 ? 'FAILED_WITH_FINDINGS' : 'FAILED_WITH_FINDINGS'`
   两分支返回相同字符串，是死分支。文档与枚举区分了 `FAILED`（必需阶段 halt，由 catch 设）与 `FAILED_WITH_FINDINGS`（评审两轮不过），当前行为正确，但此处显然原意是按是否有 P0 区分严重度却退化为恒定值。
   建议：要么删除三元改为直接赋 `'FAILED_WITH_FINDINGS'`，要么真正区分（如有 P0 → `'FAILED_WITH_FINDINGS'`、无 P0 仅 CONDITIONAL → 另一枚举）。仅清洁度问题，不影响产物正确性。

2. **[P2｜证据完整性｜不阻断] 报告 §12 与 7 条风险自标 `verified`，但无独立命令日志落盘**
   `verification-result.json` 正确为空（Verify 未开），而报告 §12 与 `risks.json` 中 RISK-001/002/003/004/007/011/012 被分析/返工 agent 自标 `verified`（声称在隔离临时 git 仓库实跑复现退出码）。这些黑盒复现的退出码/stdout 没有作为独立产物文件保存，只在 agent 叙述（rework-history/report 文本）中体现。
   评判：报告已明确写 "runVerification=false"、"测试计划 ≠ 全部已验证"、并把 ps1/可移植性/TOCTOU 列为 static-analysis-only，**未夸大成 Verify 阶段已跑**，故不构成"谎称已验证"。但 `verified` 这一强状态缺独立可核查的命令日志，属证据链可加强项。
   建议：开启 runVerification 走正式 Verify 阶段落 `verification-result.json`，或在 rework 产物中附原始命令+exitCode 片段，使 `verified` 可被第三方独立复核。

3. **[P2｜口径一致性｜不阻断] `verified` 与 `runVerification=false` 的语义边界可更清晰**
   产品语境下 `verified` 易被读者理解为"经正式验证阶段确认"。建议在 schema 描述或报告中区分 "analysis-phase-reproduced"（分析期黑盒复现）与 "verify-stage-verified"（受控 Verify 阶段），避免读者误读两者等价。

---

## 缺失证据（missingEvidence）

- 被标 `verified` 的 7 条风险，缺独立落盘的命令执行日志（退出码/stdout-tail）作为第三方可核查证据；当前仅存在于 agent 叙述文本中。属"可加强"，非"缺失到不可信"——行号已经 grep -n 二次核验且本评审独立 sed 核对属实。
- 文档声称的 Run ID `wf_eec0ee32-224` 与 "13 个 agent"、"约 64 万 token / 41 分钟" 仅见于 `docs/10-demo-workflow.md`，无对应机器产物文件佐证（脚本受 `no Date.now/runtime-id` 约束无法自记，属合理）。不影响判级，但这些运行元数据无法被独立复核。

---

## mustFix（必须返工项）

- 无（无 P0、无阻断 P1）。以上 P2 为建议改进，不作为重新通过的前置条件。

---

## 剩余风险

1. 演示运行使用了测试注入（`forceFirstVerdict=CONDITIONAL_PASS`、`injectComponentFailureIndex=1`）来演练返工与降级硬路径。注入项在 manifest.params、execution-log、review-history、rework-history、报告中均显式标注为"[测试注入]"，**未冒充真实评审**——但这意味着本次 round0 的 CONDITIONAL_PASS 是人为强制的；真实首轮即 PASS 的链路与"真实首轮 FAIL→两轮仍不过→FAILED_WITH_FINDINGS"的端到端链路尚无非注入的真实运行佐证（代码路径正确，缺一次纯真实失败的运行样本）。
2. `verified` 状态依赖分析期 agent 自报的黑盒复现，未独立落盘命令日志（见 P2-2）。
3. 跨平台（ps1 / 非 GNU 环境 / TOCTOU 并发）结论为 static-analysis-only，本机无 pwsh、未在 dash/BusyBox 实跑——产物已诚实标注，非缺陷。
4. demo 单次约 64 万 token 成本偏高（质量模式+返工复现实验所致），生产需按需控 maxComponents/effort——文档已给出提示。

---

## 一句话结论 + 是否建议展示

升级目标 9 项全部达成、证据链完整且行号经独立核验属实、JS 真正控制有界返工复评循环、失败降级与默认只读安全策略到位、零硬编码路径、目标 Skill 零改动、自定义 Agent 降级如实不夸大——**判 PASS（96/100），建议向负责人展示**；展示时如实附带三点说明即可：本次演示用了显式标注的测试注入、部分 `verified` 风险尚缺独立命令日志、line 367 有一处无害的冗余三元待清理。
