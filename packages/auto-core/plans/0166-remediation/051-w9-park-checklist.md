# Step 051 — w9-park-checklist: park/repair hook arms, repair confinement truth, checklist split boundary, decompose re-derivation, requireArtifact order

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W9-lanes, findings **0165-017** (S10-03, S2), **0165-082** (S05-05, S3),
**0165-083** (S05-06, S3), **0165-106** (S10-04, S3) and **0165-107** (S10-06,
S3). Started 2026-11-08 at HEAD `1f68df9b6` (steps 001–050 done); ruled by
[../0211-park-checklist-recovery.md](../0211-park-checklist-recovery.md)
(this record links it once written).

## Findings (from plans/0165-review/S05-loop-task.md and S10-dispatch.md)

- **0165-017 (S10-03, S2, P7/P2/P21)** — outside the lead's split clause, a
  checklist a whole-task session writes into `subtasks.md` is run as the
  person's: mode off (or auto's lead without the clause) dispatches one
  session per agent-written item — no 2–5 bound, no disjointness guard, no
  rejection (`execute.ts:387-392` `unjudged()` returns `[]` when
  `split === "none"`; `runner.ts:713-727` runs every unticked item).
- **0165-082 (S05-05, S3, P2/P20, 0012/0027/0055 §6.4/0096 D7/0079 §4)** —
  the serial path's park and repair-close arms return 0 without the
  task-boundary hook set: no step pause, no /exit checkpoint, no hibernate
  check, no task-scope down-mark clear or /failback consumption between that
  unit and the next; the doc loop's blocked-keep arms skip them the same way
  (`loop-task.ts:527-539` the parked arm under a false comment, `:553-554`
  repair-appended, the doc loop's landing/flattened blocked-keep arms).
- **0165-083 (S05-06, S3, P5, 0079 §4/§6, 0156)** — the `--repair`
  confinement ("never under worktree lanes or branch isolation" —
  `RunAllOpts.repair`, AGENTS.md) is enforced nowhere: `repairRoundAppend`'s
  only guards are the stop condition and the budget, so the worktree-lane
  loop's serial degrade and both phase-level gate sites open repair rounds
  under worktree lanes and the isolation switch.
- **0165-106 (S10-04, S3, P6/P8/P20, 0021/0030 D5/0149)** — a kill between
  the decompose session's end and its `decompose` commit is not re-derived:
  the re-run's "already exists" path injects the uncommitted checklist
  without committing it, and subtask 1's clean gate stops exit 2 on the
  unit's own decomposition as "leftover from an abandoned run or manual
  changes" (`execute.ts:695-710`).
- **0165-107 (S10-06, S3, P6/P8/P20, 0018/0021 P2/0149)** —
  `requireArtifact` runs the unit clean gate before `spec.reset`: an
  interrupted phase step whose session is gone stops `dirty` on the killed
  session's own partial artifact, though the caller's contract says "a partly
  written handover is cleared by reset and rewritten" (`artifact.ts:186-196`
  the gate precedes `:198-203` the reset).

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary for each finding first
   (requirement family, home-set enumeration). Write ruling **0211** first
   (Status: active; Derives/Amends with showing clauses; Category scope;
   D1..Dn; premise guard; named residuals; P13 statement).
2. Enact per decision; regression pins that fail on pre-fix source.
3. Full verification (`bun typecheck`, `bun test`; baseline 3147/0/155).
4. Docs lockstep (INDEX row, AGENTS.md navigation, structure.md), ledger
   rows for 017/082/083/106/107, program position; single commit.

## Work log

- 2026-11-08: step record created; status table marked `doing` (starting
  HEAD `1f68df9b6`). Read the S10/S05 evidence, the source homes
  (execute.ts's split guard and ensureDecomposed, loop-task.ts's four arms
  and taskBoundary, loop-preflight.ts's RunAllOpts.repair, artifact.ts's
  unit gate) and docs/principles.md; answered the boundary per finding;
  ruling 0211 written first.
- 2026-11-08: enactment — execute.ts (D1 the every-scope base, the
  none-scope drop at the close-out and in the blocked/parked arms,
  judgeSplit's none guard; D4 the existing-path decompose commit moved
  before BOTH injection returns — the loaded-checklist fast path fires
  first in the real kill scene, caught by the pin), loop-task.ts (D2
  `closeOutAudit` extracted, the parked/repair-appended serial arms, the
  doc loop's two blocked-keep arms), loop-preflight.ts (D3 the boundary
  restated), artifact.ts (D5 the open-record gate key).
- 2026-11-08: test homes — agent-fake (+3: the mode-off drop pin, the
  mode-off committed floor, the doc-loop repair round; the two 0059 D7
  pins re-pointed to the ruled behavior — the conscious lockstep of D1's
  amendment), park (+2: the parked /exit label, the parked foreign-commit
  audit), repair-loop (+1: the repair step pause over the recording repl),
  auto-doc-shape (+1: the kill-window commit), artifact (+1: the
  dead-session partial artifact). Two enactment defects caught by the pins
  before commit: the doc-loop pin's step clamp did not survive
  runDocLoop's registry reset (re-keyed on the harness's env override);
  the porcelain assertion in the mode-off pin mistook the loop's own
  close-out for the pipeline's (re-asserted on the exec commit's shape).
  Fail-before proof over /tmp/051-fixed; full verification; docs lockstep
  (INDEX row + the 0156/0059 annotations, four AGENTS.md lines, three
  structure.md rows); committed.

