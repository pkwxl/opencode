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
import type { Steer } from "../src/testrun"
import { watch } from "../src/watch"
import { ev } from "./fixtures/agent"
import { compareTrace, runScenario, TURN_EPOCH, turnEntry, until, type TurnScenario } from "./fixtures/turn-trace"

// The steer literal the message-family scenarios share: the 2×64k budget
// against the fake's 100.0k window gives an 80.0k effective wall
// (steerWall clamps the budget to 80% of the window), so the 0.5 band sits
// at 40.0k and the 0.85 band at 68.0k. The note texts carry the literal
// {{used}}/{{pct}}/{{wall}} slots that fillUsageNote resolves at send time.
function usageSteer(): Steer {
  return {
    limit: 128_000,
    text: "[DRIVER] wall hint: write the handover document",
    notes: [
      { at: 0.5, text: "note-info used={{used}} pct={{pct}} wall={{wall}}" },
      { at: 0.85, text: "note-winddown used={{used}} pct={{pct}} wall={{wall}}" },
    ],
  }
}

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

  // —— The `message` row (plans/0061 §4.5) ——
  // Same race standing as the part/limit family: no settle source exists
  // (no classifier wiring, and the queued probe timer is never fired), so
  // neither A-3 race materializes and no pins or exclusions are declared.
  // The holds below gate post-steer event arrivals — the §4.4 queue
  // discipline (external inputs run to completion), not a race pin.

  // `message` row, transcript cell: onModel fires once, on the first
  // message carrying a model (here a user message — the model the server
  // resolved for the turn) and never again; an incomplete assistant
  // message and a re-sent completed one (same id, deduped by `seen`) pass
  // the guard but not the filter, so neither is a measurement point (the
  // re-sent 2000 updates the source's figure yet the turn's used stays at
  // the last measurement). lastMessage tracks every message of the session
  // (its observable reader is the test protocol's freeze record, S08's
  // batch). onModel is neither an AgentClient call nor a log line, so the
  // firing is asserted inside the run, as onLimit was.
  {
    id: "message-transcript-filter",
    kinds: ["message", "part", "idle"],
    run: async (h) => {
      const reported: string[] = []
      const result = await watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "u1", undefined, { role: "user", model: "prov/resolved" }),
          ev.message("s", "m1", 5000, { completed: false }),
          ev.message("s", "m2", 1000),
          ev.message("s", "m2", 2000),
          ev.text("s", "t1", "done: the transcript turn"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
        undefined,
        undefined,
        undefined,
        undefined,
        (model) => reported.push(model),
      )
      expect(reported, "onModel fires once, on the first message carrying a model").toEqual(["prov/resolved"])
      return result
    },
  },

  // `message` row, usage cell (the measurement vlog over
  // client.contextLimits): a message naming a model with a known window
  // measures with limit and pct; one naming an unknown model id loses the
  // window (limit stays undefined, pct records 100, the line carries no
  // `/…`); one naming no model at all (a synthetic error message) runs
  // under the window already in effect. contextLimits is fetched once, at
  // the first measurement.
  {
    id: "message-measurement-window",
    kinds: ["message", "part", "idle"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          ev.message("s", "m2", 2000, { model: "prov/unknown" }),
          ev.message("s", "m3", 3000, { model: undefined }),
          ev.text("s", "t1", "done: the measurement turn"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
      ),
  },

  // `message` row, usage cell (the hard wall): a measurement at the
  // effective wall (80.0k = the budget clamped to 80% of the 100.0k
  // window) sends the one hard-wall steer — the ⚠ … reached the wall
  // line, the steer call, both notice bands spent with it — and the turn
  // continues to a natural settle; a later measurement past the wall
  // sends nothing again (steerSent).
  {
    id: "message-wall-steer",
    kinds: ["message", "part", "idle"],
    run: async (h) => {
      const afterWall = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 30_000),
          ev.message("s", "m2", 80_000),
          { hold: afterWall.promise },
          ev.message("s", "m3", 85_000),
          ev.text("s", "t1", "done past the wall"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
        usageSteer(),
      )
      await until(() => h.agent.argsOf("promptAsync").length >= 1, "the hard-wall steer")
      afterWall.release()
      return done
    },
  },

  // `message` row, usage cell (the milestone notices): a jump crossing
  // two bands sends only the highest new one — the winddown note of the
  // 0.85 band, its figure slots filled at send time — and the crossed
  // lower band counts as spent, so a later measurement steers nothing.
  {
    id: "message-usage-notice-highest-band",
    kinds: ["message", "part", "idle"],
    run: async (h) => {
      const afterNotice = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 30_000),
          ev.message("s", "m2", 70_000),
          { hold: afterNotice.promise },
          ev.message("s", "m3", 75_000),
          ev.text("s", "t1", "done after the notice"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
        usageSteer(),
      )
      await until(() => h.agent.argsOf("promptAsync").length >= 1, "the usage notice")
      afterNotice.release()
      return done
    },
  },

  // The dual steer at one measurement point (the plan's named scenario;
  // `message` row, usage + stepUp cells): over a registry SteerContext
  // with a `wider` step, a first measurement crossing the 0.5 band sends
  // the info notice (naming the base id); a later measurement crossing
  // the 0.85 band and the step-up point (52.0k of the 100.0k window)
  // sends both steers from the one measurement — the winddown notice
  // first (notices do not suppress the step-up check), then the ⇡ line
  // and the step-up steer naming the next step id, steppedUp recorded.
  // The next measurement runs on the wider id's 200.0k window: the wall
  // recomputes to 128.0k and nothing fires.
  {
    id: "message-dual-steer-notice-step-up",
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
      const afterNotice = h.gate()
      const afterDual = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 45_000, { model: "prov/base" }),
          { hold: afterNotice.promise },
          ev.message("s", "m2", 70_000, { model: "prov/base" }),
          { hold: afterDual.promise },
          ev.message("s", "m3", 90_000, { model: "prov/wide" }),
          ev.text("s", "t1", "done after the dual steer"),
          ev.idle("s"),
        ]),
        h.opts,
        usageSteer(),
        undefined,
        undefined,
        undefined,
        undefined,
        steerContext,
      )
      await until(() => h.agent.argsOf("promptAsync").length >= 1, "the 0.5-band notice")
      afterNotice.release()
      await until(() => h.agent.argsOf("promptAsync").length >= 3, "the notice and the step-up of the dual measurement")
      afterDual.release()
      return done
    },
  },

  // The steer-dispatch-failed blocked exit at the hard wall (the fixed
  // handover-hint question text): the wall measurement logs the ⚠ steer
  // dispatch failed line and settles blocked, the bands spent and the
  // hint marked sent in the snapshot.
  {
    id: "message-wall-steer-failed",
    kinds: ["message", "part", "idle"],
    agent: { fail: { promptAsync: undefined } },
    run: async (h) =>
      watch(h.agent.client, "s", h.script([ev.message("s", "m1", 80_000)]), h.opts, usageSteer()),
  },

  // The steer-dispatch-failed blocked exit at a usage notice (the fixed
  // usage-notice question text): the 0.5-band measurement logs the ⚠
  // steer dispatch failed line and settles blocked; no hint was sent.
  {
    id: "message-usage-notice-steer-failed",
    kinds: ["message", "part", "idle"],
    agent: { fail: { promptAsync: undefined } },
    run: async (h) =>
      watch(h.agent.client, "s", h.script([ev.message("s", "m1", 45_000)]), h.opts, usageSteer()),
  },

  // —— The `question` row (plans/0061 §4.5) ——
  // Same race standing as the families above: no settle source exists (no
  // classifier wiring, and the queued probe timer is never fired), so
  // neither A-3 race materializes and no pins or exclusions are declared.
  // The gated interactive's reply is queued before watch() starts (early
  // replies stand), so the awaited askHuman resolves in microtasks — the
  // loop body never suspends on anything the scenario does not control.

  // `question` row, the plan-session policy (opts.humanQuestions): a
  // non-permission question waits for the human with no timeout — the ❓
  // line, the → human answer echo, replyQuestion with the human's text,
  // and no proxy answer (resolves stays empty); the turn settles
  // naturally on the following idle.
  {
    id: "question-human-answer",
    kinds: ["question", "idle"],
    run: async (h) => {
      const io = h.interactive()
      io.reply("use postgres")
      h.opts.humanQuestions = true
      h.opts.interactive = io.interactive
      return watch(h.agent.client, "s", h.script([ev.question("s", "q1", "which db?"), ev.idle("s")]), h.opts)
    },
  },

  // `question` row, the plan-session closed-input block: the human's
  // input channel answers with the closed shape (undefined), so the
  // question cannot be answered — rejectQuestion + abort, and the
  // blocked return carrying the closed-input wording and the question.
  {
    id: "question-human-closed-block",
    kinds: ["question"],
    run: async (h) => {
      const io = h.interactive()
      io.reply(undefined)
      h.opts.humanQuestions = true
      h.opts.interactive = io.interactive
      return watch(h.agent.client, "s", h.script([ev.question("s", "q1", "which db?")]), h.opts)
    },
  },

  // `question` row, the plan-session repeat block: the same question
  // after the human's answer (sameIssue over the normalized text) never
  // waits again — replyQuestion for the first, then rejectQuestion +
  // abort + the blocked return naming the repeat.
  {
    id: "question-human-repeat-block",
    kinds: ["question"],
    run: async (h) => {
      const io = h.interactive()
      io.reply("use postgres")
      h.opts.humanQuestions = true
      h.opts.interactive = io.interactive
      return watch(
        h.agent.client,
        "s",
        h.script([ev.question("s", "q1", "which db?"), ev.question("s", "q2", "which db?")]),
        h.opts,
      )
    },
  },

  // `question` row, --wait-answer with a human reply inside the window:
  // the → human answer echo and replyQuestion carry the human's text; a
  // real person's decision is no proxy answer, so resolves stays empty.
  {
    id: "question-wait-answer-human-reply",
    kinds: ["question", "idle"],
    run: async (h) => {
      const io = h.interactive()
      io.reply("backfill the old rows")
      h.opts.waitAnswer = 5
      h.opts.interactive = io.interactive
      return watch(h.agent.client, "s", h.script([ev.question("s", "q1", "backfill the old rows first?"), ev.idle("s")]), h.opts)
    },
  },

  // `question` row, --wait-answer timing out: the window closes with no
  // human reply, so the driver answers on the user's behalf — the ⚑
  // auto-answer (AUTO-RESOLVE) two-line report, the resolve recorded at
  // the clock's instant, replyQuestion carrying the fallback text, and
  // the turn continuing to a natural settle.
  {
    id: "question-wait-answer-timeout-fallback",
    kinds: ["question", "idle"],
    run: async (h) => {
      const io = h.interactive()
      io.reply(undefined)
      h.opts.waitAnswer = 5
      h.opts.interactive = io.interactive
      return watch(
        h.agent.client,
        "s",
        h.script([ev.question("s", "q1", "rename the module or keep the old name?"), ev.idle("s")]),
        h.opts,
      )
    },
  },

  // `question` row, the default permission-question block: a question
  // whose text names a permission and no --wait-answer — the driver
  // cannot decide authorization in the human's stead, so it rejects,
  // aborts, and blocks with the raw question text.
  {
    id: "question-permission-word-default-block",
    kinds: ["question"],
    run: async (h) =>
      watch(h.agent.client, "s", h.script([ev.question("s", "q1", "May I have permission to wipe the build directory?")]), h.opts),
  },

  // `question` row, the dryrun preflight: every question is auto-answered
  // (the → auto answer line), never blocking and never a proxy answer —
  // the preflight only probes, so resolves stays empty.
  {
    id: "question-dryrun-auto-answer",
    kinds: ["question", "idle"],
    run: async (h) => {
      h.opts.dryrun = true
      return watch(h.agent.client, "s", h.script([ev.question("s", "q1", "apply the migration now?"), ev.idle("s")]), h.opts)
    },
  },

  // —— The `permission` row (plans/0061 §4.5) ——
  // Same race standing as the question scenarios above: no settle
  // source, the queued probe timer is never fired, and every human
  // answer is pre-queued — no pins, no exclusions.

  // `permission` row, the dryrun preflight: the request is denied
  // without interrupting the session (the 🔐 preflight probe denied
  // line, replyPermission "reject"), and the turn settles naturally.
  {
    id: "permission-dryrun-deny",
    kinds: ["permission", "idle"],
    run: async (h) => {
      h.opts.dryrun = true
      return watch(h.agent.client, "s", h.script([ev.permission("s", "p1", "bash", "rm -rf build"), ev.idle("s")]), h.opts)
    },
  },

  // `permission` row, --permission auto-allow: no human is waited for;
  // the request is approved immediately ("always").
  {
    id: "permission-auto-allow",
    kinds: ["permission", "idle"],
    run: async (h) => {
      h.opts.permission = "auto-allow"
      return watch(h.agent.client, "s", h.script([ev.permission("s", "p1", "bash", "rm -rf build"), ev.idle("s")]), h.opts)
    },
  },

  // `permission` row, ask-allow with --wait-answer unset: not waiting is
  // the timeout, and the mode's fallback auto-approves ("always"); the
  // session continues to a natural settle.
  {
    id: "permission-ask-allow-timeout",
    kinds: ["permission", "idle"],
    run: async (h) => {
      h.opts.permission = "ask-allow"
      return watch(h.agent.client, "s", h.script([ev.permission("s", "p1", "bash", "rm -rf build"), ev.idle("s")]), h.opts)
    },
  },

  // `permission` row, ask-deny with --wait-answer unset: the timeout
  // fallback denies (replyPermission "reject") but the session continues
  // — the AI works around the denied permission and the turn settles
  // naturally on the following idle.
  {
    id: "permission-ask-deny-timeout",
    kinds: ["permission", "idle"],
    run: async (h) => {
      h.opts.permission = "ask-deny"
      return watch(h.agent.client, "s", h.script([ev.permission("s", "p1", "bash", "rm -rf build"), ev.idle("s")]), h.opts)
    },
  },

  // `permission` row, a human allow under ask-*: the reply matches the
  // approval wording, so the request is granted ("always") and the turn
  // settles naturally.
  {
    id: "permission-ask-human-allow",
    kinds: ["permission", "idle"],
    run: async (h) => {
      const io = h.interactive()
      io.reply("allow")
      h.opts.permission = "ask-deny"
      h.opts.waitAnswer = 5
      h.opts.interactive = io.interactive
      return watch(h.agent.client, "s", h.script([ev.permission("s", "p1", "bash", "rm -rf build"), ev.idle("s")]), h.opts)
    },
  },

  // `permission` row, a human deny under ask-*: any non-approval reply
  // denies the request without interrupting the session — the AI
  // continues without it to a natural settle.
  {
    id: "permission-ask-human-deny",
    kinds: ["permission", "idle"],
    run: async (h) => {
      const io = h.interactive()
      io.reply("not this one")
      h.opts.permission = "ask-allow"
      h.opts.waitAnswer = 5
      h.opts.interactive = io.interactive
      return watch(h.agent.client, "s", h.script([ev.permission("s", "p1", "bash", "rm -rf build"), ev.idle("s")]), h.opts)
    },
  },

  // `permission` row, the ask-fail exit: the timeout fallback denies
  // (replyPermission "reject"), aborts the session, and blocks with the
  // guidance naming the target directory's opencode.json.
  {
    id: "permission-ask-fail-block",
    kinds: ["permission"],
    run: async (h) => {
      h.opts.permission = "ask-fail"
      return watch(h.agent.client, "s", h.script([ev.permission("s", "p1", "bash", "rm -rf build")]), h.opts)
    },
  },
]

describe("the turn-trace oracle", () => {
  for (const scenario of scenarios) {
    test(`trace: ${scenario.id}`, async () => {
      compareTrace(scenario, await runScenario(scenario))
    })
  }
})
