# T-005: Formulate the Implementation tasks
Phase: R-01.P02
Formulate: R-01.P02
Decompose: whole
Depends: none

## Goal

Formulate the "Implementation" phase's complete task plan — the task index docs/R-01/P02-implement/tasks.md plus every task's document docs/T-NNN/todo.md — as a verifiable path to what this phase must deliver; the Acceptance below states the bar the plan must meet.

## Scope

This document is the single input of this formulation task: the DRIVER assembled everything below from the project's committed sources when it created the task, and nothing else is injected into your session. Plan from these sources — the repository and the project's artifacts, never invention; where two of them disagree, the authority order (when present below) says which wins.
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

4. Splitting and artifact criteria for this phase (Implementation):
   - Vertical thin slices first: one callable path end to end per item; do not split by horizontal layer (all the schema first, then all the
     implementation);
   - Keep different aspects apart — schema/interfaces, implementation, wiring and documentation each become their own item;
   - Floor protection: the source tree stays consistent when an item completes — it compiles and existing tests do not regress; splitting out
     a fragment that leaves a broken intermediate state is forbidden;
   - Where there is a dependency order, arrange the items into an executable sequence (an item depending on an earlier one comes after it);

Pipeline-trimming note: this round's pipeline was trimmed via --phases with no separate analysis/design phase — fold
the necessary survey and design points into this phase's first batch of tasks. The baseline-safety-net items (the
before baseline, the guard/flip/exclude/per-batch-update checklist, AUTO-TODO reconciliation, tallies, etc.) must not
be dropped because of pipeline trimming.

## What this task writes (the DRIVER's format protocol)

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

   - Task index docs/R-01/P02-implement/tasks.md, one line per task in execution order:

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
3. Task numbers increment continuously from T-006 (auto-numbering: numbers never repeat within the target directory; earlier numbers are already taken by historical tasks and must not be reused);
   each task is one independently deliverable outcome; do not hand-write subtask checklist items
   (whether and how a task is split is decided at execution time);
4. End the session immediately once planning is done and the task index and all task documents are written.

## Constraints

1. This session writes only the task index docs/R-01/P02-implement/tasks.md and each task's docs/T-NNN/todo.md — never done.md;
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
