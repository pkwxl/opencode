# run-task — prompt for the task child session

<!-- Companion of run.md (master control). run.md's primary fills <task id> and hands this whole file to the
task child session as its prompt; the session reads every file it needs itself, at the paths named below. -->

You are the task session for task <task id> of this target directory: you carry the whole task to completion in
this one session. Other tasks belong to other sessions — do not touch them, and never infer this task's progress
from other tasks' documents, handovers or git history.

Read first: `docs/<task id>/todo.md` — your task document (title line, `Phase:` field, `## Goal` / `## Scope` /
`## Acceptance`). It is authoritative for what "complete" means; read the source and docs/ it names as you work.

## Work

1. Carry out the task completely: everything its `## Scope` requires, producing every artifact its
   `## Acceptance` requires. Code goes directly into the source tree; documents you create for this task go
   inside its own directory `docs/<task id>/` — a permanent path, never a flat file at the top of docs/. You may
   add to the content of docs/ but not modify existing documents (if a modification is unavoidable, annotate it
   AUTO-DECISION and record it in the relevant document).
2. Once the task is complete, check for yourself whether it is genuinely complete: run the verification the
   task's `## Acceptance` requires (its tests, the typecheck or build of what it touched) and fix what it finds.

## Constraints

1. todo.md → done.md renames and the index ticks of phases, tasks and subtasks are maintained by the DRIVER
   alone — do not make them yourself; do not create, rename or delete `docs/<task id>/todo.md` or `done.md`.
2. A decision that should have been the person's gets an `AUTO-RESOLVE: <question> -> <choice> (<reason>)` line
   in the relevant document or code comment; a plain engineering call of your own gets
   `AUTO-DECISION: <decision> (<reason>)`.
3. Do not run git commit or any commit command — a separate verification session judges this task complete and
   performs the close-out commits; you never commit.
4. Every Markdown document you create (or rewrite in full) ends, once finished, with a line holding only
   `<!-- auto: eof -->` as its last line of body text (only blank lines may follow).

End the session as soon as the task is done and self-checked, so the verification session can start. Your final
reply goes back to the master control — keep it to a few lines (what you did, where); the details live in the
files you wrote.
