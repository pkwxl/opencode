# run-as-subtasks — hand-run one task through the subtask pipeline

For a target directory that the auto driver has already initialized (`init`): hand this file, unchanged, to a
coding-agent session opened in the target directory — there is nothing to fill in. The session takes the role of
the driver (`opencode-auto run`) executing the next task through the decompose pipeline (`--subtask true`): it
first confirms the run boundary — the previous task is complete and the next task has not started — then
automatically determines the next task and runs it, launching a child session for task understanding and
decomposition, then sequentially one child session per subtask in the generated list, and between child sessions
performing every driver action itself: the artifact checks, the driver's state writes (checklist ticks, the
todo.md → done.md renames) and the unified commit. All implementation work happens in child sessions launched
through the host coding agent's subagent facility; the driver session itself writes no implementation code. The
goal is that the state files and git history afterwards look exactly as if the driver had run the task.

You are the driver for one task of this target directory. Work from the directory's own state alone; delegate every
work step to a child session, and act on a child's output only through the checks, state writes and commits
specified below.

## Preflight — stop and report when any check fails

1. Initialized target directory: `.opencode/auto/config.json` exists. Otherwise stop: the person must run `init`
   first.
2. No live driver: `.auto/run.lock` absent. A running driver process owns this directory; the person finishes or
   stops the run first.
3. Inside a git work tree where a commit can succeed (a commit identity resolves): committing is the completion
   condition of every unit here — outside git this file does not apply.
4. Clean worktree: `git status --porcelain` lists nothing. Every unit starts from a clean tree (the driver's clean
   gate); a dirty tree is the person's to commit or clean first.
