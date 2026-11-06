# 0175 — The driver-run script family: the kill reaches the group, the guard sees reverts, the output is read bounded, and the doc-lane gate has one home

Status: **active**. Ruled 2026-11-06 by 0166 step 015 (wave W6-git), enacting 0165-020 (S11-03,
S2, CONFIRMED — the timed-out lane command orphaned beyond SIGTERM and SIGKILL), 0165-021
(S11-08, S2, CONFIRMED — the script guard misses a revert of the session's uncommitted work to
HEAD), 0165-108 (S11-05, S3, CONFIRMED — driver script output read whole into memory) and
0165-139 (S19-06, S3, CONFIRMED — the doc-lane decorator's beginUnit hand copy missing 0141 D1
and 0155 D1).

## Derives

Derives: P20 — in-flight work is never destroyed — the ruling's spine. The revert class (021) is
the direct case: a test script's `git checkout -- .` preamble erases the session's uncommitted
work, the guard built to restore exactly that WIP reads clean, and the session continues over
reverted files — the WIP surviving only in an unreferenced stash-create object whose sha nothing
logged. The orphaned lane command (020) is the same principle's process half: a survivor keeps
CPU and build locks and writes into the tree AFTER the set-level guard concluded — those writes
then ride the next session's commit as that session's work, a probe polluting the real session.
P12 shows in the guard's failed reads (surfaced since 0174, kept here) and in the whole-file
output read (a verbose test past the engine's string limit crashes the unit on an exception
instead of answering a red verdict); P5 shows in the decorator dedup (139): a mechanism with two
homes has already drifted twice — 0141 D1's workdir filter and 0155 D1's strict read exist only
in the free gate — and is now one home held by a ratchet. P10 in every floor: scripts that honor
TERM, trees without WIP, logs under 64 KiB, and the empty-registry decorator are byte-identical.
Tier: operating — P20/P12 statements applied to the existing script-family surfaces; no Tier I
statement changes.

premises this ruling changes: 0025 H1's recorded limitation ("only the direct child is killed;
the grandchild tree is not guaranteed to be cleaned up" — retired on the timeout path by D1's
group-directed kills; the exec choice itself stands and stays why the direct child dies
cleanly); 0099 D5's byte-identical claim ("byte-identical to the base gate over an empty
registry" — asserted in a comment while the copy had drifted; now literally true by delegation
and pinned by a ratchet). Re-readings: 0083 D11 stands (the revert class was a defect in the
guard's reads, never among its named residuals — byte-identical rewrites and untracked files
stay exactly as ruled); 0156 D7 stands (the grace semantics unchanged, the signals now
group-directed); 0096 D5/0098 D4 stand (the lane wrappers' protocol unchanged — the LANE_RC line,
the verdict read — only the kill semantics and the read bound change).

## Category scope (0123 D1's discipline)

