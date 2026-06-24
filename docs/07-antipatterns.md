# 07 反模式（Anti-patterns）

> 本文罗列 Claude Code Dynamic Workflow 编排中**应当避免**的常见错误。
> 每条按「症状 / 为什么坏 / 正确做法」三段式给出。
> 凡涉及 Workflow 脚本 API，以 `evidence/01-workflow-api-ground-truth.md`（产品内一手规范）为准；本文不重复 API 全量定义，详见 docs/01～docs/06 与该锚点文件。
> 标注约定：未经本机实测或规范未明示的后果/数字，一律写「未经本机验证」或留白，不写成结论。

---

## 一、编排结构类

### A1. 不必要的 `parallel()` 栅栏

- **症状**：把多阶段工作写成 `parallel()`（或在 stage 之间用 `parallel()` 强行断开），即使后一阶段并不需要前一阶段的**全量跨 item 结果**。
- **为什么坏**：`parallel()` 是栅栏，必须等**全部** item 完成才能进入下一步；墙钟被拉到「最慢一条」并叠加各阶段，最慢条目阻塞所有人。而 `pipeline()` 的 stage 间**无栅栏**，item A 可在 stage3、item B 还在 stage1，墙钟 = 最慢单条链而非各 stage 最慢之和。误用栅栏会平白增加等待。
- **正确做法**：**默认用 `pipeline()`**。只有当 stage N 真的需要 stage N-1 的全量跨 item 结果（去重、合并、全集早退、相互比较）时才用 `parallel()`。中间的纯 transform（flatten/map/filter，无跨 item 依赖）应放进 pipeline 的某个 stage，而不是用栅栏断开。选择依据是「**是否需要全量跨 item 结果**」，与谁更快无关。详见 docs/02（控制流）。

### A2. 多层 workflow 嵌套 / 父串多子

- **症状**：把一个长流程拆成多个子 workflow，再用一个父 workflow 串联调用；或子 workflow 内部再 `workflow()` 调用孙 workflow。
- **为什么坏**：`workflow()` **仅支持一层嵌套**——子 workflow 内再调 `workflow()` 会抛错；父也不能靠串联多个子 workflow 拼出多阶段流程。这样写会直接运行失败。
- **正确做法**：把多阶段折叠进**单个** workflow 的多个 `phase()`。本项目即把交付 Skill 的 8 阶段折叠为 4 个 phase 在单 workflow 内实现（决策记录采用结论第 11 条；被否决方案第 6 条正是「把 8 阶段做成多个子 workflow 父串联」）。

### A3. 脚本体内直接做 IO / 确定性脚本

- **症状**：在 workflow 脚本体里 `await Read('evidence/..')`、写文件、或直接 `Bash` 调用 `presubmit-scan.sh` 等本机脚本。
- **为什么坏**：Workflow 脚本体**无文件系统 / Node API 访问**。脚本体是隔离的纯 JS 编排层，这类调用会失败（被否决方案第 4 条）。
- **正确做法**：一切 IO 与确定性脚本必须**经子代理**——子代理才拥有 Read/Write/Bash/WebFetch 等工具。例如读 evidence 经 `Explore` 子代理回报，跑 `presubmit-scan.sh` 由带 Bash 的子代理调用并回报结果（决策记录采用第 10 条）。真正的提交前**强制门禁**应落到 PreToolUse Hook 而非脚本体。

### A4. 【P0】在 stage 内对 `prevResult` 调 `.filter(Boolean)`

- **症状**：在 `pipeline()` 的某个 stage 回调里写 `prevResult.filter(Boolean)`，想顺手过滤掉被跳过的 `null`。
- **为什么坏**：**P0 错误**。stage 回调签名是 `(prevResult, originalItem, index)`，stage 内部只收到**单个标量** `prevResult`（上一 stage 对**该 item** 的返回），不是数组；对标量调 `.filter()` 会报错。`.filter(Boolean)` 只能作用于 `pipeline()` / `parallel()` **整体返回的结果数组**。
- **正确做法**：stage 内若发现上游为空，用短路 `if (!prevResult) return null;`，让该 item 落 `null` 并跳过其余 stage；待 `pipeline()` 整体返回后，再对**结果数组**做 `.filter(Boolean)`（决策记录采用第 4 条修正、被否决第 1 条）。

---

## 二、规模与成本类

### B1. 为展示规模堆 agent

- **症状**：按「主题数量」或「看起来更厉害」来开 agent 数，多个 agent 实际在做同一件事、产出高度重叠。
- **为什么坏**：质量来自**独立性而非数量**。同质 agent 既不新增信息，又消耗并发额度与 Token，去重后有效信息寥寥。运行时长和代码量不等于质量。
- **正确做法**：agent 数按「**是否新增独立视角**」分配，而非按主题数量。fan-out 前先设 `budget`，先小样本试跑再外推。**真实案例见 §五(a)**。

### B2. 简单计数器漏长尾（应 loop-until-dry）

