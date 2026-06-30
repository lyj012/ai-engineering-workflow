# 12 桥接工作流：plan-from-requirement → 编码到测试全绿（端到端闭环）

> 脚本：`.claude/workflows/deliver-from-plan.js`　产物：`evidence/deliveries/<时间戳>/`
> 上游：`plan-from-requirement`（docs/11，产方案，只读不写码）。
> 下游真相源：朱立明「写码闭环」模板 `vendor/zhuliming-templates/`（见其 `ATTRIBUTION.md`，已授权署名复用）。
>
> 本文是**桥接设计的唯一真相源**：就绪闸门、字段映射、阶段契约、审查视角都以本文为准。
> 运行时 `deliver-from-plan.js` **只编排**；流程细节由本文 + 运行时生成的 `coding-workflow.md` 承载，脚本不内联。

---

## 1. 定位：补上"实现/测试"这一段

`plan-from-requirement` 刻意止于**可执行方案**（目标说明 §五把"实现/测试"列为预留阶段）。
本桥接把方案接到一个**写码闭环**上，形成：

```
客户需求 →[plan-from-requirement]→ final-plan.md / plan.json / test-plan.json
        → 就绪闸门(readinessForDev=ready) →[deliver-from-plan]→ 沙箱代码 + 测试全绿 + diff
        → 人工审 diff → 决定是否落地到真实仓库（桥接不替你 commit/merge）
```

设计取舍（与负责人确认通过）：
- **松耦合**：桥接读已落盘的 plan 目录（`planDir`），**单独使用桥接时**不用 `workflow()` 把两个引擎串成一个，方案→编码之间保留就绪/人工闸门。
  > **两条路径并存（消除"文档要求人工闸门 vs auto-deliver 自动跨闸门"的表观矛盾）**：上述"必留人工闸门"是**单独使用各引擎**时的取舍；端到端编排器 `auto-deliver.js` 是有意的另一条路径——用**一层** `workflow()` 串 plan→deliver→publish（三子引擎自身都不再调用 `workflow()`，故一层嵌套合法），并把"人工审"替换为**引擎内确定性闸门**：`NEEDS_CLARIFICATION` / 高风险域（支付·权限·密钥·认证·不可逆）/ 缺推送权限会**自动短路停机交人工**，其余自动推进。即"单独桥接=保留人工闸门"与"auto-deliver=安全契约反转（自动跨闸门但红线硬停）"并存，详见 `.claude/workflows/README.md`「完整链路」与 `auto-deliver.js`。
- **`.js` 只编排，流程进 markdown 真相源**：采纳朱立明黄金法则，避开"prompt 细节内联、双脚本各自复制"反模式（docs/07）。
- **写码只进沙箱副本，绝不动原仓库、绝不 commit/push/merge**：延续本项目铁律"原 Skill 零修改"与全局规则 6/16。

---

## 2. 接口契约（plan 产物 → 编码任务输入）

桥接从 `planDir/` 读以下产物，字段级映射到朱立明模板（`build-workflow.md`）的输入：

| plan 产物字段 | 映射到 coding-workflow.md | 用途 |
|---|---|---|
| `run-manifest.finalStatus` / `readinessForDev` | —（只读，不进模板） | **就绪闸门**判据 |
| `requirement.json.goal` / `coreOutcome` | §1 GOAL | 编码目标 |
| `plan.json.steps[]`（order/action/touches） | §4 LOOP 的 `state/todo.md` 子单元 | 活已拆好，直接 seed todo |
| `plan.json.modify[]` / `add[]` + `affected.files` | §2 SCOPE（只许改这些）+ §2 CONTRACT | **改动边界**（越界即停） |
| `plan.json.reuse[]` | §2 CONTRACT / §4 提示 | 复用点、贴合现有写法 |
| `test-plan.json.cases[]`（scenario/steps/expected/verificationType） | → 物化成 `tests/` | DONE 的可执行测试 |
| `test-plan.json.acceptanceCriteria[]` | §8 验收（闭环不了的转开环清单） | 验收 |
| `risks.json` + `rollback` | §3 红线/中断条件 | 安全护栏 |
| `requirement.json.openQuestions` | §8 人工核对点 | 实现前需拍板项 |

