// The failure-message classifier (plans/0055 §7.1, §14): when it is asked,
// what leaves the driver (redaction and truncation), the run's cache and its
// masked key, the 20-call limit, the reply parser, the raise-only merge, the
// reset-time horizon, the timeout, the classifier entry's selection and its
// own failures. The session-driving half (a retrying turn settled early, the
// escalation's marks) is in test/agent-fake.test.ts.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { ErrorInfo } from "../src/chain"
import {
  acceptedReset,
  askClassifier,
  cachedAnswer,
  CLASSIFY_CALL_LIMIT,
  CLASSIFY_INPUT_CHARS,
  CLASSIFY_TITLE,
  classifierCacheKey,
  classifierCalls,
  classifierEntry,
  classifierFor,
  classifierInput,
  mergeClass,
  parseClassifierReply,
  RESET_HORIZON_MS,
  redact,
  resetClassifier,
  setClassifyUsageSink,
  shouldAsk,
  type Classifier,
} from "../src/classify"
import { isModelDown, markModelDown, resetFailback } from "../src/failback"
import { isoInZone, parseWindow } from "../src/model-window"
import type { ModelEntry, TierList } from "../src/models"
import type { RoutingFacts } from "../src/routing"
import { ev, fakeAgent, type FakeAgentOptions, type TurnContext } from "./fixtures/agent"

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
const tierList = (tier: "deep" | "simple", names: string[]): TierList => ({ tier, names, layer: "operator" })

