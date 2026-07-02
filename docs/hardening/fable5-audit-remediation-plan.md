# fable5 全面审计整理与修复计划

> 来源：Claude fable5 对本 workflow 的全面审计文本。  
> 本文仅整理审计结论、最终决策与修复计划，不代表代码已修改。  
> 核对基线：`ai-engineering-workflow` 当前工作区文件。

## 一、最终决策

这次审计暴露的核心问题，是当验证异常、旧产物不兼容、运行环境能力不同的时候，workflow 应该严格到什么程度。决策如下：

| 问题 | 最终决定 |
|---|---|
| `testsIntact=false` | 新产物直接 `BLOCKED` |
| Claude 是否必须提供和 Codex 一样的强证据 | 不必须，按运行时能力分证据等级 |
| `scopeViolations` 和 `filesReconcileIssues` | 保持分开，但当前两类异常都 `BLOCKED` |
| 是否兼容旧产物 | 默认不兼容；仅显式 `--allow-legacy` 允许读取旧产物 |

对应规则：

```text
testsIntact=false
→ BLOCKED

新版本中 testsIntact 缺失
→ BLOCKED

scopeViolations 非空
→ BLOCKED

filesReconcileIssues 非空
→ BLOCKED

旧产物缺新字段
→ 默认验证失败
→ 只有显式 --allow-legacy 才允许读取
→ legacy 产物不能自动 Publish
```

## 二、总体判断

fable5 审计指出的核心问题不是普通实现缺陷，而是 workflow 的信任边界问题：

- 多 Agent、持久化验证、测试完整性、diff apply check、代码质量 P0 等关键门禁，部分仍依赖 Agent 在 manifest 中自报字段。
- `core/*` 里的纯函数门禁只能验证数据结构和字段组合，不能证明这些字段来自真实运行事实。
- 当前仓库已经有一批确定性脚本和 self-check 机制，但 Claude workflow 路径上仍存在“子代理转述脚本输出”的残余信任面。

调整后的判断：

- **第一优先级不是追求不可伪造的多 Agent 证明，而是关闭可落地的假成功路径**：真实 `git apply --check`、确定性 manifest 回读、`testsIntact` 强阻断、scope 对账强阻断、严格 validator。
- **Claude 与 Codex 不强制同证据等级**。Claude 可以是 `runtime-reported`，Codex 在能拿到真实线程或执行 ID 时使用 `runtime-traceable`。
- **F1、F6 不再按理论最高强度推进**。F1 先做证据等级和诚实报告，不急着设计复杂 harness 凭证；F6 则把决策落到新产物 `testsIntact` 缺失或为 false 即阻断。

## 三、审计发现整理

| ID | fable5 结论 | 当前核对判断 | 修订后优先级 | 处理方向 |
|---|---|---|---|---|
| F1 | `multiAgent.required` 与 `roles` 完全由 Agent 自填，不能证明真实 spawn | 基本成立。当前字段组合检查不能证明 spawn 事实来自 harness | P2 | 增加 `evidenceLevel`，先区分 `runtime-reported` / `runtime-traceable`，不急做复杂不可伪造凭证 |
| F2 | `persistVerification` 三轮读写由 Agent 执行，可跳过真实 I/O 直接声称成功 | 部分成立。已有 `persistVerification` 和 publish gate，但 Claude 路径仍由子代理执行/转述读写事实 | P0 | 增加非 Agent 的确定性持久化验证 CLI 或 runtime 检查 |
| F3 | schema 要求 `multiAgent.executionContext`，Claude workflow 可能不填导致合法交付失败 | 当前不完全成立。当前 schema 的 `multiAgent.required` 列表不包含 `executionContext`，但示例 manifest 有该字段 | P2 | 用测试锁定 schema 与 Claude/Codex 示例产物兼容性 |
| F4 | schema 用 `scopeViolations`，`computeDeliverStatus` 用 `filesReconcileIssues`，字段漂移 | 成立。validator 有 fallback，但 core 状态计算只读 `filesReconcileIssues` | P0 | 两字段保持分开，但任意非空均阻断 |
| F5 | `diffApplyCheckPassed` 由 Agent 报告，没有确定性 `git apply --check` | 部分成立。Claude prompt 要求子代理运行，但 `bin/diff-from-sandbox.mjs` 输出不含 apply-check 结果 | P0 | 把 apply-check 纳入 CLI 输出和 validator |
| F6 | `testsIntact` 设计存在但没有实际计算 | 当前已部分修过。已有 fingerprint/verify 脚本和 prompt 接线；残留是 schema optional 与 Claude 转述 | P0 | 新产物强制 `testsIntact`，缺失或 false 均 `BLOCKED` |
| F7 | `codeQuality.hasP0Failure` 由 Agent 主观判断，没有明确 P0 规则 | 基本成立。workflow 要求静态检查 severity，但 `codeQuality` 不在 delivery schema 中，P0 分类没有独立规则引擎 | P3 | 暂缓。等真实使用证明需要后，再做规则引擎 |

