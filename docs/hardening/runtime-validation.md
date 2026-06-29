# 运行时验证记录（脱敏）

> 集中记录已真实跑过的验证。**全部使用合成靶子**（仓库自带 `examples/minimal-target`、Spring Initializr 脚手架、一次性本地仓库 + 本地裸 remote）；**无任何客户源码、无真实凭据、无真实生产仓库**。绝对临时路径以 `<tmp>` 占位。

## A. 确定性门（每次提交都跑，恒绿）

- `node scripts/self-check.mjs` → **PASS**（路径/密钥扫描、Workflow JS 语法、全部 inline↔core parity 锁、示例 schema/测试/diff apply 等）。
- `node --test scripts/` → **22 测试文件全过 / 0 失败**。加固期间从 19 增至 22（新增 `safe-rm`、`mask-remote-url`、`verify-remote-publish`），并扩充了 `deliver-status`(36 例)、`publish-status`(20 例)、`git-guard`(39 例) 等向量。
- 关键单测（先红后绿）：`safe-rm`（删源场景退出 2）、`mask-remote-url`（脱敏幂等）、`publish-status`（deliveryPersistVerified=false→BLOCKED）、`deliver-status`（testsIntact/soft-stale/filesReconcile→WITH_OPEN_ITEMS）、`verify-remote-publish`（撒谎 agent 被复算抓 false）、`git-guard`（全局选项/引号 refspec 绕过被拦）。

## B. publish 端到端冒烟（本次加固，本地裸 remote）

- 靶子：`examples/minimal-target` 的 shell 内容 → 一次性 `target` 仓库（`origin` 指向本地裸仓 `canonical.git`，分支 `main`）；手造交付目录（`changes.diff` 给 `app.sh` 追加一行无害注释 + `delivery-manifest.json`，`finalStatus=DELIVERED_WITH_OPEN_ITEMS`、`persistVerification.ok=true`、`diffApplyCheckPassed=true`）。
- 运行：`publish-delivery`（`branchMode=new-branch`，无凭据，push 到本地 `file` 裸 remote）。
- 结果：**`PUBLISHED_WITH_OPEN_ITEMS`**。链路 Preflight→Clone→Branch(`main`→`ai/…`)→Apply(`app.sh`)→Commit→Push→RemoteVerify→Finalize 全过。
- 独立复核（非信引擎自报）：
  - 裸仓 `canonical.git` 真含 `refs/heads/ai/e2e-smoke-…@81c7123`，顶 commit 内容确为 `app.sh +2`；
  - 发布产物（`final-delivery.json`/`publish-report.md`/`execution-log.md`）grep **无任何 token/凭据**（`ghp_`/`github_pat_`/`://user:pass@` 零命中）；
  - `final-delivery.json` 含 `remoteVerifyRecomputed`（四项 true，脚本复算结果留痕）；
  - `target` 原仓库 **0 工作区改动、1 提交**（隔离性：publish 只在 clone 副本里操作）。
- 据此**端到端验证了**加固接线：P0.2（产物零凭据泄漏）/ P0.3（`deliveryPersistVerified` 闸门被消费）/ P1.6（`remoteVerifyRecomputed` 复算跑通并作为终态依据）/ P1.8（clone 副本 `origin` 接线，push/ls-remote 到 origin 成功）。

## C. deliver 引擎在真实 Java 上的既有验证（加固前，作为运行基线）

- 三个 Spring Boot（Maven Wrapper，JDK17）样本经 `plan-from-requirement → deliver-from-plan` 真跑：
  - 简单端点（`GET /greeting`）→ `DELIVERED_WITH_OPEN_ITEMS`；
  - 中等分层（内存 Task 管理，Controller/Service/异常处理，standard 档 6 视角）→ `DELIVERED_WITH_OPEN_ITEMS`；
  - 含陷阱的中等需求（标题唯一性，故意诱导竞态）→ `DELIVERED_WITH_OPEN_ITEMS`，并**触发了独立 Fix 返工**（risk-coverage 视角补测试）。
- 每例均独立复核：把交付 diff 应用到干净副本 `./mvnw test` → BUILD SUCCESS。证明 deliver 链路（CodeQuality 真跑 `mvn compile`、JUnit 先红后绿、`tests-fingerprint`/`verify-tests` 在 Maven 语境工作、diff 仅源文件）在真实 Java/Maven 下可用。
- bash `examples/minimal-target` 样本：`deliver-from-plan` → `DELIVERED`，diff apply + 测试绿。

## D. 未跑（见 remaining-risks.md）

真实 GitHub 远程的 publish e2e、Windows/macOS 确定性脚本、deliver 落盘失败触发回写的异常路径、embedded-cred 拒绝的 e2e（逻辑已单测）—— 均未在本环境单独真跑。