// A fleet with two classifier entries on the opencode profile and one model
// on a claude profile; the clock is fixed unless a case moves it.
const NOW = Date.parse("2026-09-26T07:00:00Z")
const facts = (over: { classifier?: string[]; models?: ModelEntry[]; agentFilter?: string; clock?: () => number } = {}): RoutingFacts => {
  const models = over.models ?? [entry("free", { model: "free/model-a", provider: "free" }), entry("free2", { model: "free/model-b", provider: "free" }), entry("a", { model: "prov/a", provider: "prov" })]
  return {
    registry: {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "Asia/Shanghai",
      agents: new Map([
        ["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }],
        ["claude", { name: "claude", layer: "operator", adapter: "claude" }],
      ]),
      models: new Map(models.map((item) => [item.name, item])),
      tiers: { deep: tierList("deep", ["a"]), simple: tierList("simple", ["a"]) },
      routes: new Map(),
      unused: [],
      classifier: { names: over.classifier ?? ["free", "free2"], layer: "operator" },
    },
    agentFilter: over.agentFilter ?? "opencode",
    filterSource: undefined,
    defaultAgent: "opencode",
    runAgent: "opencode",
    clock: over.clock ?? (() => NOW),
  }
}

// A classifier prompt is recognized by its template's closing section.
const isClassify = (ctx: TurnContext) => ctx.text.includes("The error text:")
const reply = (text: string) => (ctx: TurnContext): AgentEvent[] | undefined =>
  isClassify(ctx) ? [ev.text(ctx.session, `txt_${ctx.n}`, text), ev.step(ctx.session, `stp_${ctx.n}`, "stop", 300), ev.idle(ctx.session)] : undefined

const setup = (options: FakeAgentOptions = {}, over: Parameters<typeof facts>[0] = {}): { agent: ReturnType<typeof fakeAgent>; classifier: Classifier } => {
  const agent = fakeAgent(options)
  return { agent, classifier: classifierFor(agent.client, facts(over), "T-001")! }
}

beforeEach(() => {
  resetClassifier()
  resetFailback()
})
afterEach(() => {
  resetClassifier()
  resetFailback()
})

describe("when it is asked", () => {
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

  test("no registry, or no classifier list, means no classifier at all (C2)", () => {
    const agent = fakeAgent()
    expect(classifierFor(agent.client, undefined)).toBeUndefined()
    expect(classifierFor(agent.client, facts({ classifier: [] }))).toBeUndefined()
    const bare = facts()
    delete (bare.registry as { classifier?: unknown }).classifier
    expect(classifierFor(agent.client, bare)).toBeUndefined()
  })
})

describe("redaction (C4)", () => {
  test("key-like tokens, e-mail addresses and URL query strings never leave the driver", () => {
    const text = redact(
      [
        "invalid key sk-proj-AbC123_def-456 for org",
        "header Authorization: Bearer eyJhbGciOi.short.tok",
        "key AKIAIOSFODNN7EXAMPLEwJalrXUtnFEMI/K7MDENG/bPxRfiCY",
        "contact billing-team@example.co.uk or ops@corp.example",
        "see https://api.example.com/v1/usage?key=abc&org=42#frag and /v1/models?token=xyz",
        "plain words stay: usage limit reached for this plan",
      ].join("\n"),
    )
    expect(text).not.toContain("AbC123_def-456")
    expect(text).toContain("sk-[redacted]")
    expect(text).not.toContain("eyJhbGciOi.short.tok")
    expect(text).toContain("Bearer [redacted]")
    expect(text).not.toContain("wJalrXUtnFEMI")
    expect(text).not.toContain("K7MDENG")
    expect(text).not.toContain("billing-team@example.co.uk")
    expect(text).not.toContain("ops@corp.example")
    expect(text).toContain("[email]")
    expect(text).not.toContain("key=abc")
    expect(text).not.toContain("token=xyz")
    expect(text).toContain("https://api.example.com/v1/usage?[redacted]#frag")
    expect(text).toContain("/v1/models?[redacted]")
    expect(text).toContain("plain words stay: usage limit reached for this plan")
  })

  test("the input is message plus response body, redacted first, then truncated to 2,000 characters", () => {
    const secret = "Z".repeat(10) + "9".repeat(30)
    // 27 characters of message and JSON head, 1,960 of padding: the key
    // starts at 1,987 and straddles the cut at 2,000.
    const padding = "x ".repeat(980)
    const input = classifierInput({ message: "upstream failed", responseBody: `{"error": "${padding}${secret}${padding}"}` })
    expect(input.startsWith("upstream failed\n{")).toBe(true)
    expect(input.length).toBe(CLASSIFY_INPUT_CHARS)
    // Redacted before the cut, never half-leaked: truncating first would
    // leave 13 key characters, too short for the 24-character rule.
    expect(input).toContain("[redacted]")
    expect(input).not.toContain("ZZZZZZZZZZ")
    expect(classifierInput({ message: "  ", responseBody: undefined })).toBe("")
  })
})

describe("the cache", () => {
  test("the key masks digits, ids and times: the same wording with another request id, count or clock time is one message", () => {
    const one = classifierCacheKey(classifierInput({ message: "Request req_8f3a2b1c failed at 2026-09-26T10:00:00Z; plan resets at 15:00, retry 3 of 10, trace 1b4e28ba-2fa1-11d2-883f-0016d3cca427" }))
    const two = classifierCacheKey(classifierInput({ message: "Request req_zz91ab77 failed at 2026-09-27T11:05:00+08:00; plan resets at 9:30 pm, retry 4 of 12, trace 6fa459ea-ee8a-3ca4-894e-db77e160355e" }))
    expect(one).toBe(two)
    expect(one).not.toMatch(/\d/)
    expect(classifierCacheKey("plan resets tomorrow")).not.toBe(classifierCacheKey("plan resets next week"))
  })

  test("a repeated message costs one call: in flight it is joined, answered it is served from the cache", async () => {
    const { agent, classifier } = setup({ turn: reply('{"class": "quota", "resetAt": null}') })
    const first = askClassifier(classifier, { message: "Kontingent erschöpft (Anfrage 17)" })
    const joined = askClassifier(classifier, { message: "Kontingent erschöpft (Anfrage 18)" })
    expect(joined).toBe(first!)
    expect(await first).toEqual({ class: "quota" })
    expect(cachedAnswer({ message: "Kontingent erschöpft (Anfrage 99)" })).toEqual({ class: "quota" })
    expect(await askClassifier(classifier, { message: "Kontingent erschöpft (Anfrage 20)" })).toEqual({ class: "quota" })
    expect(classifierCalls()).toBe(1)
    expect(agent.argsOf("create")).toEqual([[{ title: CLASSIFY_TITLE }]])
  })
})

describe("the call limit", () => {
  test("20 calls per run; after that the patterns decide alone and the log says so once", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      const { classifier } = setup({ turn: reply('{"class": "transient", "resetAt": null}') })
      // Distinct wording (letters, not digits: digits are masked in the key).
      const word = (i: number) => `failure ${String.fromCharCode(97 + i)}${String.fromCharCode(97 + ((i * 7) % 26))}`
      for (let i = 0; i < CLASSIFY_CALL_LIMIT; i++) expect(await askClassifier(classifier, { message: word(i) })).toEqual({ class: "transient" })
      expect(classifierCalls()).toBe(CLASSIFY_CALL_LIMIT)
      expect(askClassifier(classifier, { message: word(20) })).toBeUndefined()
      expect(askClassifier(classifier, { message: word(21) })).toBeUndefined()
      // A known answer is still served: the limit counts calls, not lookups.
      expect(await askClassifier(classifier, { message: word(3) })).toEqual({ class: "transient" })
      expect(classifierCalls()).toBe(CLASSIFY_CALL_LIMIT)
      expect(lines.filter((line) => line.includes(`limit of ${CLASSIFY_CALL_LIMIT} calls`))).toHaveLength(1)
    } finally {
      printed.mockRestore()
    }
  })
})

