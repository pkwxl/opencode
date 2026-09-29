// The recovery concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the failure-message classifier's turn — the retry cell's pattern
// verdict with the consult (the ask policy, the cached answer's synchronous
// raise, the per-minute exemption), the concurrent answer row (record, and
// the held settle that raises the class of a still-retrying turn), the
// finalize steps (the raised settle's abort and line, the final
// classification of a turn that ended without one, over the interrupted
// close-out's extended record), and `resetFields` (the escalation's reset
// fields: a stated reset, the answer's, the pending ask). The ask-policy and
// merge tables at the bottom are re-homed from the classifier module's suite
// (test/classify.test.ts): their functions' only consumer is this concern.
import { describe, expect, test } from "bun:test"
import type { AgentClient, AgentError, AgentEvent } from "../src/agent/types"
import type { ErrorClass, ErrorInfo } from "../src/chain"
import { classifierCacheKey, classifierInput, mergeClass, shouldAsk, type Classifier } from "../src/classify"
import type { ModelRegistry } from "../src/models"
import type { ClassifierAnswer, Router } from "../src/router"
import { createServices, type RunServices } from "../src/services"
import type { Advice, Settle, TurnInput, TurnState } from "../src/engine/contract"
import { makeRecoveryConcern, resetFields, type RecoveryDeps } from "../src/engine/concerns/recovery"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { clockAt } from "./fixtures/clock"
import { ev, fakeAgent } from "./fixtures/agent"

const SESSION = "ses_1"
const NOW = Date.parse("2026-09-26T07:00:00Z")

// A registry with one classifier entry, UTC, so the ⚖ line's reset rendering
// is a fixed value.
const registry = (): ModelRegistry => ({
  layers: [{ name: "operator", path: "/unused/models.json" }],
  tz: "UTC",
  agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
  models: new Map([["free", { name: "free", layer: "operator", agent: "opencode", model: "free/model" }]]),
  tiers: { deep: { tier: "deep", names: ["free"], layer: "operator" } },
  routes: new Map(),
  unused: [],
  classifier: { names: ["free"], layer: "operator" },
})

const classifier = (router: Router, client: AgentClient): Classifier => ({
  client,
  registry: registry(),
  agentFilter: undefined,
  router,
  now: () => NOW,
  label: "T-001",
  timeoutMs: 30_000,
})

// A classifier over its own fresh router and client: the handle a raising
// case needs (the ⚖ line refuses to print without one), with no cache and
// nothing seeded.
const inertClassifier = (): Classifier => classifier(createServices({ clock: clockAt(NOW) }).router, fakeAgent().client)

// One concern instance per case over recording deps, driven one input at a
// time. `classify` stubs the pattern classifier (the ctx's binding), so a
// case states the verdict the patterns return; the classifier handle is the
// real shape over the case's own router, its cache seeded where a case needs
// a known answer.
const setup = (over: { classify?: (info: ErrorInfo) => ErrorClass; classifier?: Classifier } = {}) => {
  const services: RunServices = createServices({ clock: clockAt(NOW) })
  const asked: Promise<unknown>[] = []
  const deps: RecoveryDeps = { answerWith: (call) => asked.push(call), extended: {} }
  const concern = makeRecoveryConcern(deps)
  const ctx = turnContext({
    ...(over.classify !== undefined ? { classify: over.classify } : {}),
    ...(over.classifier !== undefined ? { classifier: over.classifier } : {}),
    services,
  })
  const own = concern.initial(ctx)
  const fx = fakeTurnFx()
  const drive = (input: TurnInput, view: Partial<TurnState> = {}, useFx = fx): Promise<Advice> => concern.handle(input, own, viewOver(view), useFx, ctx)
  // The finalize is the concern's other half, run over its own fx double so
  // a case asserts its effects alone; the double it used comes back.
  const finalize = async (settle: Settle, view: Partial<TurnState> = {}): Promise<ReturnType<typeof fakeTurnFx>> => {
    const useFx = fakeTurnFx()
    await concern.finalize!(settle, own, viewOver(view), useFx, ctx)
    return useFx
  }
  return { concern, ctx, own, deps, asked, fx, drive, finalize }
}

