# Releases — the design changelog

The maintained release record of the design: one section per release, recording what the constitution said at each point in time and what changed and why. Git history stays the code audit trail (P18) — commits prove what changed in bytes; this file records what changed in **design**: principles established, amended, merged or demoted (with P-ids and tiers), mechanisms added or retired (with `plans/NNNN` pointers), vocabularies tombstoned, the falsification-replay confirmation, and the audit findings' disposition. Code detail, per-commit narration, and anything git already proves do not belong here.

A release is cut when a ruled program completes; **the maintainer cuts it**. Between releases, audit findings accumulate; the version spine, the stamp and the release sections move only at a release event, while the constitution's text may be edited mid-cycle in exactly two recorded classes — reconciliation (a wording repair bringing the text back to what a ruling already ruled) and a mid-cycle `Amends:` ruling landing its change — each recorded in the mid-cycle amendment register below (0225, from 0165-069: the defect was the edit's silence, never its timing). The framework is documentation-layer: the release section itself is the record, no tooling implied.

Ruled at plans/0110 D14, from the measured ground: no git tags, package `version: 0.0.0`, the plans corpus the only history — the spine starts from zero.

## The version spine

Semver as the design-evolution axis:

- **major** — a Tier I amendment or a breaking contract change.
- **minor** — a new opt-in mechanism (floor-preserving, P10) or a Tier II default change.
- **patch** — ruled defect fixes (defects change every run; the floor never masks one).

While pre-1.0, minor may carry breaking changes — the release record says so in words. Semver discipline tightens at 1.0.

**The `pre` baseline.** The plans corpus 0001–0109 predates this framework and is baselined as `pre` in `plans/INDEX.md`'s release column: no retroactive versioning, every original untouched. `INDEX.md` rows carry the release each later plan's rulings shipped in; supersession pointers name the release that superseded.

## Amendment and deprecation

