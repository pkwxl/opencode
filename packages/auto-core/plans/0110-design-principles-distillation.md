# 0110 — The design-principles distillation: the constitution layer, the corpus index, and the derivation discipline

Status: **executing since 2026-10-21 — stage 2 presented: the draft principle set (`plans/.0110-work/principles-draft.md`) awaits the maintainer's rulings at the checkpoint; stages 3–7 held (see Execution record).** The trigger, verbatim: *"we should examine its design and implementation from a systemic perspective rather than piecemeal recording so many rules … what the underlying design principles of these rules are and whether they are consistent — they ought to be derivable."* The immediate occasion: a boundary question was answered as if it were a new rule when it was a derivation from an existing principle the documentation never holds. Three scoping rulings were taken the same day (recorded in D6/D7/D8). This document is the execution plan; landing it changes no file but this one.

## 0. The diagnosis (measured 2026-10-21, not asserted)

The corpus: **108 numbered documents, 26,804 lines, ~3.07 MB**, numbering 0001–0109 continuous except 0028 (deliberately deleted with its content absorbed — commit `aca18dab1`; residual references survive in `plans/0035-protocol-string-registry.md`). There is **no index, manifest, or README of any kind** in `plans/`. Formats evolved through three eras (early "Confirmed Decisions" numbered lists → middle `§`-sections with P-n person rulings → recent `## Dn` decision sections under a `## The ruling` narrative), so extraction cannot assume one grammar. Cross-referencing is heavy — 63 files cite other plans by path, 24 carry supersession language — but supersession is recorded inconsistently: a `Status:` line, a strikethrough, a dated correction note, or nothing.

The proof the layer is missing is one rule's lineage. P1 — *the shipped artifact stands alone* — was stated exactly once, in 0036 §4.1 (2026-09-21: "the target code has to stand alone once the process documents are gone"), then adopted by a root plan (`plans/AUTO_NEXT_REFACTOR_PLAN.md`) that **no longer exists on disk or in git history**, reconstructable only through 0045 line 15's citation of it. It was then re-derived **five times in three days**: 0103 first ruling (scope — destination only), 0103's in-file addendum (timing — record during rounds, enforce at release), 0106 (remedy — restate, never delete the record), 0108 (structural definition — deliverable = what a nested repo's git manages), 0103's addendum two (unification — release the single enforcement moment), 0109 (presentation — counts, not lists). Both documented drift points — 0045's "working tree as deliverable" reading and 0103's process-path carve-out — were **codifications narrower than the ruling they recorded**, each corrected only when a third field project tripped on it. That is the accretion pattern: the principle exists; nothing holds it; every incident re-derives a clause and writes it as a new rule.

Principle-bearing content today lives in four places, all entangled with mechanism detail: AGENTS.md's Core invariants (7 bolded, mixed general and piecemeal), `docs/structure.md` responsibility cells (rulings and dates embedded per row), src file headers (the declared "first carrier of design", heavily loaded with plans pointers), and the plans themselves. AGENTS.md's Navigation section alone carries 65 bullet lines totaling ~69k characters of ruling history. Meanwhile AGENTS.md already declares that `docs/` holds "durable overall architecture, **design principles**, and code-location indexes" — the principles layer is **promised by the documentation system and does not exist**.

## 1. The goal

Rationale lookup becomes **principle → mechanism → code**, never a search across the corpus. A question raised at a boundary is answered by derivation from the principle set; a ruling that cannot be derived is recognized as either a principle amendment or a mistake — never silently absorbed as "a new rule". The constitution is small enough to hold, general enough to generate the rule families, and honest about its tensions.

## D1 — `docs/principles.md`: the constitution layer

The durable design constitution, in `docs/` beside structure/shell-contract/glossary. Principle ids **continue the established P-numbering**: today's P1 ("process documents are not design dependencies" — the shipped artifact stands alone) keeps its name and identity; the distillation adds P2..PN. Target ≤ ~20 — the count is an output of the combing, never a quota; if the corpus generates thirty, the synthesis reports thirty and says why.

Each principle carries five parts:

