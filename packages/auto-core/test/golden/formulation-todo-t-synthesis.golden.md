# T-005: Formulate the Testing tasks
Phase: R-01.P02
Formulate: R-01.P02
Decompose: whole
Depends: none

## Goal

Formulate the "Testing" phase's complete task plan — the task index docs/R-01/P02-test/tasks.md plus every task's document docs/T-NNN/todo.md — as a verifiable path to what this phase must deliver; the Acceptance below states the bar the plan must meet.

## Scope

This document is the single input of this formulation task: the DRIVER assembled the frame below from the project's committed
sources, and the constructor session — run under the project's intent charter — re-voiced the evidential sources into the Sources
brief and the obligations ledger that follow. Plan from the brief, the ledger, the planning input and the repository; the sources
stay the authority beneath the brief. Where two of them disagree, the authority order (when present below) says which wins, and a
conflict row of the ledger records what the plan must carry — never a silent resolution.
## Input: scenario-mode preamble (migrate)

This plan belongs to a migration/upgrade scenario, on the premise that externally visible behaviour stays the same:
- Arrange the tasks as "baseline confirmation → migration work → regression verification": first fix the baseline of the current external
  behaviour (existing tests, reproducible checks or behaviour snapshots), then do the migration work, and do regression verification last;
- Do not smuggle in functional changes or refactoring unrelated to the migration; when one is genuinely needed, make it a task of its own.

## Sources brief (constructor session, under the charter)

Source health: the following expected sources are absent — docs/analysis.md — plan for their absence, never inventing their content.

The constructor session re-voiced the evidential sources (project brief, round brief, analysis, prior-phase handovers,
prior-round conclusions — whichever this formulation had) organized as the charter directs, quoting load-bearing lines.

The round brief demands the parser error paths covered with recorded evidence; the handover carries the design's error-semantics objective forward.

## Obligations ledger

The enumerated, quoted list of what the sources demand of this plan. Every row is an obligation a planned task covers or
explicitly defers (reason recorded in that task's document), or a conflict the plan records per the authority order — the
wrap-up verification judges this plan row by row, and the coverage map maps every row to its task.

- O-01 | phase duties | "test-report.md" | the phase's test report (test-report.md) is delivered in the phase directory by the plan's own tasks
- O-02 | phase duties | "test-log.md" | each task the type's duties give this artifact declares it in its own directory (docs/T-NNN/test-log.md)
- O-03 | docs/R-01/round.md | "error semantics preserved for the parser" | the plan's tests exercise parser error paths and record observed evidence
- C-01 | docs/R-01/P01-implement/plan-input.md vs docs/R-01/round.md | "rewrite the config layer wholesale" / "error semantics preserved for the parser" | round.md wins (authority order); the plan records the deviation, never silent

Boundaries: the ledger enumerates what the sources name — it cannot invent requirements, and nothing here widens the
project's charter. The repository survey remains this session's own first duty (protocol item 1 below). The seeded
protocol rows (source `phase duties`) are the DRIVER's own; this round's obligations are the ledger's, the standing bar
is the charter's.

## Phase duties and artifact conventions

Document placement is anchored to tasks: each task's document artifacts go into its task directory docs/T-NNN/
(subtask artifacts included, at docs/T-NNN/S<two-digit index>/index.md); once a path is created it is permanent and
does not move with the phase/round.

4. Splitting and artifact criteria for this phase (Testing):
   - Split by test surface / scenario family: each item corresponds to one test file or to one family of closely related scenarios;
   - Keep writing tests apart from fixing defects: implementation defects that the tests expose are appended as separate fix items, not mixed
     into the test-writing item;

Protocol obligations this plan carries regardless (the DRIVER seeds these ledger rows itself): this phase type's standard phase artifacts (test-report.md) land in the phase directory by the plan's own tasks; this phase type's standard task artifacts (test-log.md) land in each task's own docs/T-NNN/ directory.

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

   - Task index docs/R-01/P02-test/tasks.md, one line per task in execution order:

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
3. Write the coverage map docs/<this task's own id>/coverage.md (the formulation task's directory), one line per ledger row above, mapping every row exactly once — `- <row id> -> T-NNN (<note>)` for a row a planned task covers, `- <row id> -> deferred(<the reason, recorded in the named task's document>)` for an explicit deferral, `- <row id> -> conflict-recorded(<where the plan records the deviation>)` for a conflict row; the DRIVER checks the map's totality against the ledger and blocks the unit on any row left unmapped;
4. Task numbers increment continuously from T-006 (auto-numbering: numbers never repeat within the target directory; earlier numbers are already taken by historical tasks and must not be reused);
   each task is one independently deliverable outcome; do not hand-write subtask checklist items
   (whether and how a task is split is decided at execution time);
5. End the session immediately once planning is done and the task index, the task documents and the coverage map are written.

## Constraints

1. This session writes only the task index docs/R-01/P02-test/tasks.md, each task's docs/T-NNN/todo.md, and this task's own docs/T-NNN/coverage.md — never done.md;
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
