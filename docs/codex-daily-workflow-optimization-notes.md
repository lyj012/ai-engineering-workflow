# Codex 日常 Workflow 优化建议

本文只记录当前阶段值得优化的点，不改变现有 Workflow 引擎、状态枚举或交付门禁。

## 0. 已采纳的日常闭环交付规则

当用户明确调用 `ai-engineering-workflow` 做修改类任务时，默认结果不应该只是“改完文件”。
日常路径应完成轻量闭环：

```text
实现修改 -> 执行验证 -> pre-push-check -> 只提交本次任务文件 -> 正常 push -> 验证远程 HEAD
```

这不是 Full Workflow。它不默认包含正式需求分析、风险分析、计划产物、沙箱实现、独立 review 或独立
verification。只有高风险、强审计、正式完整交付或用户明确要求时，才升级 Full Workflow。

遇到以下情况必须在 git 写入前停止：

- 用户明确说不提交或不推送；
- 工作区存在无法安全区分的无关改动；
- 发现 `.env`、token、key、个人配置、`AGENTS.md`、调试日志或其他不应提交文件；
- 必要验证失败；
- 分支、远程或发布策略不明确；
- 目标分支受保护，或发布本身涉及高风险条件。

## 1. 明确默认定位：带护栏的直接开发

当前最容易产生误解的是名字里有 "Workflow"，用户会自然联想到完整流程、慢、多 agent、高 token。

建议把默认定位明确为：

> 默认是直接开发，但带边界、验证和交付收口；只有明确要求或高风险任务才升级 Full Workflow。

这意味着普通需求不应该默认进入完整链路。日常路径应该接近直接写代码：

- 只读相关文件；
- 做最小必要改动；
- 跑最小必要验证；
- 说明已验证和未验证范围；
- 不做无关重构；
- 不自动提交或推送。

## 2. 把 `/dev-fast` 变成隐式默认路径

用户不应该每次都记住 `/dev-fast`。

建议规则：

- 用户说“改一下”“修一下”“加个字段”“调个页面”等普通开发请求时，默认等价于 `/dev-fast`；
- `/dev-feature` 只用于普通但稍完整的小模块、小 CRUD、小前后端闭环；
- Full Workflow 只在明确触发时使用。

这样 Workflow 的存在感会变低，但开发约束仍然生效。

## 3. 收紧 Full Workflow 触发条件

Full Workflow 不应该因为“完整功能”“完整页面”“完整 CRUD”这类表达自动触发。

建议只在以下情况下触发：

- 用户明确要求 complete flow、formal full delivery、strict audit、critical check；
- 涉及支付、权限、认证、金额、回调、会员权益、数据迁移、生产配置、删除数据、安全、多租户隔离；
- 用户明确要求独立 review、独立 verification、沙箱实现或正式审计材料。

普通完整功能可以拆成多个 `/dev-feature`，不需要一次性进入完整流程。

## 4. 增加清晰的验证档位

当前 README 中有 Light verification、Core path verification、Necessary verification，但执行时容易解释不一致。

建议新增验证档位表：

| 场景 | 推荐验证 |
|---|---|
| 文案、样式、小组件、小字段 | `git diff --check`，再选 build/lint/test 中最小相关项 |
| 普通前端改动 | build/lint 或页面 smoke check，覆盖加载、交互、错误态中的核心路径 |
| 普通后端改动 | compile 或 focused test，必要时 smoke 一个核心 API |
| 普通前后端联动 | 检查请求参数、响应字段、加载态、错误提示、重复请求 |
| 提交或交付前 | git 范围、敏感信息、无关文件、实际验证命令、交付摘要 |
| 高风险逻辑 | Full Workflow：分析、计划、沙箱实现、独立 review、独立 verification |

目标是让 Codex 不再猜“轻验证到底多轻”。

## 5. 强化 Pre-Push / Delivery Summary 的价值

日常开发中最有价值的流程可能不是 Full Workflow，而是提交前防止翻车。

建议增加或强化一个轻量入口，例如：

```text
/pre-push-check
```

它只负责交付收口：

- 当前分支和远程；
- 本次任务相关文件；
- 是否存在无关改动；
- 是否误带 `AGENTS.md`；
- 是否误带 `.env`、token、key、个人本地配置；
- 是否有临时日志、调试输出、构建产物；
- 实际运行过哪些验证命令；
- 是否可以提交、推送或需要用户确认。

这个入口比完整流程更适合高频日常使用。

## 6. 固定日常最终回复格式

日常开发不应该输出长篇流程复盘。

建议固定短格式：

```text
改动：
验证：
未验证：
风险：
文件：
```

如果任务很小，可以进一步压缩成一段话。重点是稳定、短、可检查。

## 7. 调整 README 流程图命名

`Codex Flow` 可以考虑改成更准确的名字：

- `Codex Daily Router`
- `Daily Development Router`
- `Codex Development Routing`

这样能减少“启动 Workflow 就会跑完整流程”的误解。

## 8. 把 Full Workflow 描述成保险机制，而不是主入口

Full Workflow 的价值仍然存在，但它不是日常主入口。

建议在 README 和 Skill 中统一表达：

> Full Workflow 是高风险、强审计、正式交付场景的保险机制；日常开发默认走轻量直接开发路径。

这样既保留完整流程能力，也不会让用户因为 token 和时间成本而排斥整个 Workflow。

## 9. 优先优化 Skill 执行语义，而不是继续加引擎能力

当前阶段最值得优化的是：

- 默认路由；
- 验证档位；
- 最终回复格式；
- 提交前检查；
- Full Workflow 触发边界。

不建议优先增加更多 agent、更多阶段或更复杂的产物格式。问题不在能力不足，而在日常使用成本和心理负担偏高。

## 10. 建议的目标状态

最终目标可以概括为：

> 像直接开发一样快，像 Workflow 一样有边界；普通任务不打扰，高风险任务不放水，交付前不糊涂。
