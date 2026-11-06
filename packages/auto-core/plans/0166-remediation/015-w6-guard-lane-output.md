# Step 015 — w6-guard-lane-output

Wave: W6-git. Findings: 0165-020 (S11-03, S2, CONFIRMED — the timed-out lane command orphaned
beyond SIGTERM/SIGKILL), 0165-021 (S11-08, S2, CONFIRMED — the script guard misses a revert of
the session's uncommitted work to HEAD), 0165-108 (S11-05, S3, CONFIRMED — driver script output
read whole into memory), 0165-139 (S19-06, S3, CONFIRMED — the doc-lane decorator's beginUnit
hand copy missing 0141 D1 and 0155 D1). Started 2026-11-06 at HEAD `e649c169b`.

## Scope

The driver-run script family's control and memory: the kill semantics (every wrapper its own
process group — runScript's standing grandchild residual and both lane copies), the guard's
revert class (the snapshot diffed against the worktree directly, the snapshot sha surfaced), the
unbounded output reads (the dead `out` field dropped, one bounded tail reader), and the doc-lane
decorator's beginUnit expressed as a parameter of the free gate (one home for the strict read,
the workdir filter and the carryover excludes).

## Design ruling

Ruling **0175** ([0175-script-family-control.md](../0175-script-family-control.md)): D1 every
wrapper its own process group, the kills group-directed (killGroup with the non-detached
fallback; runScript, runLaneBatch and the regression slot spawn detached; watchProcess's and the
batch timer's TERM + SIGKILL go to the group); D2 the guard's comparison is the pre-run snapshot
against the worktree directly over the whole repository (`git diff --name-only -z --no-renames
--ignore-submodules=all <stash|HEAD>` under the toplevel — both directions caught; the
status-then-diff enumeration dropped; the tracked violation carries `snapshots`, the pre-run
stash shas; the unborn repository floors to clean); D3 the dead `out` field dropped, one
`readLogTail` (the last ≤64 KiB, leading partial line dropped) shared by laneOutcome and the
regression slot; D4 the decorator's beginUnit is the free gate with `{ tolerate, reads, commit }`
(the sibling scopes, the wrapped base's read members, the queued commit core), the ratchet
pinning the empty-registry identity. Derives P20 with P12/P5; premises changed: 0025 H1's
direct-child limitation (retired on the timeout path), 0099 D5's byte-identity claim (made
literal); re-read standing: 0083 D11, 0156 D7, 0096 D5/0098 D4.

## Implementation order (the recovery map)

1. `src/script.ts`: killGroup + detached spawns + group kills; readLogTail; drop `out`;
   laneOutcome's tail; logGuardViolation's snapshots clause.
2. `src/git.ts`: scriptGuardCheck's direct snapshot diff + `snapshots`; beginUnit's
   BeginUnitRelaxation parameter.
3. `src/regression.ts`: the slot's detached spawn + the tail read.
4. `src/git-ops.ts`: the decorator's beginUnit delegation.
5. Tests; fail-before proof; full suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 014's commit (e649c169b) in the same worker stretch; the
  four findings' evidence in context from step 014's reads (S11-verification.md, S19-git.md).
  Bun's detached spawn and group signal probed empirically before implementation (pgid == pid;
  group SIGKILL kills the child, signalCode SIGKILL, exitCode null — runScript's existing 124
  convention already reads that shape).
- Implementation landed per the map: script.ts (killGroup, three detached spawns, group TERM/
  SIGKILL in both timers, readLogTail + LOG_TAIL_BYTES, laneOutcome's tail, the dropped `out`,
  logGuardViolation's snapshots), git.ts (the direct snapshot diff with the unreadable
  surfacing, the tracked kind's `snapshots`, BeginUnitRelaxation in beginUnit), regression.ts
  (detached + tail), git-ops.ts (the delegation).
- Tests: the revert-class pair and the unborn floor in git.test.ts's guard describe; the
  grandchild kill test in script.test.ts; the lane survivor test in lane-table.test.ts; the
  ratchet (twin repos, shapes normalized modulo the repository-specific shas) and the
  strict-read-under-decorator test in doc-lanes.test.ts. The five `out`-field assertions in
  script.test.ts moved to file reads; the four tracked-violation expectations gained
  `snapshots`.
- **The turn-trace oracle caught a floor violation in D2's first cut**: over an unborn
  (commit-less) repository `git diff HEAD` fails, and the unreadable surfacing fired a false
  side-effect violation into the frozen traces' steer text. The unborn floor added (both HEAD
  reads empty → the shot skips — the baselines' own empty-repository convention) and pinned by
  its own test; the oracle green again.

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2979 pass, 0 fail** (152 files; 2972 at step 014's close).
- Fail-before: `git stash push -- src/script.ts src/regression.ts src/git.ts src/git-ops.ts` →
  9 tests red on the pre-change code across the four files (both kill tests — the late writes
  land; both revert-class tests — the guard reads clean, the WIP lost; the strict-read test —
  the old hand copy passes the corrupt index; and the five new-shape pins failing on the
  missing `snapshots` field / the removed `out`); the ratchet itself green on both sides (the
  claim held on its scenes — the drift's proof is the strict-read scene, exactly the finding's
  two-missed-amendments shape). `git stash pop` restored everything.
- packages/auto suite: 157 pass, 5 fail — the same pre-existing fork/remove-fork baseline
  proven pre-existing at step 014 (reproduced identically at HEAD with the change stashed;
  step 031's wave).

## Close-out

Step done 2026-11-06. Ruling 0175 active-authority; the INDEX row, two AGENTS.md navigation
lines, ledger rows 0165-020/021/108/139 and the program's status/current-position land in the
same commit. Residuals to their named families: a normally-exiting script's own backgrounded
children survive (no timeout fires; the next boundary's guard catches their tree writes); the
lane evidence byte-bounded (pathological line lengths yield fewer than 30 lines); a
script-created `git stash` entry stays in the stash list (the tree is restored, the entry the
person's to inspect); the decorator's afterSession/commitPending keep their shapes (their
deltas are the decorator's own design, re-checked clean).