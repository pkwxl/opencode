# 0230 — the due-cut reconciliation: the release record's standing material prepared, never cut

Status: active-authority (0166 remediation step 070, wave WA-docs; findings 0165-070 = S02-06
(S3, CONFIRMED, TRACE — "a release cut is due: 41 unreleased rulings (now 47 with
0161–0165) and a completed ruled program (0155–0160)"; the per-release audit — traceability,
replay, family check — had not run on 0124–0164) and its F-twin **F14** the same finding from
the release-audit register; the remedy S02-06 names: "this review's §release-audit is the
cut's draft input").

One family — the release spine's own record. The finding's shape is not a wrong sentence but
a missing reconciliation: releases.md's trigger ("a release is cut when a ruled program
completes") fired twice over (the 0155–0160 program completed 2026-10-30; the 0166
remediation program is in flight around this step) and no governed surface states what the
due cut owes, where its material stands, or what the standing register (0225 D6, created
after the finding) will feed it. Since the finding landed, two of its sibling halves were
fixed by steps 065/066 (the constitution reconciled, the registers refreshed); this step is
the remaining half — the due state itself reconciled into releases.md as **preparation**,
the cut's own acts untouched (the maintainer cuts it; the program's step 081 holds the
assessment; tagging/cut/publication only on explicit instruction). Zero code behavior is
ruled; the enactment is one releases.md section, one register row the census found missing,
and the pin that holds both.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P18** (the record outlives the tool): the due state is the durable record's own duty. A
  fired trigger with no reconciliation is state git proves (the commits, the INDEX release
  column) but no governed surface names — the same shape 0165-069 measured for the silent
  mid-cycle edit. The reconciliation is a plain-file record in releases.md itself, dated and
  cited; the framework stays documentation-layer, no tooling implied.
- **P19** (measured evidence): every number in the reconciliation is measured at its landing
  moment and cited to its command — the INDEX census (`grep -c "ships with the next
  release" plans/INDEX.md` → 105 rows, `0125`–`0229`, at HEAD `6f2cf849c` on 2026-11-09),
  the constitution-edit census (`git log --oneline 07036c2b5..HEAD --
  packages/auto-core/docs/principles.md` → five commits: `7401fe7b5` 0146, `c4fb131f7`
  step 006, `be3daccb1` 0221, `39095aee6` 0225, `696966685` 0226), the register checked
  against it (four rows — 0221's P15 amendment the one edit with no row), and the W1/W6
  gate state read from the program's ledger (both waves landed: step 009, steps 013/015).
  The snapshot is dated; the cut re-measures at its own moment.
- **P2** (the person brackets every boundary): the cut is the maintainer's act — releases.md's
  own frame (0110 D14), the program's step 081, and this program's hard constraint all say
  so. The preparation therefore consumes nothing: **the spine unmoved, the stamp unchanged,
  the register standing, the release sections unwritten** — the next release section is
  written and the register cleared only at the cut, by the maintainer's explicit
  instruction. Every automatic act here is bounded and terminates at the person.
- **P8** (deliberate enforcement moments): the reconciliation records and teaches — what the
  cut owes, where each draft input stands, which acts remain the maintainer's. It gates
  nothing and blocks nothing; the finding's own category was TRACE (the audit lagging), and
  the remedy is the record catching up, never a new stop.
- **P13** (frozen additive-only vocabularies): the register's grammar is additive-only. The
  census's one gap is repaired by **adding** the missing row (retroactive — the register's
  own precedent, 0146's row created retroactively by 0225 D6); no row is rewritten or
  removed, and the consumption rule (rows clear at the cut) is restated, never re-timed.

## The decisions

### D1 — the due state reconciled (the dated census recorded)

`docs/releases.md` gains **"## The due-cut reconciliation (0230, prepared not cut)"**,
placed after the per-release audit duty and before the `---` spine — standing material
between cuts, like the register beside it. The section records, dated to this step's
landing (2026-11-09, HEAD `6f2cf849c`):

- **The census**: 105 rulings open against the next release (INDEX rows marked "(open —
  ships with the next release)", spanning 0125–0229; v0.3.0 closed 0112–0124). A snapshot:
  the 0166 program's remaining steps (071–079) land further rulings and INDEX rows before
  the cut, and the cut ships the corpus as it then stands.
- **The programs**: 0155–0160 completed 2026-10-30 (the trigger's first firing); the 0166
  remediation program in flight — this step inside it — its remaining rulings shipping in
  the same cut.
- **The gate**: the 0165 review's release-readiness condition — "should not ship before W1
  and W6 land" — is green (W1 person-marks: step 009; W6 git boundary: steps 013/015; both
  fixed in the ledger). Step 081 re-checks the gate at its own moment.
- **The tag decision riding the cut**: the v0.3.0 tag remains the maintainer's explicitly
  instructed act (0165-178/F13's disposition, step 008) — the maintainer tags `07036c2b5`
  as v0.3.0, or the tag rides the next explicitly instructed cut alongside it.
- **The not-cut boundary**, stated as the section's own law: this section is preparation,
  never the cut — the version spine unmoved, the principles.md stamp unchanged, the
  register not cleared, no release section written; those acts are the cut's own, at the
  maintainer's explicit instruction (the program's step 081 the assessment, never the
  cut).

### D2 — the register completed and its consumption prepared, never enacted

The constitution-edit census (above) found the register incomplete: **0221's P15
amendment** (commit `be3daccb1`, 2026-11-08 — P15's statement, derivations and
known-tensions restated to the renderer-owned boundary, 0221 D2) is a mid-cycle
`Amends:` edit that landed three days **before** the register existed (0225, 2026-11-09)
and therefore carries no row. The row is added now, dated 2026-11-08 and named as the
retroactive record — 0146's own precedent (the retroactive row 0225 D6 created). With it
the register is complete against the census: every mid-cycle constitution edit since
v0.3.0 (the five commits above) has a row.

The reconciliation section then restates the register's rows — now five (0146, step 006,
0221, 0225, 0226) — as **the principle-delta draft the next release section absorbs at the
cut**: the consumption prepared, never enacted. The register's own rule stands untouched
(0225 D6): rows are consumed into the next release section's principle deltas **at the
cut**, clearing the register; rows from the remaining program steps (0231+) append as they
land and join the draft at the cut. Nothing here writes a release section, moves the spine
or clears a row — 0225's residual letter naming this step as the writer is amended below
to match the cut's own letter.

