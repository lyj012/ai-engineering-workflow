# Workflow 提示词速查(复制即用)

> 配合 `build-workflow.md`(通用 workflow 模板)使用。日常就用 **第一条三合一提示词**:
> 填好方括号 → 粘进 Claude Code → 它自动搭骨架、执行、复核。
>
> ⚠️ 发之前先自问一句:**"做完了,用哪条命令能自动证明?"**
> 答得上 → 这就是个好任务,发;答不上 → 先别发,把 DONE 想清楚(比改提示词重要 10 倍)。
>
> 📌 下文 `{{WORKSPACE_ROOT}}` = 你存放这套模板的目录(本机默认 `/data/workspace/zhuliming`),
> 粘贴前替换成你的实际路径(若就在该目录工作可保持默认)。

---

## ① 三合一(新建任务 → 执行 → 复核,一条搞定)★ 主力

```
读 {{WORKSPACE_ROOT}}/build-workflow.md,严格按它的 §1–§10 执行。
分三个阶段连续做,除"确认点/中断条件"外不要停下来问我。

【任务规格】
- 任务名:[task-name]
- 要做的事:[一句话讲清把什么变成什么]
- INPUT:[素材在哪,如 input/xxx]
- OUTPUT:[产物写到哪,如 output/xxx]
- DONE(最关键,必须是一条能自动判对错的命令):
  [如 bash tests/run_verify.sh,退出码 0 即完成;若实在无法自动判,改写成可逐条打勾的验收清单]
- 关键难点:[提醒你注意的坑,可留空]
- 建在:{{WORKSPACE_ROOT}}/[task-name]-workflow/

【阶段一·搭骨架】
在上面"建在"的路径下,按 §1–§10 建目录(input/ output/ tests/ state/scratch/)、
填好 workflow.md、初始化 state/todo.md 与 progress.md、写出 DONE 对应的验证脚本。
★ 确认点:做完后停下,做两件事证明验证脚本可信——
   (a) 现在空跑 DONE,证明它能正确判"未完成";
   (b) 临时塞一个明显正确的产物,证明它会判"通过";验完删掉。
   然后把 workflow.md 的 §2 变量和 §8 验收贴给我看,等我回"继续"再进阶段二。

【阶段二·执行】
按 workflow.md §4 循环跑到 DONE 通过:取子单元→在 scratch 推导→改 OUTPUT→跑 DONE→记一条 progress。
- 每 3 轮必须在 progress.md 写一条 REVIEW cycle N(回答:方向有没有偏/有没有更短路径/是否在重复犯错),没写不许进下一轮。
- 不懂的自己查(搜索/读文档/写最小样例验证),不要停。
★ 中断条件(命中就停下汇报,别硬跑):
   (a) 同一处连续 5 轮仍不通过;(b) 出现需要我做产品/取舍决策的岔口;(c) DONE 脚本本身报错而非测试不过;
   (d) 触及不可逆/破坏性操作(删库删表、数据迁移、批量覆盖、git push -f)、生产环境/对外动作、或密钥权限支付安全。

【阶段三·复核】
DONE 通过后执行 §7 协同:把产物和本轮结论写进 state/handoff.md;
另起一个"只读、不许改"的 review 角色,按 workflow.md §7.1 的视角(默认 correctness/robustness/readability)挑问题,结论写回 handoff.md。

【收尾汇报】
给我:① DONE 的最终输出;② progress.md 摘要(几轮完成、关键单元怎么解决);③ review 结论与是否需要我处理的项。
```

---

## ② 跑现成任务(目录和 workflow.md 已存在时)

先 `cd` 到任务目录,再粘:

```
读 workflow.md,严格按 §1–§10 执行,一直跑到 DONE 通过。
全程记 state/(todo 勾选、progress 每轮一条、scratch 放推导);
每 3 轮必须在 progress.md 写一条 REVIEW cycle N(方向有没有偏/有没有更短路径/是否在重复犯错),没写不许进下一轮;
不懂的自己查、不要停。命中中断条件(连续 5 轮不过 / 需我决策 / 脚本自身报错 / 触及不可逆·生产·密钥权限支付安全)就停下汇报。
收尾把 progress.md 摘要和这次习得了什么发我。
```

---

## ③ 多 agent 编排版(已有 .claude/workflows/xxx.js)

```
用 workflow 跑 [workflow名]
```

---

## ④ 单独触发协同复核(产物已就绪,只想要 review)

```
执行 workflow.md §7:把 output/ 的产物和结论写进 state/handoff.md,
再开一个只读、不许改的 review 角色,按 workflow.md §7.1 的视角(默认 correctness/robustness/readability)挑问题,结论写回 handoff.md 并汇报给我。
```

---

## 几条让效果更好的习惯(对应会议要求)
- **一次别提太多点**:要求控制在 3–5 条("提 20 个点 AI 辐射不过来")。
- **每次都写"不要停、自己查"**:这是把它从"问一句答一句"变成"自己往前跑"的开关。
- **始终要求记 state/**:你看 progress.md 就能学它怎么干的,顺便满足"每天习得了什么"。
- **DONE 优先闭环**:能写成命令就写命令;实在不能再退而求其次用可打勾的验收清单。
