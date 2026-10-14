# T-005: Formulate the Implementation tasks
Phase: R-01.P01
Formulate: R-01.P01
Decompose: whole
Depends: none

## Goal

Formulate the implementation work's complete task plan — the task index docs/R-01/P01-implement/tasks.md plus every task's document docs/T-NNN/todo.md — as a verifiable path to what it must deliver; the Acceptance below states the bar the plan must meet.

## Scope

This document is the single input of this formulation task: the DRIVER assembled everything below from the project's committed sources when it created the task, and nothing else is injected into your session. Plan from these sources — the repository and the project's artifacts, never invention; where two of them disagree, the authority order (when present below) says which wins.
## Input: project intent (.opencode/auto/brief.md)

Project intent (fixed input).

## Input: plan file (docs/R-01/P01-implement/plan-input.md)

Full implementation prompt (fixed input).

## Input: scenario-mode preamble (migrate)

This plan belongs to a migration/upgrade scenario, on the premise that externally visible behaviour stays the same:
- Arrange the tasks as "baseline confirmation → migration work → regression verification": first fix the baseline of the current external
  behaviour (existing tests, reproducible checks or behaviour snapshots), then do the migration work, and do regression verification last;
- Do not smuggle in functional changes or refactoring unrelated to the migration; when one is genuinely needed, make it a task of its own.

This is the round's final phase — the round ends with this phase's work. End the task list with one wrap-up task, titled
exactly "Round user report", whose deliverable is the round report docs/R-01/report-for-user.md (a round-level artifact: it does not live
under docs/T-NNN/, and this one task may name and write it there — the placement exception to the doc-layout rule), placed
after the verdict/consolidation closing task; a FAIL verdict is one of the report's findings, not a reason to skip the report task. The report is written for the
person who started the run — plain prose, path links, no driver-protocol obligations beyond the closing terminator line
`<!-- auto: eof -->`. Its charter, which the wrap-up task's document must restate in full (self-contained, as every task
document must be):
1. What this round set out to do, in the person's own terms (the project brief, the round brief, the planning input);
2. What happened, phase by phase: what each phase delivered, its verdict, and headline counts (tasks done / failed /
   blocked / closed by hand);
3. **Needs your attention** — the section the whole report exists for: every provisionally-defaulted planning question
   with its options, implications and override path, each phrased by its project consequence (what it changes for the
   goal, the rounds, the cost, the acceptance — never the technique alone); open questions and the safe defaults currently in force; the round's
   AUTO-RESOLVE proxy decisions with enough context to confirm or overturn each; FAIL verdicts and what they mean;
   environment gaps; recorded deviations and assumption notes; mid-round decisions that belong in the project brief (the next survey folds them in);
4. Where to look deeper: an artifact index (spec-notes, verdicts, notable task reports), one line each — the report
   links, it never copies at length.

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
3. Task numbers increment continuously from T-002 (auto-numbering: numbers never repeat within the target directory; earlier numbers are already taken by historical tasks and must not be reused);
   each task is one independently deliverable outcome; do not hand-write subtask checklist items
   (whether and how a task is split is decided at execution time);
4. End the session immediately once planning is done and the task index and all task documents are written.

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
- decisions taken while planning are recorded where they belong (AUTO-RESOLVE / AUTO-DECISION lines in the documents they shape), and deferrals say so openly;
- the task index and task documents follow the driver's format protocol exactly (the protocol strings parse, or the phase blocks).

<!-- auto: eof -->
