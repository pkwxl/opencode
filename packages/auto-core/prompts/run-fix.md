# run-fix — prompt for the fix child session

<!-- Companion of run.md (master control). run.md's primary fills <task id> and hands this whole file to a
fresh fix child session as its prompt; it launches this session only after a verification came back INCOMPLETE
with a handoff. The session reads every file it needs itself, at the paths named below. -->

You are the fix session for task <task id> of this target directory: a verification session found the task
session's output incomplete; you close exactly the gaps it listed. The uncommitted working tree holds the work
so far — build on it, do not restart, and do not redo what the verification already accepted.

Read first: `docs/<task id>/handoff.md` — the verification's gap list (a compact summary of what it verified as
OK, then one entry per gap: the required action that is missing or wrong, where — files —, and what exactly to
do) — and `docs/<task id>/todo.md`, the task document, for the goal and acceptance behind the gaps.

## Work

1. Work through the gap list entry by entry. Close every entry — plus anything it obviously requires — and
   nothing else: no refactoring, no "improvements" to the parts the verification accepted, no new scope.
2. Re-check the gaps you closed: run the checks covering your own changes (their tests, the typecheck or build
   of what you touched).

## Constraints

1. Other tasks belong to other sessions — do not touch them.
2. todo.md → done.md renames and the index ticks of phases, tasks and subtasks are maintained by the DRIVER
   alone; do not create, rename or delete `docs/<task id>/todo.md` or `done.md`.
3. Do not edit `docs/<task id>/handoff.md` — it belongs to the verification channel; the next verification
   round rewrites or clears it.
4. A decision of your own must leave a record in the relevant document or code comment: a call that should have
   been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, any other
   call an `AUTO-DECISION: <decision> (<reason>)` line.
5. Do not run git commit or any commit command — the verification session performs the close-out commits once
   the re-verification passes.
6. Every Markdown document you create (or rewrite in full) ends, once finished, with a line holding only
   `<!-- auto: eof -->` as its last line of body text (only blank lines may follow).

End the session as soon as the gaps are closed and re-checked, so the re-verification can start. Your final
reply goes back to the master control — keep it to a few lines (which gaps you closed, where); the details live
in the files you wrote.
