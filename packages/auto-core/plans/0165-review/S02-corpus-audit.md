# S02 — requirements-consistency audit of the corpus (the release-audit draft, corpus half)

Date 2026-11-02 · HEAD read 358be4003, extended at d579016b2 (0164) · status: done (corpus half; the
principle→code roll-up is pivoted from the code steps' `measures` fields at S32/S35).

## Coverage

docs/principles.md (whole), docs/releases.md (spine, audit duty, v0.3.0), plans/INDEX.md (whole), the decision
blocks and Category scope sections of 0124–0164, the landing commits of 0124–0164 (`git log --diff-filter=A`),
the "(enacted)" follow-up commits, git tags, docs/glossary.md (term census), AGENTS.md navigation (size census).

## Rule → principle (0124–0164)

All 41 rulings carry a `Derives:` line naming three or more P-ids and state their tier; 0142–0164 (except 0157,
0159, 0161, 0162) also carry `Amends:`. **No orphan ruling** (none matches no principle). Practice: one
consolidated `Derives:` paragraph per document enumerating per-decision showings (e.g. 0156 l.239 covers D1–D8);
principles.md l.439 reads "every … decision block states its derivation" — the practice has held since 0124 and
passed v0.3.0's audit, so this is a wording-alignment note (S02-09), not a defect.

| plan | Derives | Amends | Category scope | D-blocks |  | plan | Derives | Amends | Category scope | D-blocks |
|---|---|---|---|---|---|---|---|---|---|---|
| 0124 | ✓ | – | ✓ | 7 | | 0145 | ✓ | ✓ | ✗ | 4 |
| 0125 | ✓ | – | ✓ | 1 | | 0146 | ✓ | ✓ | ✗ | 5 |
| 0126 | ✓ | – | ✓ | 1 | | 0147 | ✓ | ✓ | ✗ | 3 |
| 0127 | ✓ | – | ✓ | 1 | | 0148 | ✓ | ✓ | ✗ | 3 |
| 0128 | ✓ | – | ✓ | 1 | | 0149 | ✓ | ✓ | ✗ | 4 |
| 0129 | ✓ | – | ✓ | 1 | | 0150 | ✓ | ✓ | ✗ | 5 |
| 0130 | ✓ | – | ✓ | 1 | | 0151 | ✓ | ✓ | ✗ | 3 |
| 0131 | ✓ | – | ✓ | 1 | | 0152 | ✓ | ✓ | ✗ | 4 |
| 0132 | ✓ | – | ✓ | 1 | | 0153 | ✓ | ✓ | ✗ | 4 |
| 0133 | ✓ | – | ✓ | 1 | | 0154 | ✓ | ✓ | ✗ | 4 |
| 0134 | ✓ | – | ✓ | 1 | | 0155 | ✓ | ✓ | ✗ | 4 |
| 0135 | ✓ | – | ✓ | 1 | | 0156 | ✓ | ✓ | ✗ | 8 |
| 0136 | ✓ | – | ✓ | 1 | | 0157 | ✓ | – | ✗ | 6 |
| 0137 | ✓ | – | ✓ | 1 | | 0158 | ✓ | ✓ | ✗ | 5 |
| 0138 | ✓ | – | ✓ | 1 | | 0159 | ✓ | – | ✗ | 3 |
| 0139 | ✓ | – | ✓ | 1 | | 0160 | ✓ | ✓ | ✗ | 5 |
| 0140 | ✓ | – | ✓ | 5 | | 0161 | ✓ | – | ✗ | 2 |
| 0141 | ✓ | – | ✓ | 5 | | 0162 | ✓ | – | ✓ (prose) | 5 |
| 0142 | ✓ | ✓ | ✗ | 4 | | 0163 | ✓ | ✓ | ✗ | 3 |
| 0143 | ✓ | ✓ | ✗ | 5 | | 0164 | ✓ | – | ✗ | — |
| 0144 | ✓ | ✓ | ✗ | 4 | | | | | | |

## Family-consistency check (0123 D3)

- **Present (19):** 0124–0141, 0162. Mechanical check (`tools/family-check.ts`) over "changed" rows vs the landing
  and "(enacted)" commits: ok for 0124, 0125, 0127–0131, 0133–0137, 0139–0141; triaged misses —
  **0126**: `test/golden.test.ts` marked changed, untouched (the goldens moved, not the runner) — imprecision;
  **0132** (ruled d569cc132, enacted 5b5b52fcd): marked changed but untouched — `src/phases.ts`/`src/analysis.ts`
  (the `Wall:` parser landed in `src/phases/custom.ts`: equivalent home, wrong enumeration), **`src/config-fix.ts`**
  ("0122's stamping and sync … changed") and **`src/document/roles.ts`** (PROTECTED_FILES; protect.ts changed
  instead). principles.md l.447: "an enactment touching a proper subset of its own enumeration is an audit
  finding". The open question whether `fix`'s 0122 sync can re-add an allow the closed wall retired is S20's.
- **Absent (22):** 0142–0161, 0163, 0164 — every one requirement-bearing (most amend earlier rulings), including the
  whole 0155–0160 review fix-wave program. 0123 D1 makes the section mandatory; the lapse began 2026-10-27 and is
  ongoing (0164, 2026-11-02). Reconstructing all 22 home-sets is out of this review's budget; S32 reconstructs only
  where a code step found a family inconsistency.

## Deprecation lifecycle and breaking-change candidates (since v0.3.0)

releases.md l.24: "tombstone → one release of visible warning → removal in a named later release". Practice since
v0.3.0 is the **instant tombstone** — the retirement lands as a parse-time refusal or strict failure in the same
change: 0137 (`amend --phases` refused outright, "the `--amend`/`init --brief` precedent of parse-time retirement
notices"), 0150 D2 (a registry route naming `number-recovery` now fails strict validation — `MODEL_ROLES`,
src/switches.ts:174 — a registry valid at v0.3.0 fails the run at load), 0133 (the brief stub entry and the init
seed flag tombstoned in one change). 0130 honored the lifecycle by choosing no break (`ondemand` kept as a live
synonym). Breaking-change determination needed in words at the cut: 0150 D2, 0137, 0138 (the .gitignore set change
`fix` applies), 0133.

## Release state

- releases.md records v0.3.0 (2026-10-25), and l.128 makes the tag "the maintainer's act at this release's commit";
  `git tag -l 'v0*'` → v0.1.0, v0.2.0 only.
- 41 rulings (0124–0164) are "(open — ships with the next release)"; the 0155–0160 program completed 2026-10-30
  ("a release is cut when a ruled program completes") → a cut is due.
- **principles.md was edited mid-cycle**: 7401fe7b5 (0146, 2026-10-28) rewrote P2's derivation line l.61 — Tier I
  text — between releases, stamp still "Current as of release v0.3.0"; the same line imports a numeric threshold
  ("two consecutive no-gap rounds block") that l.18/l.453 keep out of the constitution, and "no-gap rounds" reads
  literally as "rounds that found no gap" (a PASS). Meanwhile 0145, which contradicts P4's derivation text, did not
  touch principles.md — the mid-cycle edit practice is itself inconsistent.

## Navigation and docs currency

- docs/glossary.md last changed 2026-10-27 (c7813014d) and lacks terms the code and docs now use: key hold,
  new-session walk, sealed (reference) wall, launcher / confinement, foreign-commit adoption, info class,
  knowledge boundary, tree lanes, regression lane, clarify, driver-helper, width (some predate v0.3.0). AGENTS.md:
  "Comments and user-facing messages … using the terms in docs/glossary.md".
- AGENTS.md navigation: S01-07. shell-contract/auto AGENTS.md: S01-06.

## Register currency (principles.md, stamped v0.3.0)

- R2 (channel divergence) last showed 0103 → 0161 is a newer instance (the manual suite lacked the Auto-Nested
  grammar since 0021 D4).
- R4 (constitution creep / size) → re-showing in AGENTS.md (S01-07) and in l.61's threshold.
- R7 (corpus growth without governance) → 41 unreleased rulings in 9 days; the per-release audit lagging.
- T8 (wait-and-preserve vs fail-fast) → 0163's five-minute key hold is a new person-ruled standing constant;
  candidate annotation. Candidate new rows: 0129 lock-free fork (P5 writer gate vs P8 false block), 0145 adoption
  (P4's driver-only commit right vs P8/P20).
- T3 → 0162's 3600 s harness reap is a throughput pressure on the driving channel, not the boundary rhythm —
  context only, trigger not fired.

## Findings (the F-series candidates — S34 verifies, S35 numbers them F9…)

```jsonl
{"id":"S02-01","title":"Category scope discipline lapsed: 22 requirement-bearing rulings (0142–0161, 0163, 0164) carry no Category scope section","sev":"S3","conf":"CONFIRMED","cat":"TRACE","measures":["0123 D1/D3","principles.md l.447","P19"],"loc":["auto-core/plans/0142-*.md … 0164-*.md"],"symbol":"## Category scope","evidence":"grep -c 'Category scope' = 0 in each; present in 0124–0141, 0162","repro":{"cmd":"bun plans/0165-review/tools/family-check.ts","observed":"'no Category scope section' for the 22"},"impact":"the family-consistency check — the release audit's guard against surface-enumerated enactment (0120's failure) — cannot run on 22 rulings incl. the review fix-wave program","remedy":"the cut's audit records the lapse; future rulings resume the section; reconstruct home-sets where S32 finds family drift","family":["AGENTS.md development conventions (requirement intake)"],"prior":"NEW","wave_hint":"W0 governance"}
{"id":"S02-02","title":"0132's enactment touched a proper subset of its own Category scope (config-fix.ts and document/roles.ts marked changed, untouched; the parser home enumerated wrongly)","sev":"S3","conf":"CONFIRMED","cat":"TRACE","measures":["principles.md l.447","0123 D3"],"loc":["auto-core/plans/0132-sealed-reference-wall.md (Category scope)","commit 5b5b52fcd"],"symbol":"0132 Category scope","evidence":"5b5b52fcd touches external-dirs, git, loop-phase, loop-preflight, phases/custom, phases/registry, protect, regression, transfer, wall (+tests); not config-fix.ts, document/roles.ts, phases.ts, analysis.ts","repro":{"cmd":"git show --stat 5b5b52fcd","observed":"as listed"},"impact":"an audit finding by rule; a real defect only if fix's 0122 sync needed the change (S20 decides)","remedy":"record at the cut; S20's verdict decides whether code follows","family":["S20 seam"],"prior":"NEW","wave_hint":"W0 governance"}
{"id":"S02-03","title":"the written deprecation lifecycle (tombstone → warning release → removal) is not the practiced one (instant parse-time tombstones); 0150 D2 breaks a v0.3.0-valid operator registry with no warning release","sev":"S3","conf":"CONFIRMED","cat":"VOCAB","measures":["P13","releases.md l.24"],"loc":["auto-core/docs/releases.md:24","auto-core/src/switches.ts:174","auto-core/plans/0137-phases-internal-mmode-floor.md","auto-core/plans/0150-numbering-floor-derivation.md"],"symbol":"MODEL_ROLES / amend --phases","evidence":"0150: 'A registry route naming number-recovery now fails validation (D2's tombstone)'; 0137 cites 'the precedent of parse-time retirement notices'","repro":null,"impact":"two incompatible lifecycle rules; the cut's breaking-change determination must name 0150 D2, 0137, 0138, 0133","remedy":"amend releases.md's lifecycle to state the practiced convention (a removed flag/role's tombstone is its permanent teaching refusal; the warning release applies to behavior that silently changes), or run the warning release","family":["docs/principles.md P13 l.262-282"],"prior":"NEW","wave_hint":"release cut"}
{"id":"S02-04","title":"the constitution was edited between releases: 0146 (7401fe7b5) rewrote Tier I P2's derivation line, stamp unchanged; the line imports a threshold and a misleading 'no-gap rounds' phrase","sev":"S3","conf":"CONFIRMED","cat":"TRACE","measures":["releases.md l.5","principles.md l.18, l.453, l.459","R4"],"loc":["auto-core/docs/principles.md:61","commit 7401fe7b5"],"symbol":"P2 Derivations","evidence":"-'fix rounds → --repair → the human (0083 D5)' +'fix rounds (progress-gated, never count-capped — two consecutive no-gap rounds block, 0146 amending 0083 D5) → --repair → the human'","repro":{"cmd":"git show 7401fe7b5 -- packages/auto-core/docs/principles.md","observed":"as quoted"},"impact":"'a release event is the only moment the constitution changes' broken once, unevenly (0145 did not edit P4) — the stamp misdates the text; a blind reader takes 'no-gap rounds' as passing rounds","remedy":"at the cut: state the mid-cycle edit in the release record, rephrase l.61 without the threshold ('blocks when rounds stop making progress'), keep the threshold with its mechanism","family":["S03-01"],"prior":"NEW","wave_hint":"release cut"}
{"id":"S02-05","title":"the v0.3.0 git tag was never created","sev":"S4","conf":"CONFIRMED","cat":"TRACE","measures":["releases.md l.128","P18"],"loc":["auto-core/docs/releases.md:128"],"symbol":"git tags","evidence":"git tag -l 'v0*' → v0.1.0, v0.2.0","repro":null,"impact":"the release spine's anchor missing for v0.3.0","remedy":"the maintainer tags 07036c2b5 (the v0.3.0 cut commit)","family":[],"prior":"NEW","wave_hint":"W0 governance"}
{"id":"S02-06","title":"a release cut is due: 41 unreleased rulings and a completed ruled program (0155–0160)","sev":"S3","conf":"CONFIRMED","cat":"TRACE","measures":["releases.md l.5","R7"],"loc":["auto-core/plans/INDEX.md (release column)"],"symbol":"release spine","evidence":"41 rows '(open — ships with the next release)'","repro":null,"impact":"the per-release audit (traceability, replay, family check) has not run on 0124–0164","remedy":"this review's §release-audit is the cut's draft input","family":[],"prior":"NEW","wave_hint":"release cut"}
{"id":"S02-07","title":"glossary lags the vocabulary: a dozen terms in code and docs have no glossary entry","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["P13","AGENTS.md overview"],"loc":["auto-core/docs/glossary.md"],"symbol":"terms","evidence":"no entry for key hold, walk, sealed wall, launcher, adoption, info class, knowledge boundary, tree lanes, regression lane, clarify, driver-helper, width","repro":null,"impact":"the one-concept-one-term map is incomplete","remedy":"add the rows at the cut","family":[],"prior":"NEW","wave_hint":"release cut"}
{"id":"S02-08","title":"the registers are stale against 0124–0164 (R2, R4, R7 'last showed'; T8 and two candidate new trade-off rows)","sev":"S4","conf":"CONFIRMED","cat":"TRACE","measures":["principles.md registers"],"loc":["auto-core/docs/principles.md:464-488"],"symbol":"T/R registers","evidence":"see Register currency above","repro":null,"impact":"the registers stop being the watched list","remedy":"update at the cut","family":[],"prior":"NEW","wave_hint":"release cut"}
{"id":"S02-09","title":"wording vs practice: principles.md asks a derivation per decision block; the corpus states one consolidated Derives paragraph per document","sev":"S4","conf":"CONFIRMED","cat":"TRACE","measures":["principles.md l.439"],"loc":["auto-core/docs/principles.md:439"],"symbol":"How to rule","evidence":"0156 l.239 one Derives covering D1–D8","repro":null,"impact":"none in practice","remedy":"align the sentence to the practice at the cut","family":[],"prior":"NEW","wave_hint":"release cut"}
```

## Seam notes

- S20: 0132 config-fix/roles question (S02-02). S12: the P4/0145 text conflict (S03-01) when judging adoption code.
- S35: §release-audit takes this file whole; the principle→code roll-up pivots the code steps' `measures`.