## 四、第一阶段：确定性加固

第一阶段只处理最直接影响交付可信度、且可以低复杂度落地的部分。

### 1. 真实 `git apply --check` 进入 CLI

目标：

- `diffApplyCheckPassed` 不再只是 Agent 字段，而是由确定性 `git apply --check` 产生。

计划：

1. 扩展 `bin/diff-from-sandbox.mjs`：
   - 生成 `changes.diff` 后，在干净 base copy 中执行 `git apply --check <changes.diff>`。
   - JSON 输出增加 `diffApplyCheckPassed`、`applyCheckExitCode`、`applyCheckOutputTail`。
   - `ok` 必须同时满足无 absolute leak、非空变更、apply-check 通过。
2. 扩展 `scripts/validate-delivery-artifacts.mjs`：
   - 对 delivered manifest，校验 `changes.diff` 存在、`filesChanged` 与 diff 内容一致。
   - 能拿到 base 时执行真实 apply-check；拿不到 base 时不能声称完成完整 apply 验证。
3. Claude workflow 的 GenerateDiff 阶段只消费 CLI 输出，不让子代理自行判断 `diffApplyCheckPassed`。

验收标准：

- malformed diff 必须让 `diffApplyCheckPassed=false`。
- 空 diff 必须 `ok=false`。
- manifest 声称 true 但实际 apply-check 失败，validator 必须失败。

### 2. Manifest 磁盘回读验证确定性化

目标：

- `persistVerification.ok=true` 必须来自真实文件系统读写检查，不再只来自子代理 JSON 回报。

计划：

1. 新增或扩展确定性 CLI，例如 `bin/verify-delivery-persist.mjs`：
   - 输入 delivery dir、期望 finalStatus、filesChanged、diffApplyCheckPassed。
   - 读取 `delivery-manifest.json`。
   - 验证文件存在、非空、JSON 可解析。
   - 验证磁盘上的 `finalStatus/filesChanged/diffApplyCheckPassed/openItems` 与引擎内存值一致。
   - 原子更新 `persistVerification.ok=true` 后再次读回确认。
2. Claude workflow 中不让 Agent 自己判断 readback 结果，只允许调用该 CLI 并转述 CLI JSON；能由父流程直接执行时优先父流程执行。
3. `scripts/validate-delivery-artifacts.mjs` 增加对 `persistVerification.ok` 的校验：
   - `DELIVERED` / `DELIVERED_WITH_OPEN_ITEMS` 必须为 true。
   - 缺失或 false 时 validator 失败。
4. 降级回写失败时，必须把状态标为不可发布，避免磁盘留存乐观 finalStatus。

验收标准：

- delivery dir 缺 manifest，验证失败。
- manifest finalStatus 与期望不一致，验证失败。
- `persistVerification.ok` 自填 true 但文件内容不一致，验证失败。

### 3. 新 Schema 强制 `testsIntact`

目标：

- 新产物中，测试完整性不是 open item，而是交付硬门禁。

当前基础：

- 已有 `bin/tests-fingerprint.mjs`。
- 已有 `bin/verify-tests.mjs`。
- `deliver-from-plan.js` prompt 已要求使用同一 fingerprint 脚本。

计划：

1. 将 materialize 阶段的 `testsFingerprint` 写入 manifest 的结构化字段，例如 `doneTrustEvidence.testsFingerprint`。
2. verify 阶段将复算结果写入 `independentVerify.testsFingerprintRecomputed`。
3. 新 schema 下 `independentVerify.testsIntact` 改为 required。
4. `computeDeliverStatus` 修改为：

```text
testsIntact=true
→ 继续判断是否可以 DELIVERED

testsIntact=false
→ BLOCKED

testsIntact 缺失
→ 新版本 BLOCKED
→ 旧版本只有显式 legacy 模式才允许读取
```

5. 对 Claude 路径保留残余说明：如果只能由子代理转述 CLI 输出，则不能声称“不可伪造”，只能声称“算法统一且可审计”。

验收标准：

- materialize 后改动 tests 文件，verify 必须得到 `testsIntact=false`。
- `testsIntact=false` 时必须 `BLOCKED`。
- 新 schema 下缺失 `testsIntact` 的 delivered manifest 验证失败。

### 4. Scope 两类异常都阻断

目标：

- `scopeViolations` 和 `filesReconcileIssues` 保持分开，但当前任意非空都 `BLOCKED`。

字段语义：

- `scopeViolations`：实现阶段实际改出 SCOPE 的文件。
- `filesReconcileIssues`：Verify、Diff、SCOPE 三方对账不一致。

计划：

1. schema 明确两个字段的含义。
2. `computeDeliverStatus` 输入同时接受两者。
3. 状态规则改为：

```text
scopeViolations 非空
→ BLOCKED

filesReconcileIssues 非空
→ BLOCKED
```

4. validator 不再用 fallback 掩盖字段漂移；字段缺失按 schema/version 处理。
5. 如果出现路径分隔符、大小写或路径标准化误差，应修标准化逻辑，而不是让不一致交付继续通过。

