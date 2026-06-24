# 最小示例 analyze-repo —— 真实运行报告（一手运行记录）

> 这是 `.claude/workflows/analyze-repo.js` 的一次**真实运行**记录（非模拟）。
> 运行方式：`Workflow({ scriptPath: ".../analyze-repo.js", args: { target, taskDescription, maxComponents: 6 } })`
> Run ID：`wf_e93aaabd-756`　Task ID：`ww4dhmlh9`
> 分析目标：`<repo-root>/<external-skill>/ai-engineering-delivery-zh`
> 完整结构化结果（每阶段输入/输出）见 `evidence/demo-run-raw.json`。

## 运行元数据（一手）
- Agent 总数：**12**（understand 1 + scan 1 + analyze 6 + risk 1 + testPlan 1 + review 1 + report 1）
- 子代理 Token：约 —（见任务用量）
- 进度日志（log() 输出，证明"不静默截断"）：
  - `扫描到 7 个组件，按 maxComponents=6 取前 6 个分析；已丢弃 1 个：presubmit-scan.sh`
  - `analyze-repo 完成: 组件 6/7，风险 7，用例 18，独立审查=CONDITIONAL_PASS`
- 独立审查判级：**CONDITIONAL_PASS**（由 stage6 全新独立实例给出，未参与前序分析）
- 统计：组件分析 6/7、风险 7 条、测试用例 18 条

## 独立审查（stage6）摘要
- 判级：CONDITIONAL_PASS
- 完整性问题：3 条　准确性问题：2 条　被忽略风险：2 条

**完整性：**
- TC-10 在覆盖矩阵里被列为 P2 且其'预期结果'本身就是错的（详见准确性问题），导致一个与最高危风险同源、且更普遍的失效路径没有被作为独立风险条目提出：在非 git 仓库目录下以 changed/staged/base 任一模式运行，require_git 的 exit 1 因处于进程替换 <(list_files)（.sh 第73行）子shell 内而被吞掉，主 shell 继续执行并打印 'No changed files to scan.' 后 EXIT 0。我已实测复现（三种模式均 EXIT=0，错误仅进 stderr）。这说明高危'静默放行'不止 --base 坏引用一种触发条件，根因是进程替换吞掉子shell退出码，建议把高危风险描述从'--base 坏引用'扩写为'所有依赖 git 的模式在 git 失败/非仓库时都会静默 EXIT 0'。
- 测试方案对'修复后正向用例'确实承认缺失（coverageGaps 已自述），但既然 require_git 路径也受同一根因影响，验证方案应补一条：在非 git 目录跑默认 changed 模式断言应非0退出/醒目报错（当前实测为静默 EXIT 0）——这条比 --base 更易被用户无意触发。
- 组件分析与扫描多处把脚本表述为'153 行 / 152 行'（scan overview 写 153，理解阶段写 152），实测 wc -l = 152 行，存在内部口径不一致（轻微，但属一致性自查应抓到的）。

**准确性：**
- 【确定性错误】TC-10 的预期结论写：'require_git 触发 stderr 报 error not inside a git repo EXIT 1（与 TC-01 静默 0 对比,证此分支有正确错误处理,凸显 base 路径缺失同等保护）'。我在真实非 git 目录直接执行 presubmit-scan.sh（changed/staged/base 三种模式）实测：均打印 stderr 错误后 stdout 'No changed files to scan.'、EXIT=0，并非 EXIT 1。根因是 require_git 的 exit 1 运行在 <(list_files) 进程替换子shell 内（.sh 第54-73行），只结束子shell、不终止主 shell。因此'此分支有正确错误处理 / 与 base 形成保护对比'的结论与实际代码行为相反——require_git 并不提供 EXIT 1 保护，它和 --base 坏引用是同一类静默放行。这一条直接削弱了报告用来反衬 --base 风险'独特性'的论据。
- 次要：scan overview 把退出码 2 的语义在 components 描述里浓缩为'两级密钥检测…→exit2'尚可，但风险列表/测试方案里有处把脚本行号引用写成 .sh '第151行' 触发 exit 2——实测 exit 2 由第151行 `[ "$high_hits" -eq 1 ] && { …exit 2; }` 触发，准确；但'第10-14行'是注释（非可执行逻辑），把它与 99-106/151 并列为'退出码2由此处决定'稍有混淆（注释只是文档说明，真正赋值 high_hits=1 在第105行）。属表述精度问题，不影响结论。

