# 0314 — Retire the push loop root

## Category scope

Push session removal under 0279 and 0296 — 0256 stage 6's demolition track,
after 0311 (push transfer), 0312 (push handover) and 0313 (push synthesis).
The legacy root still held the run entry (`src/loop.ts`), the phase loop
(`src/loop-phase.ts`), the push planner (`src/loop-plan.ts`), the plan gate
(`src/plan-gate.ts`), the bypass-session skeleton (`src/artifact.ts`), the
blockage diagnosis (`src/blockage-diagnose.ts`) and the charter verifier's
parser (`src/prompt-verify.ts`). 0283 had already tombstoned the CLI
commands that reached them; no shell path ran them.

## Decision

**D1 — the root set goes together.** Delete the seven modules (1,964
lines). The caller set was measured at this change: neither bin reaches
them by a value edge, and no shell imports an `auto-core/loop` path. The
phase-boundary acts the pull path keeps already have their homes — the
executor grants (`src/executor-steps.ts`, `src/executor-coordinator.ts`),
deterministic transfer, plan's prelude and clarify — and are unchanged.

**D2 — what the root alone consumed goes with it.** Two templates exclusive
to it (`templates/prompts/default-check.md`, `_mode-brief.md`) leave the
embedded registry; `diagnose.md` stays because the session-role registry
pins it, its kind docketed to the session-layer slice. The exports of live
modules whose importer set emptied are removed with their unit tests:
blockage.ts's block map, span locator, honest block line and dossier;
`tasks.ts` `resetPlanning`/`runtimeSplit`; `plan.ts` `plannedLines`/
`roundCompleteNext`; `phases/registry.ts` `anyCodeWork`;
`git-worktree.ts` `commitsSince`; `formulate-parts.ts` `formulationParts`,
the push compose's booking half. Six further exports keep their bodies and
lose the `export` keyword (`RemediationPlan`, `executeBlockageChoice`,
`phaseFlowBlockedText`, `appendInputRetiredLine`, `retiredAppendResumeLine`,
`StepKind`).

**D3 — the tests follow the behaviour, not the driver.** The live pins
moved to the pull entries with hand-seeded boundary state (`donePhase`,
`finishPhaseWork` in `test/fixtures/loop.ts`) and the coordinator's grants:
`transferDeterministic` (transfer, transfer-wall, survey-gate, the boundary
and repair cases), `planPrelude`, `clarifyGate` and
`openExecutorCoordinator` (close-audit). Pins stranded by the move were
carried to the suites of their new producers (executor-distill,
executor-formulate). Two assertions whose only producer was the loop's own
stop (the stub-brief duty line on run's stop, run's banner for a taskless
knowledge phase) went with it; plan's own refusal is still pinned.

**D4 — `OPENCODE_AUTO_REMEDIATE` is a tombstone.** Its one reader was the
diagnosis step. The plan operation's row that executes a person's `Choice:`
marks never read it (0172) and still runs.

premises this ruling changes: 0082 D3 (the operating-mode brief — its
template and 0216 D3's exit-line ratchet are gone), 0082 D4 (the diagnosis
session on the `requireArtifact` skeleton), 0082 §10 D12 (the charter
check's caller wiring; the clamp module stands, its caller set the session
layer's), 0080 §5 (the plan verifier's parser; its session left in 0283),
0049 G5 and 0053 D6/D12/D15 (the plan-review pause and the stop-condition
branch were the loop's; plan's prelude rows stand on their own), 0101 D1
(run's boundary stop — transfer's stop stands), 0128 (`--stop-after`, a
`run` flag) and 0067 P3a (the `RunAllOpts` io/Interactive seam). Each was
re-read: the rulings named the push driver as their actor and have no pull
counterpart, so they stand as history rather than being amended.

## Measured

- Tests: 100 declarations removed in auto-core — 45 in four whole suites
  (artifact, plan-loop, stop-after, interactive-seam) and 55 across 22
  trimmed suites — and 13 declared; the suite ran 3372 → 3277. The CLI's six
  opt-in `runAll` e2e cases left with their fixtures (139 pass; 8 → 2
  skipped); auto-server is unchanged at 120.
- Reachability from the two bin entries: before, 171 modules / 63,863
  lines, 97 reachable by value edges; after, 164 / 61,580, 95 reachable. Of
  the 69 now unreachable by value (25,551 lines), 30 (11,725 lines) have no
  import edge of any kind from the bins — the next cut needs no live-code
  edit — and 39 hang on 18 type-only edges from 17 live modules into five
  targets (`agent/types` ×10, `document/types` ×5, `engine/contract`,
  `interactive`, `loop-preflight`).

## Residuals (docketed, not this change)

- Exports whose last production caller was the loop, left because their
  remaining callers are test fixtures of the session layer: `stats.ts`
  `flushStats`/`statsPhase`/`statsClassifyUsage` (ten suites' fixtures) and
  `statsDigest` (its own suite — `formulationParts` was its last caller,
  which makes `stats` and `stats-schema` value-unreachable),
  `run-status.ts` `startRunStatus`/`endRunStatus`, `engine/events.ts`
  `startRunEvents`, `switches.ts` `freezeSwitches`.
- Suites of modules not yet deleted lost the cases only the loop could
  drive (stop-after, park's phase-loop lifecycle, verify-loop's FAIL→fix,
  the mark-head neutralization).
- `renderDryrun` and its template: 0296 docketed the dryrun flow to 0297+.
- The exit codes `3`, `130`, `143` and `129` have no producer in core; the
  vocabulary (AGENTS.md's operational line, `RUN_EXIT_CODES`) is frozen
  under P13 and retires by tombstone with the session layer.
- `docs/glossary.md` and `docs/shell-contract.md` still describe the push
  era's `runAll` contract; they follow the session-layer slice's
  documentation pass.

Derives P21 (deletion lands when the caller set empties, measured above),
P5 (one home per mechanism — the push twins leave, the pull homes stay),
P13 (the switch retires through its tombstone), P10 (the pull path's
behaviour is unchanged; the migrated pins are the proof) and P19 (every
count above is measured). Tier II throughout; no principle statement moves.
