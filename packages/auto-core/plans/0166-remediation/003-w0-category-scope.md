# Step 003 — w0-category-scope

Wave W0-governance · findings 0165-066 (S02-01), F9 · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD 8f2dca4a8 · verified and committed same day.

## Scope (as enacted)

**0165-066 / F9 (twins)** — Category scope resumption: the 22 requirement-bearing rulings
0142–0161, 0163, 0164 carried no `## Category scope` section, so the 0123 D3 family-consistency
check could not run on them. The register's remedy: reconstruct the home-sets. S32 confirms the
lapse is practice drift, not enactment drift (the corpus's defects cluster elsewhere, each with its
own wave) — the reconstruction is a record repair, not a re-ruling.

## Changes

Each of the 22 documents gains one `## Category scope (0123 D1's discipline — reconstructed
2026-11-05 by 0166 step 003 …)` section, placed **between the document's final Derives/Amends
paragraph and its Tests paragraph** (uniform rule; the 0124–0141 exemplars place the section
directly after the derivation, and the 22 lapsed docs carry their derivation at the end). Every
section names its family in one line, then a home/disposition table: each `changed` home cites the
D-block that ruled it and is grounded in the ruling's own landing-commit chain (the add commit plus
follow-up commits whose subject starts with the id — the same chain family-check derives); each
`held, untouched` home names the floor or residual that keeps it unchanged. The reconstruction
header names the evidence per document (landing-commit short sha; for 0151/0153/0159 their
lockstep-completion commits, which the chain includes).

Standing convention carried from the 0124 exemplar: the corpus's per-landing bookkeeping surfaces
(`AGENTS.md` navigation line, `plans/INDEX.md` row, `docs/structure.md` row) are not family homes
and carry no row — except where the ruling itself names the surface as its restatement (0146's
principles.md/templates README, 0159's exit-codes line, 0151's shell-contract row, 0160's §A row).

Per-document row counts (rows / changed-paths, family-check's own figures): 0142 8/9, 0143 9/11,
0144 8/11, 0145 9/7, 0146 9/15, 0147 8/10, 0148 8/13, 0149 7/5, 0150 9/37, 0151 8/17, 0152 6/3,
0153 6/3, 0154 7/3, 0155 9/10, 0156 12/19, 0157 9/15, 0158 9/26, 0159 7/6, 0160 9/25, 0161 4/6,
0163 7/10, 0164 8/8.

No other file changed: no src, no templates, no INDEX row (the rows' "what it ruled" cells are
untouched — the sections repair the documents, not the manifest), no AGENTS.md line (the
development-conventions line "write the ruling with its Category scope section" already stands).

## Verification

- `bun plans/0165-review/tools/family-check.ts` — **all 22 compute and report ok** (before: 22 ×
  "no Category scope section — family reconstruction needed (manual)"); every `changed` home in
  every section is confirmed touched by its ruling's landing-commit chain; the pre-existing 0124+
  rows unchanged (no NOT TOUCHED anywhere).
- `bun plans/0165-review/tools/probe.ts` P4 — **zero flags** (before: the 22 "no Category scope
  section" lines); every post-baseline plan now carries both a Derives/Amends tag and a Category
  scope heading.
- Table grammar: every new table row has exactly two cells (3 unescaped pipes; the one literal pipe
  in 0146's `Status: continue|done` row escaped as `\|`) — awk check over all 22 sections.
- `bun typecheck` clean (exit 0). Documentation-only change; no product test suite due.

## Dispositions

- **0165-066** — fixed (step 003, this commit): all 22 sections reconstructed; family-check runs on
  every ruling 0124–0164; probe P4 clean.
- **F9** — fixed with its twin (step 003, this commit): same act; the release audit's
  family-consistency guard is again total over the corpus.

Residuals: none for this row. Future rulings resume the section at ruling time (the standing
convention; 0165 and 0166 already carry theirs). The three follow-up commits folded into the chains
(0151 ×2, 0153 ×1, 0159 ×1) were already-indexed completions — no reconstruction ambiguity arose
from them.