// The settle of a settling advice (the narrowing the Advice union needs).
const settleOf = (advice: Advice): Settle => (advice as { settle: Settle }).settle

const retryInput = (e: AgentError, over: { attempt?: number; next?: number } = {}): TurnInput => ({
  kind: "event",
  event: {
    type: "retry",
    session: SESSION,
    error: e,
    ...(over.attempt !== undefined ? { attempt: over.attempt } : {}),
    ...(over.next !== undefined ? { next: over.next } : {}),
  } as AgentEvent,
})
const answerInput = (answer: ClassifierAnswer | undefined): TurnInput => ({ kind: "answer", answer })
const failureView = (over: { error?: string; retrying?: boolean; info?: ErrorInfo } = {}): Partial<TurnState> => ({
  failure: { error: over.error ?? "", retrying: over.retrying ?? false, ...(over.info !== undefined ? { info: over.info } : {}) },
})

// Seeding the run's answer cache for an error, the way a resolved call would.
const seedAnswer = (router: Router, info: ErrorInfo, answer: ClassifierAnswer): void =>
  router.noteClassifierAnswer(classifierCacheKey(classifierInput(info)), answer)

describe("the recovery concern (retry: the pattern verdict with the classifier consult)", () => {
  test("a quota the agent cannot cure by retrying aborts the still-running old turn and settles error", async () => {
    const { own, fx, drive } = setup({ classify: () => "quota" })
    const advice = await drive(retryInput({ message: "Kontingent erschöpft" }), failureView({ retrying: true, info: { message: "Kontingent erschöpft" } }))
    expect(advice).toEqual({ settle: { kind: "error", cls: "quota", classified: false } })
    expect(fx.calls).toEqual(["abort"])
    // Without a classifier the slice stays empty: nothing was asked, nothing
    // is known.
    expect(own).toEqual({})
  })

  test("auth and rate settle the same way — the classes that cure only by moving", async () => {
    for (const cls of ["auth", "rate"] as const) {
      const { fx, drive } = setup({ classify: () => cls })
      const advice = await drive(retryInput({ message: "key rejected" }), failureView({ retrying: true, info: { message: "key rejected" } }))
      expect(advice).toEqual({ settle: { kind: "error", cls, classified: false } })
      expect(fx.calls).toEqual(["abort"])
    }
  })

  test("a per-minute cap the agent is still backing off from is observed, not settled; once it gave up, it settles", async () => {
    const info: ErrorInfo = { message: "slow down", statusCode: 429, scope: "request", attempt: 1 }
    const backing = setup({ classify: () => "quota" })
    await expect(backing.drive(retryInput({ message: info.message! }, { attempt: 1 }), failureView({ retrying: true, info }))).resolves.toBe("pass")
    expect(backing.fx.calls).toEqual([])
    // The wait past the policy's backoff cap is the giving-up signal
    // (chain.ts agentGaveUp).
    const gaveUp = setup({ classify: () => "quota" })
    await expect(gaveUp.drive(retryInput({ message: info.message! }, { attempt: 3, next: 90_000 }), failureView({ retrying: true, info: { ...info, next: 90_000 } }))).resolves.toEqual({
      settle: { kind: "error", cls: "quota", classified: false },
    })
    expect(gaveUp.fx.calls).toEqual(["abort"])
  })

  test("an undecided retry with no classifier asks nothing and observes on", async () => {
    const { asked, drive } = setup({ classify: () => "unknown" })
    await expect(drive(retryInput({ message: "odd failure" }), failureView({ retrying: true, info: { message: "odd failure" } }))).resolves.toBe("pass")
    expect(asked).toEqual([])
  })

  test("an undecided retry asks the classifier once per turn, through the answer feed; a later undecided signal waits for it", async () => {
    const reply = (text: string) => (ctx: { text: string; session: string; n: number }): AgentEvent[] | undefined =>
      ctx.text.includes("The error text:")
        ? [ev.text(ctx.session, `txt_${ctx.n}`, text), ev.step(ctx.session, `stp_${ctx.n}`, "stop", 300), ev.idle(ctx.session)]
        : undefined
    const agent = fakeAgent({ turn: reply('{"class": "quota", "resetAt": null}') })
    const services = createServices({ clock: clockAt(NOW) })
    const over = { classify: () => "unknown" as const, classifier: classifier(services.router, agent.client) }
    const { own, asked, drive } = setup(over)
    const view = failureView({ retrying: true, info: { message: "odd failure" } })
    await expect(drive(retryInput({ message: "odd failure" }), view)).resolves.toBe("pass")
    expect(asked).toHaveLength(1)
    expect(own.asked).toBeDefined()
    // The second undecided retry of the same turn joins the first call
    // instead of starting another.
    await expect(drive(retryInput({ message: "odd failure" }, { attempt: 2 }), view)).resolves.toBe("pass")
    expect(asked).toHaveLength(1)
    expect(await own.asked).toEqual({ class: "quota" })
  })

  test("a cached answer raises the class of an undecided retry synchronously: abort, the ⚖ line, the classified settle", async () => {
    const services = createServices({ clock: clockAt(NOW) })
    const agent = fakeAgent()
    const info: ErrorInfo = { message: "Kontingent erschöpft (Anfrage 17)" }
    seedAnswer(services.router, info, { class: "quota", resetAt: NOW + 2 * 3_600_000 })
    const { own, fx, drive } = setup({ classify: () => "unknown", classifier: classifier(services.router, agent.client) })
    const advice = await drive(retryInput({ message: info.message! }, { attempt: 1 }), failureView({ retrying: true, info: { ...info, attempt: 1 } }))
    expect(advice).toEqual({ settle: { kind: "error", cls: "quota", classified: true } })
    expect(fx.calls).toEqual(["abort", "log"])
    expect(fx.lines).toEqual([`⚖ the classifier reads the failure as quota, resets 2026-09-26T09:00:00+00:00; settling the turn as quota`])
    expect(own.answer).toEqual({ class: "quota", resetAt: NOW + 2 * 3_600_000 })
  })

  test("an overflow verdict observes on: the row continues and nothing is asked", async () => {
    const { asked, fx, drive } = setup({ classify: () => "overflow" })
    await expect(drive(retryInput({ message: "context length exceeded" }), failureView({ retrying: true, info: { message: "context length exceeded" } }))).resolves.toBe("pass")
    expect(asked).toEqual([])
    expect(fx.calls).toEqual([])
  })
})

