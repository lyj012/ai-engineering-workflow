# 可靠性与安全加固 · 逐项审计结论（2026-06-29）

> 基线：`main` HEAD `278d8b8`，self-check 绿。
> 方法：11 个评审项各由独立只读 agent 对当前代码逐行核对，引用真实 `file:行号`。**不轻信评审结论**——只修真问题，已修/不成立的给代码证据。
> 裁决：CONFIRMED（真实存在）/ PARTIALLY_VALID（部分成立）/ ALREADY_FIXED / NOT_VALID。

| 项 | 裁决 | 处置 | commit |
|---|---|---|---|
| P0.1 bin 递归删除危险路径 | CONFIRMED | ✅ 已修 | `c13df39` |
| P0.2 publish remoteUrl 凭据泄漏 | CONFIRMED | ✅ 已修 | `5ebd9f2` |
| P0.3 状态/磁盘 Manifest 一致性 | PARTIALLY_VALID | ✅ 修真窗口 | `5bb5381` |
| P1.4 Deliver 终态未统一 | CONFIRMED | ✅ 已修 | `ea69f5f` |
| P1.5 默认禁自动发布 WITH_OPEN_ITEMS | PARTIALLY_VALID | ⏸ 记残留（见 remaining-risks） | — |
| P1.6 publish 硬门禁 agent 自报 | CONFIRMED | ✅ 已修 | `1fc0c47` |
| P1.7 git-guard 可绕过/不可绕过表述 | PARTIALLY_VALID | ✅ 修正则+文档 | `7573a58` |
| P1.8 pushRemote 与 clone origin 不一致 | CONFIRMED | ✅ 已修 | `33eee7b` |
| P1.9 symlink/密钥扫描文档诚实性 | PARTIALLY_VALID | ✅ 修文档 | `e516075` |
| P2.10 跨平台测试矩阵 | PARTIALLY_VALID | ⏸ 非 bug，记残留 | — |
| P2.11 文档过期/矛盾 | CONFIRMED | ✅ 修文档 | `e516075` |

## 逐项证据与处置

### P0.1 — bin 递归删除危险路径 · CONFIRMED → 已修
`bin/sandbox-prepare.mjs:51` 删 `dest`、`bin/diff-from-sandbox.mjs:63`+`clearWorktree` 删 `--work` 前，五类守卫（src===dest / 父子重叠 / 根·home / realpath 后 symlink 重叠 / 逃逸）全缺，`force:true` 静默吞错。误以 `--src X --dest X` 调用会先 `rm -rf` 掉源仓库再 cpSync。**诚实排除**：`bin/persist-artifacts.mjs` 无任何 rmSync（只 mkdir/write）、对产物名有 `..`/绝对路径拦截，不在本项范围。
**修**：新增 `bin/safe-rm.mjs`（`assertSafeRemovable`：realpath + 双向重叠/根/home 拒绝），两处 rm 前 `guardOrExit`。测试 `scripts/safe-rm.test.mjs`（mkdtemp 哨兵）证明修复前删源、修复后退出 2。

### P0.2 — publish remoteUrl 凭据泄漏 · CONFIRMED → 已修
`remoteUrl`（args 原样或 `git remote get-url`，均可带 `user:token@`）无脱敏，流入 prompt(238/278/346)/日志(247)/clone 命令/final-delivery.json(389/396)/报告；`pushUrlSafe` 字段名给假象，dryRun/失败路径回填 raw。token 明文落 `evidence/publishes/` 归档。
**修**：`core/mask-remote-url.mjs`（parity 锁 + Codex handler）；内嵌凭据**早拒 PUBLISH_BLOCKED**（与设计铁律"凭据走环境"一致），全展示/日志/落盘点用 masked。

### P0.3 — 状态/磁盘 Manifest 一致性 · PARTIALLY_VALID → 修真窗口
真实窗口：deliver 降级（`deliver.ok===false`）只改内存 finalStatus、不回写磁盘 `delivery-manifest.json`、无独立回读；下游 publish 读磁盘 finalStatus → 可把 BLOCKED 当 DELIVERED 放行。不成立部分：publish 状态置于落盘后且远程已核验、auto-deliver 用返回值闸门，二者合理。
**修**：deliver 加独立回读（磁盘存在/可解析/finalStatus===引擎）+ 降级回写磁盘 + `persistVerification` 字段；`core/publish-status.mjs` 加 `deliveryPersistVerified` gate（false→BLOCKED，缺失→向后兼容）。

