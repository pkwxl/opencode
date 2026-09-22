你是本次实施计划的规划者: 通读下方输入,把要完成的全部工作规划成一组循序渐进、
可独立交付的任务,写成任务索引与各任务的任务文档。只规划、不实施——除任务索引与
任务文档外不要修改任何文件。

## 输入: 实施提示词

实施提示词全文(固定输入)。

## 输入: 项目意图(.opencode/auto/brief.md)

项目意图。

## 任务

1. 只读勘察目标目录现状、相关源码与 docs/ 已有内容,充分理解上述输入;
2. 把输入拆解为一组任务,按执行顺序写成任务单元——每个任务一份任务文档,外加任务索引中
   的一行:
   - 任务文档 docs/T-NNN/todo.md(每个任务一个目录),格式:

# T-NNN: <任务标题>
Phase: R-01.P01

## Goal
<目标: 该任务交付什么>

## Scope
<范围: 涉及的模块/文件、关键约束与必要上下文——自包含,仅凭它、CURRENT.md 与 docs/ 即可执行>

## Acceptance
<完成判据: 怎样算完成>

<!-- auto: eof -->

   - 任务索引 docs/R-01/P01-implement/tasks.md,按执行顺序每个任务一行:

- [ ] T-NNN <任务标题>

   标题行、`Phase:` 字段行、三个小节标题、索引行与末行终止符由 DRIVER 解析,照上面的
   原样写,不要翻译或改写;
3. 任务编号自 T-001 连续递增,不得复用已有任务目录的编号;每个任务聚焦一个
   可独立交付的成果,颗粒度以单个会话在较小上下文预算内可完成为宜;不要手工编写
   子任务检查项(执行时由 DRIVER 的分解会话自动生成);存在依赖顺序时按可执行顺序排列(依赖前项的排在后)。
4. 规划完成、写出任务索引与全部任务文档后立即结束会话。

## 约束

1. 本会话只写任务索引 docs/R-01/P01-implement/tasks.md 与各任务的 docs/T-NNN/todo.md;不要创建 done.md
   (完成改名由 DRIVER 执行);CURRENT.md 与其余状态文件为只读,不得编辑,
   也不要用 chmod 等方式改动文件权限;git 提交由 DRIVER 在会话结束后统一执行,
   你不要运行 git commit 等提交命令。
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
3. 任务索引至少要有一个任务: 即使认为无事可做,也必须写入一个说明性任务并在其
   任务文档中说明原因;不产出有效任务会导致阻塞停机。

Document placement rules: all documents of a task (T-NNN) go inside that task's own directory docs/T-NNN/ (understanding digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md);
subtask artifacts go to docs/T-NNN/S<two-digit index>/index.md, and a subtask-level test handover goes to testhandoff.md in the same directory;
the subtask state files docs/T-NNN/S<two-digit index>/todo.md and done.md are managed by the DRIVER alone (the decompose session writes
todo.md, and the DRIVER renames it to done.md when the subtask completes) — you must not create, rename or delete them yourself. Once created,
these paths are permanent: never move or rename them. When referencing another task's documents, always use their permanent docs/T-NNN/… path;
do not create flat task files at the top level of docs/. Phase-level free artifacts belonging to no single task (survey reports, design
batches, coverage matrices, verification records and the like) go into the current phase's directory docs/R-NN/P<nn>-<type>/ inside this
round's directory (e.g. docs/R-03/P01-analysis/r3-baseline.md) — likewise a permanent path, fixed once written; always reference it by that
permanent path. The phase index docs/R-NN/phases.md and each phase directory's todo.md / done.md are managed by the DRIVER alone — you must
not create, rename or edit them.