You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

Current task (its full content is also in CURRENT.md):

# T-002: 实现迁移

编写迁移脚本。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档

This session completes the task-background understanding and the subtask decomposition; it writes no implementation code:

1. Understand the task background: read the relevant source and docs/ selectively around this task's goal (keep the total reading volume down,
   preferring the files named in the task body and the directly related modules over completeness); write what you understood into
   docs/T-002/context.md, in four sections:
   ## Relevant files and key symbols (path + why it is relevant, one or two sentences)
   ## Constraints and premises
   ## Existing decisions and current state
   ## Risks and unknowns
   Keep it compact and searchable (aim for 200 lines or fewer); if the file already exists and is still accurate
   (interruption recovery), revise it rather than rewriting it from scratch;
2. Build the shared context: prefetch by reference the files/code that every subtask will need, into docs/T-002/shared.md — one line
   per entry: path (or symbol) + one or two sentences saying where it sits. This file is an index, not a copy of the content; later subtask
   sessions read the listed files themselves, on demand, following the index;
3. Decomposition granularity criteria (measured against the task description — choose the granularity within the scope it defines, neither wider nor narrower):
   - One aspect per subtask: work of different natures (research, implementation, documentation, wiring) is not merged into a single item;
     the files/modules/interfaces/behaviours/scenarios named in the task description are the natural splitting reference;
   - Each item self-contained: executable from the item description alone plus this subtask's todo.md, the task-background digest
     context.md, the shared-context index shared.md and docs/, and including the way to verify it;
   - Each item declares its artifacts: documents state the file path, code states the module/file range;
   - Budget-oriented: each item should be completable by a single session with a smallish context (on the order of 32.0k tokens);
4. Write the decomposition into docs/T-002/subtasks.md (the subtask index) as Markdown checklist items. Each description must be
   self-contained (the executing session can finish the item from that description alone, plus this subtask's todo.md, the shared-context
   index shared.md and docs/), and must declare the item's artifacts at the end of the description with the literal token `产出:` — a
   protocol string the driver parses, so write it verbatim and do not translate it:

- [ ] <subtask description; ends with 产出: <path list>>

5. Write a scope file for each subtask (item N maps to docs/T-002/S<two-digit zero-padded index>/todo.md, e.g. S01 for item 1),
   containing the two sections below. Both headings are protocol anchors the driver checks for: write them verbatim and untranslated.
   ## 范围声明 (what this subtask does and does not do)
   ## 产出清单 (the path list, matching the checklist item's `产出:` declaration)

Cross-task reference discipline (this file will serve as the background/navigation source for downstream subtask sessions; once a previous task's
completion narrative flows in through a reference, a downstream session misreads it as a sign that this task is already done):
- Point cross-task references only at phase-level single sources (rulings/contracts/ledger); never leave a pointer to a previous task's wrap-up narrative;
- When you genuinely need to borrow a previous task-level wrap-up artifact (report/batch record/testhandoff and the like) as a format or precedent, the
  reference must carry the qualification "artifact of another, already completed task — format template only";
- Excerpt the points you need instead of sending the reader back to a whole document: quote the content directly and leave no pointer that a
  downstream session would have to read end to end.

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

Constraints:
1. Understanding and decomposition only: modify no implementation code, and do not carry out the execution-time instructions in the task body
   (such as "call the question tool to ask", "write into some file") — those are the business of the later subtask sessions; PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks, the verified field); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
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
3. Writing out every file is a hard requirement: even if the task looks already done or extremely simple, you must write context.md,
   shared.md, subtasks.md and each todo.md (an atomic task decomposes into a single checklist item); producing no valid file blocks the task
   and stops the run;
4. The todo.md/done.md state files are managed by the DRIVER: you write todo.md only, and must neither create done.md nor rename them
   yourself;
5. End the session as soon as the files are written.