- **症状**：用「固定跑 N 个」或「只数一个计数」来决定何时停止采集 / 抽取，剩下的长尾被默默丢掉。
- **为什么坏**：固定计数会在长尾未尽时提前收手，遗漏真实存在的条目，且遗漏量不可见。
- **正确做法**：用 **loop-until-dry**——连续 K 轮无新增才停（K 为示例缺省值，如连续 2 轮新增=0，非 API 约束）。配合最大轮次兜底（见 B3）。

### B3. 无退出条件 / 不可观测退出的循环

- **症状**：`while(true)` 反复 `agent()` 却没有可判定的终止条件；或退出条件依赖不可测指标（如「重复率<10%」）。
- **为什么坏**：可能无限循环、撞上「全生命周期 agent 总数上限 1000」兜底或耗尽 budget；不可测指标无法在脚本里判定，等于没有退出条件。
- **正确做法**：循环必须有**最大轮次**与**固定可观测**的退出条件（如最大 3 轮、某轮新增=0 即停；这些是示例缺省值，非 API 约束）。删除「重复率<10%」等不可测指标（决策记录采用第 13 条）。同时主动查 `budget.remaining()` 降级——budget 是硬上限，超额会在**下一次** `agent()` 调用时抛错。

### B4. 静默截断 top-N / 采样（应 `log()`）

- **症状**：只取前 N 条、随机采样或丢弃部分覆盖面，却不告诉用户丢了什么。
- **为什么坏**：被丢弃的覆盖面对用户**不可见**，让人误以为结果是全量；后续决策建立在隐性缺口上。注意：单次 `parallel()/pipeline()` 超过 4096 item 是**报错而非静默截断**——真正危险的是**人为**的隐性截断。
- **正确做法**：任何截断 / 采样 / 丢弃都必须 `log()` 写明范围与被舍弃部分（采用第 12 条「被丢弃覆盖面必须 `log()`」）。需要随机性时用 index 变化 prompt/label，**不要** `Math.random()`（会抛错、破坏断点恢复）。

---

## 三、质量与证据类

### C1. 让实现者自评

- **症状**：让产出成果的同一个 agent（或同一实例）来评审 / 验证自己的成果。
- **为什么坏**：实现者对自己的产出有盲区与确认偏误，自评通过≠质量合格。
- **正确做法**：**实现者不得自评**。成果必须由**独立**审查 agent 评审，实现 agent 与审查 agent 必须是不同实例；任何 P0 判 FAIL（采用第 12 条）。推荐质量模式：对抗式证伪（多个独立 skeptic 各自尝试证伪，多数证伪则否决）、多视角 lens、评审团。注意**不要**为了对抗而无脑堆 skeptic（见被否决方案第 5 条「按风险开 2-3/4-5/6-8 个 skeptic 的数量矩阵」——无实测支撑、逼近并发上限、本身就是堆 agent 反模式）。

### C2. 把未验证当已验证

- **症状**：未真实执行就写「已验证」「测试通过」。
- **为什么坏**：制造虚假信心，掩盖真实风险；一旦下游据此放行，缺陷直达线上。
- **正确做法**：未真实验证时必须**如实写「未验证」**及原因、剩余风险与建议验证方式（采用第 12 条质量纪律、全局规则第 21 条）。

### C3. 越证据写后果 / 数字（虚假精度）

- **症状**：规范没明示的后果当成结论写（如断言 phase title 不一致会「解析失败」或「进度混乱」）；引用网络博客的精确数字当量化结论（如「Workflow 总 token ≈ 单会话 4 倍」、自创「规模系数」公式）。
- **为什么坏**：规范只要求 `meta.phases[].title` 与 `phase()` **逐字一致**，**未明示**不一致的后果——「解析失败」「进度混乱」两种推测互相矛盾且均无证据。网络博客数字非本机实测、一手锚点无此数据，属虚假精度（被否决方案第 2、8 条）。
- **正确做法**：规范未明示的后果**留白**，只写「须逐字一致」这一硬约束本身。网络来源的精确阈值（如预加载 token、上下文降速比例、CLAUDE.md 行数/字节上限、Hook 返回上限等）一律降为 medium 并标注「**网络来源、未验证**」。成本只以一手可观测量 `budget.spent()/remaining()` 为准（采用第 14 条、跨切原则第 7 条）。

### C4. 照抄未核实的 settings 键

- **症状**：直接照抄网上看到的 settings.json 配置键名（如在 `skillOverrides` 下配 `disable-model-invocation:true`），未对照本机实际规范与项目 settings。
- **为什么坏**：**P0**——该键无证据、疑为臆造（被否决方案第 3 条）。照抄臆造的配置键不会生效，还可能掩盖真正该走的强制层（Hook / permissions）。`disable-model-invocation` 的确切配置位置（SKILL.md frontmatter vs settings 键名）目前**仍未确认**（决策未决第 3 条）。
- **正确做法**：配置门禁前**先读项目实际 `.claude/settings.json`**（本项目现状尚未读，见未决第 4 条），对照本机官方 skills/hooks 规范确认键名后再写。红线要无条件生效应用 PreToolUse Hook（exit 2）或 `permissions.deny` 技术强制，CLAUDE.md 同步写明意图（采用第 9 条、跨切原则第 8 条）。

