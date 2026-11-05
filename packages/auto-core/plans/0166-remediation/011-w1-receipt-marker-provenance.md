# Step 011 — w1-receipt-marker-provenance

Wave W1-person-marks · finding 0165-006 (S32-01 ∪15, part 2) · status: **done** 2026-11-06
Started 2026-11-06 · start HEAD 4992d423c · verified and committed same day.

## Scope (as enacted)

Verdict-surface provenance, part 2 of the ∪15 union, under 0170's witness frame (location is
never provenance). Six members, four surfaces, one ruling — **[plans/0171-verdict-surface-provenance.md](../0171-verdict-surface-provenance.md)**
(Derives: P3 with P2, P4 and P7; tier: operating; `premises this ruling changes: 0098, 0130,
0141, 0095, 0148` — each re-read and amended in the ruling).

1. **S11-04** — `resolveTestScript`'s path form confined to the project root (realpath both
   sides; chmod only inside); an escaping single-line request refused (the marker consumed, the
   request snapshotted, the refusal rendered at exit 125 through `runTestScript` — never
   executed; the inline fallback would have bash run the named path). The in-session consumer
   (engine fx) shares the resolver; the protocol partial teaches the confinement.
2. **S20-05** — every receipt write path commits through a janitor commit (stage `testhands` in
   `runTestLanes`, `regression` in `runRegressionLane`; `commitPendingReceipts` always
   pathspec-commits — the 0098 D4 ride-the-unified-commit deferral retired), and the one reader
   `newestGreenReceipt` (laneCarry, regressionCovered, dependencyComplete) demands the witness:
   no uncommitted change, the introducing commit carrying the janitor stage; a mismatch is named
   (P12) and simply not carry basis — the lane re-runs and re-witnesses.
3. **S08-04** — the formulation unit's landed todo pinned by a sha256 recorded at construction
   (`todoDigest` beside the floor digest; the collect refuses a session that edited its own
   single input) and the commit boundary restores the running unit's todo.md content from HEAD
   (`restoreOwnTodoContent` in `restoreUnitCloses`'s home; other tasks' documents untouched).
4. **S08-06** — the blocked collect's reload-failure return re-inserts the dropped row at the
   index head and commits it as the driver's own write (the blocked voice unchanged, the re-run
   re-dispatches the formulation over the surviving files); `loadPlan` refuses an orphaned
   `Formulate: <this phase>` unit naming the restore (the kill window between the exec commit
   and the collect).
5. **S08-08** — `newTaskProblems` rejects a `Formulate:`/`Closed:` field on a session-planned
   task with the removal remedy (the append collect inherits it through the same function).
6. **S10-01/02/07** — the task-level handoff.md retired at the wrap-up tail's entry (`runCloseout`,
   fresh closeouts only — a wrapup resume keeps the interrupted fix session's seed) and at each
   fix round's natural end; `handedOff` denies the closeout phase; `handoverVerdict` requires a
   fresh document for every due verdict (a due session over the consumed document takes the
   invalid-document ladder) and re-arms its single retry on each accepted handover;
   `runSubtask`'s recovery read gated on steer and resumeUnit, the `Status: done` close-out
   running the shape check (a failure blocks with both facts named).

## Changes

1. `plans/0171-verdict-surface-provenance.md` (created) — the ruling (D1–D8 as above).
2. `src/testrun.ts` (the confinement, the refusal, `TestRun.pending.refused`),
   `src/exec-session.ts` + `src/work-order.ts` (the deferred consumers pass `refused` through).
