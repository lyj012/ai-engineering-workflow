# 最终遗留风险与残留未决项

> 最近更新：2026-06-29（覆盖 06-26 之后的能力扩展与 06-29 可靠性/安全加固）。早期更新专为公开仓库状态对齐：路径已改为仓库相对表达，公开 README、示例、自检脚本与 CI 配置已补齐；历史运行证据仍按“已验证/未验证/人工开环”区分。
>
> 现状：方法论核心（需求→方案→风险→拆解→验收→记录→纠偏→多流程协作→独立审查→闭环）已 PASS；「方案→编码到测试全绿」桥接经独立评审 PASS（92/100 为当时快照；其后又新增 code-style S2–S6、真实浏览器验证、测试完整性原语、publish/auto-deliver 编排、以及 06-29 的安全加固，当前范围以 CHANGELOG/README 能力矩阵为准）。下列为仍需注意的遗留项。新的加固后残留项另见 `docs/hardening/remaining-risks.md`。

## 〇、审计缺口的当前关闭状态（2026-06-24 实跑后更新）

| 审计曾指出的缺口 | 当前状态 | 证据 |
|---|---|---|
| **deep/复杂档零实跑** | ✅ **已关闭** | 历史本地运行记录已覆盖 analyze-repo deep 与 plan deep；动态运行目录不随公开仓库发布，公开可复现材料见 `examples/` 与 `scripts/self-check.mjs` |
| **standard 完整路径未干净覆盖** | ✅ **已关闭** | 历史本地运行记录已覆盖 plan standard + full pathway；动态运行目录不随公开仓库发布，公开可复现材料见 `examples/` 与 `scripts/self-check.mjs` |
| **评分刻度门禁盲区（9.2 越界漏过）** | ✅ **已修复并生效** | 两引擎 `REVIEW_SCHEMA.score` 改 `integer` + `runConsistencyChecks` 新增「评分刻度」确定性校验；新跑产物中该校验通过（如 `094108` score=88、`094205` score=90，verdict=PASS） |
| **真实 FAILED_WITH_FINDINGS 无端到端样本** | ⚠️ **仍为已知边界（非缺陷）** | Run `094205` 用 `maxReworkRounds=0` + 高危任务 + 零注入，评审仍**真判 PASS** → 该硬终态**按设计无法在不注入的情况下确定性触发**（这正是质量门禁应有的性质）。控制流已被注入演练覆盖，真实样本依赖偶发的真实评审不通过 |

## 一、新增桥接（deliver-from-plan）的遗留项（独立评审 PASS 92，3 项 P2，非阻断）

1. **`.ps1` 半部完全开环**：本机无 `pwsh`，PowerShell 版改动（`-clike` 大小写敏感、`$_` 遮蔽修复、两版一致性）仅静态读 diff 看似正确，**未经机器验证**；已如实列入交付物 openItems，最终状态 `DELIVERED_WITH_OPEN_ITEMS`。需在装 pwsh 的机器补跑对拍。
2. **glob 语义待客户拍板**：`--exclude` 的匹配基准（完整相对路径 vs basename）、`*` 是否跨 `/`、大小写敏感性、是否作用于 explicit 模式——桥接已**先行选定一种语义并显式标注**（report 主动指出与方案"建议不跨 /"相反），属合理但须人工确认。
3. **`changes.diff` 用绝对路径头**：他机 `patch -p1` 命中率低；report 已自述并给 `cp` 兜底，建议后续改产相对路径 diff。
> 安全侧已独立复核无虞：原仓库逐字节零修改、改动只在沙箱、未 commit/merge、退出码语义无损、停机逻辑齐全。

## 一·续、新增发布与编排（publish-delivery / auto-deliver / git-guard Hook）的遗留项（2026-06-26 补登）

> 阶段2/3 新增 `publish-delivery`（已验证 diff → clone 远程 → 建分支 → commit → push → 远程确定性核验）与 `auto-deliver`（一句需求 → plan→deliver→publish，一层 `workflow()` 端到端编排），并补了 PreToolUse `git-guard` 红线 Hook（硬禁 force-push / 删远程分支 / 历史重写 / 强删本地分支）。以下为其**已知边界（非缺陷，已显式登记）**：

