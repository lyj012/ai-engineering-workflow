# 出处与署名（Attribution）

本目录下的三份模板 **`build-workflow.md` / `build-prompt.md` / `build-workflow-js.md`**
**原作者：朱立明（zhuliming）**，源自《6月23日 上午10点17分》会议要求整理的「通用 Workflow 方法论模板包」。

- 引入方式：vendor（原样复制，内容未改写），用于与本项目 `plan-from-requirement` 工作流对接，
  形成 **需求 → 方案 → 编码到测试全绿** 的完整链路（见 `../../docs/12-plan-to-coding-bridge.md`）。
- 授权：**已取得原作者朱立明授权，同意在本项目内复用并署名，包含随本项目对外公开（GitHub）发布**。后续若发布范围或用途发生重大变更，再行知会作者即可。
- 角色定位：本包是“写码闭环”侧的**唯一真相源**——桥接脚本只编排，流程细节一律以这三份为准
  （遵循其黄金法则「workflow.md 是唯一真相源，.js 只管编排」）。

## 路径替换说明

模板内 `{{WORKSPACE_ROOT}}` 占位符在原作者机器上默认 `/data/workspace/zhuliming`。
在本项目内复用时，统一替换为本 vendored 目录：

```
{{WORKSPACE_ROOT}}  →  /data/workspace/liuyuanjian/workflow/vendor/zhuliming-templates
```

`build-prompt.md`、`build-workflow-js.md` 各有 1 处 `/data/workspace/zhuliming` 示例路径，
按上表替换即可；模板正文逻辑无需改动。

## 与本项目的关系

| 本项目（刘远键） | 朱立明模板包 |
|---|---|
| `plan-from-requirement`：需求 → 可执行方案（只读，不写码） | `build-workflow`：通用任务模板，**闭环优先 → 写码到测试全绿** |
| 产出 `final-plan.md` / `plan.json` / `test-plan.json` | 消费上述方案，驱动 Implement→Review→Fix |

桥接器 `deliver-from-plan.js` 把前者产物翻译成后者要的输入，二者通过文件产物松耦合衔接。
