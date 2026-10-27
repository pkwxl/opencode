# T-005: Formulate the Implementation tasks
Phase: R-01.P01
Formulate: R-01.P01
Decompose: whole
Depends: none

## Goal

Formulate the implementation work's complete task plan — the task index docs/R-01/P01-implement/tasks.md plus every task's document docs/T-NNN/todo.md — as a verifiable path to what it must deliver; the Acceptance below states the bar the plan must meet.

## Scope

This document is the single input of this formulation task: the DRIVER assembled everything below from the project's committed sources when it created the task, and nothing else is injected into your session. Plan from these sources — the repository and the project's artifacts, never invention; where two of them disagree, the authority order (when present below) says which wins.
## Input: project brief (.opencode/auto/brief.md)

Project intent (fixed input).

## Input: plan file (docs/R-01/P01-implement/plan-input.md)

Full implementation prompt (fixed input).

## Input: scenario-mode preamble (migrate)

This plan belongs to a migration/upgrade scenario, on the premise that externally visible behaviour stays the same:
- Arrange the tasks as "baseline confirmation → migration work → regression verification": first fix the baseline of the current external
  behaviour (existing tests, reproducible checks or behaviour snapshots), then do the migration work, and do regression verification last;
- Do not smuggle in functional changes or refactoring unrelated to the migration; when one is genuinely needed, make it a task of its own.

## What this task writes (the DRIVER's format protocol)

1. Do a read-only survey of the target directory's current state, the relevant source code and existing docs/ content;
2. Write all of this phase's tasks as task units in execution order — one task document per task, plus one line in
   this phase's task index:
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

   This task's own row stays in the index unchanged: the session adds the planned tasks' lines beside it, never
   removes or rewrites the formulation task's own line — the driver ticks and closes this unit through that row;
   The title line, the `Phase:` field line, the three section headings, the index line and the closing terminator are
   parsed by the DRIVER — write them verbatim as above, do not translate or rephrase them;
   Every task document ends with the closing terminator — its last line of body text is exactly <!-- auto: eof -->;
   a document that ends in anything else is invalid and the DRIVER blocks this task on it; verify every written
   document for this before ending the session;
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
3. Task numbers increment continuously from T-002 (auto-numbering: numbers never repeat within the target directory; earlier numbers are already taken by historical tasks and must not be reused);
   each task is one independently deliverable outcome; do not hand-write subtask checklist items
   (whether and how a task is split is decided at execution time);
4. End the session immediately once planning is done, the task index and all task documents are written, and every task document's closing terminator is verified.

## Constraints

1. This session writes only the task index docs/R-01/P01-implement/tasks.md and each task's docs/T-NNN/todo.md — never done.md;
   every other file, and every state file, is outside this session's write scope.
2. The task index must have at least one task: even if you conclude this phase has nothing to do, write one
   explanatory task and state the reason in its task document; producing no valid task causes a blocked shutdown.

Document placement rules: every document of a task (T-NNN) goes inside that task's own directory docs/T-NNN/ (digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md); subtask artifacts go to
docs/T-NNN/S<two-digit index>/index.md, a subtask-level test handover to testhandoff.md beside it;
do not create flat task files at the top level of docs/.

## Acceptance

- every obligation the Scope's inputs name — the planning input's asks, the round brief's goals, the phase duties, and what the prior phases' handovers mark as required reading or as open — is covered by some planned task's scope, or explicitly deferred with the reason recorded in that task's document;
- every planned task's `## Acceptance` states criteria a later session can verify by inspecting the work (named evidence, observable outcomes, the executable checks that apply), never a bare "done";
- every planned task is executable from its own document plus docs/ alone — a self-contained scope, no reliance on reasoning that stayed in this session;
- a task whose output other tasks consume declares it in its document's `Artifacts:` field (the concrete file paths it will land), so the dependency park's honesty gate can check those consumables are complete before the task ever parks (plans/0096 D6);
- decisions taken while planning are recorded where they belong (AUTO-RESOLVE / AUTO-DECISION lines in the documents they shape), and deferrals say so openly;
- the task index and task documents follow the driver's format protocol exactly (the protocol strings parse, or the phase blocks).

<!-- auto: eof -->
