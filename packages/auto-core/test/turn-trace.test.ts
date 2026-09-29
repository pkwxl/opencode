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

import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { SteerContext } from "../src/model-step"
import { createStuckTracker } from "../src/stuck"
import { watch } from "../src/watch"
import { ev } from "./fixtures/agent"
import { compareTrace, runScenario, TURN_EPOCH, turnEntry, until, type TurnScenario } from "./fixtures/turn-trace"

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

  // —— The `limit` and `part` rows (plans/0061 §4.5) ——
  // None of these scenarios creates a settle source (no classifier, no
  // half-open probe — the queued probe timer is never fired), so neither
  // A-3 race materializes and no pins or exclusions are declared; the
  // scenario holds below gate post-steer event arrivals, which is the §4.4
  // queue discipline (external inputs run to completion), not a race pin.

  // `limit` row, windows cell: the first event logs its window line and
  // fires onLimit; a byte-identical repeat is deduped by the router's
  // noteWindows (no line, no callback); a changed status logs and fires
  // again; an event of another session never reaches the row (guard).
  {
    id: "limit-windows-change",
    kinds: ["limit", "part", "message", "idle"],
    run: async (h) => {
      const reset5h = TURN_EPOCH + 5 * 3_600_000
      const allowed: AgentEvent = { type: "limit", session: "s", status: "allowed", windows: [{ scope: "5h", resetAt: reset5h, utilization: 0.4 }] }
      const spent: AgentEvent = { type: "limit", session: "s", status: "rejected", windows: [{ scope: "5h", resetAt: reset5h, utilization: 1 }] }
      const other: AgentEvent = { type: "limit", session: "other", status: "warning", windows: [{ scope: "7d", resetAt: reset5h + 86_400_000, utilization: 0.9 }] }
      const fired: string[] = []
      const result = await watch(
        h.agent.client,
        "s",
        h.script([
          allowed,
          allowed,
          spent,
          other,
          ev.message("s", "m1", 1000),
          ev.text("s", "t1", "done: the windows turn"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (event) => fired.push(event.status),
      )
      // onLimit is neither an AgentClient call nor a log line, so the trace
      // cannot show it — assert the firing here (exactly the changes).
      expect(fired, "onLimit fires on a window change only").toEqual(["allowed", "rejected"])
      return result
    },
  },

  // `part` row, guard + transcript cells: a final text part vlogs and sets
  // lastText; a non-final text part stays silent; a reasoning part renders;
  // a re-sent tool part (same id) is deduped by `seen`; a re-sent
  // step-finish (same id) is neither displayed nor billed twice; events of
  // another session (message, parts, even an idle) are skipped by the
  // session guard.
  {
    id: "part-transcript-dedup",
    kinds: ["part", "message", "idle"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          ev.text("s", "t1", "partial answer"),
          { type: "part", session: "s", part: { kind: "text", id: "t2", text: "still typing", final: false } },
          { type: "part", session: "s", part: { kind: "reasoning", id: "r1", text: "thinking it through", final: true } },
          ev.tool("s", "p1", "read", { path: "/a.ts" }, "the file contents"),
          ev.tool("s", "p1", "read", { path: "/a.ts" }, "the file contents"),
          ev.step("s", "stp1"),
          ev.step("s", "stp1"),
          ev.message("other", "mo1", 5000),
          ev.text("other", "to1", "noise from another session"),
          ev.step("other", "stpo1"),
          ev.idle("other"),
          ev.idle("s"),
        ]),
        h.opts,
      ),
  },

  // `part` row, failure cell (primed through the `retry` row): a retry
  // signal stating a limit (resetAt/scope) accumulates errorInfo without
  // settling (the patterns class it unknown); the next model output ends
  // `retrying` and drops the stated limit fields, so the session error that
  // ends the turn carries an errorInfo with no resetAt/scope — a later
  // failure of this watch must not ride the earlier statement into a down
  // mark.
  {
    id: "part-output-ends-retry",
    kinds: ["message", "retry", "part", "error", "idle"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          {
            type: "retry",
            session: "s",
            id: "r1",
            attempt: 1,
            error: { message: "glorp the frobnicate failed", resetAt: TURN_EPOCH + 5 * 3_600_000, scope: "5h" },
          },
          ev.text("s", "t1", "recovered output"),
          ev.step("s", "stp1"),
          ev.error("s", { name: "UnknownError", message: "glorp struck again" }),
          ev.idle("s"),
        ]),
        h.opts,
      ),
  },

  // `part` row, liveness record cells (driving the `idle` row's truncation
  // continuation): a step-finish with reason `length` sets lastFinish, so
  // the next idle steers a continuation; the following step-finish with a
  // non-length reason resets the consecutive-truncation count, so the
  // second truncation continues as (1/3) again, not (2/3). Post-steer
  // events arrive only when the scenario releases its gate — the steer
  // goes out first, deterministically.
  {
    id: "part-length-continue-reset",
    kinds: ["message", "part", "idle"],
    run: async (h) => {
      const afterFirst = h.gate()
      const afterSecond = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          ev.text("s", "t1", "first chunk"),
          ev.step("s", "stp1", "length"),
          ev.idle("s"),
          { hold: afterFirst.promise },
          ev.step("s", "stp2", "stop"),
          ev.step("s", "stp3", "length"),
          ev.idle("s"),
          { hold: afterSecond.promise },
          ev.text("s", "t2", "done after continuations"),
          ev.step("s", "stp4", "stop"),
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => h.agent.argsOf("promptAsync").length >= 1, "the first length-continuation steer")
      afterFirst.release()
      await until(() => h.agent.argsOf("promptAsync").length >= 2, "the second length-continuation steer")
      afterSecond.release()
      return done
    },
  },

  // The same continuation with a failing steer dispatch: the
  // steer-dispatch-failed blocked exit of the length-continuation path.
  {
    id: "part-length-continue-steer-failed",
    kinds: ["message", "part", "idle"],
    agent: { fail: { promptAsync: undefined } },
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "cut off mid"), ev.step("s", "stp1", "length"), ev.idle("s")]),
        h.opts,
      ),
  },

  // `part` row, stepUp cell (confirmed): a registry SteerContext with a
  // `wider` step — the measurement crossing the step-up point steers the
  // session onto the wider id (the ⇡ line, the steer naming the next id)
  // and arms the cache-claim check; the first step-finish on the wider id
  // reads half the prefix from the shared cache, logging the confirmed ✓
  // vlog. (The step-up itself is covered as a named scenario of the
  // message family; here it is the claim's arming device.)
  {
    id: "part-step-cache-confirmed",
    kinds: ["message", "part", "idle"],
    agent: { limits: { "prov/base": 100_000, "prov/wide": 200_000 } },
    run: async (h) => {
      const steerContext: SteerContext = {
        name: "big",
        entry: turnEntry("big", "prov/base", { wider: ["prov/wide"] }),
        step: 0,
        model: "prov/base",
        label: "T-001",
      }
      return watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 60_000),
          {
            type: "part",
            session: "s",
            part: { kind: "step-finish", id: "stp1", reason: "stop", tokens: { input: 200, output: 10, reasoning: 0, cacheRead: 40_000, cacheWrite: 0 }, cost: 0.01 },
          },
          ev.text("s", "t1", "done on the wider id"),
          ev.idle("s"),
        ]),
        h.opts,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        steerContext,
      )
    },
  },

  // `part` row, stepUp cell (contradiction, once per entry): two step-ups
  // of the same entry each arm the check and each first step-finish
  // contradicts the shared-cache claim — the ⚠ line fires only for the
  // first (the router's noteClaimContradiction dedups per entry).
  {
    id: "part-step-cache-contradiction-once",
    kinds: ["message", "part", "idle"],
    agent: { limits: { "prov/base": 100_000, "prov/wide": 200_000, "prov/wider": 400_000 } },
    run: async (h) => {
      const steerContext: SteerContext = {
        name: "big",
        entry: turnEntry("big", "prov/base", { wider: ["prov/wide", "prov/wider"] }),
        step: 0,
        model: "prov/base",
        label: "T-001",
      }
      const claimBustingStep = (id: string, cacheWrite: number, cacheRead: number, input: number): AgentEvent => ({
        type: "part",
        session: "s",
        part: { kind: "step-finish", id, reason: "stop", tokens: { input, output: 10, reasoning: 0, cacheRead, cacheWrite }, cost: 0.01 },
      })
      return watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 60_000),
          claimBustingStep("stp1", 35_000, 1_000, 200),
          ev.message("s", "m2", 160_000),
          claimBustingStep("stp2", 90_000, 5_000, 300),
          ev.text("s", "t1", "done on the widest id"),
          ev.idle("s"),
        ]),
        h.opts,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        steerContext,
      )
    },
  },

  // `part` row, stuck cell: four identical completed tool calls trip the
  // StuckTracker's same-args-same-result criterion — the ⚠ repetitive
  // action line and the hint steer (level 1/3). opts.dir stays undefined,
  // so the stats event is a no-op; the turn goes on to a natural settle
  // (a hint never aborts the session).
  {
    id: "part-stuck-hint",
    kinds: ["message", "part", "idle"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          ev.tool("s", "p1", "read", { path: "/a.ts" }, "the same contents"),
          ev.tool("s", "p2", "read", { path: "/a.ts" }, "the same contents"),
          ev.tool("s", "p3", "read", { path: "/a.ts" }, "the same contents"),
          ev.tool("s", "p4", "read", { path: "/a.ts" }, "the same contents"),
          ev.text("s", "t1", "done after the hint"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
        undefined,
        undefined,
        createStuckTracker(),
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