### P1.4 — Deliver 终态未统一 · CONFIRMED → 已修
`testsIntact===false`/`soft-stale`/`filesReconcile.issues` 只进 `manifest.openItems`、不在 `statusInput`；`filesReconcile` 更在终态计算之后才求值。三者为仅有遗留时 → `DELIVERED` 但 openItems 非空，自相矛盾。
**修**：filesReconcile 上移到终态前；三源纳入 `computeDeliverStatus.hasOpenItems`（core+inline parity）。不变式恢复：openItems 非空 ⇒ 非 DELIVERED。

### P1.6 — publish 硬门禁 agent 自报 · CONFIRMED → 已修
远程 SHA/文件集/禁入扫描/工作树 的布尔全由 RemoteVerify agent 自报；脚本丢弃 agent 已回报的 `remoteSha/remoteFiles` 原始材料（374），未做可得的 JS 复算。
**修**：`core/verify-remote-publish.mjs` 从原始材料复算 SHA 等值/文件集等值/禁入正则；终态取 **复算∧agent**。撒谎 agent（自报 true 但 raw 不符）被复算抓 false。

### P1.7 — git-guard 不可绕过性 · PARTIALLY_VALID → 修正则+文档
正则可被 `git -c/-C/--git-dir push --force`（hasPush 相邻门失效）、引号 refspec `"+main"`/`":branch"` 绕过；Codex 侧无运行时钩子；文档"硬安全层/guards every"夸大。
**修**：core/git-guard.mjs 重写为 tokenization（跳过全局选项 + 去引号）；文档去绝对措辞、明确 Claude 运行时 vs Codex 约定。"受控 git 入口(Codex)/默认分支自定义保护"记残留（见 remaining-risks）。

### P1.8 — pushRemote 与 clone origin 不一致 · CONFIRMED → 已修
clone 固定建 origin，但 Branch/Push/RemoteVerify 用可配置 `pushRemote`；`pushRemote='upstream'` 时副本无该 remote → 失败。
**修**：副本内三处 git 操作一律用字面量 `origin`，`pushRemote` 仅用于源仓库解析 URL。bare-remote 冒烟验证 PUBLISHED。

### P1.9 — symlink/密钥文档诚实性 · PARTIALLY_VALID → 修文档
唯一成立处：`bin/sandbox-prepare.mjs:3` 头注释写"out-of-tree symlinks"，代码 L62 实跳**所有** symlink（低估）。密钥侧文档无"保证无密钥"夸大（不成立）。
**修**：注释改"symlinks(ALL skipped)"+ 补"密钥按文件名模式、非内容扫描"；README 同步。

### P2.11 — 文档过期/矛盾 · CONFIRMED → 修文档
README 标沙箱去敏"✅ tested"，`final-residual-risks.md #18` 仍称"未跑、建议补 scripts/sandbox-cleanup.test.mjs"（该测试已存在为 `sandbox-prepare.test.mjs`）。头部日期早于内部章节。
**修**：#18 标已关闭、指向真实测试与脚本；头部日期更新。

## 未修项（含代码证据，不重复修改）

- **P1.5 默认禁自动发布 WITH_OPEN_ITEMS**（PARTIALLY_VALID）：auto-deliver 确实默认放行 WITH_OPEN_ITEMS（`auto-deliver.js:81-83/127-138`），但**高风险域已有人工闸门**（`publish-delivery.js:245-249` highRiskBlocked，命中支付/权限/密钥/认证/不可逆需 allowHighRiskAutoPublish）。缺的只是"开环项文字驱动的细粒度闸门"——窄缝、且会改变现有自动发布行为有误伤风险。经评估**记为残留**（见 remaining-risks），不在本次行为变更。
- **P2.10 跨平台测试矩阵**（PARTIALLY_VALID）：CI 仅 `ubuntu-latest`、win32 分支从未真跑（成立）；但 `codex/README.md:119-120` 等文档**已诚实标 designed/not-verified**（不构成虚假宣称）。属能力增强而非 bug，记为残留。