---

## 四、最小可复用反例（脚本片段对照）

> 仅示意「错」与「对」，完整可运行示例详见 docs/03（控制流示例）与 docs/05（质量模式示例）。以下均为纯 JS、`meta` 纯字面量、禁用 `Date.now()/Math.random()`。

```js
// 反例：stage 内对标量调 .filter（P0）+ 无谓栅栏
const out = await parallel(items.map((it) => async () => {
  const r = await agent(`处理 ${it}`);
  return r.filter(Boolean);          // 错：prevResult 是标量；这里也无跨 item 依赖却用了栅栏
}));

// 正确：pipeline + 标量短路；.filter(Boolean) 只在整体结果数组上
const results = await pipeline(
  items,
  async (prev, item) => agent(`第一步：${item}`),
  async (prev, item) => {
    if (!prev) return null;          // 对：上游空则短路，落 null 跳过其余 stage
    return agent(`第二步：基于上一步结果继续`);
  }
);
const clean = results.filter(Boolean); // 对：整体结果数组上过滤 null
```

---

## 五、两个真实案例

### (a) 本次 6 路研究约 5 路同质 —— 「堆 agent」教训

`wf-methodology-research` 的研究阶段开了 **6 路并行研究**（概念辨析 / 控制流技巧 / 状态与上下文 / 质量保障 / 成本控制 / Skill 转化）。分歧修正阶段明确指出：**6 路中约 5 路高度同质**，大多在复述同一份 `01-workflow-api-ground-truth.md`，去重后**约 1.5 路有效信息**。

- **症状对应**：B1「为展示规模堆 agent」——按「主题数量」切分 fan-out，而非按「是否新增独立视角」。
- **教训**：当多路 agent 的事实来源是同一份一手锚点时，它们必然高度重叠；真正新增价值的只有「Skill 转化」「控制流/成本的设计性综合」等少数视角。
- **改进做法**：研究类 fan-out 应按「**是否新增独立视角**」切分，而非按主题数量；同质主题合并为一路，把省下的 agent 额度投到独立的交叉审查 / 对抗式证伪上。
- **出处**：`evidence/02-research-findings.md`「同质性教训」、`evidence/03-decision-log.md` 开头「元教训」。

### (b) 决策记录中被否决的 9 个方案 —— 反例索引

`evidence/03-decision-log.md`「二、被否决的方案」列出 9 条，可逐条对照本文反模式：

| # | 被否决方案 | 对应本文反模式 |
|---|---|---|
| 1 | 在每个 pipeline stage 内 `.filter(Boolean)`（**P0**） | A4 |
| 2 | 「Workflow 总 token ≈ 单会话 4 倍」当量化结论 | C3 |
| 3 | 在 `skillOverrides` 配 `disable-model-invocation:true`（**P0**，疑臆造） | C4 |
| 4 | 脚本体内 `await Read('evidence/..')` 直接读文件 | A3 |
| 5 | 按风险开 2-3/4-5/6-8 个 skeptic 的数量矩阵 | B1 / C1 |
| 6 | 把 8 阶段做成多个子 workflow 父串联 | A2 |
| 7 | 最小示例搞十步法 + 四象限/五维量化排名 + 高风险多 skeptic 全开 | B1 / C3（「为评估而评估」、违反先最小闭环） |
| 8 | 成本预测引入「规模系数」公式 | C3 |
| 9 | 把读本机资产标为 `official-doc`（应标 `live-env`） | C3（证据强度标注失真） |

> 这 9 条是本项目评审中**真实发生并被否决**的设计；把它们留作反例索引，便于后续设计时自查。

---

## 六、一句话自查清单

- 多阶段？默认 `pipeline()`，别用 `parallel()` 栅栏，除非要全量跨 item 结果。
- 想拆子 workflow 串联？不行，只一层嵌套——折叠进 phase。
- 脚本体里读写文件 / 跑脚本？不行，经子代理或 Hook。
- stage 里对 `prevResult` `.filter`？P0，改 `if(!prev) return null`。
- 开很多 agent？先问「是否新增独立视角」，先设 budget 再小样本试跑。
- 固定计数采集？改 loop-until-dry + 最大轮次。
- 截断 / 采样？必须 `log()` 写明丢了什么。
- 自己评自己？不行，独立审查、P0 即 FAIL。
- 写「已验证」？真跑过才写，否则如实写「未验证」。
- 写后果 / 数字？规范没明示就留白；网络数字标「未经本机验证」。
- 照抄 settings 键？先读项目实际 `.claude/settings.json` 并核实键名。
