# resume-subtasks — finish a task whose subtask loop was interrupted

<!-- Sibling of run-as-subtasks.md: the same pipeline, entered mid-task. Its Stage 2 and Stage 3 here are lockstep
copies of run-as-subtasks.md's — change them together or not at all. -->

For a target directory that the auto driver has already initialized (`init`): hand this file, unchanged, to a
coding-agent session opened in the target directory — there is nothing to fill in. The session takes the role of
the driver (`opencode-auto run`) resuming a task whose subtask decomposition is already complete but whose subtask
loop did not finish: an interrupted run's state (a killed driver, a lost terminal, a failed session). It confirms
the boundary, reconstructs whatever unit the interruption left half-done, then re-enters the pipeline at the first
unfinished subtask — never re-running the decomposition — and sequentially launches one child session per remaining
subtask, and finally the wrap-up and close-out; between child sessions it performs every driver action itself: the
artifact checks, the driver's state writes (checklist ticks, the todo.md → done.md renames) and the unified commit.
All implementation work happens in child sessions launched through the host coding agent's subagent facility; the
driver session itself writes no implementation code. The goal is that the state files and git history afterwards
look exactly as if the driver had finished the task.

You are the driver resuming one task of this target directory. Work from the directory's own state alone; delegate
every work step to a child session, and act on a child's output only through the checks, state writes and commits
specified below.

## Preflight — stop and report when any check fails

1. Initialized target directory: `.opencode/auto/config.json` exists. Otherwise stop: the person must run `init`
   first.
2. No live driver: `.auto/run.lock` absent. A running driver process owns this directory; the person finishes or
   stops the run first.
3. Inside a git work tree where a commit can succeed (a commit identity resolves): committing is the completion
   condition of every unit here — outside git this file does not apply.
4. Worktree: a resumed run is exempt from the driver's clean gate. A dirty tree is read as the interrupted run's
   leftover and is reconstructed below (Reconstruct the interrupted unit); dirt that fits no unit there stops the
   run for the person.
