# 全自动 AI 软件交付流水线：现状分析与改造方案

> 目标：把本项目（Claude Code Dynamic Workflow 方法论）改造成一条**全自动 AI 开发交付流水线**——
> 用户只需提供 **① 目标项目仓库 + ② 一段需求描述**，流水线自动完成：
> 需求理解 → 现有代码分析 → 实现方案设计 → 测试方案设计 → 编写测试代码 → 编写业务代码 →
> 独立评审 → 按评审自动修复 → 再次独立验证 → 创建 Git 分支 → Commit → Push → 返回最终交付结果（不建 PR）。
>
> 本文基于对仓库**真实代码逐行取证**（含 4 项对抗式验证）得出，是可指导后续开发的设计文档，不含大段实现代码。

---

## 0. 总判断（结论先行）

现有仓库是一套成熟的「需求 → 分析 → 方案 → 沙箱写码到测试全绿 → 出 diff」方法论 + 3 个引擎，它**有意止步于「diff + 人工 apply」**，既不碰原仓库、也不做任何 git 发布。本次目标相对它是**实质扩展 + 一处安全契约的反转**，而非加开关。

定调三句，决定**改造而非重写**：

1. **角色/分析/方案/测试/评审/验证能力已具备约 80%**，独立评审、先红后绿、就绪闸门、有界返工、降级语义、证据可溯源等核心纪律均已落地——**应大量复用**。
2. **真正缺三块**：① 自动 Git 发布阶段（建分支/commit/push + 远程核验）；② 把三引擎串成一键的**端到端编排器**；③ 让「修复」「验证」「测试 vs 实现边界」真正达到**职责独立**强度。
3. **架构本身合理、可扩展**，唯一必须**重设计**的是「交付执行模型」：现状是「剥离 `.git` 的沙箱 + 人工 apply」，与「自动 push」天然冲突，需改为「带 `.git` 的工作副本 / clone 后落地」。

> **被验证澄清的关键事实**：文档把「没做编排器」归因于「`workflow()` 仅一层嵌套」，但 `plan-from-requirement.js` / `deliver-from-plan.js` **内部都不调用 `workflow()`**（所有 `workflow(` 命中全在注释）。所以**父编排器用一层 `workflow()` 串它们完全不违反嵌套约束**——当年不做，是「松耦合 + 必须留人工闸门」的**设计取舍**，不是技术不可行。这为「做一键编排器」开了绿灯。

---

## 1. 当前仓库实际具备的完整流程

**三个业务引擎 + 两个自举元流程**，引擎之间靠**落盘目录手工松耦合**，不存在一键链路。

```text
[人工] 提供 target + requirement
  │
  ▼  Workflow 跑 plan-from-requirement.js
Preflight→Requirement→Triage→{Clarify | fast | full}
  └ full: Locate→Analyze(并行)→Gap→Plan→Risk→TestPlan→Review↔Rework(有界)→Report→Persist
  产物落 evidence/plans/<ts>/：plan.json / test-plan.json / risks.json / requirement.json
         / run-manifest.json(finalStatus + readinessForDev=ready|needs-clarification|blocked)
  │
  ▼  [人工] 把 planDir 抄给下游；[人工] 审 readiness
  ▼  Workflow 跑 deliver-from-plan.js（须 readinessForDev=ready 且 finalStatus∈{PASS,PARTIAL}）
Preflight(就绪闸门)→Scaffold(复制沙箱 + rm -rf .git + 删密钥 + 生成 coding-workflow.md)
  →MaterializeTests(物化 tests/+DONE，先红后绿可信核验)
  →Implement(沙箱内有界循环≤3，越 SCOPE/触红线即停)
  →Review(4 视角并行，实现者不自评)↔Fix(有界≤2，改完全新实例复审)
  →Verify(独立实例复跑 DONE+独立 diff)→Deliver(出 changes.diff + report + manifest)
  产物落 evidence/deliveries/<ts>/，最终状态 DELIVERED / DELIVERED_WITH_OPEN_ITEMS / BLOCKED / FAILED
  │
  ▼  [人工] 审 diff → [人工] 自行决定 git apply / commit（引擎绝不代劳）
```

