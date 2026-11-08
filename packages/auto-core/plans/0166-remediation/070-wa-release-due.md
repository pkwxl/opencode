# Step 070 — wa-release-due

Wave WA-docs · findings 0165-070 (S3), F14 (twin 0165-070) · status:
**doing** 2026-11-09 · start HEAD `6f2cf849c`.

## Scope (the finding's family)

The release-spine documentation family — one finding, one shape: the release record
`docs/releases.md` states a cut trigger ("a release is cut when a ruled program
completes") that has fired and been left standing, with no reconciliation of what the
due cut owes. No code behavior is ruled; the wave is WA-docs.

- **0165-070 / F14 (S02-06, S3, CONF, TRACE)** — "a release cut is due: 41 unreleased
  rulings (now 47 with 0161–0165) and a completed ruled program (0155–0160)". Impact:
  "the per-release audit (traceability, replay, family check) has not run on
  0124–0164". Remedy: "this review's §release-audit is the cut's draft input". The
  finding's register row cites releases.md l.5 and R7 (corpus growth without
  governance). Since the finding: 0225 D6 created the mid-cycle amendment register
  (rows "accumulate until step 070", "consumed at the cut"); 0226 D1 named this cut as
  the first one the refreshed registers serve; the corpus has grown to 0229 — the
  census re-measured at this step's landing below.

## The standing handoffs this step consumes (read before ruling)

- **0225 D6** — the register's grammar: append-only, one row per edit, consumed into
  the next release section's principle deltas **at the cut**, clearing the register;
  0146's edit the retroactive-row precedent. 0225's residual names "step 070's
  due-cut reconciliation" as the writer of the rows into the next release section and
  the clearer of the register — read together with the cut's own letter (releases.md
  l.5: **the maintainer cuts it**; the release sections move only at a release event)
  and the program's order (steps 071–079 land rulings after this step, shipping in
  the same cut), the writing/clearing is the cut-time act itself; this step prepares
  it. The ruling states this premise change explicitly.
- **0226 D1** — the registers' refresh owes currency at its landing moment; "the next
  cut (step 070) is the first one this refresh serves."
- **The program's division** — step 070 = the due-cut reconciliation (prepares the
  final release assessment); step 081 = release-assessment (W1/W6 gate checked;
  tagging/cut/publication only on explicit instruction). The hard constraint: this
  step PREPARES release material, it never cuts.

## Plan (before editing)

1. Ruling **0230** written first (next free number verified by `ls plans/` — 0229 the
   last). Answer the boundary from docs/principles.md first (P18 the record, P19 the
   measured census, P2 the maintainer's cut, P8 record-don't-gate, P13 the register's
   additive grammar). 0165 evidence, not authorization; Category scope enumerated;
   premises named (0225's residual letter).
2. Measure the due state at this step's landing (every number cited):
   - the INDEX census (`grep -c "ships with the next release" plans/INDEX.md`);
   - the constitution-edit census (`git log --oneline
     07036c2b5..HEAD -- packages/auto-core/docs/principles.md`) — the register's
     coverage checked against it (expect: 0221's P15 amendment, `be3daccb1`,
     pre-dates the register and carries no row);
   - the W1/W6 gate state from the program's ledger (both waves landed).
3. Enact in `docs/releases.md` (per the ruling):
   - D1 the due-cut reconciliation section (after the per-release audit duty, before
     the `---` spine): the dated census, the completed/in-flight programs, the
     W1/W6 gate, the v0.3.0 tag decision riding the cut, the not-cut boundary;
   - D2 the register's missing retroactive row (0221's P15 amendment) + the register
     restated in the section as the principle-delta draft (consumption prepared,
     never enacted);
   - D3 the assessment material for step 081: the audits the cut owes (traceability
     both directions, the replay under 0225 D7's method, the family-consistency
     check with S02-01's lapse recorded), the breaking-change determination's
     candidate list, the 0165 review's §release-audit named the draft input.
4. The pin `test/release-due-reconciliation.test.ts` (the 0221 docs-pin pattern, the
   0225/0226/0227 lineage) + its `test/lanes.ts` manifest row — fail-red at HEAD
   (the section and the register row absent), green after. No live census pin (the
   census a dated snapshot; a live check would break every later step's INDEX row).
5. INDEX row 0230 (6 cells, in-table); ledger dispositions (0165-070, F14); program
   bookkeeping (Current position); commit (step-070 paths only).

## Execution log

- 2026-11-09 (delegated worker): step opened after step 069's commit (`6f2cf849c`,
  verified `git log -1 --format=%h`). Evidence read: the 0165 register rows
  (0165-070 l.252, F14 l.151/l.585), S02-corpus-audit (Release state, S02-06,
  seam notes), the 0165 review's Release readiness line + §9 item 7 + §10 (the
  W1/W6 ordering), rulings 0225 (D6, D7, the residuals) and 0226 (D1, the
  due-cut passages), the program's row 070 / ledger rows / Current position,
  releases.md whole, steps 065/066 records (the pin and proof patterns).
