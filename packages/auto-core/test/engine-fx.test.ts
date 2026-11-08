// The production TurnFx constructor's own laws (plans/0232 D2, finding
// 0165-063/S01-05 — the module had no direct test import; the concern suites
// drive the fx double, the spine/replay scenarios the wrap from above):
// the kernel members' guard (they exist only inside the test protocol and
// throw on a turn without a test run), the contextLimits memoization (one
// client fetch per turn — the old body's `limits ??=`), steer's model
// resolution (a named model wins, the steerModel getter defaults the
// unnamed call and a changed getter value is seen by the steers that follow
// — the mid-turn step-up the getter exists for), the failed dispatch
// answering false, the text reaching the usage source, and the journaling
// wrap's event discipline over a started journal (the call event for every
// member, fx-result for answered members — sync and resolved — fx-reject
// for a rejection that still rethrows, no answer for the pure sinks). The
// journal fd is process-global: startRunEvents/stopRunEvents bracket every
// journal assertion in a finally.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeAgent } from "./fixtures/agent"
import { turnContext } from "./fixtures/turn"
import { makeTurnFx } from "../src/engine/fx"
import { startRunEvents, stopRunEvents, RUN_EVENTS_FILE } from "../src/engine/events"
import { createServices, type RunServices } from "../src/services"
import type { GitOps } from "../src/git"
import type { Handover } from "../src/handover"
import type { TestRun } from "../src/testrun"

describe("makeTurnFx — the kernel guard", () => {
  const kernelCall = (fx: ReturnType<typeof makeTurnFx>) => [
    () => fx.commitFreeze(1),
    () => fx.runTest(),
    () => fx.resolveTest(),
    () => fx.saveHandover({} as Handover),
  ]
  test("the test-protocol members throw on a turn without a test run", () => {
    const agent = fakeAgent()
    const ctx = turnContext({ client: agent.client })
    const fx = makeTurnFx({ ctx })
    for (const call of kernelCall(fx)) {
      expect(call).toThrow(
        "turn engine fx: a test-protocol kernel call (commitFreeze/runTest/resolveTest/saveHandover) on a turn without a test run",
      )
    }
  })

  test("with a test run, commitFreeze rides the git service's afterSession under the suffixed handover subject", async () => {
    const agent = fakeAgent()
    const seen: { dir: string; stage: string; subject: string }[] = []
    const git = {
      records: true,
      async afterSession(dir: string, _opts: unknown, _task: unknown, info: { stage: string; subject: string }) {
        seen.push({ dir, stage: info.stage, subject: info.subject })
        return { type: "ok" as const }
      },
    } as unknown as GitOps
    const services: RunServices = createServices({ git })
    const test = {
      dir: "/target",
      tmp: "/target/tmp",
      handoffFile: "/target/handoff.md",
      handover: true,
      limit: 1,
      seq: 1,
      task: { id: "T-001", title: "the widget" },
      unit: "T-001",
      subject: "T-001 exec the widget",
      label: "T-001",
      handovers: 0,
      startUsed: 0,
    } as unknown as TestRun
    const ctx = turnContext({ client: agent.client, services, test })
    const fx = makeTurnFx({ ctx })
    await expect(fx.commitFreeze(2)).resolves.toEqual({ type: "ok" })
    expect(seen).toEqual([{ dir: "/target", stage: "T-001 handoff-2-pin", subject: "T-001 exec the widget test handover #2 freeze" }])
  })
})

describe("makeTurnFx — contextLimits memoization (one fetch per turn)", () => {
  test("two calls, one client fetch, the same map both times", async () => {
    const agent = fakeAgent({ limits: { "fake/model-1": 128000 } })
    const fx = makeTurnFx({ ctx: turnContext({ client: agent.client }) })
    const first = await fx.contextLimits()
    const second = await fx.contextLimits()
    expect(agent.argsOf("contextLimits")).toEqual([[]]) // exactly one fetch
    expect(first.get("fake/model-1")).toBe(128000)
    expect(second).toBe(first) // the memoized map, not a re-fetch
  })
})