- `analyze-repo.js`：与上面平行的**通用只读审计**，同源 schema/MODE/一致性校验，含可选受限 Verify（命令白名单由 JS 硬校验）。
- `wf-methodology-research.js` / `wf-docs-generation.js`：给**本仓库自己**造研究证据与文档的元流程，**不属于交付流水线**。
- 状态/产物传递真相：脚本体**无文件 IO**，落盘经 persist 子代理；引擎既**落盘**又**返回结构化对象**；跨引擎只通过 `planDir` 下的 JSON。

---

## 2. 当前已存在的角色与能力

`.claude/agents/*.md` 定义 **10 个角色**；但**默认未真正启用自定义 agentType**——三引擎默认 `useCustomAgents:false`，用内置 `general-purpose/Explore/Plan` + 注入「角色说明」等效复用，仅从本目录启动且显式开启时才用自定义 agentType。

| 现有角色 | 职责 | 独立性 | 对应理想 8 角色 |
|---|---|---|---|
| requirement-analyst | 需求拆解 + Triage 分级/澄清闸门 | 只读 | ✅ 分析（需求侧） |
| repo-analyst | 前置/理解/扫描/选组件/分析/汇总 | 只读，禁改码 | ✅ 分析（代码侧） |
| solution-architect | 实现方案（复用/修改/新增+影响面+步骤） | 只读，禁写码（opus） | ✅ 方案 |
| test-planner | 用例引用风险 id、覆盖缺口 | 只读为主 | ⚠️ 测试（只产**规格**，物化交给通用 worker） |
| risk-auditor | 一致性/状态/并发/权限/边界风险 | 只读 | （横切，保留） |
| independent-reviewer | 成果质量门禁，未参与产出，任何 P0→FAIL | 只读 | ✅ 评审 |
| verification-runner | 只跑白名单安全命令、记录退出码、不打分 | Read/Bash | ✅ 验证（弱：仅 analyze 用） |
| workflow-reviewer | 对「方法论交付物」做最终门禁（12 项必查） | 只读 | （评审本仓库自身，非业务） |
| doc-writer / methodology-researcher | 写文档 / 研究方法论 | — | （元流程，非交付） |
| **「实现工程师」「修复工程师」** | deliver 内联角色，非独立 agent 文件 | general-purpose 全工具 | ⚠️ 开发 / ⚠️ 修复（**二者同档 worker，不互相独立**） |

**结论**：分析/方案/评审已到位；开发是 deliver 内联 worker（无独立 agent 定义）；测试只产规格、物化交给通用 worker；验证在 deliver 已是独立实例但单视角；**修复角色不独立**；**发布角色完全不存在**。

---

## 3. 差距分析：现状 vs 理想全自动形态

