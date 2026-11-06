# 0183 — The carryover admits only the driver's own write shapes, the recovery
# point writes atomically, the ladder stops on unreadable baselines, the run
# lock carries a process identity, and the 0149 line teaches both outcomes

Status: **active**. Ruled 2026-11-06 by 0166 step 023 (wave W5-control), enacting
0165-112 (S12-07, S3, CONFIRMED — beginUnit's carryover classifies driver-state paths by
pattern alone, sweeping a person's content edit of a todo.md into a catch-up commit under an
unrelated task's trailer), 0165-113 (S12-08, S3, CONFIRMED — the progress record is written
in place, the one driver recovery file without the .tmp → rename discipline), 0165-114
(S12-09, S3, CONFIRMED — 0145's adoption swallows 0155 D1's unreadable-HEAD line, so a
corrupt-root baseline is "adopted" and the unit runs toward a commit that cannot land),
0165-115 (S12-10, S3, CONFIRMED — the 0149 run-start line promises "the resumed unit's
close commits them" while a strict-resume rollback stashes them) and 0165-090 (S06-06, S3,
CONFIRMED — the run lock's liveness reading assumes one pid space per hostname: the
own-pid shortcut steals a sibling container's live lock, and a reused or foreign-namespace
pid keeps a dead lock live forever).

## Derives