describe("makeTurnFx — steer's model resolution and failure arm", () => {
  test("a named model wins; the steerModel getter defaults the unnamed call and a later steer sees its change", async () => {
    const agent = fakeAgent()
    let stepped: string | undefined = "fake/model-1"
    const fx = makeTurnFx({
      ctx: turnContext({ client: agent.client }),
      steerModel: () => stepped,
    })
    await fx.steer("keep going", "named/model")
    await fx.steer("keep going anyway")
    stepped = "fake/model-2" // the mid-turn step-up: the getter reads live
    await fx.steer("third")
    expect(agent.calls.filter((call) => call.name === "promptAsync").map((call) => call.args[0])).toEqual([
      { session: "ses_1", text: "keep going", model: "named/model" },
      { session: "ses_1", text: "keep going anyway", model: "fake/model-1" },
      { session: "ses_1", text: "third", model: "fake/model-2" },
    ])
    // With no getter at all and no name, the dispatch carries no model key.
    const bare = makeTurnFx({ ctx: turnContext({ client: agent.client }) })
    await bare.steer("no model here")
    expect(agent.argsOf("promptAsync").at(-1)).toEqual([{ session: "ses_1", text: "no model here" }])
  })

  test("a failed dispatch answers false (the ⚠ line is the log's); the text reaches the usage source", async () => {
    const agent = fakeAgent({ fail: { promptAsync: new Error("channel closed") } })
    const prompts: string[] = []
    const source = { ...turnContext().source, prompt: (text: string) => prompts.push(text) }
    const ctx = turnContext({ client: agent.client, source })
    const fx = makeTurnFx({ ctx })
    await expect(fx.steer("try anyway")).resolves.toBe(false)
    expect(agent.steers).toEqual(["try anyway"]) // the dispatch happened
    expect(prompts).toEqual(["try anyway"]) // the usage source saw the text
  })
})

describe("makeTurnFx — the journaling wrap (plans/0061 R4/F1)", () => {
  test("every member appends its call; answered members their result; a rejection its fx-reject and the rethrow; sinks no answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-fx-journal-"))
    const agent = fakeAgent({ limits: { "fake/model-1": 1000 } })
    const fx = makeTurnFx({ ctx: turnContext({ client: agent.client }) })
    startRunEvents(dir)
    try {
      // A sync answered member: now → the clock's reading (a number; the
      // event discipline is the subject, the clock's own origin is not).
      expect(typeof fx.now()).toBe("number")
      // An async answered member: contextLimits.
      await fx.contextLimits()
      // A pure sink: log records the call and no answer.
      fx.log("one line")
      // A rejecting member: readText on a path that does not exist.
      const missing = join(dir, "no-such-file")
      await expect(fx.readText(missing)).rejects.toThrow()
      let events: unknown[]
      try {
        events = readFileSync(join(dir, RUN_EVENTS_FILE), "utf8").trim().split("\n").map((line) => JSON.parse(line))
      } finally {
        stopRunEvents()
      }
      expect(events).toEqual([
        { type: "fx", member: "now", args: [] },
        { type: "fx-result", value: expect.any(Number) },
        { type: "fx", member: "contextLimits", args: [] },
        // The one Map-valued answer rides the journal's $map encoding
        // (encodeRunValue), so the replay fixture can decode it back.
        { type: "fx-result", value: { $map: [["fake/model-1", 1000]] } },
        { type: "fx", member: "log", args: ["one line"] },
        { type: "fx", member: "readText", args: [missing] },
        { type: "fx-reject", error: expect.any(String) },
      ])
      // The journal is stopped: a further call appends nothing.
      fx.log("after the stop")
      expect(readFileSync(join(dir, RUN_EVENTS_FILE), "utf8").trim().split("\n")).toHaveLength(7)
    } finally {
      stopRunEvents()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("with no run started, the journal is a no-op — the calls pass through untouched", async () => {
    const agent = fakeAgent()
    const fx = makeTurnFx({ ctx: turnContext({ client: agent.client }) })
    // No startRunEvents: these would have thrown on a missing directory in
    // the assert above's shape; here they simply run.
    expect(fx.log("unrecorded")).toBeUndefined()
    await expect(fx.contextLimits()).resolves.toBeDefined()
  })
})