| # | 差距 | 证据 | 严重度 |
|---|---|---|---|
| G1 | **无任何 git 发布能力**，且属安全契约；沙箱已 `rm -rf .git`，无法在沙箱内 commit/push | `deliver-from-plan.js:79,181,359-372`；`README:77` | 🔴 阻断 |
| G2 | **无一键端到端编排器**，靠 planDir 手工衔接 | 全部 `workflow(` 在注释；`docs/12:24` | 🔴 阻断 |
| G3 | **修复角色不独立于开发**：deliver Fixer 与 Implement 同为 general-purpose；plan rework=solution-architect=方案产出者 | `deliver-from-plan.js:272`、`plan-from-requirement.js:100-102` | 🟠 违背硬要求 |
| G4 | **测试 vs 实现边界有洞**：tests 在 `runDir/task-workflow/tests`（沙箱兄弟目录），不在 SCOPE、不在 diff；实现者可改弱测试，独立 Verify 复用**同一套**，diff 只比 targetRepo↔sandbox，察觉不到 | `deliver-from-plan.js:180-182,204,294-298,297/364` | 🟠 直击"防改测试迁就实现" |
| G5 | **独立 Verify 单视角**（Review 才多视角） | `deliver-from-plan.js:292-303` | 🟡 |
| G6 | **`reviewIncomplete` 只查末轮**（注释称"任一轮"强于代码） | `deliver-from-plan.js:288-289` | 🟡 |
| G7 | **高风险域（支付/权限/密钥/认证）有意只分析不编码**，命中即 BLOCKED——与"全自动 push"冲突 | `docs/12 §6.3`、`deliver-from-plan.js:235-236` | 🔴 需政策决策 |
| G8 | **跨引擎产物契约无 schema 兜底**：planDir 字段靠下游 agent 自行解析 | `deliver-from-plan.js:156-160` | 🟡 |
| G9 | **澄清/歧义是"halt 给人工"**，尚无"正常自动推进、仅关键歧义才暂停"的统一闸门贯穿全链 | `plan-from-requirement.js:354-364` | 🟡 |
| G10 | **plan 引擎缺 C4/C5/C17 完整性门**（只有单 reviewer + 一致性校验） | `plan-from-requirement.js:295-302` | 🟡 |

> 上述 G1/G2/G3/G4/G7 由 4 项对抗式验证确认；其中 G2 的"归因澄清"与 G4 的"洞真实存在"是改造的关键依据。

---

## 4. 可保留 / 复用的能力

**直接复用（几乎不改）**：
- 两大引擎主体 `plan-from-requirement.js` / `deliver-from-plan.js`，以及 `analyze-repo.js` 只读审计。
- **就绪闸门**（`finalStatus∈{PASS,PARTIAL} && readinessForDev=='ready'`，纯 JS 确定性）。
- **先红后绿 DONE 可信闸门**（新功能红+回归绿）——"测试有效性"基石，发布前同样依赖。
- **独立评审/验证模式**（实现者不自评、Fix 后全新实例复审、结果进 BLOCKED 门）。
- **Triage 分级 + 澄清闸门 + implementationAmbiguities 兜底**（语义级歧义强制澄清）——正是"仅关键歧义才暂停"的现成机制。

**复用为公共库（抽出共享，消除三引擎"同源块复制"漂移）**：
- 共享 `lib/`：schema 库、`callAgent` 重试包装、`MODE_PRESETS` 档位、`runConsistencyChecks` 确定性校验、安全命令白名单、`note/execLog` 日志与 manifest 落盘模式。
- `vendor/zhuliming-templates/`（已署名授权）作为"写码闭环"真相源——`.js` 只编排、流程进 markdown 的黄金法则保留。
- 证据/manifest/handoff/residual-verification 的产物组织方式。

---

## 5. 需调整 / 拆分 / 重设计的部分

| 项 | 现状 | 改造方向 |
|---|---|---|
| **交付执行模型** | 沙箱副本 + 剥 `.git` + 出 diff 人工 apply | **改为 git-aware**：保留"原仓库不动"，落地到**带 `.git` 的工作副本/clone**，使后续可在分支上 commit/push |
| **修复角色** | 与开发同档 worker | **拆为独立 `code-fixer`**，仅依据 Review 意见改，与 Implement 不同实例 |
| **测试边界** | tests 不设防 | **冻结+哈希校验**：物化后取哈希，Implement/Fix 改动 tests/ 即 BLOCKED；**Verify 从 `test-plan.json` 独立重物化对拍** |
| **独立 Verify** | 单 agent | 升级为**多视角并行**（功能真绿 / SCOPE 洁净 / 红绿可独立复现 / 提交物一致） |
| **`reviewIncomplete`** | 只查末轮 | 改为**逐轮累计 `anyRoundIncomplete`** |
| **跨引擎契约** | 无 schema 兜底 | 定义 `handoff` schema，交接处做**确定性形状校验 + 一致性核对** |
| **SAFETY/CMD_DENY/报告模板** | 全文"绝不 commit/push/merge" | **按发布边界改写**：从"全禁"改为"仅允许在隔离工作副本、经独立核验后、由专用发布阶段 commit/push；仍硬禁 force-push、删库删表" |

