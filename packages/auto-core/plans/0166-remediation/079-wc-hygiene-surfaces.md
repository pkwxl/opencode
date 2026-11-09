# Step 079 — wc-hygiene-surfaces: hygiene C (the switch documentation home, the agents-block rewrite scope, the template bash grant, the red receipt's Log field, the never-init banner, the README key-ring claim)

Status: **done** 2026-11-09 (started from HEAD a967e8e59 — step 078's
commit; worked, verified and committed in one session).

Findings: 0165-062 (S01-04, S3 CONFIRMED DOC — six OPENCODE_AUTO_* switches
parsed in code documented nowhere; step 069/ruling 0229 already added the
README `### Experiment switches` table with a census ratchet — re-derive what
remains), 0165-208 (S22-07, S4 CONFIRMED DEF — person-file rewrites reach
beyond the driver's own lines: removePointer's unconditional whitespace
collapse, the .gitignore rewrites' trailing-blank-line collapse), 0165-209
(S24-06, S4 CONFIRMED GEN — the shipped permission template's unexplained
host-specific /home/* bash grant), 0165-210 (S25-10, S4 CONFIRMED DEF — every
red lane receipt emits the Log field twice), 0165-214 (S27-02, S4 CONFIRMED
UX — run on a never-initialized directory prints a defaults config banner,
then refuses on the missing agent contract naming `fix`, which itself refuses
naming `init`), 0165-218 (S28-04, S4 CONFIRMED DOC — README's key-ring
paragraph asserts "The walk never oscillates", refuted by S17-03's
reproduction; check whether step 018/ruling 0163's lockstep already repaired
the paragraph), all bucket WC-hygiene. Evidence: the records
plans/0165-review/S01-probes.md (062 · S01-04), S22-config.md (208 · S22-07),
S24-templates.md (209 · S24-06), S25-bundles.md (210 · S25-10),
S27-cli-commands.md (214 · S27-02), S28-cli-docs.md (218 · S28-04).

Surface (expected, to be re-derived at HEAD before editing):
`packages/auto/README.md` (the switches table's six names; the key-ring
paragraph), `src/agents-block.ts` (removePointer's collapse gating),
`src/gitignore.ts` (the append/strip trailing-blank-line preservation; the
nested-repo reset arm), `templates/opencode.json` (the /home/* row; the
template registration), `src/script.ts` (writeLaneReceipt's Log field), the
template genericity scan's path family, `packages/auto/src/index.ts` and/or
`src/loop-preflight.ts` (the never-init teaching), their test homes, ruling
0239 + INDEX row + program bookkeeping.

## Plan (written before editing)

1. Ruling 0239 first: answer each finding's boundary from docs/principles.md
   (P13/P8 for the switch-documentation home; P7/P10 for the person-file
   rewrite scope; P16 for the template grant; P5 for the receipt's duplicate
   field; P8/P12 for the never-init banner; P13/P19 for the README claim).
   Measure every locus at HEAD a967e8e59 — step 069 (0229) and step 018
   (0163) may already have landed arms; where an arm is already landed,
   consume it honestly with the measurement.
2. Enact per the ruling: the switch-table residual (whatever of S01-04's six
   names 0229's table missed); removePointer's collapse gated as
   ensurePointer's; the .gitignore rewrites preserving the person's trailing
   blank lines (and the nested-repo reset arm re-measured); the template's
   /home/* row removed with the genericity-scan family; the red receipt's
   single Log field with the field sequence pinned; the never-init direct
   init teaching (the root cause the missing config); the README key-ring
   paragraph restated to 0163's truth.
3. Regression coverage per ruled defect, fail-before proven by the /tmp
   swap-source method (back up fixed files, `git show HEAD:` the pre-fix
   bytes in, run the new tests red, restore, cmp-verify byte-identical, run
   green). Doc-only arms prove by measurement (grep red/green).
4. Verify: `bun typecheck` + full suite in auto-core against the 3301 pass /
   0 fail, 165 files baseline (step 078's); packages/auto `bun x tsgo
   --noEmit` + its suite against the 170 pass / 8 skip / 6 fail baseline
   (the six known pre-existing fails by name).
5. Bookkeeping: INDEX row 0239, ledger dispositions for the six findings,
   program row 079 → done, Current position rewritten for step 080, this
   record's Verification + Dispositions filled. Commit the step's paths.

## Session log

- 2026-11-09 (this worker): authoritative inputs read (the program's
  executable prompt, status row 079, the six ledger rows, Current position;
  the S01-04/S22-07/S24-06/S25-10/S27-02/S28-04 records in full;
  AGENTS.md). Row 079 marked doing; this record created. Next: measure every
  locus at HEAD a967e8e59, then write ruling 0239.

- 2026-11-09 (this worker): measurement pass at HEAD `a967e8e59` complete.
  **062**: consumed as landed — all six S01-04 names present in the
  README's switch home (FORK + SYNTHESIS_TIMEOUT table rows,
  HANDOVER_CONCURRENT + TASK_CONTEXT retired tombstones at
  switches.ts:140/:145, SHARE + HEAP_SNAPSHOT the agent's-own paragraph),
  the census ratchet holding them; nothing remains. **208**: all four arms
  live — removePointer's whole-file collapse + trim (agents-block.ts:321),
  appendEntries' trimEnd (gitignore.ts:97), stripEntries' trim
  (:166-170), the stale nested line surviving removeGitignoreEntries
  (:185, entries derived from the live tree; no durable init-time record).
  **209**: the /home/* row live at templates/opencode.json:19; the
  template rides path imports (config-op/config-fix/reset), not the
  registry; no genericity scan exists. **210**: the doubled Log live at
  script.ts:644/:650; no src reader parses Log. **214**: reproduced — run
  prints the defaults banner then the contract stop teaching fix, fix
  teaches init (two hops); plan ALREADY refuses honestly
  (requireConfigFile at index.ts:1598 — the one home), fix's refusal
  correct; the core-side preflight arm declined on the measured 13-site
  core test floor over bare dirs (config.ts's documented "Both run and
  init go through this entry" contract); transfer's cousin shape measured
  (banner + m-mode stop). **218**: "The walk never oscillates" live at
  README:1349 with its never-true reason; 0178 D1/D2/D3's gates stated
  nowhere in the paragraph.

- 2026-11-09 (this worker): ruling 0239 written (one consolidated Derives
  paragraph, ten showings, Amends none — 0158 D2 extended, 0229 consumed,
  0178's lockstep half completed; premises none — eight re-reads; Category
  scope a 16-row table). Enacted: D1 no change (the measurement recorded);
  D2 in src/agents-block.ts (the seam-local cleanup: spans collected,
  spliced right-to-left, each seam's blank run min(open+close, 2), an EOF
  seam's tail to one newline, the write verbatim, emptied on trimmed
  compare), src/gitignore.ts (appendEntries' verbatim base + one newline
  only when lacking; stripEntries' verbatim join with emptied = every kept
  line blank; staleNestedEntryLines at the grammar's home), src/reset.ts
  (the stale note on the strip entry, a keep entry when stale lines stand
  alone); D3 the template row removed + test/template-genericity.test.ts
  (the home-path families scan, the ruled /tmp exception named, the bash
  section's needles); D4 in src/script.ts (the red branch's Log duplicate
  retired, the kill line keeping its blank); D5 in packages/auto/src/index.ts
  (run's `requireConfigFile("run", true, true)` before startRunLog; the
  legacyRuns bypass added to the shared helper — plan/amend byte-identical,
  the legacy floor kept) + two e2e locksteps (the combos test restated to
  the refusal — stderr, no banner, no log file — and the token-form floor
  arm seeded a config after the first full run caught it); D6 the README
  paragraph's three gates + three docs-truth pins. Regression tests: reset
  +6, gitignore +4, script +4, template-genericity +3 (new file, the unit
  lane registered), docs-truth +3. Verification below. Next: bookkeeping,
  then commit.

## Verification

- auto-core `bun typecheck` exit 0. Full suite **3318 pass / 0 fail**
  (166 files = the 3301/0 baseline + 17 net new; 21665 expects) — green
  on the first full run; the agent-fake quota-wait one-off absent.
- packages/auto `bun x tsgo --noEmit` exit 0. Full suite **173 pass /
  8 skip / 6 fail** — the 170/8/6 baseline + docs-truth's 3 new pins; the
  6 fails the known pre-existing set by name (the phased-P1 e2e, fork ×2,
  remove-fork ×3). The first full run carried a 7th fail — the
  token-form test's floor arm still rode run-over-never-init reaching the
  banner; repaired in-change by seeding a config in that test (its floor
  runs now end at the contract stop through a configured directory), the
  lockstep green in isolation and in the final full run. Both lockstepped
  e2e tests and the legacy-fallback + legacy-layout pins green.
- No auto-server suite (no auto-server file touched; its ops already
  refuse never-init honestly by route — measured).
- Fail-before over /tmp/079-fixed (the five changed core files + the
  shell's index.ts and README.md backed up, HEAD's bytes swapped in via
  `git show HEAD:./<path>`, the new tests run red, restored and
  cmp-verified byte-identical, green):
  - the AGENTS.md seam pin (reset.test.ts — at HEAD the deliberate 3+
    blank-line gap collapses and the leading blank lines vanish);
  - the mid-file seam pin (at HEAD the same collapse, the seam
    over-normalized);
  - the .gitignore strip pin (at HEAD the leading and trailing blank
    lines collapse to one trimmed line);
  - both stale-nested report pins (at HEAD silent — no reason line, no
    keep entry);
  - the red-receipt sequence and timeout pins (at HEAD two identical Log
    lines);
  - both genericity pins (at HEAD the /home/* row present);
  - the combos e2e (at HEAD the banner and the contract stop, the
    assertions on the new refusal failing);
  - both key-ring pins (at HEAD the false invariant present, the gates
    absent).
  gitignore.test.ts red at the file level at HEAD (the
  staleNestedEntryLines export absent) with its append arm proven
  behaviorally by an isolated probe over HEAD bytes (the trailing blank
  lines collapsed). Green at HEAD by design: the emptied pin (the
  ensurePointer-created shell's rule unchanged — the floor) and the
  key-ring section-exists pin.
- The 062 consumption proven by measurement: all six names present at
  HEAD, the census green — no change made, the census the guard.

## Dispositions

- **0165-062 (S01-04)** — fixed by step 069's ruling 0229, consumed with
  measurement here (0239 D1): all six names in the one person-facing
  switch home, each held by the census ratchet; no residual.
- **0165-208 (S22-07)** — fixed (0239 D2): the seam-local removePointer
  cleanup (0158 D2's law on the removal path), the append/strip byte
  preservation, the stale nested line reported never stripped.
- **0165-209 (S24-06)** — fixed (0239 D3): the /home/* grant removed, the
  genericity scan holding the family; standing projects untouched, the
  reset keep-consequence recorded.
- **0165-210 (S25-10)** — fixed (0239 D4): Log stated once, the red field
  sequence pinned.
- **0165-214 (S27-02)** — fixed (0239 D5): run joins requireConfigFile
  with the legacy bypass; the core-side arm declined on the measured
  floor; transfer's cousin shape recorded out of scope.
- **0165-218 (S28-04)** — fixed (0239 D6): the paragraph states 0178's
  three gates, the false invariant retired, docs-truth pins holding it.
- Residuals recorded: none deferred of this step's six; the declined and
  consumed arms live in the ruling's decisions and the ledger rows.
