# Step 027 — w-engine

Wave: W-engine. Findings: 0165-030 (S14-05, S2, CONFIRMED — the liveness probe cannot see
the half-open shape it was built for: probeSession asks only whether a GET on a new
connection succeeds, so with the server healthy and the turn's own SSE connection dead every
probe passes and resets the count, the turn never settling; with the POST already answered,
attempt's `await watching` has no bound at all), 0165-118 (S14-02, S3, CONFIRMED — the late
step-up re-fires on every later failure of the same turn: it classifies the failure slice's
merged message, which reads overflow for the rest of the turn once one overflow arrived, so an
unrelated 500 steps the session onto the next, pricier id with a log line naming an overflow
that never happened), 0165-119 (S14-03, S3, CONFIRMED — one throw inside a synthetic handler
poisons the spine's emission chain: `emissions = emissions.then(…)` never isolates a
rejection, so every later probe verdict and classifier answer re-rejects unhandled without
running — on a half-open connection the turn is never judged and hangs), 0165-120 (S14-04,
S3, CONFIRMED — the usage concern's two mid-turn steer failures settle the turn blocked
without aborting the still-running server turn, while the stuck hint and the step-up treat
theirs as "not a gate"). Started 2026-11-07 at HEAD `65b5d614c`.

## Scope

The engine layer's four defects plus the probe-never-attach half 0165-010's row deferred here
(probe dispatches attach the interactive sideband — a free line typed during a probe's
seconds-long dispatch goes to the throwaway probe session logged "→ sent", step 021's D1
landing the general detach; attempt knows the probe chain). The half-open probe ruling answers
0026 D3's own measured incident shape ("transport-layer half-open, not a server-side stall")
— the probe's question widens from "does the server answer" to "does the turn's stream
deliver". 0185 D3's wall fact and 0186's probe-posture residual feed nothing here (the
step-up concern's overflow reaction is 118's own row, per 0185's named residual). Out of
scope: the recovery concern's final classification reading the same merged record (S16's
question, the finding's family note), the idle-time steer failures' no-retry shape (test.ts /
liveness.ts:162 — nothing running, no abort owed), a structured adapter network flag (0185
D4's named later step).

## Design ruling

Ruling **0187** ([0187-halfopen-stream-stepup-emission.md](../0187-halfopen-stream-stepup-emission.md))
— D1/D2/D3/D4 (+ D5 the probe-never-attach half).

## Implementation order (the recovery map)

1. `src/agent/types.ts` + `src/agent/opencode/events.ts` + `src/agent/opencode/client.ts` —
   the heartbeat AgentEvent kind (additive, P13) and the `heartbeat` capability (D1).
2. `src/engine/sources.ts` + `src/watch.ts` — the pulse-observing stream wrapper and the
   probe verdict's streamAlive leg (D1).
3. `src/engine/contract.ts` + `src/engine/concerns/liveness.ts` — the probe input's
   streamAlive field, the silent-stream failure count, the finalize's stream-silent message
   (D1).
4. `src/engine/concerns/failure.ts` + `src/engine/concerns/step-up.ts` — the event-own
   classify fold (`errorInfoOf`) and the late step-up reading it (D2).
5. `src/engine/spine.ts` + `src/log.ts` — the emission link's rejection isolation and
   runTurn's re-throw (0185 D1's channel), record()'s silenced write (D3).
6. `src/engine/concerns/usage.ts` — the two steer failures become non-gates, the wall hint
   re-arming; the two trace goldens re-blessed deliberately (D4).
7. `src/chain.ts` + `src/router.ts` + `src/attempt.ts` — the probe chain's `probe` mark and
   the attach skip (D5).