describe("the recovery concern (answer: record, then raise while the turn still retries)", () => {
  const info: ErrorInfo = { message: "odd failure", attempt: 1 }
  const view = failureView({ error: "odd failure", retrying: true, info })

  test("a no-answer resolution is dropped, and inputs outside the cells pass through", async () => {
    const { own, drive } = setup()
    await expect(drive(answerInput(undefined), view)).resolves.toBe("consumed")
    await expect(drive({ kind: "event", event: { type: "idle", session: SESSION } })).resolves.toBe("pass")
    await expect(drive({ kind: "probe", ok: true, at: 0 })).resolves.toBe("pass")
    expect(own).toEqual({})
  })

  test("the answer is recorded even when the turn is not retrying: a recovered turn is never aborted by a late answer", async () => {
    const { own, drive } = setup({ classify: () => "unknown" })
    await expect(drive(answerInput({ class: "quota" }), failureView({ retrying: false, info }))).resolves.toBe("consumed")
    expect(own).toEqual({ answer: { class: "quota" } })
  })

  test("while the turn retries an undecided failure, a quota answer raises the held settle error", async () => {
    const { own, drive } = setup({ classify: () => "unknown", classifier: inertClassifier() })
    const advice = await drive(answerInput({ class: "quota", resetAt: NOW + 2 * 3_600_000 }), view)
    expect(advice).toEqual({ settle: { kind: "error", cls: "quota", classified: true } })
    expect(own.raised).toBe("quota")
    expect(own.answer).toEqual({ class: "quota", resetAt: NOW + 2 * 3_600_000 })
  })

  test("a rate answer below the patterns' threshold does not raise (the agent is still backing off on its own)", async () => {
    const { own, drive } = setup({ classify: () => "unknown" })
    await expect(drive(answerInput({ class: "rate" }), view)).resolves.toBe("consumed")
    expect(own.raised).toBeUndefined()
  })

  test("a failure the patterns already decided never raises", async () => {
    const { own, drive } = setup({ classify: () => "quota" })
    await expect(drive(answerInput({ class: "quota" }), view)).resolves.toBe("consumed")
    expect(own.raised).toBeUndefined()
  })

  test("a second answer after the raise changes nothing", async () => {
    const { own, drive } = setup({ classify: () => "unknown", classifier: inertClassifier() })
    await drive(answerInput({ class: "quota" }), view)
    await expect(drive(answerInput({ class: "auth" }), view)).resolves.toBe("consumed")
    expect(own.raised).toBe("quota")
  })
})

