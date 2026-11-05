# Step 012 — w1-choice-analysis-boundary

Wave: W1-person-marks. Findings: 0165-025 (S12-06, S2, CONFIRMED), 0165-093 (S07-03, S3,
PLAUSIBLE). Started 2026-11-06 at HEAD `96b4b6c71`.

## Scope

The Choice mark's execution path and the analysis document's write boundary — the two
person-mark surfaces 0165 named for this wave's tail:

1. **0165-025 — the person's one-line Choice dead-ends both ways.** The blockage document's
   protocol line promises "The next `run`/`plan` executes an un-executed `Choice:` mark
   mechanically", but (a) `run` never executes a Choice — `executeBlockageChoices` is called
   only from plan's prelude (`src/plan.ts` planPrelude), and `run` reaches runAll directly;
   under `run`'s render-gate blockage the person's re-run re-fails the gate and a fresh
   diagnosis session writes blockage-\<n+1\> every time (D8's suspension counts executed
   documents only); (b) under `plan` the executor's own `beginUnit` clean gate refuses the
   uncommitted `Choice:` line the protocol taught the person to write — their answer is called
   dirt. The executor tests commit the Choice in setup, so the person's real act was never
   pinned.
2. **0165-093 — docs/analysis.md is writable by every run-time session.** The analysis —
   whose release mark installs the brief verbatim, whose roadmap lines establish rounds, whose
   `### R-NN` proposals install verbatim past the round-start gate — sits outside protect's
   read-only set while the brief it feeds is run-protected (0081 D6c/D11). A task or
   distillation session that drafts a proposal or moves a roadmap line has its text committed
   by the driver's unified commit, consumed under the person's earlier release mark.

## Design ruling

Ruling **0172** ([0172-choice-execution-analysis-boundary.md](../0172-choice-execution-analysis-boundary.md)):
Derives P2 (the person's one-line act is consumable exactly as taught) with P8 and P4; the
analysis half Derives P2/P5 (the brief's precedent — the pre-round governance document is the
person's between commands). Tier: operating. Category scope: the person-mark consumption
family (blockage documents' Choice execution) and the run-time read-only set family
(protect.ts). No frozen vocabulary changes (the `remediation` stage is reused for the
person's-choice commit; no new stage, no grammar change).

## Execution log

- 2026-11-06: step opened. Surfaces read: blockage-execute.ts, blockage-diagnose.ts,
  plan.ts (prelude row), loop-preflight.ts (start gate placement), git.ts (beginUnit /
  commitTree pathspec), protect.ts, document/roles.ts, analysis.ts, clarify.ts,
  agents-block.ts (the primer's audience), docpaths.ts. Reachability of the combined
  interrupted-unit + pending-Choice state assessed (attempt.ts's record write sits at
  dispatch) — recorded as a named residual in the ruling rather than solved here.
- Ruling 0172 written (Derives P2 with P8/P4/P5; premise 0082 D7 amended; D1 the
  answer-commit pre-pass, D2 the preflight executor row, D3 protect's analysis entry).
- Implemented: `src/blockage-execute.ts` (the person's-choice pre-pass — pathspec-scoped
  `remediation` commit per pending document with uncommitted changes, before `beginUnit`),
  `src/loop-preflight.ts` (the executor row before the start clean gate; skipped by lane
  workers and dryrun; non-stale reblock exits 2), `src/protect.ts` (FILES gains
  ANALYSIS_DOC), `test/import-direction.test.ts` (the stale "plan.ts imports this module
  only" comment corrected — both modules sit in the pipeline sub-domain, the edge legal).
- Regressions added: blockage-executor.test.ts (the person's uncommitted Choice — 0165's
  own repro: placeholder committed, `Choice: A` written over it uncommitted, executed with
  the answer commit first), loop-preflight.test.ts (the run-side Choice at preflight; the
  bare-project floor), protect.test.ts (the analysis pin + the no-analysis skip).

## Verification

- `bun typecheck` exit 0.
- `bun test` — **2950 pass 0 fail** (152 files; was 2945 at step 011's close; +5 tests).
- Fail-before proven (stash src/ only): exactly the 3 new defect regressions fail on the
  pre-fix code — the executor repro reblocked "the worktree is not clean", the preflight
  run-side Choice exited 2 at the start gate, the protect analysis pin had no entry. The
  floor test passes on both sides by design.
- import-direction 12 pass (the loop-preflight → blockage-execute edge is pipeline →
  pipeline, no table edit needed).

## Dispositions

- **0165-025 — fixed**: D1 + D2. The person's one-line act is performable exactly as
  taught on both commands: the Choice is committed first (its own remediation commit
  naming the person's choice) and executed; run carries the executor row.
- **0165-093 — fixed**: D3. docs/analysis.md is read-only during run (the brief's
  precedent); the person's edits happen between commands where protection is off.

Residuals (recorded in the ruling and the program): the combined interrupted-unit +
pending-Choice state (step 023's carryover family); the chmod guardrail's missing teaching
line (step 056's template-copy family).

Committed as `0166: step 012 done — ruling 0172 the person's Choice executes; the analysis run-time read-only (0165-025, 0165-093)`.