---

## 6. 需新增的核心能力

1. **发布引擎 `publish-delivery.js`**（新）：建分支→commit→push→远程核验。**独立于 deliver**，只消费"已验证的 diff/工作副本"，把最危险的 git 写操作收敛到一个可被独立核验的阶段。
2. **端到端编排器 `auto-deliver.js`**（新，薄）：输入 `{target, requirement, gitPolicy}` → 串 analyze(可选)→plan→deliver→publish，自动就绪闸门 + 歧义升级。用**一层 `workflow()`** 调两引擎（已验证可行）。
3. **独立 `code-fixer` 角色**（新 agent 文件 + 引擎接线）。
4. **测试防篡改护栏**（哈希冻结 + Verify 重物化对拍）。
5. **凭据/权限前置校验**：`git remote`、push 权限探测、是否裸 `init` 无 remote、分支是否已存在；缺权限即 BLOCKED 不硬闯。
6. **发布后远程核验器**：以 `git ls-remote`/`git log`/`git status` 的结构化结果做**确定性核对**，不信执行者自报。
7. **最终交付结果返回契约**（统一 `final-delivery.json`：状态、分支名、远程 commit SHA、推送 URL、改了哪些文件、开环项、回滚指引）。
8. **统一"自动推进 / 关键歧义升级"闸门**：把 `implementationAmbiguities`、方案分歧、红线、push 权限缺失统一为"升级人工"的唯一出口，其余全自动。

---

## 7. 各阶段衔接：状态 / 产物 / 失败信息的传递

每阶段三件套：**输入 / 产物 / 闸门**；失败一律**结构化 halt + 如实状态**，绝不伪造下游产物；歧义/红线/缺权限走**唯一的人工升级出口**。

| 阶段 | 输入 | 产物（落盘 + 返回） | 闸门 / 失败传递 |
|---|---|---|---|
| 0 Preflight(编排) | target, requirement, gitPolicy | repo 可读、remote/push 权限、分支可用性 | 缺权限/不可读→`BLOCKED_PRECHECK`，升级人工 |
| 1 Plan | requirement, target | `planDir/*`（含 readinessForDev） | `NEEDS_CLARIFICATION`→**升级人工**（唯一允许暂停）；`blocked/FAILED`→halt |
| 2 ReadinessGate | plan manifest | 放行判定 | 非 ready/非 PASS·PARTIAL→halt 回方案返工 |
| 3 Deliver | planDir, 工作副本 | 已验证 diff/工作树、`delivery-manifest` | 实现未真绿 / Verify 未过 / 复审不齐 / 触红线→`BLOCKED`，不发布 |
| 4 PublishPreflight | 工作副本, gitPolicy | 干净工作树确认、目标分支状态 | 工作树脏/冲突→停 |
| 5 Branch+Commit | 工作副本 | 分支、commit SHA、提交文件清单 | commit 失败→停，保留工作副本 |
| 6 Push | 分支 | 远程 ref、push URL | push 失败→停并给重试/凭据指引 |
| 7 RemoteVerify | 远程 ref | 确定性核对结果 | 远程与本地不一致→`PUBLISH_UNVERIFIED`，不报成功 |
| 8 Finalize | 全程历史 | `final-delivery.json` + 报告 | 汇总，不新增结论 |

**衔接机制**：① **双通道**——引擎既 persist 落盘、又向编排器返回对象，编排器把上游 `persisted.absOutDir` 直接作下游目录，消除手工抄目录；② **契约校验**——交接处先跑确定性 `handoff` 校验（关键字段存在、`affected.files` 非空、`doneCommand` 可解析、`readinessForDev` 合法）；③ **失败语义**——复用现有枚举并扩展 `PUBLISHED / PUBLISH_BLOCKED / PUBLISH_UNVERIFIED`，`openItems` 全程透传、最终汇总，不静默吞掉。