describe("the recovery concern (finalize: the raised settle, then the final classification)", () => {
  const info: ErrorInfo = { message: "odd failure", attempt: 1 }
  const view = failureView({ error: "odd failure", retrying: true, info })

  test("the raised settle's abort and line land at close-out; an error settle carries no final classification", async () => {
    const { own, drive, finalize } = setup({ classify: () => "unknown", classifier: inertClassifier() })
    const advice = await drive(answerInput({ class: "quota", resetAt: NOW + 2 * 3_600_000 }), view)
    expect(advice).toEqual({ settle: { kind: "error", cls: "quota", classified: true } })
    // The finalize receives the very object the answer cell returned.
    const out = await finalize(settleOf(advice), view)
    expect(out.calls).toEqual(["abort", "log"])
    expect(out.lines).toEqual([`⚖ the classifier reads the failure as quota, resets 2026-09-26T09:00:00+00:00; settling the turn as quota`])
    expect(own.final).toBeUndefined()
  })

  test("a raise that landed beside an early settle the turn already returned is never consulted: no abort, no line, no classification", async () => {
    // The identity check, not the raised flag: the settle the turn ended by
    // is the early one (the old body's in-loop return won the race), so the
    // raise that arrived beside it must not abort a second time.
    const raising = setup({ classify: () => "unknown" })
    const raised = await raising.drive(answerInput({ class: "quota" }), view)
    expect(raised).toEqual({ settle: { kind: "error", cls: "quota", classified: true } })
    const foreign = await raising.finalize({ kind: "error", cls: "auth", classified: false }, view)
    expect(foreign.calls).toEqual([])
    // A blocked settle is not a failure report at all.
    const blocked = await raising.finalize({ kind: "blocked", question: "q" }, view)
    expect(blocked.calls).toEqual([])
    expect(raising.own.final).toBeUndefined()
  })

  test("a natural close-out with an error text records the final classification on the slice", async () => {
    const { own, finalize } = setup({ classify: () => "transient" })
    const out = await finalize({ kind: "natural" }, view)
    expect(own.final).toEqual({ cls: "transient", classified: false })
    expect(out.calls).toEqual([])
  })

  test("a natural close-out where a cached answer raises the class is classified, with the ⚖ line", async () => {
    const services = createServices({ clock: clockAt(NOW) })
    const agent = fakeAgent()
    seedAnswer(services.router, info, { class: "quota" })
    const { own, asked, finalize } = setup({ classify: () => "unknown", classifier: classifier(services.router, agent.client) })
    const out = await finalize({ kind: "natural" }, view)
    expect(own.final).toEqual({ cls: "quota", classified: true })
    expect(own.answer).toEqual({ class: "quota" })
    expect(out.lines).toEqual([`⚖ the classifier reads the failure as quota; settling the turn as quota`])
    expect(asked).toEqual([])
  })

  test("a clean natural close-out (no error text) classifies nothing and asks nothing", async () => {
    const { own, asked, finalize } = setup({ classify: () => "unknown" })
    await finalize({ kind: "natural" }, failureView({ error: "", retrying: false }))
    expect(own.final).toBeUndefined()
    expect(asked).toEqual([])
  })

  test("an interrupted close-out classifies the extended record: the transport message opens the gate and feeds the class", async () => {
    // The half-open form: the liveness step folded the transport message
    // into the info, and the classification reads the extended record —
    // the patterns file the half-open wording as transient.
    const halfOpen = setup({ classify: (i) => (i.message?.includes("half-open") ? "transient" : "unknown") })
    halfOpen.deps.extended.error = "connectivity probe failed 2 consecutive times; connection judged half-open (server unresponsive or network down, half-open network timeout)"
    halfOpen.deps.extended.info = { message: "connectivity probe failed 2 consecutive times; connection judged half-open (server unresponsive or network down, half-open network timeout)" }
    await halfOpen.finalize({ kind: "interrupted" }, failureView({ error: "", retrying: false }))
    expect(halfOpen.own.final).toEqual({ cls: "transient", classified: false })
    // The bare stream interruption: no failure info at all, but the extended
    // text opens the gate — the empty record classifies unknown.
    const bare = setup({ classify: () => "unknown" })
    bare.deps.extended.error = "event stream interrupted (no session-end event received; suspected server failure or network down)"
    await bare.finalize({ kind: "interrupted" }, failureView({ error: "", retrying: false }))
    expect(bare.own.final).toEqual({ cls: "unknown", classified: false })
  })
})