8. Tests: turn-liveness (the stream leg), turn-step-up (the event-own read),
   turn-arbitration or spine-level (the emission isolation), turn-usage (the non-gate +
   re-arm), agent-events (the heartbeat mapping), session (the probe-never-attach), the
   re-blessed goldens; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-07: step opened at HEAD 65b5d614c (tree clean). The register rows, S14's record,
  rulings 0185/0186 (premise lines and residuals — 0185 names this step for the step-up
  concern's overflow reaction; 0186's probe posture stands untouched), step 021's record
  (the probe-never-attach deferral), 0026 §1.3/§4.4 (the probe's own measured incident), and
  the code homes (spine, sources, liveness, step-up, usage, failure, the adapters' events,
  attempt's attach, log) read before any edit.
- 2026-11-07: ruling 0187 written (D1 the stream leg, D2 the event-own trigger, D3 the
  emission isolation + the silenced log write, D4 the non-gates + the wall re-arm + the two
  re-blessed goldens, D5 the probe-never-attach half). Implementation landed per the map:
  the vocabulary and capability first (the run-status ratchet caught the heartbeat kind
  immediately — the lockstep extended in the same change), then the sources/liveness leg,
  the step-up trigger, the spine's isolation, the usage non-gates, the chain mark.
- 2026-11-07: the six test homes + the new trace scenario; the two goldens re-blessed
  deliberately (0187 D4's re-bless, the scripts gaining the trailing idle the session's turn
  would have gone to) and the new golden recorded. One test-authoring repair inside the
  change: the D2 repro tests' entry initially carried a single wider step, so the pre-fix
  re-fire had no step to take and the pin passed pre-fix — the entry widened to the finding's
  own two-step shape before the proofs.

## Verification

- `bun typecheck` exit 0 in packages/auto-core and packages/auto.
- auto-core full suite: **3035 pass, 0 fail** (153 files; 3024 at step 026's close — the
  eleven new pins: four liveness stream-leg, three step-up event-own, the two rewritten
  usage non-gates, the arbitration emission-isolation, the agent-events heartbeat mapping,
  the session probe-attach, the new trace scenario).
- Fail-before (the fixed src backed up outside the tree at `/tmp/step027-backup/`, the
  pre-fix content written in per proof with `git show HEAD:<path>`, restored after — every
  proof-touched file confirmed byte-identical to its backup afterward):
  - **118** (pre-fix `src/engine/concerns/step-up.ts`): the overflow-then-500 pin red —
    `Expected: 1, Received: 2` (the 500 stepping again off the merged record); the
    message-less-retry pin red the same way.
  - **119** (pre-fix `src/engine/spine.ts`): the emission-isolation pin red — "Expected
    promise that rejects, Received promise that resolved" (the poisoned chain leaving the
    turn settled naturally with the probe silently disabled — the defect's own shape).
  - **120** (pre-fix `src/engine/concerns/usage.ts`): both non-gate pins red — `Expected:
    "pass"`, Received the blocked settle; both re-blessed goldens red (the byte-compare
    against the new natural-settle traces).
  - **030** (pre-fix `src/engine/concerns/liveness.ts`): the three stream-judgment pins red
    (the ok verdict resetting the count off the ignored field); the floor pin passes
    pre-fix **by design** — it pins the preserved behavior (no pulse → today's verdict), not
    a regression. Pre-fix `src/agent/opencode/events.ts`: the heartbeat-mapping pin red.
    Pre-fix the whole D1 set (types/events/client/sources/watch/contract/spine/liveness):
    the new `probe-stream-silent-half-open` trace scenario **times out at bun's 5 s test
    bound** — the turn never settles over a healthy server and a silent stream, 0026 §1.3's
    own symptom reproduced end-to-end.
  - **D5** (pre-fix `src/attempt.ts`): the probe-attach pin red — attachIds
    `["ses_new_1", "ses_new_2", "ses_fork_1"]`, the probe session among them.
- packages/auto suite: 149 pass, 8 skip, 5 fail — the same pre-existing fork/remove-fork
  baseline (2 fork + 3 remove-fork, step 031's wave); no new failure; typecheck clean.

## Close-out

Step done 2026-11-07. Ruling **0187** active-authority; the INDEX row, the AGENTS.md engine
navigation line, ledger rows 0165-030/118/119/120 (and 0165-010's deferred half, named in
its existing row) and the program's status/current-position land in the same commit.
Residuals (0187's list): the stream leg's detection latency is two to three probe intervals
(20–30 min at the default — bounded where it was infinite; a faster judgment has no measured
demand); the capability's stated cadence false-negatives (never false-positives) if a
server's heartbeat drifts beyond it; the recovery concern's final classification still reads
the merged record (S16's standing question); the idle-time steer failures' no-retry shape
stands (nothing running, no abort owed); S14-07's contract-header overstatement rides its
W-docs row.