## Verification

`bun typecheck` exit 0; auto-core full suite **3155 pass / 0 fail** (155
files = the 3147/155 baseline + 8 net new, zero regressions). Fail-before
proof over /tmp/051-fixed (the four changed src files backed up, `git show
HEAD:` pre-fix versions swapped in, the pins run, the fixed files restored
and cmp-verified byte-identical): **9 pins red on pre-fix source** —

- D1 (3 pins in agent-fake.test.ts): the mode-off checklist pin — three
  prompts (the whole session plus both item sessions), the checklist
  committed and run as the person's, the removal line never printing (the
  finding's impact verbatim); the two re-pointed 0059 D7 pins (cannot-fork
  lead, STEER-off lead) red against the ruled-new expectations — the
  pre-fix defect demonstrated from its own suite;
- D2 (4 pins): the parked /exit landing at "task T-003 …" (the next
  unit's done boundary — the request waited through the whole blocker
  run; post-fix "task T-002 …", T-003 never dispatched); the parked
  foreign commit completing code 0 uncaught (post-fix exit 2 with the
  close-out failure naming the non-driver commit); the repair step pause
  never naming the failed task (its landing skipped the hooks; post-fix
  the pause lands at T-002's boundary before the appended tasks); the
  doc-loop repair round opening with no landing pause for the failed unit;
- D4 (1 pin in auto-doc-shape.test.ts): the existing-checklist path
  leaving HEAD at "init" — no commit, the artifacts the dirt the first
  subtask's gate would name "leftover from an abandoned run" (the
  repro's exit-2 dead-end one assertion later);
- D5 (1 pin in artifact.test.ts): the dead-session rung returning
  `{type: "dirty", files: ["docs/R-01/P01-implement/handover.md"]}` — the
  finding's own scene, the gate judging the killed session's own output.

The floors green on pre-fix source (the committed-checklist mode-off run,
the no-record dirty gate, the reuse rung, the legacy-output injection, and
all other pre-existing tests of the touched files). D3's behavioral
lock (the doc-loop round opening at width 2) passes both ways by design —
the defect was the stated boundary, retired in the text and pinned against
future enforcement. No packages/auto, auto-server or templates/prompts
surface touched by this step.

## Dispositions

- **0165-017 (S10-03, S2)** — fixed (ruling 0211 D1): the starting
  checklist derived for every whole-task scope; a differing checklist in a
  no-clause scope dropped at the close-out (and in the blocked/parked
  arms) through the rejected state's own dropSplit with one teaching
  line; judgeSplit never judging a none-scope checklist; the committed
  checklist floor pinned; 0059 D7's "runs after it, unjudged" consequence
  amended with its pins re-pointed.
- **0165-082 (S05-05, S3)** — fixed (ruling 0211 D2): the parked and
  repair-appended serial returns and the doc loop's blocked-keep arms run
  `closeOutAudit` and taskBoundary (probe form at the doc landing, plain
  at the flatten); the park comment corrected; the /exit label, the
  foreign-commit audit, the repair step pause and the doc-loop landing
  pause all pinned fail-before.
- **0165-083 (S05-06, S3)** — fixed (ruling 0211 D3): the confinement
  retired and the no-lane-in-flight boundary stated in RunAllOpts.repair's
  one home; the lanes-×-repair case pinned (the doc-loop round); 0156's
  hygiene clause annotated; the enforcement alternative declined on
  0098 D5/0099 D3 grounds.
- **0165-106 (S10-04, S3)** — fixed (ruling 0211 D4): the
  existing-checklist path commits the stage's `decompose` commit before
  either injection return, the tree's state the guard; the kill window
  re-derived on the re-run; the twice-failed-decomposition re-audit kept
  the compatibility read's own letter (a named residual).
- **0165-107 (S10-06, S3)** — fixed (ruling 0211 D5): the unit gate keyed
  on the open record — the fresh redo rung exempt like the reuse rung,
  the reset clearing the step's own partial artifact; a genuinely fresh
  step keeps the gate (the existing dirty-gate pin unchanged and green).
- Named residuals carried (0211): the doc-lane whole session's none-scope
  arm unpinned end-to-end; D2's hibernate half and the repair arm's /exit
  label pinned through the step pause alone; D3's lock covering the
  doc-loop task site; D4's twice-failed decomposition reused unchecked;
  D5's restart-arm input commit and the unreadable-baseline direction.
- Premise guard: 0156's hygiene clause and 0059 D7 re-read and annotated
  in the same change; 0059 D4, 0096 D7, 0012/0027/0143/0055 §6.4,
  0021 P2, 0149, 0098 D5, 0099 D3 and 0030 D5 re-read standing.
