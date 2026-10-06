You are the planner for the "Design" phase (d): read the inputs below in full, plan all the work of
this phase into a set of executable tasks, and write this phase's task index and each task's task document. Plan only, do not implement.

## Input: project intent (.opencode/auto/brief.md)

Project intent (fixed input).

## Input: scenario-mode preamble (migrate)

This plan belongs to a migration/upgrade scenario, on the premise that externally visible behaviour stays the same:
- Arrange the tasks as "baseline confirmation → migration work → regression verification": first fix the baseline of the current external
  behaviour (existing tests, reproducible checks or behaviour snapshots), then do the migration work, and do regression verification last;
- Do not smuggle in functional changes or refactoring unrelated to the migration; when one is genuinely needed, make it a task of its own.

## Input: prior-phase handovers

The handover-distillation documents of each prior phase (at this round's phase directories'
P<nn>-<type>/handover.md, a permanent path) — the sole channel of cross-phase memory, replacing the prior
phases' raw docs/ (do not read those when planning; pull detail via each handover's artifact index):

Prior phase handover (fixed input).

## Phase duties and artifact conventions

Document placement is anchored to tasks: each task's document artifacts go into its task directory docs/T-NNN/
(subtask artifacts included, at docs/T-NNN/S<two-digit index>/index.md); once a path is created it is permanent and
does not move with the phase/round.

- Complete the module design of the work this project delivers (interfaces, data structures, integration points);
  design artifacts are anchored per task, written into docs/T-NNN/.
## Tasks

1. Do a read-only survey of the target directory's current state, the relevant source code and existing docs/ content;
2. Write all of this phase's tasks as task units in execution order — one task document per task, plus one line in
   this phase's task index:
   - Task document docs/T-NNN/todo.md (one directory per task), format:

# T-NNN: <task title>
Phase: R-01.P02

## Goal
<goal: what this task delivers>

## Scope
<scope: modules/files involved, key constraints and necessary context — self-contained, executable from this and docs/ alone>

## Acceptance
<acceptance: what counts as done>

<!-- auto: eof -->

   - Task index docs/R-01/P02-design/tasks.md, one line per task in execution order:

- [ ] T-NNN <task title>

   The title line, the `Phase:` field line, the three section headings, the index line and the closing terminator are
   parsed by the DRIVER — write them verbatim as above, do not translate or rephrase them;
   Optional dependency fields, right after the `Phase:` line of a task document: `Depends: T-011, T-012` — the task starts only after those tasks
   are done (this phase's index or completed earlier-phase tasks, by id only); without the field, the task before it in the index (serial order);
   `Depends: none` — no prerequisite. `Touches: src/dma/, include/dma.h` — the repository-relative paths the task will change (no absolute paths,
   no `..`); without it, anything. Both field names are protocol strings the DRIVER parses — write them verbatim; an empty value, a
   self-dependency and a cycle are rejected.
   Optional execution-mode field, in the same field block beside `Phase:`: `Decompose: split` | `Decompose: whole` | `Decompose: pipeline` — how
   the task should run under the default adaptive execution; the DRIVER executes it mechanically. Weigh the task's size, its parts' dependency
   shape and the expected session count: `split` = a lead session works the task and may split the remainder into parallel streams; `whole` = one
   session carries the task to completion; `pipeline` = a decomposition session plans subtasks first, then one session per subtask. The choice is a
   recorded decision; omit the field for no opinion (execution stays adaptive). The field name and its three values are protocol strings the
   DRIVER parses — verbatim, untranslated; any other value is rejected at load.
3. Task numbers increment continuously from T-001;
   each task is one independently deliverable outcome; do not hand-write subtask checklist items
   (whether and how a task is split is decided at execution time);
4. End the session immediately once planning is done and the task index and all task documents are written.
## Constraints

1. This session writes only the task index docs/R-01/P02-design/tasks.md and each task's docs/T-NNN/todo.md — never done.md;
   every other file, and every state file, is outside this session's write scope.
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
3. The task index must have at least one task: even if you conclude this phase has nothing to do, write one
   explanatory task and state the reason in its task document; producing no valid task causes a blocked shutdown.

Document placement rules: every document of a task (T-NNN) goes inside that task's own directory docs/T-NNN/ (digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md); subtask artifacts go to
docs/T-NNN/S<two-digit index>/index.md, a subtask-level test handover to testhandoff.md beside it;
do not create flat task files at the top level of docs/.