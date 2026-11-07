# Step 057 — wd-formulation-tier: the formulation's planning route, the probe reading its own evidence, the classifier's cached instant

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave WD-routing, findings **0165-031** (S16-04, S2), **0165-032** (S16-05, S2)
and **0165-127** (S16-03, S3). Started 2026-11-08 at HEAD `03b03d054` (steps
001–056 done); ruled by
[../0217-formulation-route-probe-evidence.md](../0217-formulation-route-probe-evidence.md).
This step opens the WD-routing wave.

## Findings (from plans/0165-review/S16-routing.md)

- **0165-031 (S16-04, S2, TRACE, 0055 §5)** — since 0095 the phase's planning
  (the formulation task) routes as an ordinary `whole` task — the phase type's
  execute tier, `simple` for implement/test/knowledge — while 0055 §5's tier
  table (`phase-plan` deep, "every later session inherits their mistakes"),
  tier.ts's header, 0113 D2 and the role registry's `planning: deep` all still
  describe a deep planning route; an operator's `routes.phase-plan` silently
  stops reaching the session it was written for, and preflight still checks
  that route's coverage as "the planning need". The judge question this step
  answers explicitly: defect (routing drift since 0095/0101) or accepted
  reshape.
- **0165-032 (S16-05, S2, FAIL, 0055 §6.3)** — the wait-and-probe loop probes
  against its own evidence: the probe candidate is the first in-window
  candidate in list order "ignoring the down marks", so a primary the driver
  holds spent until a stated reset is probed every poll round (its `until`
  mark cleared for the probe, and lost when the probe round itself errors)
  while a fallback whose recovery is unknown — the one candidate a probe can
  learn something about — is never probed.
