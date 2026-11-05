# Releases — the design changelog

The maintained release record of the design: one section per release, recording what the constitution said at each point in time and what changed and why. Git history stays the code audit trail (P18) — commits prove what changed in bytes; this file records what changed in **design**: principles established, amended, merged or demoted (with P-ids and tiers), mechanisms added or retired (with `plans/NNNN` pointers), vocabularies tombstoned, the falsification-replay confirmation, and the audit findings' disposition. Code detail, per-commit narration, and anything git already proves do not belong here.

A release is cut when a ruled program completes; **the maintainer cuts it**. Between releases, audit findings accumulate — a release event is the only moment the constitution (Tier I) or a Tier II default changes. The framework is documentation-layer: the release section itself is the record, no tooling implied.

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
- **Deprecation lifecycle.** Retiring a mechanism or vocabulary: **tombstone → one release of visible warning → removal in a named later release.** P13's additive-only discipline on the version axis — no silent dual meanings, no unversioned breaks. Detection during the warning release records; it does not gate (P8).

## The per-release audit duty

Each release section stands on two audits, both recorded in it:

1. **The traceability chain, both directions** — positioning → Tier I → Tier II → concrete requirement → code home → test home, audited rule→principle (orphans, gaps) and principle→code (divergences). Findings are numbered, append-only, and dispositioned in the release that closes them.
2. **The falsification replay** — the constitution must answer real, already-ruled questions with the plans closed; the answers come out the same, or the principle set returns to synthesis — never to the ruling.

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
