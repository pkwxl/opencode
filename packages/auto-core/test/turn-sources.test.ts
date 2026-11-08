// The sources suite (plans/0229 D4, finding 0165-197/S14-07): the two
// synthetic-input sources' own wiring invariants, which until this suite
// rode only the trace/replay scenarios — the review measured two of them
// uncovered: answerWith-before-attach (the sources' programming-error
// guard) and a late probe verdict after detach (the `!active` drop — the
// spine's emit drop of a detached turn's stale verdict, here at the
// producer). The live shape between them is the control that makes the
// drop meaningful: a fired timer emits exactly one verdict and re-arms
// exactly one timer (single flight), and the cleanup cancels the chain.
// The probe's transport (probeSession over the client) is driven over the
// fake agent's immediately-resolving get — determinism needs no gate: the
// cleanup in the drop case runs synchronously between the timer callback
// and the first microtask the probe's await chain can run on.
import { describe, expect, test } from "bun:test"
import type { TurnInput } from "../src/engine/contract"
import { makeTurnSources } from "../src/engine/sources"
import { createServices } from "../src/services"
import { scenarioClock, TURN_EPOCH, flush } from "./fixtures/turn-trace"
import { turnContext } from "./fixtures/turn"

// One sources set over the scenario clock (a working timer queue), the fake
// agent's default context (no heartbeat capability → the probe verdict's
// streamAlive leg stays undefined, the fresh-connection-only shape). The
// attach's cleanup is typed optionally (TurnSources allows a source without
// one); this source always answers it, so a settled default suffices.
const setup = () => {
  const clock = scenarioClock()
  const ctx = turnContext({ services: createServices({ clock: clock.clock }) })
  const sources = makeTurnSources(ctx)
  const emitted: TurnInput[] = []
  const attach = (): (() => void) => sources.attach((input) => emitted.push(input)) ?? ((): void => {})
  return { clock, ctx, sources, emitted, attach }
}

describe("the turn sources (plans/0229 D4)", () => {
  test("a fired timer emits exactly one probe verdict and re-arms exactly one (single flight); the cleanup cancels the chain", async () => {
    const { clock, emitted, attach } = setup()
    const cleanup = attach()
    expect(clock.queued()).toBe(1) // armed at attach
    clock.fire()
    await flush() // the probe's await chain resolves; the verdict and the re-arm land
    // The fake agent's get answers ok; `at` is the clock at the verdict, moved
    // to the timer's deadline by fire(); no pulse capability → no streamAlive.
    expect(emitted).toEqual([{ kind: "probe", ok: true, at: TURN_EPOCH + 10 * 60_000 }])
    expect(clock.queued()).toBe(1) // re-armed — the timer re-arms only after a verdict was emitted
    cleanup()
    expect(clock.queued()).toBe(0) // cancelled for good
  })

  test("answerWith before attach is the sources' programming error", () => {
    const { sources } = setup()
    expect(() => sources.answerWith(Promise.resolve(undefined))).toThrow(
      "turn engine sources: answerWith before the sources were attached",
    )
  })

  test("a probe verdict resolving after the cleanup ran is dropped — no emission, no re-arm", async () => {
    const { clock, emitted, attach } = setup()
    const cleanup = attach()
    clock.fire() // the probe is in flight; its get resolves on a microtask
    cleanup() // the turn detached while the probe was out — synchronously, before any microtask
    await flush() // the verdict lands after the detach
    expect(emitted).toEqual([]) // dropped at the `!active` return — a stale verdict never reaches a concern
    expect(clock.queued()).toBe(0) // and the chain is dead: no re-arm of a detached turn
  })

  test("an answer handed to an attached source is emitted as the synthetic answer input", async () => {
    const { sources, emitted, attach } = setup()
    attach()
    sources.answerWith(Promise.resolve(undefined))
    await flush()
    expect(emitted).toEqual([{ kind: "answer", answer: undefined }]) // a no-answer resolution included
  })
})