**被忽略风险：**
- 高危静默放行的真实暴露面被低估：报告把它框定为'PR 准备 + base 引用拼错'这一相对小众场景，但实测表明【在任何非 git 仓库目录下用默认模式（无参数）运行脚本】同样静默 EXIT 0。默认无参模式是文档（delivery-checklist L33）给出的第一条用法，用户最可能直接拷贝运行；若其当前工作目录恰好不是 git 仓库（或脚本被误解为'在 skill 目录里跑'——而 skill 目录本身可能不是 git 仓库），提交前扫描会在用户毫无察觉下完全空跑。这是比 --base 更高频的失效路径，应升格描述。
- 根因层面缺失：报告把 --base 与 require_git 当作两个独立点（一个 high、一个被错判为'有保护'），未点出二者共同根因=进程替换 <(list_files) 吞掉子shell 退出码 + set -e 在此处不生效。指出统一根因更有助于'仅记录的修复建议'（应在 list_files 外层或主流程校验 git 命令退出码，而非只在 base 分支加 rev-parse）。

**建议：**
- 修正 TC-10 的预期结论：从'EXIT 1、有正确错误处理'改为实测事实'EXIT 0、错误仅入 stderr、静默放行'，并把它并入高危风险（与 --base 同根因），而非作为'对照组'。
- 将高危风险（A 区）的描述与影响从'--base 坏引用'扩写为'所有 git 依赖模式（changed/staged/base）在非 git 仓库或 git 命令失败时均静默 EXIT 0'，并在验证命令里补一条非 git 目录默认模式的负向断言。
- 把修复建议从'仅 base 模式 git rev-parse --verify'升级为'统一在 list_files/主流程校验 git 子命令退出码（不要依赖进程替换内的 exit），任何 git 失败都应非0退出'，覆盖根因（仅记录，不改码）。
- 统一脚本行数口径（实测 152 行），消除报告内 152/153 的自相矛盾。
- 其余 high/medium 结论（--base 坏引用静默放行、delivery-checklist L44 退出码语义漂移、跨行/JWT/二进制密钥漏报、双实现 pwsh 不可用未验证、SKILL.md 未提 .ps1、字节级一致性）均经我实测/校验属实，可保留——这部分质量高，建议维持。

---

## 最终报告全文（report 阶段产出）

# ai-engineering-delivery-zh Skill 只读分析 · 最终报告

> 目标：`<repo-root>/<external-skill>/ai-engineering-delivery-zh`
> 性质：Claude Code Skill 包（工程化交付流程框架），非可独立运行的应用
> 范围：只读静态分析 + 对唯一可执行模块（presubmit-scan 脚本）的动态实证测试
> 全程未修改任何目标文件；所有结论附证据来源（文件/行号或实测）。

---

## 一、任务理解

### 1.1 目标
对该目录做只读分析，建立对其结构、功能模块、风险的准确认知，产出可执行的测试验证方案，并给出最终报告。该 Skill 的作用是"指导别的项目做工程化交付"，其本身是一套提示词流程文档 + 一个提交前风险扫描脚本（bash/PowerShell 双实现）。