---

## 3. 就绪闸门（确定性，纯 JS 判定）

进入编码前，对 `run-manifest.json` 做确定性判定：

```
放行  ⇔  finalStatus ∈ {PASS, PARTIAL}  且  readinessForDev == 'ready'
```

- `NEEDS_CLARIFICATION` / `blocked` / `FAILED` / `FAILED_WITH_FINDINGS` → **halt，不写码**，提示回到需求澄清或方案返工。
- `PARTIAL` 允许放行（方案可用但有降级），但其 `remainingGaps` / `openQuestions` 会带入编码阶段作为人工核对点。

> 闸门是**桥接的第一道硬门**：方案没到 `ready` 绝不进编码。
>
> **责任边界（C1）**：`ready` 仅表示"方案完整到可着手"，**不代表无语义级待澄清项**——带入的 `openItems` 进编码前仍须人工拍板。更关键的是上游 `plan-from-requirement` 已加确定性兜底：凡【会实质改变实现行为/接口/数据格式/语义】的歧义会被 triage 归入 `implementationAmbiguities`，非空即**强制走澄清闸门、不出方案**（见 docs/11）。即"语义级歧义未拍板"应在上游就被拦下，不会以 `ready` 静默流入编码。

---

## 4. 测试物化（命门）：把"测试规格"变成"可信的 DONE 命令"

plan 只给测试**规格**（scenario/steps/expected），桥接必须把它物化成**可运行的 `tests/` + 一条 DONE 命令**（如 `bash tests/run_verify.sh` → exit 0 / `ALL PASSED`）。否则闭环退化成开环，朱立明那套的核心价值（自动跑到全绿）就丢了。

### 4.1 自动验 vs 人工核对（不静默截断）
按 `verificationType` 分流：
- **可自动验**（命令/退出码/输出可判）→ 进 `tests/`，纳入 DONE。
- **只能人判**（无可用运行环境、需主观判断，如本机无 `pwsh` 的 `.ps1`）→ 进**开环人工核对清单**，并用 `log()` 显式标注"未自动覆盖"，绝不假装覆盖（docs/07 反模式）。

### 4.2 DONE 可信闸门（"先红后绿"，确定性核验）
DONE 写出后、写码前，必须证明它**不是水脚本也不是废脚本**：
- **新功能测试** 在**当前（未实现）沙箱**上跑 → **必须 FAIL（红）**：证明 DONE 能识别"没做完"。
- **回归/既有行为测试** 在当前沙箱上跑 → **必须 PASS（绿）**：证明 DONE 会正确判过，且锁住"不破坏既有语义"（如本例的退出码语义）。
- 二者同时成立 ⇒ `DONE 可信`，放行编码；否则 **halt**，降级为开环清单并标红（不蒙着写码）。
- **可筛选 / 可定向契约（让"先红后绿"能被独立复现）**：DONE 入口必须支持 `--red`（只跑新功能测试）/ `--regression`（只跑回归测试）两个开关，并接受可选的【目标目录】参数（默认沙箱）。MaterializeTests 据此回报 `redCommand` / `regressionCommand`，使独立 `Verify`（§5）能用同一套测试在**原仓库的全新副本**上独立复现"新功能红 / 回归绿"，而非只信物化阶段自报——这是 `DELIVERED`（而非长期停在 `DELIVERED_WITH_OPEN_ITEMS`）可达的前提。

