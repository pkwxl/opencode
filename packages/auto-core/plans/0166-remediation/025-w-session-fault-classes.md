# Step 025 — w-session-fault-classes

Wave: W-session. Findings: 0165-026 (S13-01, S2, CONFIRMED — runSession's catch-all reclassifies
every driver-side exception as a transient session fault; the phase-less probe answers
"recovered" and the loop re-dispatches into the same throw forever), 0165-027 (S13-04, S2,
CONFIRMED — 0018's in-flight claim is void under the opencode adapter: the active record is
written only after the POST, which resolves at turn end, so a mid-turn kill leaves the
active:false record and the re-run blocks with the manual teaching), 0165-028 (S13-06, S2,
CONFIRMED — a terminal context-overflow error enters the ladder as transient, re-dispatching
into forks of the overflowed session forever), 0165-029 (S14-01, S2, CONFIRMED — the managed-
server restart regex matches no connection fault Bun produces: T-057's move dropped an N and
Bun's own faces never matched, so a dead managed server is never restarted). Started 2026-11-06
at HEAD `129421a79`.

## Scope

The session-driving loop's fault classes and timing: the driver-fault boundary (session.ts's
catch), the in-flight claim's write timing (attempt.ts — before the POST, the opencode shape),
overflow's routing out of the fork ladder (engine/ladder.ts + chain-transitions.ts + session.ts),
and the network-failure restart pattern (engine/ladder.ts + the test oracle to Bun's measured
faces). The fake agent's turn-end prompt resolution option (test/fixtures/agent.ts) lands with
S13-04's pins. Out of family: awaitRecovery's probe never restarting a dead host mid-wait (a
named residual), the typed AgentTransportError tag (no residual adapter-throw class exists
today), the step-up concern's overflow reaction (S14-02's row, step 027).

## Design ruling

Ruling **0185** ([0185-session-fault-classes.md](../0185-session-fault-classes.md)) — its
decision blocks carry the full statements.

## Implementation order (the recovery map)

1. `src/session.ts` — the catch's driver-fault rethrow (D1).
2. `src/attempt.ts` — the claim before the POST; the dispatch-failure branch restores `prior`
   (D2). `test/fixtures/agent.ts` — the turn-end resolution option.
3. `src/engine/ladder.ts` — the overflow arm (one fresh non-forked retry, then the person) and
   the NETWORK_FAILURE restoration + Bun faces (D3, D4); `src/chain-transitions.ts` —
   forkSources' window filter; `src/session.ts` — the executor's two new steps and the cap
   handed to forkSources.
4. Tests: session/agent-fake (the driver-fault pin, the claim pin with the turn-end fake, the
   overflow pin), ladder.test.ts (the overflow decision, the measured Bun faces).
5. Ruling 0185 + INDEX row + navigation; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 024's commit (129421a79) in the same worker stretch; the
  register rows and the four records read; the code homes surveyed (session.ts's catch and
  executor switch, attempt.ts's claim and restore paths, ladder.ts's nextStep and
  NETWORK_FAILURE, chain-transitions' forkSources/seedFromSources, the fixtures' timing).
- 2026-11-06: D1–D4 landed (the driver-fault rethrow; the claim before the POST with the
  dispatch-failure prior-restore and the fake's turn-end option; the overflow arm with the wall
  fact and overflowedToBlank — the first draft's forkSources window filter withdrawn after the
  §4.5 pin caught it; the NETWORK_FAILURE restoration + Bun faces). Ruling 0185, its INDEX row
  and the AGENTS.md navigation line written.

## Verification

- `bun typecheck` exit 0 in packages/auto-core and packages/auto.
- auto-core full suite: **3021 pass, 0 fail** (153 files; 3015 at step 024's close — the six
  new pins). The 0055 §4.5 compaction pin surfaced the first draft's over-broad forkSources
  window filter (a transient fault's oversized session is still the round's asset — 0069's
  pinned subtask shape); the filter was withdrawn inside this change for the overflow arm's
  own act (overflowedToBlank) plus the wall fact at the seam.
- Fail-before (`git stash push -- src/`, per pin): the network-faces oracle, the wall arm, the
  claim pin and the overflow pin red on the pre-change sources; the in-place-compaction pin
  green both ways (the conservation half); the driver-fault pin's fail-before is the hang
  itself — the bounded runner was killed at 200 s with the old code cycling (0165-026's own
  repro observation: "ended only by the test's cutoff").
- packages/auto suite: 149 pass, 8 skip, 5 fail — the same pre-existing fork/remove-fork
  baseline (step 031's wave); typecheck clean.

## Close-out

Step done 2026-11-06. Ruling **0185** active-authority; the INDEX row, the AGENTS.md
session-driving navigation line, ledger rows 0165-026/027/028/029 and the program's
status/current-position land in the same commit. Residuals (0185's list): the wait-side probe
never restarting a host; no typed adapter-transport error (nothing throws today); the step-up
concern's own overflow reaction stays S14-02's row (step 027).
