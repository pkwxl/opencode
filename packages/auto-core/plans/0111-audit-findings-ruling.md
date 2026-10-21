# 0111 — The audit-findings ruling round: F1–F5 from the 0110 audits

Status: **executed 2026-10-21 — F1–F5 ruled at the checkpoint (all as recommended), landed, v0.2.0 cut; the replay passed.** This round Derives: **P19** (the evidence rule — every admission case below carries its citations, all from the stage-4 audit flags) and the constitution's **change-control clause** (findings accumulate between releases; a release event the only moment the constitution or a Tier II default changes). Tier touched: **Tier II** (the P21 admission proposed), the **requirement families** (F4), **development conventions** (F2/F3 — outside the constitution by the tier test); **no Tier I or contract change is proposed.** The trigger: 0110's Execution record holds findings F1–F5 as open follow-up work items, each awaiting its own later ruling — this is that ruling.

## 0. What this round is

The 0110 audits closed F6–F8 (the demotions confirmed holding; the two symbol-attribution slips corrected into the landed constitution). Five findings remain open. Each is presented below with its evidence, the admission case, the alternatives, and a recommendation; the maintainer rules at the checkpoint; the landing then follows the ruled path. Two standing corrections ride the landing whichever path is taken (§4).

## 1. F1 — recommend ADMIT as P21 (Tier II): machinery waits for its consumer

**The finding.** Flagged independently by two stage-4 audit children over different batches: a recurring family defers interfaces, reserved surfaces and generality until a real consumer locks the shape. P19 governs the *evidence* for decisions, not *restraint on construction* — the set lacks the restraint half.

**The evidence** (all from the audit flags, citations carried):

- 0031 D4 — the intent-pack schema landed with the loader left unwired; wiring waited for 0032's real consumer.
- 0034 D2 — the artifact spec's anchor aliases tightened when the first consumer tripped: the pre-consumer shape was a guess, and the guess bent.
- 0036 — composition deferred until a second consumer existed.
- 0046 D9 — `--max-sessions` reserved inert above 1: a *name* reserved, zero behavior built.
- 0044 D6 — retired-mechanism cleanup left in place ("cleanup code would outlive its purpose") — cleanup machinery is still machinery, and its consumer had not arrived. *(Reassigned here from F3's family at drafting: it is this principle's case, not a development convention.)*

**The tier test.** Removal degrades how the tool runs — guessed shapes, maintained-but-consumerless surfaces — without breaking a positioning clause: Tier II. It reinforces a fence (speculative machinery is how platforms accrete — "not a platform") without being the fence itself.

**The proposed principle text** (approvable as drafted, checkpoint-2b style):

> ### P21 — Machinery waits for its consumer
>
> **Statement.** Interfaces, generality and mechanisms are built when a real consumer locks the shape; until then a reserved surface is a name, never a half-built mechanism; speculative generality is recorded as cost, never accrued silently.
>
> **Rationale.** Machinery built ahead of its consumer guesses the shape and then defends it; the consumer arrives, the guess bends, and the bending costs more than the waiting did (0034 D2's first-consumer amendment; 0046 D9's inert reservation).
>
> **Derivations.** The unwired loader (0031 D4 → 0032); the first-consumer amendment (0034 D2); composition deferred to the second consumer (0036); reserved-inert names (`--max-sessions`, 0046 D9); deferred cleanup of retired mechanisms (0044 D6); trigger-gated non-builds (0063's Rust deferral — the triggers are the consumer's stand-in). Homes: review-held like P19 (the principle rules at design time); its surfaces are the reservation sites — `src/config.ts` (the key set), the shells' command surfaces, `src/intent/load.ts` (the loader seam 0031 D4 deferred).
>
> **Provenance.** First stated as a family by 0110's stage-4 audit (two children independently); the family's earliest ruling is 0031 D4.
>
> **Known tensions.** Waiting serializes a second consumer's work — the 0036 deferral ended exactly when that wait was paid; the reserved name covers the *certainty* of a consumer, the machinery still waits for its *shape*. A pre-emptive mechanism, like a pre-emptive rule, needs its own evidence (P19 §11.10's extension).
>
> **Choice.** Wait for the consumer versus build ahead. **Chosen default.** Wait; reserve names inertly at most; speculative generality recorded as cost. **Revisit trigger.** A field case where the wait measurably serializes two consumers' work — then build to the named consumer, still not to the guess.

