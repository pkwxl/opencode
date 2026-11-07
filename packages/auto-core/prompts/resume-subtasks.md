# resume-subtasks — finish a task whose subtask loop was interrupted

<!-- Sibling of run-as-subtasks.md: the same pipeline, entered mid-task. Its Stage 2 and Stage 3 here are lockstep
copies of run-as-subtasks.md's — change them together or not at all. -->

For a target directory that the auto driver has already initialized (`init`): hand this file, unchanged, to a
coding-agent session opened in the target directory — there is nothing to fill in. The session takes the role of
the driver (`opencode-auto run`) resuming a task whose subtask decomposition is already complete but whose subtask
loop did not finish: an interrupted run's state (a killed driver, a lost terminal, a failed session). It confirms
the boundary, reconstructs whatever unit the interruption left half-done, then re-enters the pipeline at the first
unfinished subtask — never re-running the decomposition — and sequentially launches one child session per remaining
subtask, and finally a fresh verification child session over the task's whole committed range — with a fix session
and a re-verification for every gap list it writes — and the close-out; between child sessions it performs every
driver action itself: the artifact checks, the driver's state writes (checklist ticks, the todo.md → done.md
renames) and the unified commit. All implementation work happens in child sessions launched through the host coding agent's subagent facility; the
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
6. Read the config's `wrapup` key (default true): it decides whether a passing verification also
   writes the task's wrap-up report (`docs/T-NNN/report.md`) — the verification itself always
   runs.
7. The config's `testByDriver` and `handoverTest` keys are both unset: this suite has no driver process to run
   the test script or relay its result. Either key set → stop: the person runs the driver itself
   (`opencode-auto run`) for this task, or `amend`s the config.

## Confirm the boundary, pick the task

- The current phase's index: config `phases: "m"` is the no-phase mode — `docs/R-01/P01-implement/tasks.md`;
  anything else is the phased mode — the latest round (the highest `docs/R-NN/` holding a `phases.md`), first
  phase whose `phases.md` line is unticked (`- [ ]`; the phase close-out ticks it `- [x]` on completion) and
  whose directory holds a `tasks.md`.
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
  3. For every checklist item n (S01 = item 1), exactly one of `docs/T-NNN/S<nn>/todo.md` / `done.md` exists —
     Stage 2's completion act is the rename, so earlier items legitimately hold `done.md` alone — and whichever
     exists ends with the terminator and carries both the `## Scope` and `## Artifacts` headings; an item whose
     `done.md` exists must be ticked `- [x]` in `subtasks.md`, one whose `todo.md` exists unticked (on a clean
     tree the rename and the tick landed in one commit; a disagreement is an inconsistent state, stop and
     report).
  4. The dependency graph is valid: no empty `Depends:`/`Touches:` values, no self-dependency, no cycles, ids are
     this task's S<nn> only.
  Any failure → stop and report: the decomposition is incomplete — finishing it is Stage 1's business under
  run-as-subtasks, not a resume. Passing → never touch the decomposition again: no re-reading session, no rewrite
  of `context.md`, `shared.md`, `subtasks.md` or any `S<nn>/todo.md` / `done.md`.

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
   (`T-NNN decompose <short title>`, Auto-Stage `decompose`).
3. The newest done checklist item never committed: its `done.md` or its ticked line in `subtasks.md` among the
   dirty paths → its `T-NNN S<nn>` commit never ran: commit the tree with that item's subject and stage
   (`T-NNN S<nn> <subtask short title>`, Auto-Stage `subtask <n>`).
4. Whatever is still dirty after 1–3 is the in-flight unit's work in progress — the first not-done subtask's
   partial work, the fix session's partial work, or the verification's report or gap list being written (the
   re-entry point handles those). Leave it on disk: the
   resumed unit's child session continues on it, and that unit's own commit absorbs it.
5. Dirty paths that fit none of the above → stop and report: the person commits or cleans the tree first.

## The re-entry point

