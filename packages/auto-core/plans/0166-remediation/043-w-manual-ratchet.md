# Step 043 — w-manual-ratchet: the ratchet pins ruled relationships, not just vocabulary presence

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-manual-ratchet (the manual-driver prompt suite family: `prompts/` +
`src/install-prompts.ts` + `test/manual-prompts-ratchet.test.ts`), finding
**0165-165** (S25-11, S3, CONF, TEST, P13, 0124 D5, 0148 D3, test-oracle lens;
`test/manual-prompts-ratchet.test.ts:77-113`, `test/manual-prompts-ratchet.test.ts:149-178`,
`test/bundle.test.ts:268-293` — the ratchets pin vocabulary presence but not the
ruled relationships, allowing S25-01 through S25-09's protocol drift to ship
green: the commit case checked subject literals but not max+1, the protocol case
checked result strings but not gap grammar, no case exercised resume's state
gate or ticked-phase selection, and the bundle case validated declarations
without the contradicting verify-plan-audit text).
Started 2026-11-07 at HEAD `93c4f7f37` (tree clean; steps 001–042 done; no
recovery needed).

## Findings

- **0165-165 (S25-11)** — at the review's HEAD the manual ratchet was
  presence-only, and the finding's four evidence clauses have been discharged
  in stages since: the bundle-side join (charter artifact text joined to the
  declaration test) landed at step 017 (ruling 0177 D1, `test/bundle.test.ts`);
  the manual-side semantic pins — the ruled derivation/gate/counting sentences
  pinned verbatim, the defective retired sentences pinned absent — landed at
  steps 040/041/042 (rulings 0200 D1–D4, 0201 D1–D2, 0202 D1–D3 arms in
  `test/manual-prompts-ratchet.test.ts`). What no step has yet ruled is the
  oracle boundary itself: rulings 0200/0201/0202 each recorded the same
  residual — "text-level oracles, the suite's only possible oracle over prompt
  copy; deeper scenario-execution machinery is 0165-165's question (step 043)"
  — so this step owns the design ruling: what the manual ratchet's oracle IS
  (and the unit it pins), whether scenario-execution machinery is built, and
  the completion of the relationship pinning the finding's title names.
- **The coupling gap (this step's enactment site)** — the ratchet's anti-rot
  arm (0078's pattern: "the src anti-rot arm holds the canonical table against
  the producing code") pins the driver's commit-grammar *literals* only. Every
  ruled relationship the 0200–0202 arms state has a driver-side derivation
  producer (`shortTitle`, `nextFixSession`, `charterBaseline` in src/git.ts;
  `countGaps`/the best-count comparison/the round-scoped deletion in
  src/wrapup.ts; `nextReady`/`scanUnitStates` in src/document/unit.ts) whose
  semantics are held by the driver's own suites (git.test.ts,
  verify-loop.test.ts, phases.test.ts, the unit tests) — but a conscious
  semantics change on the driver side trips only those suites, never the
  manual ratchet: the manual sentence pin stays green while the two sides
  diverge. The lockstep's driver-side half is unpinned — the one-sided
  relationship pin is the residual shape of the finding's own defect class.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0203** written first (Derives/Amends, Category scope, premise
   guard): D1 the oracle boundary — text-level, unit = the ruled relationship,
   scenario execution declined with grounds; D2 the coupling completion — the
   anti-rot arm extended to the ruled relationships' derivation-bearing
   producers (the enumerated eight); D3 the named ceiling (the manual suite's
   own choreography rules, no driver twin, sentence pins alone) and the
   revisit trigger for executable coupling.
2. Enactment in `test/manual-prompts-ratchet.test.ts` only: the new coupling
   arm (the eight producer pins, each naming the manual-side arm it couples
   to) + the header's boundary statement. No `prompts/` copy change, no `src/`
   change, no installer change.