### D3 — the assessment material for step 081 (the cut's draft input marshaled)

The section enumerates what the cut owes and where each draft input stands — the 0165
review's §release-audit (S02-06's own remedy) the named input, its release-readiness line,
§9 item 7 and §10's wave ordering already consumed by the program's ledger:

- **The per-release audit duty, both items** (releases.md's own section), run at the cut
  over the cut-moment corpus: the traceability chain both directions (rule→principle:
  orphans and gaps; principle→code: divergences), and the falsification replay under
  0225 D7's stated method — never inside the repository; the blind child in an isolated
  directory holding the amended `docs/principles.md` alone, questions neutrally phrased,
  plans closed; the v0.3.0 replay's recorded confirmation stands as recorded.
- **The family-consistency check with S02-01's lapse recorded** (the finding's own
  remedy): 22 requirement-bearing rulings (0142–0161, 0163, 0164) carry no Category scope
  section — the cut's audit records the lapse; the 0166 program's rulings resumed the
  section.
- **The breaking-change determination (pre-1.0, in words) and its candidate list**: the
  practiced tombstones (0137's flag, 0138's ignore-set members, 0133's retired forms,
  0150 D2's registry refusal — S02-03's impact note), and the 0166 program's
  behavior-changing rulings (0169–0229) — each already ruled a defect fix in its own
  ruling (the floor never masks one; the spine's patch class), the determination's job to
  say so in words at the cut.
- **The release-section parts' sources**: principles deltas (the register's rows, plus any
  Tier amendments the open corpus carries — measured at the cut), Tier II default changes,
  mechanisms added/retired, ruled defect fixes, tombstones, re-keyed surfaces, findings
  disposition (F9–F22 with the 0165 register's dispositions at the cut-moment program
  state), version practice — the shape v0.3.0's own section shows.
