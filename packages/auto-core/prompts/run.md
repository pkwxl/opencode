# run — master control for all incomplete tasks

For a target directory that the auto driver has already initialized (`init`): hand this file, unchanged, to a
coding-agent session opened in the target directory, together with its five companions — `run-task.md`,
`run-verify.md`, `run-fix.md`, `run-handover.md` and `run-plan.md` (same directory, or all six pasted into
the session). There is nothing to fill
in. The session takes the role of the driver (`opencode-auto run`) and executes **every** incomplete task of the
current phase, one at a time: it determines the next ready task, launches task child sessions that carry the
task to completion — a session hands its context over through `docs/T-NNN/handoff.md` when its share of the
work is done or its session budget runs out, and the master control relaunches until the task's scope is
complete, landing each session's share as its own commit at the boundary — then a fresh verification child
session that judges whether the task's required actions were completed; a verification that finds gaps
leads — through the verification's `docs/T-NNN/gaps.md` — to a fix child session and a re-verification. The verification judges the work's completeness by inspection only: the
task session has already run the acceptance's executable checks (its tests, the typecheck or build) and
repaired what they found, so the verification re-runs none of them — a defect only a re-run would catch is
left for the person to judge once all tasks are done. A verification that passes performs the close-out itself —
the driver's completion commits exactly as it makes them after a whole-task session: the work commit, the
wrap-up report's own commit, then the completion commit over the state writes (the deletions of the stale gap
list and the consumed handover, `todo.md` → `done.md`, the index tick) — and its `PASS` verdict
tells you the task is safe to advance past. When a phase's tasks are all done the suite transfers between
phases: a handover child session (`run-handover.md`) distills the phase handover document and performs the
phase close-out — the driver's completion writes and commits — and a planning child session (`run-plan.md`)
writes the next phase's task index and task documents, which the master control commits. The phase boundary
is a stop by default — one phase per hand-over: the person reviews the closed phase (its handover document,
its task reports) before the next one is planned, and hands this file over again to continue; the phrase
`phases: all` in the hand-over line lifts the stop, and only then does the task loop continue on the new
phase, until the round's phases are done. All implementation
work happens in child sessions launched through the host coding agent's subagent facility; the master-control
session itself writes no implementation code and no state writes — its one driver write is the share commit
that lands each task/fix session's work when the session ends (the driver's own unified commit after a
session; its fix rounds and subtasks land the same way), and the close-out commits belong to the verification
child. The goal is that the state files and git history afterwards look as if the driver had run the round:
the same grammar, one commit per session share where an undivided driver run would make one.

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
   five companion files are available to you verbatim. Otherwise stop: the whole design rests on them.
6. Read the config's `wrapup` key (default true): it decides whether a passing verification also writes the
   task's wrap-up report (`docs/T-NNN/report.md`).
7. The config's `testByDriver` and `handoverTest` keys are both unset: this suite has no driver process to run
   the test script or relay its result. Either key set → stop: the person runs the driver itself
   (`opencode-auto run`) for these tasks, or `amend`s the config.
