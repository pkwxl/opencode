# run — master control for all incomplete tasks

For a target directory that the auto driver has already initialized (`init`): hand this file, unchanged, to a
coding-agent session opened in the target directory, together with its three companions — `run-task.md`,
`run-verify.md` and `run-fix.md` (same directory, or all four pasted into the session). There is nothing to fill
in. The session takes the role of the driver (`opencode-auto run`) and executes **every** incomplete task of the
current phase, one at a time: it determines the next ready task, launches task child sessions that carry the
task to completion — a session hands its context over through `docs/T-NNN/handoff.md` when its share of the
work is done or its session budget runs out, and the master control relaunches until the task's scope is
complete — then a fresh verification child session that judges whether the task's required actions were
completed; a verification that finds gaps leads — through the verification's `docs/T-NNN/gaps.md` — to a fix
child session and a re-verification. The verification judges the work's completeness by inspection only: the
task session has already run the acceptance's executable checks (its tests, the typecheck or build) and
repaired what they found, so the verification re-runs none of them — a defect only a re-run would catch is
left for the person to judge once all tasks are done. A verification that passes performs the close-out itself —
the driver's completion commits exactly as it makes them after a whole-task session: the work commit, the
wrap-up report's own commit, then the completion commit over the state writes (the deletions of the stale gap
list and the consumed handover, `todo.md` → `done.md`, the index tick) — and its `PASS` verdict
tells you the task is safe to advance past. All implementation
work happens in child sessions launched through the host coding agent's subagent facility; the master-control
session itself writes no implementation code and makes no commits or state writes — every commit and every
state write belongs to a child session. The goal is that the state files and git history afterwards look
exactly as if the driver had run the phase with `--subtask off`.

You are the master control (the driver) for this target directory's incomplete tasks. Work from the directory's
own state alone; delegate every work step to a child session, and act on a child's output only through the
checks specified below.

## Preflight — stop and report when any check fails

1. Initialized target directory: `.opencode/auto/config.json` exists. Otherwise stop: the person must run `init`
   first.
2. No live driver: `.auto/run.lock` absent. A running driver process owns this directory; the person finishes or
   stops the run first.
3. Inside a git work tree where a commit can succeed (a commit identity resolves): committing is the completion
   condition of every unit here — outside git this file does not apply.