验收标准：

- 只有 `scopeViolations` 非空时，必须 `BLOCKED`。
- 只有 `filesReconcileIssues` 非空时，必须 `BLOCKED`。
- manifest 中 `finalStatus=DELIVERED` 且任一字段非空，validator 必须失败。

### 5. 严格 Validator 与显式 Legacy 模式

目标：

- 新 validator 默认严格，不为旧产物牺牲新规则可信度。

计划：

1. 默认命令使用最新严格规则：

```bash
node scripts/validate-delivery-artifacts.mjs <dir>
```

2. 旧产物只有显式参数才允许读取：

```bash
node scripts/validate-delivery-artifacts.mjs <dir> --allow-legacy
```

3. legacy 模式要求：
   - 明确标记 `legacyUnverified=true`。
   - 不能被认为是完全验证通过。
   - 不能直接进入 Publish。
   - 不能自动升级为 `DELIVERED`。
4. publish 阶段默认拒绝 legacy unverified 产物，除非未来另行设计明确人工授权参数。

验收标准：

- 旧 manifest 缺 `testsIntact`、`persistVerification.ok` 等新字段时，默认验证失败。
- `--allow-legacy` 可以读取并报告 legacy 状态，但不能输出“完全验证通过”。
- legacy 产物不能自动 publish。

## 五、第二阶段：证据等级

目标：

- 不强迫 Claude 和 Codex 达到完全相同的运行时证明等级。
- 让报告诚实表达“证据有多强”，而不是把 Claude 路径永久阻断。

计划：

1. 在 `multiAgent` 中增加 `evidenceLevel`：

```text
runtime-reported
```

表示：

- workflow 确实按流程调用了多个独立 Agent。
- 运行过程有结构化记录。
- 但没有运行时签发的不可伪造凭证。

```text
runtime-traceable
```

表示：

- 有真实 `threadId`、`executionId` 或 harness evidence。
- 可以追溯每个阶段对应的实际子 Agent。

2. 推荐规则：
   - Claude：允许 `runtime-reported`。
   - Codex：能取得真实线程 ID 时使用 `runtime-traceable`。
   - 两者都可以交付，但报告中必须如实写证据等级。
   - 禁止声称“密码学不可伪造”或“完全强证明”。
3. `computeMultiAgentGate` 继续检查 required stages、fallback、parent implementation、role 完成情况。
4. 复杂的 transcript hash、harness signature、不可伪造 spawn credential 暂不进入本阶段。

验收标准：

- Claude manifest 可以以 `runtime-reported` 通过多 Agent 门禁，但报告必须展示该等级。
- Codex manifest 如果有 thread/execution evidence，可以标为 `runtime-traceable`。
- 缺少 required stages、fallbackUsed=true、parentAgentImplemented=true 仍必须阻断。

## 六、第三阶段：暂缓项

以下内容不作为当前修复主线，等真实使用发现需求后再做。

### 1. CodeQuality P0 规则引擎

fable5 指出 `codeQuality.hasP0Failure` 仍带有 Agent 主观判断，这个方向成立，但当前不优先实现完整规则引擎。

后续如要做，再考虑：

- 在 schema 中加入 `codeQuality` 定义。
- 新增 `core/code-quality-rules.json`。
- 新增 `bin/classify-code-quality.mjs`。
- 让 Agent 只收集原始输出，不负责最终 P0 判定。

暂缓理由：

- 代码质量工具生态差异大。
- 过早做规则引擎容易复杂化。
- 当前第一阶段的确定性门禁对交付可信度提升更直接。

### 2. Transcript 哈希与 Harness Evidence

fable5 建议更强的 spawn 凭证、transcript 验证和 harness evidence。方向正确，但当前不作为第一批实现。

后续如要做，再考虑：

- `agent-spawn-log.json`
- transcript hash
- harness-issued execution id
- parent/child run id 关联
- `bin/validate-multi-agent-evidence.mjs`

暂缓理由：

- Claude Code 运行时未必暴露足够凭证。
- Codex 与 Claude 能力不同，强行统一会损坏 Claude 路径。
- 当前先用 `evidenceLevel` 诚实表达能力边界。

## 七、最终目标状态

一个新产物要获得 `DELIVERED`，至少应满足：

- 测试运行结果来自 `bin/verify-tests.mjs` 的真实 exit code。
- `testsIntact=true`，且字段存在。
- diff 可应用性来自真实 `git apply --check`。
- manifest 持久化来自真实磁盘读写回读。
- `scopeViolations` 为空。
- `filesReconcileIssues` 为空。
- schema、自检、示例产物三者保持一致。
- 多 Agent 证据等级被明确记录为 `runtime-reported` 或 `runtime-traceable`。

Agent 可以参与执行和解释，但不能再单独决定关键布尔门禁。Claude 与 Codex 可以有不同证据等级，但都必须诚实记录能力边界。
