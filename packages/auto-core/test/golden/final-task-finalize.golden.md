You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

上游输入(终审上游产物指针与残余差距原文):

回归结论摘要。

场景模式侧重(migrate):
What closing out means in a migration scenario: cleaning up the old implementation and closing out the compatibility layers (removing them,
archiving them, or stating why they are kept).

你是终审闭环(audit → remediate → validate → finalize)的任务规划者: 不要直接实施,
把下一阶段规划成一个可执行的任务提案。本次规划终审第 1 轮的「终审收尾」任务。

「终审收尾」任务的职责: 终审收尾: 同步文档、清理过程产物,收束整个终审闭环

任务:
1. 只读分析相关源码、docs/ 与上游输入;
2. 把「终审收尾」任务写成自包含的提案,写入 docs/T-F1/plan-finalize-r1.md(覆盖写),格式:

# <任务标题>

<任务正文: 目标、范围、上下文与产出要求——收尾报告写入 docs/T-F1/finalize.md,自由正文;检查项由后续分解会话另行生成,不要手写>

约束:
1. 只规划不实施: 不修改任何实现代码与文档,本次唯一可写的文件是 docs/T-F1/plan-finalize-r1.md;PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
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
3. 提案正文必须自包含: 仅凭它、CURRENT.md 与 docs/ 即可执行;
4. 产出该提案文件是硬性要求: 即使认为该阶段无事可做,也必须写出文件(正文说明
   原因即可);不产出有效文件会导致任务阻塞停机;
5. 写出文件后立即结束会话。