- **Amendment lifecycle.** An `Amends:` ruling names the release it amends, in the same change that lands it; `docs/principles.md` carries the stamp "current as of release vX.Y". A Tier I amendment is a major release; a Tier II default flip is minor. A ruling matching no principle is resolved before landing — constitution incomplete, or the ruling is drift (the derivation discipline, plans/0110 D5).
- **Deprecation lifecycle (the two-track rule, 0225 — the practiced convention stated).** Retiring a **vocabulary** (a flag, a config key, a registry role, a protocol word): **the tombstone is the retirement** — the retired surface becomes a permanent parse-time teaching refusal (a usage error or a strict validation failure naming the successor channel), never silently ignored; no warning release, because the refusal itself teaches on every use (detection at the surface — P8; the practiced line: 0137's flag precedent, 0150 D2's registry refusal, 0052 D3/D4, 0053 §10 B4). Retiring a **behavior** (a mechanism whose removal silently changes what happens, with no surface left to refuse): **one release of visible warning → removal in a named later release**; detection during the warning release records, it does not gate (P8). Both tracks: ids never reused (P13's own discipline) — no silent dual meanings, no unversioned breaks.

## The mid-cycle amendment register (0225)

Between releases the constitution's text may be edited in exactly two classes, each recorded here as it lands — append-only, one row per edit — and consumed into the next release section's principle deltas at the cut, clearing the register. A mid-cycle edit no row states is an audit finding (0165-069's defect: an edit the stamp misdated and no record named).

- **Reconciliation** — a wording repair bringing the text back to what a ruling already ruled (the text lagging or contradicting its own ruling).
- **Mid-cycle amendment** — an `Amends:` ruling landing its change with the ruling itself. A Tier II default flip mid-cycle rides the same register, named as the default change it is.

| date | ruling / step | surface | delta (a clause) | finding |
| --- | --- | --- | --- | --- |
| 2026-10-28 | 0146 (`7401fe7b5`) | principles.md P2, bounded escalation | the fix-round budget line rewritten (progress-gated, never count-capped); the stamp left at v0.3.0 — **this row is the retroactive record** | 0165-069 / F12 |
| 2026-11-05 | 0166 step 006 | principles.md P10 derivation list; the P16-secrets family row | `OPENCODE_AUTO_PLAN_VERIFY` moved to the opt-in-checks clause (0113's reality); the secrets family restated to 0055 §4.2's true shape | 0165-101, 0165-132 |
| 2026-11-08 | 0221 (`be3daccb1`) | principles.md P15 (statement, derivations, known tensions) | P15's statement restated to name the two renderer-owned classes (driver document-grammar teaching; dynamic driver feedback — a third class of code-authored session-facing prose stays a defect, 0221 D2), the derivations gaining the census line — added retroactively by 0230 (the edit pre-dated this register, 0146's precedent) | 0165-047, 0165-159 |
| 2026-11-09 | 0225 | principles.md P4/P8/P13/P2/P5/P17/P18/P20, How-to-rule, the change-control paragraph; releases.md intro/lifecycle/audit duty; AGENTS.md's derivation-discipline clause | P4's derivations reconciled with 0145 (adoption + the re-anchor); P8 gains the recorded-state (info) class; the deprecation lifecycle restated as the practiced two-track rule; P2's line rephrased without the threshold, current to 0198; five definitional sentences (lock scope, shared git state, task-id uniqueness, safe boundary, Tier precedence); the change-control rule amended to the two recorded classes with this register; the replay method named in the audit duty | 0165-007/F18, 0165-071/F19, 0165-068/F11, 0165-069/F12, 0165-181/F17, 0165-182/F20, 0165-183/F21 |
| 2026-11-09 | 0226 | principles.md trade-off/risk registers (T8's cells, the new T10/T11; R2, R4, R7) | the registers refreshed to the corpus — reconciliation: the cells restated to their rulings' own content (T8's key hold 0163 D1 and eligible-with-wait 0219 D2; T10 the lock-free read-only channel 0129, T11 adoption 0145, added; R2/R4/R7's last-showed cells current) | 0165-180 / F16 (the glossary rows landed beside it, 0165-179/F15, are not constitution text) |

## The per-release audit duty

Each release section stands on two audits, both recorded in it:

1. **The traceability chain, both directions** — positioning → Tier I → Tier II → concrete requirement → code home → test home, audited rule→principle (orphans, gaps) and principle→code (divergences). Findings are numbered, append-only, and dispositioned in the release that closes them.
2. **The falsification replay** — the constitution must answer real, already-ruled questions with the plans closed; the answers come out the same, or the principle set returns to synthesis — never to the ruling. **The method (0225, from S03 run 1's measured breach — 0165-183/F21): the replay never runs inside the repository** — any agent session started there auto-loads AGENTS.md, whose navigation names the rulings; the blind child starts in an isolated directory holding the amended `docs/principles.md` alone, questions neutrally phrased (no plan numbers, no mechanism names), plans closed.

## The due-cut reconciliation (0230, prepared not cut)

Standing material between cuts, beside the register above it. The release trigger — "a release is cut when a ruled program completes" — has fired and stood unreconciled (0165-070/F14, S02-06): this section is the reconciliation, measured 2026-11-09 at HEAD `6f2cf849c` (the 0166 remediation program's step 070, ruling 0230). The cut's own acts are not here — **the maintainer cuts it** (0110 D14); this section prepares, the program's step 081 (release-assessment) hands the material over, and tagging, cut and publication happen only on the maintainer's explicit instruction.

- **The census**: 105 rulings open against the next release — the INDEX census (`grep -c "ships with the next release" plans/INDEX.md` → 105, at the HEAD above) counts rows spanning 0125–0229; v0.3.0 closed 0112–0124. A dated snapshot, never a live count: the 0166 program's remaining steps (071–079) land further rulings and INDEX rows before the cut, and the cut ships the corpus as it then stands — the cut re-measures at its own moment.
- **The programs**: the 0155–0160 ruled program completed 2026-10-30 (the trigger's first firing); the 0166 remediation program is in flight — this reconciliation a step inside it — its remaining rulings shipping in the same cut.
- **The gate**: the 0165 review's release-readiness condition — "should not ship before W1 and W6 land" — is green: W1 (person marks, step 009) and W6 (git boundary, steps 013/015) both landed, both fixed in the program's ledger; step 081 re-checks the gate at its own moment.
- **The tag decision riding the cut**: the v0.3.0 tag remains the maintainer's explicitly instructed act (0165-178/F13's disposition, step 008) — the maintainer tags `07036c2b5` as v0.3.0, or the tag rides the next explicitly instructed cut alongside it.
- **The register restated — the principle-delta draft**: the mid-cycle amendment register above carries five rows — 0146, 0166 step 006, 0221, 0225, 0226 — restated here as the principle-delta draft the next release section absorbs at the cut. The five are the constitution-edit census since v0.3.0 complete (`git log --oneline 07036c2b5..HEAD -- packages/auto-core/docs/principles.md` → `7401fe7b5` 0146, `c4fb131f7` step 006, `be3daccb1` 0221, `39095aee6` 0225, `696966685` 0226): 0221's P15 amendment pre-dated the register and its row below is added retroactively, 0146's precedent. The register's own rule stands (0225 D6): rows are consumed into the next release section's principle deltas at the cut, clearing the register; rows from the remaining program steps (0231+) append as they land and join the draft then. The consumption is prepared here, never enacted.
- **The assessment material for step 081** (the cut's draft input, the 0165 review's §release-audit the named input): the per-release audit duty above, both items, run at the cut over the cut-moment corpus — the traceability chain both directions (rule→principle: orphans and gaps; principle→code: divergences) and the falsification replay under 0225 D7's stated method (never inside the repository; the blind child in an isolated directory holding the amended `docs/principles.md` alone, questions neutrally phrased, plans closed — the v0.3.0 replay's recorded confirmation stands as recorded); the family-consistency check with S02-01's lapse recorded (22 requirement-bearing rulings — 0142–0161, 0163, 0164 — carry no Category scope section; the cut's audit records the lapse, the 0166 program's rulings resumed the section); the breaking-change determination (pre-1.0, in words) over its candidate list — the practiced tombstones (0137's flag, 0138's ignore-set members, 0133's retired forms, 0150 D2's registry refusal — S02-03's impact note) and the 0166 program's behavior-changing rulings (0169–0229), each already ruled a defect fix in its own ruling; and the release-section parts' sources in v0.3.0's own shape (principles deltas from the register plus any Tier amendments the open corpus carries — measured at the cut; Tier II default changes; mechanisms added/retired; ruled defect fixes; tombstones; re-keyed surfaces; findings disposition, F9–F22 with the 0165 register's dispositions at the cut-moment program state; version practice).

**The not-cut boundary** (this section's own law): preparation, never the cut — the version spine unmoved, the principles.md stamp unchanged, the register not cleared, no release section written; those acts are the cut's own, at the maintainer's explicit instruction.

---

## v0.1.0 — 2026-10-21 — the design constitution established

The plans/0110 design-principles distillation lands: the constitution layer `docs/principles.md`, the corpus manifest `plans/INDEX.md`, the derivation discipline (`Derives:`/`Amends:` plus the tier touched, on every future ruling), the tiered rule space, requirements governance, and this release framework. The trigger: a boundary question answered as a new rule when it derived from a principle the documentation never held.

**Principles deltas — the constitution established.**

- **Tier I (six):** P1 the deliverable stands alone; P2 the person brackets every boundary; P3 completion is never judged by agent self-report; P4 committing is the completion condition (contract-grade); P7 the driver judges grammars it defines, never the meaning of content (fence-grade); P18 the record outlives the tool.
- **Tier II (twelve):** P5 single ownership (absorbing P11); P6 derived state, idempotence, re-derivation; P8 deliberate enforcement moments; P10 the byte-identical floor; P12 fail loud, conservative under uncertainty; P13 frozen additive-only vocabularies; P14 one-way dependencies through declared seams; P15 policy is data, governance pinned; P16 restated as genericity alone; P17 declared concurrency; P19 measured evidence; P20 in-flight work is never destroyed.

**Tombstones** (ids never reused):

- **P9 — demoted** to the counts-not-lists presentation convention: a concrete requirement living on its surfaces, not in the constitution.
- **P11 — folded into P5**: one ownership principle, two scopes (state, mechanism).
- **P16's secrets half — demoted** to the security requirement family; the AGENTS.md invariants keep carrying it.

**Mechanisms added/retired: none.** A documentation-layer release — zero code change. That is the point: this release changes what the design says, not what the tool does.

**Re-keyed surfaces.** New: `docs/principles.md`, `docs/releases.md`, `plans/INDEX.md`. Re-keyed: `docs/glossary.md`, `docs/structure.md`, `AGENTS.md`. Every `plans/NNNN-*` original byte-untouched.

**Falsification replay.** The D9 replay — the triggering process-refs question and the 0103-addendum-two / 0109 rulings answered from `docs/principles.md` alone, plans closed — runs at stage 7 immediately after this file lands; its confirmation is recorded in plans/0110's Execution record.

**Findings disposition.** F1–F8 recorded as follow-up work items in plans/0110's Execution record, each awaiting its own later ruling: F1 "no speculative machinery" and F2 "refactor invariance" (missing-principle candidates); F3 development-process rules (home question); F4 security-boundary disclaimer; F5 shell-side auth posture (the shells' own docs); F6 demotion confirmations (no action); F7/F8 symbol-attribution corrections (already applied in the landed principles.md).

**Version practice.** Documentation-layer in this release: the package version stays untouched; the `v0.1.0` git tag was cut by the maintainer later the same day (2026-10-21), pointing at this release's commit.

## v0.2.0 — 2026-10-21 — the audit-findings ruling round

The plans/0111 audit-findings ruling round lands: the 0110 stage-4/5 audit findings F1–F5 presented with their admission cases, ruled by the maintainer at the checkpoint, and dispositioned. A minor release — a Tier II principle admitted and requirement-family framing added; no Tier I change, no contract change, no mechanism.

**Principles deltas.**

- **Tier II +1 (thirteen):** **P21 — machinery waits for its consumer** (F1, admitted as drafted): interfaces, generality and mechanisms are built when a real consumer locks the shape; until then a reserved surface is a name, never a half-built mechanism; speculative generality is recorded as cost, never accrued silently. Evidence: 0031 D4, 0034 D2, 0036, 0046 D9, 0044 D6 — the family flagged independently by two 0110 stage-4 audit children; the drafting's own correction rides the landing (0044 D6 reassigned from the development-convention family to P21's evidence).
- **Requirement families +the boundary disclaimer** (F4, adopted as drafted): the driver's protections and driver-run scripts are accidental-write guardrails and convenience stops, not security boundaries; where a hard security property is required it is stated as a requirement, never assumed from a guardrail (0007 T-016, 0009 §D).
- **Declined from the constitution** (F2): "refactor invariance" — pure moves proven behavior-preserving by byte-identical goldens. It fails both tier tests: removal changes how this *repository* is changed, not how the *tool* runs. Homed as the first line of the development conventions (below).

**Tombstones: none.**

**Mechanisms added/retired: none.** A documentation-layer release again — zero code change.

**Development conventions homed (F3).** AGENTS.md gains "Development conventions (this repository's own build rules)": behavior-preserving changes prove themselves under byte-identical goldens and pinned outputs; one ingredient per change during relocations; stage-assist waves always-green per session — plus the dispositions carried by their own documents (0035's flip-program batching, 0030 D13's naming split, 0052's CLI factoring heuristics). `docs/principles.md`'s How-to-rule gains the scope sentence: repository-development rules live in AGENTS.md, kept out of the constitution by the tier test. **F5 routed:** 0067 §8's shell-side operational security posture (daemon allowlist, token auth, loopback default, POST-not-GET probe) lives with the shell packages' own docs at their next snapshot refresh; the core's constitution stays deliberately silent (P14's seam).

**Re-keyed surfaces.** Amended: `docs/principles.md` (P21, the boundary disclaimer, the scope sentence, the stamp → v0.2.0), `docs/releases.md` (this section), `plans/INDEX.md` (the post-baseline section with the 0110 and 0111 rows — 0110's missing row the standing correction, its rulings shipping with v0.1.0), `docs/glossary.md` (the principle-id row widens to P21, Tier II thirteen), `AGENTS.md` (the P21 summary line; the development-conventions subsection). Every `plans/NNNN-*` original untouched.

**Falsification replay.** The round's replay — the reserve-or-build question (0046 D9) and the eager-cleanup question (0044 D6) answered from the amended constitution alone, plans closed — runs at stage 3 immediately after the landing; its confirmation is recorded in plans/0111's Execution record.

**Findings disposition — F1–F5 closed with their rulings** (completing the 0110 audit findings; F6–F8 were closed inside 0110):

- **F1 — admitted as P21** (Tier II, the thirteenth operating principle), full drafted text as approved.
- **F2 — declined from the constitution** (fails both tier tests); the substance lives as the development conventions' first line.
- **F3 — the named home adopted**: the AGENTS.md development-conventions subsection + the principles.md scope sentence as drafted.
- **F4 — adopted**: the boundary-disclaimer sentence, beside the secrets family.
- **F5 — routed**: the shells' own docs at their next snapshot refresh; core unchanged.

**Version practice.** Documentation-layer: package version untouched; the `v0.2.0` git tag was cut by the maintainer on 2026-10-21, pointing at this release's commit (the `v0.1.0` tag likewise, at the constitution-landing commit).

## v0.3.0 — 2026-10-25 — the intake amendment and thirteen ruled programs

Thirteen rulings since v0.2.0 ship together. A minor release — new opt-in mechanisms and Tier II default changes in the set; **no Tier I amendment, no breaking contract change** (the determination below, said so in words per the pre-1.0 clause). The release's own center: the governance amendment plans/0123 ruled 2026-10-25 from the measured aftermath of plans/0120 (a principled ruling enacted surface-enumerated), its constitution half gated to this cut by the change-control rule.

**Principles deltas.** No P-id added, demoted or merged. **Tier II amendment (How to rule):** the section gains **the category scope** (0123) — a requirement enters through its family; every requirement-bearing ruling carries a Category scope section (the family named, the home-set enumerated at ruling time, each home changed/held/deferred with reason, written before the enactment; a proper-subset enactment of its own enumeration an audit finding at the next release). The operative intake procedure lives in AGENTS.md's development conventions (this repository's layer, landed with the ruling); the stamp moves to v0.3.0.

**Tier II default changes.**

- **0113** — `OPENCODE_AUTO_PLAN_VERIFY` default off (previously on); when on, it rides the deep `phase-plan` route only, never the classifier entry.
- **0114** — a covered round never reads config `phases`: under a released roadmap the reshape channel is the roadmap line alone (the grammar's split home `src/roadmap.ts`).

**Mechanisms added.**

- **0115** — the round-brief proposal channel: a released `### R-NN` subsection under `## Round briefs` of `docs/analysis.md` installs verbatim as the round's round.md; a hand-written round.md never clobbered (`src/round-brief.ts` + `src/analysis.ts`).
- **0116** — the clarify command: the person's release act as one command (`clarifyGate` writes the whole-line `Clarified: yes`, the release commit `Auto-Stage: clarify`, the refusal matrix; flagless) (`src/clarify.ts` + the shell's row).
- **0117 / 0118** — the manual suite's `single` run mode (the no-child-platform shape: whole-session wall, self-verification) and the notification wait (a running child's output never read, the wall keyed to clock arithmetic) (`prompts/`).
- **0122** — the root-symlink external_directory allows: init stamps, fix keeps them in sync, stale entries report-only; no root symlinks is the byte-identical floor (`src/external-dirs.ts`).
- **0112** — the general shell's docs refresh, F5's landing (constitution-family pointers in the shell AGENTS.md; the README's consolidated security-posture section) — the shell package, no core change.

**Ruled defect fixes.**

- **0119** — the destination scan reads git's modified view (ruled from the cleanroom OOM: the run of driver commits back from HEAD plus the uncommitted state; 0108's every-tracked-line derivation retired, its destination scoping standing).
- **0120 + 0124** — the report reservation and the phase-document contract: `report.md` is the verification child's alone, every task deliverable carrying its own name; the declared grammar completed (`Task-artifacts:` declarations, the packs and session templates deferring, the registry guarded) — 0124 closing the category-incomplete leftovers of 0120, the very incident 0123 was ruled from.