- **0165-127 (S16-03, S3, DEF, 0055 §7.1 Cost)** — the classifier's run cache
  keys on the message with its times and digits masked, but the cached answer
  carries an absolute `resetAt` computed against the first ask's clock: a
  later failure of the same wording with a different stated reset ("resets at
  21:00" then "resets at 22:00"; "try again in 3 hours" asked again hours on)
  is answered with the first message's instant — too early (the mark lapses,
  the model retried into the same spent window) or already past (dropped, the
  mark degrading to the scope boundary).

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary per finding first (P15/P19
   for 031 — the tier table's letter is policy data, and the drift is
   measured; P19/P12 for 032 — the probe must act on the evidence held;
   P12/P19/P6 for 127 — a stale instant is not evidence). Re-read 0055
   §5/§6.3/§7.1, 0095 D1, 0113 D2, 0057 S4, 0144 D1/D2, 0163 D1, 0178 D1/D4,
   0179 (premises checked — 0179's residual names this probe seam). Write
   ruling **0217** first.
2. Enact per decision with the fail-before proof pattern over /tmp/057-fixed
   (changed src files backed up, `git show HEAD:./` pre-fix versions swapped
   in, the new pins run red, fixed files restored, cmp-verified).
3. Full verification (`bun typecheck`, `bun test`; baseline 3185/0/156).
   Core routing homes — no packages/auto or auto-server surface expected.
4. Docs lockstep (INDEX row for 0217 + annotations, AGENTS.md navigation
   lines if the mapping changes, structure.md rows), ledger rows for
   031/032/127, program position; single commit.

## Work log

- 2026-11-08: step record created; status table marked `doing` (starting
  HEAD `03b03d054`). Read the S16-04/S16-05/S16-03 evidence, the source homes
  (formulate.ts's `decompose: "whole"` construction; select.ts's probe arm
  and recoveryAt; classify.ts's cache key/known fast path and the router's
  cache state; router.ts's probeSelection and ProbeTarget; session.ts's
  awaitRecovery re-mark sites; recovery.ts's consult/cachedAnswer;
  runner.ts's runTask chain construction; loop-preflight.ts's dispatchNeeds;
  tier.ts and roles/registry.ts), the ruled letters (0055 §5/§6.3/§7.1; 0095
  D1/D4; 0113 D2; 0053 D12's m-mode table; 0057 S4; 0163 D1; 0178 D1/D4;
  0179 D1 and its named residual "the probe's wholesale key-mark clear …
  never re-drawn here"), and docs/principles.md (P6/P10/P12/P13/P15/P19).
  Ruling 0217 written first.
- 2026-11-08: enactment — D1: `src/chain-transitions.ts` (the `setRole`
  transition, stage-scoped), `src/runner.ts` (the role set at the
  formulation's whole stage, cleared at the subtasks boundary, threaded into
  the recovery ladder's existing role parameter for a whole-stage record),
  `src/loop-preflight.ts` (the m-mode planning need's word),
  `src/tier.ts`/`src/roles/registry.ts`/`src/chain.ts` (the headers and the
  planning descriptor's 0095 annotation corrected to the new truth). D2:
  `src/select.ts` (the probe arm's evidence ordering),
  `src/router.ts` (probeSelection captures the cleared mark, ProbeTarget
  carries it), `src/session.ts` (the two failed-probe re-marks restore the
  remembered fields, the probe failure's own stated reset still winning).
  D3: `src/classify.ts` (`classifierTimeKey`, the `reuseOf` rule, the known
  fast path, the join's wrapped resolution), `src/router.ts` (the cache
  value `{answer, timeKey}` and the accessors' signatures). One in-change
  repair: the D1 pin's first draft found the verifier session's embedded
  copy of the composed formulation prompt (also on the planning route, so
  the pin passed pre-fix by accident) — the find now requires a non-bare
  prompt, and the pin went red on pre-fix source as it must.
- 2026-11-08: fail-before proof over /tmp/057-fixed (the ten changed src
  files backed up, `git show HEAD:./` pre-fix versions swapped in, the pins
  run, the fixed files restored and cmp-verified byte-identical); full
  verification; docs lockstep (the 0217 INDEX row + the 0055/0095
  annotations, the AGENTS.md formulation and model-registry navigation
  lines, three structure.md rows); the program status/ledger/position
  updated; committed.

## Verification

`bun typecheck` exit 0; auto-core full suite **3190 pass / 0 fail** (156
files = the 3185 baseline + 5 net new, zero regressions). Fail-before proof
over /tmp/057-fixed: **5 pins + the preflight arm red on pre-fix source** —

- D1 formulation dispatch (1 pin, two fixtures): the formulation session's
  prompt receiving **`model: "prov/b"`** — the simple tier's first — where
  the planning route's `prov/a` is expected (the finding's scene verbatim;
  the second fixture's operator route case covered by the same pin).
- D1 preflight arm (1 test extension): the m-mode coverage line reading
  **"the implement-scan sessions of this run"** where "the phase-plan
  sessions" is expected — the dead word verbatim.
- D2 probe choice (1 pin): the mixed-evidence list (opus until +6 h, opus-b
  and k3 until-less) probing **opus** — the spent primary — where opus-b
  (unknown recovery) is expected; the finding's own repro.
- D2 dance preservation (1 pin): the failed probe's re-mark received as
  **`[{}]`** — the bare mark, the stated reset erased — where
  `[{until: aReset}]` is expected.
- D3 cache (1 pin): the differing-time repeat (same masked key, 15:00 →
  21:00) receiving the full stale instant `{class: "quota", resetAt}` where
  the class alone is expected.

The floors green on pre-fix source (the all-until-less probe's
first-in-window — the retitled floor pin; the matching-time reuse pin; the
join's shared call; every other pre-existing test of the touched files).
No packages/auto or auto-server source touched — no shell suite re-measured
(the step-050 environment-drift records stand).

## Dispositions

- **0165-031 (S16-04, S2)** — fixed (ruling 0217 D1): the judge question
  answered explicitly — a routing defect since 0095, not an accepted
  reshape (the tier table's letter is the planning-deep row and its
  rationale applies verbatim to the formulation session; 0095 changed the
  machinery and consciously retired the m-mode special role, but confronted
  neither the tier consequence nor the three surfaces still asserting the
  deep planning route). The formulation's whole-stage session rides the
  planning word (stage-scoped chain role), the operator's `phase-plan`
  route and the deep tier reach it, the unit's tail keeps its roles, the
  strict-resume ladder judges under the same word, preflight's m-mode need
  reads the word that dispatches. Named residuals: the wrap-up keeps the
  wrapup role (0055 §5's letter); `implement-scan` remains a
  dispatch-matching-nothing routing word (its state since 0095); a
  `whole`-keyed route stops reaching the formulation (the correction's own
  letter); the implicit-registry floor byte-identical.
- **0165-032 (S16-05, S2)** — fixed (ruling 0217 D2): the probe reads the
  marks' `until` evidence (the unknown-recovery in-window candidate first,
  the first in-window standing when all are known spent, the no-in-window
  backstop unchanged) and the probe dance preserves a cleared stated reset
  through the failed probe's re-marks (the probe failure's own fresher
  reset still winning; an errored probe round no longer erases the reset).
  recoveryAt unchanged — its withholding and the probe now agree on who the
  poll is for. Named residuals: the all-in-window-spent +
  until-less-window-blocked scene polls and probes the spent candidate each
  round (bounded, its instant preserved); the key-mark wholesale clear
  stays 0178 D1's bounded consequence.
- **0165-127 (S16-03, S3)** — fixed (ruling 0217 D3): the cached class
  stays shared under the masked key (the budget clause standing, nothing
  re-asked); the answer is stored beside the ask's time evidence and the
  instant is served only on matching evidence — the differing repeat
  receives the class alone (the mark clearing at the scope boundary, and
  with D2 the until-less mark is the probe's preferred target). The
  in-flight join stays masked-keyed with the joiner's resolution through
  the same comparison. Named residuals: the relative-duration repeat at a
  later clock reuses a wrong-but-future instant for one mark (the finding's
  own one-wasted-dispatch bound); three-plus concurrent same-wording
  failures with differing times may read a later ask's stored entry through
  the join (the two-failure case exact).
- Premise guard: 0055 §6.3's probe-choice letter, 0055 §7.1 Cost's cache
  letter and 0095 D1's m-mode routing-role bullet amended — all three INDEX
  rows annotated in the same change. Re-read standing: 0057 S4 (the
  withholding, now aligned with the probe), 0057 §5.3, 0113 D2 (its
  planning-deep premise restored rather than changed), 0163 D1, 0178 D1/D4,
  0179's residual (the model-mark half drawn here, the key-mark half still
  0178's bounded consequence), 0053 D12 F5.
- Commit: the step's single coherent commit (subject "0166: step 057 done
  — ruling 0217 …", finding ids in the body's trailing parenthetical); the
  SHA recorded in the program table's row by the next step's start HEAD
  convention.