describe("the reply", () => {
  test("one JSON line; fences and prose around it are skipped, the last valid line wins", () => {
    expect(parseClassifierReply('{"class": "quota", "resetAt": "2026-09-27T15:00:00+08:00"}')).toEqual({ class: "quota", resetAt: Date.parse("2026-09-27T07:00:00Z") })
    expect(parseClassifierReply('```json\n{"class":"Auth","resetAt":null}\n```')).toEqual({ class: "auth" })
    expect(parseClassifierReply('Looking at it:\n{"class": "rate", "resetAt": null}\n{"class": "quota", "resetAt": "2026-09-27T07:00Z"}')).toEqual({
      class: "quota",
      resetAt: Date.parse("2026-09-27T07:00:00Z"),
    })
    expect(parseClassifierReply('{"class": "quota", "resetAt": "2026-09-27T15:00:00+0800"}')?.resetAt).toBe(Date.parse("2026-09-27T07:00:00Z"))
  })

  test("an unparsable reply counts as no answer; a reset time without an offset is dropped", async () => {
    for (const text of ["It looks like a quota problem.", '{"class": "overflow", "resetAt": null}', '{"kind": "quota"}', "{not json}", '["quota"]', ""]) {
      expect(parseClassifierReply(text)).toBeUndefined()
    }
    expect(parseClassifierReply('{"class": "quota", "resetAt": "15:00"}')).toEqual({ class: "quota" })
    expect(parseClassifierReply('{"class": "quota", "resetAt": "2026-09-27T15:00:00"}')).toEqual({ class: "quota" })
    // Through a real call: no answer, nothing cached, so the next occurrence
    // asks again.
    const { classifier } = setup({ turn: reply("I think this is a quota problem.") })
    expect(await askClassifier(classifier, { message: "odd failure" })).toBeUndefined()
    expect(cachedAnswer({ message: "odd failure" })).toBeUndefined()
    expect(await askClassifier(classifier, { message: "odd failure" })).toBeUndefined()
    expect(classifierCalls()).toBe(2)
  })
})

