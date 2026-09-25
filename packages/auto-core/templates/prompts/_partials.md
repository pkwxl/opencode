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
The `plan-duties-<key>` sections are the phase-plan duty paragraphs, one per phase type; the
phase-type registry (`src/phases/registry.ts`, `dutiesRef`) picks the section, so a new type
adds a section here instead of a branch in phase-plan.

## head
You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

{{#if doneList}}These tasks are already done, do not redo them:
{{doneList}}{{/if}}{{^doneList}}No task in the plan is done yet.{{/if}}
## question-rule
{{#if humanQuestions}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else where the call is the user's to make (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment), ask with the question tool —
   a human is attending this planning run and the DRIVER waits for the answer with no timeout; there is no automatic proxy answer, so never decide in the user's place and never leave
   an `AUTO-RESOLVE` marker in this session. Plain engineering trade-offs that were always yours remain yours, no record required.
   Asking the same question again after it was answered blocks the task and stops the run.{{/if}}{{^humanQuestions}}{{^ask}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) do not call the question tool —
   decide how to proceed on your own, and if the current stage is already finished, move straight on to the next one.
{{#if decisionsUnattended}}{{decisionsUnattended}}{{/if}}{{^decisionsUnattended}}   A decision of your own must leave a record in the relevant document or code comment: a call that should have been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, any other call an `AUTO-DECISION: <decision> (<reason>)` line.{{/if}}
   Calling the question tool for a non-permission problem gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.{{/if}}{{#if ask}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
{{#if decisionsAsk}}{{decisionsAsk}}{{/if}}{{^decisionsAsk}}   for anything else, ask with the question tool when the call should have been the user's, and decide it yourself when it was always yours.{{/if}}
   When nobody is at the keyboard your question is answered automatically; the DRIVER has recorded that proxy answer in full, so carry on according
   to the reply, and if the current stage is already finished, move straight on to the next one.
   Asking the same question again blocks the task and stops the run — do not rephrase and re-ask a question that has already been answered.{{/if}}{{/if}}
## state-rule
todo.md → done.md renames and the index ticks of phases, tasks and subtasks are maintained by the DRIVER alone — do not make them yourself.
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


## task-depends
Optional dependency fields, placed right after the `Phase:` line of a task document: `Depends: T-011, T-012` means the task starts only
after the listed tasks are done — name tasks of this phase's index or already completed tasks of earlier phases, by id only; without the
field a task depends on the task before it in the index (serial order), and `Depends: none` declares a task with no prerequisite.
`Touches: src/dma/, include/dma.h` lists the repository-relative paths the task will change (no absolute paths, no `..`); without it the
task may touch anything. Both field names are protocol strings the DRIVER parses — write them verbatim; an empty value, a task depending on
itself and a dependency cycle are rejected.
## subtask-depends
Optional dependency fields, placed as the first lines of a subtask's todo.md (before `## Scope`): `Depends: S01, S03` means the subtask
starts only after the listed subtasks of this task are done — item N of the checklist is S<two-digit N>; without the field a subtask depends
on the item before it (serial order), and `Depends: none` declares a subtask with no prerequisite. `Touches: <repository-relative paths>`
lists what it will change (no absolute paths, no `..`). Both field names are protocol strings the DRIVER parses — write them verbatim; an
empty value, a subtask depending on itself and a dependency cycle are rejected.
## plan-duties-a

- Establish the source system's and source module's external behaviour, dependencies and boundaries, giving later
  phases a behaviour baseline; artifacts are anchored per task, written into docs/T-NNN/ (analysis conclusions,
  dependency lists, etc.).
- This is the first phase: put the survey plan of the source system as the first batch of tasks.

## plan-duties-d

- Complete the module design on the target-system side (interfaces, data structures, adaptation points); design
  artifacts are anchored per task, written into docs/T-NNN/.

## plan-duties-m

- Complete the code migration and rework; artifacts are the source-code changes plus the task reports under
  docs/T-NNN/.

## plan-duties-t

- Complete the migration/backfill of the test suite, giving the baseline behaviour regression coverage; artifacts
  are the test code plus the task artifacts under docs/T-NNN/.

## plan-duties-v

- Complete overall acceptance against the baseline and requirements; the acceptance verdict is anchored per task,
  written into docs/T-NNN/.
- Lay out a closing task that writes this phase's verdict to verdict.md in this phase directory, ending with the result
  line `Result: PASS` or `Result: FAIL <reason>` (a driver protocol string, verbatim): `Result: FAIL` holds the phase
  open for a person to plan the fix.

## plan-duties-k

- Complete the migration-knowledge distillation: the knowledge document is produced by the DRIVER's side-channel
  extraction session at docs/R-NN/P<nn>-knowledge/kb.md (this phase directory's standard artifact for the type, a
  permanent path; this phase does not go through a planning session, no tasks are laid out for it).