Derives: P4 — the commit right and its boundary: a person's content edit of a driver-state
path is committed under a driver trailer and attributed to an unrelated task (D1's spine);
the recovery point and the handover record are the durability half of the completion
condition, and a truncated record silently discards the recovery (D2). P12 — conservative
under uncertainty: an unreadable baseline resolves toward stop, never toward adoption or a
blind rollback (D3); a pid whose start time differs from the holder's record is a reuse
read conservatively (D4); an unjudgeable shape (a staged-only tick, a lone done.md) is
person dirt (D1). P6 — the recovery point is derived-from-disk state whose every write is
idempotent and atomic (D2); the ladder's verdict re-derives from the repository's actual
reads (D3). P8 — every surfaced line teaches its remedy: the shape refusal names the three
admitted shapes; the stop names the repository and its cause; the namespace refusal names
the hand delete; the 0149 line names the stash (D5). P10 — every floor: identity-less locks
(pre-0183, non-Linux) keep the hostname+pid reading; every mechanism no-ops on absent
surfaces. Tier: operating — no Tier I statement changes.

premises this ruling changes: 0170 D4(a)'s kill-window residual (the runtime-record
distinction — done.md new while .auto/units.json still carries the unit — is now the
carryover's admission test, closing the named family; the residual's narrow half narrows
further: the driver's OWN kill window between rename and updateTask now blocks for the
person instead of healing, the conservative direction, recovery through the 0149 exemption
whose line D5 re-words); 0171 D8's "subtask-file content edits and the carryover sweep
(S12-07, step 023)" — closed; 0145 D1 (its adoption clause narrows to *readable* drift:
foreign commits and a rewound history — the person's acted state — while a failed read
stops; 0145's own text named only the person's commits, so the amendment restores the
ruling's premise rather than changing it); 0053 D1–D3 (the lock's liveness reading gains
the identity beside the pid — D2's accepted millisecond race unchanged); 0021 P3's
"leftover driver postings" (the phrase now means the driver's own write shapes, not every
diff on a driver-state path). Re-readings: 0155 D1 stands and extends (the unreadable-HEAD
posture now reaches the recovery ladder beside the gates); 0174 D5 stands (rollbackUnit's
unreadable refusal is the same direction the ladder now takes before it); 0149 D1 stands
(only its line's promise is made conditional — D5); 0099 D8's single-slot
last-writer-wins stands (D2's per-write ordinal tmp preserves it); 0147/0141/0175's gate
architecture stands (the shape read joins the seam's reads).

## Category scope (0123 D1's discipline)

Family: *the unit commit boundary's leftover classification, the driver recovery records,
the recovery ladder's baseline classification, the run lock's liveness identity, and the
run-start exemption's teaching*. Home-set: `src/git.ts` (personDirtOverStatePaths and its
three shape helpers; beginUnit's admission branch; baselineIntact's typed problems; the
GitOps member), `src/git-ops.ts` (the three GitOps implementers' member), `src/resume.ts`
(saveProgress), `src/handover.ts` (saveHandover), `src/resume-gate.ts` (the stop verdict),
`src/runner.ts` + `src/artifact.ts` (the blocked wiring), `src/lock.ts` (the ns/start
identity, stale()'s rule, the namespace refusal), `src/loop-preflight.ts` (the exemption
line), `src/driver-helper.ts` (row 11), `test/git.test.ts`, `test/resume.test.ts`,
`test/handover.test.ts`, `test/resume-gate.test.ts`, `test/lock.test.ts`,
`test/loop-preflight.test.ts`, `test/driver-helper.test.ts`, `test/artifact.test.ts` (the
re-shaped leftover scene), `test/doc-lanes.test.ts` (the fake's member). Vocabulary: the
LockHolder grows two optional fields (ns, start — additive, old locks stay valid, P13);
RecoveryVerdict grows the stop kind (an in-process TS union with both consumers in the
same change — no persisted literal changes); baselineIntact's return type narrows
({foreign, unreadable}) with its one consumer in the same change.

## D1 — the carryover admits only the driver's own write shapes

The path patterns (DRIVER_STATE) say where the driver writes, not what: a person's (or a
stray session's) content edit of a todo.md, a tasks.md or a phases.md is person dirt on
exactly those paths, and the old path-only trust (`dirty.every(driverStateFile)`) swept it
into a catch-up commit under the running task's `Auto-Stage: carryover` trailer — the
person's pending edit misfiled as driver state over exactly the files that define what
verification judges. The admission test (personDirtOverStatePaths, riding the GitOps seam
beside changedFiles so the doc-lane decorator's base and the test doubles own their copy)
admits three shapes and refuses everything else with a teaching line: a worktree deletion
of the retired CURRENT.md (preflight's own removal); an index file whose unstaged diff is
only `- [ ]`→`- [x]` ticks on otherwise-identical lines (tickIndexLine's exact write — a
hand tick is the same redundant view, 0170 D4(b), harmless; a staged-only tick, a
retitle, a new index file — the round-start setup, the person's review — are not the
driver's leftover); and a todo.md→done.md rename pair with byte-identical content
(HEAD's todo.md blob equals the worktree done.md) for a unit whose runtime entry is gone
(markDone's third step dropped it — 0170 D4(a)'s runtime-record distinction: a done.md
new while .auto/units.json still carries the unit is a session's self-rename, never the
driver's close; an absent or hand-corrupted units.json reads as no entry, the same
degradation readUnits gives every runtime field — the heal must not brick on recoverable
state). A failed pair marks both its dirty paths; a done.md without its dirty todo sibling
is never the driver's shape (the driver's done.md only arrives by rename). The other
driverStateFile consumers stand ruled as attribution-by-construction or visibly-folding:
the doc-lane decorator's guard/exclusions and the lane landing filter the live driver's
own writes (markDone moments before); close and clarify fold state-path dirt into commits
that name every folded path in their bodies (the person's own deliberate command, the
audit trail explicit) — named here so the path-trust question cannot be re-raised for
them without new evidence.

## D2 — the recovery point and the handover record write atomically

saveProgress writes `.auto/progress.json.<pid>.<seq>.tmp` then renames; saveHandover the
same for `.auto/handover.json` — the discipline units.json, the stats snapshot, the
resolve ledger and the quota windows already keep, which the recovery point (rewritten at
every dispatch and pipeline boundary: the phase re-entry, the 0146 fix-round state and
the 0149 exemption all ride it) and the in-flight handover record lacked: a crash
mid-write left an empty or truncated file that parses as no record. The per-write ordinal
(<seq>) is the one widening over the sibling writers: the record is single-slot and
written wholesale by every pipeline (0099 D8's accepted last-writer-wins — a sibling's
record is never this unit's recovery point), and concurrent writers sharing one tmp name
would race the loser's rename away (the ordinal keeps every write a successful
last-writer-wins; the caught-by-the-suite shape was a wedged doc-lane drain).

## D3 — the ladder stops on unreadable baselines; adoption is readable drift only

baselineIntact returns typed problems: `foreign` (the person's commits since the
interruption — and a rewound history, a fact read off a readable repository, 0145 D1's
"the person acted" stance kept) and `unreadable` (a HEAD that no longer reads, an
unresolvable baseline, a log that cannot judge the range — 0155 D1's family). The
recovery ladder adopts only foreign drift (today's fresh-verdict semantics unchanged) and
returns a new stop verdict on unreadable roots; both callers (the task pipeline, the
phase-step bypass) block the unit for the person naming the repository — the unit is
neither continued nor rolled back over a tree that will not read (the rollback refuses
unreadable roots too, 0174 D5 — the two doors now agree). The composed 0155 residual (the
ladder adopting an unreadable root, the loop re-anchoring unitBaseline over it, the
close-out reading the both-empty floor) closes: the stop precedes the re-anchor. On the
unit-start paths an unreadable root never reaches unitBaseline behind 0155 D1's status
gate; the non-strict resumed path's both-empty floor stays bounded by the unified
commit's own failure (fail loud, P4).

## D4 — the run lock carries a process identity

The holder records two optional best-effort fields beside the pid: the pid namespace
(readlink /proc/self/ns/pid — "pid:[N]") and the process start time (field 22 of
/proc/<pid>/stat, jiffies since boot, unique per boot; a coincidentally equal figure
across reboots resolves toward live, P12). stale() reads: a lock from another namespace
counts as live like another host (its pid cannot be probed from here — the shape
host-network containers produce; the own-pid shortcut never crosses namespaces), and its
refusal line names the namespace and the hand delete; inside this namespace the pid is
gone (ESRCH) or its start time differs (a reused pid — including EPERM's case: a pid we
cannot signal but that started later than the holder recorded is not the holder); the
own-pid shortcut keeps its meaning inside the namespace, the start figure separating a
dead predecessor from this process's own leftover. A kernel or filesystem without /proc
(non-Linux) records neither field and every reading floors to the hostname+pid form —
which every pre-0183 lock keeps too (P10). The lane orphan probe's bare pidAlive (0165-081)
is the same identity question on another surface — S05-04's row, not this ruling's.

## D5 — the 0149 line teaches both outcomes

The run-start exemption line and driver-helper row 11 promise conditionally: the resumed
unit's close commits the changes, or a strict-resume rollback stashes them and names the
stash (git stash list shows where) — the second line of a run log no longer contradicts
the first (the stash pointer teaching the true recovery while the run-start line promised
a commit). The exemption itself is unchanged (0149 D1 stands).

## Residuals

- The driver's own kill window between markDone's rename and updateTask (runtime entry
  still present, done.md new) now blocks for the person instead of healing — the
  conservative direction; the interrupted run recovers through the 0149 exemption (an
  active record), not the carryover.
- A hand tick of an index line is indistinguishable from the driver's tick and rides the
  heal (the tick is a redundant view, 0047 U3 / 0170 D4(b) — harmless by construction).
- The cross-task rename and index-tick shapes (a session writing another unit's state
  file) remain the commit-provenance guard's family (0169 D4's named follow-up class) —
  the shape check narrows the sweep, not the authorship question.
- auto-server's host-side liveRunLock reads the same holder fields but interprets them
  through this module — no change of its own (the README's v1 note stays S29/S30's
  family).
- The start-time figure is comparable within one boot only; cross-boot collisions resolve
  toward live (P12), and no boot_id is recorded (the collision window is the figure's own
  uniqueness — measured demand absent).

## Tests

- git.test.ts: the carryover's admission — a content edit of another task's todo.md
  blocks with the teaching line and no commit (fail-before: healed); a rename whose unit
  still sits in the runtime record blocks (fail-before: healed); a rename pair with
  changed content blocks (fail-before: healed); an index edit beyond the tick blocks
  while the tick alone still heals (fail-before: the retitle healed); a runtime record
  that no longer names the unit admits the pair (the conservation half, green both ways);
  the existing leftover scene (no runtime entry) still heals. baselineIntact's three
  suites re-pinned to the typed result (fail-before: the string[] shape).
- resume.test.ts / handover.test.ts: the read-only-record pin — the atomic writer
  replaces by rename, no .tmp left behind (fail-before: the in-place write throws EACCES).
- resume-gate.test.ts: the stop verdict over a HEAD pointed at a missing ref (fail-before:
  fresh/adoption).
- lock.test.ts: the identity recorded on acquire; the foreign-namespace lock live even
  naming this pid with the namespace refusal line (fail-before: stolen); the reused-pid
  start-time read (fail-before: refused forever); the own-namespace own-pid and status-line
  pins.
- loop-preflight.test.ts / driver-helper.test.ts: the two lines' oracles updated to the
  conditional wording (fail-before: the old promise).
- agent-fake.test.ts: the doc-lane park flow caught the shared-tmp rename race (the D2
  ordinal's regression, order-dependent — 10/10 green after the fix).