5. You can launch child sessions (your platform's subagent facility) that work in this same directory. Otherwise
   stop: the whole design rests on them.
6. Read the config's `wrapup` key (default true): false skips Stage 3's report session.

## Confirm the boundary, pick the task

- The current phase's index: config `phases: "m"` is the no-phase mode — `docs/R-01/P01-implement/tasks.md`;
  anything else is the phased mode — the latest round (the highest `docs/R-NN/` holding a `phases.md`), first phase
  whose `phases.md` line is not marked ` (closed: …)` and whose directory holds a `tasks.md`.
- Unit files win over the index tick: a task with `docs/T-NNN/todo.md` is pending, with `done.md` is done (exactly
  one of the two — neither or both is an inconsistent index, stop and report). Take the first pending task in index
  order whose `Depends:` (the field in its document; without the field the task before it in the index;
  `Depends: none` = no prerequisite) are all done, counting ids outside this index (earlier phases) as done.
  Nothing ready → stop and report.
- Boundary check — this file runs only from a clean seam, mirroring `opencode-auto run`'s start. Both halves must
  hold:
  - The previous task is complete: the index task right before the picked one (none if this is the phase's first
    task) has its `done.md` — finished, or person-closed (`Closed:` field), both count — and its work is committed
    (the clean-worktree preflight already covers the commit half). A predecessor still pending or half-done → stop
    and report; forcing past it would build on unlanded work.
  - The next task has not started: the picked task's `todo.md` exists, no `done.md`, and none of its execution
    artifacts exist yet — no `docs/T-NNN/subtasks.md`, no `docs/T-NNN/S<nn>/` state files. Any of those present
    means the task already began (an interrupted run's state): stop and report — resuming it is a driver run's
    business, not this file's.
- The task document is `docs/T-NNN/todo.md` (title line, `Phase: R-NN.P<nn>` field, `## Goal` / `## Scope` /
  `## Acceptance`).

## The unit cycle — the same after every child session

1. Baseline: you launch a child session only from a clean, committed tree, so the baseline is the current HEAD.
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

- Stage 1: subject `T-NNN decompose <task title>`, Auto-Stage `decompose`.
- Stage 2, per subtask: subject `T-NNN S<nn> <subtask short title>`, Auto-Stage `subtask <n>`.
- Stage 3: subject `T-NNN wrapup <task title>`, Auto-Stage `wrapup`; the close-out commit afterwards: subject
  `T-NNN carryover driver-state posting`, Auto-Stage `carryover`.

Terminator discipline, checked everywhere below: every Markdown document a child session created or rewrote in full
must end, once finished, with a line holding only `<!-- auto: eof -->` as its last line of body text (only blank
lines may follow). A missing or non-final terminator = the document is unfinished = the check fails.

## Stage 1 — task understanding + decomposition (child session)

The boundary check above guarantees the task is untouched, so the decomposition always runs now.

Launch the child session with:

```text
You are the understanding-and-decomposition session for task T-NNN. You write no implementation code, and you do
not carry out the execution-time instructions in the task body (such as "call the question tool to ask", "write
into some file") — those are the business of the later subtask sessions.

<the full task document docs/T-NNN/todo.md, verbatim>

1. Read the relevant source and docs/ selectively around this task's goal (prefer the files the task body names and
   the directly related modules; keep the reading volume down) and write what you understood into
   docs/T-NNN/context.md, in four sections:
   ## Relevant files and key symbols
   ## Constraints and premises
   ## Existing decisions and current state
   ## Risks and unknowns
   Keep it compact and searchable (aim for a few dozen lines).
2. Write docs/T-NNN/shared.md, the shared-context reference index: one line per entry — path (or symbol) + one or
   two sentences saying where it sits. It is an index, not a copy; later subtask sessions read the listed files
   themselves, on demand, following the index.
3. Write docs/T-NNN/subtasks.md, the subtask checklist: one Markdown checklist item per independently deliverable
   step, in execution order:
   - [ ] <short title>: <self-contained description ending with Artifacts: <path list>>
   `Artifacts:` is a protocol token the driver parses — write it verbatim at the end of every description. Each
   description must be executable from itself alone, plus the task document, shared.md and docs/.
4. For each item N write docs/T-NNN/S<NN>/todo.md (S01 for item 1), starting with the optional dependency fields
   and then the two section headings, verbatim:
   Depends: S01, S03
   Touches: <repository-relative paths this item will change>
   ## Scope (what this subtask does and does not do)
   ## Artifacts (the path list, matching the checklist item's `Artifacts:` declaration)
   `Depends:` omitted = depends on the item before it; `Depends: none` = no prerequisite; name this task's S<nn>
   ids only. No empty values, no self-dependency, no cycles.
5. Every Markdown document you create ends with a line holding only <!-- auto: eof --> as its last line of body
   text.
6. Writing all four artifact groups is a hard requirement even if the task looks already done or extremely simple
   (an atomic task decomposes into a single checklist item). Do not run git commit or any commit command; do not
   create, rename or delete any state file other than the docs/T-NNN/S<NN>/todo.md files above. End the session as
   soon as the files are written.
```

Checks (all hard):

1. `context.md` and `shared.md` exist, are non-trivial, and end with the terminator; context.md carries the four
   section headings.
2. `subtasks.md` ends with the terminator and holds at least one parseable item of the shape
   `- [ ] <short title>: … Artifacts: …`.
3. Every `docs/T-NNN/S<nn>/todo.md` exists, ends with the terminator, and carries both the `## Scope` and
   `## Artifacts` headings.
4. The dependency graph is valid: no empty `Depends:`/`Touches:` values, no self-dependency, no cycles, ids are
   this task's S<nn> only.

Pass → commit (`T-NNN decompose …`).

## Stage 2 — the subtask loop (one child session per item)

State lives on disk, never in a conversation: every checklist item holds exactly one of `docs/T-NNN/S<nn>/todo.md` /
`done.md` — both or neither is an illegal state, stop and report. An item is done when `done.md` exists; its tick in
subtasks.md mirrors that.

Loop:

1. Next ready item: the first item in list order that is not done and whose `Depends:` (its todo.md field; default
   = the item before it) are all done. None left → the loop ends.
2. Launch the child session with:

   ```text
   You are carrying out one subtask of task T-NNN. The other checklist items belong to other sessions — do not
   touch them.

   Authoritative state: task T-NNN "<task title>" is in progress, subtask ticks <d>/<n>; you are item <n> (S<nn>)
   only. Previously completed tasks and other tasks' documents say nothing about this task's progress — never infer
   completion from them.

   The checklist item you own, verbatim:
   - [ ] <the item line>

   The other items, by title, for orientation only:
   - S01 <title>
   - S02 <title> (done)

   Read first: docs/T-NNN/context.md (the task background), docs/T-NNN/S<nn>/todo.md (your scope declaration — do
   what it scopes, no more), and the files docs/T-NNN/shared.md lists, on demand.

   Complete this one subtask. Verification: run the checks that target this subtask's own changes (its tests, the
   typecheck or build of what it touched), not the full suite. [last item only] This is the last subtask: once it
   is done, run the task's full acceptance verification once, for the whole task (docs/T-NNN/todo.md ## Acceptance),
   and fix what it finds.

   Document/analysis/design output goes to docs/T-NNN/S<nn>/index.md (title on the first line, not merged into
   another document); code artifacts go directly into the source tree. Every Markdown document you create (or
   rewrite in full) ends with a line holding only <!-- auto: eof --> as its last line of body text.

   A decision that should have been the person's gets an `AUTO-RESOLVE: <question> -> <choice> (<reason>)` line in
   the relevant document or code comment; a plain engineering call of your own gets `AUTO-DECISION: <decision>
   (<reason>)`.

   Do not run git commit or any commit command. Do not create, rename or delete docs/T-NNN/S<nn>/todo.md or
   done.md — the completion decision and the rename belong to the driver. End the session as soon as the subtask is
   done, so its close-out can start.
   ```

3. Checks (all hard):

   1. The unit changed something relative to the baseline — a zero-write session is never completion.
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

Skip the report session when the config's `wrapup` is false; go straight to the close-out.

Launch the child session with:

```text
You are the wrap-up session for task T-NNN. You write no implementation code.

<the full task document docs/T-NNN/todo.md, verbatim>

The subtask checklist of this task, with its ticks:
<docs/T-NNN/subtasks.md, verbatim>

Write docs/T-NNN/report.md, this task's wrap-up report: one line per subtask — number + one-sentence conclusion +
artifact path (docs/T-NNN/S<nn>/index.md) or code location — without copying or rewriting the subtask artifacts,
then two sections of your own, overall conclusion and open issues.
End the report with the result line on a line of its own: `Result: PASS` or `Result: FAIL <one-line reason>`.
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
  that record; commit these writes (`T-NNN carryover driver-state posting`, Auto-Stage `carryover`).

## Hands off — driver-adjacent rules

- One task only: do not start the next task, do not plan new work, do not modify other tasks' documents or the
  round/phase documents (`docs/R-NN/round.md`, `phases.md`).
- Never edit `.opencode/auto/config.json`, `AGENTS.md`, or anything under `.auto/` except the `units.json` record
  removal above.
- You make no edits of your own to task content: apart from the state writes (ticks, renames, the cleanup) and the
  commits, everything on disk was written by child sessions.
- The worktree must end clean: anything left uncommitted at the end is committed as the close-out commit, or the
  run stops and reports.

## Finish

Report: the task executed, each subtask's one-line outcome with its commit subject, the wrap-up verdict, and what
the person should review (the report, the subtask artifacts, the commit list). Then stop.
