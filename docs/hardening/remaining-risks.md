# 加固后残留风险与未决项（2026-06-29）

> 本次可靠性/安全加固关闭的项见 `confirmed-findings.md`。下列为**仍需注意、本次刻意未改或无法在此环境验证**的项，逐条给依据。原方法论层残留见 `evidence/final-residual-risks.md`。

## 一、刻意未做（评估后记残留，非遗漏）

1. **开环项内容驱动的发布闸门（P1.5）— 未实现**
   现状：`auto-deliver` 默认放行 `DELIVERED_WITH_OPEN_ITEMS`；硬安全域（支付/权限/密钥/认证/不可逆）**已由** `publish-delivery` 的 `highRiskBlocked` 人工闸门拦截（需 `allowHighRiskAutoPublish`）。缺的是"开环项**文字**里提到并发/正确性等、但未命中高风险关键词"这一窄缝的细粒度拦截。
   未做理由：它会改变现有自动发布行为、可能**误伤**以前能自动发布的交付（开环项文案不可靠地匹配关键词），收益窄。**建议**：若要做，走"仅当开环项命中明确安全/正确性关键词集才升级人工 + 显式 `allowOpenItemsAutoPublish` 放行"的最小版，并先补正反向测试（命中→停、纯文档类→仍自动）。

2. **Codex 侧 git 红线的运行时强制（P1.7 之一）— 未实现**
   Claude 侧的"受控 git 执行入口"即 `.claude/settings.json` 的 PreToolUse 钩子（对每条 Bash git 命令跑 `git-guard`，命中即 exit 2）。**Codex 侧无此钩子**，仅 `AGENTS.template.md`/`pipeline.md` 的"先过 git-guard"文档约定——若 agent 跳过该调用，没有任何东西物理阻止 git 执行。
   未做理由：需 Codex 适配器改动，且**本环境无 Codex 桌面版可验证**（按仓库纪律"未证不得宣称 runnable"）。已在 `core/git-guard.mjs` 头注释与 `codex/pipeline.md` 如实标注此差异。

3. **默认分支保护的"自定义保护模式"（P1.7 之一）— 未实现**
   远程默认分支保护**已在引擎层**由 `publish-delivery.js` 的 `PROTECTED=['main','master','release']` + `isProtectedBranchName` + `allowMainPush` 闸门实现（受保护分支需显式 opt-in）。在命令级 `git-guard` 再加"main 直推拦截"会与 `allowMainPush` 合法流冲突（guard 无 allowMainPush 上下文）。"自定义保护模式"作为配置增强属新功能，本次（暂停加新功能）未做。

## 二、本环境无法验证（标 pending）

4. **真实 GitHub 远程的 publish 端到端**：本次只在**本地一次性 target + 本地裸 remote（无凭据）**上跑通 publish（PUBLISHED_WITH_OPEN_ITEMS，见 `runtime-validation.md`）。真实 GitHub 的凭据/网络/服务端分支保护/受保护分支拒绝等路径未跑。fail-safe 已就位（`computePublishStatus` 对未达可发布态/分支不允许/push 失败/远程核验不全过分别短路 BLOCKED/UNVERIFIED）；缺的只是真机样本。

5. **跨平台（Windows/macOS）确定性脚本（P2.10）**：CI 仅 `ubuntu-latest`；`bin/`、`scripts/self-check.mjs` 的 win32 分支（cmd.exe 回退、Git-for-Windows bash 探测、反斜杠路径）从未在真实 Win/mac 上执行。文档已如实标 designed/not-verified。若要升为 verified，可在 CI 加 `strategy.matrix.os=[ubuntu, windows, macos]` 跑 self-check。

## 三、修复本身的边界（诚实标注）

6. **deliver 降级回写磁盘是 best-effort（P0.3）**：降级后由 `deliver-manifest-fix` 子代理回写磁盘 finalStatus+persistVerification.ok=false；若该回写子代理**本身**失败，磁盘可能仍留乐观值（与 plan 同样的残留）。多层兜底：publish 的 `deliveryPersistVerified` gate + 既有 `deliverableStatus` gate + 远程独立核验。

7. **凭据脱敏限 http(s) URL（P0.2）**：`maskRemoteUrl`/`hasEmbeddedCredentials` 处理 http(s) 的 userinfo；内嵌凭据 URL 被**早拒**（不进任何下游）。SSH 密钥认证（`git@host:`/`ssh://`）不是 URL 内凭据形式，按设计走环境，不在脱敏范围。

8. **禁入文件扫描是文件名级（P1.6 / P1.9）**：`findForbiddenFiles` 按文件名/扩展名模式（`.env`/`*.key`/`*.pem`/`id_rsa`/`*credential*`/`*secret*`/`AGENTS.md`/`settings.local.json` 等，保守过宽），**不读文件内容**——`config.json` 里的明文 `apiKey:` 不会被该扫描拦（与 `evidence/final-residual-risks.md` 第 3 条一致）。

9. **prompt 接线的运行时验证范围**：本次确定性核（core/* 纯函数、bin/* 脚本）有单测 + self-check parity 锁；引擎 prompt 接线（deliver 回读/回写、publish 复算/脱敏/origin）的**正常路径**已由 bare-remote 冒烟端到端验证；**异常路径**（如 deliver 落盘失败触发回写、embedded-cred 拒绝）由单测覆盖逻辑、未单独 e2e。
