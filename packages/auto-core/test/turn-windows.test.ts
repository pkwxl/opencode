// The windows concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the account's usage windows — onLimit fires only when the event
// changed against what this client last logged (the router's noteWindows,
// which also prints the line), and the input is consumed without touching
// the twin-idle guard.
import { describe, expect, test } from "bun:test"
import type { AgentEvent, LimitWindow } from "../src/agent/types"
import { windowsConcern } from "../src/engine/concerns/windows"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"

const SESSION = "ses_1"
const RESET = Date.parse("2026-09-29T12:00:00Z")

const limit = (status: "allowed" | "warning" | "rejected", windows: LimitWindow[]): AgentEvent => ({
  type: "limit",
  session: SESSION,
  status,
  windows,
})

// Captures the log module's terminal output around one drive (the router's
// window line goes through log(), not the fx).
const capture = async (fn: () => Promise<unknown>): Promise<string[]> => {
  const lines: string[] = []
  const orig = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "))
  }
  try {
    await fn()
  } finally {
    console.log = orig
  }
  return lines
}

describe("the windows concern (the limit row)", () => {
  test("a changed limit event reaches the run's recorder (onLimit) and consumes the input; the window line is logged", async () => {
    const ctx = turnContext()
    const own = windowsConcern.initial(ctx)
    const fx = fakeTurnFx()
    const lines = await capture(() => windowsConcern.handle({ kind: "event", event: limit("allowed", [{ scope: "5h", resetAt: RESET, utilization: 0.4 }]) }, own, viewOver({}), fx, ctx))
    expect(fx.limits).toHaveLength(1)
    expect(fx.limits[0]?.status).toBe("allowed")
    expect(fx.calls).toEqual(["onLimit"])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("ℹ usage windows")
    expect(lines[0]).toContain("5h 40% used")
    expect(lines[0]).toContain(`resets ${new Date(RESET).toISOString()}`)
  })

  test("an unchanged re-send fires no second onLimit (logged once per change)", async () => {
    const ctx = turnContext()
    const own = windowsConcern.initial(ctx)
    const fx = fakeTurnFx()
    const event = limit("allowed", [{ scope: "5h", resetAt: RESET, utilization: 0.4 }])
    await windowsConcern.handle({ kind: "event", event }, own, viewOver({}), fx, ctx)
    await windowsConcern.handle({ kind: "event", event }, own, viewOver({}), fx, ctx)
    expect(fx.limits).toHaveLength(1)
  })

  test("a changed status or reset fires again: each change reaches the recorder", async () => {
    const ctx = turnContext()
    const own = windowsConcern.initial(ctx)
    const fx = fakeTurnFx()
    await windowsConcern.handle({ kind: "event", event: limit("allowed", [{ scope: "5h", resetAt: RESET, utilization: 0.4 }]) }, own, viewOver({}), fx, ctx)
    await windowsConcern.handle({ kind: "event", event: limit("warning", [{ scope: "5h", resetAt: RESET, utilization: 0.9 }]) }, own, viewOver({}), fx, ctx)
    await windowsConcern.handle({ kind: "event", event: limit("rejected", [{ scope: "5h", resetAt: RESET + 3_600_000, utilization: 1 }]) }, own, viewOver({}), fx, ctx)
    expect(fx.limits.map((event) => event.status)).toEqual(["allowed", "warning", "rejected"])
  })

  test("a non-limit input passes (the concern's only cell is the limit row's)", async () => {
    const ctx = turnContext()
    const own = windowsConcern.initial(ctx)
    const fx = fakeTurnFx()
    await expect(windowsConcern.handle({ kind: "event", event: { type: "idle", session: SESSION } }, own, viewOver({}), fx, ctx)).resolves.toBe("pass")
    expect(fx.calls).toEqual([])
  })
})
