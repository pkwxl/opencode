# 0149 — the run-start clean gate exempts an interrupted unit's resumable progress: run → /exit → re-run needs no manual git work

The maintainer's ruling (2026-10-28, over the `dm-glm-t083-250` fork of the aster-mig project,
continuing the T-083 stop diagnosis): *The interface for user must be simple, opencode-auto should
work with it properly.* The field report behind it: the fix session hit the provider's 5-hour quota
mid-batch, the person `/exit`ed inside the recovery wait (16:15), and the next morning's re-run
(10:18) stopped at the start clean gate over the five uncommitted files of the interrupted batch in
the nested `aster-dm-all` — *"the worktree has uncommitted changes; … handle them manually (commit
or clean) and re-run"*.

## The measurement (the wait-boundary exit's own shape, the gate's archaeology, the interface)

- **The /exit did exactly what its design says** (plans/0057 §6 item 9, src/exit.ts): the wait is a
  safe boundary because no session is active; `pauseForExit` (src/session.ts) persists the progress
  record `active: true` naming the interrupted session, logs *"the re-run resumes the interrupted
  session (N tokens)"* — and commits nothing, deliberately: the batch is the input the resumed
  session continues on (retry continuity — 0148's "retry/coldstart re-dispatches stay uncommitted"),
  and a quota-dead session reached neither boundary where a batch commits (a handover-continue or
  the round's natural end; P4). The exit is graceful about *process state*, not *git state*.
- **The gate never implemented its half of the standing exemption.** The unit-start gates grant
  exactly this case (src/loop-task.ts: an active record is "a resumed continuation (the worktree
  carries this unit's own progress … exempt from clean)"), and 0022's own recovery ruling absorbs
  uncommitted dirt coexisting with an active record at the close's unified commit. AGENTS.md's
  invariant already reads "other dirty areas block for human, **resumed runs exempt**" — but the
  run-start clean gate (0021 P3, hardened when the old "absorbed by the next commit" notice was
  replaced by the block) runs *before any resume decision* and exempts nothing, so the re-run can
  never reach the machinery that would have accepted the tree. exit.ts's own comment calls the
  scene "fully isomorphic to a real crash/kill interruption at the same spot" — true, and that is
  the seam: both shapes land on the same refused state; the "next run resumes precisely" promise
  holds only when the dead session's tree happened to be clean.
- **The interface measurement**: the taught remedy sends the person into a nested repository to
  hand-commit the driver's own in-flight batch — work the driver itself resumes. Under strict
  resume the hand-commit would then even surface as foreign commits (the 0145 shape, the person
  manufacturing the very drift the ladder must adopt). A person whose entire interaction is
  `run`, `/exit`, `run` is doing git surgery between two of their own commands.

## D1 — the ruling: the gate consults the record

The run-start clean gate (src/loop-preflight.ts) reads the progress record on a dirty verdict:
an **active** record — a unit the last process left mid-flight (a kill, a crash, an `/exit`
inside the recovery wait) — makes the uncommitted changes that unit's resumable progress. The
predicate is `peekProgress(dir)?.active === true`, task-agnostic on purpose (the run as a whole is
resuming a unit; the record's own task is named in the line). One teaching line replaces the block
(the detection record, P8): the changes are exempt and the resumed unit's close commits them. The
**housekeeping close-out commit skips with it**: its unqualified sweep would fold the interrupted
unit's batch into a `PLAN` commit; the driver's own run-start writes (the `.gitignore` repair)
ride the resumed unit's close instead.

Non-active shapes are unchanged: the round-start gate keeps its review teaching, the person-dirt
block keeps "handle them manually (commit or clean)" — correct for the graceful-exit rerun, the
person's bracketed pause (0145 D3's floor). The exemption cannot coexist with the round-start
case: an active record implies a dispatch happened, which implies that run's own start gate
already passed the round setup's commit.

Hygiene carried in the same change: the gate's exit-2 return now closes the subtask tracker and
watcher preflight created above it (a leak on a path no test had reached).

## D2 — driver-helper's row 11 teaches the resume

The person-proxy brief's dirty-tree row (src/driver-helper.ts) branches on the same predicate:
under an active record the three lines say *run resumes it, its close commits the changes* —
never the hand-commit teaching, which for this shape sends the pen after the driver's own job.

## D3 — the floors

- **The unit-start gates are unchanged** (they already exempt an active record; the run-start gate
  now matches them).
- **beginUnit's driver-state carryover still runs ahead of the verdict** — a dirt that is entirely
  driver-exclusive state self-heals with the catch-up commit even on a record-active tree; only a
  mixed or non-driver dirt reaches the exemption.
- **The recovery ladder is untouched** — reuse/fresh/adoption decisions (0145) key on the record
  and commits, not on the tree's uncommitted bytes; the exemption only moves those bytes past the
  gate.
- **dryrun and lane workers unchanged**: dryrun never runs the gate; a lane worker's preflight
  reads its own worktree's record through the same uniform predicate.

## D4 — the named residuals

- A stale active record whose unit is not the next one scheduled: the dirt rides to that unit's
  own start gate and blocks there with the per-unit teaching — conservative (P12), and the
  interrupted unit is normally the next ready one (it was `in_progress`).
- Person edits mixed into the interrupted unit's tree are indistinguishable from the session's
  and ride the close together — 0022's own absorb ruling, the same blindness the unit-start
  exemption has always had.
- The exemption trusts the record's `active` flag as the last process wrote it; a corrupt record
  fails closed through the non-active branch (the block).

Derives: **P2** (the person brackets every boundary — the showing: the re-run *is* the person's
"continue this unit"; the manual-commit teaching made the person perform the driver's work between
two of their own commands), **P8** (deliberate enforcement moments — the showing: the block's
taught remedy was the anti-pattern for the graceful-/exit shape, and the exemption line is the
detection record that teaches where the changes go instead), **P20** (in-flight work is never
destroyed — the showing: the interrupted unit's batch stays exactly as the resumed session expects
it, neither cleaned nor repacked at run start), **P19** (measured evidence — the showing: the
t083-250 field report's own pair, the 16:15 exit line promising resume beside the 10:18 stop over
the same bytes). Amends: **0021 P3's run-start clean gate** (the person-dirt half stands; the
active-record half is now ruled as the resume exemption — 0022's absorb-at-close composed with the
gate instead of fenced off by it) and **0145 D4's named residual** (the uncommitted-dirt-under-
active-record case moves from out-of-scope to ruled). Tier touched: **mechanism** — core
(`src/loop-preflight.ts`, `src/driver-helper.ts`) and the shell README's interruption-recovery
paragraph.

Tests: `test/loop-preflight.test.ts` — the exemption describe (the exempt pass: one teaching line,
the batch still uncommitted, no PLAN commit; the summarized-record rerun still blocking with the
person's teaching; the no-record block standing; the silent pass over a clean tree); 
`test/driver-helper.test.ts` — the row-11 companion (the active record's lines teach the resume,
the hand-commit teaching absent).
