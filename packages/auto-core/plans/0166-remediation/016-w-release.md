# Step 016 — w-release

Wave: W-release. Findings: 0165-034 (S19-02, S2, CONFIRMED — release certifies a destination
whose git it cannot read: the clean-tree check takes the legacy-typed statusEntries (unreadable
→ []), unitAddedLines skips a failed diff, and a corrupt index yields two ⚠ lines then a ✓ with
exit 0). Started 2026-11-06 at HEAD `099dd4482`.

## Scope

The release gate's read posture: releaseCheck's clean-tree check on the strict read (an
undefined read a blocking problem), and the scan's input (unitAddedLines' failed-diff skip)
surfaced as a blocking problem at the release posture. The round-time callers of the same reads
(the loop-side clean gates, the round-close ledger — 0155's other legacy-typed callers) decide
record vs block in their owning plans, not here.

## Design ruling

Ruling **0176** ([0176-release-strict-reads.md](../0176-release-strict-reads.md)): D1 the
clean-tree check asks `statusEntriesRead` — undefined a blocking problem ("… unreadable …;
repair the repository, then re-run release"), and the scan block refuses on its input's
unreadable state; D2 `unitAddedLines` answers `{ lines, unreadable }` and `unitChangedFiles`
`{ files, unreadable }` — the data the same partial set as before (byte-identical for the
round-time callers), the flag naming that at least one repository's read failed, consulted
where a verdict rides. Derives P12 with P1/P10; premises unchanged — 0155 D1's named deferral
("release's clean check stays quiet-clean") closes; 0103's gate and 0119 D2's ledger stand.

## Implementation order (the recovery map)

1. `src/git.ts`: the two scan functions' read state.
2. `src/release.ts`: the strict clean check + the scan's unreadable block.
3. The round-time callers' mechanical access (execute, round-close, work-order); the tests'
   access updates; the S19-02 repro in release.test.ts.
4. Fail-before proof; full suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 015's commit (099dd4482) in the same worker stretch. The
  callers enumerated (execute ×3, round-close, work-order ×2 — all round-time, none blocking at
  release), the flag-carrying shape chosen over return-undefined to keep the callers' partial
  data byte-identical (P10).
- Implementation landed per the map; the flag's default pinned (false over readable
  repositories) in subtask-shape's oracle beside the existing shape pins.

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2980 pass, 0 fail** (152 files; 2979 at step 015's close).
- Fail-before: `git stash push -- src/release.ts src/git.ts src/execute.ts src/round-close.ts
  src/work-order.ts` → the S19-02 repro red on the pre-change code (the ✓ certified over the
  corrupt index); `git stash pop` restored everything.
- packages/auto suite: 157 pass, 5 fail — the same pre-existing fork/remove-fork baseline
  (proven pre-existing at step 014; step 031's wave).

## Close-out

Step done 2026-11-06. Ruling 0176 active-authority; the INDEX row, the AGENTS.md release
navigation line, ledger row 0165-034 and the program's status/current-position land in the same
commit. Residual: none named for the gate — the round-time callers' record-vs-block decisions
remain their owning plans' (the loop-side clean gates' family, 0155's standing residual list).