- **The maintainer's acts at the cut**, named so the preparation never drifts into them:
  the version determination on the spine, the tags (v0.3.0's `07036c2b5`; the next
  release's own tag at its cut commit), the cut itself — the program's step 081 the
  assessment that hands this material over, tagging/cut/publication only on explicit
  instruction.

### D4 — the pin (the 0221 docs-pin pattern, the 0225/0226/0227 lineage)

`test/release-due-reconciliation.test.ts` + its `test/lanes.ts` manifest row, holding the
reconciled surface against silent drift — fail-red at HEAD (the section absent, the 0221
register row absent), green after. The needles: the section heading; the not-cut boundary
sentence (D1); the census sentence (the dated snapshot, `105` rulings `0125–0229`);
the register-restated sentence naming the five rows (D2); the 0221 retroactive row
present in the register table; the audits-owed lines (traceability both directions, the
replay under the stated method, the family check's recorded lapse — D3); the W1/W6 gate
sentence; step 081 named as the consuming step. The census is pinned **as the dated
snapshot it is, never a live oracle**: a live count against INDEX would go red at every
later step's INDEX row, falsifying a record that is already true — the exact drift the
pin exists to prevent. Anchoring a needle means moving it in the same change as a
sanctioned ruling, never to silence it.

## Derivation and Category scope

Derives: **P18** (the showing: the due state recorded in the durable release record
itself — a fired trigger reconciled, the census plain-file and cited, the framework still
documentation-layer), **P19** (the showing: every number measured at the landing moment
and cited to its command — the INDEX census, the five-commit constitution-edit census,
the register's one measured gap, the gate state from the ledger; the snapshot dated, the
cut re-measures), **P2** (the showing: the cut stays the maintainer's act — the
preparation consumes nothing, the spine/stamp/register/sections all held, step 081 and
the explicit instruction the person's moments), **P8** (the showing: the reconciliation
records and teaches what the cut owes; it gates nothing — the TRACE finding's remedy is
the record catching up), **P13** (the showing: the register repaired additively — the
missing row added per its own retroactive precedent, no row rewritten, the consumption
rule restated never re-timed). Amends: **none** — no principle or framework sentence is
restated; releases.md's trigger, change-control and register rules all stand as 0225
wrote them. Tier touched: **documentation** (the release record; zero code, zero runtime
behavior). premises this ruling changes: **0225's residual letter** — the residual's
"rows accumulate until step 070's due-cut reconciliation writes them into the next
release section and clears the register" named this step as the writer and clearer;
amended to the cut's own letter: the writing and clearing are the cut-time act itself
(the maintainer's, at the explicit instruction — releases.md's "the maintainer cuts it"
and "the release sections move only at a release event"), this reconciliation their
preparation (the rows restated as the draft, D2), steps 081+ the consumers. Re-read
standing: **0110 D14** (the maintainer-cuts frame — the reconciliation operates entirely
inside it), **0225 D6/D7** (the register's grammar and the replay method — consumed as
designed, D2/D3 operate per them), **0226 D1** (the refresh rule — this cut the first it
serves; the refreshed registers part of the drafted deltas), **0165-178/F13's
disposition** (the tag the maintainer's act — restated in D1/D3's material, unchanged).

### Category scope (0123 D1's discipline)

Family: *the release-spine documentation family — `docs/releases.md`'s standing framework
sections, the mid-cycle amendment register it holds, and the pin that holds them*.

| home | disposition |
| --- | --- |
| `docs/releases.md` — the due-cut reconciliation section (new, after the per-release audit duty) | changed — D1 (the census, programs, gate, tag, not-cut boundary), D2 (the register restated as the draft), D3 (the assessment material) |
| `docs/releases.md` — the mid-cycle amendment register: the 0221 retroactive row | changed — D2 (additive; 0146's precedent; the census's one measured gap) |
| `test/release-due-reconciliation.test.ts` (new) + `test/lanes.ts` (the manifest row) | changed — D4 (the pin; fail-red at HEAD) |
| `plans/INDEX.md` | changed — the 0230 row |
| `docs/principles.md` | held — no constitution text moves; the reconciliation is not a mid-cycle edit (the register's rows already carry those) |
| `AGENTS.md` | held — no navigation line changes (no code home moved; the docs-family description "the design changelog" still true) |
| `docs/structure.md`, `docs/glossary.md`, `docs/shell-contract.md` | held — no module mapping or term changes ruled |
| The shells (packages/auto, packages/auto-server) | held — no shell surface touches the release record (no twin check owed; no shell suite due) |
| `plans/NNNN` originals (0225, 0226, 0110, 0146, 0221) | held untouched — the reconciliation moves toward them, never they toward it; 0225's residual letter amended here, its text standing |
| Step 081 (release-assessment) | consumed — D1/D3's material its draft input; the W1/W6 gate state its first check; the cut itself never this program's act |

## Residuals

- **The census is a dated snapshot**: the remaining program steps (071–079) add INDEX rows,
  register rows and rulings after this step; the cut re-measures at its own moment (step
  081's assessment its own record). The pin holds the snapshot sentence as a record,
  never a live oracle (D4's own rule).
- **The reconciliation cannot force the cut**: if the maintainer defers past step 081, the
  material stands and the register keeps accumulating — the trigger sentence and the
  reconciliation together the honest record; no gate is added (P8's showing).
- **The register's completeness is as measured at this step**: a mid-cycle edit that
  escaped both the register and the census would still be an audit finding at the cut
  (the register's own rule); the census command is recorded above for the cut's re-run.
- **No test pins the consumption** (the cut is the maintainer's act — 0225's own
  residual, standing): the pin holds the preparation, the cut's writing/clearing stays
  unpinned by design.