Family: *the driver-run script family* (the serial channel, the lane set, the regression slot —
the processes the driver spawns and awaits) and the doc-lane seam's gate. Home-set:
`src/script.ts` (runScript, watchProcess, runLaneBatch, laneOutcome, readLogTail, logGuardViolation,
ScriptRunResult), `src/regression.ts` (the background slot's spawn and verdict read),
`src/git.ts` (scriptGuardCheck's comparison, ScriptGuardViolation's tracked shape, beginUnit's
relaxation parameter), `src/git-ops.ts` (the decorator's beginUnit delegation),
`test/script.test.ts`, `test/lane-table.test.ts`, `test/git.test.ts`, `test/doc-lanes.test.ts`.
No frozen vocabulary changes: no protocol literal, exit code or document grammar is touched;
ScriptRunResult is module-private (its dead `out` field dropped); ScriptGuardViolation's tracked
kind gains the `snapshots` field (an additive machine fact, the receipts and the logs unchanged).

## D1 — every wrapper its own process group; the kill goes to the group

The lane wrapper's subshell shape (`( eval "$1" ) > "$2" 2>&1; echo LANE_RC=$? >> "$2"`) puts the
command one level below the spawned bash: `proc.kill()` and the SIGKILL escalation reach only the
outer bash, and every idle/max timeout of a lane (or the background regression slot) leaves the
command running unattended — still writing its log, still holding locks, able to write into the
tree after the set-level guard concluded. runScript's exec shape reaches its direct child (0025
H1's fix) but a grandchild that backgrounds itself survives the same way. Every driver-run
script wrapper now spawns as its own process group (`Bun.spawn({ detached: true })` — the child
becomes its group leader) and every kill the watchdogs deliver is group-directed
(`process.kill(-pid, sig)`) — the SIGTERM and the grace's SIGKILL both, in watchProcess and
runLaneBatch's own timer; the helper falls back to the direct signal when the child is not a
group leader (a future caller's non-detached proc), and a group that has already exited is not an
error. Pinned by a lane-timeout test (no survivor process, no late write into the tree) and a
runScript-timeout grandchild test.

## D2 — the guard's comparison is the snapshot against the worktree, directly

The old post-run read enumerated `git status` paths first and diffed those against the snapshot —
a path the script reverted to HEAD is clean under status, never enters the comparison, and the
guard reports nothing while the session's WIP is gone. The comparison is now direct:
`git diff --name-only -z --ignore-submodules=all <snapshot|HEAD>` under the repository's
toplevel, no pathspec — the pre-run `git stash create` snapshot covered the whole repository
(stash create takes no pathspec), so the whole-repo diff is the faithful comparison, and it
catches both directions (a mutation AND a revert) plus a checkout of older committed content.
The status read is gone from the check (it was the blind spot; its failure surfacing moves to the
reads that remain). The tracked violation carries **snapshots** — each shot's pre-run stash sha,
the recovery handle the finding found missing (a restore that fails, or a person reconstructing a
scene, can reach the snapshot object) — printed in the violation line. The byte-identical and
untracked residuals stand exactly as 0083 D11 ruled them.

## D3 — script output is read bounded: the dead whole-file field dropped, one tail reader

`runScript`'s `out` field (the whole output file read into memory) has no consumer — sessions
read the file on disk — and is dropped. Every verdict/evidence read of a lane or regression log
goes through one `readLogTail` (the last ≤ 64 KiB, the leading partial line dropped): a verbose
or looping test's output is never materialized whole, and the red-evidence bound (30 lines)
becomes a byte-bounded tail of the same end region. The verdict read is unaffected (the LANE_RC
line is the log's last); a log under the bound is byte-identical to today's whole read.

## D4 — the doc-lane start gate is the free gate with a relaxation parameter

The decorator's beginUnit was a hand copy of the base gate that missed two later amendments
(0141 D1's untracked-workdir filter, 0155 D1's strict per-root read — and would have missed
0174 D1's refusal block) while its comment claimed byte-identity. The relaxation is now a
parameter of the free gate: `beginUnit(dir, opts, task, { tolerate, reads, commit })` — tolerate
names the sibling scopes filtered out of the dirty set (0099 D5's relaxation), reads names the
seam members the gate reads through (the wrapped base's changedFiles/unitBaseline, so the
decorator over the double or a recording fake keeps the seam's switchability), commit replaces
the free gate's carryover heal with the decorator's serialized, scoped queue. The strict read,
the workdir filter, the refusal block and the carryover heal exist in exactly one home; a ratchet
test runs the decorated gate and the free gate over an empty registry on the same scenes,
pinning the byte-identical claim. The decorator's afterSession and commitPending keep their
shapes (their deltas are the decorator's own design — the queued commit core, the marker
collection, the D7 exclusions; re-checked clean).

## Residuals

- A script that exits NORMALLY leaves its own backgrounded children alive (no timeout fires, no
  kill is delivered) — inherent to "the driver awaits its own pids"; the guard's snapshot
  comparison still catches their later tree writes at the next check (the D2 diff runs after the
  batch/proc settles, and the set-level check runs after every lane exited; a straggler writing
  after that rides the next boundary's guard, the same recovery as today).
- The lane evidence bound is byte-bounded (30 lines of at most 64 KiB total): pathological line
  lengths yield fewer than 30 evidence lines — the bound is the ruling's intent.
- runScript's return shape loses `out` (module-private, dead); any future consumer reads the
  file on disk or through readLogTail.

## Tests

- script.test.ts: the runScript first test's `run.out` assertions move to the file read (the
  field is gone); a timeout-kill test where the script's own backgrounded grandchild would keep
  writing — no late write, no survivor (D1, the runScript half).
- lane-table.test.ts: a lane whose command survives the wrapper (a sleep + late write) and hits
  the idle timeout — the batch resolves, no late write lands, no survivor process remains (D1,
  the lane half).
- git.test.ts, the guard describe: a script-shaped revert (`git checkout -- .`, `git stash -q`)
  over uncommitted session WIP — the violation is tracked, the WIP restored from the snapshot,
  the snapshots field carrying the pre-run stash sha (D2); the moved-HEAD and byte-identical
  cases unchanged.
- A bounded-output case: a log over the tail bound yields a bounded evidence/read (the verdict
  line still read from the tail) (D3).
- doc-lanes.test.ts: the ratchet — the decorated gate and the free gate over an empty registry on
  the same scenes answer identically (clean passes, driver-state dirt self-heals through the
  queued core, other dirt blocks); the strict-read block now holds under the decorator too (a
  corrupt index under doc lanes blocks at the gate, 0155 D1's extension).
- Fail-before: the lane survivor writes late (D1); the revert passes the guard with the WIP lost
  (D2); the whole-file read (D3) and the decorator's copy (D4) are proven by the field's removal
  and the ratchet's scenes on the pre-change code where runnable.
