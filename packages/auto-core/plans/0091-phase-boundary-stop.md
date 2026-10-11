# 0091 — The phase boundary stop: one phase per hand-over

The working rulings, kept verbatim as the design record. Status: landed 2026-10-11.

## The problem

run.md's phase transfer carried the loop straight through the boundary: handover child, phase close-out,
planning child for the next phase, back to the task loop — until the round's phases ran out. But the
boundary is where the person's review naturally sits: the closed phase's handover document (its OPEN
decisions above all), its task reports, the commit list. A session that plans and starts the next phase
immediately consumes that review window — the next phase's planning reads the handover as settled input,
and reworking a phase already closed is far heavier than reviewing before the next one is planned.

## The rulings

- **D1 — the boundary is a stop by default.** After the handover child's close-out passes its mechanical
  checks, the master control Finishes: the report names the phase handed over, its `PLAN handover` /
  `PLAN transition` commits, and the review it waits for. The round's last boundary coincides with the
  round-complete Finish as before (the report says the round is complete and its close is the person's).

- **D2 — the restart continues with no new machinery.** The person hands the same file over again: the
  restart re-reads `phases.md`, takes the next not-closed phase through the ordinary boundary check, and
  the loop's step 0 plans a phase whose directory holds no `tasks.md` (the planning child + the `PLAN
  plan` commit) — the existing restart seam, unchanged. The loop's step 0 cross-reference follows the
  renumbered step.

- **D3 — `phases: all` lifts the stop.** One phrase in the hand-over line, riding beside the mode phrases;
  under it the loop continues from phase to phase as before. The report names the phrase when it rode
  (like a mode line) so the person's restart repeats it.

- **D4 — the modes are independent.** The wall bounds a run's length, the phrase its scope: a sprint that
  reaches a boundary without the phrase stops there — ending properly before the wall — and an unattended
  run usually names the phrase, since nobody is there to review between phases.

- **D5 — the ratchet pins the stop's literals** (the phrase, the one-phase-per-hand-over framing, the
  default-stop step, the gated continuation step, the report-naming rule) so drift is a conscious change.

## What is deliberately not done

- No per-phase consent machinery and no new file state: the stop is the absence of the next launch,
  resting on the existing Finish report and the park/resume rules.
- The no-phase mode is untouched — one implicit phase, its end already the person's.
- Nothing in the companions changes: the handover child still runs at every boundary; the planning child
  is simply launched by the next hand-over (or under the phrase) instead of the same session.
