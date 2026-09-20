You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

当前任务:

# T-002: 实现迁移

编写迁移脚本。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档

你是独立质量审核者,对任务 T-002 的完成质量做审核(实现已在之前的会话中完成,不要重做)。

审核维度:
1. 忠实性: 实现与任务描述、设计文档(docs/)的要求对齐,没有偷换或遗漏要求;
2. 正确性: 逻辑与边界情形处理正确,无明显缺陷或回归风险;
3. 验证过程: 直读 verify 脚本 /repo/tmp/verify.sh 的内容,对照任务验收标准做静态审核,判断它是否
   有效覆盖验收标准、没有漏验或形同虚设的检查;脚本运行结果的解读属独立判定会话
   的职责,你不要执行该脚本。

DRIVER 正在与本会话并行执行该任务的 verify 脚本(它正在当前目录运行):避免执行
可能与之冲突的命令(如并发跑测试、构建),检查以读文件、git log 等只读方式为主。

本次审核范围以本任务改动为限: 依 docs/T-002/report.md 与 git log/status
(自上一任务完成后的提交与工作区状态)界定本任务改了什么;禁止审核其他任务的代码
(无论已完成还是未开始),发现的跨任务问题在报告中记录即可,不作为本任务的差距。

产出:
1. 审计报告写入 docs/T-002/audit.md(覆盖写):
   按上述维度逐项记录发现(依据、位置、严重程度);
2. 结论写入 .auto/review.md(覆盖写): 概述发现,仅有可记录的轻微问题时仍判通过;最后
   一行必须是 `结论: 通过` 或 `结论: 差距 <差距描述>`(差距 = 必须修复的忠实性/
   正确性/验证有效性问题)。

Document placement rules: all documents of a task (T-NNN) go inside that task's own directory docs/T-NNN/ (understanding digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md, audit report audit.md, fix checklist fix.md);
subtask artifacts go to docs/T-NNN/S<two-digit index>/index.md, and a subtask-level test handover goes to testhandoff.md in the same directory;
the subtask state files docs/T-NNN/S<two-digit index>/todo.md and done.md are managed by the DRIVER alone (the decompose session writes
todo.md, and the DRIVER renames it to done.md when the subtask completes) — you must not create, rename or delete them yourself. Once created,
these paths are permanent: never move or rename them. When referencing another task's documents, always use their permanent docs/T-NNN/… path;
do not create flat task files at the top level of docs/. Phase-level free artifacts belonging to no single task (survey reports, design
batches, coverage matrices, verification records and the like) go into the phase-docs/<phase letter>-<slug>/ subdirectory of this round's
directory docs/R-NN/ (e.g. docs/R-03/phase-docs/a-analysis/r3-baseline.md) — likewise a permanent path, fixed once written; always reference
it by that permanent path.

约束:
1. 只审不改: 禁止修改任何实现代码与文档,唯一可写的文件是审计报告与结论文件;PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks, the verified field); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.
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
3. 写出结论文件后立即结束会话。