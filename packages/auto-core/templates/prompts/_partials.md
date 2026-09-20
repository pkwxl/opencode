# Shared prompt partials

Session templates (`templates/prompts/*.md`, or overrides under the target directory's
`.opencode/auto/prompts/`) reference the `## <name>` sections here through `{{> name}}`;
when a reference sits on its own line, the leading indentation is applied to every line of
the partial. Keep the section names unchanged when overriding this file, otherwise the
templates that reference them fail at render time.
Optional content blocks (blocking remarks, mode notes and the like) are deliberately not
partials — a conditional section swallows the whole line on its empty branch, so each
template writes those inline.
When a conditional section carries two whole-branch replacement texts inside a partial
(like the two `ask` branches of question-rule), the opening and closing tags must sit on the
same line as the content (`…{{/if}}{{#if x}}…`): a tag alone on its line swallows that line
together with its newline, while the newline left between the two branches falls outside both
branches and is emitted unconditionally — leaving a trailing blank line at the end of the
partial that glues onto the next line at the call site.

## head
You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

{{#if doneList}}These tasks are already done, do not redo them:
{{doneList}}{{/if}}{{^doneList}}No task in the plan is done yet.{{/if}}
## question-rule
{{^ask}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
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
   Calling the question tool for a non-permission problem gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.{{/if}}{{#if ask}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else, proceed by "who should have owned this call":
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment, a
     reality that contradicts the documents), and anything beyond or narrower than the literal scope of the task description. For these, ask
     directly with the question tool instead of deciding in the user's place; when unsure, ask — the cost of one question is far smaller than the
     cost of one wrong decision made in the user's name;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, injection method, how tests are written) — decide it yourself, no record required.
   When nobody is at the keyboard your question is answered automatically; the DRIVER has recorded that proxy answer in full, so carry on according
   to the reply, and if the current stage is already finished, move straight on to the next one.
   Asking the same question again blocks the task and stops the run — do not rephrase and re-ask a question that has already been answered.{{/if}}
## state-rule
PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks{{#if verify}}, the verified field{{/if}}); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.
## ground-state
Authoritative DRIVER ledger state (this is the only basis for the progress of this task and this subtask — never infer whether this task is done from other tasks' documents, handovers or git commit records):
- Current task: {{taskId}} "{{taskTitle}}", status: {{taskStatusText}};{{#if qualifiedId}}
- Fully qualified id of this subtask: {{qualifiedId}}; S-numbers appearing in other tasks' documents or commit records belong to those tasks and are unrelated to this one;{{/if}}{{#if subtaskSnapshot}}
- Subtask tick snapshot for this task: {{subtaskSnapshot}}; ticks are maintained by the DRIVER once each subtask session ends and do not change during a session;{{/if}}{{#if doneIds}}
- The previously completed tasks {{doneIds}} are independent of this task, and their wrap-up/completion narratives say nothing about this task's progress; their documents may be consulted only as a format/precedent reference, never as evidence that "this task (or this subtask) is done".{{/if}}
## digest-rule
Cross-task reference discipline (this file will serve as the background/navigation source for downstream subtask sessions; once a previous task's
completion narrative flows in through a reference, a downstream session misreads it as a sign that this task is already done):
- Point cross-task references only at phase-level single sources (rulings/contracts/ledger); never leave a pointer to a previous task's wrap-up narrative;
- When you genuinely need to borrow a previous task-level wrap-up artifact (report/batch record/testhandoff and the like) as a format or precedent, the
  reference must carry the qualification "artifact of another, already completed task — format template only";
- Excerpt the points you need instead of sending the reader back to a whole document: quote the content directly and leave no pointer that a
  downstream session would have to read end to end.
## eof-rule
Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). This is the mechanical criterion for
"a document is finished" and the DRIVER validates artifacts against it — a missing terminator on the last line is treated as unfinished and
sent back for correction; documents that already existed beforehand need no retrofit.
## doc-layout
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
