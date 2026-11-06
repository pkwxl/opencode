# Step 024 — w5-resume-reanchor

Wave: W5-control. Findings: 0165-023 (S12-04, S2, CONFIRMED — every resume or re-run re-anchors
the unit baseline at the current HEAD, so the verification charter's commit range omits all work
committed before: a re-run after a FAIL block or a kill during the wrap-up hands the verifier an
empty HEAD..HEAD range), 0165-024 (S12-05, S2, CONFIRMED — the resume re-anchor puts every
trailer-less commit made before the interruption outside the close-out audit: an agent's own
`git commit` is adopted as the person's, silently, and P4's audit never sees it). Started
2026-11-06 at HEAD `2ba7172cf`.

## Scope

The unit-baseline re-anchor's two untruths: the charter range (S12-04 — derived from the task's
first unit commit, taskFirstCommit's corpus-bounded scan; the close-out audit keeps the
re-anchored HEAD for the foreign-commit question) and the adoption's naming (S12-05 — the
foreign lines name each commit; while-driver-ran commits carry the P4 flag; the trailer-block
criterion itself already enacted by 0173 D2). The stream/subtask baselines (execute.ts's
persistStage refresh) and S03-01's constitution wording (step 065's row) are named, not touched.

## Design ruling

Ruling **0184** ([0184-charter-range-adoption-naming.md](../0184-charter-range-adoption-naming.md))
— its D1/D2 carry the full statements.

## Implementation order (the recovery map)

1. `src/git.ts` — charterBaseline (the true-start derivation); foreignCommitRecords (the one
   walk foreignCommits counts over); baselineIntact's ranUntil parameter and the named/flagged
   foreign lines.
2. `src/resume-gate.ts` — the ladder passes record.at.
3. `src/wrapup.ts` — runWrapup's commitRange over the derived charter baseline.
4. Tests: git.test.ts (charterBaseline, the named/flagged lines), resume-gate.test.ts (the
   adoption why pin, the while-ran flag), verify-loop or wrapup pin for the re-run range.
5. Ruling 0184 + INDEX row + navigation; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 023's commit (2ba7172cf) in the same worker stretch; the
  register rows and the S12-04/S12-05 records read; the code homes (loop-task's two re-anchor
  sites, runner's unitStart, wrapup's commitRangeText, taskFirstCommit/taskCorpusCommits, the
  wrapup charter sentence) surveyed.
- 2026-11-06: D1 landed (charterBaseline in git.ts beside taskFirstCommit; runWrapup's
  commitRange over the derived baseline); D2 landed (foreignCommitRecords as the one walk with
  foreignCommits the count front; baselineIntact's ranUntil parameter and namedForeignCommits;
  the ladder passes record.at). Ruling 0184, its INDEX row and the AGENTS.md verification-loop
  navigation line written.

## Verification

- `bun typecheck` exit 0 in packages/auto-core and packages/auto.
- auto-core full suite: **3015 pass, 0 fail** (153 files; 3009 at step 023's close — the six
  new pins).
- Fail-before: `git stash push -- src/` → 4 named failures plus git.test.ts's file-level load
  error (charterBaseline absent on the pre-change sources, subsuming its three pins): the
  adoption pin's old format, the named-adoption assertion, the while-ran flag, and the
  verify-loop wiring pin (the re-anchored `<sha>..HEAD` empty range). `git stash pop` restored.
- packages/auto suite: 149 pass, 8 skip, 5 fail — the same pre-existing fork/remove-fork
  baseline (step 031's wave); typecheck clean.

## Close-out

Step done 2026-11-06. Ruling **0184** active-authority; the INDEX row, the AGENTS.md
verification-loop navigation line, ledger rows 0165-023/024 and the program's
status/current-position land in the same commit. Residuals (0184's list): the stream/subtask
stage baselines keep persistStage's refresh semantics (no measured demand, P21); the while-ran
flag is the record-cadence boundary, not proof of authorship (imitation stays the
commit-provenance guard's family); S03-01's P4 derivation wording is step 065's row, this
ruling's case recorded for it to name; the named list bounded at five per repository.
