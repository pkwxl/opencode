You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

当前任务:

# T-002: 实现迁移

编写迁移脚本。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档

本次审核对象是整个任务(实现已在之前的会话中完成,不要重做)。
先读 docs/T-002/report.md(收尾报告)了解各子任务产出;任务 verify 字段是"command: bun test",作为验收标准。

DRIVER 已在会话外执行了该任务的 verify 脚本,运行信息:

- 脚本: tmp/verify.sh
- 退出码: 1
- 耗时: 1234ms
- 超时: 否
- 输出(stdout 与 stderr 合并整写文件): /repo/tmp/test.1.out

你是独立判定者:实现与脚本执行均由其他会话和进程完成,你只看到磁盘上的结果,
不要轻信任何自报,以你亲自核查(只读检查)的结果为准。

要求:
1. 直读上述输出文件——大文件用分段读取,不要经 bash cat 等工具回显输出
   (会被截断,这正是三段式要避免的);结合收尾报告阅读相关源码与改动;
2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) do not call the question tool —
   decide how to proceed on your own, and if the current stage is already finished, move straight on to the next one.
   A decision of your own must leave a record of how it was made: write the reasoning and the alternatives you considered (and rejected) into the
   relevant document (a design document or report under docs/). Classify each into one of two kinds by "who should have owned this call" —
   a call touching architecture or code changes is annotated in the design document or in a code comment, everything else in the task report:
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment, a
     reality that contradicts the documents), and anything beyond or narrower than the literal scope of the task description. Such a call was the
     user's to make and you closed it on their behalf, so annotate it explicitly with an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, injection method, how tests are written) — annotate it with an `AUTO-DECISION: <decision> (<reason>)` line.
   Example: "whether to close out the third duplicate implementation as well" changes the literal scope of the task, so it is AUTO-RESOLVE;
   "whether the new field is called matched or paired" changes no user-visible behaviour, so it is AUTO-DECISION.
   Annotate a given decision under one kind only, never twice; when unsure use AUTO-RESOLVE — one reminder too many is harmless, a missing annotation is the real loss.
   Calling the question tool for a non-permission problem gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.
3. 禁止直接执行任何验证脚本或验证性命令(运行测试、构建、lint、启动服务等)——
   验证的执行权在 DRIVER,执行结果一律以上述输出文件为准;只读检查
   (读文件、git log/status、grep 源码)不受此限;
4. 若认定现有脚本本身有问题(写法错误、路径不对、环境不适用)或未能覆盖验收
   标准:编写新的验证脚本替换 /repo/tmp/verify.sh(覆盖写并 chmod +x),在判定文件中
   说明原因,末行写 `结论: 重验 <原因>`;DRIVER 会亲自执行替换后的脚本并把
   stdout/stderr 合并整写回传到同一输出文件,由新的判定会话继续判定;
5. 退出码非 0 或超时不直接判不通过:先从输出判断实际原因;属于脚本本身问题的
   按上一条重验处理,不要据此误判实现差距;
6. verify 经验沉淀(可选): 仅当本次判定发现预设验证命令/脚本存在会重复出现的
   通病(写法错误、路径不对、环境不适用等),才把 PLAN.md 中后续未完成任务里
   同样有问题的 verify 字段更新为修正后的命令(保持 `command: <命令>` 单行
   格式),使后续任务不再踩相同的坑;当前验证脚本没有此类问题时不要做任何修改。
   DRIVER 已在本会话期间临时放开了 PLAN.md 的写权限,会话结束后恢复并校验——
   仅限 verify 字段,任务状态、检查项与正文一律不改,越权编辑会被整体还原。
   后续未完成任务的 verify 字段现值:
   - T-003: API 返回 200;
7. 只判定不修复: 禁止修改任何实现代码与文档,你可写的文件只有判定文件、第 4 条
   的替换脚本与第 6 条授权的 verify 字段;CURRENT.md 由 DRIVER 独占维护,不得编辑;
8. 把判定写入 .auto/verify.md(覆盖写):简述判定依据与你实际执行的检查;若你
   替换了脚本并最终判定通过,附一行 `verified-command: <新脚本的核心命令>`
   (独立成行);最后一行必须是 `结论: 通过`、`结论: 差距 <差距描述>` 或
   `结论: 重验 <原因>`;
9. 写出判定文件后立即结束会话。