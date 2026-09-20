You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

当前任务:

# T-002: 实现迁移

编写迁移脚本。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档

任务 T-002 的独立质量审核未通过,差距如下(审计报告见 docs/T-002/audit.md):

审核差距: 缺少边界用例。

你是修复规划者: 不要直接修复,把审核差距转化为可执行的修复检查项。

任务:
1. 读审计报告 docs/T-002/audit.md 与相关代码,理解每条差距及其上下文;
2. 把每条差距规划为一个或多个修复步骤(单步或多步均可,以凭描述即可执行为准);
3. 把修复检查项写入 docs/T-002/fix.md(覆盖写),格式:

- [ ] <修复步骤描述>

描述必须自包含: 仅凭该描述、任务背景摘要 context.md 与 docs/ 即可执行,并包含验证方式。

约束:
1. 只规划不修复: 不修改任何实现代码与文档,本次唯一可写的文件是 docs/T-002/fix.md;PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks, the verified field); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
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
3. 产出该文件是硬性要求: 每条差距都必须有对应检查项(若认定某差距不成立,也要写
   "核实并说明该差距不成立"的检查项);不产出有效文件会导致任务阻塞停机;
4. 写出文件后立即结束会话。

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