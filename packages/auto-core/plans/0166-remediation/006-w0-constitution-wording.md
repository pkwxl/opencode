# Step 006 — w0-constitution-wording

Wave W0-governance · findings 0165-101 (S08-10), 0165-132 (S17-06) · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD 087244460 · verified and committed same day.

## Scope (as enacted)

Two constitution-wording repairs — the texts lagging their own rulings (S02's "constitution drift"
register class), no behavior ruled:

- **0165-101 (S08-10)** — principles.md P10's derivation list still names `OPENCODE_AUTO_PLAN_VERIFY`
  as a kill switch ("remove machinery, never checks"); since 0113 it is a default-off opt-in whose
  off state removes exactly a check (the skip reason's own words). Remedy: move it out of the
  kill-switch list into an opt-in-checks clause citing 0113.
- **0165-132 (S17-06)** — the security family's letter ("keys and env values are references, never
  literals") is false of the profile env surface it seems to name: 0055 §4.2 admits literal env
  values by design, and `resolveProfileEnv` builds the child overlay from resolved values. Remedy:
  restate the family to the code's true shape in principles.md and AGENTS.md.

The optional hardening named by S17-06 (warn on a literal env value under a `*KEY*`/`*TOKEN*`/
`*SECRET*`/`*PASSWORD*` name) is **declined for now, recorded as the named residual**: the family's
letter becomes true as written, literals are withheld from every printed surface, and a warning
with no measured consumer is P21 cost (re-open with the W-secrets wave, step 020, if its census
wants it).

## Changes

1. `docs/principles.md` (P10's derivation list) — `OPENCODE_AUTO_PLAN_VERIFY` moved out of the
   kill-switch line into its own opt-in-checks clause: default off, off removes exactly the
   semantic check (the skip reason's own words) while the mechanical layers always hold (the
   render gate, the precedence blocks, the wrap-up's charter acceptance — 0113's own wording),
   the correction citing 0113 and 0165-101. The kill-switch line keeps its four true members.
2. `docs/principles.md` (the P16-secrets-half family row) — restated to the code's true shape:
   registry keys references-only (refused otherwise); a registry profile's env values literal
   (`~` expanded) or references by design (0055 §4.2), nothing ever printed — logs, `models`
   output and error lines name the name or the reference; a resolved value reaches only the
   managed agent child's environment through the spawn overlay. A restatement note carries the
   provenance (0165-132, 2026-11-05) and the named residual (no warning on a secret-shaped
   literal env name — declined, P21).
3. `AGENTS.md` (the Security family paragraph) — the same restatement, operative form.

No other surface repeats the old letter (repo-wide grep: only the two restatements; the 0165
register's own evidence quotes keep it, correctly). `docs/structure.md` carries no family row; the
auto README's env paragraph was already correct (S17-06's family note). The `releases.md` record
rides the next release's section — its shape is step 070's ruling (F14's due-cut
reconciliation), not this step's to invent; the findings' disposition lines land there at the cut.

## Verification

- Repo-wide grep: zero remaining occurrences of the false letter outside intentional evidence
  quotes (the restatement note, the 0165 register row).
- Faithfulness: the mechanical-layers wording is 0113's own (plans/0113 l.48-49: "the render-gate
  asserts at `renderPrompt`, the precedence blocks, the wrap-up session's charter acceptance");
  the profile-env letter is 0055 §4.2's (`models-schema.ts:48`: "a literal (`~` expanded), a
  reference the driver resolves at spawn, or null").
- `bun plans/0165-review/tools/probe.ts` — P1, P2, P4, P5 empty. P3 carries 7 pre-existing
  placeholder-class refs (AGENTS.md → `docs/behavior.md` the retired mention, `docs/T-NNN/
  subtasks.md`; structure.md → five `docs/R-NN`/`docs/T-NNN` grammar placeholders), none added by
  this step (its edits introduce no path references). **Correction of the step-004 record**: its
  "P1–P4 clean" line overstated P3 — the sed range used there cut at P3's header; P3's flags
  pre-date this program and are placeholder-class, no action.
- `bun typecheck` — clean (exit 0). Wording-only change; no product suite due.

## Dispositions

- **0165-101** — fixed (step 006, this commit): the constitution's P10 derivation list matches
  0113's ruled reality; the boundary question a reader answers from principles.md first no longer
  concludes the wrong thing.
- **0165-132** — fixed (step 006, this commit): the family's letter is now right-or-wrong by
  inspection against the code it names, and inspection finds it right; the optional
  secret-shaped-name warning recorded as the named residual (declined, P21 — re-openable with
  step 020's W-secrets census).

Residuals: the named residual above; the releases.md disposition lines ride step 070's cut.
