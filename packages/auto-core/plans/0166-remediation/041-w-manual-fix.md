# Step 041 — w-manual-fix: the manual fix subject ordinal + the countable gap grammar the master counts

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-manual-fix (the manual-driver prompt suite family: `prompts/` +
`src/install-prompts.ts` + `test/manual-prompts-ratchet.test.ts`), findings
**0165-049** (S25-03, S2, CONF, VOCAB, P13, 0148 D1/D3, 0094 D2;
`prompts/run.md:252-257`, `prompts/run.md:316-320` — both manual fix-subject
sites derive `<session>` as "the round's landed fix shares count", while the
driver's `nextFixSession` (src/git.ts) scans every repository root for the
highest `<id> fix <round>.<n>` subject and returns max+1, 1 when none exists)
and **0165-050** (S25-04, S2, CONF, VOCAB, P13, 0146 D1–D3, 0148 D3;
`prompts/run-verify.md:108-114`, `prompts/run.md:309-323` — the manual
verifier writes no countable gap grammar ("one entry per gap", freeform), and
the manual master "counts the gap entries" with no countable form and no
malformed-list shape gate, while the driver requires `### Gap N — <title>`
headings under `## Gaps` (countGaps counts `^### Gap` lines alone) and
re-prompts once on a malformed FAIL). Carried in from step 040 (0200's
residuals): run.md's own progress-rule sentence (loop step 6) still reads
pre-0198 phrasing ("a round that shrank the count buys the loop another
round" — natural reading versus-previous-count); the single-mode section
carries a second copy of the same rule in the same shape.
Started 2026-11-07 at HEAD `29d7d7856` (tree clean; steps 001–040 done; no
recovery needed).

## Findings

- **0165-049 (S25-03)** — both manual fix-subject sites derive `<session>` as
  the round's landed-share count: a fresh round's first session numbers 0
  (zero-based), the second share after `fix 1.1` numbers 1 again (duplicate),
  and sparse ordinals (a killed session's unlanded share, a clean session)
  are renumbered — defeating 0148 D1's unique per-session history and the
  driver's own max+1 reader. The adjacent exec-ordinal rule already says
  "one past the count"; the fix rule must say one past the **highest ordinal
  in the log, across every repository** (a round's commits may land in any of
  them — src/git.ts's own comment).
- **0165-050 (S25-04)** — run-verify's INCOMPLETE branch authorizes a freeform
  gap list ("one entry per gap") with no `## Gaps`/`### Gap N` grammar and no
  closing verdict line; run.md's master then "counts the gap entries" — the
  same list is two entries to a prose reader and zero to the driver's
  mechanical count (`^### Gap` headings alone), so the manual no-progress
  judgment is ambiguous and non-reproducible (an early stop or an unbounded
  loop where the driver re-prompts once then blocks). The driver's own loop
  (templates/prompts/wrapup.md, 0146 D1) teaches the countable grammar and
  gates on it (gapsShapeProblems: non-empty, ≥ 1 `### Gap N —` heading, the
  one-re-prompt rule).
- **Carried in (0200 residual)** — run.md's progress-rule sentences (loop
  step 6 and the single-mode self-verification copy) still read pre-0198
  phrasing; the companions' Stage 3 (0200 D1) already carries 0198 D1's
  best-count terms.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0201** written first (Derives/Amends, Category scope, premise
   guard): D1 the fix-subject ordinal derivation (max+1 across every
   repository, 1 when none exists) in both run.md sites; D2 the countable gap
   grammar carried into run-verify's INCOMPLETE branch + run-fix's
   read-first, run.md counting `### Gap N` headings alone with the
   one-reprompt-then-stop shape gate, and both progress-rule sentences
   restated in 0198 D1's terms.
2. Enactment in `prompts/run.md` (both fix-subject sites, the loop step 6
   INCOMPLETE branch: shape gate + count + progress rule, the single-mode
   copy), `prompts/run-verify.md` (the INCOMPLETE branch's gap-list grammar
   and closing line), `prompts/run-fix.md` (the read-first description of the
   list it reads).
3. Ratchet arms in `test/manual-prompts-ratchet.test.ts` (the derivation
   sentence, the grammar, the count rule, the shape gate, the best-count
   terms; the retired phrases pinned absent), fail-before red on the pre-fix
   prompt sources.
4. Full verification (`bun typecheck` + `bun test`; no shell package source
   touched — a guard run of packages/auto), docs (ruling 0201, INDEX row;
   AGENTS.md's manual-suite navigation line unchanged unless the family line
   needs the 0201 pointer), ledger rows, program position, single commit.

## Verification

All measured on the committed-state sources; fail-before proofs over `/tmp/041-fixed/` backups
(the pre-fix prompt sources restored from `git show HEAD:…` — run.md, run-verify.md, run-fix.md —
the proof run, the fixed files restored, `cmp`-verified byte-identical, green re-run).

- **auto-core**: `bun typecheck` clean; full suite **3105 pass / 0 fail** (155 files) — the
  3103/155 baseline + the 2 new ratchet tests (the log-derivation arm, the countable-grammar
  arm), zero regressions; `test/constitution-ratchet.test.ts` 5/0 after the doc edits (INDEX row,
  AGENTS.md navigation line, structure.md row).
- **packages/auto** (guard run — no auto source touched): `bun typecheck` clean; **160 pass /
  8 skip / 5 fail** — the exact baseline; the 5 = the pre-existing fork/remove-fork family
  (fork ×2, remove-fork ×3), identical names to step 040's verified baseline.
- **auto-server**: not run — no auto-server source or surface touched.
- **Fail-before proofs** (the 2 new ratchet tests over the pre-fix prompt sources): **2 tests
  red, the other 28 green** —
  - the 0201 D1 arm: red at its first pin (the derivation sentence absent — both sites said
    "the round's landed fix shares count", the zero-based/duplicate/renumbering derivation);
  - the 0201 D2 arm: red at run-verify's grammar pin (the freeform "one entry per gap" shape,
    no `## Gaps`, no `### Gap N`, no closing `Result: FAIL` line — the pre-fix file dumped
    verbatim in the failure output, the freeform branch visible);
  - all 28 pre-existing ratchet tests green on the pre-fix sources (the edits changed no pinned
    literal the old arms hold).
  - The restored sources re-ran **41 pass / 0 fail** (ratchet + install-prompts).
- Focused runs during enactment: ratchet + install-prompts 41/0 after the prompt edits and again
  after the restore; the frozen `Result: FAIL <one-sentence reason>` literal kept on one line in
  run-verify.md (step 040's in-change discovery applied ahead of time — no rewrap needed).

## Dispositions

- **0165-049 (S25-03)** — **fixed** under ruling **0201 D1**: both run.md fix-subject sites teach
  the driver's `nextFixSession` derivation — `<session>` one past the highest
  `<task id> fix <round>.<n>` subject already in the log for that round, across every repository
  the target holds, 1 when none exists; sparse indices stay sparse (the numbering keys on the
  log's highest, never a count of landings). The count-based derivation and its zero-based,
  duplicate and renumbering shapes retired; the exec-ordinal sentence stands (dense by
  construction, not the finding).
- **0165-050 (S25-04)** — **fixed** under ruling **0201 D2**: the countable gap grammar carried
  into the whole-task channel — run-verify's INCOMPLETE branch writes the driver's FAIL-side form
  (`## Gaps`, `### Gap N — <one-line title>` per gap, closing `Result: FAIL <one-sentence
  reason>`, no terminator), run-fix's read-first describes the same form, and run.md's master
  shape-checks the verdict's write (one feedback relaunch, then stop), counts the `### Gap N`
  headings alone, and applies the best-count progress rule in 0198 D1's terms (loop step 6 and
  the single-mode copy both restated; the pre-0198 phrasing retired).
- **Carried-in (0200's residual)** — **discharged**: run.md's progress-rule sentences restated in
  0198 D1's terms as part of D2; the retired phrases pinned absent in the ratchet.
- **Discovered in-change** (recorded, unacted on): none this step — the prompt sweep found no
  further fix-subject or gap-count site outside the ruled three files (run-fix.md:24's "the gap
  entries still open" is handover-document content, not the list grammar; left as is).

Residuals recorded (0201's own): the manual shape gate and count are text-level prompt rules —
the ratchet holds rule-sentences and retired phrases, deeper scenario machinery being 0165-165's
question (step 043); run.md's fix-share subjects keep their `<short title>` form (already the
driver's grammar), the companions' `<task title>` sites staying 0165-163's family (step 042).
