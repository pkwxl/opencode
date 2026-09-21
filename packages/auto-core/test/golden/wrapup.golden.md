You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

当前任务:

# T-002: 实现迁移

编写迁移脚本。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档

场景模式注意事项(migrate):
Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

该任务的全部子任务已在之前的会话中逐一完成,不要重做。本次会话只执行收尾:

1. 更新 docs/ 中受本任务影响的文档,使下一个会话仅凭磁盘文件就能理解当前进展;
2. 写 docs/T-002/report.md:索引式报告——逐子任务一行(序号 + 一句话结论 +
   产物路径 docs/T-002/S<NN>/index.md 或代码位置),不复制或改写子任务产物的内容,只新增
   整体结论与遗留问题两节,供后续会话与审核者仅凭磁盘文件了解本次任务的产出。报告中的引用(文档或代码)一律
   写目标目录根相对路径(如 docs/T-002/S01/index.md、src/foo.ts:42,反引号或链接,可带
   :行号),写前确认路径存在——失效引用会被 DRIVER 的引用检查拦截;行号锚可能随目标文件
   修改而漂移,DRIVER 会对不一致的锚自动追加 @<sha> 版本标记(该范围仅对标记的历史版本
   有效),已带标记的引用不要自行改动;不要引用轮次目录 docs/R-NN/ 内的状态文件
   (台账 phases.md、阶段归档内的 PLAN 快照);
3. 任务状态由 DRIVER 在会话结束后统一登记。PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.
   结论行:Write it when this task's description asks you to check, test, validate or accept work (an acceptance task), and whenever
   you found that the task's goal was not met. `Result: PASS` means every check the task asked for was actually run or observed
   and passed, with the evidence written in this report; `Result: FAIL` means a required check failed, could not be run, or the
   goal is not met — say why in one line. Never write PASS for a check you did not run or observe. A task that is not an
   acceptance task and met its goal may omit the line.
   结论行写在 docs/T-002/report.md 最后一行正文(终止符之前)、独占一行,只能是
   `Result: PASS` 或 `Result: FAIL <一句话原因>`——这是 DRIVER 协议串,照原样书写,不要翻译、
   不要加粗或加列表符号;DRIVER 读到 `Result: FAIL` 即把本任务置为阻塞、停止运行交人工处理。
4. 本任务执行期间 DRIVER 自动代答了以下本应由你询问用户的问题(无人值守下 DRIVER 代替
   用户把它们闭环了,你当时收到的是自动答复):

   - 策略选 A 还是 B?

   请在 docs/T-002/report.md 中单列「自动代答问题」一节,逐条写
   `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)`——原问题照抄上面列出的,所选方案与
   理由写你当时实际怎么定的。上面每一条都必须出现;你自主识别到的其他代答决策(本应
   由用户拍板、由你替他闭环的分歧点)一并列入,纯实现取舍不要混进这一节。
以上全部完成前不要结束会话。

Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). This is the mechanical criterion for
"a document is finished" and the DRIVER validates artifacts against it — a missing terminator on the last line is treated as unfinished and
sent back for correction; documents that already existed beforehand need no retrofit.

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