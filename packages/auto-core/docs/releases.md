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

**Version practice.** Documentation-layer in this release: no git tag is cut and the package version stays untouched; the maintainer may tag later.
