// The turn-trace oracle (the consolidation program's D0, plans/0061 §3.3):
// each scenario drives watch() directly over a finite scripted event stream
// through the harness in test/fixtures/turn-trace.ts, and its trace — the
// ordered AgentClient calls, the captured log/vlog lines (timestamps
// stripped), the returned Watch (durationMs dropped, pendingReset resolved)
// — is compared byte-for-byte against the JSON golden under
// test/golden/turn/. This is the equivalence proof every engine unit of
// stage D is gated on.
//
// FREEZE: the goldens are recorded from the pre-engine watch() once and are
// NEVER regenerated during stage D; UPDATE_TURN_TRACE=1 is the conscious
// act of a stage boundary, and a mismatch it would paper over is a drift to
// rule on first, not a snapshot to refresh.
//
// Lane: repo — the file's charter includes the test-protocol scenarios
// that run a real temporary repository and spawn test scripts through the
// product's own helpers, and the lane manifest's completeness ratchet
// (test/lanes.test.ts fails on any unregistered test file) needs the
// registration up front.
// AUTO-DECISION: registered in REPO_LANE from the start although the first
// scenario is in-memory (the manifest ratchet leaves no window where the
// file is unregistered, and moving a file between lanes later would churn
// the manifest — registering for the charter, not the first scenario).

import { describe, test } from "bun:test"
import { watch } from "../src/watch"
import { ev } from "./fixtures/agent"
import { compareTrace, runScenario, type TurnScenario } from "./fixtures/turn-trace"

const scenarios: TurnScenario[] = [
  // The smoke trace: the plainest happy path — one completed assistant
  // message measuring 1000 tokens, a final text part, one billed
  // step-finish, idle; the turn settles naturally through the idle event.
  // Neither A-3 race materializes: the queued probe timer is never fired,
  // and no settle source (classifier answer, half-open trip) exists, so
  // nothing races the stream's next() — no pins, no exclusions.
  {
    id: "smoke-natural-settle",
    kinds: ["message", "part", "idle"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "done: the smoke turn"), ev.step("s", "stp1"), ev.idle("s")]),
        h.opts,
      ),
  },
]

describe("the turn-trace oracle", () => {
  for (const scenario of scenarios) {
    test(`trace: ${scenario.id}`, async () => {
      compareTrace(scenario, await runScenario(scenario))
    })
  }
})