### 1.2 范围内
- 全部 8 个文件的职责与相互关系（SKILL.md、5 个 references、2 个脚本）
- 两个脚本的逻辑正确性、跨平台一致性、正则匹配的真/假阳性与漏报、退出码语义、只读安全性
- SKILL.md 与 references/* 的内部引用、阶段编号、加载路径、退出码措辞一致性

### 1.3 范围外
- 修改目标内任何文件（明确禁止改代码）
- 把 Skill 安装到 `~/.claude/skills` 并端到端跑真实交付流程
- 评估 LLM 加载该 Skill 后的真实运行时行为（不可静态判定）
- 目标目录之外的项目代码、git 提交/推送操作
- 兄弟英文版目录——仅在核验"字节级一致"自我声明时做只读对照（已用 sha256/diff 完成）

### 1.4 验收信号（均已满足）
- 已逐一读完 8 个文件并能描述各自职责与关系
- 已识别唯一含可执行逻辑的模块 = presubmit-scan 脚本，其余为 Markdown 流程文档
- 测试方案落到可验证面：脚本可静态/动态测试，文档可做一致性核查
- 每条结论标注证据来源或显式标注未验证
- 报告覆盖结构、功能模块、风险（含误报/漏报与跨平台差异）、可执行验证步骤
- 全程未修改目标文件

### 1.5 假设
- 目标是 Claude Code Skill 包（依据：SKILL.md 含标准 frontmatter；目录结构 `scripts/` + `references/`；系统提示中存在同名可用 skill）
- `-zh` 为中文本地化变体；脚本注释自称与 Codex/英文副本"byte-identical"，即 `.sh/.ps1` 是跨副本共享、不随语言变化的部分（presubmit-scan.sh 第 7-8 行）——已实测坐实（见 2.4）
- 脚本预期运行环境为 bash 与 PowerShell，依赖 git/grep/sed/wc 等常规工具
- "测试验证"主要指对脚本做实证测试 + 对文档做一致性核查，而非验证 LLM 行为

---

## 二、结构概览

### 2.1 目录结构（已实测核实）
```
ai-engineering-delivery-zh/
├── SKILL.md                              7508 B  入口/流程编排（YAML frontmatter + 纯 Markdown）
├── references/
│   ├── requirement-analysis.md          4453 B  阶段 1-4：业务理解/系统扫描/梳理各流/验收标准
│   ├── delivery-checklist.md            3733 B  阶段 5-6：实现规则 + 验证 + 提交前准备
│   ├── risk-review.md                   2732 B  阶段 7：支付/权限/状态机/幂等/回滚等高风险审查
│   ├── retrospective-template.md         768 B  阶段 8：交付摘要/技术笔记/PR 摘要模板
│   └── worked-example.md               6007 B  订单退款的完整 8 阶段走通示例
└── scripts/
    ├── presubmit-scan.sh   6652 B / 152 行  可执行 bash，提交前只读风险扫描
    └── presubmit-scan.ps1  7593 B / 184 行  PowerShell 移植版（功能对应 .sh）
```

### 2.2 框架定位
业务优先的工程化交付方法学。通过 **8 个阶段**（理解业务 → 扫描现有系统 → 梳理各流 → 定验收标准 → 最小范围实现 → 验证 → 风险审查 → 复盘）+ 多层参考清单，把高风险业务需求转化为可控的工程实现。无自动化测试框架，流程纪律依赖模型自觉执行；唯一的机器把关是提交前扫描脚本（且只覆盖提交前文本面一小段）。

### 2.3 阶段编号与文件绑定（一致性已核验）
| 阶段 | 承载文件 | SKILL.md 引用 |
|---|---|---|
| 1-4 需求分析 | requirement-analysis.md | L38-41 / L69 |
| 5-6 实现与验证 | delivery-checklist.md | L42-43 / L70 |
| 7 风险审查 | risk-review.md | L44 / L71 |
| 8 复盘沉淀 | retrospective-template.md | L45 / L72 |
| 完整示例 | worked-example.md | L47 / L73 |

各 references 内部阶段标题与 SKILL.md 引用一致；"何时该问"在 SKILL.md L49-55 单一定义、delivery-checklist 委托回它不重复——单一事实源原则被遵守。

### 2.4 跨副本/跨平台字节级一致性（已实测坐实自我声明）
- `.sh` 的 zh 与 en 副本 **sha256 完全相同**：`edf6f07ef7bb2e3b81fa9e4879b8be945da04525e3a02b0ad0408898e43e9d0f`
- `.ps1` 的 zh 与 en 副本 **diff IDENTICAL**
- 坐实脚本注释"byte-identical across Claude Code and Codex copies"的自我声明

---

## 三、组件分析

### 3.1 SKILL.md（核心流程编排，纯 Markdown + frontmatter）
入口与编排文档。定义：frontmatter 的 name/description 路由触发；任务复杂度分级（简单/中等/复杂）；5 种任务模式；8 个交付主干阶段；"何时问 vs 直接做"唯一规则（L49-55）；规则优先级链（L57-59）；分层后端术语到实际技术栈的映射（L61-63）；5 个 references 的按需加载时机（L65-75）；提交前脚本说明（L75）；编码前/中/后输出纪律（L77-79）。明确声明叠加在项目规则、CLAUDE.md 与实现类 Skill 之上而非替代。

### 3.2 references/requirement-analysis.md（阶段 1-4）
为需求分析提供结构化框架：业务理解 8 项追问（注：上游任务描述称"6 项"，实际为 8 项）；现有系统扫描固定五段式输出（已确认事实/合理推断/待确认问题/当前约束/影响范围，L33-43）；项目规则抽取七段式模板（L49-57）；业务流/数据流/持久化/UI/接口五个子框架。核心方法论原则：第 30 行"绝不把猜测当成已确认事实"。第 3 行占位词映射交叉引用 SKILL.md L61-63，文案一致。

### 3.3 references/delivery-checklist.md（阶段 5-6）
实现与验证操作清单：编辑前 7 项前置确认；实现规则 8 条（只改相关文件、不擅改接口、前后端字段一致、权限放后端、数据库变更显式用 SQL 脚本、避免投机抽象等）；验证清单（前端 7 项 + 后端 9 项）；提交前准备（调用 presubmit-scan.sh + 人工核查纪律）。与全局 CLAUDE.md 第 11/12/16/18/21 条高度同向。**注意**：L44 退出码措辞与脚本实际行为矛盾（见风险 R2）。

### 3.4 references/risk-review.md（阶段 7）
高风险域发布前人工审查提纲，6 个检查维度：不要只信生成代码/静态检查；一致性检查（12 条跨边界状态不一致反模式）；状态机检查（6 个不变式）；幂等与并发（推荐"状态条件更新 + 操作日志"，12 类触发场景）；回滚与恢复（每个高风险改动定义 6 件事）；发布就绪 gate。与 CLAUDE.md 第 16/17/23 条高度同源。

### 3.5 references/retrospective-template.md（阶段 8）
复盘沉淀模板：交付摘要 8 字段、技术笔记 13 章节（注：上游描述称"11 章节"，实际 13）、PR 摘要 7 分类。开头强约束"没真跑过的测试绝不说通过"，与 CLAUDE.md 第 21 条一致。

### 3.6 references/worked-example.md（端到端示例）
用"操作员把已支付订单标记为已退款"完整跑通 8 阶段，展示每个产物的形状（非照抄脚本）。核心安全设计示范：`OrderMapper.updateStatusIfPaid` 用条件更新 `WHERE id=#{id} AND status=PAID`、以受影响行数=0 作幂等护栏；`@Transactional` 把状态更新+撤销权益+审计绑同一事务。轻微叙述瑕疵：阶段 5"只动 4 个文件"未把新增 `EntitlementMapper.deactivateByOrder` 列入。

### 3.7 scripts/presubmit-scan.sh（唯一可执行模块，152 行 bash）
提交前只读风险扫描。**两级密钥检测**：HIGH（真实字面量凭据：PEM 头/AKIA/sk_live 等）→ exit 2（L104/L151）；LOW（secret-ish 字段名）→ 仅警告不改退出码。另含调试日志、test-only 标记、本地地址、SQL 风险、合并冲突标记、项目规则文件、大文件（>512000 B）检查。四种模式：默认（changed）/`--staged`/`--base <ref>`/显式文件 + `--help`。注释与代码均声明 **NEVER modifies/stages/commits**——实测多次重跑工作区/暂存区/提交无变更，天然幂等。

### 3.8 scripts/presubmit-scan.ps1（PowerShell 移植，184 行）
功能对应 `.sh`，支持 `-Staged/-Base/-Help`/文件参数。**本环境 pwsh 缺失（已实测 `command -v pwsh` MISSING）**，故 `.ps1` 仅做静态审读 + 与英文副本 diff（IDENTICAL）；其 PowerShell 正则引擎与 grep 的边界差异（`\s`、字符类、转义、Select-String 默认大小写不敏感 vs grep `-i`、AKIA/provider 的 `-CaseSensitive`）未经运行验证，标注为**未验证**。

---

## 四、风险清单

> 严重度：high=可导致兜底环节静默失效；medium=文档/实现漂移或漏报；low=可用性/一致性轻微问题。所有 high/medium 均经本次实测复现。

### R1 [HIGH] 所有 git 依赖模式在 git 失败/非仓库时静默 EXIT 0（异常分支，根因层）
**实测确认**（已扩大暴露面，采纳独立审查意见）：
- 非 git 目录下默认（changed）/`--staged`/`--base` **三种模式均**打印 `error: not inside a git repo` 到 stderr 后仍 **EXIT=0**，stdout 打印 `No changed files to scan.`
- 有效 git 仓库内 `--base origin/does-not-exist`（坏引用）：git `fatal: ambiguous argument` 到 stderr，仍 **EXIT=0** 静默放行
- 对照：`--base HEAD~1`（有效）正常命中并 EXIT=2

**统一根因**：`require_git` 的 `exit 1` 与 `git diff` 的失败都运行在进程替换 `<(list_files)`（.sh 第 54-73 行）子 shell 内，只结束子 shell、不终止主 shell，`set -e` 在此处不生效。`.ps1` 第 79 行同样不检查 `$LASTEXITCODE`。

**影响**：提交前扫描是 CLAUDE.md 第 16/22 条所指高风险逻辑的兜底环节。默认无参模式正是 delivery-checklist L33 的第一条用法，用户最易直接拷贝运行；若工作目录恰非 git 仓库（或脚本被误解为"在 skill 目录里跑"），扫描看似成功（EXIT 0=clean）实则一个文件都没扫，真实密钥/SQL/冲突标记全部漏检且使用者完全无感知。幂等性在此反而掩盖了功能失效（稳定地错误比偶发失败更隐蔽）。

**修复方向（仅记录，本任务只读不改码）**：统一在 `list_files`/主流程校验 git 子命令退出码，不要依赖进程替换内的 `exit`；任何 git 失败都应非 0 退出。`--base` 模式可先 `git rev-parse --verify "$base^{commit}"` 失败即 exit 1。覆盖根因而非只补 base 分支。

### R2 [MEDIUM] delivery-checklist L44 退出码语义与脚本/SKILL.md 矛盾（一致性）
**实测三处对照**：delivery-checklist L44 写"项目规则文件（疑似密钥时退出码 2）"，把 exit 2 归因于"疑似密钥"。但 presubmit-scan.sh（L11/L104/L151）与 SKILL.md L75 均明确：exit 2 **仅由 HIGH 级真实字面量凭据触发**；"疑似字段名"属 LOW 级仅警告不改退出码。动态佐证：纯字段名（`password:` / `apiKey =`）→ LOW，EXIT=0；真实值（`password: SuperSecretValue12345`）→ HIGH，EXIT=2。
**影响**：使用者可能误判——以为字段名命中就 FAIL（无谓阻塞），或低估真实凭据告警严重性；侵蚀对兜底脚本的信任。
**建议**：把 L44 措辞改为与脚本/SKILL.md 一致——"高置信度真实凭据 → 退出码 2；疑似字段名 → 仅警告"。

### R3 [MEDIUM] 密钥检测漏报：跨行/非字段名 token/Base64-JWT/二进制（边界场景）
脚本基于逐行文本正则，实测漏报：(1) 键值跨行——`api_key:` 在第 1 行、长值在第 2 行，仅 LOW 命中字段名、HIGH 漏掉真实值（EXIT=0）；(2) 非 KEY 模式赋值——`token=eyJ...`（JWT）因 token 不在 KEY 集合且无引号，完全无命中（EXIT=0）；(3) 二进制含 NUL 文件——grep `-I`/Test-TextFile 跳过（EXIT=0）。多行 PEM 仅 BEGIN 头匹配（够用），body 不识别。
**影响**：把脚本当"充分检查"而非"兜底"时，真实凭据可能溜过。文档已声明"扫描是兜底，不替代读 diff"，风险被显式承认，故 medium。
**建议**：维护一组已知应命中/应漏报的密钥样例做回归；严格执行 CLAUDE.md 第 16 条人工读 diff。

### R4 [MEDIUM] 双实现（.sh/.ps1）跨平台一致性无自动校验，且 pwsh 缺失致无法实测（一致性）
两脚本声称功能一致。`.ps1` 与英文副本 diff IDENTICAL、与 `.sh` 文本逐项对应（KEY/KV_HIGH/KV_LOW、AKIA、PEM、provider 前缀、demote 列表、两级逻辑、退出码 0/2、四模式），但本环境 **pwsh MISSING（已实测）**，PowerShell 与 grep 的正则引擎边界差异未经运行验证。
**影响**：Windows（pwsh）用户的扫描覆盖面若与 Bash 版漂移而不自知，跨平台团队把关强度不一致；无 lint/CI 锁定二者等价，长期演进易分叉。
**建议**：在有 pwsh 的环境用同一组 fixtures 分别跑 `.sh`/`.ps1` 逐项比对命中行与退出码；CI 加跨平台等价性回归。

### R5 [LOW] SKILL.md 未提及 .ps1，主入口与子清单文档脱节（一致性）
scripts/ 下实存 presubmit-scan.ps1，delivery-checklist L38-42 有 PowerShell 用法，但 SKILL.md L75 只提 `.sh`、从未提 `.ps1`（实测 grep 确认）。只读 SKILL.md 的 Windows 用户可能误以为无跨平台支持而跳过提交前扫描。建议 L75 补一句指向 `.ps1` 的跨平台说明。

### R6 [LOW] 脚本安装路径靠人工替换 `<skill-dir>` 占位符（可用性）
SKILL.md L75、delivery-checklist L30/L44 示例给的是 `~/.claude/skills/ai-engineering-delivery-zh`，但本仓库实际位置为 `<repo-root>/<external-skill>/ai-engineering-delivery-zh`。脚本自身对路径无依赖（实测从任意 git 仓库内用绝对路径、或对显式文件/非 git 目录调用均正常）。若使用者照抄示例路径未替换，会因找不到脚本而无法执行——与 R1 叠加时尤其危险（兜底被静默跳过）。建议文档补"用 `realpath` 或先 `ls` 确认脚本路径"。

### R7 [LOW] 全流程纪律纯靠模型自觉，无强制校验（方法学元风险）
SKILL.md 与全部 references 为自然语言软约束：任务分级、todo 勾选、"未验证不得写已验证"、最小改动、"绝不把猜测当已确认事实"、风险审查推演等均无 lint/hook/CI 把关。唯一可执行的 presubmit-scan 只覆盖提交前一小段文本面，且本身存在 R1/R3。这是 prompt 工程方法学固有风险，非文件缺陷。缓解：把修复 R1 后的脚本作为强制 pre-commit hook；高风险域人工复核留痕；复盘模板强制填"已做验证/残留风险"。

### 上游任务描述与实际计数偏差（非缺陷，备查）
- requirement-analysis 业务理解：描述称 6 项，实际 8 项
- retrospective 技术笔记：描述称 11 章节，实际 13 章节
- presubmit-scan.sh 行数：扫描阶段口径 153、理解阶段 152，**实测 152**（已统一为 152）

---

## 五、测试验证方案

> 策略：脚本做静态 + 动态实证（语法/退出码/两级密钥真假阳性/占位符降级/SQL/冲突/四模式）；文档做一致性核查。`SCRIPTDIR=<repo-root>/<external-skill>/ai-engineering-delivery-zh/scripts`。下列标"已实测"者本次已复现。

| ID | 场景 | 类型 | 预期（含实测结果） | 优先级 |
|---|---|---|---|---|
| TC-01 | `--base` 坏引用，仓库含真实凭据 | 异常分支负向(高危回归) | git fatal 到 stderr，脚本 EXIT 0 静默放行——**已实测复现**；锁定回归：仍 EXIT 0 即判 R1 存在 | P0 |
| TC-02 | `--base HEAD~1`（有效），自分叉含真实凭据 | 正向对照 | EXIT 2，POSSIBLE SECRET HIGH 列出 leak 文件+行——**已实测**；证 TC-01 失败仅因引用无效被吞 | P0 |
| TC-03 | 仅密钥字段名（`password:` / `apiKey =`） | 边界退出码语义 | LOW，EXIT 0——**已实测**；钉死 delivery-checklist L44 措辞错误 | P0 |
| TC-04 | 真实字面量值（`password: SuperSecretValue12345`） | 正向退出码语义 | HIGH，EXIT 2，FAIL——**已实测**；与 TC-03 对照确立"仅 HIGH→exit 2" | P0 |
| TC-NG | **非 git 目录默认/staged/base 三模式**（采纳独立审查新增） | 异常分支(高频) | 三模式均 stderr 报错但 EXIT 0 静默放行——**已实测复现**；比 TC-01 更易被无意触发 | P0 |
| TC-05 | 跨行键值（键名第 1 行、值第 2 行，值不含独立 token 前缀） | 边界漏报 | HIGH 漏报、仅 LOW 命中，EXIT 0；对照同一行 EXIT 2。fixture 值不可含 AKIA/sk_ 否则被直检命中假阳 | P1 |
| TC-06 | 非字段名 token 赋值（`token=eyJ...` JWT） | 边界漏报 | HIGH/LOW 均 0 命中，EXIT 0；证 KEY 集合外 token 完全漏报 | P1 |
| TC-07 | 二进制含 NUL 内嵌真实密钥 | 边界漏报(标准行为) | grep -I 跳过，EXIT 0；.ps1 侧 pwsh 缺失未验证 | P2 |
| TC-08 | 占位符/env 引用（`${VAR}`/`changeme`/`your_*`/`process.env`） | 正向误报抑制 | 全部从 HIGH 降级 LOW，EXIT 0 | P1 |
| TC-09 | 非 git 目录对**显式文件**（含真实凭据）调用 | 边界可用性 | 正常扫描 EXIT 2 FAIL——证显式文件模式不依赖 git 上下文 | P1 |
| TC-11 | `.sql` 文件含 DROP/DELETE/TRUNCATE/ALTER | 正向 SQL 风险 | 命中 SQL risk（advisory），EXIT 0；边界：内联在 .java/.xml 的危险 SQL 不命中（按扩展名触发的漏报） | P1 |
| TC-12 | 完整合并冲突标记 | 边界 | 仅报行首 `<<<<<<<` 与 `>>>>>>>`，不报 `=======`，EXIT 0 | P2 |
| TC-13 | 同一含密钥文件连跑两次比对输出 | 幂等只读 | 两次字节级 IDENTICAL，工作区/暂存区/提交无变更 | P2 |
| TC-14 | delivery-checklist L44 vs SKILL.md L75 vs 脚本 L104/L151 三处对照 | 文档一致性(静态) | 已确认不一致（R2），以脚本+SKILL.md 为准修正 L44 | P1 |
| TC-15 | SKILL.md L75 是否覆盖 scripts/ 全部脚本 | 文档覆盖度(静态) | 已确认 SKILL.md 只提 .sh 漏 .ps1（R5），建议补跨平台指向 | P2 |
| TC-16 | .sh/.ps1 与 zh/en 跨平台跨副本等价性 | 跨平台等价性(部分未验证) | 静态：.sh sha256 一致、.ps1 diff IDENTICAL——**已实测**；运行层 pwsh MISSING，.ps1 正则引擎匹配差异**未验证**，需有 pwsh 环境跑同组 fixtures 结案 | P1 |
| TC-17 | 大文件阈值边界（=512000 vs >512000 字节） | 边界 | `-gt 512000`：恰好 512000 不标记、512001+ 标记 Large file，EXIT 不受影响；建议补动态 off-by-one fixture | P2 |
| TC-18 | 大小写敏感性（API_KEY/apiKey/Password 不敏感；AKIA/sk_live/gh_/AIza/xox 敏感） | 边界 | KEY/KV 用 -i 命中各种大小写；AKIA/provider 前缀大小写敏感避免误判；建议构造混合大小写 fixture 实测结案 | P2 |

### 关键验证命令（节选）
```bash
SCRIPTDIR=<repo-root>/<external-skill>/ai-engineering-delivery-zh/scripts
# 用法/退出码
bash "$SCRIPTDIR/presubmit-scan.sh" --help; echo "EXIT=$?"
# TC-NG 非 git 目录默认模式负向断言（应非 0；实测当前 EXIT 0=R1）
W=$(mktemp -d); ( cd "$W" && bash "$SCRIPTDIR/presubmit-scan.sh"; echo "EXIT=$?" )
# TC-01/02 高危回归
G=$(mktemp -d); git -C "$G" init -q
printf 'k=AKIAIOSFODNN7EXAMPLE\n' > "$G/leak.txt"; git -C "$G" add -A && git -C "$G" -c user.email=t@t -c user.name=t commit -qm a
printf 'k=sk_live_zzzzzzzzzzzzzzzzzzzz\n' > "$G/leak.txt"; git -C "$G" add -A && git -C "$G" -c user.email=t@t -c user.name=t commit -qm b
( cd "$G" && bash "$SCRIPTDIR/presubmit-scan.sh" --base origin/nope; echo "EXIT=$?" )   # 期望 EXIT 0=R1
( cd "$G" && bash "$SCRIPTDIR/presubmit-scan.sh" --base HEAD~1; echo "EXIT=$?" )         # 期望 EXIT 2
# TC-03/04 退出码语义
D=$(mktemp -d); printf 'password:\napiKey =\n' > "$D/f.txt"; bash "$SCRIPTDIR/presubmit-scan.sh" "$D/f.txt"; echo "EXIT=$?"  # 0
printf 'password: SuperSecretValue12345\n' > "$D/r.txt"; bash "$SCRIPTDIR/presubmit-scan.sh" "$D/r.txt"; echo "EXIT=$?"       # 2
# TC-13 幂等
bash "$SCRIPTDIR/presubmit-scan.sh" "$D/r.txt" >a 2>&1; bash "$SCRIPTDIR/presubmit-scan.sh" "$D/r.txt" >b 2>&1; diff -q a b
# TC-16 跨平台/跨副本
command -v pwsh >/dev/null && echo "pwsh OK" || echo "pwsh MISSING"
sha256sum "$SCRIPTDIR/presubmit-scan.sh" <repo-root>/liu/ai-engineering-delivery/scripts/presubmit-scan.sh
# TC-14/15 文档一致性
grep -n '退出码 2' <repo-root>/<external-skill>/ai-engineering-delivery-zh/references/delivery-checklist.md
grep -n 'ps1\|PowerShell' <repo-root>/<external-skill>/ai-engineering-delivery-zh/SKILL.md
```

---

## 六、独立审查意见与采纳情况

独立审查结论 **CONDITIONAL_PASS**。其核心更正经本次重新实测全部确认属实，已采纳并并入正文：

| 审查意见 | 实测复核 | 采纳情况 |
|---|---|---|
| TC-10 原预期"非 git 目录 require_git → EXIT 1、有正确错误处理"是**确定性错误**；实测三模式均 EXIT 0 静默放行 | **已复现**：changed/staged/base 三模式均 stderr 报错后 EXIT=0 | 已采纳：删去错误的"对照组"定位，新增 TC-NG 为 P0 高危用例 |
| 高危静默放行**真实暴露面被低估**，不止 `--base` 坏引用；默认无参模式在非 git 目录同样静默 EXIT 0，且是文档首条用法、最易被无意触发 | **已复现** | 已采纳：R1 描述从"`--base` 坏引用"扩写为"所有 git 依赖模式在 git 失败/非仓库时均静默 EXIT 0" |
| 根因层缺失：未点出统一根因 = 进程替换 `<(list_files)` 吞掉子 shell 退出码 + `set -e` 不生效 | 代码核实（.sh 54-73）+ 实测一致 | 已采纳：R1 增"统一根因"段，修复建议升级为"在 list_files/主流程校验 git 退出码"而非只补 base 分支 |
| 脚本行数口径自相矛盾（152 vs 153） | **实测 `wc -l` = 152** | 已采纳：全报告统一为 152 行，并在偏差备查中记录 |
| 其余 high/medium 结论（`--base` 坏引用静默放行、L44 退出码漂移、跨行/JWT/二进制漏报、双实现 pwsh 未验证、SKILL.md 未提 .ps1、字节级一致性）均属实，可保留 | 本次逐项重测/校验确认（含 sha256/diff、HIGH/LOW 退出码、坏 base） | 全部保留 |

**结论**：独立审查所有可执行更正均已纳入，报告关键结论的准确性与暴露面描述较初稿更严谨。

---

## 七、遗留问题

1. **`.ps1` 全部动态行为未验证**：本环境 `pwsh` MISSING（已实测）。`.ps1` 与英文副本 diff IDENTICAL、与 `.sh` 文本逐项对应均为静态结论；PowerShell 与 grep 的正则引擎边界差异（`\s`/字符类/转义/Select-String 默认大小写不敏感 vs grep `-i`、AKIA/provider 的 `-CaseSensitive`）需在有 pwsh 的环境跑同组 fixtures 后结案。TC-07/16/18 的 `.ps1` 侧均落在此缺口。
2. **双实现等价性无自动校验**：无 lint/CI 锁定 `.sh`/`.ps1` 对固定 fixtures 输出一致，长期演进易分叉而无感知。
3. **密钥检测固有漏报无法靠脚本自身收敛**：跨行键值、KEY 集合外 token/JWT/裸 Base64、二进制内嵌、内联在非 `.sql` 文件中的危险 SQL 均漏报。文档已声明"兜底不替代读 diff"，缓解只能靠使用纪律，无法用脚本测试关闭。
4. **R1 当前只有锁定回归用例，无修复验证用例**：修复方向（主流程校验 git 退出码）属建议；本任务只读不改码，修复后的正向用例尚不存在。
5. **安装路径占位符 `<skill-dir>` 无强制校验**：示例路径与本仓库实际位置不符，照抄会静默跳过兜底（与 R1 叠加更危险），仅能靠使用前 `ls`/`realpath` 确认。
6. **全流程纪律软约束无法静态/动态验证**：任务分级、未验证不得写已验证、风险审查推演、术语映射手工同步等属 prompt 工程方法学固有运行时行为缺口，超出静态分析范围。
7. **大文件阈值 TC-17 与大小写策略 TC-18 本轮仅静态确认条件**，未跑专项动态 fixture（off-by-one 边界、AKIA 小写不误判），列为待补回归。

---

*本报告全程未修改目标目录任何文件；R1/R2/R3 与跨副本一致性、退出码语义、非 git 静默放行均经本次 scratchpad 临时仓库实测复现。*