describe("the recovery concern (resetFields: the escalation's reset fields)", () => {
  test("a reset the provider or the agent stated outranks the classifier's and carries its scope", () => {
    const services = createServices({ clock: clockAt(NOW) })
    const agent = fakeAgent()
    const ctx = turnContext({ classifier: classifier(services.router, agent.client), services })
    expect(resetFields({ answer: { class: "quota", resetAt: NOW + 5 * 3_600_000 } }, { message: "spent", resetAt: NOW + 3_600_000, scope: "5h" }, ctx)).toEqual({
      resetAt: NOW + 3_600_000,
      scope: "5h",
      resetSource: "stated",
    })
  })

  test("the known answer's accepted reset rides with its source; one beyond the horizon does not", () => {
    const services = createServices({ clock: clockAt(NOW) })
    const agent = fakeAgent()
    const ctx = turnContext({ classifier: classifier(services.router, agent.client), services })
    expect(resetFields({ answer: { class: "quota", resetAt: NOW + 2 * 3_600_000 } }, { message: "spent" }, ctx)).toEqual({
      resetAt: NOW + 2 * 3_600_000,
      resetSource: "classifier",
    })
    expect(resetFields({ answer: { class: "quota", resetAt: NOW + 8 * 86_400_000 } }, { message: "spent" }, ctx)).toEqual({})
  })

  test("an answer still on its way rides out as pendingReset; without a classifier, nothing", async () => {
    const services = createServices({ clock: clockAt(NOW) })
    const agent = fakeAgent()
    const ctx = turnContext({ classifier: classifier(services.router, agent.client), services })
    const fields = resetFields({ asked: Promise.resolve({ class: "quota", resetAt: NOW + 2 * 3_600_000 }) }, { message: "spent" }, ctx)
    expect(fields.resetAt).toBeUndefined()
    await expect(fields.pendingReset).resolves.toBe(NOW + 2 * 3_600_000)
    const bare = turnContext({ services })
    expect(resetFields({ asked: Promise.resolve({ class: "quota", resetAt: NOW + 2 * 3_600_000 }) }, { message: "spent" }, bare)).toEqual({})
  })
})

