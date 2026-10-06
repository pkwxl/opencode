# Shared prompt partials

Session templates (`templates/prompts/*.md`, or overrides under the target directory's
`.opencode/auto/prompts/`) reference the `## <name>` sections here through `{{> name}}`;
when a reference sits on its own line, the leading indentation is applied to every line of
the partial. Keep the section names unchanged when overriding this file, otherwise the
templates that reference them fail at render time.
Optional content blocks (blocking remarks, mode notes and the like) are deliberately not
partials — a conditional section swallows the whole line on its empty branch, so each
template writes those inline. The exception is a whole partial whose body is one line led by
its `{{#if}}` tag (test-protocol): the empty branch then collapses to the call site's own
line, which is only clean where the include sits at the template's end (the render trims) —
anywhere else it leaves a blank line.
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
You are carrying out one task of an implementation plan: this session has to finish only the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions are not yours to carry out.

{{#if doneList}}These tasks are already done, do not redo them:
{{doneList}}{{/if}}{{^doneList}}No task in the plan is done yet.{{/if}}
## question-rule
{{#if humanQuestions}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else where the call is the user's to make (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment), do not call the question tool —
   take the recommended option as a provisional default, record the question in the affected task documents (the context, the options with their consequences, the default taken and how
   to override it), and continue; the round report's needs-attention section lists every such question for the person's considered answer, so a decision is never closed in real time.
   Plain engineering trade-offs that were always yours remain yours, no record required.
   Asking the same question again after it was answered blocks the task and stops the run.{{/if}}{{^humanQuestions}}{{^ask}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) do not call the question tool —
   decide how to proceed on your own, and once the current stage is finished, move straight on to the next one.
{{#if decisionsUnattended}}{{decisionsUnattended}}{{/if}}{{^decisionsUnattended}}   A decision of your own must leave a record in the relevant document or code comment: a call that should have been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, any other call an `AUTO-DECISION: <decision> (<reason>)` line.{{/if}}
   A non-permission question gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.{{/if}}{{#if ask}}2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
{{#if decisionsAsk}}{{decisionsAsk}}{{/if}}{{^decisionsAsk}}   for anything else, ask with the question tool when the call should have been the user's, and decide it yourself when it was always yours.{{/if}}
   When nobody is at the keyboard your question is answered automatically; the DRIVER has recorded that proxy answer in full, so carry on by
   the reply, and once the current stage is finished, move straight on to the next one.
   Asking the same question again blocks the task and stops the run — do not rephrase and re-ask an answered question.{{/if}}{{/if}}
   A follow-up that states what was understood and asks only about the part an answer left ambiguous is a new question, not the banned re-ask.
## ground-state
Authoritative DRIVER ledger state (this is the only basis for the progress of this task and this subtask — never infer whether this task is done from other tasks' documents, handovers or git commit records):
- Current task: {{taskId}} "{{taskTitle}}", status: {{taskStatusText}};{{#if qualifiedId}}
- Fully qualified id of this subtask: {{qualifiedId}}; S-numbers appearing in other tasks' documents or commit records belong to those tasks and are unrelated to this one;{{/if}}{{#if subtaskSnapshot}}
- Subtask tick snapshot for this task: {{subtaskSnapshot}}; ticks are maintained by the DRIVER once each subtask session ends and do not change during a session;{{/if}}{{#if doneIds}}
- The previously completed tasks {{doneIds}} are independent of this task, and their wrap-up/completion narratives say nothing about this task's progress; their documents may be consulted only as a format/precedent reference, never as evidence that "this task (or this subtask) is done".{{/if}}
## digest-rule
Cross-task reference discipline (this file is the background/navigation source for downstream subtask sessions; a previous task's completion
narrative flowing in through a reference is misread by a downstream session as a sign that this task is already done):
- Point cross-task references only at phase-level single sources (rulings/contracts/ledger); never leave a pointer to a previous task's wrap-up narrative;
- Borrowing a previous task-level wrap-up artifact (report/batch record/testhandoff and the like) as a format or precedent is allowed, but the
  reference must carry the qualification "artifact of another, already completed task — format template only";
- Excerpt the points you need instead of sending the reader back to a whole document: quote the content directly, leave no pointer a
  downstream session would have to read end to end.
## eof-rule
Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). The DRIVER validates finished artifacts
against exactly this — a missing terminator counts as unfinished and is sent back for correction; documents that already existed beforehand
need no retrofit.
## doc-layout
Document placement rules: every document of a task (T-NNN) goes inside that task's own directory docs/T-NNN/ (digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md); subtask artifacts go to
docs/T-NNN/S<two-digit index>/index.md, a subtask-level test handover to testhandoff.md beside it;
do not create flat task files at the top level of docs/.


## report-duty
This is the round's final phase — the round ends with this phase's work. End the task list with one wrap-up task, titled
exactly "Round user report", whose deliverable is the round report {{reportFile}} (a round-level artifact: it does not live
under docs/T-NNN/, and this one task may name and write it there — the placement exception to the doc-layout rule), placed
after the verdict/consolidation closing task; a FAIL verdict is one of the report's findings, not a reason to skip the report task. The report is written for the
person who started the run — plain prose, path links, no driver-protocol obligations beyond the closing terminator line
`<!-- auto: eof -->`. Its charter, which the wrap-up task's document must restate in full (self-contained, as every task
document must be):
1. What this round set out to do, in the person's own terms (the project brief, the round brief, the planning input);
2. What happened, phase by phase: what each phase delivered, its verdict, and headline counts (tasks done / failed /
   blocked / closed by hand);
3. **Needs your attention** — the section the whole report exists for: every provisionally-defaulted planning question
   with its options, implications and override path; open questions and the safe defaults currently in force; the round's
   AUTO-RESOLVE proxy decisions with enough context to confirm or overturn each; FAIL verdicts and what they mean;
   environment gaps; recorded deviations and assumption notes; mid-round decisions that belong in the project brief (the next survey folds them in);
4. Where to look deeper: an artifact index (spec-notes, verdicts, notable task reports), one line each — the report
   links, it never copies at length.

## task-depends
Optional dependency fields, right after the `Phase:` line of a task document: `Depends: T-011, T-012` — the task starts only after those tasks
are done (this phase's index or completed earlier-phase tasks, by id only); without the field, the task before it in the index (serial order);
`Depends: none` — no prerequisite. `Touches: src/dma/, include/dma.h` — the repository-relative paths the task will change (no absolute paths,
no `..`); without it, anything. Both field names are protocol strings the DRIVER parses — write them verbatim; an empty value, a
self-dependency and a cycle are rejected.
## task-decompose
Optional execution-mode field, in the same field block beside `Phase:`: `Decompose: split` | `Decompose: whole` | `Decompose: pipeline` — how
the task should run under the default adaptive execution; the DRIVER executes it mechanically. Weigh the task's size, its parts' dependency
shape and the expected session count: `split` = a lead session works the task and may split the remainder into parallel streams; `whole` = one
session carries the task to completion; `pipeline` = a decomposition session plans subtasks first, then one session per subtask. The choice is a
recorded decision; omit the field for no opinion (execution stays adaptive). The field name and its three values are protocol strings the
DRIVER parses — verbatim, untranslated; any other value is rejected at load.
## subtask-depends
Optional dependency fields, the first lines of a subtask's todo.md (before `## Scope`): `Depends: S01, S03` — the subtask starts only after
those subtasks of this task are done (item N of the checklist is S<two-digit N>); without the field, the item before it (serial order);
`Depends: none` — no prerequisite. `Touches: <repository-relative paths>` — what it will change (no absolute paths, no `..`). Both field names
are protocol strings the DRIVER parses — write them verbatim; an empty value, a self-dependency and a cycle are rejected.
## test-protocol
{{#if testByDriver}}Test execution protocol (--test-by-driver): after writing the script path into tmp/test.sh, end your turn to wait for the run. To test again,
write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running).{{#if handoverTest}} After the test is committed the DRIVER sometimes asks you to finish the remaining work that does not depend on the test result, to write the test-related progress and next steps into {{testHandoffFile}}, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write {{testHandoffFile}} **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — the DRIVER reads that naming family to order handovers, and writing it yourself is misread as a handover that happened. Record test-result interpretations and corrections in this scope's established artifact documents, or leave them for the next handover document.{{/if}}{{/if}}
## plan-duties-a

- Establish the existing implementation's external behaviour, dependencies and boundaries, where the brief names
  one, giving later phases a behaviour baseline; artifacts are anchored per task, written into docs/T-NNN/
  (analysis conclusions, dependency lists, etc.).
- This is the first phase: put the survey plan of the existing implementation as the first batch of tasks.

## plan-duties-d

- Complete the module design of the work this project delivers (interfaces, data structures, integration points);
  design artifacts are anchored per task, written into docs/T-NNN/.

## plan-duties-m

- Complete the implementation work; artifacts are the source-code changes plus the task reports under
  docs/T-NNN/.

## plan-duties-t

- Bring the test suite to cover the delivered work, giving the behaviour regression coverage; artifacts
  are the test code plus the task artifacts under docs/T-NNN/.

## plan-duties-v

- Complete overall acceptance against the baseline and requirements; the acceptance verdict is anchored per task,
  written into docs/T-NNN/.
- Lay out a closing task that writes this phase's verdict to verdict.md in this phase directory, ending with the result
  line `Result: PASS` or `Result: FAIL <reason>` (a driver protocol string, verbatim): `Result: FAIL` holds the phase
  open for a person to plan the fix.

## plan-duties-k

- Complete the knowledge distillation: the knowledge document is produced by the DRIVER's side-channel
  extraction session at docs/R-NN/P<nn>-knowledge/kb.md (this phase directory's standard artifact for the type, a
  permanent path; this phase does not go through a planning session, no tasks are laid out for it).