**If declined.** F1 closes as a finding with the reason recorded; nothing else changes.

## 2. F2 — recommend DECLINE from the constitution; home with F3

"Refactor invariance" — pure moves proven behavior-preserving by byte-identical goldens and pinned strings (0032 F9, 0034 D4, 0102's blanket rule). It fails both tier tests: removal changes how this *repository is changed*, not how the *tool runs* — it is change-management discipline, not an operating principle. Nearest homes P10/P19 genuinely do not fit (runtime floors; decision evidence). **Recommendation: decline from the constitution; it becomes the first line of F3's development-conventions home.** The counter-case (admit as Tier II) is available if the maintainer sees it as tool-behavior — the drafting does not.

## 3. F3 — recommend the named home: AGENTS.md development conventions, with a scope note in principles.md

**The finding.** A family of rules governs how THIS repository is built — confirm-before-commit and always-green per session (0010/0011), pure-relocation one-ingredient-per-move (0024), the flip-program batching (0035), the AI-facing naming split (0030 D13), CLI command-factoring heuristics (0052). The constitution governs the tool's behavior contract; these have no home and must not be silently absorbed upward (R4, constitution creep).

**The proposed home.** A short subsection in AGENTS.md — the file every coding agent working here reads — plus one scope sentence in principles.md's How-to-rule section. Drafted:

> **AGENTS.md → Core invariants → "Development conventions (this repository's own build rules)":**
> - Behavior-preserving changes prove themselves: pure moves, splits and dedups run under byte-identical goldens and pinned outputs (0032 F9, 0034 D4, 0102). *(F2 lands here.)*
> - One ingredient per change during relocations — no dedup mid-move; every step ends green and interruptible (0024).
> - Stage-assist waves run always-green per session; the person commits at command boundaries (0010/0011's convention, standing as this corpus's practice).
>
> **Dispositions, no home needed:** the flip-program batching (0035) died with its program (closed 2026-09-28); the naming split (0030 D13) is presentation, carried by its own document; the CLI factoring heuristics (0052) are design rationale, carried by 0052.
>
> **principles.md → How to rule, one sentence:** Rules governing this repository's own development — not the tool's behavior contract — live in AGENTS.md's development conventions; the tier test keeps them out of the constitution.

## 4. F4 — recommend ADOPT the security-boundary framing sentence

**The finding.** 0007 T-016 and 0009 §D position protections and driver-run scripts as accidental-write guardrails / convenience trade-offs, **not security boundaries** — a recurring stance with no home; candidate framing beside the security requirement family.

**The proposed sentence** (added to principles.md's Tombstones-and-requirement-families section, beside the secrets family):

> **The boundary disclaimer** — the driver's protections and driver-run scripts are accidental-write guardrails and convenience stops, not security boundaries (0007 T-016, 0009 §D); where a hard security property is required it is stated as a requirement (the secrets family above), never assumed from a guardrail.

A constitution text change: rides a release (§6).

## 5. F5 — recommend ROUTE to the shells' own docs; core unchanged

0067 §8's shell-side operational security posture (daemon allowlist, token auth, loopback default, POST-not-GET probe) lives with the shell packages per P14's seam — the core's constitution is deliberately silent. **Recommendation: record the routing here; the work itself rides the shells' next snapshot refresh.** No core change.

## 6. The release fork

Per the change-control clause, a constitution change needs a release event:

- **If F1 and/or F4 is approved → cut v0.2.0 (minor: a Tier II principle added and/or requirement-family framing; no Tier I change, no contract change, no mechanism).** Lands: principles.md gains P21 and/or the disclaimer sentence, stamp → v0.2.0; releases.md gains the v0.2.0 section (deltas, tombstones none, findings disposition: F1–F5 closed with their rulings); INDEX gains rows for **0110** and **0111** (see §7); glossary's principle-id row widens to P21; AGENTS.md's principle summary gains the P21 line (Tier II → thirteen) and, if F3 approved, the development-conventions subsection.
- **If everything is declined → no release.** F1–F5 close in this document's record; INDEX gains the §7 rows; nothing else moves.

**Two standing corrections riding the landing either way (the drafting's own audit of the landed state):**

1. **0110's row is missing from INDEX.** The corpus table baselines 0001–0109, and 0110 — which created the framework — landed in the same change as INDEX without its own row. Its row ships with release **v0.1.0**: *0110-design-principles-distillation | the constitution, INDEX, the derivation discipline, the release framework | active-authority | (all — the document that established the set) | docs/principles.md, plans/INDEX.md, docs/releases.md | v0.1.0*.
2. **0111's own row** lands with this document's execution (release: v0.2.0 if the fork is taken; otherwise the cell reads *(open — ships with the next release)*).

## 7. The falsification replay for this round (runs if P21 is admitted)

From the amended constitution alone, plans closed: *"A consumer asks for a configuration surface they will 'need soon' — no consumer exists today. Build it, reserve it, or decline it? And the retired mechanism's eager cleanup — build the cleanup now?"* The answers must come out as 0046 D9 (reserve the name inertly, build nothing) and 0044 D6 (defer the cleanup machinery) — P21's statement, default and tension clause answering both.

## 8. Checkpoint questions

1. **F1**: admit P21 as drafted (Tier II, the full text above) — approve / approve with edits / decline?
2. **F2**: decline from the constitution and home with the development conventions — confirm? (The admit-as-Tier-II counter-case is available.)
3. **F3**: the AGENTS.md development-conventions subsection + the principles.md scope sentence as drafted — approve / adjust? Any convention the maintainer knows to be dead that the draft calls standing, or standing it calls dead?
4. **F4**: the boundary-disclaimer sentence as drafted — approve / adjust / decline?
5. **F5**: route to the shells' docs at their next refresh, core unchanged — confirm?
6. **The release fork**: cut v0.2.0 with whatever lands (recommended if anything lands) / land without a release (only if everything is declined)?
7. *(No ruling needed — noted for the record: the v0.1.0 git tag remains open and independent; the §7 INDEX corrections ride the landing either way.)*

## 9. Execution stages

1. **CHECKPOINT** — this document presented; proceeding requires the journal's approval line below (the D10 person gate transposed: an absent or unparseable line reads *awaiting review*, never *approved*).
2. **Land per the rulings** — one file at a time: principles.md → releases.md (if the fork) → INDEX (rows + the 0110 correction) → glossary → AGENTS.md; journal line per file.
3. **Replay** (if P21 admitted) — §7's questions from the amended constitution alone; a miss returns the set to drafting, never to the ruling.
4. **Verify** — `bun typecheck`; the full suite unchanged; every `plans/NNNN-*` original untouched (0111 is new; the ruled targets the only edits).
5. **Journal + commit at the maintainer's direction.**

*Resume: journal + `git diff` name the remaining work; stages 2–4 freely re-runnable; the checkpoint gate un-passable without the approval line.*

## Execution record

- 2026-10-21 — drafted: the five findings presented with admission cases and recommendations (F1 admit as P21 Tier II; F2 decline → development conventions; F3 the AGENTS.md home + scope note; F4 adopt the disclaimer sentence; F5 route to the shells), the release fork (v0.2.0 if anything lands), the two standing INDEX corrections (0110's missing row; 0111's row), and the round's replay. **CHECKPOINT: awaiting the maintainer's rulings — stages 2–5 held.**
- 2026-10-21 — **CHECKPOINT RULED (the approval line).** On the maintainer's direction "Execute plans/0111-audit-findings-ruling.md", the checkpoint questions were presented and the maintainer ruled, all answers as recommended: **F1 — Admit as drafted** (P21 lands in principles.md, full drafted text, Tier II, the thirteenth); **F2+F3 — Confirm both as drafted** ("refactor invariance" declined from the constitution; the AGENTS.md development-conventions subsection + the principles.md How-to-rule scope sentence land; the 0035/0030-D13/0052 dispositions stand); **F4 — adopted** (the boundary-disclaimer sentence lands beside the secrets family); **F5 — adopted** (the shell-side routing recorded here, the shells' docs at their next snapshot refresh, core unchanged); **release fork — v0.2.0 cut** (minor: a Tier II principle added and requirement-family framing; no Tier I change, no contract change, no mechanism). Stages 2–5 proceed.
- 2026-10-21 — **stage 2, landed per the rulings**, one file at a time in the plan's order:
  - **docs/principles.md** — P21 admitted, the full drafted text (one landing correction: the tensions clause's citation "(P19 §11.10's extension)" landed as "(0057 §11.10; P19's tensions)" — §11.10 is 0057's section, P19's tensions the carrier; the drafted compression did not resolve); the boundary disclaimer beside the secrets family (F4, verbatim); the repository-development scope sentence in How to rule (F3, the drafted sentence under a bold lead-in matching the section's style); the counts twelve → thirteen (intro + the §II preamble); the stamp → v0.2.0.
  - **docs/releases.md** — the v0.2.0 section: principles deltas (P21 +1 → thirteen; the disclaimer; the F2 decline with both tier-test reasons), tombstones none, mechanisms none (documentation-layer again), the F3 home + the F5 routing, the re-keyed surfaces (including the two standing INDEX corrections named), the replay note, the findings disposition F1–F5 (completing 0110's, F6–F8 closed inside 0110), version practice (no tag, package version untouched).
  - **plans/INDEX.md** — the post-baseline section (0110–) with the 0110 row (standing correction 1: the document that created the framework, its rulings ship with v0.1.0) and the 0111 row (release v0.2.0); the intro widened from "the 108 numbered design documents 0001–0109" to the pre-constitution corpus plus the post-baseline documents ruled under the constitution.
  - **docs/glossary.md** — the principle-id row P1–P20 → P1–P21; the tier row Tier II twelve → thirteen.
  - **AGENTS.md** — the P21 summary line (one compressed line, Tier II); the development-conventions subsection under Core invariants (the three drafted lines + the dispositions line; the drafted "*(F2 lands here.)*" marker dropped — the landed first line IS where F2 lands, and the lead-in carries the plans/0111 pointer).
- 2026-10-21 — **stage 3, the falsification replay PASSED.** A child holding `docs/principles.md` alone, plans closed, answered §7's two questions. Q1 (the reserve-or-build question): decline to build, reserve the name inertly at most — P21's chosen default doing the arbitration, the tension clause ("the reserved name covers the *certainty* of a consumer, the machinery still waits for its *shape*") and P19's "speculation is not a basis" closing the "need soon" door; the same ruling as 0046 D9. Q2 (the eager-cleanup question): do not build the cleanup machinery now — it is itself a mechanism waiting for its consumer, P21's statement doing the work with its own derivations row (0044 D6) as the in-document precedent, P13's deprecation lifecycle and P10's scheduled audits naming cleanup's real moment; the same ruling as 0044 D6. Both answers came from P21's statement / chosen default / tension as §7 required; the set does not return to drafting.
- 2026-10-21 — **stage 4, verification.** `bun typecheck` clean; the full suite **2693 pass / 0 fail across 145 files** (18017 expect() calls), identical to the pre-initiative baseline; `git diff --name-only` names exactly the six ruled targets — docs/principles.md, docs/releases.md, plans/INDEX.md, docs/glossary.md, AGENTS.md and this document — zero src change, every other `plans/NNNN-*` original byte-untouched, shells untouched.
- 2026-10-21 — **executed.** F1–F5 closed with their rulings (completing 0110's audit findings: F6–F8 were closed inside 0110): P21 admitted (Tier II, the thirteenth operating principle, the full drafted text with the one citation correction journaled above); the boundary disclaimer adopted beside the secrets family; "refactor invariance" declined and the development conventions homed (AGENTS.md subsection + the principles.md scope sentence); the shell-side auth posture routed to the shells' docs at their next snapshot refresh. **Release v0.2.0 cut** — documentation-layer, the stamp moved, the section landed, the version spine untouched in code (no git tag, package version 0.0.0; both the v0.1.0 and v0.2.0 tags remain the maintainer's to cut). The two standing INDEX corrections shipped: 0110's row (release v0.1.0) and 0111's own row (release v0.2.0) in the new post-baseline section. The round's landing corrections, all journaled at their files: the P21 tensions citation, the dropped "*(F2 lands here.)*" marker, the AGENTS.md lead-in's plans/0111 pointer.
