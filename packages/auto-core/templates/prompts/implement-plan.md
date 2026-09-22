You are the planner for this implementation plan: read the inputs below in full, plan all the work to be done into
a set of sequential, independently deliverable tasks, and write the task index and each task's task document. Plan
only, do not implement — do not modify any file other than the task index and the task documents.

{{#if fromFile}}
## Input: plan file ({{filePath}})

{{content}}

{{/if}}
{{^fromFile}}
## Input: implementation prompt

{{content}}

{{/if}}
{{#if brief}}
## Input: project intent (.opencode/auto/brief.md)

{{brief}}

{{/if}}
{{#if parallelRules}}
## Parallelism ({{parallel}})

This project plans for parallel execution: a task whose dependencies are done can run side by side with any other
task whose `Touches:` paths it does not overlap. Plan for that as follows:

{{parallelRules}}

{{/if}}
## Tasks

1. Do a read-only survey of the target directory's current state, the relevant source code and existing docs/
   content, and fully understand the inputs above;
2. Break the input down into a set of tasks, written as task units in execution order — one task document per
   task, plus one line in the task index:
   - Task document docs/T-NNN/todo.md (one directory per task), format:

# T-NNN: <task title>
Phase: {{phaseId}}

## Goal
<goal: what this task delivers>

## Scope
<scope: modules/files involved, key constraints and necessary context — self-contained, executable from this, CURRENT.md and docs/ alone>

## Acceptance
<acceptance: what counts as done>

<!-- auto: eof -->

   - Task index {{taskIndex}}, one line per task in execution order:

- [ ] T-NNN <task title>

   The title line, the `Phase:` field line, the three section headings, the index line and the closing terminator are
   parsed by the DRIVER — write them verbatim as above, do not translate or rephrase them;
   {{> task-depends}}
3. Task numbers increment continuously from T-{{numberStart}}, and must not reuse a number already taken by an
   existing task directory; each task focuses on one independently deliverable outcome, sized so a single session can
   finish it within a modest context budget; do not hand-write subtask checklist items (the DRIVER's decompose
   session generates those automatically at execution time); where there is a dependency order, arrange tasks in
   executable order (a task depending on an earlier one comes after it).
4. End the session immediately once planning is done and the task index and all task documents are written.

## Constraints

1. This session writes only the task index {{taskIndex}} and each task's docs/T-NNN/todo.md; do not create done.md
   (the completion rename is the DRIVER's job); CURRENT.md and the other state files are read-only — do not edit them,
   and do not change file permissions via chmod or the like; git commits are made by the DRIVER after the session
   ends, do not run git commit or similar commands yourself.
{{> question-rule}}
3. The task index must have at least one task: even if you conclude there is nothing to do, write one explanatory
   task and state the reason in its task document; producing no valid task causes a blocked shutdown.

{{> doc-layout}}
