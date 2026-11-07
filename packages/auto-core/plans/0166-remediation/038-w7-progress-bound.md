# Step 038 — w7-progress-bound: the oscillating-gap progress bound + the charter clamp's first-line rewrite

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W7-verify (its first step), findings **0165-003** (S11-02, S1, CONF, DEF,
P2; `src/wrapup.ts`) and **0165-022** (S12-03, S2, CONF, DEF, P7/P12;
`src/charter-clamp.ts`). Started 2026-11-07 at HEAD `9af47c2d5` (tree clean;
steps 001–037 done; no recovery needed).

## Findings

- **0165-003 (S11-02)** — 0146's progress rule compares with the previous
  round's gap count, not the best: `if (lastGaps !== undefined) noProgress =
  gapsNow < lastGaps ? 0 : noProgress + 1` — a count that alternates down/up
  (2,1,2,1…) resets the streak on every down step, so an oscillating
  verifier/fixer pair (a fix closes a gap and breaks another — the common LLM
  shape) never blocks: unbounded fix rounds, the person's quota spent, the
  escalation never terminating at the person (P2's boundedness; re-reproduced
  at 0165 verification: 11 fix rounds over 2,1,2,1… never blocked, claimed
  bound 4). The ruled `2 + N` bound (0146 D3, restated in `wrapup.ts`'s
  header) is false in code even under a best-count comparison — the true bound
  is 2N+2.
- **0165-022 (S12-03)** — the charter clamp's re-record locates its line by
  `lines.findIndex((line, index) => index === lineText - 1 || sameIssueLine(line,
  item))` — the first index satisfying **either** disjunct. The position
  disjunct never checks content (a stale line number rewrites whatever line
  now sits there), and `sameIssue` is substring containment
  (`x.includes(y) || y.includes(x)` after whitespace removal), so an earlier
  unrelated marker whose question is a substring of the flagged item's is
  overwritten — its recorded decision destroyed — while the flagged wide
  default stays in force in the document; the OPEN line still tells the person
  the clamp took effect. The header's own promise ("a marker whose line no
  longer matches (edited, moved) is ledger-clamped only") is not what the code
  does.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0198** written first (Derives/Amends, Category scope, premise
   guard) — D1 the progress rule keyed on the loop's best (the persisted
   `gaps` field's meaning restated: the minimum measured, not the last
   measured; the true bound 2N+2 stated), D2 the clamp's content-proven
   re-record (the recorded line a hint accepted only under an exact-content
   test; a unique exact match elsewhere; none/ambiguous → ledger-only).
2. Enactment: `src/wrapup.ts` (the rule + the FIX_ROUNDS/header comments),
   `src/resume.ts` + `src/runner.ts` (the field's meaning comments; no shape
   change), `src/charter-clamp.ts` (clampItem's locator), `src/resolve.ts`
   (`normalize` exported for the exact test — additive).
3. Regression tests in the existing suites (`test/verify-loop.test.ts`,
   `test/charter-clamp.test.ts`), fail-before red on pre-fix source (backups
   in /tmp, cmp-verified restore, green re-run).
4. Full verification (`bun typecheck` + `bun test`; no shell package touched),
   docs (ruling, INDEX row + 0146's annotation, AGENTS.md navigation lines),
   ledger rows 0165-003 and 0165-022, program position, single commit.

## Verification

All measured on the committed-state sources; fail-before proofs over `/tmp/038-fixed/`
backups (the pre-fix source restored from `git show HEAD:…`, the proof run, the fixed file
restored, `cmp`-verified byte-identical, green re-run).

- **auto-core**: `bun typecheck` clean; full suite **3096 pass / 0 fail** (155 files) — the
  3092/155 baseline + the 4 new tests (1 verify-loop, 3 charter-clamp), zero regressions.
- **packages/auto** (guard run — no auto source touched, but core behavior changed):
  `bun typecheck` clean; **160 pass / 8 skip / 5 fail** — the exact baseline; the 5 = the
  pre-existing fork/remove-fork family (fork ×2, remove-fork ×3), identical names to step
  037's verified baseline.
- **auto-server**: not run — no auto-server source or surface touched.
- **Fail-before proofs** (each red on the named pre-fix source, all 28 old verify-loop tests
  and 11 old clamp tests still green on it — the byte-identical claim for every non-defect
  shape measured, not asserted):
  - **0165-003 / D1**: on pre-fix `src/wrapup.ts`, the oscillation test
    ("an oscillating gap count blocks (0198 D1): 2 → 1 → 2 → 1…") **1 fail** — the old rule
    read the sequence as progress every second round, ran fix round 4 and accepted the
    trailing PASS (the bounded reproduction of the finding's unbounded loop); the record
    assert failed with `gaps: 2` (the last count) where the fix persists `gaps: 1` (the best).
  - **0165-022 / D2, three pins**: on pre-fix `src/charter-clamp.ts`, the two-marker test
    **1 fail** (the earlier substring marker "wire format -> v1" rewritten — its decision
    destroyed — while the flagged "v2 everywhere" line stood), the moved-line test **1 fail**
    (the unrelated prose at the stale slot replaced by the clamped marker), the
    ambiguous-duplicate test **1 fail** (the heading at the stale slot rewritten by position);
  the restored sources re-ran **43 pass / 0 fail** over both suites.
- Focused runs during enactment: `test/verify-loop.test.ts` 29/0; `test/charter-clamp.test.ts`
  14/0.

## Dispositions

- **0165-003 (S11-02)** — **fixed** under ruling **0198 D1**: the progress rule keys on the
  loop's best (the minimum gap count its FAILs have measured, seeded by the first FAIL) —
  a round that re-closes a gap a predecessor's regression re-opened never reaches a new low
  and extends the streak; the true bound (≤ 2N+2 rounds, ≤ 2N on the FAIL path) stated in
  the header and the ruling, replacing 0146 D3's false `2 + N`; the persisted `gaps` field's
  meaning becomes the best (name/shape/sanitize unchanged, monotone and constant sequences
  byte-identical, the block message verbatim).
- **0165-022 (S12-03)** — **fixed** under ruling **0198 D2**: the clamp's document rewrite
  requires the grammar's own parse to prove the line is exactly this item's marker (question
  normalize-equal — never substring — and option equal); the recorded line number is a hint
  accepted only under that test, a moved marker is found by the content search (exactly one
  exact match), and no match or an ambiguous duplicate rewrites nothing — ledger-clamped
  only, the ⚡ OPEN line still surfaced; `normalize` exported from resolve.ts as the one
  normalization home; `sameIssue` unchanged for its pairing consumers (a pairing rule, never
  a write authority).
- **Discovered in-change** (recorded, unacted on): the clamp test fixture's own recorded line
  number (`report.md:4`) did not name the marker's line (5) — the pre-fix position arm masked
  it by rewriting the empty line at the recorded slot, so the existing suite had been
  exercising the defect's shape and passing; the fixture corrected to the truthful `:5`.
  Nothing else outside the step's scope was touched.

Residuals recorded (0198's own): the cross-version resume window (a pre-0198 record's `gaps`
read as a looser best after an oscillating run — transient, self-correcting at the next
persist); 0146's standing residuals (constant-count gap trading; grammar compliance) as ruled
there; sameIssue's substring latitude for pairing stands by 0082's design.