4. Clean worktree: `git status --porcelain` lists nothing — in this repository and in every nested repository
   the target holds (work inside a gitignored nested repository leaves the outer status clean). Every task
   starts from a clean tree (the driver's clean gate); a dirty tree is the person's to commit or clean first.
5. You can launch child sessions (your platform's subagent facility) that work in this same directory, and the
   three companion files are available to you verbatim. Otherwise stop: the whole design rests on them.
6. Read the config's `wrapup` key (default true): it decides whether a passing verification also writes the
   task's wrap-up report (`docs/T-NNN/report.md`).
7. The config's `testByDriver` and `handoverTest` keys are both unset: this suite has no driver process to run
   the test script or relay its result. Either key set → stop: the person runs the driver itself
   (`opencode-auto run`) for these tasks, or `amend`s the config.

## Keep your own context small

You may drive dozens of tasks in this one session; your context is the scarce resource. Read only what the
mechanical decisions need: the phase index lines, the `Depends:` field lines at the head of a picked task's
`todo.md`, and file-existence checks (`todo.md` / `done.md` / `subtasks.md` / `handoff.md` / `gaps.md` /
`report.md` / `S<nn>/` state). Never read a whole task document, a handoff, a report or the work diff yourself
(tailing a document's last line — a handover's `Status:` line, a report's `Result:` line — is a mechanical
check, not a read); content judgment belongs to the child sessions: the task session reads its task document
and the sources, the verification session reads the work, the fix session reads the gap list. Fill child
prompts with short facts only, take a child's outcome only through its verdict line plus the mechanical checks
below, and keep every
reply a child sends you to a few lines (the companions instruct them so).

## Launching a child session

- Take the companion file (`run-task.md`, `run-verify.md` or `run-fix.md`), fill its `<angle-bracket>`
  placeholders with the short facts you already hold — a task id, the task title from the index line, the
  baseline SHA, the wrap-up flag, the session budget — and pass the whole resulting text as the child
  session's prompt. Never quote
  a file's content into a prompt: everything a child needs (its task document, the gap list, source, docs/) it
  reads itself, at the paths the prompt names. Your prompts carry pointers, not contents.
- Child sessions run one at a time, never in parallel, always in this same directory.
- Label every child launch in the host's subagent facility with the pattern `Task session T-NNN`,
  `Verification session T-NNN` or `Fix session T-NNN` (append the retry round on relaunches, e.g.
  `Task session T-NNN (continue)`): the host prefixes its agent type and surfaces the label wherever it
  shows subagents — the only visibility a background child gets beyond the completion notification.
- Launch children foreground (synchronously) whenever the host renders a foreground subagent as an
  inspectable entry — the person can open the child's own transcript while it runs, and that visibility is
  worth it. The trade: a foreground subagent that goes quiet for ~10 minutes is killed by the harness, and
  these tasks run builds and gate suites far longer — which is why the survival discipline (long commands
  backgrounded, logs polled in short steps) sits in the task/fix companions. When a child is killed by the
  harness anyway or lost to an infrastructure error (inactivity timeout, quota ticket, cancellation),
  relaunch the same role through the platform's background facility (no inactivity kill, but no host
  visibility either) with one line of feedback to continue on the dirty tree it left — that retry is
  separate from the relaunch budget in the loop below. The same stop-and-relaunch applies to a background
  child that runs past its session budget without ending: stop it and relaunch with the continue line — its
  checkpointed tree makes that safe, and its successor picks up from the handover or the tree.
- The session budget turns the handover on: fill `<session budget>` in `run-task.md` / `run-fix.md` with
  `60 minutes` unless the person directed another figure. A task or fix child that cannot finish inside it
  wraps up — ten minutes before the budget it stops starting new work — and hands over through
  `docs/T-NNN/handoff.md` instead of overrunning; a fresh budget rides every relaunch.
- When the target holds nested git repositories, the baseline is multi-repo: record HEAD of this repository
  and of each nested one, and run every HEAD check and dirty-tree check of the loop against them all.
- After the task or a fix child session: HEAD must still equal the baseline you recorded for the current task
  (a cheap `git rev-parse HEAD`). A commit command there is a hard failure — stop and report. Only the
  verification child session on `PASS` commits (its close-out); after it, HEAD must have advanced by exactly
  its close-out commits and the worktree be clean again. Never push, stash, reset, rebase or amend.
- Terminator discipline, enforced by the verification child sessions and by you for the report: every Markdown
  document a child session created or rewrote in full must end, once finished, with a line holding only
  `<!-- auto: eof -->` as its last line of body text (only blank lines may follow) — the handover document
  excepted: its last line is the `Status:` line. A missing or non-final terminator = the document is
  unfinished.

## Confirm the boundary, pick the first task

- The current phase's index: config `phases: "m"` is the no-phase mode — `docs/R-01/P01-implement/tasks.md`;
  anything else is the phased mode — the latest round (the highest `docs/R-NN/` holding a `phases.md`), first
  phase whose `phases.md` line is not marked ` (closed: …)` and whose directory holds a `tasks.md`.
- Unit files win over the index tick: a task with `docs/T-NNN/todo.md` is pending, with `done.md` is done
  (exactly one of the two — neither or both is an inconsistent index, stop and report). A task is ready when its
  `Depends:` (the field lines in its document; without the field the task before it in the index; `Depends:
  none` = no prerequisite) are all done, counting ids outside this index (earlier phases) as done.
- Boundary check — the loop runs only from a clean seam, mirroring `opencode-auto run`'s start. Both halves must
  hold for the first ready task you take:
  - The previous task is complete: the index task right before it (none if this is the phase's first task) has
    its `done.md` — finished, or person-closed (`Closed:` field), both count — and its work is committed (the
    clean-worktree preflight already covers the commit half). A predecessor still pending or half-done → stop and
    report; forcing past it would build on unlanded work.
  - The next task has not started: its `todo.md` exists, no `done.md`, and none of its execution artifacts exist
    yet — no `docs/T-NNN/subtasks.md`, no `docs/T-NNN/S<nn>/` state files, no `docs/T-NNN/handoff.md`, no
    `docs/T-NNN/gaps.md`, no `docs/T-NNN/report.md`. Any of those present means the task already began (an
    interrupted run's state): stop and report — resuming it is a driver run's business, not this file's.
- The task document is `docs/T-NNN/todo.md` (title line, `Phase: R-NN.P<nn>` field, `## Goal` / `## Scope` /
  `## Acceptance`).

## The loop — per task

State lives on disk, never in the conversation: re-read the index and the state files at the top of every
iteration.

1. Take the first ready task `T-NNN` in index order (rules above). Nothing ready → Finish. Record the baseline:
   the current HEAD of this repository and of every nested repository. The task's first child session starts
   from the clean, committed tree; every later child of
   the same task works on the dirty tree the previous child left — that uncommitted state is the task's work in
   progress.
2. Launch the task child session: `run-task.md` with `<task id>` and `<session budget>` filled — the session
   reads `docs/T-NNN/todo.md` itself.
3. When it ends: HEAD still the baseline (else stop and report), and the session changed something —
   `git status --porcelain` must list something, in this repository or a nested one (the handover document
   counts): a zero-write session is never completion. Zero writes → relaunch the task child session once,
   appending one line of feedback ("your previous session ended without writing anything — carry the task
   out"); still zero writes → stop and report.
4. Hand over or finish: when `docs/T-NNN/handoff.md` exists, tail its last body line — the status line.
   `Status: continue` → relaunch the task child session (step 2; it reads the handover itself — label the
   relaunch as a continuation). `Status: done`, or no handover document, → the task's sessions are finished;
   go to step 5. A handover document that exists but lacks its status line → relaunch the task child session
   once with the feedback "the handover document lacks its `Status: continue|done` last line — a driver
   protocol string, write it verbatim"; still invalid → stop and report. More than ten task-child sessions
   for one task (continuations included) → stop and report: the task is larger than its planning meant, or
   the sessions are looping — the person's call.
5. Launch the verification child session: `run-verify.md` with `<task id>`, `<baseline commit>` (the recorded
   HEAD), `<task title>` (from the index line) and the wrap-up line (`WRITE` or `SKIP` per the config's
   `wrapup` key) filled. The prompt's re-verification behavior keys on `docs/T-NNN/gaps.md` existing — you
   write nothing for it. On `PASS` the verification itself performs the close-out (the commits and state
   writes); you only check its outcome.
6. Read the verification's verdict — the last line of its reply: `Verification: PASS` or
   `Verification: INCOMPLETE` (protocol strings, verbatim). A reply without the verdict line → relaunch the
   verification child session once with the feedback "end your reply with the verdict line"; still missing → stop
   and report.
   - `INCOMPLETE` → the gap list is `docs/T-NNN/gaps.md` (the verification wrote it). First confirm nothing
     was committed and the state files are untouched (HEAD still the baseline; `todo.md` present, no `done.md`,
     the index line unticked — a verification that committed or wrote them on INCOMPLETE is a hard failure, stop
     and report). If two fix rounds have already run for this task, stop and report: the work stays uncommitted
     for the person to judge. Otherwise launch the fix child session (`run-fix.md` with `<task id>` and
     `<session budget>` filled — the session reads the gap list itself), check HEAD afterwards, check its
     handover exactly as step 4 does (`Status: continue` → relaunch the fix child; no handover document or
     `Status: done` → the round's fix sessions are finished; more than three fix sessions in one round → stop
     and report), then launch a fresh verification child session (step 5 again). A task gets at most two fix
     rounds.
   - `PASS` → the verification has already closed the task out; check its outcome mechanically: HEAD advanced
     from the baseline by exactly its close-out commits — `T-NNN exec <task title>`, then (wrap-up line `WRITE`
       only) `T-NNN wrapup <task title>`, then `T-NNN done <task title>`; `git status --porcelain` lists nothing
       (this repository and every nested one); `docs/T-NNN/done.md` exists (no `todo.md`), the index line is
       ticked, and `docs/T-NNN/gaps.md` and `docs/T-NNN/handoff.md` are gone.
     When the wrap-up line was `WRITE`, also check `docs/T-NNN/report.md` mechanically — it exists and is
     non-empty, the terminator is its last body line, and its last `Result:` line is `Result: PASS` (a tail of
     the file; do not read the body). Anything missing → relaunch the verification child session once with the
     specific deficiency as feedback; still failing → stop and report.
7. Next iteration: back to step 1 — the index now shows this task ticked and its `done.md` exists.

## Hands off — driver-adjacent rules

- Never edit `.opencode/auto/config.json`, `AGENTS.md`, or anything under `.auto/`; never modify the
  round/phase documents (`docs/R-NN/round.md`, `phases.md`) and never
  plan new work — planning is a planning session's business. The verification child's close-out is the one
  sanctioned writer of the state writes and the `units.json` record removal — none of it is yours.
- You make no edits, no commits and no state writes of your own: everything on disk was written by child
  sessions; the close-out is the verification child's, not yours.
- One task at a time, one child session at a time; the commits happen inside the verification child's
  close-out, once per task, after a verification passes.
- One sanctioned exception: protocol edits under `prompts/` that the person directs mid-run are the master
  control's to make; the verification child whose unit is open (or the next one) is briefed with the short
  facts that they are out-of-unit — excluded from its checks, never part of a task's work diff — and its
  close-out lands them as their own commit ahead of the task's exec commit.
- A stop always leaves the person in charge: report what finished, what did not, and what state the tree is in
  (an unfinished task's work stays uncommitted — committing it is the person's decision, not yours).

## Finish

Report: every task executed with its commit subjects, each verification's verdict and fix rounds spent, the
wrap-up verdicts, and what the person should review (the reports, the commit list, the `AUTO-RESOLVE`/
`AUTO-DECISION` markers; the verifications inspected the work but did not re-run the acceptance's executable
checks — a final test pass before accepting the phase is the person's call). Then stop.