describe("the raise-only merge", () => {
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

describe("reset times", () => {
  test("accepted only in the future and at most 7 days away", () => {
    expect(acceptedReset({ class: "quota", resetAt: NOW - 60_000 }, NOW)).toBeUndefined()
    expect(acceptedReset({ class: "quota", resetAt: NOW }, NOW)).toBeUndefined()
    expect(acceptedReset({ class: "quota", resetAt: NOW + 2 * 3_600_000 }, NOW)).toBe(NOW + 2 * 3_600_000)
    expect(acceptedReset({ class: "quota", resetAt: NOW + RESET_HORIZON_MS }, NOW)).toBe(NOW + RESET_HORIZON_MS)
    expect(acceptedReset({ class: "quota", resetAt: NOW + RESET_HORIZON_MS + 1 }, NOW)).toBeUndefined()
    expect(acceptedReset({ class: "quota" }, NOW)).toBeUndefined()
    expect(acceptedReset(undefined, NOW)).toBeUndefined()
  })

  test("the prompt states the current time in the registry's zone, so a relative reset resolves against it", () => {
    expect(isoInZone(NOW, "Asia/Shanghai")).toBe("2026-09-26T15:00:00+08:00")
    expect(isoInZone(NOW, "UTC")).toBe("2026-09-26T07:00:00+00:00")
    expect(isoInZone(Date.parse("2026-01-15T12:00:00Z"), "America/New_York")).toBe("2026-01-15T07:00:00-05:00")
  })
})

describe("the session", () => {
  test("one-shot, titled, bare, on the adapter's default agent; only the redacted error text and the time go out", async () => {
    const { agent, classifier } = setup({ turn: reply('{"class": "quota", "resetAt": "2026-09-26T18:00:00+08:00"}') })
    const answer = await askClassifier(classifier, {
      message: "Ihr Kontingent ist erschöpft; Zurücksetzung um 18:00 (key sk-live-Secret123456)",
      responseBody: '{"detail": "contact admin@example.com"}',
    })
    expect(answer).toEqual({ class: "quota", resetAt: Date.parse("2026-09-26T10:00:00Z") })
    expect(agent.argsOf("create")).toEqual([[{ title: "auto: classify error" }]])
    expect(agent.prompts).toHaveLength(1)
    const prompt = agent.prompts[0]!
    expect(prompt.bare).toBe(true)
    expect(prompt.model).toBe("free/model-a")
    expect("agent" in prompt).toBe(false)
    expect(prompt.text).toContain("2026-09-26T15:00:00+08:00")
    expect(prompt.text).toContain("Asia/Shanghai")
    expect(prompt.text).toContain("Ihr Kontingent ist erschöpft")
    expect(prompt.text).not.toContain("Secret123456")
    expect(prompt.text).not.toContain("admin@example.com")
    expect(prompt.text).not.toContain("<!-- auto: eof -->")
    // The session was subscribed before the prompt went out.
    expect(agent.calls.findIndex((c) => c.name === "events")).toBeLessThan(agent.calls.findIndex((c) => c.name === "prompt"))
  })

  test("a timeout counts as no answer: the session is aborted and nothing is marked or cached", async () => {
    const { agent, classifier } = setup({ turn: (ctx) => (isClassify(ctx) ? [ev.message(ctx.session, "m", 10)] : undefined) })
    const quick: Classifier = { ...classifier, timeoutMs: 40 }
    expect(await askClassifier(quick, { message: "odd failure" })).toBeUndefined()
    expect(agent.argsOf("abort")).toEqual([["ses_1"]])
    expect(isModelDown("free", NOW)).toBe(false)
    expect(cachedAnswer({ message: "odd failure" })).toBeUndefined()
  })

  test("the first usable classifier entry: the agent filter, windows and down marks apply", () => {
    const registry = facts().registry
    expect(classifierEntry(registry, "opencode", NOW)?.name).toBe("free")
    markModelDown("free")
    expect(classifierEntry(registry, "opencode", NOW)?.name).toBe("free2")
    markModelDown("free2", NOW + 60_000)
    expect(classifierEntry(registry, "opencode", NOW)).toBeUndefined()
    expect(classifierEntry(registry, "opencode", NOW + 120_000)?.name).toBe("free2")
    resetFailback()
    expect(classifierEntry(registry, "claude", NOW)).toBeUndefined()
    const closed = parseWindow("00:00-01:00")
    if (!("window" in closed)) throw new Error(closed.error)
    const windowed = facts({ models: [entry("free", { model: "free/model-a", only: [closed.window] }), entry("free2", { model: "free/model-b" })] }).registry
    expect(classifierEntry(windowed, "opencode", NOW)?.name).toBe("free2")
  })

  test("no usable entry: nothing is asked and nothing counts", () => {
    markModelDown("free")
    markModelDown("free2")
    const { agent, classifier } = setup()
    expect(askClassifier(classifier, { message: "odd failure" })).toBeUndefined()
    expect(classifierCalls()).toBe(0)
    expect(agent.calls).toHaveLength(0)
  })

  test("its own failure is classified by the patterns alone and marks only the classifier entry down", async () => {
    const { agent, classifier } = setup({
      turn: (ctx) => (isClassify(ctx) ? [ev.error(ctx.session, { name: "APIError", message: "insufficient_quota: free tier spent", isRetryable: false }), ev.idle(ctx.session)] : undefined),
    })
    expect(await askClassifier(classifier, { message: "odd failure" })).toBeUndefined()
    expect(isModelDown("free", NOW)).toBe(true)
    expect(isModelDown("free2", NOW)).toBe(false)
    expect(isModelDown("a", NOW)).toBe(false)
    // A failure the patterns leave transient or unknown marks nothing.
    resetClassifier()
    resetFailback()
    const flaky = setup({ turn: (ctx) => (isClassify(ctx) ? [ev.error(ctx.session, { name: "APIError", message: "upstream hiccup" }), ev.idle(ctx.session)] : undefined) })
    expect(await askClassifier(flaky.classifier, { message: "odd failure" })).toBeUndefined()
    expect(isModelDown("free", NOW)).toBe(false)
    // A dispatch that fails is a failure too.
    resetClassifier()
    const refused = setup({ fail: { prompt: { message: "401 unauthorized" } } })
    expect(await askClassifier(refused.classifier, { message: "odd failure" })).toBeUndefined()
    expect(isModelDown("free", NOW)).toBe(true)
    expect(agent.prompts).toHaveLength(1)
  })

  test("its token usage goes to the usage sink, never anywhere else", async () => {
    const seen: [number, string][] = []
    setClassifyUsageSink((usage, name) => seen.push([usage.input, name]))
    const { classifier } = setup({ turn: reply('{"class": "unknown", "resetAt": null}') })
    await askClassifier(classifier, { message: "odd failure" })
    expect(seen).toEqual([[300, "free"]])
  })
})