**Data.** **0121** — the cleanroom bundle's compliance gates: the driver-side divergence lane, the two audit dimensions (paradigm conformance, contract coverage), the source-free remediation diet, the lane table's comments-only floor (`templates/bundles/cleanroom/`; materialized targets through `sync`).

**Tombstones: none.**

**Breaking-change determination (pre-1.0, in words).** Candidates examined: 0113's default flip (a switch default, floor-preserving — the off state is the historical floor); 0114's supersession (conditional on a released roadmap; the config key remains valid, un-read in the covered state); 0119's derivation change (a ruled defect fix; the scan's contract — person-committed content never the migration's ledger — unchanged). **None is a breaking contract change.**

**Re-keyed surfaces.** Amended: `docs/principles.md` (the category-scope paragraph, the stamp → v0.3.0), `docs/releases.md` (this section), `plans/INDEX.md` (the thirteen cells close with v0.3.0), `docs/glossary.md` (the 类别范围 / Category scope row). Every `plans/NNNN-*` original untouched.

**Traceability audit.** No new principles; rule→principle: the thirteen rows carry their P-ids, code homes and test homes (verified at each landing); principle→code: unchanged since v0.2.0 beyond the mechanisms above, each named in its ruling. **The family-consistency check (0123 D3, first application — post-0123 rulings = 0124 alone): passed** — 0124's Category scope table enumerates sixteen homes, each changed or explicitly held in its landing commit (`1f47b31a1`).

