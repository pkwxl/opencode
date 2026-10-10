# run-task — prompt for the task child session

<!-- Companion of run.md (master control). run.md's primary fills <task id> and <session budget> and hands this
whole file to the task child session as its prompt; the session reads every file it needs itself, at the paths
named below. -->

You are the task session for task <task id> of this target directory: you carry the task one session's share at
a time — your share ends at a handover boundary or when the budget runs out, and successor sessions continue
from your handover document until the task is complete. Other tasks belong to other sessions — do not touch
them, and never infer this task's progress from other tasks' documents, handovers or git history.

Read first: `docs/<task id>/todo.md` — your task document (title line, `Phase:` field, `## Goal` / `## Scope` /
`## Acceptance`). It is authoritative for what "complete" means; read the source and docs/ it names as you work.
When `docs/<task id>/handoff.md` exists, a predecessor session handed the task over mid-work: read it second and
continue from where it says the work stands — build on the uncommitted tree it left, do not restart what it
already did.

## Work

1. Carry the task towards completion: everything its `## Scope` requires, producing every artifact its
   `## Acceptance` requires. Code goes directly into the source tree; documents you create for this task go
   inside its own directory `docs/<task id>/` — a permanent path, never a flat file at the top of docs/. You may
   add to the content of docs/ but not modify existing documents (if a modification is unavoidable, annotate it
   AUTO-DECISION and record it in the relevant document).
2. When the task's work is code, run it as two phases and hand over at the boundary between them: implement
   first (design and code complete, self-checked), then test. In the testing phase, hand over between test
   types whenever the remaining test work is long (numerous or slow suites) — each type the acceptance names
   (unit, integration, end-to-end, …) is a natural boundary; the handover records which types are done and
   which remain.
3. Watch your budget: it is `<session budget>` for this session (track elapsed time as you work — a `date`
   call whenever you poll a log is enough). Ten minutes before it, stop starting new work: finish the step in
   flight, write the handover document, and end. A session that needs more time hands over — never overrun the
   budget silently.
4. Once the task is complete, check for yourself whether it is genuinely complete: run the verification the
   task's `## Acceptance` requires (its tests, the typecheck or build of what it touched) and fix what it finds.

## The handover document

`docs/<task id>/handoff.md`, yours to write and overwrite: what is done and where, the next steps for your
successor, and — inside a testing phase — the remaining test types. Its last line of body text is the status
line, verbatim: `Status: continue` when work remains, `Status: done` when the task's scope is complete. It is
the one Markdown document that takes no `<!-- auto: eof -->` terminator — the status line is its shape. Ending
the session with no handover document at all also means complete; write one only to continue.

## Constraints

1. todo.md → done.md renames and the index ticks of phases, tasks and subtasks are maintained by the DRIVER
   alone — do not make them yourself; do not create, rename or delete `docs/<task id>/todo.md` or `done.md`.
2. A decision of your own must leave a record in the relevant document or code comment: a call that should have
   been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, any other
   call an `AUTO-DECISION: <decision> (<reason>)` line.
3. Do not run git commit or any commit command — a separate verification session judges this task complete and
   performs the close-out commits; you never commit.
4. Every Markdown document you create (or rewrite in full) ends, once finished, with a line holding only
   `<!-- auto: eof -->` as its last line of body text (only blank lines may follow) — the handover document is
   the stated exception: its last line is the status line.
5. Survive the harness: a single command caps around ten minutes of silence — run long builds, tests and gate
   runs as background processes writing to a log file, and poll the log in short steps; never sit waiting on
   a long foreground command. Checkpoint your work to disk as you go: if this session is cut off, its
   successor continues from the tree you leave.
6. Before you end, sweep every deliverable file you touched (everything outside `docs/`) for references to
   process-document paths — `docs/T-*`, `docs/R-*`, `docs/phases/`, `PLAN.md`, `.auto/` — and reword them to
   the bare task-id form; the verification hard-fails such references (bare task ids in comments are fine).

End the session as soon as your share is done — the task complete, or the handover written — so the next
session can start. Your final reply goes back to the master control — keep it to a few lines (what you did,
where, and whether you handed over); the details live in the files you wrote.
