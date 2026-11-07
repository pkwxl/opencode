# Step 045 — w8-formulation-reconstruction: formulation todo reconstruction, --new-task overwrite guard, synthDigest durability

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W8-planning (the review seam of the formulation step: `src/formulate.ts` +
`src/loop-plan.ts` + `src/prompt-plan.ts` + the runner's formulation collect,
0095/0097/0101/0171), findings **0165-014** (S08-01, S2), **0165-015**
(S08-09, S2) and **0165-100** (S08-07, S3). Started 2026-11-07 at HEAD
`7293d51bb` (tree clean; steps 001–044 done; no recovery needed).

## Findings (from plans/0165-review/S08-formulation.md)

- **0165-014 (S08-01, S2)** — 0101 stage C widened every dispatch predicate to
  "wherever the todo sits — beside hand-added tasks too", but
  `formulationState` still reads any second index entry as `foreign`:
  `constructFormulation` fails "lists work beyond the formulation task", so
  after a `plan --new-task` add at the review stop transfer exits 2 with no
  remedy and plan exits 1 naming transfer — a loop with no command out.
- **0165-015 (S08-09, S2)** — dispatching the reviewed formulation beside a
  `--new-task` task overwrites the person's task silently: the floor's
  numberStart is the standing todo's own id + 1 — exactly the id addTask
  allocated — the floor never renders the index's rows so the add leaves the
  digest unchanged and the stale numbering dispatches, and the collect neither
  preserves pre-existing rows nor counts the phase's own pending ids as taken.
- **0165-100 (S08-07, S3)** — the reviewed todo's identity (synthDigest) lives
  only in gitignored `.auto/units.json`: in a fresh clone, a fork worktree or
  after `.auto/` is cleared, `plan` refuses an unchanged reviewed todo with "an
  input changed since construction" and the transfer it names re-runs the
  constructor — under a charter, a nondeterministic re-voicing of a todo the
  person already reviewed.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0205** written first (Derives P2/P6/P7/P18/P20; Amends 0097 D6's
   record home and 0101 D3/D4's constructor scope; premise guard against
   0097 D6/0141 D2; Category scope: the formulation review-seam family).
2. D1 (0165-014): `formulationState` keys on the awaiting predicate — `pending`
   wherever the formulation todo stands (beside hand-added rows), `foreign`
   only when no formulation task of the phase is listed; the constructor then
   rewrites the todo alone (the index untouched on the re-entry path).
3. D2 (0165-015): the review-seam prefix — for a never-dispatched (pending)
   standing formulation, the floor renders the phase's other rows as a fixed
   prefix block in the todo (`existingTaskList` lines) and the numbering start
   becomes the deterministic floor (the same derivation addTask allocates
   from); the digest then moves with an add, so the digest-keep re-renders
   through transfer's reconstruct instead of dispatching stale numbering. The
   collect backstop at the unit's first dispatch: the unit-start baseline's
   committed index rows (minus the formulation row) are the fixed prefix —
   rows present, in order, unchanged; their documents untouched; the per-task
   checks skip them. A ran (blocked) formulation keeps today's row-blind floor
   (its extra rows are the session's own output, 0141 D2's re-dispatch shape)
   reading its prefix back from the landed todo's driver-written `Prefix:`
   field.
4. D3 (0165-100): the floor digest's home becomes the landed todo's own
   driver-written `Floor-Digest:` field — committed with the todo it describes,
   durable across fresh clones and fork worktrees; the `.auto/units.json`
   record stays the pre-field fallback reader, and the record write retires.
5. Regression pins (fail-before on pre-fix source): formulate.test.ts (the
   state predicate + the todo-only rewrite beside rows), transfer.test.ts (the
   walkthrough: reconstruct-beside-add → the block/numbering → the dispatch
   with the person's task surviving; the collect's prefix guard; the
   cleared-`.auto/` digest durability under a charter).
6. Full verification (`bun typecheck` + `bun test` + the three prompt suites as
   a guard), docs (ruling 0205, INDEX row, navigation line), ledger rows,
   program position, single commit.

## Verification

All measured on the committed-state sources; the fail-before proof over
/tmp/045-prefix and /tmp/045-fixed (the six changed src files backed up both
ways — HEAD's pre-fix content and the fixed working tree — the pre-fix files
swapped in, the suites run, the fixed files restored, cmp-verified
byte-identical, the suites re-run green).

- **auto-core**: `bun typecheck` clean; full suite **3117 pass / 0 fail**
  (155 files) — the 3111/155 baseline + the 6 new tests, zero regressions.
  The doc-reading suites re-run green after the documentation edits
  (constitution-ratchet, driver-helper, document-roles, config-fix,
  gitignore, intent: 157 pass / 0 fail).
