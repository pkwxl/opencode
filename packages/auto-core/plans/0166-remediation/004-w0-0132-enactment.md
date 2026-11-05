# Step 004 — w0-0132-enactment

Wave W0-governance · findings 0165-067 (S02-02), F10 · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD 1cb15639a · verified and committed same day.

## Scope (as ruled for this step)

**0165-067 / F10 (twins)** — 0132's enactment (5b5b52fcd) touched a proper subset of its own
Category scope: `src/config-fix.ts`, `src/document/roles.ts`, `src/phases.ts`, `src/analysis.ts`
marked changed, untouched (the `Wall:` parser landed in `src/phases/custom.ts`). The register's
remedy: "record at the cut; S20's verdict decides whether code follows". S20's verdict (Residuals,
S02-02): the roles.ts row is a **record imprecision, not a defect** (0132 D4's sealed set is
"declared, not fixed-role" and lives in protect.ts — PROTECTED_FILES has no reason to change); the
config-fix.ts row **hides a real gap** (the fix 0122 sync is wall-blind — it cannot re-add the exact
retired key, but it re-opens any subtree through a new door, S20-02(b)) — whose **code remedy
belongs to the wall wave** (the matcher-oracle first, step 028; the closed predicate and the
wall-aware sync skip under 0165-038's family, step 029), not to this governance step: the fix needs
the admission oracle the wall wave builds first, and category-complete discipline puts the code home
and its test home in one change. The parser home is an enumeration error only (equivalent home,
wrong enumeration).

So this step is the record repair S20 named: correct 0132's Category scope enumeration in place,
annotate 0132's INDEX row ("An INDEX annotation on 0132 should record both"), and make the
family-consistency guard's verdict on 0132 true again. No product code changes.

## Changes

1. `plans/0132-sealed-reference-wall.md` (Category scope table) — three rows corrected, each with
   its provenance parenthetical (date, step, evidence):
   - the parser row's homes: `src/phases.ts`/`src/analysis.ts` → `src/phases/custom.ts` (the
     `Wall:` grammar beside `Gate:`) / `src/phases/registry.ts` (the field-list pin — both in the
     enactment's chain);
   - the stamping row's homes: `src/external-dirs.ts` + `src/config-fix.ts` → `src/external-dirs.ts`
     alone, the disposition recording the config-fix half as **deferred with a named residual**
     (the wall-blind sync re-opens any subtree, S20-02(b); the wall-aware skip ruled for 0166 step
     029 under 0165-038's family) — never silently dropped;
   - the protect row's homes: `src/protect.ts` + `src/document/roles.ts` → `src/protect.ts` alone,
     the disposition recording the roles.ts half as a record imprecision (D4's set declared, not
     fixed-role; PROTECTED_FILES unchanged).
2. `plans/INDEX.md` (0132 row) — a "later:" tail appended to the summary cell recording the
   corrected enumeration and the deferral (the 0155 row's "later:" tails the precedent).
3. `plans/0165-review/tools/family-check.ts` — the disposition classifier now also skips rows whose
   disposition begins with the held marker (`/^\s*held\b/`), beside the existing "unchanged" skip.
   Before, 0132's `held, untouched` audit.md row was misread as changed because its prose contains
   the word "changed" ("the first draft's changed row was wrong") — a tool artifact inflating the
   finding's evidence by one path. The skip is exact: corpus-wide, exactly one row (that audit.md
   row) begins with "held" and contains "changed"; the two rows that contain both "changed" and
   "untouched" mid-prose (e2e.test.ts's "with the lock untouched", 0137's "allowed-flags loop
   untouched") remain checked, so no legitimate check is lost.

## Verification

- `bun plans/0165-review/tools/family-check.ts` — **0132: 11 rows, 11 changed-paths, commits 2 —
  ok** (before: NOT TOUCHED phases.ts, analysis.ts, config-fix.ts, document/roles.ts + the
  audit.md artifact). Remaining flags, both outside this step's finding and left standing:
  0126 (`test/golden.test.ts` marked changed, untouched — the audit's triaged "imprecision", never
  registered as a finding) and 0138 (`/opencode.json` target-relative spellings the repo-relative
  matcher cannot match — 0138's record repair is 0165-147's, step 030).
- `bun plans/0165-review/tools/probe.ts` — P1, P2, P3, P4 sections all empty (INDEX grammar, code
  homes, path references, Derives/Amends + Category scope presence).
- Table grammar: the three edited 0132 rows carry exactly 3 unescaped pipes each (two cells); an
  awk pass over the whole Category scope section finds no deviating row.
- `bun typecheck` clean (exit 0). Documentation-and-tool change; no product test suite due (no
  src/, test/ or templates/ path touched).

## Dispositions

- **0165-067** — fixed (step 004, this commit): the enumeration corrected in the ruling's own
  Category scope, the INDEX row annotated, the guard's verdict on 0132 true again. The live code
  consequence (fix re-opening a sealed subtree) rides 0165-038's own row and step 029 — recorded
  here as the named deferral, not a residual of this finding.
- **F10** — fixed with its twin (step 004, this commit): same act; S20-02's reproduction named as
  the deferral's evidence, so the cut's audit will read the gap under its owning finding.

Residuals: none for this row. Two standing observations recorded for later steps, not fixed here:
(a) 0126's golden.test.ts enumeration imprecision — triaged "imprecision" in the S02 audit body but
never registered; left for the final audit's unowned-row check (step 080) to catch; (b) 0138's
family-check flags — owned by step 030 (0165-147's INDEX annotation on 0138); step 030 should also
reconcile the `/opencode.json` spellings so the guard can verify that row. Also corrected here by
implication: step 003's verification line "no NOT TOUCHED anywhere" overstated — the 0126/0132/0138
flags were present at that commit too (the tool is unchanged since 36614f72f); its intent was the 22
reconstructed sections, all ok.
