# 0087 — Manual-suite share commits: one commit per task/fix session, the verification judging the unit's commit range

The working rulings, kept verbatim as the design record. Status: landed 2026-10-10.

## The problem

0086 gave the manual suite session handovers but kept the whole unit's work uncommitted
until the verification's close-out: a task of N sessions accumulated everything dirty for
up to N hours (one budget each), the session boundaries were invisible in git history,
and the verification inspected a dirty tree — where the driver's own verification session
(0083) judges "the unit's commit range". The person's ruling (session of 2026-10-10):
commit at each handover and at the end of run-task or run-fix — the boundary a session's
end makes should be a commit.

## The rulings

- **D1 — the share commit is the master control's write.** When a task or fix child
  session ends (any ending: a handover, the scope done, a fix round finished), the master
  control lands that session's writes as one commit — the driver's own unified commit
  after a session ("after a session ends the driver commits"), which its fix rounds and
  subtasks already follow. Worker children still never commit (the constitutional rule);
  the master control's role set grows from "no writes at all" to "the share commits and
  nothing else".

- **D2 — the grammar is the driver's own.** A task session's share: subject
  `<task id> exec <task title>`, trailers `Auto-Task: <task id>` / `Auto-Stage: execute`,
  subject truncated past 100 characters. A fix session's share: `<task id> fix <round>
  <task title>` (round 1 or 2), the same trailers — the driver's fix-round commit form
  (0083). Repeated identical subjects across a task's shares are grammatical; the
  trailer is what ties the range together. The mechanics mirror the close-out's pass:
  `git add -A`, one commit per repository that changed, nested repositories first.

- **D3 — the transients never land.** `docs/T-NNN/handoff.md` and `docs/T-NNN/gaps.md`
  are unstaged back out of the share commit (`git restore --staged`, whichever exist) and
  stay on disk, untracked — the successor session still reads the handover, the fix
  session the gap list. After a share commit the porcelain may list only the transients;
  anything else is residue (stop and report). The zero-write rule tightens with it: a
  handover document alone is not a share (it is unstaged), so a session whose only write
  is the handover counts as zero-write.

- **D4 — the verification judges the range, not the dirty tree.** run-verify's hard
  check 1 becomes a range validation: every commit in `<baseline commit>..HEAD` (each
  repository) carries the task's `Auto-Task` trailer and the share grammar — anything
  else was committed inside a child session, a hard failure (the core's own close-out
  validates the same way, by trailer over the SHA baseline). Inspection reads the range's
  diff. The close-out slims to wrapup → done (the report commit, then the state-writes
  commit); the exec grammar moves to run.md's share-commit rule, and the ratchet case is
  re-ruled to pin the split.

- **D5 — killed sessions land nothing.** A session killed by the harness or stopped past
  its budget did not end cleanly: its writes stay unlanded and its successor's share
  commit absorbs them. Shares land at clean session ends only — a partial, mid-edit state
  is never committed.

- **D6 — the stop posture changes.** An unfinished task's work no longer "stays
  uncommitted for the person to commit": it stays landed as the unit's share commits, and
  keeping or reverting them is the person's call. This follows the driver's own fix-loop
  behavior (fix-round work is committed before re-verification; a blocked task's landed
  work is the person's to accept or revert), at the cost of the single-exec-commit history
  shape an undivided `--subtask off` run would produce. run.md's charter sentence is
  reworded accordingly: same grammar, one commit per session share.

- **D7 — quietness is never a stop condition.** The master control never stops a child for inactivity: a
  child silent on a long test or build run is doing its work, the budget wall (0086 D2/D4) is the only stop
  it makes, and the harness's own ~10-minute quiet kill of a foreground child is beyond a prompt's control
  — the companions' polling discipline is the prevention, now stated as a keep-alive cadence (poll every
  few minutes; ten minutes of silence is the kill line). Where the platform can message a running
  background child, one nudge line on observed quiet replaces anything harder; without messaging, the
  budget wall remains the backstop. Ruled when the person asked whether an inactive child should be
  terminated — the master control never had an inactivity stop; the ruling makes that explicit so no
  session improvises one.

## What is deliberately not done

- No amend/squash of the shares at close-out: history stays append-only, the suite's
  "never push, stash, reset, rebase or amend" rule untouched.
- The subtask pipeline (`run-as-subtasks.md` / `resume-subtasks.md`) keeps its own
  commit choreography (already per-subtask).
- The share commits carry no handover metadata beyond the grammar: which share continued
  which is the handoff document's content (transient), not history's.
