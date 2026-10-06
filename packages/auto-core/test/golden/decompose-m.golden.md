You are carrying out one task of an implementation plan: this session has to finish only the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions are not yours to carry out.

These tasks are already done, do not redo them:
- [done] T-001: build the schema

Current task (its document is docs/T-002/todo.md):

# T-002: implement the migration

Write the migration script.

Scenario mode notes (migrate):
Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

This session completes the task-background understanding and the subtask decomposition; it writes no implementation code. The current phase is Implementation:

1. Understand the task background: read the relevant source and docs/ selectively around this task's goal (prefer the files named in the
   task body and the directly related modules over completeness); write what you understood into
   docs/T-002/context.md, in four sections:
   ## Relevant files and key symbols (path + why it is relevant, one or two sentences)
   ## Constraints and premises
   ## Existing decisions and current state
   ## Risks and unknowns
   Keep it compact and searchable (aim for 200 lines or fewer); if the file already exists and is still accurate
   (interruption recovery), revise it in place;
2. Build the shared context: prefetch by reference the files/code every subtask will need into docs/T-002/shared.md — one line per
   entry: path (or symbol) + one or two sentences saying where it sits; an index, not a copy — subtask sessions read the listed files
   themselves, on demand;
3. Decomposition granularity criteria (measured against the task description — choose the granularity within the scope it defines, neither wider nor narrower):
   - One aspect per subtask: work of different natures (research, implementation, documentation, wiring) is not merged into a single item;
     the files/modules/interfaces/behaviours/scenarios named in the task description are the natural splitting reference;
   - Each item self-contained: executable from the item description alone plus the item's todo.md, the shared-context index and docs/,
     and carrying the way to verify it — the checks that target the item's own changes (its tests, the typecheck or build of what it
     touched), not the task's full suite;
   - Each item declares its artifacts: documents state the file path, code states the module/file range;
   - Budget-oriented: each item's own work — what its session reads and writes beyond the context it starts with (harness, prompt and
     inherited background) — should be on the order of 32.0k tokens;
   - No close-out item: the task's final verification (the full suite, the build, the acceptance checks of the task description) is not an
     item of its own — the last item runs it once, after its own work;
4. Splitting and artifact criteria for this phase (Implementation):
   - Vertical thin slices first: one callable path end to end per item; do not split by horizontal layer (all the schema first, then all the
     implementation);
   - Keep different aspects apart — schema/interfaces, implementation, wiring and documentation each become their own item;
   - Floor protection: the source tree stays consistent when an item completes — it compiles and existing tests do not regress; splitting out
     a fragment that leaves a broken intermediate state is forbidden;
   - Where there is a dependency order, arrange the items into an executable sequence (an item depending on an earlier one comes after it);
5. Write the decomposition into docs/T-002/subtasks.md (the subtask index) as Markdown checklist items. Each item opens with a
   short title and a colon (the other subtask sessions see only the titles of the items that are not theirs); the description must be
   self-contained (the executing session can finish the item from it alone, plus the item's todo.md, the shared-context
   index shared.md and docs/) and ends with the item's artifacts after the literal token `Artifacts:` — a
   protocol string the driver parses, so write it verbatim and do not translate it:

- [ ] <short title>: <subtask description; ends with Artifacts: <path list>>

6. Write a scope file for each subtask (item N maps to docs/T-002/S<two-digit zero-padded index>/todo.md, e.g. S01 for item 1),
   containing the two sections below. Both headings are protocol anchors the driver checks for: write them verbatim and untranslated.
   ## Scope (what this subtask does and does not do)
   ## Artifacts (the path list, matching the checklist item's `Artifacts:` declaration)
   Optional dependency fields, the first lines of a subtask's todo.md (before `## Scope`): `Depends: S01, S03` — the subtask starts only after
   those subtasks of this task are done (item N of the checklist is S<two-digit N>); without the field, the item before it (serial order);
   `Depends: none` — no prerequisite. `Touches: <repository-relative paths>` — what it will change (no absolute paths, no `..`). Both field names
   are protocol strings the DRIVER parses — write them verbatim; an empty value, a self-dependency and a cycle are rejected.

Constraints:
1. Understanding and decomposition only: modify no implementation code, and do not carry out the execution-time instructions in the task body
   (such as asking a question, writing into some file) — those are the business of the later subtask sessions.
2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) do not call the question tool —
   decide how to proceed on your own, and once the current stage is finished, move straight on to the next one.
   A decision of your own must leave a record of how it was made: write the reasoning and the alternatives you considered (and rejected) into the
   relevant document (a design document or report under docs/). Classify each into one of two kinds by "who should have owned this call" —
   a call touching architecture or code changes is annotated in the design document or in a code comment, everything else in the task report:
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment), and
     anything beyond or narrower than the task description's literal scope — you closed it on the user's behalf, so annotate it explicitly with an
     `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, how tests are written) — annotate it with an `AUTO-DECISION: <decision> (<reason>)` line.
   Example: "whether to close out the third duplicate implementation as well" changes the task's literal scope — AUTO-RESOLVE;
   "whether the new field is called matched or paired" changes no user-visible behaviour — AUTO-DECISION.
   Annotate each decision under one kind only; when unsure use AUTO-RESOLVE — one reminder too many is harmless, a missing annotation is the real loss.
   A non-permission question gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.
   A follow-up that states what was understood and asks only about the part an answer left ambiguous is a new question, not the banned re-ask.
3. Writing out every file is a hard requirement: even if the task looks done or trivial, you must write context.md,
   shared.md, subtasks.md and each todo.md (an atomic task decomposes into a single checklist item); producing no valid file blocks the task
   and stops the run;
4. You write each subtask's todo.md only — never done.md;
5. End the session as soon as the files are written.

Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). The DRIVER validates finished artifacts
against exactly this — a missing terminator counts as unfinished and is sent back for correction; documents that already existed beforehand
need no retrofit.

Cross-task reference discipline (this file is the background/navigation source for downstream subtask sessions; a previous task's completion
narrative flowing in through a reference is misread by a downstream session as a sign that this task is already done):
- Point cross-task references only at phase-level single sources (rulings/contracts/ledger); never leave a pointer to a previous task's wrap-up narrative;
- Borrowing a previous task-level wrap-up artifact (report/batch record/testhandoff and the like) as a format or precedent is allowed, but the
  reference must carry the qualification "artifact of another, already completed task — format template only";
- Excerpt the points you need instead of sending the reader back to a whole document: quote the content directly, leave no pointer a
  downstream session would have to read end to end.

Document placement rules: every document of a task (T-NNN) goes inside that task's own directory docs/T-NNN/ (digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md); subtask artifacts go to
docs/T-NNN/S<two-digit index>/index.md, a subtask-level test handover to testhandoff.md beside it;
do not create flat task files at the top level of docs/.