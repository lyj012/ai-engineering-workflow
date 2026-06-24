# 11 主工作流：plan-from-requirement（需求 → 可执行实现方案）

> 脚本：`.claude/workflows/plan-from-requirement.js`　产物：`evidence/plans/<时间戳>/`（含 `final-plan.md` 或 `clarification.md`）。
> 这是本项目当前的**主工作流**。`analyze-repo`（docs/10）退为"通用仓库审计"的独立次能力，二者共享同一套引擎。

## 1. 定位（与 analyze-repo 的区别）

- **analyze-repo**：不带需求的**通用审计**——"这个仓库有哪些风险"。
- **plan-from-requirement**：**需求驱动的方案生成**——"客户要做 X，基于现有代码，开发该怎么做"。全程围绕**一条客户需求**，最终产出**开发可直接照做的实现方案报告**。

> 当前阶段**只读分析 + 方案设计**：不编写客户代码、不提交/合并/部署。

## 2. 核心输入 / 输出

- 输入：`requirement`（客户需求，必填）、`target`（目标仓库，必填）、`constraints`（已知约束）、`mode`（分析深度，可省略→自动选档）。
- 输出：一份 `final-plan.md`（含需求理解/相关代码现状/差距/实现方案[复用·修改·新增]/影响面/风险/测试与验收/追踪矩阵/评审与返工历史/最终状态），以及全套结构化 JSON 产物，落在带时间戳的运行目录、不覆盖历史。

## 3. 执行流程（含分级三路）

```text
Preflight → Requirement(需求理解) → Triage(分级)
                                      ├─ clarity 不足  → Clarify：产出「待确认清单」，不出方案（status=NEEDS_CLARIFICATION）
                                      ├─ simple 且无高风险 → 快路径：Locate → Plan(精简,含简要风险+验收) → Review → Report
                                      └─ medium/complex/高风险 → 完整流程：Locate → Analyze → Gap → Plan → Risk → TestPlan → Review →(Rework)→ Report
→ Persist(落盘)
```

- **澄清闸门**（最高优先，参考 Skill 的"何时该问 vs 直接做"）：需求模糊到会实质影响方案时，**停下来产出待确认清单，不猜着出方案**。
- **三级分级**（参考 Skill `SKILL.md` 的"先给任务分级"+ 升级到复杂的触发器）：简单且无高风险走**快路径**（省）；中等/复杂/触及高风险（支付/会员/权限/认证/状态机/数据迁移/文件/回调…）走**完整流程**；**高风险永不走快路径**。
- **自动选档**：不传 `mode` 时按复杂度自动选 lite/standard/deep；传了以用户为准。`forceComplexity` 可覆盖分级，`skipClarificationGate` 可跳过闸门（测试用）。

## 4. Skill 如何被参考（参考，不机械套用）

把 `ai-engineering-delivery(-zh)` Skill 当**维度参考**，由对应阶段子代理按需 `Read`，并按本项目实际技术栈/需求**动态裁剪**：
- **需求理解** ← `references/requirement-analysis.md`（业务目标/角色/正常异常流/核心结果/Non-goals/歧义/待确认）
- **分级判定** ← `SKILL.md` 的任务分级与升级触发器、唯一 ask 规则
- **实现方案** ← `references/delivery-checklist.md`（最小改动/复用优先/接口稳定/权限后端/DB 显式）
- **方案风险** ← `references/risk-review.md`（一致性/状态机/幂等并发/回滚）

> 每处 prompt 都明确："按实际技术栈与需求动态裁剪，不照搬其后端分层术语。"Skill 目录可经 `skillDir` 参数配置。

## 5. 继承的质量与健壮性（与 analyze-repo 同源引擎）

实现者不自评的**独立审查** + **有界返工复评**（任何 P0→FAIL）；每条风险带**证据链**(path/symbol/lineRange，禁编造行号)；**风险↔测试、需求↔验收**可追溯；**确定性产物一致性校验**（覆盖单调/追踪完整/证据完整/方案非空/状态语义/验收非空）；**失败降级**（必需阶段 halt+重试、可降级阶段记缺口）；状态枚举 `PASS / PARTIAL / CONDITIONAL / FAILED_WITH_FINDINGS / FAILED / NEEDS_CLARIFICATION`；**子代理落盘**到带时间戳运行目录。

## 6. 真实验证结果（一手）

| 场景 | 输入 | 结果 | 证据 |
|---|---|---|---|
| 完整路径 | "给 presubmit-scan.sh 加 --json 模式" | 真出开发级方案（reuse/modify/add+行号证据+8 验收+风险↔测试），并自识别"JSON schema 未定义"→ `needs-clarification` | `evidence/plans/20260623-173646/` |
| **澄清闸门** | "把项目优化得更好用更专业"（模糊） | `NEEDS_CLARIFICATION`，给 A–F 澄清维度，**未出方案**，~5 agent 即停 | `evidence/plans/20260623-175322/clarification.md` |
| **快路径** | "给 SKILL.md 加一行版本号注释"（简单） | Triage=simple/no-risk → fast/lite → `ready` 方案，~8 agent，无返工 | `evidence/plans/20260623-175415/` |

> 已知并已修：快路径早期会因"定位数>档位上限"误判 PARTIAL，已改为快路径取全部相关（上限 8）不计入降级；评审 score 刻度锁定 0–100。

## 7. 当前边界（未攻克 / 固有天花板）

1. **大仓库"按需求定位代码"的召回无机制保证**——表现良好（labplot 选对核心）但非结构性保证。
2. **"通过审查的方案 ≠ 保证正确"**——PASS 仅代表可信、有据、看着可行，不代表跑得通（当前不写代码）。
3. **成本/时延**：真实目标可达数十分钟、数十万~百万 token；分档缓解。
4. **澄清"与客户来回"闭环、迭代式定位**（方案暴露新依赖时回头扩大定位）——尚未实现，列为下一增量。
5. transient API 断连是真实运营因素，降级可扛但覆盖会掉。

## 8. 运行方式

```text
Workflow({ scriptPath: ".../.claude/workflows/plan-from-requirement.js", args: {
  requirement: "<客户要实现什么>", target: "<目标仓库>",
  constraints: ["<约束>"], mode: "standard"（可省→自动选档）,
  outDir: "/abs/path/evidence/plans"
}})
```
详见 `.claude/workflows/README.md` 的 Quick Start。