**Falsification replay — passed.** Run at the cut (2026-10-25) by a fresh child holding the amended `docs/principles.md` alone, plans closed: Q1 (the category-defect shape — a ruling enacted on three of nine family surfaces) answered as the category-scope defect under P5 (surfaces teaching against each other, dual homes drift) and P19 (acting on an unenumerated subset is ruling without measurement), caught at the next release's principle→code audit, prevented by the Category scope section written before the enactment — 0123's ruling reproduced. Q2 (the work session writing findings into the verifier's report file) answered under P3 (the verdict's author must be the fresh-eyes session; a work session writing the verdict's home risks the Result line riding the worker's narrative) and P5 (one home one writer; dual writers race), the remedy each writer its own home, deliverables carrying their own names — 0120's ruling reproduced. The amendment disturbed no pre-existing derivation.

**Findings disposition.** None new. F1–F8 remain closed (v0.1.0/v0.2.0); **F5 fully consumed** — 0112 is the routed landing the v0.2.0 record named. The family-consistency check accrues with future rulings from this release forward.

**Tag anchor — recorded missing 2026-11-05 (0165's audit, 0165-178/F13).** The v0.3.0 git tag was never created (`git tag -l`: v0.1.0, v0.2.0). The cut commit `07036c2b5` (2026-10-25) is the anchor its own message names — "the v0.3.0 git tag the maintainer's act at this commit, as with v0.1.0 and v0.2.0". Disposition (0166 step 008): the tag stays the maintainer's explicitly instructed act, never a worker's — the maintainer tags `07036c2b5` as v0.3.0, or the tag rides the next explicitly instructed cut alongside it.

**Version practice.** Documentation-layer record; the package version stays untouched (the spine is the design axis); the `v0.3.0` git tag is the maintainer's act at this release's commit, as with v0.1.0 and v0.2.0.