5. You can launch child sessions (your platform's subagent facility) that work in this same directory. Otherwise
   stop: the whole design rests on them.
6. Read the config's `wrapup` key (default true): false skips Stage 3's report session.
7. The config's `testByDriver` and `handoverTest` keys are both unset: this suite has no driver process to run
   the test script or relay its result. Either key set → stop: the person runs the driver itself
   (`opencode-auto run`) for this task, or `amend`s the config.

## Confirm the boundary, pick the task

- The current phase's index: config `phases: "m"` is the no-phase mode — `docs/R-01/P01-implement/tasks.md`;
  anything else is the phased mode — the latest round (the highest `docs/R-NN/` holding a `phases.md`), first phase
  whose `phases.md` line is not marked ` (closed: …)` and whose directory holds a `tasks.md`.
- Unit files win over the index tick: a task with `docs/T-NNN/todo.md` is pending, with `done.md` is done (exactly
  one of the two — neither or both is an inconsistent index, stop and report). Take the first pending task in index
  order that also holds a decomposition — `docs/T-NNN/subtasks.md` exists — and whose `Depends:` (the field in its
  document; without the field the task before it in the index; `Depends: none` = no prerequisite) are all done,
  counting ids outside this index (earlier phases) as done. No such task → stop and report: there is nothing to
  resume — a pending task without a decomposition is run-as-subtasks' business, not this file's.
- Boundary check — the seam this file resumes from has one half, mirroring `opencode-auto run`'s start:
  - The previous task is complete: the index task right before the picked one (none if this is the phase's first
    task) has its `done.md` — finished, or person-closed (`Closed:` field), both count. A predecessor still pending
    or half-done → stop and report; a task cannot legitimately have been decomposed past an unfinished predecessor.
  - The other half of run-as-subtasks' seam — the next task has not started — is inverted here: the picked task HAS
    started, and its in-progress state is exactly what this file resumes.
- The task document is `docs/T-NNN/todo.md` (title line, `Phase: R-NN.P<nn>` field, `## Goal` / `## Scope` /
  `## Acceptance`).
- The decomposition gate — run-as-subtasks' Stage 1 checks, run once here, all hard:
  1. `context.md` and `shared.md` exist, are non-trivial, and end with the terminator; context.md carries the four
     section headings.
  2. `subtasks.md` ends with the terminator and holds at least one parseable item of the shape
     `- [ ] <short title>: … Artifacts: …`.
  3. For every checklist item n, `docs/T-NNN/S<nn>/todo.md` (S01 = item 1) exists, ends with the terminator, and
     carries both the `## Scope` and `## Artifacts` headings.
  4. The dependency graph is valid: no empty `Depends:`/`Touches:` values, no self-dependency, no cycles, ids are
     this task's S<nn> only.
  Any failure → stop and report: the decomposition is incomplete — finishing it is Stage 1's business under
  run-as-subtasks, not a resume. Passing → never touch the decomposition again: no re-reading session, no rewrite
  of `context.md`, `shared.md`, `subtasks.md` or any `S<nn>/todo.md`.

## Reconstruct the interrupted unit

Skip this section on a clean tree. The dirt is the interrupted run's leftover and belongs to exactly one unit of
this task's pipeline — the one in flight when the run was killed. Identify it by the state files alone, in this
order, and close what you find with its own commit (`git add -A`, then one `git commit` per repository, nested
repositories first):

1. A task closed out but never carried over: a `docs/T-NNN/done.md` or a freshly ticked `- [x] T-NNN` line in the
   phase's `tasks.md` among the dirty paths → its carryover commit never ran: commit the tree as that task's
   carryover (`T-NNN carryover driver-state posting`, Auto-Stage `carryover`).
2. The picked task's decomposition never committed: `git log --format=%H --grep="Auto-Task: <task id>"` lists
   nothing → the decompose commit never ran. The decomposition gate above already passed → commit the tree
   (`T-NNN decompose <task title>`, Auto-Stage `decompose`).
3. The newest done checklist item never committed: its `done.md` or its ticked line in `subtasks.md` among the
   dirty paths → its `T-NNN S<nn>` commit never ran: commit the tree with that item's subject and stage
   (`T-NNN S<nn> <subtask short title>`, Auto-Stage `subtask <n>`).
4. Whatever is still dirty after 1–3 is the in-flight unit's work in progress — the first not-done subtask's
   partial work, or the wrap-up report being written (Stage 3's re-entry handles that one). Leave it on disk: the
   resumed unit's child session continues on it, and that unit's own commit absorbs it.
5. Dirty paths that fit none of the above → stop and report: the person commits or cleans the tree first.

## The re-entry point

Disk state alone decides where the run re-enters — never re-run a stage that already closed:

- Some checklist items not done → Stage 2, at the first ready item.
- All items done → Stage 3, decided by the report:
  - No `docs/T-NNN/report.md` → the wrap-up session never ran or never finished: run it (Stage 3).
  - `report.md` present but trivial or missing the terminator → it was mid-write when the run died: rerun the
    wrap-up session once; it rewrites the report.
  - `report.md` complete → do not rerun the session: read its last `Result:` line and follow Stage 3's verdict
    rules directly.

## The unit cycle — the same after every child session

1. Baseline: record the current HEAD before launching. The first child of a dirty re-entry launches on the leftover
   work; every later child launches from a clean, committed tree. Either way the baseline is the HEAD you recorded.
2. Launch exactly one child session with the stage's prompt below, filling the `<angle-bracket>` placeholders from
   the directory's real state. Child sessions run one at a time, never in parallel.
3. When the child session ends: verify HEAD still equals the baseline (a child session that ran a commit command is
   a hard failure — stop and report), then run the stage's checks. On any failure, relaunch a child session once
   carrying the failure list as feedback (a fresh session that re-reads the stage's artifacts is fine); failing
   again → stop and report. Do not tick, rename or commit on a failed stage.
4. All checks pass → make the stage's driver state writes, then the unified commit: `git add -A` + one
   `git commit` per repository (nested repositories first, then the enclosing one), message:

       <subject>

       Auto-Task: T-NNN
       Auto-Stage: <stage>

   The `Auto-Task`/`Auto-Stage` trailers are what mark a driver commit — write them verbatim, never omit them; the
   subject is truncated past 100 characters. Never push, stash, reset, rebase or amend.

Commit subjects and stages (T-NNN = the task, S<nn> = the two-digit subtask number):

- Stage 2, per subtask: subject `T-NNN S<nn> <subtask short title>`, Auto-Stage `subtask <n>`.
- Stage 3: subject `T-NNN wrapup <task title>`, Auto-Stage `wrapup`; the completion commit afterwards: subject
  `T-NNN done <task title>`, Auto-Stage `done`.
- Reconstruction only (the section above): the task carryover, when the interruption fell between a task's
  completion writes and their commit — subject `T-NNN carryover driver-state posting`, Auto-Stage `carryover`;
  the decompose commit, when the interruption fell between the decomposition and its commit — subject
  `T-NNN decompose <task title>`, Auto-Stage `decompose`.

Terminator discipline, checked everywhere below: every Markdown document a child session created or rewrote in full
must end, once finished, with a line holding only `<!-- auto: eof -->` as its last line of body text (only blank
lines may follow). A missing or non-final terminator = the document is unfinished = the check fails.

## Stage 2 — the subtask loop (one child session per remaining item)

State lives on disk, never in a conversation: every checklist item holds exactly one of `docs/T-NNN/S<nn>/todo.md`
/ `done.md` — both or neither is an illegal state, stop and report. An item is done when `done.md` exists; its tick
in subtasks.md mirrors that.

Loop:

1. Next ready item: the first item in list order that is not done and whose `Depends:` (its todo.md field; default
   = the item before it) are all done. None left → the loop ends; go to Stage 3.
2. Launch the child session with:

   ```text
   You are carrying out one subtask of task T-NNN. The other checklist items belong to other sessions — do not
   touch them.

   Authoritative state: task T-NNN "<task title>" is in progress, subtask ticks <d>/<n>; you are item <n> (S<nn>)
   only. The ticks are maintained by the driver once each subtask session ends and do not change during yours.
   Previously completed tasks and other tasks' documents say nothing about this task's progress — never infer
   completion from them.

   The checklist item you own, verbatim:
   - [ ] <the item line>

   The other items, by title, for orientation only:
   - S01 <title>
   - S02 <title> (done)

   Read first: docs/T-NNN/context.md (the task background), docs/T-NNN/S<nn>/todo.md (your scope declaration — do
   what it scopes, no more), and the files docs/T-NNN/shared.md lists, on demand.

   [dirty re-entry only — the first ready item after a dirty start] An earlier session on this same subtask was
   interrupted; part of its work may already sit in the working tree — read what is there and continue from it
   instead of starting over.

   Complete this one subtask. Verification: run the checks that target this subtask's own changes (its tests, the
   typecheck or build of what it touched), not the full suite. [last item only] This is the last subtask: once it
   is done, run the task's full acceptance verification once, for the whole task (docs/T-NNN/todo.md ## Acceptance),
   and fix what it finds.

   Document/analysis/design output goes to docs/T-NNN/S<nn>/index.md (title on the first line, not merged into
   another document); code artifacts go directly into the source tree. Every Markdown document you create (or
   rewrite in full) ends with a line holding only <!-- auto: eof --> as its last line of body text.

   A decision of your own must leave a record in the relevant document or code comment: a call that should have
   been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, any other
   call an `AUTO-DECISION: <decision> (<reason>)` line.

   Do not run git commit or any commit command. Do not create, rename or delete docs/T-NNN/S<nn>/todo.md or
   done.md — the completion decision and the rename belong to the driver. End the session as soon as the subtask is
   done, so its close-out can start.
   ```

3. Checks (all hard):

   1. The unit changed something relative to the baseline — a zero-write session is never completion. (Skipped for
      the one dirty-start subtask: the leftover already dirties the tree; the artifact checks below decide.)
   2. Every path in the item's `Artifacts:` declaration exists, carrying any sections the declaration pinned
      (`path(## Heading)`).
   3. Every Markdown file created or modified in this unit ends with the terminator as the last line of body text.
   4. Process documents are not design dependencies: lines this unit added to deliverable files (every path outside
      the process documents `docs/T-*`, `docs/R-*`, `docs/phases/`, `PLAN.md`, `.auto/`, and outside `AGENTS.md`
      and `.opencode/`) must not reference those process paths. `AUTO-*` marker lines inside code comments are fine
      when self-contained; a bare task id in a comment is a warning to log, not a failure.

4. Pass → the driver writes: rename `docs/T-NNN/S<nn>/todo.md` → `done.md`, tick the item in subtasks.md
   (`- [ ]` → `- [x]`), commit (`T-NNN S<nn> …`), then continue the loop.

## Stage 3 — wrap-up and close-out

Skip the report session when the config's `wrapup` is false; go straight to the close-out. Run the report session
only when the re-entry point calls for it (no report yet, or a report that was mid-write); otherwise take the
existing report's verdict directly.

Launch the child session with:

```text
You are the wrap-up session for task T-NNN. You write no implementation code.

<the full task document docs/T-NNN/todo.md, verbatim>

The subtask checklist of this task, with its ticks:
<docs/T-NNN/subtasks.md, verbatim>

Write docs/T-NNN/report.md, this task's wrap-up report: one line per subtask — number + one-sentence conclusion +
artifact path (docs/T-NNN/S<nn>/index.md) or code location — without copying or rewriting the subtask artifacts,
then two sections of your own, overall conclusion and open issues.
Write the result line as the last line of body text of the report (before the terminator), on a line of its own:
`Result: PASS` or `Result: FAIL <one-sentence reason>` — a protocol string, written exactly as given, never
translated, bolded or list-marked.
Write PASS only when every check the task requires was actually run or observed, with the evidence in this report;
a non-acceptance task whose goal was met may omit the line. Every Markdown document you create ends with a line
holding only <!-- auto: eof --> as its last line of body text. Do not run git commit or any commit command; end the
session as soon as the report is written.
```

Check: `docs/T-NNN/report.md` exists, is non-trivial, ends with the terminator. Failure → one feedback re-run, then
stop and report.

Then read the report's result line (the last line starting with `Result:`):

- `Result: FAIL …` → commit the report (`T-NNN wrapup …`) and stop for the person: a FAIL is not completion — the
  person accepts the task with `close` or plans the rework. Do not tick the task done.
- PASS, or no result line → the close-out: rename `docs/T-NNN/todo.md` → `done.md`, tick the task's line in the
  phase's `tasks.md` (`- [ ] T-NNN` → `- [x] T-NNN`), and if `.auto/units.json` holds a record for this task, remove
  that record; commit these writes (`T-NNN done <task title>`, Auto-Stage `done`).

## Hands off — driver-adjacent rules

- One task only: the resumed task, and only to its completion — do not start the next task, do not plan new work,
  do not modify other tasks' documents or the round/phase documents (`docs/R-NN/round.md`, `phases.md`).
- Never edit `.opencode/auto/config.json`, `AGENTS.md`, or anything under `.auto/` except the `units.json` record
  removal above.
- You make no edits of your own to task content: apart from the state writes (ticks, renames, the cleanup) and the
  commits, everything on disk was written by child sessions.
- The worktree must end clean: anything left uncommitted at the end is committed as the close-out commit, or the
  run stops and reports.

## Finish

Report: the task resumed and where it re-entered (which subtasks were already done, which this run executed), each
subtask's one-line outcome with its commit subject, the wrap-up verdict, and what the person should review (the
report, the subtask artifacts, the commit list). Then stop.