3. `src/script.ts` (`receiptDriverCommitted`, `commitLaneReceipts`, `newestGreenReceipt`'s
   witness, `runTestLanes`'s janitor commit), `src/regression.ts` (`runRegressionLane`'s janitor
   commit with the git handle plumbed through launchStale/the hold/the strict wait;
   `commitPendingReceipts` always-pathspec), `src/wrapup.ts` (the lane gate's handles; the fix
   round's natural-end retire; two stale comments re-read).
4. `src/tasks.ts` (`todoDigest`/`recordTodoDigest`/`unitTodoDigest`, the loadPlan orphan guard,
   the `Formulate:`/`Closed:` problems), `src/formulate.ts` (the digest records,
   `restoreFormulationRow`), `src/runner.ts` (the row restore + commit, the collect's digest
   pin, the tail-entry retire, the closeout rung gate).
5. `src/execute.ts` (`handoverVerdict` freshness + re-arm; `runSubtask`'s gates and the
   verified recovery close-out), `src/git-ops.ts` (`restoreOwnTodoContent`).
6. `templates/prompts/_partials.md` (the test protocol names the path form's confinement).
7. Tests: `test/testrun.test.ts` +2 (the refusal, the symlink escape),
   `test/regression.test.ts` +1 (the session-shaped receipt rejected, the janitor accepted) and
   4 re-pointed (the fixtures commit receipts janitor-style; the janitorial sweep's
   foreign-dirt half inverted), `test/formulate-synthesis.test.ts` +3 (the ledger-strip
   restored, the row-drop restore + re-run re-dispatch, the `Formulate:` marker problem),
   `test/git.test.ts` +1 (the own todo's content restore; another task's document untouched),
   `test/execute-handover.test.ts` +2 (the phantom handover, the retry re-arm),
   `test/verify-loop.test.ts` +1 (the execution-stage leftover never seeds the fix round) and
   1 fixture re-pointed (the carried anchor's receipt janitor-committed), `test/lane-table.test.ts`
   (3 sites re-pointed: HEAD read before the set, the hand-commit retired, the carry receipt's
   frozen tree), 10 `test/golden/*.golden.md` regenerated (exactly the one conscious protocol
   line each).
8. `plans/INDEX.md` (the 0171 row); `AGENTS.md` (four navigation lines gain 0171).

## Verification

- `bun typecheck` exit 0; full suite **2945 pass, 0 fail** across 152 files (was 2935 at step
  010's close; +9 new tests, +1 net after the re-pointed shapes).
- Fail-before proven: `git stash push -- src/`, each of the nine new regressions run against the
  pre-fix code — **each exactly 1 fail** (S11-04, S20-05, S08-04 ×2, S08-06, S08-08,
  S10-07 ×2, S10-01); restored after.
- Pre-existing family-check anomalies unchanged (0126 test/golden.test.ts, 0138 opencode.json —
  history-derived, present before this step).

## Dispositions

- **0165-006** — part 2 fixed (step 011, ruling 0171): S11-04 (the confined path form + the
  refused answer), S20-05 (the janitor witness over every receipt reader), S08-04 (the landed
  digest + the boundary content restore), S08-06 (the driver's row restore + the loader's orphan
  refusal), S08-08 (the marker problems), S10-01 (the scope-bound retires + the closeout rung
  gate), S10-07 (the fresh-when-due verdict + the per-handover retry), S10-02 (the recovery
  gates + the verified done close-out). With part 1 (step 010, ruling 0170) and the template
  teaching there, the ∪15 union is fully dispositioned.

Residuals (0171 D8, named): D1's lost-refusal recovery window (a kill between a refused freeze
and the post-handover run — the recovered execution runs the snapshot as a harmless
command-not-found); D2's lane-landing rewrite (a landing that rewrites the receipt-introducing
commit re-runs the lane once and re-witnesses); D5's kill window (a document left with the
record at its own stage's phase — the rung continues that stage from its own document, the
correct recovery); the subtask-file content edits and the cross-task shapes (0170 D4's
residuals — step 023's family); 0169 D4's forged-mark residuals unchanged. **S10-02's dedicated
e2e regression is deferred** (the ruling's Tests section names the scene: a subtask recovery
`Status: done` with the declared artifact missing blocks, a complete one closes out — the code
change is covered by the existing subtask/agent-fake suites staying green, but no new
fail-before test pins it; the natural home is the subtask-shape suite's recovery scenes, a
named follow-up for step 040's family or the final audit's sweep).
