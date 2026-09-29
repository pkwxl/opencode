// The guard concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the twin-idle dedup — one turn end settles only once; any other
// session event of this session (a new turn starting) re-arms acceptance.
// The concern makes no fx call at all, which the no-calls assertion pins.
import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { Advice } from "../src/engine/contract"
import { guardConcern } from "../src/engine/concerns/guard"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev } from "./fixtures/agent"

const SESSION = "ses_1"

describe("the guard concern (twin-idle dedup)", () => {
  const drive = (own: { idleHandled: boolean }, event: AgentEvent): Promise<Advice> =>
    guardConcern.handle({ kind: "event", event }, own, viewOver({}), fakeTurnFx(), turnContext())

  test("the first idle arms the guard and passes the row on; a second idle is consumed (the stop)", async () => {
    const own = guardConcern.initial(turnContext())
    await expect(drive(own, ev.idle(SESSION))).resolves.toBe("pass")
    expect(own.idleHandled).toBe(true)
    await expect(drive(own, ev.idle(SESSION))).resolves.toBe("consumed")
    expect(own.idleHandled).toBe(true)
  })

  test("a part, message, error or retry re-arms acceptance after an idle was handled", async () => {
    for (const event of [
      ev.text(SESSION, "pt_1", "working"),
      ev.message(SESSION, "msg_1"),
      ev.error(SESSION, { name: "APIError", message: "boom" }),
      { type: "retry", session: SESSION, error: { name: "APIError", message: "rate limited" } } as AgentEvent,
    ]) {
      const own = guardConcern.initial(turnContext())
      await drive(own, ev.idle(SESSION))
      expect(own.idleHandled).toBe(true)
      await expect(drive(own, event)).resolves.toBe("pass")
      expect(own.idleHandled).toBe(false)
      // Re-armed: the next idle passes the row on again.
      await expect(drive(own, ev.idle(SESSION))).resolves.toBe("pass")
    }
  })

  test("a step-start part re-arms like any other session event (any part, not only terminal ones)", async () => {
    const own = guardConcern.initial(turnContext())
    await drive(own, ev.idle(SESSION))
    await expect(drive(own, { type: "part", session: SESSION, part: { kind: "step-start", id: "pt_s" } })).resolves.toBe("pass")
    expect(own.idleHandled).toBe(false)
  })

  test("the concern makes no fx call (the guard is pure state)", async () => {
    const fx = fakeTurnFx()
    const own = guardConcern.initial(turnContext())
    await guardConcern.handle({ kind: "event", event: ev.idle(SESSION) }, own, viewOver({}), fx, turnContext())
    await guardConcern.handle({ kind: "event", event: ev.idle(SESSION) }, own, viewOver({}), fx, turnContext())
    await guardConcern.handle({ kind: "event", event: ev.text(SESSION, "pt_1", "hi") }, own, viewOver({}), fx, turnContext())
    expect(fx.calls).toEqual([])
  })
})