- **Statement** — one general sentence.
- **Rationale** — why it exists, from what failure class.
- **Derivations** — the rule families it generates today, each with its code home and the plans pointer of the family's first ruling. The derivations section is what makes the principle *falsifiable*: a rule that claims the principle must appear here or the claim is wrong.
- **Provenance** — the first ruling that stated it and the incident that provoked it.
- **Known tensions** — where it bends and which principle it trades against (e.g. record-don't-block trades against fail-closed; the manual suite's stricter line trades P1 against "no release gate stands behind an agent-driven run").

The worked example that proves the format before any combing runs — P1's five clause-derivations: scope (0103 first ruling), timing (0103 second ruling), remedy (0106), structural definition (0108), presentation (0109). One principle sentence generates the whole family; the six documents are its case law, not six rules.

## D2 — `plans/INDEX.md`: the corpus manifest

The one **maintained** file in `plans/` — the corpus's front door. (The "retired once obsolete, never maintained" convention governs the numbered historical documents themselves, not the map over them.) One row per document:

`NNNN-slug | what it ruled (one line) | status | principle assignment | code homes`

Status is exactly one of: **active authority** (its rulings still govern), **superseded-by NNNN** (a later document re-ruled it, pointer given), **historical-only** (retirement banner / stage-assist record). Principle assignment names the P-ids its rulings derive from — this is the rule→principle half of the audit (D6) made durable. Two anomalies get their own rows: 0028's deliberate deletion (with the commit and the residual references), and the absent root plan `AUTO_NEXT_REFACTOR_PLAN.md` (cited by 0045 line 15, present in neither disk nor git history — the lineage gap that motivates the index). **Originals stay byte-untouched** (the maintainer's ruling, D8).

## D3 — AGENTS.md re-keyed

- **Navigation** slims to module → responsibility → key files plus pointers into `docs/principles.md` and `plans/INDEX.md`. The locating detail already lives in `docs/structure.md` (the full module index, D4); the ruling history's home becomes principles.md (the why) and INDEX (the case law). The ~69k characters of embedded per-line history come out.
- **Core invariants** restated as the principle summary layer: the P-numbered statements in compressed form with pointers; the full statements live in principles.md alone.
- **Maintaining this document** gains the derivation discipline (D5) as the rule for future lines.

## D4 — `docs/structure.md` and `docs/glossary.md` re-keyed

structure.md keeps module → responsibility → key files (it remains the locating index its header claims); the responsibility cells lose the embedded ruling history and dates to principle pointers. glossary.md gains the vocabulary row — P-numbering, `Derives:`/`Amends:` — under "Design-document vocabulary".

## D5 — The derivation discipline (how to rule, going forward)

`docs/principles.md` carries a closing **"How to rule"** section, and every future `plans/NNNN` document's decision blocks state their derivation:

- `Derives: P-NN` — with the one clause showing *how* the ruling follows;
- `Amends: P-NN` — when the ruling genuinely extends the constitution, with the principle restated and provenance carried forward.

A ruling that matches no principle is a red flag to resolve **before** landing: either the constitution is incomplete (fix the set, in the same change) or the ruling is drift (fix the ruling). Answering a boundary question starts from principles.md, not from a corpus search. This discipline is the actual fix for the trigger incident — it converts "claimed it was a new rule" from an invisible error into a named one.

## D6 — The audit contract: findings only (maintainer's ruling 1, 2026-10-21)

Two directions, both recorded in this document's execution record as follow-up work items — **each fix gets its own later ruling; no code change of any kind lands with this initiative, comments included**:

- **Rules → principles**: every surviving (non-superseded) rule family from the combing is assigned to its principle(s). Gaps are findings of two kinds: a *missing principle* (propose the addition) or an *orphan rule* (drift finding — a rule that generates from nothing the corpus can state).
- **Principles → code**: each principle's enforcement points located in src (the headers already carry plans pointers; the mechanisms are findable from them), checked for consistency with the principle's statement. Divergences recorded as findings only.

## D7 — The method: combing, synthesis, one checkpoint (maintainer's ruling 3, 2026-10-21)