// The ask policy and the raise-only merge, re-homed from the classifier
// module's suite: shouldAsk and mergeClass are that module's exports, but
// their only consumer is this concern (the consult and the answer row), so
// their decision tables live here, beside the cells that apply them.
describe("when it is asked (re-homed: the consult's ask policy)", () => {
  const info: ErrorInfo = { message: "something odd happened" }
  test("undecided retries and session errors only; never overflow, quota, auth or a decided rate", () => {
    expect(shouldAsk("retry", info, "unknown")).toBe(true)
    expect(shouldAsk("error", info, "unknown")).toBe(true)
    // A rate signal below its threshold (a single 429) classes as transient
    // or unknown: the retry surface asks about it, the error surface not.
    const early429: ErrorInfo = { message: "server busy, timeout", statusCode: 429, attempt: 1 }
    expect(shouldAsk("retry", early429, "transient")).toBe(true)
    expect(shouldAsk("error", early429, "transient")).toBe(false)
    // A transient without a rate signal is decided.
    expect(shouldAsk("retry", { message: "socket hang up" }, "transient")).toBe(false)
    for (const cls of ["overflow", "quota", "auth", "rate"] as const) {
      expect(shouldAsk("retry", early429, cls)).toBe(false)
      expect(shouldAsk("error", info, cls)).toBe(false)
    }
  })

  test("never about a failure whose reset the provider or the agent already stated (plans/0057 §5.3)", () => {
    const stated = { resetAt: Date.parse("2026-09-25T12:30:00Z"), scope: "5h" as const }
    expect(shouldAsk("retry", { ...info, ...stated }, "unknown")).toBe(false)
    expect(shouldAsk("error", { ...info, ...stated }, "unknown")).toBe(false)
    expect(shouldAsk("retry", { message: "server busy, timeout", statusCode: 429, attempt: 1, ...stated }, "transient")).toBe(false)
    // A reason or a wait without a reset leaves the question open.
    expect(shouldAsk("retry", { ...info, limitReason: "account_rate_limit", retryAfterMs: 2000 }, "unknown")).toBe(true)
  })
})

describe("the raise-only merge (re-homed: the consult's and the answer row's merge)", () => {
  const early: ErrorInfo = { message: "slow down", statusCode: 429, attempt: 1 }
  const late: ErrorInfo = { message: "slow down", statusCode: 429, attempt: 3 }
  test("an answer replaces unknown; a rate answer counts only once the rate threshold holds", () => {
    expect(mergeClass("unknown", "quota", early)).toBe("quota")
    expect(mergeClass("unknown", "auth", early)).toBe("auth")
    expect(mergeClass("unknown", "transient", early)).toBe("transient")
    expect(mergeClass("unknown", "unknown", early)).toBe("unknown")
    expect(mergeClass("unknown", "rate", early)).toBe("unknown")
    expect(mergeClass("unknown", "rate", late)).toBe("rate")
    expect(mergeClass("unknown", "rate", { message: "x", next: 90_000 })).toBe("rate")
  })

  test("a below-threshold rate signal may be raised to quota only; nothing the patterns found is ever lowered", () => {
    expect(mergeClass("transient", "quota", early)).toBe("quota")
    for (const answer of ["auth", "rate", "transient", "unknown"] as const) expect(mergeClass("transient", answer, early)).toBe("transient")
    for (const pattern of ["overflow", "quota", "auth", "rate"] as const) {
      for (const answer of ["quota", "rate", "auth", "transient", "unknown"] as const) expect(mergeClass(pattern, answer, late)).toBe(pattern)
    }
  })
})
