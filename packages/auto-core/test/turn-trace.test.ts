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
import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { AgentEvent } from "../src/agent/types"
import type { Watch } from "../src/chain"
import { cachedAnswer } from "../src/classify"
import { createGitOps } from "../src/git-ops"
import type { SteerContext } from "../src/model-step"
import { testHandoffFile } from "../src/prompt"
import { scriptTmpDir } from "../src/script"
import { createServices, installServices, services, uninstallServices } from "../src/services"
import { createStuckTracker } from "../src/stuck"
import { parseSwitches } from "../src/switches"
import type { Steer, TestRun } from "../src/testrun"
import { watch } from "../src/watch"
import { ev, type AgentCall, type TurnScript } from "./fixtures/agent"
import { freshRepo, git, task } from "./fixtures/runner"
import { compareTrace, fireProbe, flush, runScenario, scrubTrace, TURN_EPOCH, TURN_TRACE_DIR, turnEntry, until, untilPublished, type InputKind, type ScenarioHand, type TurnScenario } from "./fixtures/turn-trace"

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

// —— The classifier-answer family's shared literals ——
// Wording no error pattern knows (another language's quota notice): the
// patterns class it unknown, so the classifier is asked beside the stream.
const UNKNOWN_WORDING = "Ihr Kontingent für diesen Tarif ist erschöpft"
// The classifier fake's scripted quota answer; its reset sits two hours past
// the fixed turn epoch, inside the accepted horizon, and renders in the
// registry's UTC zone in the ⚖ line.
const QUOTA_ANSWER = `{"class": "quota", "resetAt": "${new Date(TURN_EPOCH + 2 * 3_600_000).toISOString()}"}`
// The classifier fake's reply turn: one final text part carrying the JSON
// answer, then idle. Its calls stay on its own fake's record — the trace's
// `calls` section is the watched client's list only.
const answerTurn =
  (answer: string): TurnScript =>
  (ctx) => [ev.text(ctx.session, `cls_${ctx.session}`, answer), ev.idle(ctx.session)]
// The trace-observable checkpoint for "the classifier's answer landed": the
// answer cache lives in the run's router, and the caching link of the
// classify chain is attached before the watch's onAnswer link, so a cached
// answer means onAnswer has already run.
const answerCached = (message: string) => () => cachedAnswer(services().router, { message }) !== undefined

// —— The probe family's shared literal ——
// A probe verdict rides the fake's get, never a real timeout. The
// fail-then-recover scenario needs the first probe to fail and the second to
// succeed, and the fake consults its `fail` record at call time — so the
// record is mutable and the scenario deletes the key mid-run (this one
// scenario is its only user).
const PROBE_DOWN: Partial<Record<AgentCall, unknown>> = { get: new Error("connection refused") }

// —— The test-protocol family's shared helpers ——
// The batch drives the test execution / handover protocol at idle over a
// real temporary repository (freshRepo) and a hand-built TestRun whose
// paths come from the product's own helpers (the driver working directory
// scriptTmpDir, the scope-named handover document testHandoffFile).
// repoScenario's scrub replaces the environment noise in the trace — the
// repository's mkdtemp path (different on every run) and the script's
// wall-clock run time (runScript measures real milliseconds) — with fixed
// tokens, and normalizes the task's docs/ path so the recorded golden
// stays free of process-shaped paths.
function repoTestRun(dir: string, over: Partial<TestRun> = {}): TestRun {
  return {
    dir,
    tmp: scriptTmpDir(dir),
    handoffFile: join(dir, testHandoffFile(task)),
    handover: false,
    limit: 64_000,
    seq: 0,
    task,
    unit: "execute",
    subject: "T-001 exec sample task",
    label: "T-001",
    handovers: 0,
    startUsed: 0,
    ...over,
  }
}

const repoNoise = (dir: string): [string | RegExp, string][] => [
  [resolve(dir), "<repo>"],
  [dir, "<repo>"],
  ["docs/" + task.id, "docs/<task>"],
  [/took \d+ms/g, "took <ms>ms"],
]

// One repo-batch scenario: run additionally receives the repository cell
// it fills with the fresh path; the scrub (applied by the runner after the
// run) reads it from the same closure.
function repoScenario(def: Omit<TurnScenario, "run" | "scrub"> & { run: (h: ScenarioHand, repo: { dir: string }) => Promise<Watch> }): TurnScenario {
  const repo = { dir: "" }
  return { ...def, run: (h) => def.run(h, repo), scrub: (trace) => scrubTrace(trace, repoNoise(repo.dir)) }
}

// The test script and the request marker the batch shares: the protocol's
// path form (the marker names a script under test/, a single line).
async function scriptRequest(testRun: TestRun): Promise<void> {
  await mkdir(join(testRun.dir, "test"), { recursive: true })
  await mkdir(testRun.tmp, { recursive: true })
  await writeFile(join(testRun.dir, "test", "build.sh"), "#!/bin/sh\necho fixture-ok\n")
  await writeFile(join(testRun.tmp, "test.sh"), "test/build.sh\n")
}

// Write the handover document the session would have written (the
// `Status: continue` line on the last line is the completeness criterion).
async function writeHandoff(testRun: TestRun, text: string): Promise<void> {
  await mkdir(dirname(testRun.handoffFile), { recursive: true })
  await writeFile(testRun.handoffFile, text)
}

