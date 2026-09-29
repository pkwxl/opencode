// The transcript concern's suite (plans/0061 §4.6: a concern suite over a
// fake TurnFx): terminal echo and billing — the final text part (lastText),
// the once-per-part echo (seen), the step-finish billing dedup (billed, the
// re-homed watch.test.ts case), the once-per-watch model report, the
// measurement point's filter (only a new completed assistant message passes
// the row on) and the retry vlog dedup.
import { describe, expect, test } from "bun:test"
import type { AgentEvent, AgentPart } from "../src/agent/types"
import type { Advice, TurnState } from "../src/engine/contract"
import { transcriptConcern } from "../src/engine/concerns/transcript"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev, MODEL } from "./fixtures/agent"

const SESSION = "ses_1"

const part = (p: AgentPart): AgentEvent => ({ type: "part", session: SESSION, part: p })

// A step-finish part carrying every token sub-field (the fixture's ev.step
// zeroes reasoning and the cache columns).
const stepFinish = (id: string, tokens: { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }, cost = 0): AgentPart => ({
  kind: "step-finish",
  id,
  reason: "stop",
  cost,
  tokens: { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning ?? 0, cacheRead: tokens.cacheRead ?? 0, cacheWrite: tokens.cacheWrite ?? 0 },
})

type Own = TurnState["transcript"]
type Drive = (event: AgentEvent, fx?: ReturnType<typeof fakeTurnFx>) => Promise<Advice>

// One concern instance per case, driven over one event at a time.
const setup = (): { own: Own; drive: Drive; fx: ReturnType<typeof fakeTurnFx> } => {
  const ctx = turnContext()
  const own = transcriptConcern.initial(ctx)
  const fx = fakeTurnFx()
  const drive: Drive = (event, useFx) => transcriptConcern.handle({ kind: "event", event }, own, viewOver({}), useFx ?? fx, ctx)
  return { own, drive, fx }
}

describe("the transcript concern (part: billing, echo, the fresh flag)", () => {
  test("a step-finish part accumulates every sub-field; steps counts parts", async () => {
    const { own, drive } = setup()
    await drive(part(stepFinish("pt_1", { input: 1200, output: 300, reasoning: 50, cacheRead: 800, cacheWrite: 100 }, 0.01)))
    await drive(part(stepFinish("pt_2", { input: 500, output: 40 }, 0.02)))
    expect(own.usage).toEqual({ input: 1700, output: 340, reasoning: 50, cacheRead: 800, cacheWrite: 100, cost: 0.03, steps: 2 })
  })

  // Re-homed from test/watch.test.ts ("a re-sent part — SSE replaying the
  // same step-finish update event — is not counted twice"): the billing
  // dedup is this concern's mechanism; the original case is deleted there.
  test("a re-sent part (SSE replaying the same step-finish update event) is not counted twice", async () => {
    const { own, drive } = setup()
    const sent = part(stepFinish("pt_sf1", { input: 1200, output: 300 }, 0.02))
    await drive(sent)
    await drive(sent)
    expect(own.usage).toEqual({ input: 1200, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02, steps: 1 })
  })

  test("a final text part sets lastText and vlogs the text; the input stops there (the stuck cell never sees it)", async () => {
    const { own, drive, fx } = setup()
    await expect(drive(part({ kind: "text", id: "pt_t1", text: "done: the work", final: true }))).resolves.toBe("consumed")
    expect(own.lastText).toBe("done: the work")
    expect(fx.vlogs).toEqual(["done: the work"])
    // A non-final text piece is neither recorded nor echoed, but still stops
    // the input.
    await expect(drive(part({ kind: "text", id: "pt_t2", text: "partial…", final: false }))).resolves.toBe("consumed")
    expect(own.lastText).toBe("done: the work")
    expect(fx.vlogs).toEqual(["done: the work"])
  })

  test("a part with a describePart line is echoed once and named by the fresh flag; a re-send is neither echoed nor fresh", async () => {
    const { own, drive, fx } = setup()
    await expect(drive(ev.tool(SESSION, "pt_w1", "Bash", { cmd: "ls" }, "a b c"))).resolves.toBe("pass")
    expect(fx.vlogs).toEqual(["  tool Bash: Bash"])
    expect(own.fresh).toBe("pt_w1")
    expect(own.seen.has("pt_w1")).toBe(true)
    // The re-sent update: no second echo, no fresh flag.
    await expect(drive(ev.tool(SESSION, "pt_w1", "Bash", { cmd: "ls" }, "a b c"))).resolves.toBe("pass")
    expect(fx.vlogs).toEqual(["  tool Bash: Bash"])
    expect(own.fresh).toBeUndefined()
  })

  test("a part with no line (a running tool part) is neither echoed nor seen nor fresh", async () => {
    const { own, drive, fx } = setup()
    await expect(
      drive(part({ kind: "tool", id: "pt_r1", tool: "Read", status: "running", input: { path: "x" } })),
    ).resolves.toBe("pass")
    expect(fx.vlogs).toEqual([])
    expect(own.seen.has("pt_r1")).toBe(false)
    expect(own.fresh).toBeUndefined()
  })

  test("a step-finish part is both billed and echoed (the echo dedup is separate from the billing dedup)", async () => {
    const { own, drive, fx } = setup()
    await expect(drive(part(stepFinish("pt_s1", { input: 100, output: 10 })))).resolves.toBe("pass")
    expect(fx.vlogs).toEqual(["  step finish (stop): input 100 / output 10 tokens"])
    expect(own.usage.steps).toBe(1)
    expect(own.fresh).toBe("pt_s1")
  })
})