3. Fail-before proof: drift each producer semantics in /tmp-backed copies
   (every previously-pinned literal intact) — HEAD's ratchet green over every
   drift (the blindness, the finding's repro transposed to the driver side),
   the new arms red; restore, cmp-verify, re-run green. The manual-side
   fail-befores were steps 040–042's (cited, not repeated).
4. Full verification (`bun typecheck` + `bun test`; no shell package source
   touched), docs (ruling 0203, INDEX row, AGENTS.md navigation line,
   structure.md suite row), ledger row, program position, single commit.

## Verification

All measured on the committed-state sources; the fail-before proof over /tmp/043-fixed backups
(the three producer files backed up, each drift applied by a perl program file, the ratchet run
old-then-new over each drift, the producer restored and cmp-verified byte-identical after every
drift; the new ratchet re-run green on the restored tree).

- **auto-core**: `bun typecheck` clean; full suite **3107 pass / 0 fail** (155 files) — the
  3106/155 baseline + the 1 new coupling-arm test, zero regressions; the constitution ratchet
  green inside the full run after the doc edits (INDEX row, AGENTS.md navigation line,
  structure.md suite row).
- **packages/auto** (guard run — no auto source touched): `bun typecheck` clean; **160 pass /
  8 skip / 5 fail** (173 tests) — the exact baseline; the 5 = the pre-existing fork/remove-fork
  family (fork ×2, remove-fork ×3), identical names to step 042's verified baseline.
- **auto-server**: not run — no auto-server source or surface touched.
- **Fail-before proof** (the defect is the ratchet's one-sidedness, so the proof drifts the
  DRIVER side — each drift a semantics change leaving every previously-pinned literal intact —
  and shows HEAD's ratchet green over it, the finding's own repro transposed): **8 drifts, 8×
  blindness shown, 8× bite shown** —
  - a `shortTitle` four-word cap → eight: old ratchet 31 pass / 0 fail, new ratchet 31 pass /
    1 fail (the coupling arm);
  - b `nextFixSession` `max + 1` → `max` (the duplicate-subject shape): old 31/0, new 31/1;
  - c `charterBaseline` parent → the first commit itself (the empty-range shape): old 31/0,
    new 31/1;
  - d `countGaps`' heading test → any non-indented line (the freeform-list shape): old 31/0,
    new 31/1;
  - e the progress comparison strictly-lower → or-equal (the pre-0198 oscillation shape): old
    31/0, new 31/1;
  - f the round-scoped report/gaps `rm` pair deleted (0170 D1's stale-verdict shape): old 31/0,
    new 31/1;
  - g `nextReady`'s `!done.has(unit.id)` dropped (order-only selection, S25-07's shape): old
    31/0, new 31/1;
  - h `scanUnitStates`' both-files branch dropped (the half-open gate): old 31/0, new 31/1.
  - Every drift's old-ratchet run is the demonstrated blindness (HEAD's ratchet read none of
    these producers); every new-ratchet run fails at exactly the coupling arm (all 31 others
    green). Producers restored byte-identical after the proof; the restored-tree ratchet re-ran
    32 pass / 0 fail. The manual-side fail-befores were steps 040–042's (cited, not repeated).
- Focused runs during enactment: the ratchet 32/0 after the arm landed.

## Dispositions

- **0165-165 (S25-11)** — **fixed** under ruling **0203**, jointly with the already-landed
  halves: the bundle-side join (the finding's fourth evidence clause) landed at step 017
  (ruling 0177 D1, `test/bundle.test.ts`); the manual-side semantic pins (the first three
  clauses — max+1, gap grammar, the state gate and ticked-phase selection) landed at steps
  040/041/042 (rulings 0200–0202, each arm with its retired defective sentence pinned absent,
  each fail-before proven there). This step's ruling completes the finding's title: the ratchet
  pins ruled relationships — the oracle's unit is the relationship, held from both sides: the
  manual sentence, the retired defective sentence, the frozen literal, and (new, D2) the
  driver-side derivation-bearing producer line — eight couplings, each naming the manual-side
  arm it pairs. Scenario-execution machinery is declined on grounds (D1: a prose-rule
  interpreter measures itself, never the prompt; the driver functions' re-runs duplicate each
  semantics' one behavior home; an LLM-judged evaluation is non-deterministic), the ceiling
  named (D3: the suite's own choreography rules have no driver twin — sentence pins are their
  ceiling by design) and the revisit trigger recorded.
- **Discovered in-change** (recorded, unacted on): none — the enumeration found no further
  ruled relationship of the 0200–0202 arms with a driver-side derivation producer beyond the
  eight; the choreography rules (the verdict channel, the children-never-commit division, the
  re-entry idempotence, the uncommitted-gaps lifecycle) verified to have no `src/` producer
  (`Verification:` appears in no src file) and are named as the ceiling rather than coupled.

Residuals recorded (0203's own): the pins hold lines, not behavior — a driver-side semantics
change leaving every pinned line intact escapes D2 (none measured; the revisit trigger's exact
shape); 0202's full-width-separator prose divergence stands accepted, now visible in the
coupling pin itself.