// Run fn with the production git seam installed over the scenario clock —
// the runner's default is the no-commit double, and the freeze scenarios
// commit for real on the temporary repository.
async function withRealGit<T>(h: ScenarioHand, fn: () => Promise<T>): Promise<T> {
  installServices(createServices({ clock: h.clock.clock, git: createGitOps() }))
  try {
    return await fn()
  } finally {
    uninstallServices()
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

  // —— The `error` and `retry` rows (plans/0061 §4.5) ——
  // Pattern verdicts only: no classifier wiring anywhere in this family
  // (opts.routing stays unset, so classifierFor finds no registry), so no
  // settle source exists beside the stream — the early settles below
  // (quota/auth/rate) happen synchronously inside the loop body over the
  // fake's immediately-resolving abort — and the queued probe timer is
  // never fired. Neither A-3 race materializes: no pins, no exclusions.

  // `error` row, failure cell: two session errors fold into error and
  // errorInfo — the name fold (`<name> <detail>` when the detail does not
  // name the error type), the message fold (the second classifyMsg
  // appended), the pessimistic isRetryable:false (never retracted),
  // terminal:true — with the limit fields arriving both ways: the first
  // error's reset comes from its own wording (withWording reads the stated
  // five-hour reset, +08:00 zone: 2026-09-29 10:30:00 there is
  // TURN_EPOCH + 9_000_000 here), the second carries retryAfterMs and
  // limitReason (withLimit lays them over the stated pair). The error path
  // never settles early: observation ends on the natural idle, and the
  // final Watch carries error, retryable:false, errorInfo, errorClass
  // "quota" (isRetryable:false reads as quota) and the stated reset fields.
  {
    id: "error-accumulate-idle-settle",
    kinds: ["message", "part", "error", "idle"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          ev.text("s", "t1", "partial work before the failure"),
          ev.step("s", "stp1"),
          ev.error("s", { name: "APIError", message: "Usage limit reached for 5 hour. Your limit will reset at 2026-09-29 10:30:00" }),
          ev.error("s", { name: "ProviderBoom", message: "account suspended", isRetryable: false, retryAfterMs: 45_000, limitReason: "out_of_credits" }),
          ev.idle("s"),
        ]),
        h.opts,
      ),
  },

  // `error` row, stepUp cell: an overflow session error below the top step
  // (the agent's own overflow pattern over the folded name + message)
  // takes the late step-up — the agent compacted before the step-up steer
  // could land, so no steer goes out; the ⇡ … step-up late line records
  // the move and steppedUp rides the final Watch, which also carries the
  // overflow error fields after the natural idle.
  {
    id: "error-overflow-step-up-late",
    kinds: ["message", "error", "idle"],
    agent: { limits: { "prov/base": 100_000, "prov/wide": 200_000 }, errorPatterns: { overflow: /context overflow/i } },
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
          ev.message("s", "m1", 1000),
          ev.error("s", { name: "ContextOverflowError", message: "context overflow: prompt exceeds the window" }),
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

  // `retry` row, guard cell: both retry signal forms — the id-carrying
  // retry part and the id-less session.status retry (+attempt/+next) — set
  // `retrying` and accumulate errorInfo without settling (the patterns
  // class the wording unknown); the ↻ request retry vlog fires once per
  // part id (the re-sent r1 is deduped by `seen`; the id-less form never
  // logs); the next model output ends `retrying`, and the turn settles
  // naturally on the idle with a clean Watch (a retry signal alone is no
  // error).
  {
    id: "retry-forms-vlog-dedup",
    kinds: ["message", "retry", "part", "idle"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: "blorp upstream hiccup" } },
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: "blorp upstream hiccup" } },
          { type: "retry", session: "s", attempt: 2, next: 5000, error: { message: "blorp upstream hiccup again" } },
          ev.text("s", "t1", "recovered after the retries"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
      ),
  },

  // `retry` row, failure cell (quota): isRetryable:false reads as quota
  // outright — the turn settles early: the still-running old turn is
  // aborted first, then the fixed snapshot field set (error from the
  // errorInfo message, retryable:false passed down, errorInfo, errorClass
  // "quota", failover:true) plus the stated reset fields (the event's own
  // resetAt/scope outrank every other source). The ↻ vlog never fires —
  // the settle precedes it.
  {
    id: "retry-quota-early-settle",
    kinds: ["message", "retry"],
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
            error: { message: "insufficient_quota: balance empty", isRetryable: false, resetAt: TURN_EPOCH + 7_200_000, scope: "5h" },
          },
        ]),
        h.opts,
      ),
  },

  // `retry` row, failure cell (auth): 401 + unauthorized wording — the
  // same early settle with retryable left undefined (only an explicit
  // isRetryable:false passes non-retryable down) and no reset fields
  // (nothing stated, no classifier wired).
  {
    id: "retry-auth-early-settle",
    kinds: ["message", "retry"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: "unauthorized: the api key was revoked", statusCode: 401 } },
        ]),
        h.opts,
      ),
  },

  // `retry` row, failure cell (rate): a 429 whose announced wait (120 s)
  // sits over the neutral policy's backoff cap (60 s) — the agent's own
  // retrying will not cure it (agentGaveUp), so the rate signal classes as
  // rate and the turn settles early; below the threshold the same signal
  // would only accumulate (that undecided case is the classifier's row).
  {
    id: "retry-rate-early-settle",
    kinds: ["message", "retry"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 2, next: 120_000, error: { message: "rate limit exceeded", statusCode: 429 } },
        ]),
        h.opts,
      ),
  },

  // `retry` row, failure cell (the per-minute gate): quota wording scoped
  // to a per-minute request cap while the agent is still backing off
  // (attempt below the policy cap, no long wait announced) does not settle
  // — the agent's own retrying cures it; the ↻ vlog fires and observation
  // continues to a natural idle settle.
  {
    id: "retry-per-minute-quota-observed",
    kinds: ["message", "retry", "part", "idle"],
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
            error: { message: "usage limit: too many requests this minute", scope: "request", resetAt: TURN_EPOCH + 30_000 },
          },
          ev.text("s", "t1", "the per-minute cap cleared"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
      ),
  },

  // `retry` row, liveness cell: over a policy that honours retry-after
  // (silence budget 60 s), a retry announcing a 120 s wait logs the ⏳ the
  // agent waits … line naming the clock-derived end instant; a follow-up
  // retry whose end lands within 1000 ms of the announced one updates
  // quietUntil silently (the dedup); model output ends the silence, so the
  // next long wait logs the line again. attempt and next stay below the
  // policy's gave-up thresholds throughout, so nothing settles.
  {
    id: "retry-announced-silence-dedup",
    kinds: ["message", "retry", "part", "idle"],
    agent: { retryPolicy: { maxAttempts: 5, backoffCapMs: 300_000, honorsRetryAfter: true, waitsOutLimit: true, silenceBudgetMs: 60_000 } },
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 2, next: 120_000, error: { message: "blorp upstream hiccup" } },
          { type: "retry", session: "s", id: "r2", attempt: 3, next: 120_500, error: { message: "blorp upstream hiccup" } },
          ev.text("s", "t1", "output ends the silence"),
          { type: "retry", session: "s", id: "r3", attempt: 4, next: 120_000, error: { message: "blorp upstream hiccup" } },
          ev.text("s", "t2", "finally recovered"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
      ),
  },

  // `retry` row, stepUp cell: the overflow read from the retry surface
  // (the agent retried the request that overflowed before compacting)
  // takes the same late step-up as the session.error surface — the ⇡ line,
  // no steer, steppedUp — and observation continues (overflow never
  // settles early) to a natural idle.
  {
    id: "retry-overflow-step-up-late",
    kinds: ["message", "retry", "part", "idle"],
    agent: { limits: { "prov/base": 100_000, "prov/wide": 200_000 }, errorPatterns: { overflow: /context overflow/i } },
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
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: "context overflow: the request overflowed before compaction" } },
          ev.text("s", "t1", "the compacted session answers"),
          ev.step("s", "stp1"),
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

  // —— The `answer` row (plans/0061 §4.5): the failure-message classifier ——
  // Every scenario wires the harness's classifier rig (a registry with a
  // `classifier` list and the gated classifier client behind opts.server)
  // and scripts the classifier fake's reply; UNKNOWN_WORDING classes unknown
  // to the error patterns, so the classifier is asked beside the stream.
  //
  // Race standing (A-3): interleaving 1 (held-settle-vs-external) is this
  // family's subject, and each scenario pins one of its observable outcomes
  // by construction — the `how` of each pin names the gates: the settle
  // preempting the held event wait; the settle landing mid-fx and winning
  // the next boundary; a resolvable event consumed before the in-flight
  // settle can land; the answer landing after consumption ended; the answer
  // landing while the turn is not retrying. Interleaving 2
  // (probe-during-fx) never materializes here: the queued probe timer is
  // never fired in this family.

  // `answer` row, recovery cell: the classifier's quota answer lands while
  // the turn still retries the undecided failure — onAnswer raises the
  // class, trip() preempts the held event wait, and the post-loop raised
  // settle aborts the still-running old turn before handing the class to
  // the escalation: the ⚖ line naming the answer and its reset, then the
  // fixed snapshot field set (errorClass, failover, classified) with
  // resetSource "classifier".
  {
    id: "answer-quota-raised-settle",
    kinds: ["message", "retry", "answer"],
    pins: [
      {
        race: "held-settle-vs-external",
        how: "the stream's next event sits behind a hold the scenario releases only after watch() returned, so inner.next() is pending when the answer trips the race — the settle is the only arm that can resolve",
      },
    ],
    run: async (h) => {
      const wiring = h.classifier({ agent: { turn: answerTurn(QUOTA_ANSWER) } })
      h.opts.routing = wiring.routing
      h.opts.server = wiring.server
      const held = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: UNKNOWN_WORDING } },
          { hold: held.promise },
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => wiring.agent.argsOf("create").length >= 1, "the classifier's one-shot session starting")
      wiring.release()
      const result = await done
      held.release()
      return result
    },
  },

  // `answer` row, the §4.4 boundary discipline: the answer lands while the
  // loop body awaits the human's reply to a question — trip() resolves, but
  // the in-flight fx completes first (the → human answer echo and
  // replyQuestion land in the trace before the abort), and the held settle
  // wins at the next boundary: the stream's next event stays gated, so the
  // race has one winner and the post-loop raised settle follows.
  {
    id: "answer-during-question-wait",
    kinds: ["message", "retry", "question", "answer"],
    pins: [
      {
        race: "held-settle-vs-external",
        how: "the answer lands while the loop body awaits the gated human reply and the stream's next event stays held, so at the next boundary tripped is settled and inner.next() is pending — the held settle wins",
      },
    ],
    run: async (h) => {
      const wiring = h.classifier({ agent: { turn: answerTurn(QUOTA_ANSWER) } })
      h.opts.routing = wiring.routing
      h.opts.server = wiring.server
      const io = h.interactive()
      h.opts.humanQuestions = true
      h.opts.interactive = io.interactive
      const held = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: UNKNOWN_WORDING } },
          ev.question("s", "q1", "which db?"),
          { hold: held.promise },
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => wiring.agent.argsOf("create").length >= 1, "the classifier's one-shot session starting")
      wiring.release()
      await untilPublished(answerCached(UNKNOWN_WORDING), "the classifier's answer landing while the body awaits the human")
      io.reply("use postgres")
      const result = await done
      held.release()
      return result
    },
  },

  // `answer` row, the race's other outcome: an external event resolvable
  // while the settle is still in flight is consumed first. The queued
  // retry's hold and the classifier's gate are released in one synchronous
  // stretch; the event resolves in microtasks while the answer structurally
  // needs the classifier fake's real-timer publish (a macrotask), so the
  // second retry is consumed (its ↻ vlog and accumulation land) before the
  // answer raises the class and trips the following boundary.
  {
    id: "answer-queued-event-consumed-first",
    kinds: ["message", "retry", "answer"],
    pins: [
      {
        race: "held-settle-vs-external",
        how: "the queued retry's hold and the classifier's gate are released in one synchronous stretch: the event resolves in microtasks while the answer needs the classifier fake's macrotask publish, so the event wins this boundary and the settle wins the next",
      },
    ],
    run: async (h) => {
      const wiring = h.classifier({ agent: { turn: answerTurn(QUOTA_ANSWER) } })
      h.opts.routing = wiring.routing
      h.opts.server = wiring.server
      const second = h.gate()
      const tail = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: UNKNOWN_WORDING } },
          { hold: second.promise },
          { type: "retry", session: "s", id: "r2", attempt: 2, error: { message: UNKNOWN_WORDING } },
          { hold: tail.promise },
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => wiring.agent.argsOf("create").length >= 1, "the classifier's one-shot session starting")
      second.release()
      wiring.release()
      const result = await done
      tail.release()
      return result
    },
  },

  // `answer` row, the late answer: the classify call is still gated when
  // the turn ends (the session error folds the retry's wording in, the idle
  // settles the turn); the final consult finds the call already in flight
  // and rides it as pendingReset. Released only after watch() returned, the
  // answer lands on a watch that no longer consumes (consuming false, so
  // onAnswer ignores it); the recorder awaits pendingReset and inlines the
  // answer's reset — and nothing else in the trace changes.
  {
    id: "answer-after-turn-ended-pending-reset",
    kinds: ["message", "retry", "error", "idle", "answer"],
    pins: [
      {
        race: "held-settle-vs-external",
        how: "the classifier's gate stays held until watch() returned, so the answer can land only when no event wait exists (consuming false) — onAnswer ignores it and pendingReset carries it",
      },
    ],
    run: async (h) => {
      const wiring = h.classifier({ agent: { turn: answerTurn(QUOTA_ANSWER) } })
      h.opts.routing = wiring.routing
      h.opts.server = wiring.server
      const result = await watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: UNKNOWN_WORDING } },
          ev.error("s", { name: "APIError", message: UNKNOWN_WORDING }),
          ev.idle("s"),
        ]),
        h.opts,
      )
      wiring.release()
      return result
    },
  },

  // `answer` row, the cached raise: the answer lands while the turn is not
  // retrying (the intervening model output cleared `retrying`, so onAnswer
  // records the answer but cannot raise); the next retry of the same turn
  // finds the cached answer in consult and raises the class synchronously —
  // the retry row's early settle with classified: true riding it (abort
  // first, then the ⚖ line and the fixed snapshot field set, the answer's
  // reset with resetSource "classifier").
  {
    id: "answer-cached-later-retry-settle",
    kinds: ["message", "retry", "part", "answer"],
    pins: [
      {
        race: "held-settle-vs-external",
        how: "the classifier's gate is released only after the text part was consumed (microtask-flushed, retrying cleared) and the loop parked at the next hold, so the answer cannot trip; the later retry reads the cached answer synchronously inside the loop body",
      },
    ],
    run: async (h) => {
      const wiring = h.classifier({ agent: { turn: answerTurn(QUOTA_ANSWER) } })
      h.opts.routing = wiring.routing
      h.opts.server = wiring.server
      const output = h.gate()
      const second = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 1, error: { message: UNKNOWN_WORDING } },
          { hold: output.promise },
          ev.text("s", "t1", "the retry got through"),
          { hold: second.promise },
          { type: "retry", session: "s", id: "r2", attempt: 2, error: { message: UNKNOWN_WORDING } },
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => wiring.agent.argsOf("create").length >= 1, "the classifier's one-shot session starting")
      output.release()
      // The text part's consumption is microtasks only (the loop parks at
      // the next hold), so a microtask flush structurally covers it before
      // the classifier's gate opens.
      await flush()
      wiring.release()
      await untilPublished(answerCached(UNKNOWN_WORDING), "the classifier's answer landing while the turn is not retrying")
      second.release()
      return done
    },
  },

  // —— The `idle`, `stream-end` and `probe` rows (plans/0061 §4.5) ——
  // Probe verdicts ride the fake's get (a `fail: { get }` or a working one),
  // never a real timeout, and the probe timer fires only when the scenario
  // fires it (fireProbe), so a probe's place in the trace is fixed by the
  // scenario's own ordering. Race standing (A-3): idle-twin-guard,
  // stream-end-interrupted, probe-failure-then-recovered and
  // probe-quiet-window-exempted fire their probes (if any) while the loop
  // waits on the held stream — the event wait is no fx call, and no probe
  // there reaches a trip — so neither interleaving materializes and nothing
  // is declared. probe-half-open-trip pins interleaving 1 (the half-open
  // trip preempting the held event wait); probe-during-question-wait pins
  // interleaving 2 (the timer fired inside the awaited askHuman).

  // `idle` row, guard + settle cells (the smoke's fuller sibling): the first
  // idle of the turn end handles a length continuation (the steer goes out),
  // and the twin idle the server emits beside it is ignored by idleHandled —
  // had it been handled, the turn would have settled there and the
  // post-steer events below would never enter the trace; after a new session
  // event re-arms acceptance, the closing idle settles the turn naturally.
  {
    id: "idle-twin-guard",
    kinds: ["message", "part", "idle"],
    run: async (h) => {
      const afterSteer = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          ev.text("s", "t1", "first chunk"),
          ev.step("s", "stp1", "length"),
          ev.idle("s"),
          // The twin idle of the same turn end: consumed and ignored, it
          // leaves no line and no call — the trace proves the guard by the
          // turn continuing to the post-steer events instead of settling.
          ev.idle("s"),
          { hold: afterSteer.promise },
          ev.text("s", "t2", "finished after the continuation"),
          ev.step("s", "stp2"),
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => h.agent.argsOf("promptAsync").length >= 1, "the length-continuation steer")
      afterSteer.release()
      return done
    },
  },

  // `stream-end` row: the finite stream exhausts without an idle (SSE
  // interruption) — the loop ends unsettled, the orphan turn is aborted, and
  // the close-out carries the stream-interrupted text with the
  // classification over the empty errorInfo (errorClass "unknown"; the
  // undefined errorInfo key vanishes from the serialized Watch).
  {
    id: "stream-end-interrupted",
    kinds: ["message", "part", "stream-end"],
    run: async (h) =>
      watch(
        h.agent.client,
        "s",
        h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "cut off mid-turn"), ev.step("s", "stp1")]),
        h.opts,
      ),
  },

  // `probe` row, the failure counter: with the stream held (the turn mid-
  // flight), one failed probe logs ⚠ connectivity probe failure 1/2 and
  // reschedules; the recovered probe then resets the count with no line —
  // the byte-compare proves the silence. Both probes are fired and flushed
  // while the next event sits behind the hold, so their place in the trace
  // is fixed; one failure never trips, so no race materializes.
  {
    id: "probe-failure-then-recovered",
    kinds: ["message", "part", "idle", "probe"],
    agent: { fail: PROBE_DOWN },
    run: async (h) => {
      const probing = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { hold: probing.promise },
          ev.text("s", "t1", "the connection held"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => h.agent.argsOf("contextLimits").length >= 1, "the first measurement")
      // The events up to the hold are consumed in microtasks only (the loop
      // parks at the hold), so a microtask flush structurally covers them.
      await flush()
      await fireProbe(h.clock) // get fails: ⚠ … failure 1/2, rescheduled
      delete PROBE_DOWN.get
      await fireProbe(h.clock) // get succeeds: the count resets, no line
      probing.release()
      return done
    },
  },

  // `probe` row, the half-open exit: two consecutive failures judge the
  // connection half-open — the ⚠ … failure 2/2 line, trip() preempting the
  // never-yielding stream, then the interrupted close-out with the distinct
  // half-open error text (classified transient on its network/timeout
  // wording), the abort, and the errorInfo folded from the message.
  {
    id: "probe-half-open-trip",
    kinds: ["message", "part", "probe"],
    agent: { fail: { get: new Error("connection refused") } },
    pins: [
      {
        race: "held-settle-vs-external",
        how: "the stream's next event sits behind a hold the scenario releases only after watch() returned, so inner.next() is pending when the half-open verdict trips the race — the settle is the only arm that can resolve",
      },
    ],
    run: async (h) => {
      const held = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "work in flight"), { hold: held.promise }, ev.idle("s")]),
        h.opts,
      )
      await until(() => h.agent.argsOf("contextLimits").length >= 1, "the first measurement")
      await flush()
      await fireProbe(h.clock) // failure 1/2
      await fireProbe(h.clock) // failure 2/2: half-open — trip() preempts the held event wait
      const result = await done
      held.release()
      return result
    },
  },

  // `probe` row, the named scenario (the plan's must-have): a probe verdict
  // while a human answer is pending. The loop body awaits the gated human
  // reply inside askHuman when the scenario fires the queued probe timer —
  // the probe callback logs its failure beside the await and cannot move the
  // loop (one failure never trips); the human's reply then completes the
  // in-flight fx (the → human answer echo and replyQuestion land after the
  // probe line) and the turn settles naturally on the idle.
  {
    id: "probe-during-question-wait",
    kinds: ["question", "idle", "probe"],
    agent: { fail: { get: new Error("connection refused") } },
    pins: [
      {
        race: "probe-during-fx",
        how: "the queued probe timer is fired while the loop body awaits the gated human reply inside askHuman — the fire happens at a chosen point inside an fx await the scenario controls (the wrapped interactive proves the await is in flight), so no other interleaving exists",
      },
    ],
    run: async (h) => {
      const io = h.interactive()
      let asked = 0
      h.opts.humanQuestions = true
      h.opts.interactive = {
        ...io.interactive,
        question: (text, minutes) => {
          asked++
          return io.interactive.question(text, minutes)
        },
      }
      const held = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([ev.question("s", "q1", "which db?"), { hold: held.promise }, ev.idle("s")]),
        h.opts,
      )
      await until(() => asked === 1, "the loop body awaiting the human answer")
      await fireProbe(h.clock) // the verdict lands beside the await: ⚠ … failure 1/2
      io.reply("use postgres")
      held.release()
      return done
    },
  },

  // `probe` row, the quiet-window exemption: an announced silence (a retry
  // whose 120 s wait exceeds the 60 s silence budget — the ⏳ line naming the
  // clock-derived end instant) suspends the failure count; two failed probes
  // fired inside the window log the exemption line (naming quietUntil) and
  // are not counted — had either counted, the second would have tripped the
  // turn half-open instead of settling naturally. The 30 s probe interval
  // (opts.idleMs) keeps the two fired deadlines (epoch +30 s, +60 s) inside
  // the 120 s window.
  {
    id: "probe-quiet-window-exempted",
    kinds: ["message", "retry", "part", "idle", "probe"],
    agent: {
      fail: { get: new Error("connection refused") },
      retryPolicy: { maxAttempts: 5, backoffCapMs: 300_000, honorsRetryAfter: true, waitsOutLimit: true, silenceBudgetMs: 60_000 },
    },
    run: async (h) => {
      h.opts.idleMs = 30_000
      const output = h.gate()
      const done = watch(
        h.agent.client,
        "s",
        h.script([
          ev.message("s", "m1", 1000),
          { type: "retry", session: "s", id: "r1", attempt: 2, next: 120_000, error: { message: "blorp upstream hiccup" } },
          { hold: output.promise },
          ev.text("s", "t1", "the wait is over"),
          ev.step("s", "stp1"),
          ev.idle("s"),
        ]),
        h.opts,
      )
      await until(() => h.agent.argsOf("contextLimits").length >= 1, "the first measurement")
      // The retry's consumption (the ⏳ line, quietUntil) is microtasks only.
      await flush()
      await fireProbe(h.clock) // fails inside the announced wait: exempted
      await fireProbe(h.clock) // exempted again — a counted pair would have tripped
      output.release()
      return done
    },
  },

  // —— The test protocol at idle (plans/0061 §4.5, the `idle` row's test
  // cells; the repo batch) ——
  // Race standing (A-3): no settle source exists anywhere in this batch
  // (no classifier wiring, and the queued probe timer is never fired), so
  // neither interleaving materializes and no pins or exclusions are
  // declared. The holds below gate post-steer event arrivals — the §4.4
  // queue discipline (external inputs run to completion), not a race pin.

  // Run and feedback: idle with a pending tmp/test.sh marker and no
  // handover due — executeTest runs the script (the ⚙ line with the
  // scrubbed run time), the rendered result is steered back, and the loop
  // continues; the next idle finds no marker and the turn settles
  // naturally.
  repoScenario({
    id: "test-run-and-feedback",
    kinds: ["message", "part", "idle"],
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir)
        await scriptRequest(testRun)
        const afterRun = h.gate()
        const done = watch(
          h.agent.client,
          "s",
          h.script([
            ev.message("s", "m1", 1000),
            ev.text("s", "t1", "the test script is ready"),
            ev.step("s", "stp1"),
            ev.idle("s"),
            { hold: afterRun.promise },
            ev.text("s", "t2", "the tests pass"),
            ev.step("s", "stp2"),
            ev.idle("s"),
          ]),
          h.opts,
          undefined,
          testRun,
        )
        // The steer follows a real script run (a spawned process), so the
        // checkpoint yields to the macrotask queue (untilPublished).
        await untilPublished(() => h.agent.argsOf("promptAsync").length >= 1, "the test-result feedback steer")
        // The request marker was consumed by the run.
        expect(existsSync(join(testRun.tmp, "test.sh"))).toBe(false)
        afterRun.release()
        const result = await done
        expect(await Bun.file(join(testRun.tmp, "test.1.out")).text()).toContain("fixture-ok")
        return result
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),

  // The due handover over the cap: the ⚠ … reached the … cap line, the
  // freeze commit through the production git seam on the real repository
  // (the ✓ git commit line with the `test handover #1 freeze` subject),
  // the marker consumed and pinned by resolveTestScript, the in-flight
  // handover record saved, the wrap-up steer, resumeWrapup seeded — then
  // the session writes the complete document and the next idle breaks
  // with testHandover: true.
  repoScenario({
    id: "test-handover-freeze-and-complete",
    kinds: ["message", "part", "idle"],
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir, { handover: true })
        await scriptRequest(testRun)
        const wrapup = h.gate()
        return await withRealGit(h, async () => {
          const done = watch(
            h.agent.client,
            "s",
            h.script([
              ev.message("s", "m1", 70_000),
              ev.text("s", "t1", "the test script is ready"),
              ev.step("s", "stp1"),
              ev.idle("s"),
              { hold: wrapup.promise },
              ev.text("s", "t2", "the wrap-up is written"),
              ev.step("s", "stp2"),
              ev.idle("s"),
            ]),
            h.opts,
            undefined,
            testRun,
          )
          // The steer follows the real freeze commit (spawned git), so the
          // checkpoint yields to the macrotask queue (untilPublished).
          await untilPublished(() => h.agent.argsOf("promptAsync").length >= 1, "the wrap-up steer")
          // The freeze landed: committed, the marker consumed and pinned,
          // the in-flight record saved, resumeWrapup seeded.
          expect(testRun.resumeWrapup).toBe(true)
          expect(testRun.pending).toEqual({ script: join(repo.dir, "test", "build.sh"), seq: 1 })
          expect(existsSync(join(testRun.tmp, "test.sh"))).toBe(false)
          expect(JSON.parse(await Bun.file(join(repo.dir, ".auto", "handover.json")).text())).toMatchObject({
            task: task.id,
            scope: testHandoffFile(task),
            unit: "execute",
            n: 1,
            script: join(repo.dir, "test", "build.sh"),
            seq: 1,
            pinSession: "s",
            pinMessage: "m1",
          })
          expect(await git(repo.dir, "log", "--format=%s", "-1")).toContain("test handover #1 freeze")
          // The session writes the complete handover document and ends.
          await writeHandoff(testRun, "# Handover\n\nThe progress so far.\n\nStatus: continue\n")
          wrapup.release()
          return done
        })
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),

  // The later idle over a complete handoff (a fresh watch instance
  // carrying the seeded resumeWrapup — the retry-loop / interruption-
  // recovery shape): the document is verified complete at the first idle
  // and the turn breaks with testHandover: true — no steer, no commit.
  repoScenario({
    id: "test-handover-resume-wrapup-complete",
    kinds: ["message", "part", "idle"],
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir, { handover: true, resumeWrapup: true })
        await writeHandoff(testRun, "# Handover\n\nThe progress so far.\n\nStatus: continue\n")
        return await watch(
          h.agent.client,
          "s",
          h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "the wrap-up is written"), ev.step("s", "stp1"), ev.idle("s")]),
          h.opts,
          undefined,
          testRun,
        )
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),

  // Strict resume at the handover boundary (strictResumeActive: the
  // switch on, the recording git seam — opts.git unset defaults to the
  // production seam — and no dryrun): one invalid document decides it,
  // with no backfill steer — the testHandoverInvalid blocked exit, its
  // fixed question (the handoff path scrubbed) and the last agent output.
  repoScenario({
    id: "test-handover-strict-invalid",
    kinds: ["message", "part", "idle"],
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir, { handover: true, resumeWrapup: true })
        await writeHandoff(testRun, "# Handover\n\nHalf-written, no status line.\n")
        return await watch(
          h.agent.client,
          "s",
          h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "half-written handover"), ev.step("s", "stp1"), ev.idle("s")]),
          h.opts,
          undefined,
          testRun,
          undefined,
          parseSwitches({ OPENCODE_AUTO_STRICT_RESUME: "on" }),
        )
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),

  // Without strict resume the first invalid document earns one backfill
  // steer (the hard-requirement text naming the handoff path); the second
  // idle over the still invalid document blocks — the failed-twice
  // question carrying the handoff path and the last agent output.
  repoScenario({
    id: "test-handover-backfill-twice-blocked",
    kinds: ["message", "part", "idle"],
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir, { handover: true, resumeWrapup: true })
        await writeHandoff(testRun, "# Handover\n\nHalf-written, no status line.\n")
        const second = h.gate()
        const done = watch(
          h.agent.client,
          "s",
          h.script([
            ev.message("s", "m1", 1000),
            ev.text("s", "t1", "the first wrap-up attempt"),
            ev.step("s", "stp1"),
            ev.idle("s"),
            { hold: second.promise },
            ev.text("s", "t2", "the second wrap-up attempt"),
            ev.step("s", "stp2"),
            ev.idle("s"),
          ]),
          h.opts,
          undefined,
          testRun,
          undefined,
          parseSwitches({}),
        )
        // The steer follows a real document read (Bun.file), so the
        // checkpoint yields to the macrotask queue (untilPublished).
        await untilPublished(() => h.agent.argsOf("promptAsync").length >= 1, "the backfill steer")
        second.release()
        return done
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),

  // The steer-dispatch-failure block of the backfill: the handover
  // request is out (resumeWrapup), the document is missing, and the
  // backfill steer's dispatch fails — the ⚠ steer dispatch failed line
  // and the blocked exit with the fixed asking-to-backfill question.
  repoScenario({
    id: "test-handover-backfill-steer-failed",
    kinds: ["message", "part", "idle"],
    agent: { fail: { promptAsync: undefined } },
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir, { handover: true, resumeWrapup: true })
        return await watch(
          h.agent.client,
          "s",
          h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "no handover written"), ev.step("s", "stp1"), ev.idle("s")]),
          h.opts,
          undefined,
          testRun,
        )
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),

  // The steer-dispatch-failure block of the handover request: the freeze
  // already landed (the commit, the pinned script, the saved record) when
  // the wrap-up steer's dispatch fails — the blocked exit with the fixed
  // test-handover-request question, resumeWrapup left unseeded.
  repoScenario({
    id: "test-handover-request-steer-failed",
    kinds: ["message", "part", "idle"],
    agent: { fail: { promptAsync: undefined } },
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir, { handover: true })
        await scriptRequest(testRun)
        return await withRealGit(h, async () => {
          const result = await watch(
            h.agent.client,
            "s",
            h.script([
              ev.message("s", "m1", 70_000),
              ev.text("s", "t1", "the test script is ready"),
              ev.step("s", "stp1"),
              ev.idle("s"),
            ]),
            h.opts,
            undefined,
            testRun,
          )
          // The freeze landed before the failed dispatch: the commit, the
          // pinned script, the saved record; resumeWrapup stays unseeded.
          expect(testRun.resumeWrapup).toBe(undefined)
          expect(testRun.pending).toEqual({ script: join(repo.dir, "test", "build.sh"), seq: 1 })
          expect(await git(repo.dir, "log", "--format=%s", "-1")).toContain("test handover #1 freeze")
          return result
        })
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),

  // The steer-dispatch-failure block of the result feedback: the script
  // ran (the ⚙ line with the scrubbed run time) and the result steer's
  // dispatch failed — the blocked exit with the fixed
  // test-result-feedback question.
  repoScenario({
    id: "test-result-feedback-steer-failed",
    kinds: ["message", "part", "idle"],
    agent: { fail: { promptAsync: undefined } },
    run: async (h, repo) => {
      repo.dir = await freshRepo()
      try {
        const testRun = repoTestRun(repo.dir)
        await scriptRequest(testRun)
        return await watch(
          h.agent.client,
          "s",
          h.script([
            ev.message("s", "m1", 1000),
            ev.text("s", "t1", "the test script is ready"),
            ev.step("s", "stp1"),
            ev.idle("s"),
          ]),
          h.opts,
          undefined,
          testRun,
        )
      } finally {
        await rm(repo.dir, { recursive: true, force: true })
      }
    },
  }),
]