---

## 8. 自动 Git 分支 / Commit / Push 设计

**执行模型（确认采用：clone → 应用已验证 diff → 落地分支 → push）**，最大化复用 deliver 现有"出已验证 diff"的能力，把 git 写操作隔离进新引擎独立核验，天然满足"原仓库不动"：

1. **解析远程**：从用户给的 target（本地仓库路径或 remote URL）取 origin；裸 `init`/无 remote → 升级人工（无处可推）。
2. **隔离工作副本**：`git clone <remote>`（或 `git clone --local <localRepo>` 再设 origin）到发布工作目录，保留完整 `.git`，**原 target 始终不被写**。
3. **落地分支**：在目标分支上落地变更（分支策略见下）。
4. **落地变更**：`git apply` 已通过独立 Verify 的 diff；只允许命中 `plan.affected.files`。
5. **Commit**：以用户身份提交（`user.name` / `user.email`）；消息含需求摘要 + 方案要点 + 开环项；**不混入** `.claude/`、`AGENTS.md`、`CLAUDE.md`、`*.yml`、密钥（沿用 `.gitignore`/全局规则 9/15）。
6. **Push**：`git push origin <分支>`；**硬禁** `push -f`/`--force`；**不建 PR**。
7. **凭据**：走环境已配置的 SSH/token；**脚本绝不内联密钥**；无凭据→`PUBLISH_BLOCKED` 给出"用 `! git push ...` 自行登录"指引。

**安全护栏（写进 PreToolUse Hook / permissions.deny，而非仅 prompt——因为只有 Hook/permissions 才是硬强制）**：拒绝 `git push --force*`、拒绝 `git reset --hard origin/*`、拒绝删远程分支。

> **本次落地确认的策略**（用户拍板）：
> - 交付执行模型 = **Clone + 应用已验证 diff + push**（推荐项）。
> - 高风险域（支付/权限/密钥/认证）**仍强制人工闸门，不自动 push**（保留全局规则 16）。
> - 流水线默认分支策略 = **新特性分支 `ai/<需求>-<时间戳>` + 禁 force + 禁直接 main + 不建 PR**；当用户对**特定发布**明确要求"直接推 main、不建分支、不建 PR"时，按其指令以 `git push origin main`（fast-forward，绝不 force）执行。

---

## 9. 如何保证发布结果 / 提交文件 / 远程状态准确可靠

**核心原则与现有 C4 一致：不信执行者自报，由独立只读实例取客观事实，JS 做确定性判定。** 发布后由 `RemoteVerify` 核对：

- **提交内容一致**：`git show --stat <SHA>` 实际改动文件集合 **==** deliver 独立 Verify 认定的 `changedFilesVerified`，**多一个少一个都判失败**。
- **无越界/无夹带**：实际提交文件 ⊆ `plan.affected.files`；无 `.claude/`、`*.yml`、密钥、`.env`（与 `.gitignore` 双重比对）。
- **远程确实有该分支与该 commit**：`git ls-remote --heads origin <分支>` 返回 SHA **==** 本地 `git rev-parse HEAD`。
- **工作树干净、HEAD 对齐**：`git status --porcelain` 为空；本地与 `origin/<分支>` 无分叉。
- **可回滚指引**：记录 push 前分支 SHA、分支名、远程 ref；提供回滚命令（不自动执行）。
- **任何一项不过 → `PUBLISH_UNVERIFIED`，绝不写"已发布成功"**。

---

## 10. 推荐整体架构、执行顺序与分阶段改造计划

### 10.1 目标架构

