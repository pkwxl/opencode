# Step 071 — w-vocab

Wave W-vocab · finding 0165-134 (S17-08) · status:
**done** 2026-11-09 · start HEAD `39f9a806e`.

## Scope (the finding's family)

The frozen model-route/role vocabulary family — the words a model policy key may
take (role words, phase letters, phase type ids) across every parse surface, and
what happens when a **retired** word appears there. 0225 D3's two-track
deprecation rule (a vocabulary's tombstone IS its retirement — a permanent
parse-time teaching refusal naming the successor/remedy) is the standing rule
this step enacts against the route words.

- **0165-134 (S17-08, S3, CONF, UX)** — "Retired route words fail strict
  validation as unknown words, never as tombstones: a v0.3.0-valid
  `routes.number-recovery` (0150 D2) or `understand` (0030 D12) reads 'is not a
  role word (…)' — like a typo — and, in the operator layer, stops every
  project's run on the machine". Measures: P8 (every surfaced line teaches its
  remedy), P13 (retire through tombstones), 0150 D2's own consequence line
  ("the remedy is removing the route entry"). Remedy proposed: a retired-route
  -word table beside MODEL_ROLES, its failure line naming the retirement and
  the remedy; the retirement procedure (0035) gains the row.

## The retired route words (the complete set, measured from MODEL_ROLES history)

| word | retired by |
| --- | --- |
| `understand` | 0030 D12 (M1.0, merged into `decompose`) |
| `verify-generate`, `verify-exec`, `verify-judge`, `verify-fix` | 0044 D1 (M2.2) |
| `review-audit`, `review-planfix`, `review-fixrun` | 0044 D1 (M2.2) |
| `final-plan` | 0044 D1 (M2.2) |
| `number-recovery` | 0150 D2 |

The family's three parse surfaces (enumerated 0123-style, from the code):

1. `src/models.ts` `Validator.routes` — the registry file's `routes` section:
   a retired key falls into the generic unknown-word refusal (the finding's
   primary defect). No retired-word knowledge at all.
2. `src/switches.ts` `parseModelPolicy` — the `OPENCODE_AUTO_MODEL` entry
   list: `RETIRED_MODEL_ROLES` (introduced M3.6, 84ab43869, five of 0044's
   eight words only) keeps its five words from reading as phase-type ids, but
   the refusal is the generic invalid-key line; and the five words missing
   from the table (`understand`, `verify-generate`, `verify-exec`,
   `review-planfix`, `number-recovery`) are silently parsed as phase-type keys,
   failing later at preflight with "names no phase type" — the retired word
   re-entered the vocabulary through the type-id door.
3. `src/switches.ts` `phaseTypeRoleProblems` — custom phase type ids may not
   take live-or-retired role words; the incomplete table means a project CAN
   declare a custom type named `understand` or `number-recovery` today,
   resurrecting a retired vocabulary id (P13's never-reuse discipline).

## Plan (before editing)

1. Ruling **0231** written first (next free number verified by `ls plans/` —
   0230 the last). Answer the boundary from docs/principles.md first (P13 the
   frozen additive-only vocabularies + 0225 D3's tombstone track; P8 every
   surfaced line teaches its remedy; P5 one tombstone table one owner; P12
   fail loud; P10 the byte-identical floor for non-retired words). 0165
   evidence, not authorization; Category scope enumerated; premises guard
   checked (0030 D12 / 0044 D1 / 0150 D2 / 0225 D3 / M3.6's RETIRED_MODEL_ROLES
   premise re-read).
2. Enact: `RETIRED_MODEL_ROLES` becomes the single complete tombstone table
   (10 words, each mapped to its ruling), and every surface refuses a retired
   word with a teaching line naming the retirement and the remedy
   ("remove the route entry" / the entry-list equivalent); custom phase types
   refusing retired words comes with the completed table.
3. Regression coverage that fails for the confirmed defect (the generic
   unknown-word refusal shape on retired words; the silent byType parse of the
   five missing words; the resurrectable custom type) and passes for the fix.
   Fail-before proof over a /tmp copy with HEAD's pre-fix sources.
4. INDEX row 0231; ledger disposition 0165-134; program bookkeeping; commit.

## Execution log

- 2026-11-09 (delegated worker): step opened after step 070's commit
  (`39f9a806e`, verified `git log -1 --format=%h`). Evidence read: the 0165
  register row (l.316) + S17-08 record; rulings 0225 (D3), 0030 (D12), 0044
  (D1), 0150 (D2), 0035 (§1 D3 scope, the amendment form); the sources
  (`src/models.ts` routes validator, `src/switches.ts` RETIRED_MODEL_ROLES /
  parseModelPolicy / phaseTypeRoleProblems); MODEL_ROLES history at M2.2's
  parent (779a8f9da~1 — the eight 0044 words) and the M3.6 table introduction
  (84ab43869); `test/switches.test.ts` l.288-292 (the five-word pin) and
  `test/models.test.ts` l.278 (the generic refusal pin).
- 2026-11-09: **ruling 0231 written first** (`plans/0231-retired-route-word-tombstones.md`
  — the boundary answered from principles.md before any edit: P13 the tombstone
  track and never-reuse, P8 the teaching refusal, P5 one table, P12 the silent
  byType slip, P10 the byte-identical floor for live words and typos, P19 the
  measured ten-word set; Amends none — 0030 D12/0044 D1/0150 D2 re-read
  standing, their strict-failure premise untouched, the refusal wording refined
  per 0225 D3; Tier code; premises this ruling changes: none, with M3.6's
  table premise, 0229's census and 0035 D3's scope among the re-reads;
  Category scope a 14-row table).
- 2026-11-09: enacted per D1–D4. `src/switches.ts`: the complete exported
  ten-word table with contract comment; the MODEL_ROLES comment's prose
  narration retired to the pointer; `phaseTypeRoleProblems` split live/retired
  lines; `parseModelPolicy`'s tombstone branch (the dead `!includes` guard
  removed). `src/models.ts`: the routes validator's tombstone refusal ahead of
  the vocabulary check + the import. Tests: `test/switches.test.ts` (the
  retired-words pin rewritten — ten words, the tombstone shape, the table's
  completeness against the measured set; the byType-slip regression),
  `test/models.test.ts` (the registry-routes tombstone pin — all ten exact
  lines), `test/phases-custom.test.ts` (the collision guard's retired line +
  the live message pin). Docs: packages/auto/README.md (four passages),
  plans/0035's amendment row, AGENTS.md's staged-routing line, INDEX row 0231.
