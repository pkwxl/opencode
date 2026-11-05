# Step 010 — w1-verdict-provenance

Wave W1-person-marks · finding 0165-006 (S32-01 ∪15, part 1) · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD d2ebaf20c · verified and committed same day.

## Scope (as enacted)

Verdict-document provenance, part 1 of the ∪15 union (step 011 enacts part 2). Three confirmed
surfaces, one trust-boundary ruling — the driver's verdict surfaces are trusted by location, not
provenance. The wave's ruling is **[plans/0170-verdict-provenance.md](../0170-verdict-provenance.md)**
(Derives: P3 with P2, P4 and P7; tier: operating; `premises this ruling changes: 0083, 0120` —
0082 D6 re-read and standing as written).

1. **S11-01** — a work/fix session's own `docs/T-NNN/report.md` `Result: PASS` outranked the verify
   session's FAIL.
2. **S12-01** — a session's own `docs/T-NNN/todo.md → done.md` rename rode the unified commit past a
   FAIL verdict; every later load read the task done.
3. **S12-02** — `choiceMark` read `Choice:` anywhere in the blockage document: the diagnosis
   session's verbatim Analysis line parsed as the person's and the executor consumed it.

## Changes

1. `plans/0170-verdict-provenance.md` (created) — the ruling (D1–D4 as below).
2. `src/wrapup.ts` — `verifySession` removes report.md and gaps.md before the round's first
   dispatch (never the shape re-prompt's fork): the verdict keys on this session's writes exactly;
   the removal lands in the round's wrap-up commit. The read-order comment rewritten (the
   "a passing report wins over a stale gap list" premise dead by construction).
3. `templates/prompts/whole.md` (constraint 3 names the two reserved files), `fix.md` (constraint 3
   extends to report.md), `_partials.md` (doc-layout names the report's owner: the verification
   session's alone), `diagnose.md` (the four mark heads prohibited to the session, 0169's
   discipline).
4. `src/document/unit.ts` (`restoreUnitPending` — renameUnitDone's mirror), `src/document/state.ts`
   (`restoreTodoFromDone`), `src/git-ops.ts` (`restoreUnitCloses` at the free `afterSession` and the
   doc-lane decorator's, before their commits: the commit's own task's task-level close restored at
   every stage, subtask closes except the stage's own `subtask N` index, one detection line per
   restore), `src/execute.ts` (`runSubtask` restores the own index between the session's end and the
   driver's rename — the entry short-circuit guarantees done.md absent at dispatch).
5. `src/blockage.ts` (`decisionRegion`: the last `## Decision` to `## Execution protocol`;
   `choiceMark`/`executedMark`/`rejectedMark` scoped to it), `src/blockage-diagnose.ts` (the four
   mark heads neutralized — indented — in the Analysis and Escalation verbatim sections, an
   option's edit text never touched), `src/blockage-execute.ts` (`appendMarkLine` anchored to the
   region's last `Choice:` line).
6. Tests: `test/verify-loop.test.ts` +1 (the committed work-written PASS report + verifier FAIL →
   the fix loop opens, the report gone); `test/git.test.ts` +3 (the restore, the stage-exemption
   pair, the other-task untouched); `test/blockage.test.ts` (the Decision-region suite +3, the
   bare-text oracles re-pointed to the region shape), `test/blockage-executor.test.ts` (+1 the
   region-anchored record), `test/blockage-diagnosis.test.ts` (+1 the neutralization round-trip),
   `test/document-state.test.ts` (+2 the restore primitive); `test/driver-helper.test.ts` (the
   hand-answered fixture gains the Decision section).
7. Oracle re-points the copy change forced: 32 `test/golden/*.golden.md` regenerated (exactly the
   three conscious template lines); the doc-lanes discriminators in `test/agent-fake.test.ts` (6
   sites) and the report-writing turn branches in `test/interactive-seam.test.ts` /
   `test/run-status.test.ts` re-keyed to the wrap-up prompt's stable marker ("only performs the
   wrap-up") — 0170's whole.md sentence legitimately names "the verification session" and the
   report path in the work prompt.
8. `plans/INDEX.md` (the 0170 row); `AGENTS.md` (three navigation lines gain 0170).

## Verification

- `bun typecheck` exit 0; full suite **2935 pass, 0 fail** across 152 files (was 2924 + the new
  regressions and re-pointed oracles); the prompt suites green.
- Fail-before proven: `git stash push -- src/` then the three regressions against the pre-fix code
  — 1 + 1 + 3 failures exactly (the report-wins path, the unrestored rename, the three mark
  surfaces), restored after.
- Fixed in passage: the task-level exemption bug (undefined === undefined skipping every task-level
  restore — caught by its own regression before landing); appendMarkLine's first-vs-last Choice
  anchor (the placeholder precedes the person's answer).
- family-check: 0170 outside the tool's 0124–0169 range (the tool ages with the corpus; extending
  it is not this step's). The two standing anomalies (0126 test/golden.test.ts, 0138 opencode.json)
  pre-date this step — verified present with this step's changes stashed.

## Dispositions

- **0165-006** — part 1 fixed (step 010, ruling 0170): S11-01 (the dispatch-side removal + the
  taught reservation), S12-01 (the boundary restore with the two exemptions by construction),
  S12-02 (the Decision-region parsers, the neutralized verbatim heads, the region-anchored record).
  Part 2 (S11-04, S20-05, S08-04/06/08, S10-01/02/07) remains step 011's under 0170's frame.

Residuals (0170 D4, named): the kill-window rename (a session's rename committed by the next unit's
carryover self-heal after a kill before the boundary — 0165-112's family, step 023); the cross-task
rename and the index-tick shapes (the ticks are a redundant view — the files win, 0047 U3; the
cross-task rename is the commit-provenance guard's family, 0169 D4's named follow-up class); the
remaining ∪15 members' location-trust is step 011's to disposition.