```text
auto-deliver.js  (薄编排器：一层 workflow() 串两引擎 + 内联 publish 阶段)
├─ [复用] plan-from-requirement.js      → planDir (readiness)
│        角色: requirement-analyst / repo-analyst / solution-architect /
│             risk-auditor / test-planner / independent-reviewer
├─ [复用+加固] deliver-from-plan.js      → 已验证 diff / 工作树
│        角色: developer(实现) | ★code-fixer(新增独立) | 多视角 reviewer | ★多视角 verifier
│        护栏: ★测试哈希冻结 + ★Verify 重物化对拍
├─ [新增] publish-delivery.js           → 分支/commit/push/远程核验
│        角色: ★release-manager(执行 git) | ★publish-verifier(独立只读核对)
└─ 贯穿: 就绪闸门 · handoff schema 校验 · 唯一人工升级出口 · openItems 透传 · final-delivery.json
强制层: PreToolUse Hook / permissions.deny（push 红线）
```

**角色独立性映射（满足硬约束）**：分析≠方案≠测试规格≠开发≠**修复(新独立)**≠评审≠**验证(多视角独立)**≠**发布(独立)**；评审/验证/发布核验**均为未参与产出的全新 agent 实例**；测试由 test-planner 定规格、MaterializeTests 物化并**冻结**，开发/修复**不能改测试**（违者 BLOCKED）。

### 10.2 执行顺序（一句需求驱动，全自动）

`Preflight → Plan →(就绪闸门)→ Deliver(物化+冻结测试 → 实现 → 多视角评审 ↔ 独立修复 → 多视角独立验证) →(交付闸门)→ PublishPreflight → Branch → Commit → Push → RemoteVerify → Finalize`；**仅** `NEEDS_CLARIFICATION` / 方案红线 / 缺 push 权限 三种情况暂停升级人工。

### 10.3 分阶段改造计划（每阶段独立可交付、可验证）

- **阶段 0｜抽公共库 + 消同源漂移**（低风险）：schema/callAgent/MODE/一致性校验/安全白名单抽到 `lib/`。
- **阶段 1｜deliver 加固**（中风险，直击诉求）：新增独立 `code-fixer`；测试哈希冻结 + Verify 重物化对拍（堵 G4）；Verify 升多视角；`reviewIncomplete` 改逐轮累计。
- **阶段 2｜发布引擎 `publish-delivery.js`**（高风险，**独立先行、单独验证**）：clone→分支→commit→push→远程核验；**先在自建临时 git 仓库端到端实跑**（填补"真带 .git 仓库未实测"缺口）。
- **阶段 3｜编排器 `auto-deliver.js`**（中风险）：一层 `workflow()` 串 plan→deliver→publish，自动就绪闸门 + handoff 校验 + 唯一升级出口 + `final-delivery.json`。
- **阶段 4｜安全策略与凭据**：`gitPolicy`（分支前缀、禁 push 目标、高风险域是否自动）+ 凭据前置校验 + 改写 SAFETY/CMD_DENY/报告模板/CLAUDE.md 边界。
- **阶段 5｜端到端演练与文档**：真实小仓库 lite/standard/deep 三档 dry-run，更新 docs，沉淀 evidence。

---

## 附：关键设计取舍速查

| 取舍 | 选择 | 理由 |
|---|---|---|
| 编排方式 | 薄父编排器 + 一层 `workflow()` 串现有两引擎 | 已验证不违反嵌套约束；最大化复用、保留人工闸门可控 |
| 交付落地 | Clone + 应用已验证 diff + push | 原仓库不动；git 写操作隔离、可独立核验；复用 deliver 的 diff |
| 测试边界 | 物化后哈希冻结 + Verify 独立重物化对拍 | 杜绝"改测试迁就实现"，满足测试/实现职责边界 |
| 修复职责 | 独立 `code-fixer`，不复用实现者实例 | 满足"修复独立于开发" |
| 高风险域 | 仍人工闸门，不自动 push | 遵全局规则 16，安全纵深不削减 |
| 发布红线 | force/改 main/删远程分支 → Hook 硬拦 | 仅 Hook/permissions 才是硬强制，prompt 不可靠 |