- 2026-11-09: measurements taken (the ruling's census table): INDEX 105 open rows
  0125–0229; principles.md commits since v0.3.0 five (`7401fe7b5` 0146,
  `c4fb131f7` step 006, `be3daccb1` 0221, `39095aee6` 0225, `696966685` 0226);
  the register carries rows for all but `be3daccb1` — 0221's P15 amendment the one
  pre-register mid-cycle edit with no row. W1 (step 009) and W6 (steps 013/015)
  landed — the gate green.
- 2026-11-09 (resumed by the delegated worker after the interrupted invocation):
  the measurements above re-verified at HEAD `6f2cf849c` before enacting (all
  confirmed: `grep -c "ships with the next release" plans/INDEX.md` → 105, first
  open row 0125, last 0229; `git log --oneline 07036c2b5..HEAD --
  packages/auto-core/docs/principles.md` → the five commits with dates 2026-10-28,
  2026-11-05, 2026-11-08, 2026-11-09 ×2; v0.3.0's INDEX cells close 0112–0124).
  Pin `test/release-due-reconciliation.test.ts` written first (D4's needles: the
  section heading, the not-cut boundary, the census count/span/snapshot law, the
  programs, the W1/W6 gate + re-check, the tag riding the cut, the 0221
  retroactive row + its retroactive name, the five-row restatement, the
  principle-delta draft, the consumption prepared-never-enacted, the three
  audits-owed lines, step 081 the consuming step — plus a placement test: the
  section after the audit duty and before the `---` spine, the 0221 row in the
  register's date order). Fail-before proven over /tmp/070-head (HEAD's
  docs/releases.md bytes via `git show`, verified byte-identical to the working
  tree before the edit): **0 pass / 2 fail** — the needle test red on the section
  heading (the section absent), the placement test red at `indexOf` −1. Enacted
  per D1–D3: the 0221 retroactive register row (dated 2026-11-08, between step
  006's and 0225's rows) and the "## The due-cut reconciliation (0230, prepared
  not cut)" section (after the per-release audit duty, before the spine) — no
  release section written, the version spine and the stamp untouched, no register
  row rewritten. Working-tree pin green: **2 pass / 0 fail** (22 expects).
  `test/lanes.ts` manifest row added (unit lane, beside the other docs pins).

## Verification (the step's close)

- `bun typecheck` exit 0.
- Full suite **3246 pass / 0 fail** (161 files = the 3244/160 baseline + the pin
  file's 2 tests; 21052 expects).
- Fail-before over /tmp/070-head (HEAD's releases.md bytes, `git show`, cmp-verified
  against the pre-edit working tree): **0 pass / 2 fail** — every needle red (the
  section and the register row absent at HEAD, the exact state the finding
  measured); green in the working tree after the enactment (2 pass / 0 fail, 22
  expects).
- No shell suite due (no packages/auto or packages/auto-server file touched).

## Dispositions

- **0165-070 (S02-06, S3, CONF, TRACE)** — fixed (step 070, ruling 0230
  D1+D2+D3): the due-cut reconciliation prepared in releases.md — the census, the
  programs, the gate, the tag decision, the not-cut boundary; the register
  completed and restated as the principle-delta draft; the assessment material
  marshaled for step 081. The cut itself never this program's act.
- **F14 (twin 0165-070)** — fixed with its twin (ruling 0230 D1+D2+D3).
