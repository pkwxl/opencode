# Step 042 — w-manual-vocabulary: 0148's short-title grammar completed across the manual suite

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-manual-vocabulary (the manual-driver prompt suite family: `prompts/` +
`src/install-prompts.ts` + `test/manual-prompts-ratchet.test.ts`), finding
**0165-163** (S25-08, S3, CONF, VOCAB, P13, 0148 D2–D3;
`prompts/run-as-subtasks.md:83-88`, `prompts/run-as-subtasks.md:253-259`,
`prompts/resume-subtasks.md:131-139`, `prompts/resume-subtasks.md:246-252`,
`prompts/run.md:594-598`, `src/git.ts:79-83` — 0148's short-title grammar is
still incomplete across the manual suite: the subtask companions' decompose/
wrapup/fix/done subjects keep the full-title `<task title>` placeholder, and
run.md's formulation share keeps `<task id> exec <title>`; even run.md's
general share-title definition says only "its leading words" plus 100-character
truncation, not the driver's mechanical clause-cut/four-word `shortTitle` rule).
Carried in from steps 040/041 (rulings 0200/0201): the companions' fix-subject
sites (`T-NNN fix <round>.<session> <task title>`, written by 0200 D1) join
this family — the 0200/0201 ratchet arm pins the `<task title>` literal at
`test/manual-prompts-ratchet.test.ts:206` and moves in conscious lockstep with
this change.
Started 2026-11-07 at HEAD `ea418e0bd` (tree clean; steps 001–041 done; no
recovery needed).

## Findings

- **0165-163 (S25-08)** — 0148 D2 ruled the driver's mechanical short-title
  rule (`shortTitle` in src/git.ts: the first clause cut at the first
  `:` / `(` / em-dash, capped at four words, the leading words as fallback)
  into every driver subject bearing a task or subtask title, and D3 mirrored
  it into the manual suite — but D3's mirror landed only in run.md and
  run-verify.md. The subtask companions (in the suite since 0078) kept the
  full-title placeholders: `T-NNN decompose <task title>`,
  `T-NNN wrapup <task title>`, `T-NNN fix <round>.<session> <task title>`,
  `T-NNN done <task title>` (both files, stage listings and landing sentences
  alike — 15 sites), and 0200 D1's fix-subject sites wrote the same form. The
  formulation share (`<task id> exec <title>`, run.md's phase-loop step 6)
  kept a bare `<title>`. And no commit-making companion teaches the
  derivation: run.md's general definition says only "its leading words …
  truncated so the subject stays within 100 characters", and run-verify.md —
  whose primary hands it the **full** `<task title>` — teaches nothing at all,
  so the verification session cannot derive the `<short title>` its own
  wrapup/done subjects require except by improvisation.
- **Carried in (0200/0201)** — the companions' fix subjects write
  `<task title>`; rulings 0200 D1 and 0201 recorded them into this family.
  The 0200 ratchet arm's pin (`T-NNN fix <round>.<session> <task title>`)
  moves to the short-title form in the same lockstep (P13's conscious flip).

## Plan (enactment order; each ingredient lands green)

1. Ruling **0202** written first (Derives/Amends, Category scope, premise
   guard): D1 every task-title-bearing subject in the manual suite carries
   `<short title>` (the companions' 15 sites + run.md's formulation share);
   D2 the mechanical clause-cut/four-word rule taught once per commit-making
   companion (run.md's general definition restated mechanically; run-verify.md
   and both companions gaining it); D3 the ratchet extended beyond the
   run.md/run-verify happy path (the companions' subjects pinned, the
   retired full-title forms pinned absent, the 0200 arm's pin flipped).
2. Enactment in `prompts/run.md` (the general definition, the formulation
   share), `prompts/run-verify.md` (the rule, once), `prompts/
   run-as-subtasks.md` and `prompts/resume-subtasks.md` (the subject sites +
   the rule, once each).
3. Ratchet arms in `test/manual-prompts-ratchet.test.ts`, fail-before red on
   the pre-fix prompt sources.
4. Full verification (`bun typecheck` + `bun test`; no shell package source
   touched — a guard run of packages/auto), docs (ruling 0202, INDEX row,
   AGENTS.md navigation line if the family line needs the 0202 pointer,
   structure.md's suite row), ledger row, program position, single commit.

## Verification

All measured on the committed-state sources; fail-before proofs over `/tmp/042-fixed/` backups
(the pre-fix prompt sources restored from `git show HEAD:…` — run.md, run-verify.md,
run-as-subtasks.md, resume-subtasks.md — the proof run, the fixed files restored, `cmp`-verified
byte-identical, green re-run).

- **auto-core**: `bun typecheck` clean; full suite **3106 pass / 0 fail** (155 files) — the
  3105/155 baseline + the 1 new ratchet test (the 0202 arm), zero regressions; the
  constitution-ratchet green inside the full run after the doc edits (INDEX row + 0148 annotation,
  AGENTS.md navigation line, structure.md row).
- **packages/auto** (guard run — no auto source touched): `bun typecheck` clean; **160 pass /
  8 skip / 5 fail** — the exact baseline; the 5 = the pre-existing fork/remove-fork family
  (fork ×2, remove-fork ×3), identical names to step 041's verified baseline.
- **auto-server**: not run — no auto-server source or surface touched.
- **Fail-before proofs** (the ratchet over the pre-fix prompt sources): **3 tests red, the other
  28 green** —
  - the 0202 arm: red at its first pins (the rule's mechanical terms absent from every
    commit-making file; the companions' four subject forms carrying `<task title>`);
  - the 0200 D1 arm: red at its flipped pin (`T-NNN fix <round>.<session> <short title>` absent —
    the pre-fix companions carry `<task title>`);
  - the phase-transfer arm: red at its flipped pin (`` `<task id> exec <short title>` `` absent —
    run.md's formulation share carried `<task id> exec <title>`);
  - all 28 other ratchet tests green on the pre-fix sources (the edits changed no pinned literal
    the old arms hold).
  - The restored sources re-ran **42 pass / 0 fail** (ratchet + install-prompts).
- Focused runs during enactment: ratchet + install-prompts 42/0 after the prompt edits (the first
  run caught one pin needing newline normalization — "under the same four-word cap" spans a line
  break in the companions; fixed in-change) and again after the restore.

## Dispositions

- **0165-163 (S25-08)** — **fixed** under ruling **0202**: every task-title-bearing subject in the
  manual suite carries `<short title>` — the companions' 15 sites (decompose/wrapup/
  `fix <round>.<session>`/done, both files) and run.md's formulation share — and the mechanical
  clause-cut/four-word rule (0148 D2's terms: the title's first clause cut at the first
  `:` / `(` / em-dash, capped at four words, the leading words the fallback, the subject truncated
  past 100 characters) is taught once per commit-making companion (run.md's general definition
  restated mechanically — the finding's family site; run-verify.md gaining it; both companions at
  their Commit-subjects block, with the subtask-share note putting the item's declared short title
  under the same four-word cap). The full title stands in every non-subject position (the
  authoritative-state lines, the primaries' fill-ins, run-plan/plan-append's document grammar);
  the phase commits (phaseTitle) and the elided subjects untouched. The ratchet extended beyond
  the run.md/run-verify happy path: the new arm pins the short-title subject forms, the rule's
  terms per file and the retired full-title literals absent; the two existing pins of the retired
  forms (0200 D1's arm, the phase-transfer arm) flipped in the same lockstep.
- **Carried-in (0200/0201's `<task title>` family)** — **discharged**: the companions' fix-subject
  sites joined D1's sweep; 0200 D1's ratchet pin flipped with it, its comment carried current.
- **Discovered in-change** (recorded, unacted on): none — the suite sweep found no further
  task-title-bearing subject outside the ruled four files (run-task/run-fix/run-handover/run-plan
  hold no task-title subjects; the remaining `<task title>` occurrences are document grammar,
  primaries and authoritative-state prose, all standing by design).

Residuals recorded (0202's own): the rule is a text-level prompt rule — the ratchet holds subject
literals, rule terms and retired forms, deeper scenario machinery being 0165-165's question
(step 043); the manual prose names the canonical three separators (`:` / `(` / em-dash) in 0148
D2's spelling while the driver's code handles their full-width twins — a divergence the ratchet
cannot see, accepted (the driver-side rule is the truth).
