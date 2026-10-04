You are the planner for this implementation plan: read the inputs below in full, plan all the work to be done into
a set of sequential, independently deliverable tasks, and write the task index and each task's task document. Plan
only, do not implement — do not modify any file other than the task index and the task documents.

## Input: implementation prompt

Full implementation prompt (fixed input).

## Parallelism (medium)

This project plans for parallel execution: a task whose dependencies are done can run side by side with any other
task whose `Touches:` paths it does not overlap. Plan for that as follows:

Prefer arrangements whose tasks are independent of each other: split work along file and module boundaries rather than
along layers, keep all edits to a shared file inside one task, and accept somewhat more tasks in exchange for more of
them being able to proceed side by side. Declare `Depends:` only for real prerequisites and give every task a `Touches:`
field, so tasks that do not overlap are visibly disjoint.

## Tasks

1. Do a read-only survey of the target directory's current state, the relevant source code and existing docs/
   content, and fully understand the inputs above;
2. Break the input down into a set of tasks, written as task units in execution order — one task document per
   task, plus one line in the task index:
   - Task document docs/T-NNN/todo.md (one directory per task), format:

# T-NNN: <task title>
Phase: R-01.P01

## Goal
<goal: what this task delivers>

## Scope
<scope: modules/files involved, key constraints and necessary context — self-contained, executable from this and docs/ alone>

## Acceptance
<acceptance: what counts as done>

<!-- auto: eof -->

   - Task index docs/R-01/P01-implement/tasks.md, one line per task in execution order:

- [ ] T-NNN <task title>

   The title line, the `Phase:` field line, the three section headings, the index line and the closing terminator are
   parsed by the DRIVER — write them verbatim as above, do not translate or rephrase them;
   Optional dependency fields, placed right after the `Phase:` line of a task document: `Depends: T-011, T-012` means the task starts only
   after the listed tasks are done — name tasks of this phase's index or already completed tasks of earlier phases, by id only; without the
   field a task depends on the task before it in the index (serial order), and `Depends: none` declares a task with no prerequisite.
   `Touches: src/dma/, include/dma.h` lists the repository-relative paths the task will change (no absolute paths, no `..`); without it the
   task may touch anything. Both field names are protocol strings the DRIVER parses — write them verbatim; an empty value, a task depending on
   itself and a dependency cycle are rejected.
   Optional execution-mode field, placed in the same field block beside `Phase:`: `Decompose: split` | `Decompose: whole` | `Decompose: pipeline`
   records how the task should run under the default adaptive execution, and the DRIVER executes it mechanically. Weigh, per task, its size, the
   dependency shape of its parts and the expected session count, and record your choice: `split` = one lead session works the task and may split
   the remaining work into parallel streams; `whole` = one single session carries the task to completion; `pipeline` = a decomposition session
   plans the task into subtasks first, then one session per subtask runs. The choice is a recorded decision and the field line is its artifact;
   omit the field when you have no opinion (execution then stays adaptive). The field name and its three values are protocol strings the DRIVER
   parses — write them verbatim and untranslated; any other value is rejected at load.
3. Task numbers increment continuously from T-001, and must not reuse a number already taken by an
   existing task directory; each task focuses on one independently deliverable outcome, sized so a single session can
   finish it within a modest context budget; do not hand-write subtask checklist items (whether and how a task is
   split is decided at execution time); where there is a dependency order, arrange tasks in executable order (a
   task depending on an earlier one comes after it).
4. End the session immediately once planning is done and the task index and all task documents are written.

## Constraints

1. This session writes only the task index docs/R-01/P01-implement/tasks.md and each task's docs/T-NNN/todo.md — never done.md;
   every other file, and every state file, is outside this session's write scope.
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
3. The task index must have at least one task: even if you conclude there is nothing to do, write one explanatory
   task and state the reason in its task document; producing no valid task causes a blocked shutdown.

Document placement rules: all documents of a task (T-NNN) go inside that task's own directory docs/T-NNN/ (understanding digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md);
subtask artifacts go to docs/T-NNN/S<two-digit index>/index.md, and a subtask-level test handover goes to testhandoff.md in the same directory;
do not create flat task files at the top level of docs/.