describe("the turn-trace oracle", () => {
  for (const scenario of scenarios) {
    test(`trace: ${scenario.id}`, async () => {
      compareTrace(scenario, await runScenario(scenario))
    })
  }
})

// —— The roster: the arbitration table's cell → scenario map (0061 §4.5) ——
// The §4.5 rows and their concern cells, transcribed statically, each cell
// naming the scenarios whose family comment declares it covered. At D0 the
// case below asserts what is statically known: every input kind fired in at
// least one recorded trace — the kind's row names at least one scenario,
// every named scenario is registered, declares the kind in its `kinds`, and
// has its golden on disk — and the map cannot drift away from the recorded
// set (every registered scenario is named at least once). The full
// every-cell assertion completes at D9 (0061 §6.3), when the engine's table
// exists as code and each cell's coverage is checked against it; until then
// the cell keys are the plan's transcription, not checked artifacts.
const ROSTER: Record<InputKind, Record<string, readonly string[]>> = {
  limit: {
    windows: ["limit-windows-change"],
  },
  part: {
    guard: ["part-transcript-dedup"],
    failure: ["part-output-ends-retry"],
    liveness: ["part-length-continue-reset"],
    stepUp: ["part-step-cache-confirmed", "part-step-cache-contradiction-once"],
    transcript: ["part-transcript-dedup", "smoke-natural-settle"],
    stuck: ["part-stuck-hint"],
  },
  message: {
    guard: ["part-transcript-dedup"],
    transcript: ["message-transcript-filter", "smoke-natural-settle"],
    usage: [
      "message-measurement-window",
      "message-wall-steer",
      "message-usage-notice-highest-band",
      "message-wall-steer-failed",
      "message-usage-notice-steer-failed",
      "message-dual-steer-notice-step-up",
    ],
    stepUp: ["message-dual-steer-notice-step-up"],
  },
  question: {
    questions: [
      "question-human-answer",
      "question-human-closed-block",
      "question-human-repeat-block",
      "question-wait-answer-human-reply",
      "question-wait-answer-timeout-fallback",
      "question-permission-word-default-block",
      "question-dryrun-auto-answer",
    ],
  },
  permission: {
    questions: [
      "permission-dryrun-deny",
      "permission-auto-allow",
      "permission-ask-allow-timeout",
      "permission-ask-deny-timeout",
      "permission-ask-human-allow",
      "permission-ask-human-deny",
      "permission-ask-fail-block",
    ],
  },
  error: {
    guard: ["error-accumulate-idle-settle"],
    failure: ["error-accumulate-idle-settle"],
    stepUp: ["error-overflow-step-up-late"],
  },
  retry: {
    guard: ["retry-forms-vlog-dedup"],
    failure: ["retry-forms-vlog-dedup", "retry-per-minute-quota-observed"],
    recovery: ["retry-quota-early-settle", "retry-auth-early-settle", "retry-rate-early-settle", "retry-per-minute-quota-observed"],
    stepUp: ["retry-overflow-step-up-late"],
    liveness: ["retry-announced-silence-dedup"],
    transcript: ["retry-forms-vlog-dedup"],
  },
  idle: {
    guard: ["idle-twin-guard"],
    test: [
      "test-run-and-feedback",
      "test-handover-freeze-and-complete",
      "test-handover-resume-wrapup-complete",
      "test-handover-strict-invalid",
      "test-handover-backfill-twice-blocked",
      "test-handover-backfill-steer-failed",
      "test-handover-request-steer-failed",
      "test-result-feedback-steer-failed",
    ],
    liveness: ["part-length-continue-reset", "part-length-continue-steer-failed"],
    spine: ["smoke-natural-settle", "idle-twin-guard"],
  },
  "stream-end": {
    spine: ["stream-end-interrupted"],
  },
  probe: {
    liveness: ["probe-failure-then-recovered", "probe-half-open-trip", "probe-during-question-wait", "probe-quiet-window-exempted"],
  },
  answer: {
    recovery: [
      "answer-quota-raised-settle",
      "answer-during-question-wait",
      "answer-queued-event-consumed-first",
      "answer-after-turn-ended-pending-reset",
      "answer-cached-later-retry-settle",
    ],
  },
}

test("roster: every input kind fired in at least one recorded trace", () => {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
  const named = new Set<string>()
  for (const [kind, cells] of Object.entries(ROSTER) as [InputKind, Record<string, readonly string[]>][]) {
    const ids = Object.values(cells).flat()
    expect(ids.length, `the ${kind} row names at least one scenario`).toBeGreaterThan(0)
    for (const id of ids) {
      const scenario = byId.get(id)
      expect(scenario, `roster names a registered scenario: ${id}`).toBeDefined()
      expect(scenario!.kinds, `${id} declares the ${kind} input`).toContain(kind)
      expect(existsSync(join(TURN_TRACE_DIR, `${id}.json`)), `the recorded trace is on disk: ${id}.json`).toBe(true)
      named.add(id)
    }
  }
  expect([...named].sort(), "every recorded scenario is named in the roster at least once").toEqual(
    scenarios.map((scenario) => scenario.id).sort(),
  )
})