Disk state alone decides where the run re-enters — never re-run a stage that already closed:

- Some checklist items not done → Stage 2, at the first ready item.
- All items done → Stage 3, decided by the verification state:
  - `docs/T-NNN/gaps.md` present but trivial, missing its `## Gaps` / `### Gap N` grammar, or missing its
    closing `Result: FAIL` line → a verification was writing it when the run died: delete it and run the
    verification session (Stage 3's loop).
  - `gaps.md` a well-formed gap list → a verification round found gaps and the fix loop is mid-flight. A tree
    dirty beyond the gap list is the interrupted fix session's unlanded work: launch the fix child with its
    dirty re-entry line and land its share (the round number re-derives — one past the highest
    `T-NNN fix <r>.<n>` subject in the log, for an interrupted round's share never landed). A clean tree (the
    gap list alone tolerated) has the fix share already landed. Either way re-verify at Stage 3's loop step 1,
    the resumed loop's progress state derived conservative — and derived before that step's deletion removes
    the list: the best count is the present list's `### Gap N`
    heading count, the no-progress streak one — the interruption erased the streak's history, and the bounded
    reading is the conservative one: the next completed round must strictly lower the best or the loop stops
    for the person.
  - No `docs/T-NNN/report.md` → the verification session never ran or never finished: run it (Stage 3's loop).
  - `report.md` present but trivial or missing the terminator → it was mid-write when the run died: rerun the
    verification session once; it rewrites the report.
  - `report.md` complete → do not rerun the session: read its last `Result:` line and complete Stage 3's
    close-out idempotently — commit the report only when it is still uncommitted, make the completion writes
    only when the task is not already closed (`todo.md` still present), and stop clean when everything already
    landed. A complete report whose last line is `Result: FAIL …` (this suite's or an earlier vintage's stop)
    is a verdict already delivered to the person: commit it only when uncommitted, then stop for the person —
    the person accepts the task with `close` or plans the rework; do not tick the task done, do not re-verify
    the verdict away. No result line → the close-out, as a pass.

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
   subject is truncated past 100 characters. When the target holds nested git repositories, the enclosing
   repository's commit additionally carries one `Auto-Nested: <nested repository path> @ <its short HEAD sha>`
   trailer line per nested repository beneath the two, recording that repository's HEAD as it stands at the
   commit — the pass commits the nested repositories first, so a repository that changed shows the SHA just
   landed, an untouched one its baseline; the nested repositories' own commits carry the two trailers alone.
   Never push, stash, reset, rebase or amend.

Commit subjects and stages (T-NNN = the task, S<nn> = the two-digit subtask number). Every subject that
carries the task's title carries its short form `<short title>`: the title's first clause, cut at the
first `:` / `(` / em-dash (where long titles park their parenthetical detail), capped at four words —
the title's leading words when the first clause is empty; the task id identifies the unit, the full
title stays in the task document and the run's state files, a mechanical rule over the title's form
never its content. The Stage 2 share carries the item's declared short title — its checklist line's
text before the fields, the colon of a `<title>: <description>` line being the clause cut — under the
same four-word cap:

- Stage 2, per subtask: subject `T-NNN S<nn> <subtask short title>`, Auto-Stage `subtask <n>`.
- Stage 3: the wrap-up report's commit (a passing verification, the `wrapup` key true): subject
  `T-NNN wrapup <short title>`, Auto-Stage `wrapup`; a fix round's share (Stage 3's fix loop): subject
  `T-NNN fix <round>.<session> <short title>`, Auto-Stage `execute`; the completion commit afterwards: subject
  `T-NNN done <short title>`, Auto-Stage `done`.
- Reconstruction only (the section above): the task carryover, when the interruption fell between a task's
  completion writes and their commit — subject `T-NNN carryover driver-state posting`, Auto-Stage `carryover`;
  the decompose commit, when the interruption fell between the decomposition and its commit — subject
  `T-NNN decompose <short title>`, Auto-Stage `decompose`.

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
      when self-contained. A bare task id in a comment is acceptable in the workspace tree; inside a
      nested repository — a shipped, self-contained deliverable such as a migration destination — it is a
      failure, as is any path leading outside that repository's own root.

4. Pass → the driver writes: rename `docs/T-NNN/S<nn>/todo.md` → `done.md`, tick the item in subtasks.md
   (`- [ ]` → `- [x]`), commit (`T-NNN S<nn> …`), then continue the loop.

## Stage 3 — verification and close-out

The subtask sessions are finished; whether their output genuinely completes the task is judged by a fresh
verification session — a pair of eyes that has inspected none of the work so far — over the task's whole
committed range, never by the subtask sessions' own claims. A verification that finds gaps leads, through
`docs/T-NNN/gaps.md`, to one fix session and a re-verification: the same protocol `run`'s master control runs
at its loop's steps 5–6, over this pipeline's commit grammar. The re-entry point above decides where this
resume enters the loop; everything below runs from there.

The task's baseline: the parent of the task's first commit carrying the `Auto-Task: T-NNN` trailer (the oldest
`git log --grep="Auto-Task: T-NNN"` hit's parent — the decompose commit is the first). The unit's entire output
is the committed range `<baseline>..HEAD`, this repository and every nested one.

The config's `wrapup` key fills the verification child's wrap-up line: true (the default) → `WRITE`, false →
`SKIP` (no report, no wrap-up commit — the verification itself runs either way).

The loop — a verification round, then while gaps remain:

1. Before launching: delete `docs/T-NNN/report.md` and `docs/T-NNN/gaps.md` when present — each round's verdict
   keys on that round's session writes alone, never on a file an earlier round or a work session left.
2. Launch exactly one fresh verification child session (the unit cycle's rules hold: the baseline HEAD check,
   one feedback relaunch on a failed check, then stop and report):

   ```text
   You are the verification session for task T-NNN: a fresh pair of eyes judging whether the task's subtask
   sessions genuinely completed it. You write no implementation code and you fix nothing — a finding is
   reported, not repaired.

   Read first: docs/T-NNN/todo.md — the task document (title line, Phase: field, ## Goal / ## Scope /
   ## Acceptance). It is the standard you verify against.

   The unit's entire output is the committed range <baseline>..HEAD (this repository and every nested one).
   Verify — all hard checks:

   1. The range holds only the unit's own commits: every commit in <baseline>..HEAD carries the
      `Auto-Task: T-NNN` trailer and this pipeline's subject grammar — `T-NNN decompose …`, `T-NNN S<nn> …`
      (the subtask shares), `T-NNN fix <round>.<session> …` (fix-round shares, when fix rounds ran).
      Anything else in the range is a hard failure — report it as such.
   2. The driver's state files are untouched: docs/T-NNN/todo.md still present, no done.md, the task's index
      line still unticked.
   3. The task's required actions: every ## Scope item acted on and every ## Acceptance criterion actually
      met — judged from the work itself, never from the subtask sessions' claims. Verify by inspection: read
      the range's diff (`git diff <baseline>..HEAD`, each repository) and the deliverables against what the
      task requires. Do not re-run the acceptance's executable checks (its tests, the typecheck or build) —
      the last subtask session already ran the task's full acceptance verification and repaired what it
      found. Never accept a claim you have not inspected yourself.
   4. Every Markdown file created or modified in this unit ends with a line holding only <!-- auto: eof -->
      as its last line of body text.
   5. Process documents are not design dependencies: lines this unit added to deliverable files (every path
      outside the process documents `docs/T-*`, `docs/R-*`, `docs/phases/`, `PLAN.md`, `.auto/`, and outside
      `AGENTS.md` and `.opencode/`) must not reference those process paths. `AUTO-*` marker lines inside code
      comments are fine when self-contained. A bare task id in a comment is acceptable in the workspace tree;
      inside a nested repository — a shipped, self-contained deliverable such as a migration destination — it
      is a failure, as is any path leading outside that repository's own root.

   By outcome:
   - All checks pass → write docs/T-NNN/report.md, the task's wrap-up report (the wrap-up line is <WRITE|SKIP>):
     one short section per acceptance criterion — what was done, with the evidence (your inspection and its
     outcome, the artifact path or code location) — then two sections of your own, overall conclusion and open
     issues. Write the result line as the last line of body text of the report (before the terminator), on a
     line of its own: `Result: PASS` — a protocol string, written exactly as given, never translated, bolded
     or list-marked. Under SKIP write no report at all. Every Markdown document you create ends with a line
     holding only <!-- auto: eof --> as its last line of body text.
   - Any check fails → write no report. Write docs/T-NNN/gaps.md: first a compact summary of what you verified
     as OK (so the fix session does not redo it), then one entry per gap as a `### Gap N — <one-line title>`
     heading under a `## Gaps` heading (N counting 1, 2, …; the entry under its heading names the missing or
     wrong required action, where — files —, and what exactly to do) — ending with
     `Result: FAIL <one-sentence reason>` as that file's last line of body text (no terminator in that file).
     A fix session then closes exactly the listed gaps and the verification re-runs from scratch.

   Do not run git commit or any commit command; do not create, rename or delete any state file — the verdict's
   two named writes above are your only writes. End your reply with the verdict line, on a line of its own:
   `Verification: PASS` or `Verification: INCOMPLETE` (protocol strings, verbatim). End the session as soon as
   the verdict is delivered. Your final reply is the driver's only intake from you — keep it to a few lines
   around the verdict line; the details belong in report.md / gaps.md on disk.
   ```

3. Read the verification's verdict — the last line of its reply. A reply without the verdict line → one
   feedback relaunch ("end your reply with the verdict line"), then stop and report. Shape-check the verdict's
   own writes: PASS requires the report (WRITE only) non-trivial, terminated, its last `Result:` line
   `Result: PASS`; INCOMPLETE requires the gap list non-empty, carrying at least one `### Gap N —` heading
   under `## Gaps`, its last line `Result: FAIL …`. A malformed verdict write → one feedback relaunch naming
   the deficiency, then stop and report.
4. `Verification: PASS` → the close-out:
   1. Delete `docs/T-NNN/gaps.md` when present: a fixed round's gap list is uncommitted transient state —
      removed from disk alone, landing in no commit.
   2. WRITE only: commit the report (`T-NNN wrapup <short title>`, Auto-Stage `wrapup`). SKIP: no report, no
      wrap-up commit.
   3. The completion writes: rename `docs/T-NNN/todo.md` → `done.md`, tick the task's line in the phase's
      `tasks.md` (`- [ ] T-NNN` → `- [x] T-NNN`), and if `.auto/units.json` holds a record for this task,
      remove that record; commit these writes (`T-NNN done <short title>`, Auto-Stage `done`).
5. `Verification: INCOMPLETE` → measure, then fix:
   1. Count the gap list's `### Gap N` headings — the count the progress rule measures. The loop's best count
      is the minimum its FAILs have measured; the first FAIL only seeds it. This round made progress only
      when a later FAIL's count is strictly lower than the best — same count, grown count or a re-fall to a
      count the loop already saw is no progress. Once two consecutive fix rounds made no progress, stop and
      report: the work stays landed as the fix shares, the last gap list stays on disk for the person — the
      person accepts the task with `close` or plans the rework. Do not tick the task done. (A loop that keeps
      making progress keeps going: from N seed gaps it runs at most 2N+2 fix rounds before it passes or
      blocks.)
   2. Launch one fix child session — round <r>, one past the highest `T-NNN fix <r>.<n>` subject already in
      the log (round 1 when none exists):

      ```text
      You are the fix session for task T-NNN: its verification session judged the work incomplete and listed
      the gaps — you close exactly those gaps. The tree holds the work so far; build on it, do not restart,
      and do not redo what the verification already accepted.

      Read first: docs/T-NNN/gaps.md — the verification's gap list (a compact summary of what was verified as
      OK, then one entry per gap as a `### Gap N — <one-line title>` heading under a `## Gaps` heading: the
      required action that is missing or wrong, where — files —, and what exactly to do) — and
      docs/T-NNN/todo.md, the task document, for the goal and acceptance behind the gaps.

      [dirty re-entry only] An earlier fix session on this round was interrupted; part of its work may
      already sit in the working tree — read what is there and continue from it instead of starting over.

      Work: close every listed gap — plus anything one obviously requires — and nothing else: no refactoring,
      no "improvements" to the parts the verification accepted, no new scope. Re-check the gaps you closed:
      run the checks that target your own changes (their tests, the typecheck or build of what you touched),
      not the full suite.

      Other tasks belong to other sessions — do not touch them. The todo.md → done.md renames and the index
      ticks of phases, tasks and subtasks are the DRIVER's alone; do not create, rename or delete
      docs/T-NNN/todo.md or done.md or any docs/T-NNN/S<nn>/ state file. Do not edit or write
      docs/T-NNN/gaps.md or report.md — both belong to the verification channel; the next verification round
      rewrites them. A decision of your own must leave a record in the relevant document or code comment: a
      call that should have been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option>
      (<reason>)` line, any other call an `AUTO-DECISION: <decision> (<reason>)` line. Do not run git commit
      or any commit command — the driver lands your work as its own commit when you end. Every Markdown
      document you create (or rewrite in full) ends with a line holding only <!-- auto: eof --> as its last
      line of body text. End the session as soon as the gaps are closed and re-checked, so the re-verification
      can start from scratch. Your final reply goes back to the driver — keep it to a few lines (which gaps
      you closed, where).
      ```

   3. Checks: the session changed something besides the gap list itself (`git status --porcelain` lists more
      than `docs/T-NNN/gaps.md`) — a zero-write fix session closed nothing → one feedback relaunch, then stop
      and report (skipped for a dirty re-entry: the leftover already dirties the tree; the terminator check
      below decides); every Markdown file it created or modified ends with the terminator. Pass → land the fix
      share: the unified commit with `docs/T-NNN/gaps.md` unstaged
      back out first (`git restore --staged docs/T-NNN/gaps.md` when it exists — the gap list stays on disk,
      never in a commit), subject `T-NNN fix <round>.<session> <short title>` (<session> one past the highest
      `T-NNN fix <round>.<n>` subject already in the log for that round — 1 when none exists), Auto-Stage
      `execute`.
   4. Re-verify: back to step 1 — the fresh verification round judges the whole task from scratch again (the
      gaps closed exempt nothing else), and the next FAIL's count is measured against the loop's best per
      step 5.1.

## Hands off — driver-adjacent rules

- One task only: the resumed task, and only to its completion — do not start the next task, do not plan new work,
  do not modify other tasks' documents or the round/phase documents (`docs/R-NN/round.md`, `phases.md`).
- Never edit `.opencode/auto/config.json`, `AGENTS.md`, or anything under `.auto/` except the `units.json` record
  removal above.
- You make no edits of your own to task content: apart from the state writes (ticks, renames, the cleanup), the
  verification round's reserved-file deletions, and the commits, everything on disk was written by child
  sessions.
- The worktree must end clean: anything left uncommitted at the end is committed as the close-out commit, or the
  run stops and reports — the one tolerated residue is the fix loop's uncommitted gap list at a stop (the
  person's input, never absorbed into a commit).

## Finish

Report: the task resumed and where it re-entered (which subtasks were already done, which this run executed), each
subtask's one-line outcome with its commit subject, each verification's verdict and the fix rounds spent, the
wrap-up verdict, and what the person should review (the report, the subtask artifacts, the commit list). Then
stop.