- 2026-11-09: fail-before proven over the swapped-source method (the two
  changed src files backed up to /tmp/071-fixed, `git show HEAD:` pre-fix
  versions swapped in, probe and tests run, restored, cmp-verified
  byte-identical) — see Verification.

## Verification (the step's close)

- auto-core `bun typecheck` exit 0. Full suite **3249 pass / 0 fail** (161
  files = the 3246/161 step-070 baseline + the 3 net-new tests; 21110 expects).
- packages/auto (its README touched): `bun x tsgo --noEmit` exit 0; full suite
  **168 pass / 8 skip / 6 fail** — the step-069 baseline exactly, the 6 fails
  the known pre-existing set by name (the phased-P1 e2e, fork ×2, remove-fork
  ×3); the docs-truth census green (the README edits stay outside the pinned
  switch section and add no `OPENCODE_AUTO_*` token).
- Fail-before proof: the probe over HEAD's pre-fix sources reproduced the
  finding's observed verbatim — S1 the generic "is not a role word (…)" lines
  for `routes.number-recovery`/`routes.understand`; S2 `understand` and
  `number-recovery` **parsed silently into byType** while `verify-judge` threw
  the generic invalid-key line; S3 `phaseTypeRoleProblems(["understand",
  "number-recovery"])` = `[]` (the resurrection door open). The three new
  tests over pre-fix source: **3 fail / 74 pass** — models' tombstone pin red
  behaviorally (toEqual: the generic lines), phases-custom's collision pin red
  behaviorally (got `[]`), switches' pins red at the file level
  (`Export named 'RETIRED_MODEL_ROLES' not found` — the step-063/064
  precedent) with their behavioral halves carried by the probe's S2. After
  restore (cmp-verified byte-identical): the probe shows the tombstone lines
  at all three surfaces; the three files green (113 pass / 0 fail, 554
  expects).
- The 0165 probe: **P4 empty** (0231 carries Derives + Category scope); the
  other flags the standing pre-existing set (P1/P5's E2E_KEYS, P6, P7 —
  unchanged from step 069's record).

## Dispositions

- **0165-134 (S17-08, S3, CONF, UX)** — fixed (step 071, ruling 0231
  D1+D2+D3+D4): the ten retired route words are permanent tombstones at every
  parse surface — one exported table (`RETIRED_MODEL_ROLES`, completed from
  M3.6's five), the registry `routes` refusal naming the ruling and 0150 D2's
  remedy ("remove the route entry"), the entry-list refusal at parse (the
  silent byType slip closed), the custom-type resurrection door closed; the
  person-facing homes teach the same (README's four passages, 0035's amendment
  row). 0225 D3's vocabulary track enacted exactly as its letter rules.
- Recorded observations (out of this step's family, no ledger row): the
  `OPENCODE_AUTO_FORK`/`FORK_BASE` "understand session" wording in
  switches.ts comments and the README switch rows (0229 D1's census family —
  README and source agree with each other, both 0030-era); `src/artifact.ts`'s
  `spec.unitStart` comment still lists "numbering recovery" among hidden-unit
  examples (0227 D1's class). Both noted in 0231's residuals.