> 这一步同时实现了朱立明 `build-prompt.md` 阶段一的"★确认点：证明验证脚本可信"，但用"新功能红/回归绿"代替"塞已知正确产物"，无需合成参考实现、更稳。
>
> **"确定性"的真实含义（C4）**：Workflow 脚本体本身无 IO（不能自己跑命令/读 diff），所以"确定性"指**判定逻辑是纯 JS 确定的**，其**输入真伪由一个独立 `Verify` 子代理复跑背书**（见 §5 Verify 阶段）——物化阶段自报的"先红后绿"、实现阶段自报的"DONE 全绿 / 只动 SCOPE"，都会被一个**未参与实现的独立实例亲手复跑、复算 diff** 核对，最终状态以独立验证为准，不只信实现者自报。

---

## 5. 阶段设计（每阶段：输入 / 输出 / 完成标准）

`meta.phases` 8 个，与 `phase()` 调用逐字一致：

| 阶段 | 输入 | 输出 | 完成标准 / 闸门 | 控制流 |
|---|---|---|---|---|
| **Preflight** | planDir, targetRepo | gate 字段（finalStatus/readiness/affected/target） | 就绪闸门通过；否则 halt（§3） | 1 agent |
| **Scaffold** | plan 全套 + vendored 模板 | sandbox 副本、`task-workflow/{input,output,tests,state}`、**填好的 `coding-workflow.md`**、`state/todo.md`(来自 steps) | 占位符全实例化；SCOPE=affected.files；原仓库零写入 | 1 agent |
| **MaterializeTests** | test-plan.json + plan + sandbox | `tests/` + DONE 命令 + 开环清单 | DONE 通过"先红后绿"核验（§4.2）；否则 halt/降级 | 1 agent + 纯 JS 判定 |
| **Implement** | coding-workflow.md + todo + SCOPE | 沙箱内改动 + `state/progress.md` | DONE 全绿；越界改 SCOPE 外 / 触红线 → 立即停；≤3 轮不绿 → 交人 | 有界循环 ≤3，串行，重试续上一轮 |
| **Review** | 沙箱产物 + plan | 各视角 findings+verdict | 收齐全部独立视角（实现者不自评）；**视角不齐即判复审缺失**（C17） | `parallel` 栅栏 |
| **Fix** | needs-work findings | 修复后沙箱 | needs-work 清零且 **DONE 重跑仍绿**；**Fix 后必由全新实例重新复审**（C5），非修复者自评 | Review↔Fix 有界循环 ≤2 |
| **Verify** | 沙箱最终态 + 原仓库 | 独立复跑 DONE 退出码 + 独立 diff | **未参与实现的独立实例**亲手复跑 DONE、复现先红后绿、复算 diff 只动 SCOPE；最终状态以它为准（C4） | 1 独立 agent |
| **Deliver** | 沙箱 + 全程历史（含 fixHistory / 独立验证） | `changes.diff` / `delivery-report.md` / `delivery-manifest.json` / `state/` | 落 `evidence/deliveries/<ts>/`，含开环遗留项与红线停点 | 1 agent 落盘 |

> 控制流符合 workflow-designer 主干：默认串行，仅 Review 用 `parallel` 栅栏（正当：Fix 要全量意见）；循环均有上限与可观测退出。

### 5.5 审查视角（写入生成的 coding-workflow.md §7.1，运行时由此引用）
独立、只读、各给 `findings + verdict(ok|needs-work)`：
- `correctness`：对照 plan / 验收，改动是否真满足需求、边界是否出错。
- `robustness`：异常/边界/坏输入是否崩溃或被吞。
- `scope-conformance`：**是否只改了 plan.affected.files、是否符合 plan.modify 的 why**（防越界、防夹带）。
- `risk-coverage`：risks.json 的高危项是否被测试真覆盖、退出码等既有语义是否被破坏。

---

## 6. 安全闸门（写真实代码这块最重要）