- **The three prompt suites** (guard — `src/prompt-plan.ts` touched, no
  `templates/prompts/*.md` changed): **154 pass / 0 fail**; the
  formulation-todo goldens byte-identical (the fixed-prefix block renders
  only when a prefix stands).
- **packages/auto / auto-server**: not run — no shell or server source or
  surface touched.
- **Fail-before proof** (the 6 new pins, each red on pre-fix source; the 31
  pre-existing tests of `test/formulate.test.ts` + `test/transfer.test.ts`
  green on it — the byte-identical floor):
  - the state predicate (0165-014): toEqual mismatch — `{type: "foreign"}`
    received where `pending` stood (the S08-01 recognition);
  - the in-flight-beside-rows pin: the refusal lost its own voice (foreign
    instead of "already in progress");
  - the construction-records pin: neither field ever rendered (pre-fix
    `constructFormulation` takes no record);
  - the walkthrough (0165-015): Expected 0 / Received 2 — the reconstruct's
    S08-01 exit before the teaching, the dispatch and the survival could
    even run;
  - the collect guard (0165-015's misbehavior half): the same reconstruct
    exit 2 (fails before the collect);
  - the durability (0165-100): the landed todo carries no `Floor-Digest:`
    field, and after `rm -rf .auto` the keep misses (the constructor
    re-voiced — the 0097 D6 churn the finding measured).
  - Fixed sources restored byte-identical (cmp over all six), the three
    formulation suites re-run 63/0 green.

## Dispositions

- **0165-014 (S08-01)** — **fixed** under ruling **0205 D1**:
  `formulationState` keys on the awaiting predicate — `pending` wherever the
  formulation todo stands (beside hand-added rows too, the state 0101 stage
  C widened every dispatch predicate to; the constructor's own arm now
  shares it), the reconstruct rewriting the todo alone (the index's other
  rows never touched — the re-entry path never writes the index), the
  in-progress refusal keeping its own voice beside rows, `foreign` only when
  no formulation task of the phase is listed (the message restated to the
  new truth, no parser reading it). Pinned at both levels (the unit state
  machine + the walkthrough's reconstruct exit 0 with both rows intact).
- **0165-015 (S08-09)** — **fixed** under ruling **0205 D2**: the review-seam
  fixed prefix, three halves each derived and nothing persisted — (i) the
  predicate: only a never-dispatched (pending) formulation reads the index's
  other rows as its prefix (a ran/blocked one keeps the row-blind floor so
  its session's crashed rows stay rewritable per 0141 D2, that state's
  prefix read back from the landed todo's own `Prefix:` field); (ii) the
  teaching: the todo renders the prefix as a fixed-prefix block
  (`existingTaskList` lines) and the numbering start becomes the
  deterministic floor — the same derivation `addTask` allocates from, so the
  taught number can never be one the add already took — and the floor
  document carries the prefix so the digest moves with an add (the keep
  misses, plan's 0101 D4 refusal routes through transfer's reconstruct,
  never dispatching stale numbering); (iii) the collect backstop: at the
  unit's first dispatch the unit-start git baseline's rows (minus the
  formulation's own) are fixed — present, in order, id/title/tick unchanged,
  state files byte-identical (`contentAtBase`; a failed read degrades to the
  unchecked floor, the addedLines precedent), their ids skipped per-task; a
  retry does not enforce. The `Formulate:`/`Closed:` planned-task guard
  extends to `Prefix:`/`Floor-Digest:`. Named residuals: an add while the
  formulation sits blocked, and a killed-then-resumed first dispatch, are
  guarded by the teaching alone.
- **0165-100 (S08-07)** — **fixed** under ruling **0205 D3**: the floor
  digest's durable home is the landed todo's own driver-written
  `Floor-Digest:` field — committed with the todo it describes, so a fresh
  clone, a fork worktree or a cleared `.auto/` keeps the reviewed todo (no
  false "an input changed since construction", no charter re-voice). The
  digest computation is unchanged and era-compatible (the preview never
  carries the digest of itself; a pre-0205 recorded digest equals a
  post-0205 computed one over the same floor); the `.auto/units.json`
  record stays readable as the pre-0205 fallback and its write retires.
  Named residual: a pre-0205 standing todo in a fresh clone still
  re-constructs once (the era boundary — the pre-fix behavior, unchanged).
- **Discovered in-change** (recorded, unacted on): none beyond the named
  residuals; the exec commit landing between the session and the collect
  (the reason the prefix snapshot reads the unit-start baseline, not HEAD)
  is now stated in `contentAtBase`'s comment — the misreading it prevents
  was caught at design time, not measured in the field.