1. **真机端到端尚未冒烟（#17）**：publish / auto-deliver 的 push + 远程核验链路目前仅在**本地一次性临时仓库 + 本地 `file://` remote** 上演练过，**未**在真实 GitHub 的权限 / 网络 / 服务端分支保护下跑过。fail-safe 已就位：`computePublishStatus` 保证"未达可发布态 / 分支不被策略允许 / push 未成功 / 远程四项核验不全过"分别短路为 `PUBLISH_BLOCKED / PUBLISH_UNVERIFIED`，**绝不**在未真推或未核验时谎称 `PUBLISHED`；缺的只是真机冒烟样本。
2. ~~**沙箱去敏未在真带 `.git`+密钥的目标仓库实跑（#18）**~~ **【已关闭，2026-06-29】**：去敏已是确定性脚本 `bin/sandbox-prepare.mjs`（纯 Node fs，无 rsync/cp 子代理命令序列），并由 `scripts/sandbox-prepare.test.mjs`（构造真带 `.git`/`.env`/`id_rsa`/嵌套密钥/symlink 的 fixture，断言删净 + 源码留存）覆盖、`scripts/self-check.mjs` 注册、实跑 PASS；Scaffold 自 `278d8b8` 起改调该脚本（与 diff/Codex 同一排除集）。**残留边界**：去敏按**文件名**模式剥离（非内容级密钥扫描，见第 3 条）；所有 symlink 一律跳过。原"建议加 scripts/sandbox-cleanup.test.mjs"已由 sandbox-prepare.test.mjs 实现，无需另建。
3. **明文凭据按内容识别仍是 best-effort（#13）**：禁入判定以**文件名**模式为主；`application-prod.yml / config.json / *.sh / Java 常量`里的明文 `password= / apiKey:` 不在文件名白名单内，发布/交付的"按内容 grep"为非确定性尽力而为，须如实标注，不可宣称确定性拦截。
> **建议验证方式**：在受控环境对**一次性 throwaway repo + 独立 sandbox remote**（PAT 由可信人托管）跑一次 `auto-deliver` 的 `dryRun`→真推冒烟以闭合 #17/#18。**注意红线**：不要把自动 push 塞进 CI（撞本仓 no-auto-git 不变量与 `git-guard` Hook，`scripts/self-check.mjs` 还专门断言 Hook 会拦 push）。

## 二、展示前需对齐
- **评分口径（8→4 折叠）**：方法论把工程交付 Skill 的 8 阶段折叠为 4 个 phase。对外"排名评估"时是否仍要求按 8 阶段逐项打分，需与负责人确认（见 `docs/09`、`03-decision-log.md` 未确认第 7 条）。属口径选择、非缺陷。
- **复用同事成果署名**：`vendor/zhuliming-templates/`（朱立明模板）已取得授权并署名（见其 `ATTRIBUTION.md`）；后续如同步上游模板，应继续保留授权与署名要求。

## 三、复用前需核实（环境/版本相关）
1. **版本依赖**：本套基于 Claude Code `2.1.186` + Dynamic Workflows。团队成员若版本不一或未启用 Workflow，需先核对（见 `evidence/00-environment-scan.md`）。
2. **自定义 agentType 的可移植性**：`.claude/agents/*.md` 仅在从仓库根目录启动 Claude 时进注册表。实跑脚本均默认改用**内置 agentType**（general-purpose/Explore 等）以保证任意克隆目录名都可跑（见 `docs/04`）。
3. **presubmit 强制门禁未落地为 Hook**：方法论指出红线应由 PreToolUse Hook 强制，但**具体 `settings.json` 配置须先读项目实际文件**后再写，本项目未代写（有意留白，见 `docs/01`、`03-decision-log.md` 未确认第 4 条）。
4. **桥接的 `.ps1` 类开环项**：凡本机缺运行环境（pwsh 等）的目标，桥接会如实落为开环人工核对项，不自动闭合（见 `docs/12` §4.1、§9）。

## 四、方法论本身的已知边界（来自一手规范未明确处）
- `budget.total` 计量口径、超限时"已完成 agent 结果是否整轮回滚"——规范未逐字定义，文档已留白（见 `03-decision-log.md` 未确认第 2、6 条）。
- 网络来源的精确阈值（预加载 token 量、上下文降速阈值、CLAUDE.md 自动加载行数、Hook 返回大小上限）本机无法核验，已统一降置信并标"网络来源、未验证"。
- 多 skeptic 意见不一致时的聚合策略（多数/权重/一票否决）规范未给，需团队按风险约定。

## 五、本次执行暴露的真实教训（已沉淀进文档）
1. **研究 fan-out 同质化**：6 路研究约 5 路高度同质。教训：研究类扇出应按"是否新增独立视角"而非"主题数量"切分（见 `docs/07`）。
2. **简单截断可能漏关键项**：截断应带重要性排序，且永远 `log()` 被丢弃项（见 `docs/10` §5）。
3. **桥接的命门是"测试物化"**：方案只给测试规格，必须先把它变成可运行 DONE 并"先红后绿"核验可信，否则闭环退化成开环（见 `docs/12` §4）。

## 六、不构成风险但需声明
- `.claude/workflows`、`.claude/agents`、`.claude/skills` 是本公开仓库的项目资产，应随仓库发布；真正需要排除的是 `.claude/settings.local.json`、`AGENTS.md`、个人记忆、密钥和客户代码副本。
- `evidence/runs/`、`evidence/plans/`、`evidence/deliveries/` 是动态运行目录，默认不发布；公开可复现示例已整理到 `examples/`。

## 七、公开仓库状态
- GitHub 公开发布已完成；当前重点是持续保持路径可移植、示例可复现、文档状态一致，以及用 `node scripts/self-check.mjs` 在发布前做确定性自检。
