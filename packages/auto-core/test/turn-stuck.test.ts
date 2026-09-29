// The stuck concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the stuck-loop hint — a newly echoed terminal tool part (the
// transcript concern's fresh flag, driven here through the real transcript
// concern so the channel runs as it does in the part row) feeds the detector;
// a hit logs, books the model's stuck counter and steers the hint, a failed
// dispatch is ignored, and nothing else ever reaches the tracker.
import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { Advice } from "../src/engine/contract"
import { stuckConcern } from "../src/engine/concerns/stuck"
import { transcriptConcern } from "../src/engine/concerns/transcript"
import { createStuckTracker, type StuckTracker } from "../src/stuck"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev } from "./fixtures/agent"

const SESSION = "ses_1"

// Drives the part row's tail as the spine does: the transcript concern's
// cell first (it echoes the part and sets the fresh flag), then the stuck
// concern's cell.
const setup = (stuck?: StuckTracker, over: { steerOk?: boolean } = {}): { drive: (event: AgentEvent) => Promise<Advice>; fx: ReturnType<typeof fakeTurnFx> } => {
  const ctx = turnContext({ ...(stuck !== undefined ? { stuck } : {}) })
  const transcript = transcriptConcern.initial(ctx)
  const own = stuckConcern.initial(ctx)
  const view = viewOver({ transcript })
  const fx = fakeTurnFx(over)
  const input = (event: AgentEvent) => ({ kind: "event", event }) as const
  const drive = async (event: AgentEvent): Promise<Advice> => {
    await transcriptConcern.handle(input(event), transcript, view, fx, ctx)
    return stuckConcern.handle(input(event), own, view, fx, ctx)
  }
  return { drive, fx }
}

// A counting tracker double: records every call the concern feeds it.
const recording = (): { tracker: StuckTracker; calls: unknown[] } => {
  const calls: unknown[] = []
  return { tracker: { observe: (call) => (calls.push(call), undefined) }, calls }
}

describe("the stuck concern (the part row's last cell)", () => {
  test("identical completed tool calls trip the detector: the warning line, the model's stuck counter and one hint steer", async () => {
    const { drive, fx } = setup(createStuckTracker())
    for (let i = 1; i <= 4; i++) {
      await expect(drive(ev.tool(SESSION, `pt_${i}`, "Bash", { cmd: "ls" }, "a b c"))).resolves.toBe("consumed")
    }
    expect(fx.lines).toEqual([`⚠ repetitive action detected: Bash has 4 consecutive identical calls with identical results; inserting a hint (level 1/3)`])
    expect(fx.calls).toContain("statsModelEvent")
    expect(fx.steers).toHaveLength(1)
    expect(fx.steers[0]).toContain("[DRIVER] Loop detected: the tool Bash has now returned exactly the same result 4 times for the same arguments.")
  })

  test("identical tool errors trip the detector on the error criterion (the lower threshold)", async () => {
    const { drive, fx } = setup(createStuckTracker())
    for (let i = 1; i <= 3; i++) {
      const event: AgentEvent = {
        type: "part",
        session: SESSION,
        part: { kind: "tool", id: `pt_e${i}`, tool: "Read", status: "error", input: { path: "x" }, error: "no such file" },
      }
      await expect(drive(event)).resolves.toBe("consumed")
    }
    expect(fx.lines).toEqual([`⚠ repetitive action detected: Read has 3 consecutive identical errors; inserting a hint (level 1/3)`])
    expect(fx.steers[0]).toContain("the tool Read has now failed 3 times with exactly the same error.")
  })

  test("a failed hint dispatch is ignored: the concern still consumes, nothing settles", async () => {
    const { drive, fx } = setup(createStuckTracker(), { steerOk: false })
    for (let i = 1; i <= 4; i++) {
      await expect(drive(ev.tool(SESSION, `pt_${i}`, "Bash", { cmd: "ls" }, "a b c"))).resolves.toBe("consumed")
    }
    expect(fx.steers).toHaveLength(1)
  })

  test("a re-sent part (not fresh) is not fed to the tracker a second time", async () => {
    const { tracker, calls } = recording()
    const { drive } = setup(tracker)
    const event = ev.tool(SESSION, "pt_1", "Bash", { cmd: "ls" }, "a b c")
    await drive(event)
    await drive(event)
    expect(calls).toHaveLength(1)
  })

  test("a running tool part, a text part and a step-finish part are not fed (only terminal tool parts are)", async () => {
    const { tracker, calls } = recording()
    const { drive } = setup(tracker)
    await drive({ type: "part", session: SESSION, part: { kind: "tool", id: "pt_r", tool: "Bash", status: "running", input: { cmd: "ls" } } })
    await drive(ev.text(SESSION, "pt_t", "working"))
    await drive(ev.step(SESSION, "pt_s"))
    expect(calls).toHaveLength(0)
  })

  test("without a tracker (the detection off) the concern consumes and calls nothing", async () => {
    const { drive, fx } = setup(undefined)
    for (let i = 1; i <= 4; i++) {
      await expect(drive(ev.tool(SESSION, `pt_${i}`, "Bash", { cmd: "ls" }, "a b c"))).resolves.toBe("consumed")
    }
    expect(fx.calls.filter((name) => name !== "vlog")).toEqual([])
  })
})