1. **沙箱隔离**：只在 `evidence/deliveries/<ts>/sandbox/`（targetRepo 的副本）里写，**原仓库零修改**（mtime 不变，延续项目铁律）。
2. **不 commit / push / merge**：产物是 `changes.diff`（patch），交人工审后自行决定落地（规则 6/16）。
3. **红线即停（高风险域允许沙箱实现，真实副作用与发布须闸门，C7）**：上游可分析**全部**高风险域；交付阶段允许在净化沙箱内按 SCOPE 编写支付 / 权限 / 认证 / 状态机 / 数据迁移 / 文件 / 回调 / 定时任务 / 金额计算等领域代码，但**禁止执行真实危险副作用**：真实支付、真实权限变更、真实认证操作、删库、不可逆迁移、读取或写入真实密钥等命中即 BLOCKED 交人工。发布阶段继续由 `publish-delivery` 的高风险人工闸门控制，未显式复核授权不得自动发布。SCOPE 外改动、需求自相矛盾同样即停。
4. **沙箱去敏感（C9）**：复制目标仓库后**立即删除沙箱内 `.git` 与 `.env`/`*.key`/`*.pem` 等密钥证书**，仅留源码；`evidence/` 下运行目录已 `.gitignore`，杜绝客户机密被长期留存或误提交。
5. **多道硬门**：**就绪闸门**（§3）+ **DONE 可信闸门**（§4.2）+ **独立验证**（§5 Verify）+ **复审完整性**——前置与收尾门都过，才给交付态。

---

## 7. 最终状态枚举（沿用本项目引擎风格）

| 状态 | 含义 |
|---|---|
| `DELIVERED` | **独立 Verify 确认** DONE 真绿 + 只动 SCOPE + 复审完整且无阻断 + 无开环遗留 |
| `DELIVERED_WITH_OPEN_ITEMS` | 同上（独立验证已过）但有开环人工核对项（如本机无 pwsh 的 `.ps1`）或带入的待拍板 openItems |
| `BLOCKED` | 就绪闸门 / DONE 可信闸门 / **独立验证未过 / 复审视角不齐** 挡下；不给乐观状态（C17） |
| `FAILED` | 必需阶段失败、流程提前终止 |

---

## 8. 运行方式

```text
Workflow({ scriptPath: ".../.claude/workflows/deliver-from-plan.js", args: {
  planDir: "/abs/.../evidence/plans/<ts>",   // 上游方案目录（必填，须 readinessForDev=ready）
  targetRepo: "/abs/.../目标仓库",                      // 要落地的真实仓库（被复制进沙箱，原仓库不被写）
  outDir: "/abs/.../evidence/deliveries",     // 缺省 evidence/deliveries
  maxImplRounds: 3, maxFixRounds: 2                     // 可省，有界循环上限
}})
```

> 桥接**只在沙箱产出代码 + diff**。是否把 diff 应用到真实仓库、是否 commit，**由人工决定**，桥接不代劳。

---

## 9. 边界与已知限制（如实记录）

1. **方案质量决定上限**：plan 烂则码烂——但 plan 已过独立审查，有兜底。
2. **开环尾巴关不掉**：人工测试、无 `pwsh` 的 `.ps1` 无法自动验 → 落为人工核对项（显式 `log`），最终多为 `DELIVERED_WITH_OPEN_ITEMS`。
3. **复用同事成果**：`vendor/zhuliming-templates/` 已署名授权；GitHub 公开前再确认。
4. **成本**：编码循环烧 token → 阶段有界；必要时加 `budget` 守门。
5. **桥接不替你决策**：方案分歧/红线 → 停下来问人。
6. **沙箱去敏感的验证范围**：复制后删 `.git`/`.env`/`*.key`/`*.pem` 的逻辑**无条件执行、读码正确**，但在"本身不含 `.git`/密钥"的目标仓库上是**空操作**——尚未在"真带 `.git` 的客户仓库"上实跑验证过。属已知验证缺口、非缺陷（C9 修复在真带 `.git` 的仓库上才会被真正考验）。
