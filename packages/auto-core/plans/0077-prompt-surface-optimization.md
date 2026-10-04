# 0077 — Prompt surface optimization (evidence-driven)

Status: **proposal, 2026-10-03.** Companion to plans/0072 (which owns *where* each rule
lives — carrier placement) and plans/0076 (which owns the standalone machinery): this one
owns the **text quality** of `templates/prompts/*.md`, `_partials.md` and
`templates/intents/default.md` — brevity, clarity, and session compliance — after
placement settles. Enters via `plan --append` behind this doc + ruling. Ruled
2026-10-04: both rulings accepted as recommended (§5).

## 1. Why

The templates accreted one paragraph per plan (0003 → 0068). Every session re-reads its
full rendered prompt, so length is a per-session token tax; and wording that sessions
actually violate is a compliance cost the run already counts but nobody has ever read as
a prompt signal (the per-model protocol-drift counters, 0055 §7.1). No unit has ever
measured either. Out of scope: moving rules between carriers (0072), the standalone
machinery (0076), and any marker or grammar change.

## 2. Proposal — one unit, after 0072 U-B

- **Measure first**: rendered size per template (before/after), rule-instance count per
  rendered prompt (each rule stated once), and the drift counters as the compliance
  baseline.
- **Rewrite per template**: trim verbosity, fold near-duplicate paragraphs, reorder so
  behavior-critical rules (state files, commit, eof, P1) lead; reword first the rules
  the counters show sessions violating most.
- **Guardrails**: tier-1 driver-enforced markers and driver protocol strings are inputs,
  not targets; partial section names stay stable (override compatibility under
  `.opencode/auto/prompts/`); prompt goldens updated in the same unit (the standing rule
  for every prompt-copy change, cf. 0075 §4).

## 3. Sequencing

After 0072 U-A (its findings are this unit's input) and after U-B (consolidation moves
text between carriers first — optimizing before that would trim text U-B then relocates).
May share a round with 0076 (disjoint files, disjoint tests); ordering within the round is
a scheduling call, not a dependency.

## 4. Risks

- Cosmetic-rewrite regression: terser wording may lower compliance — the drift counters
  across the following round are the falsifier; per-template rollback is the unit
  boundary (git revert of the unit's commit).
- Projects overriding templates keep their overrides (section names stable), but the
  optimized defaults diverge from their copies — their choice, noted not blocked.

## 5. Rulings (decided 2026-10-04 — both as recommended)

1. Token-budget targets per template as acceptance (recommended), or evidence findings
   only?
2. One unit for all templates (recommended — the goldens churn once), or per-template
   units?
