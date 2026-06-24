# 10 最小可运行示例：analyze-repo（升级版）

> 本文说明最小示例 Workflow `analyze-repo` 的设计与**真实运行结果**。
> 脚本：`.claude/workflows/analyze-repo.js`　最新运行产物：`evidence/runs/<时间戳>/`（每次运行独立目录，不覆盖历史）。
> 这是一个"只读分析"型 Workflow，刻意**不改目标代码**。它已从"一次分析后出报告"升级为**有证据、可追踪、有失败处理、能自动返工与复评**的分析流水线。

## 1. 它解决什么

输入一个代码仓库/任务描述，自动完成：前置校验 → 任务理解 → 结构扫描 → **组件优选** → 并行组件分析 → 全局风险 → 测试方案 → **独立审查** →（非 PASS 时）**返工 → 复评** →（可选）受限验证 → 最终报告 → 落盘。产出**每条结论都能追溯到代码证据**、风险与测试一一对应、并带诚实"未覆盖/未验证"标注的分析包。

## 2. 阶段（每阶段输入/输出/完成标准）

| # | phase | 输入 | 输出 | 完成标准 | 失败归类 |
|---|---|---|---|---|---|
| 1 | Preflight | target/args | 路径存在性/可读/类型 | 目标可用否则 halt | **必需**（失败即 FAILED）|
| 2 | Understand | target | 目标/范围/非目标/验收/假设 | 范围清晰 | 必需 |
| 3 | Scan | target | 组件清单/构建测试命令/入口 | 列出组件 | 必需 |
| 4 | **Select** | 组件清单 | 选中(理由+信号)/排除(理由)/覆盖风险 | 按相关性·入口·核心·被依赖·状态权限写入外调·安全 排序优选 | 必需 |
| 5 | Analyze | 选中组件 | 每组件：职责/关键文件符号/依赖/findings/risks/置信度 | 每组件有结论；**单个失败可降级** | **可降级** |
| 6 | Risk | 1+3+5 | 风险[带 id/证据/验证状态] | 覆盖工程风险视角 | 必需 |
| 7 | TestPlan | 风险+扫描 | 用例[引用 riskIds]/命令/缺口 | 用例可追溯风险 | 可降级 |
| 8 | Review | 1-7 全部 | verdict/score/p0/p1/p2/mustFix/missingEvidence/affectedPhases… | 独立实例给判级 | 必需 |
| 9 | **Rework** | mustFix/缺证据 | 补充分析：addressed/stillOpen/补风险/补用例 | 仅非 PASS 时进入；补充而非改目标代码 | 可降级 |
| (8') | Review again | 返工后产物 | 新一轮 verdict | **全新实例**复评 | 必需 |
| 10 | Verify | 测试命令∩白名单 | 命令/退出码/输出 | **默认关闭**；开启才执行白名单内安全命令 | 可降级 |
| 11 | Report | 全部 | 18 节 markdown + 追踪矩阵 + 最终状态 | 只汇总不新增结论 | 必需 |
| 12 | Persist | 全部产物 | 写入带时间戳运行目录 | 子代理落盘、不覆盖历史 | 必需 |

## 3. 关键工程升级（对应方法论各文档）

- **Select 取代粗暴 `slice(0,N)`**（修复 v1 真实暴露的 bug：截断恰好丢掉最重要文件）。被排除组件与覆盖风险显式记录，杜绝"误以为全量覆盖"。
- **证据链**：每条 finding/risk 带 `id` + `evidence{path,symbol,lineRange,observation}` + `confidence` + `verificationStatus`；**行号不确定填 `unknown`，严禁编造**。
- **风险↔测试可追溯**：用例带 `riskIds`，报告含追踪矩阵（代码证据→Finding→Risk→Test→Review）。
- **JS 控制的评审-返工-复评有界循环**：`PASS/CONDITIONAL_PASS/FAIL`；任何 **P0→FAIL**；非 PASS 提取 `mustFix`→返工补充→**全新 Reviewer 实例**复评；**最多 2 轮**，两轮仍不过：有 P0/`FAIL`→`FAILED_WITH_FINDINGS`；无 P0 的 `CONDITIONAL_PASS`→`CONDITIONAL`（有条件可用），仍出报告并写明未解决项（不伪装成功）。
- **失败/降级处理**：区分**必需阶段**（失败→重试 1 次→仍败则 halt，输出已有结果不造假）与**可降级阶段**（如单组件失败→记 `failedComponents`、标覆盖缺口、传给 Reviewer）。最终状态枚举 `PASS / PARTIAL / CONDITIONAL / FAILED_WITH_FINDINGS / FAILED`（主动排除 `dropped` 是采样、不算降级，经 `coverage/remainingGaps` 如实呈现），并返回 `failedStages/failedComponents/droppedComponents/coverage/remainingGaps`。
- **可选 Verify（默认关闭）**：`runVerification:false` 时只做只读分析。开启才进入受限执行：**命令白名单**、拒绝删除/覆盖/安装/改权限/sudo、超时、记录退出码与输出；**Verification Runner（执行）与 Reviewer（只读评分）严格分离**（见 `.claude/agents/verification-runner.md`、`independent-reviewer.md`）。"生成测试计划 ≠ 已验证"。
- **落盘交子代理**：脚本体**无文件系统访问**，由 persist 子代理把 12 个产物写入 `evidence/runs/<时间戳>/`，不覆盖历史、不碰目标仓库。
- **零硬编码个人路径**：`target`/`outDir` 全部经 `args` 传入。

## 4. 实跑中发现并修正的 3 个真实运行时事实（诚实记录）

实现期间真的踩到并修复了三处（均写进代码注释 / 记忆）：
1. **`args` 到脚本里是 JSON 字符串**（非对象）——必须 `JSON.parse`。v1 曾被默认值掩盖、参数静默失效。
2. **`parallel()` 的 thunk 若同步 `throw` 会让整个 workflow 崩溃**（只有异步 reject 才被收成 `null`）——演练降级改用"返回 null"模拟失败。
3. **自定义 agentType（`.claude/agents/*.md`）从他处 `scriptPath` 运行时无法解析**（探针证实报 `agent type not found`）——默认用内置 agentType + 注入"对应 agent 角色说明"等效复用，`useCustomAgents:true` 仅当从 `workflow/` 启动；**绝不假装已接入**。

## 5. 真实运行结果（一手，run `20260623-154359`）

> 数据来自一次真实运行（Run ID `wf_eec0ee32-224`，13 个 agent），产物在 `evidence/runs/20260623-154359/`。本次刻意注入"首轮 CONDITIONAL_PASS"与"组件失败"以演练硬路径（注入项在产物中均显式标注为测试）。

- **最终状态**：`PARTIAL`（因存在降级：1 个组件失败 + 4 个组件被 Select 排除；而复评已 PASS）。
- **Select**：扫描 8 → 选中 4（含 presubmit-scan.sh/.ps1）→ 排除 4（4 个 references md，记录覆盖风险）。
- **降级**：`presubmit-scan.ps1` 注入失败 → `failedComponents`，分析 3/4，标记覆盖缺口并继续。
- **评审-返工-复评**：round0 `CONDITIONAL_PASS`（注入）→ 返工（addressed 3 / stillOpen 4，补 2 风险 + 5 用例，**真的在隔离目录复现了 presubmit-scan 缺陷并补上行级证据**）→ round1 **真实 `PASS` 91 分**。返工 1 轮（上限 2）。
- **证据链**：12 条风险全部带 id + 证据（如 `RISK-001 → presubmit-scan.sh:54-68`，经 `grep -n` 二次核验）。
- **风险↔测试**：23 条用例**全部**带 `riskIds`。
- **诚实缺口**：`stillOpen`/`remainingGaps` 明确把 PowerShell 行为、非 GNU 环境可移植性、TOCTOU 并发标为 `static-analysis-only`（本机无 `pwsh`、未在 dash/BusyBox 实跑）——**不谎称已验证**。
- **`verified` 的口径**：本次部分风险标 `verificationStatus: verified`，指**返工期在隔离目录实测复现**（非受控 Verify 阶段，本次 `runVerification=false` 未开）；二者是两回事，schema 描述已注明。若需"Verify 阶段级"验证须显式开启并保留命令日志。
- **落盘**：12 个 artifact 写入时间戳目录，JSON 全部校验通过，未覆盖历史、未改目标。
- **成本观测**：本次约 64 万子代理 token、约 41 分钟（注入的返工轮 + 返工 agent 的真实复现实验拉高了耗时/成本）。说明：**质量模式（返工复现）显著增加成本**，生产中应按需开启、控制 maxComponents/effort。

> v1（旧 7 阶段版）的运行记录保留在 `evidence/demo-run-report.md` / `demo-run-raw.json` 作为历史对照；当前版本以 `evidence/runs/<时间戳>/` 为准。

## 6. 如何运行

```text
Workflow({ scriptPath: ".../.claude/workflows/analyze-repo.js", args: {
  target: "<目标目录，必填>",
  taskDescription: "<任务>",
  maxComponents: 4,                  // Select 后最多深入分析数
  outDir: "<输出根目录>",             // 缺省 "evidence/runs"（相对子代理 cwd）
  useCustomAgents: false,            // true 仅当从仓库根目录启动 Claude
  runVerification: false,            // 默认只读；开启才执行白名单命令
  maxReworkRounds: 2,                // 返工上限（防无限循环）
  forceFirstVerdict: null,           // 测试注入：演练返工链路（产物会标注为测试）
  injectComponentFailureIndex: null  // 测试注入：演练组件降级
}})
```
> 注意：本机 `args` 以 JSON 字符串到达脚本，脚本已自动 `JSON.parse`（见第 4 节）。

## 7. 与方法论的对应（自检）

| 方法论要求 | 本示例如何满足 | 证据 |
|---|---|---|
| 每阶段输入/输出/完成标准 | 见 §2 表 | 脚本各 phase + schema |
| 实现者不自评 | Review/复评均全新独立实例 | reviewHistory 两轮不同实例 |
| 不静默截断 | Select 显式记录被排除项 + log | selected-components.json |
| 有界循环防死循环 | rework ≤ maxReworkRounds | rework-history.json |
| 失败可降级、状态准确 | 必需/可降级分类 + status 枚举 | run-manifest.json finalStatus=PARTIAL |
| 证据可追踪 | 每条风险带 path/line 证据 | risks.json |
| 风险↔测试可追溯 | 用例带 riskIds + 追踪矩阵 | test-plan.json / final-report.md |
| 不把未验证当已验证 | static-analysis-only + remainingGaps | rework-history/run-manifest |
| 成本可控 | maxComponents/agentType/effort 可调；本次成本已记录 | §5 成本观测 |
| 可被他人复用 | scriptPath 运行 + args 参数化 + README | §6 / .claude/workflows/README.md |

> 一句话：升级版 `analyze-repo` 不再只是"能跑"，而是**带证据链、能自我返工、失败不撒谎**的分析流水线；这次运行真的复现了缺陷、补了行级证据、并诚实地把状态标成 PARTIAL。
