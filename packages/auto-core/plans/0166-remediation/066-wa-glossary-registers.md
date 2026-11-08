# Step 066 — wa-glossary-registers

Wave WA-docs · findings 0165-179 (S4), 0165-180 (S4), F15 (twin 0165-179), F16 (twin
0165-180) · status: **done** 2026-11-09 · start HEAD `39095aee6`.

## Scope (the findings' one family)

The two documentation registers reconciled with the vocabulary and the rulings they
record — both findings are one shape: a register (the glossary's one-concept-one-term
map; principles.md's trade-off/risk tables) that stopped tracking the corpus it serves.

- **0165-179/F15 (S4)** — the glossary lags the vocabulary: a dozen terms in code and
  docs have no entry (S02's measured list: key hold, walk, sealed wall, launcher,
  adoption, info class, knowledge boundary, tree lanes, regression lane, clarify,
  driver-helper, width — some predating v0.3.0).
- **0165-180/F16 (S4)** — principles.md's registers stale against 0124–0164: R2/R4/R7
  "last showed" cells behind the corpus; T8 a candidate annotation (0163's key hold);
  two candidate new trade-off rows (0129's lock-free fork, 0145's adoption); T3
  re-read as context-only (0162's 3600 s reap — trigger not fired).

## Plan (before editing)

1. Ruling **0226** written first (next free number verified by `ls plans/`) — the
   register-refresh rule: what a refresh owes (currency at its landing moment, every
   cell cited, the mid-cycle register row for the principles.md edit), the glossary
   term list with each term's owning home, the register cells that change and the rows
   re-read standing. Wave WA-docs: 0165 is evidence, not authorization.
2. Enact `docs/glossary.md`: the twelve rows (each verified against its owning
   module's header at HEAD), the fixable/manual row widened to the three-class
   vocabulary (fixable / manual / info — 0135).
3. Enact `docs/principles.md`: R2/R4/R7 refreshed, T8's ruled cell extended (0163 D1),
   T10/T11 added (0129, 0145); T1–T7, T9, R1/R3/R5/R6 re-read standing.
4. `docs/releases.md`: one mid-cycle amendment register row (the principles.md edit is
   reconciliation — 0225 D6's rule).
5. Pin `test/docs-registers-reconciliation.test.ts` (the 0225/065 docs-pin pattern) +
   its `test/lanes.ts` row; fail-before proven over HEAD's doc bytes (`/tmp/066-head`).
6. INDEX row 0226; no AGENTS.md navigation change (no code mapping moves); program
   bookkeeping; commit.

## Execution log

- 2026-11-09 (delegated worker): step opened after step 065's commit (`39095aee6`,
  verified `git log -1`). Evidence read: the 0165 register rows + S02-corpus-audit's
  Register currency / Navigation-and-docs-currency sections and the S02-07/S02-08
  records; the owning headers at HEAD — `src/keyring.ts` (0163 D1's hold, D2's walk),
  `src/wall.ts` (0132, amended 0189/0190), `src/shell.ts` (`laneLauncher`, 0068 §6.4
  D2 + 0213's self-invoke), `packages/auto-server/docs/daemon.md` §confinement
  launcher (0162 D4), `src/external-dirs.ts` (0122/0147/0188), `src/regression.ts`
  (0098), `src/clarify.ts` (0116, 0204 D1), `src/driver-helper.ts` (0105),
  `src/lanes.ts` (0126's treeTiers), `src/config-fix.ts`'s classes (0135); INDEX rows
  0129/0135/0145/0161/0162/0163; the post-review rulings that touch the register
  cells (0198→0201 D2 the manual-suite lockstep, 0225 D4 the threshold retirement,
  0225 D1 P4's adoption wording).
- 2026-11-09: ruling **0226** written first (Derives P18/P19/P13/P5, Tier
  documentation, premises this ruling changes: none — every cited ruling re-read
  standing; Category scope enumerated). Enacted in order: the glossary rows (the
  Lanes block: width, tree lanes, the two launchers, regression lane; the gates
  block: knowledge boundary, sealed reference wall; the recovery block: adoption;
  the routing block: key hold, new-session walk; the config block: the widened
  fixable/manual/info row, clarify, driver-helper), the principles.md registers
  (T8's two cells, T10/T11, R2/R4/R7), the releases.md mid-cycle register row, the
  pin + its lanes.ts row, the INDEX row. Fail-before proven before the bookkeeping;
  verification green; dispositions and program updates landed in the same commit.

## Verification (the step's close)

- `bun typecheck` — exit 0.
- Full suite: **3218 pass / 0 fail** (158 files) — the 3215/0/157 baseline plus the
  pin file's 3 tests, nothing else touched.
- Fail-before proof over `/tmp/066-head` (HEAD's pre-fix doc bytes extracted
  read-only via `git show`, the pin needles evaluated against them by a mirror of
  the test's tables): **23/23 pins red, 5/5 stale wordings still present** at HEAD —
  the exact state the findings measured (the twelve terms absent, the registers'
  cells at their pre-refresh values: R2's "0103", R4's and R7's "the 0110
  diagnosis", T8's pre-0163 ruled cell, the two-class finding row). Working-tree
  pin green (3 tests, 28 expects).
- The 0165 probe (`bun plans/0165-review/tools/probe.ts`): **P4 empty** (ruling
  0226 carries Derives + Category scope); P1/P2/P3 flags identical to the standing
  pre-existing set (the 0193 INDEX row, the 0224 row's test-path flag, the
  placeholder-class path refs), none added; principles.md's P3 line "73 refs, 0
  unresolved".
- No shell suite due: no packages/auto or auto-server file touched (the confinement
  launcher's row cites their docs, changes nothing there).

## Dispositions

- **0165-179 / F15 (S4)** — fixed (ruling 0226 D2): the measured dozen terms have
  their rows (thirteen — "launcher / confinement" was two concepts), each worded
  from its owning module's header at HEAD; the fixable/manual row widened to the
  three-class vocabulary (0135's info class); pinned fail-red at HEAD.
- **0165-180 / F16 (S4)** — fixed (ruling 0226 D3): R2/R4/R7's last-showed cells
  current (0161 + the 0198→0201 re-show; 0146's threshold retired 0225 D4 + the
  AGENTS.md re-showing; the review's 41-in-9-days with the due cut named), T8's
  ruled cell extended (0163 D1, 0219 D2), T10 (the lock-free read-only channel,
  0129) and T11 (adoption, 0145) added with reopening conditions, T3 re-read
  context-only, T1–T7/T9 and R1/R3/R5/R6 re-read standing; the principles.md edit
  recorded in releases.md's mid-cycle amendment register (reconciliation class);
  pinned fail-red at HEAD.

Residuals (the ruling's named list): the glossary's package section still lacks an
auto-server row (step 067's family — server docs); the refresh is a snapshot, not a
mechanized watch (the per-release audit the standing re-census, the next cut its
first consumer); the cells' currency is as of 0225 — later rulings owe their own
cell updates in the same change.

Step done 2026-11-09. Ruling 0226 active-authority; the INDEX row, the ledger rows,
the status row and the program's current position land in this step's commit.
