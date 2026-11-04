# Step 002 — w0-index-navigation

Wave W0-governance · findings 0165-060, 0165-061, 0165-065, 0165-176 · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD 9e61f6e0b · verified and committed same day.

## Scope (as enacted)

1. **0165-060 (S01-01)** — INDEX table grammar: the undefined 7th annotation cell in rows
   0139–0164, 0162's 8 cells, 0086's unescaped pipe.
2. **0165-176 (S01-02)** — INDEX row order: 0148 listed before 0147.
3. **0165-061 (S01-03)** — 11 stale code homes (10 src files + templates/prompts/phase-plan.md)
   in 22 rows, 9 of them active-authority rows.
4. **0165-065 (S01-07)** — AGENTS.md ## Navigation regrown into R4's documented failure mode.

## Changes

**plans/INDEX.md** (the one maintained file; plan originals untouched):

- Grammar (0165-060): the 22 non-empty 7th cells folded into the 'what it ruled' cell behind
  the separator ` — later: `; the 4 empty `—` cells (0154, 0157, 0161, 0164) dropped;
  0086's `` `Status: continue|done` `` and 0162's `treeLanes on|auto` escaped (`\|`);
  every row now exactly 6 cells. 0128's pre-existing `\|` escapes untouched (valid GFM).
- Order (0165-176): rows 0147/0148 swapped into number order.
- Stale homes (0165-061): every home naming a file that no longer exists carries its
  disposition — `src/index.ts (→ packages/auto/src/index.ts)` (the 2026-09-05 extraction,
  446f90635), `src/server.ts (→ src/agent/opencode/server.ts)` (0039), `src/subtask-state.ts
  (→ src/document/state.ts)` (the 0045 rename, 939405cb8), `src/{verify,review,final}.ts
  (retired 0044)` (779a8f9da), `src/{check,refcheck}.ts (retired 0061)` (b2e934996 /
  21128ca00), `src/current.ts (deleted 0054)` (3ba1eb39c; row 0054's bare `(deleted)` made
  uniform), `src/fixme.ts (retired 0044)` (row 0002's own supersession; no repo-era deletion
  trace), `templates/prompts/phase-plan.md (retired 0095)` (d117ccbca). 22 rows annotated;
  no bare stale token remains in any homes column (token-level check).

**AGENTS.md** (0165-065): the navigation diet. Bullet topology unchanged (67 lines, one per
mechanism); each line keeps the topic phrase, the minimal identifying qualifier (switch
names, command shapes) and every file arrow and plans pointer; the ruling narration and
amendment histories dropped — that detail lives in the numbered plans documents, INDEX rows
and docs/structure.md (verified present there before dropping). The "Maintaining this
document" rule now encodes the diet: "one short navigation line (topic → key files + plans
pointer; ruling narration belongs to the numbered document and INDEX, module detail to
docs/structure.md)". Two pointers the first pass dropped (0102, 0151) were caught by the
preservation check and restored; the arrows check and the pointer check now both report
zero losses.

**plans/0165-review/tools/probe.ts** — the regression coverage for 0165-061: P2 now skips a
home token immediately followed by a disposition annotation (`(→ …)`, `(retired NNNN)`,
`(deleted NNNN)`), so it reports exactly *unannotated* stale homes — fails against the
pre-fix manifest (11 paths, 22 rows), clean after.

## Verification

- `bun plans/0165-review/tools/probe.ts` — **P1 empty** (was: 27 broken rows), **P2 empty**
  (was: 11 stale paths; verified it fails on the pre-fix manifest), P3 unchanged from the
  triaged baseline (target-directory paths + the deliberately retired behavior.md mention).
- Independent awk cell-count over INDEX (escape-aware): every table row exactly 6 cells;
  sorted row-id diff vs HEAD: all rows present; 0147 before 0148.
- Navigation preservation checks: zero `src/…` arrows lost, zero plans pointers lost
  (comm-based against `git show HEAD:AGENTS.md`).
- Metrics: Navigation section 32,595 → 12,445 bytes (−62%); 67 bullets, average line 485 →
  181 chars, max 2,600 → 653.
- `bun typecheck` clean (exit 0). Docs + evidence-tooling change; no product test suite due.
- `bun plans/0165-review/tools/family-check.ts` unchanged outside later steps' scopes (the
  Category-scope findings it reports are 0165-066 / step 003's scope).

## Dispositions

- **0165-060** — fixed (step 002, this commit): 27 grammar-broken rows → all 6-cell.
- **0165-061** — fixed (step 002, this commit): 11 stale homes annotated across 22 rows;
  probe P2 taught to hold the line.
- **0165-065** — fixed (step 002, this commit): Navigation avg 485 → 181 chars; the
  maintaining rule now states the diet.
- **0165-176** — fixed (step 002, this commit): rows 0147/0148 in number order.

Residuals: none for these four rows. (The probe's P4 Category-scope output and
family-check's manual rows belong to step 003, not deferred here.)