- **Combing** by parallel batch agents over the 108 documents in line-balanced batches (~10; the four 800+-line documents weighed). Per document, extract: number/title/date (Status lines first, git add-dates as fallback — mtimes are uniform, the 2026-10-03/04 bulk translation), trigger incident, rulings one line each, supersession signals, **principle-candidate sentences** (the general statements later rulings reuse — the corpus's own phrasings, collected verbatim), code touchpoints. The same pass combs the other three carriers (AGENTS.md invariants, structure.md rows, a sample of src headers) so the synthesis sees all four. Extractions are written to disk under `plans/.0110-work/` — one self-headed file per batch (range, date) — so later stages survive session loss; the work directory is transient, untracked, and removed at stage 7 (D10).
- **Synthesis** clusters the candidates into the draft principle set in the D1 format.
- **One checkpoint**: the draft set is presented to the maintainer before anything is re-keyed — *their rulings must be faithfully generalized, not re-invented by the agent*. The draft is held outside `docs/` until approved. After approval the remaining stages run to completion.

## D8 — Scope boundaries (maintainer's ruling 2, 2026-10-21, and the derived edges)

- **Index-only condensation**: plans originals preserved byte-untouched — no status banners stamped on superseded documents, no reorganization, no deletion. (The more aggressive forms were offered and declined.)
- Zero code behavior change; src untouched entirely.
- Shell packages untouched (their README passages mirror mechanism rulings, which do not change here).
- AGENTS.md, `docs/structure.md`, `docs/glossary.md` are the only existing files re-keyed; `docs/principles.md` and `plans/INDEX.md` are the only new files.
- No new config keys, switches, protocol literals, or document roles — this is not a runtime mechanism.

## D9 — Acceptance: the falsification replay, verification, and resume acceptance

The initiative passes a **falsification replay**, recorded in the execution record: the triggering question (the process-refs re-read that addendum two answered) and the recent rulings (0103 addendum two, 0109) are answered **from `docs/principles.md` alone, plans closed** — and the answers must come out the same. If any of them is not derivable, the principle set is incomplete and goes back to synthesis, not to the ruling. Verification: `bun typecheck` and the full `bun test` unchanged (a documentation-only change must leave the suite green), and `git status` shows every `plans/NNNN-*` original untouched. **Resume acceptance** (D10): after any break, a fresh session given only the repository — no conversation memory — names the current stage, its inputs, and the next action.

## D10 — The resume protocol: state lives on disk, never in the session

Execution may span sessions and be broken anywhere. The protocol transposes the driver's own recovery philosophy onto this initiative — re-derivation from durable evidence, completion never judged by self-report:

- **The journal.** An `## Execution record` section appended to this document: one dated line per stage boundary naming the stage, the artifact written, and any ruling taken; the Status line above is updated as stages complete. This document plus the work directory are the entire resume state.
- **The work directory.** `plans/.0110-work/` holds every in-flight artifact — `batch-NN.md` (one per combing batch), `principles-draft.md`, `assignments.md`, `findings.md` — each written whole by its owning step, untracked, removed at stage 7. **A file's presence and well-formedness is the only completion signal for the step that writes it**; the journal is a hint, never proof. An absent or unparseable file means the step re-runs — safe by construction, because combing is pure extraction over read-only inputs and every step overwrites only its own file.
- **The person gate.** The stage-2 checkpoint may not be resumed past: proceeding requires the journal's approval line — the date plus the maintainer's decisions verbatim, draft edits included. A draft present without an approval line means *awaiting review*, never *approved*; an approved draft is never re-presented.
- **Append-only findings.** `findings.md` rows are numbered and never dropped by a re-run; a re-run that no longer observes a recorded finding notes the disagreement beside it rather than deleting it.
- **Person edits win.** If the maintainer has hand-edited an in-flight artifact, the edit is authoritative and the run adapts to it (0100's person-edited rule transposed); no step overwrites it to "complete" itself.
- **Stage-5 boundaries.** The re-key lands one whole file at a time in the fixed order — `docs/principles.md` → `plans/INDEX.md` → `docs/glossary.md` → `docs/structure.md` → AGENTS.md — with a journal line per file. A resume re-derives progress from the journal plus `git diff`, never re-keys a file from stale content, and the stage-7 originals-untouched check over `plans/NNNN-*` remains the outer guard.

## Execution stages

Each stage carries its resume contract; every boundary writes a journal line (D10).

1. **Combing** (D7) — fan-out extraction, one `batch-NN.md` per batch in `plans/.0110-work/`. *Resume: re-run exactly the batches whose files are absent or unparseable.*
2. **Synthesis + CHECKPOINT** — clusters the batches into `principles-draft.md` (D1 format), presented to the maintainer. *Resume: the journal's presented/approved lines decide — never re-present an approved draft, never proceed past an unapproved one.*
3. **Derivation audit** (D6, rules→principles) — produces `assignments.md`; the assignment table lands in INDEX rows; gaps become numbered findings. *Resume: recomputable from the batches plus the approved draft; findings append-only.*
4. **Implementation audit** (D6, principles→code) — locates each principle's enforcement points in src; divergences extend `findings.md`. *Resume: same append-only rule.*
5. **Restructure** — writes the final `docs/principles.md` and `plans/INDEX.md`, re-keys AGENTS.md, `docs/structure.md`, `docs/glossary.md`, one whole file per step in D10's fixed order; findings recorded as follow-up work items in the execution record. *Resume: journal + `git diff` name the remaining files.*
6. **Falsification replay** (D9) — read-only over the final files. *Resume: freely re-runnable.*
7. **Verification + cleanup** (D9) — typecheck, full suite, originals-untouched check; removes `plans/.0110-work/`; the Status line moves to executed. No commit unless the maintainer asks. *Resume: a completed Status line means nothing to do.*

## Seeds observed during the survey (non-binding, for the combing to validate)

Collected from the diagnosis pass, offered as clustering seeds — the combing may confirm, merge, split, or refute them: P1 (stands alone); the person brackets every boundary (0101); completion is never agent self-report (0044); committing is the completion condition (0021); driver-exclusive state writes; one home per state kind (documents vs `.auto/` vs config — the CURRENT.md retirement); references are references, never literals (0055 §4.3); no environment-specific knowledge in tool source (0108 D8.1); detection is not a gate unless it is the person's moment (0100 D6, 0103); counts, not lists, on human-facing surfaces (0109); the byte-identical floor (every opt-in mechanism degrades to the unchanged baseline); one home per mechanism (the 0061 consolidation reflex); fail loud, degrade visibly; frozen additive-only vocabularies; the core does not know shells; templates are data, renderers assemble (and provenance pinned in the repo, never floating — 0100 D6); bounded agency, the human the unbounded backstop; mechanisms are ruled from measured field rounds, not speculated. Eighteen seeds; if the synthesis returns fewer after merging, it says why.

## Execution record

- 2026-10-21 — stage 1 (combing) started: batch map written to `plans/.0110-work/batch-map.md` — 11 contiguous line-balanced batches over the 108-document corpus (0001–0109 except the deleted 0028; 26,804 lines; batches ~2,400–2,700 lines, batch-11 the 1,133-line tail) plus `batch-carriers` (AGENTS.md whole, `docs/structure.md` whole, `docs/glossary.md` whole, a 20-file src-header sample listed in the map). No rulings taken.
- 2026-10-21 — stage 1 (combing) complete: `batch-01`..`batch-11` + `batch-carriers` all present and well-formed (headers checked; document coverage exactly 9/10/8/9/15/5/9/8/19/9/7 = 108; carriers: 14 AGENTS invariants, 43 navigation clauses, 49 structure.md rows, 21 glossary rules, 78 src-header quotes; ~3.7k extraction lines). `git status`: only this document modified, `plans/.0110-work/` untracked; every plans original untouched. No rulings taken during combing.
- 2026-10-21 — stage 2 (synthesis) complete, CHECKPOINT reached: the draft principle set written whole to `plans/.0110-work/principles-draft.md` — 20 principles (P1 keeps its identity with the five clause-derivations as the worked example; the 18 seeds → 15 via two merges (P5, P16) and one split (seed 17 → P2+P20); five new from the combing (P6, P7, P17, P18, P20); a "How to rule" section; a seeds-disposition table; five questions for the maintainer). Presented for review — **awaiting the maintainer's rulings; not approved; stages 3–7 held.** Proceeding requires this journal's approval line per D10.
