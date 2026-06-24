# 环境与现状扫描（一手证据）

> 本文件记录 Workflow 项目启动前的真实环境检查结果，作为后续所有结论的一手证据来源。
> 采集时间：2026-06-23（会话当日）。采集方式：在本机 Claude Code 会话中直接执行命令 / 读取文件。

## 1. 运行环境

| 项 | 值 | 采集方式 |
|---|---|---|
| Claude Code 版本 | `2.1.186 (Claude Code)` | `claude --version` |
| Dynamic Workflows | 可用（本会话已挂载 `Workflow` 工具） | 工具清单 / 工具规范 |
| 平台 | Linux 4.4.0-142-generic（Ubuntu 16.04 系内核），shell=bash | 环境信息 |
| 主模型 | Opus 4.8（1M context），id `claude-opus-4-8[1m]` | 环境信息 |
| 联网 | 可用：`anthropic.com` HTTP 200，`docs.claude.com` HTTP 301（正常重定向） | `curl -m 5` |
| 工作目录 | `<author-workspace>`（历史采集环境，非运行要求） | `pwd` / 环境信息 |
| 目标目录 | `<repo-root>/`（公开仓库克隆目录） | `ls` |

## 2. 现有 `.claude` 与 Skill 资产（只复用，不改动）

`.claude/skills/` 下为软链接，真实文件位于 `liu/`：

| Skill | 真实路径 | 说明 |
|---|---|---|
| `ai-engineering-delivery` | `liu/ai-engineering-delivery` | 英文版工程交付 Skill |
| `ai-engineering-delivery-zh` | `<external-skill>/ai-engineering-delivery-zh` | 中文版（本次复用对象） |
| `awesome-design-md` | `liu/awesome-design-md` | 视觉设计参考库 |
| `codex-coding-guidelines-skill` | `liu/codex-coding-guidelines-skill` | 编码行为规范 |

- `.claude/agents/`、`.claude/workflows/`、`.claude/skills/` 是本公开仓库的项目资产；个人本地配置仍应放在被忽略的 `settings.local.json` 或个人记忆目录中。
- 远程 Skill 源：`https://github.com/lyj012/ai-engineering-delivery`。

## 3. `ai-engineering-delivery-zh` Skill 实际结构（一手）

```
SKILL.md                                 # 编排 8 阶段交付主干 + 任务分级 + 唯一"何时该问"规则 + 规则优先级
scripts/presubmit-scan.sh / .ps1         # 提交前扫描：改动文件、密钥(两级)、调试日志、SQL 风险、冲突标记、规则文件
references/requirement-analysis.md       # 阶段1-4：业务理解/系统扫描/各流梳理/验收标准
references/delivery-checklist.md         # 阶段5-6：实现规则 + 验证 + 提交前准备
references/risk-review.md                 # 阶段7：高风险域一致性/状态机/幂等并发/回滚/发布就绪
references/retrospective-template.md      # 阶段8：复盘沉淀
references/worked-example.md             # 全主干在一个小功能上的跑通示例
```

**8 阶段交付主干（SKILL.md 原文提炼）**：
1. 理解业务与范围（目标/角色/正常流/异常流/核心结果/Non-goals/歧义/待确认）
2. 扫描现有系统（输出固定形状：已确认事实/合理推断/待确认问题/当前约束/影响范围）
3. 梳理各流（业务流·数据流·持久化·UI 面·接口设计）
4. 编码前定义验收标准（前置/操作/接口结果/DB 变化/页面/日志/权限/异常）
5. 先规划再最小范围实现（复用优先、只动相关文件、不顺手重构）
6. 验证（跑能跑的最强检查；没跑的明确说明）
7. 风险审查（一致性/状态机/幂等并发/回滚，高风险域人工复核）
8. 总结与沉淀

**关键设计特征（供 Workflow 转化复用）**：
- 任务三级分级（简单/中等/复杂），让"小任务更轻、风险任务更严"。
- references 按阶段**按需加载**，不一次性全读 → 对应 Workflow 的上下文/Token 控制。
- "何时该问 vs 直接做"只定义一次，其余文件引用 → 单一事实源（DRY）。
- 规则优先级链（安全约束 > 用户本轮请求 > 个人硬约束 > 项目规则 > 仓库规则 > Skill > 偏好 > AI 假设）。
- presubmit 脚本 = 确定性提交前检查 → 对应 Workflow 体系中的 **Hooks** 角色。