describe("the transcript concern (message: lastMessage, onModel once, the filter)", () => {
  test("the first message carrying a model is reported once — a user message's model counts (the model the server resolved)", async () => {
    const { own, drive, fx } = setup()
    await drive({ type: "message", session: SESSION, message: { id: "m_user", role: "user", completed: false, model: MODEL, failed: false } })
    expect(fx.models).toEqual([MODEL])
    expect(own.modelReported).toBe(true)
    await drive(ev.message(SESSION, "m_asst"))
    expect(fx.models).toEqual([MODEL])
    expect(own.lastMessage).toBe("m_asst")
  })

  test("a message naming no model reports nothing; a later message with a model still reports", async () => {
    const { own, drive, fx } = setup()
    await drive({ type: "message", session: SESSION, message: { id: "m_nomodel", role: "assistant", completed: true, failed: false } })
    expect(fx.models).toEqual([])
    expect(own.modelReported).toBe(false)
    await drive(ev.message(SESSION, "m_model", undefined, { id: "m_model" }))
    expect(fx.models).toEqual([MODEL])
  })

  test("the filter: only a NEW completed assistant message passes the row on (the usage cell follows)", async () => {
    const { own, drive } = setup()
    // A user message stops the input.
    await expect(drive({ type: "message", session: SESSION, message: { id: "m_u", role: "user", completed: true, model: MODEL, failed: false } })).resolves.toBe("consumed")
    // An incomplete assistant message stops the input.
    await expect(drive({ type: "message", session: SESSION, message: { id: "m_i", role: "assistant", completed: false, model: MODEL, failed: false } })).resolves.toBe("consumed")
    // A new completed assistant message passes.
    await expect(drive(ev.message(SESSION, "m_a1"))).resolves.toBe("pass")
    expect(own.seen.has("m_a1")).toBe(true)
    // Its re-sent update stops the input (already seen).
    await expect(drive(ev.message(SESSION, "m_a1"))).resolves.toBe("consumed")
    // A further new completed assistant message passes again.
    await expect(drive(ev.message(SESSION, "m_a2"))).resolves.toBe("pass")
  })
})

describe("the transcript concern (retry: the deduplicated vlog)", () => {
  test("an id-carrying retry vlogs once; a re-send and an id-less retry stay silent", async () => {
    const { drive, fx } = setup()
    const retry: AgentEvent = { type: "retry", session: SESSION, id: "pt_r1", attempt: 2, error: { name: "APIError", message: "rate limited" } }
    await expect(drive(retry)).resolves.toBe("consumed")
    expect(fx.vlogs).toEqual(["  ↻ request retry (attempt 2)"])
    await expect(drive(retry)).resolves.toBe("consumed")
    expect(fx.vlogs).toEqual(["  ↻ request retry (attempt 2)"])
    await expect(drive({ type: "retry", session: SESSION, error: { name: "APIError", message: "rate limited" } })).resolves.toBe("consumed")
    expect(fx.vlogs).toEqual(["  ↻ request retry (attempt 2)"])
  })
})