8. The config's `acceptanceGate` key is unset (or empty): this suite drafts no acceptance.md and runs no
   acceptance review. Set → stop: the person runs the driver itself for those phases, or `amend`s the config.

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
- Launch children background-first whenever the host has a background facility: a background child cannot
  be quiet-killed, and nobody watches a child's live transcript in any run of this suite — the person's
  interface is the hand-over line, the reports and the finish. Foreground (synchronous) launch is the
  shape of a host with no background facility alone (an idle-task session, sprint mode's native host,
  forces every child foreground). The trade of foreground: a child that goes quiet for ~10 minutes is
  killed by the harness, and these tasks run builds and gate suites far longer — which is why the
  survival discipline (long commands backgrounded, logs polled in short steps) sits in the task/fix
  companions. When a child is killed by the harness anyway or lost to an infrastructure error (inactivity
  timeout, quota ticket, cancellation), relaunch the same role through the channel it launched on — the
  background facility where the host has one (no inactivity kill, but no host visibility either),
  foreground where it does not — with one line of feedback to continue on the dirty tree it left, plus on
  the forced-foreground host the quiet-child nudge ("poll your log in short steps — never sit waiting on a
  long command"): the companions' polling discipline is the child's only shield there, and a sprint wall
  bounds one that keeps getting killed. That retry is separate from the relaunch budget in the loop
  below. The same stop-and-relaunch applies to a background child that runs past its
  session budget without ending: stop it and relaunch with the continue line — its checkpointed tree
  makes that safe, and its successor picks up from the handover or the tree. A killed session's writes
  stay unlanded — its successor's share commit absorbs them; shares land at clean session ends only.
- Quietness is never a stop condition of yours: a child sitting silent on a long test or build run is doing
  its work, the budget wall above is the only stop you ever make, and the harness's own quiet kill of a
  foreground child is beyond your control — the companions' polling discipline is the prevention. When your
  platform can message a running background child and it has been quiet past ~10 minutes, prefer one nudge
  line ("still there? poll your log in short steps — never sit waiting on a long command") over anything
  harder; a platform without messaging changes nothing — the budget wall remains the backstop.
- The session budget turns the handover on: fill `<session budget>` in `run-task.md` / `run-fix.md` with
  `60 minutes` unless the person directed another figure (a sprint mode's runway fit counts as one). A
  task or fix child that cannot finish inside it
  wraps up — ten minutes before the budget it stops starting new work — and hands over through
  `docs/T-NNN/handoff.md` instead of overrunning; a fresh budget rides every relaunch.
- When the target holds nested git repositories, the baseline is multi-repo: record HEAD of this repository
  and of each nested one, and run every HEAD check and dirty-tree check of the loop against them all.
- After a task or fix child session you land its share yourself (the loop's step 3, the INCOMPLETE branch for
  fix children): afterwards HEAD has advanced by exactly one commit per repository that changed, and the
  porcelain lists only the transient gap list (`docs/T-NNN/gaps.md`) — anything else is
  residue: stop and report. A commit command inside a child session is a hard failure — the share commits are
  yours alone, the close-out's are the verification child's. Never push, stash, reset, rebase or amend.
- Terminator discipline, enforced by the verification child sessions and by you for the report: every Markdown
  document a child session created or rewrote in full must end, once finished, with a line holding only
  `<!-- auto: eof -->` as its last line of body text (only blank lines may follow) — the handover document
  excepted: its last line is the `Status:` line. A missing or non-final terminator = the document is
  unfinished.

## Confirm the boundary, pick the first task

- The current phase's index: config `phases: "m"` is the no-phase mode — `docs/R-01/P01-implement/tasks.md`;
  anything else is the phased mode — the latest round (the highest `docs/R-NN/` holding a `phases.md`), first
  phase whose `phases.md` line is not marked ` (closed: …)` — an established phase; when its directory holds
  no `tasks.md` it is unplanned, and the loop's step 0 plans it before any task runs.
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

0. Confirm the current phase is planned: its directory holds a `tasks.md`. Without one the phase is
   established but unplanned → run the planning child on it (the Phase transfer section's step 5), then
   re-read the index here.
1. Take the first ready task `T-NNN` in index order (rules above). Nothing ready → either every task of the
   phase is done — go to the Phase transfer section — or tasks remain pending but none is ready, an
   unsatisfiable dependency graph: stop and report. Record the baseline:
   the current HEAD of this repository and of every nested repository. The task's first child session starts
   from the clean, committed tree; every later child of the same task works on the tree its predecessor's
   share left committed, with the handover document as the seam between them.
2. Launch the task child session: `run-task.md` with `<task id>` and `<session budget>` filled — the session
   reads `docs/T-NNN/todo.md` itself.
3. When it ends: the session changed something — `git status --porcelain` must list something besides the
   session files (`docs/T-NNN/handoff.md`, `docs/T-NNN/gaps.md`; a handover document alone is not a
   share — it rides one, never forms one): a
   zero-write session is never completion. Zero writes → relaunch the task child session once, appending one
   line of feedback ("your previous session ended without writing anything — carry the task out"); still
   zero writes → stop and report. Otherwise land the share — the driver's unified commit after a session: the
   same add + commit pass the verification's close-out makes, one commit per repository that changed (nested
   repositories first, then this one), with `docs/T-NNN/gaps.md` unstaged back out first in this repository
   (`git restore --staged docs/T-NNN/gaps.md` when it exists — the gap list stays on disk, never in a
   commit); `docs/T-NNN/handoff.md` rides the share commit — the handover state lands with the work it
   describes, so every share commit is a precise revert point to the handoff its successor started from,
   message:

        <task id> exec <task title>

        Auto-Task: <task id>
        Auto-Stage: execute

   When the session left `docs/T-NNN/handoff.md` — it ended by handing over — the subject carries the share
   ordinal: `<task id> exec <task title> [<k>]`, `<k>` one past the count of this task's landed exec shares
   (you count your own landings; a restarted master control derives it from the log the same way). The
   fix-round subject carries it identically (`<task id> fix <round> <task title> [<k>]`, counting the
   round's landed fix shares); a share landed without a handover document carries no ordinal. The title is
   truncated so the subject, ordinal included, stays within 100 characters; the trailers are written
   verbatim, never omitted. Afterwards HEAD has advanced by exactly one commit per changed repository, and
   the porcelain lists only the transient gap list.
4. Hand over or finish: when `docs/T-NNN/handoff.md` exists, tail its last body line — the status line.
   `Status: continue` → relaunch the task child session (step 2; it reads the handover itself — label the
   relaunch as a continuation). `Status: done`, or no handover document, → the task's sessions are finished;
   go to step 5. A handover document that exists but lacks its status line → relaunch the task child session
   once with the feedback "the handover document lacks its `Status: continue|done` last line — a driver
   protocol string, write it verbatim"; still invalid → stop and report. There is no session-number cap:
   while each session makes progress, keep launching continuations, however many sessions the task takes.
   Progress is newly landed work in either of its two places: source changes its share committed in the
   nested repositories (the inner git trees — most tasks' real work lands there), or done items in its
   handoff beyond its predecessor's (kept in mind from the last relaunch). The stop is the stalled session:
   no source change landed in any nested repository, and its handoff names no new done item — the same
   next steps the predecessor left. One stall → relaunch the task child session with the feedback naming it
   ("your previous session handed over without new landed work — continue the task's actual scope"); a
   second consecutive stall → stop and report: the sessions are looping — the person's call.
5. Launch the verification child session: `run-verify.md` with `<task id>`, `<baseline commit>` (the recorded
   HEAD), `<task title>` (from the index line) and the wrap-up line (`WRITE` or `SKIP` per the config's
   `wrapup` key) filled. The prompt's re-verification behavior keys on `docs/T-NNN/gaps.md` existing — you
   write nothing for it. On `PASS` the verification itself performs the close-out (the commits and state
   writes); you only check its outcome.
6. Read the verification's verdict — the last line of its reply: `Verification: PASS` or
   `Verification: INCOMPLETE` (protocol strings, verbatim). A reply without the verdict line → relaunch the
   verification child session once with the feedback "end your reply with the verdict line"; still missing → stop
   and report.
   - `INCOMPLETE` → the gap list is `docs/T-NNN/gaps.md` (the verification wrote it). First confirm no
     close-out happened and the state files are untouched (`todo.md` present, no `done.md`, the index line
     unticked, no wrapup or done commits atop the shares — a verification that committed or wrote them on
     INCOMPLETE is a hard failure, stop and report). If two fix rounds have already run for this task, stop
     and report: the work stays landed as the unit's share commits and reverting it is the person's call.
     Otherwise launch the fix child session (`run-fix.md` with `<task id>` and `<session budget>` filled —
     the session reads the gap list itself), then land its share exactly as step 3 does, with the fix-round
     subject `<task id> fix <round> <task title>` (`<round>` is the fix round, 1 or 2) and the same
     trailers, check its handover exactly as step 4 does (`Status: continue` → relaunch the fix child; no
     handover document or `Status: done` → the round's fix sessions are finished; the same progress rule
     as step 4's governs the round's fix sessions — a progressing handoff continues, a second consecutive
     stall stops and reports), then launch a fresh verification child session (step 5 again). A task gets
     at most two fix rounds.
   - `PASS` → the verification has already closed the task out; check its outcome mechanically: the unit's
     range from the baseline holds only its own commits — the share commits (`T-NNN exec <task title>` /
     `T-NNN fix <n> <task title>`, each optionally ending in its share ordinal `[<k>]`, each with the
     `Auto-Task: T-NNN` trailer), then the close-out's
     `T-NNN wrapup <task title>` (wrap-up line `WRITE` only), then `T-NNN done <task title>`; `git status
     --porcelain` lists nothing (this repository and every nested one); `docs/T-NNN/done.md` exists (no
     `todo.md`), the index line is ticked, and `docs/T-NNN/gaps.md` and `docs/T-NNN/handoff.md` are gone.
     When the wrap-up line was `WRITE`, also check `docs/T-NNN/report.md` mechanically — it exists and is
     non-empty, the terminator is its last body line, and its last `Result:` line is `Result: PASS` (a tail of
     the file; do not read the body). Anything missing → relaunch the verification child session once with the
     specific deficiency as feedback; still failing → stop and report.
7. Next iteration: back to step 1 — the index now shows this task ticked and its `done.md` exists.

## Phase transfer — when a phase completes

State lives on disk as everywhere else: re-read `phases.md` and the phase directory at every step. In the
no-phase mode (`phases: "m"`) the round is this one implicit phase: the same handover and close-out, no
`phases.md` tick (there is no index), `<next target>` is `flow complete`, and the round is done. The
boundary is a stop: this section ends with the phase closed and landed, and the session stops there (the
step 4 report) unless the hand-over line named `phases: all` — the phrase that carries the loop on to the
next phase and every phase after it without the stops.

1. Confirm the phase complete: every line of its `tasks.md` ticked and every task's `done.md` present (the
   unit-files-win rule; a `Closed:` field counts as done).
2. The human gate: a `survey`-type phase holds for the person — its `survey.md` must carry a whole-line
   `Clarified: yes` and no `Fork:` line left unanswered (a held fork without its `Recommend:` clause is the
   same problem). Missing → stop and report: the person's clarification releases the phase (the driver's
   `plan` installs the approved brief — this suite does not replicate that write). Other phase types pass.
3. Launch the handover child session: `run-handover.md` with `<phase id>`, `<phase name>`, `<phase dir>` and
   `<next target>` filled — the next phase's "<id> <name>" from the line after this one in `phases.md`, or
   `flow complete` when this is the round's last. Then check its outcome mechanically: `<phase
   dir>/handover.md` exists and holds the four section headings (`## Key decisions`, `## Constraints and
   pitfalls`, `## Required reading for the next phase`, `## Artifact index` — a grep, not a read);
   `<phase dir>/done.md` exists (no `todo.md`); the phase's `phases.md` line is ticked; HEAD advanced by
   exactly its two commits — `PLAN handover <phase id> <phase name>`, then `PLAN transition <phase id>
   <phase name> → <next target>`; `git status --porcelain` lists nothing (this repository and every nested
   one). Anything missing → relaunch the handover child session once with the specific deficiency as
   feedback; still failing → stop and report.
4. Stop at the phase boundary — the default: Finish, with the report naming the phase handed over (its
   handover and transition commits) and the review it waits for — the phase's handover document, its OPEN
   decisions above all, and its task reports; when this was the round's last phase, say the round is
   complete and its close (the round report, the review) is the person's. The person continues by handing
   this file over again: the restart re-reads `phases.md`, takes the next not-closed phase exactly as
   step 5 does, and the loop's step 0 plans a phase whose directory holds no `tasks.md`. Nothing but the
   phrase below keeps this session going past the boundary.
5. The next phase — only under `phases: all`: re-read `phases.md`. No uncompleted line remains → the round
   is complete: Finish — the round's close (the round report, the person's review) is not this suite's
   business. Otherwise, for the next not-closed phase:
   - Its directory already holds a `tasks.md` → it was planned ahead: back to the loop's step 1 on it.
   - Otherwise launch the planning child session: `run-plan.md` with `<phase id>`, `<phase name>`,
     `<phase dir>` and `<round dir>` filled. Then validate mechanically: its `tasks.md` exists and holds at
     least one `- [ ] T-NNN` line; every listed `T-NNN` has its `docs/T-NNN/todo.md` (title line, `Phase:`
     field, the three sections — the terminator its last body line, a tail check as the report's); no listed
     `T-NNN` reuses a `docs/T-NNN/` directory that existed before this planning. Anything invalid → relaunch
     the planning child session once with the specific deficiency as feedback; still failing → stop and
     report. Then land the plan commit — the same add + commit pass (nested repositories first), message:

        PLAN plan <phase id> <phase name>

        Auto-Task: PLAN
        Auto-Stage: phase-plan

     The trailers are written verbatim, never omitted. Back to the loop's step 1 on the new phase.

## Run modes — window and sprint, chosen by one phrase

The person may name a run mode in the hand-over line — `window`, `sprint`, or `pace` (`pace` may ride
with `sprint`); none named, this section is dormant and the run is
unlimited. The same line may carry one more phrase beside them: `phases: all`, the Phase transfer section's
phrase that lifts the default stop at each phase boundary — an unattended run (a sprint) usually names it,
since nobody is there to review between phases. Where a mode conflicts with this file's rules, the mode
wins — and its park/resume rules below
override the boundary rule that refuses an already-begun task. Whatever you end with, your report names
the mode line — and the `phases: all` phrase when it rode — so the person's restart repeats them.

- `mode: window <HH:MM–HH:MM> [tz]` (times UTC unless a zone is named): a launch window. No new child
  session of any role may be created inside the window — check the clock before every launch. A child
  already running when the window opens runs to its normal end; never stop it for the window. When the
  window blocks your next launch, land the ended child's share as usual, then park: either hold this
  session alive polling the clock every few minutes until the window closes (only sensible when the window
  outlives the platform's own limit on this session — against a 3-hour task kill, holding through a longer
  window is pointless), or end the session and report that the person should restart it after the window.
- `mode: sprint <minutes>`: no launch window — a wall for the whole run: the handoff deadline the person
  chooses, set below the platform's kill of this session so the gap between them is the final share
  landing's room (a 3-hour task limit → `sprint 175`). Record your start time at your first action; the
  wall is start + <minutes>. Every launch fits the runway: fill a task or fix child's `<session budget>`
  with the smaller of the default and the runway itself (wall − now — no second margin subtracted; the
  sprint number's gap below the kill is the margin), and relaunch while at least 10 minutes of runway
  remain — a sliver smaller cannot fit a session's startup and handover, so land and Finish instead.
  Launch a verification, handover or planning child only with at least 15 minutes of runway. When the wall
  arrives — or a child overruns past it into the gap below the kill — land the last child's share, do not
  relaunch a `Status: continue` handover, and Finish with the resume note. Ending properly before the
  platform's kill is the sprint's own completion criterion: never let the platform kill this session
  mid-flight.
- `mode: pace <minutes>`: a pause between child sessions — after a child session ends and its share is
  landed, wait <minutes> minutes before the next launch of any role (this run's first launch goes
  immediately; a relaunch after a killed child waits too). The wait is the person's throttle against a
  rolling usage limit (a 5-hour account cap): sized so any 5-hour window's consumption stays under it —
  you never compute quota, the figure is the knob. Wait in short polled steps (`sleep 300` then `date`,
  repeated): never one long silent sleep — ten minutes of silence is this session's kill line as well.
  `pace` may ride with `sprint` (`mode: sprint 175 pace 20`): the waits count inside the wall, and a wall
  arriving mid-wait ends the run properly instead of holding it.

Park and resume (both modes): a parked run sits at a legal boundary — the last share committed, the tree
clean except the transient gap list, a report of what remains. On the restart, uncommitted content means a child
broke mid-session: identify its role from the task's last share commit (`T-NNN exec …` → the task child,
`T-NNN fix …` → the fix child), read the `Status:` tail of `docs/T-NNN/handoff.md` and the presence of
`gaps.md` for its state, re-derive the task's baseline as the parent of its first `T-NNN` share commit,
and relaunch that same role with one continue line — the kill path. A cleanly parked task resumes the same
way on its committed tree. A parked phase transfer (all tasks done, no handover yet) simply continues at
the Phase transfer section.

## Hands off — driver-adjacent rules

- Never edit `.opencode/auto/config.json`, `AGENTS.md`, or anything under `.auto/`; never modify the
  round/phase documents (`docs/R-NN/round.md`, `phases.md`) and never
  plan new work — planning is a planning session's business. The verification child's close-out is the one
  sanctioned writer of the state writes and the `units.json` record removal — none of it is yours.
- You make no edits and no state writes of your own: everything on disk was written by child sessions; your
  writes are the share commit after each task or fix session (step 3 / the INCOMPLETE branch — the driver's
  unified commit after a session) and the phase-plan commit (the Phase transfer section) — the task
  close-out is the verification child's and the phase close-out the handover child's, not yours.
- One task at a time, one child session at a time; the share commits happen at each task or fix session's
  end, and the close-out commits inside the verification child, after a verification passes.
- One sanctioned exception: protocol edits under `prompts/` that the person directs mid-run are the master
  control's to make; the verification child whose unit is open (or the next one) is briefed with the short
  facts that they are out-of-unit — excluded from its checks, never part of a task's work diff — and its
  close-out lands them as their own commit ahead of the task's exec commit.
- A stop always leaves the person in charge: report what finished, what did not, and what state the tree is in
  (an unfinished task's work stays landed as its share commits — keeping or reverting them is the person's
  decision, not yours).

## Finish

Report: every task executed with its commit subjects, each verification's verdict and fix rounds spent, the
wrap-up verdicts, the phases handed over and planned (their transition and plan commits), and what the
person should review (the reports, the commit list, the `AUTO-RESOLVE`/
`AUTO-DECISION` markers; the verifications inspected the work but did not re-run the acceptance's executable
checks — a final test pass before accepting the phase is the person's call; when the round completed, its
close — the round report, the review — remains the person's too). When you stopped at a phase boundary, say
so and name both continuations — handing this file over again (the next phase is planned from the restart),
or `phases: all` in the hand-over line (the rest of the round without the stops). Then stop.
