# run-as-subtasks — hand-run one task through the subtask pipeline

For a target directory that the auto driver has already initialized (`init`): hand this file, unchanged, to a
coding-agent session opened in the target directory — there is nothing to fill in. The session takes the role of
the driver (`opencode-auto run`) executing the next task through the decompose pipeline (`--subtask true`): it
first confirms the run boundary — the previous task is complete and the next task has not started — then
automatically determines the next task and runs it, launching a child session for task understanding and
decomposition, then sequentially one child session per subtask in the generated list, and finally a fresh
verification child session over the task's whole committed range — with a fix session and a re-verification
for every gap list it writes — and between child sessions
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

- Stage 1: subject `T-NNN decompose <short title>`, Auto-Stage `decompose`.
- Stage 2, per subtask: subject `T-NNN S<nn> <subtask short title>`, Auto-Stage `subtask <n>`.
- Stage 3: the wrap-up report's commit (a passing verification, the `wrapup` key true): subject
  `T-NNN wrapup <short title>`, Auto-Stage `wrapup`; a fix round's share (Stage 3's fix loop): subject
  `T-NNN fix <round>.<session> <short title>`, Auto-Stage `execute`; the completion commit afterwards:
  subject `T-NNN done <short title>`, Auto-Stage `done`.

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
   Keep it compact and searchable (aim for a few dozen lines). Cross-task reference discipline: point cross-task
   references only at phase-level single sources (rulings, contracts, ledgers), never at a previous task's
   wrap-up narrative — a completion narrative flowing in through a reference is misread by a downstream session
   as a sign that this task is already done — and excerpt the points you need instead of sending the reader
   back to a whole document.
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
5. A decision of your own must leave a record in the relevant document or code comment: a call that should have
   been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, any other
   call an `AUTO-DECISION: <decision> (<reason>)` line.
6. Every Markdown document you create ends with a line holding only <!-- auto: eof --> as its last line of body
   text.
7. Writing all four artifact groups is a hard requirement even if the task looks already done or extremely simple
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

   1. The unit changed something relative to the baseline — a zero-write session is never completion.
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
at its loop's steps 5–6, over this pipeline's commit grammar.

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
      and report; every Markdown file it created or modified ends with the terminator. Pass → land the fix
      share: the unified commit with `docs/T-NNN/gaps.md` unstaged
      back out first (`git restore --staged docs/T-NNN/gaps.md` when it exists — the gap list stays on disk,
      never in a commit), subject `T-NNN fix <round>.<session> <short title>` (<session> one past the highest
      `T-NNN fix <round>.<n>` subject already in the log for that round — 1 when none exists), Auto-Stage
      `execute`.
   4. Re-verify: back to step 1 — the fresh verification round judges the whole task from scratch again (the
      gaps closed exempt nothing else), and the next FAIL's count is measured against the loop's best per
      step 5.1.

## Hands off — driver-adjacent rules

- One task only: do not start the next task, do not plan new work, do not modify other tasks' documents or the
  round/phase documents (`docs/R-NN/round.md`, `phases.md`).
- Never edit `.opencode/auto/config.json`, `AGENTS.md`, or anything under `.auto/` except the `units.json` record
  removal above.
- You make no edits of your own to task content: apart from the state writes (ticks, renames, the cleanup), the
  verification round's reserved-file deletions, and the commits, everything on disk was written by child
  sessions.
- The worktree must end clean: anything left uncommitted at the end is committed as the close-out commit, or the
  run stops and reports — the one tolerated residue is the fix loop's uncommitted gap list at a stop (the
  person's input, never absorbed into a commit).

## Finish

Report: the task executed, each subtask's one-line outcome with its commit subject, each verification's verdict
and the fix rounds spent, the wrap-up verdict, and what the person should review (the report, the subtask
artifacts, the commit list). Then stop.
