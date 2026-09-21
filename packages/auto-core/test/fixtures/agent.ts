// A native AgentClient double (MA.6): it speaks the unified AgentEvent
// vocabulary directly, with no SDK shape and no adapter underneath, so tests
// built on it show the driver depends on src/agent/types.ts alone. The other
// fixtures (fixtures/runner.ts) fake the opencode SDK and wrap it in the
// opencode adapter; this one stands in for "any agent".
//
// Every call is recorded in `calls` (name + arguments, in order), so a test can
// assert both what reached the agent and what never did (a missing capability
// must keep its calls away). Turns are scripted: each prompt / promptAsync
// runs `turn(ctx)` and publishes its events to every live subscription.

import type {
  AgentCapabilities,
  AgentClient,
  AgentError,
  AgentErrorPatterns,
  AgentEvent,
  AgentMessage,
  AgentResult,
  AgentTokens,
  PromptInput,
} from "../../src/agent/types"

// The fourteen AgentClient calls (the coverage roster of test/agent-fake.test.ts).
export const AGENT_CALLS = [
  "create",
  "prompt",
  "promptAsync",
  "abort",
  "fork",
  "rename",
  "messages",
  "get",
  "events",
  "replyQuestion",
  "rejectQuestion",
  "replyPermission",
  "contextLimits",
  "defaultModel",
] as const
export type AgentCall = (typeof AGENT_CALLS)[number]

export const FULL_CAPABILITIES: AgentCapabilities = {
  resume: true,
  fork: "message",
  steer: true,
  abort: true,
  question: true,
  permission: true,
  history: true,
  usage: "events",
}

// The barest agent the driver accepts: one-shot sessions, no mid-turn input,
// no questions or permissions, no history, no usage figures.
export const BARE_CAPABILITIES: AgentCapabilities = {
  resume: false,
  fork: "none",
  steer: false,
  abort: false,
  question: false,
  permission: false,
  history: false,
  usage: "none",
}

export type TurnContext = {
  session: string
  text: string
  // prompt = a dispatched turn; steer = text injected via promptAsync.
  kind: "prompt" | "steer"
  // 1-based count of prompt turns so far on this client (steers not counted).
  n: number
}

// Events of one turn; `undefined` from a custom script means "the default turn".
export type TurnScript = (ctx: TurnContext) => AgentEvent[] | undefined

export const MODEL = "fake/model-1"
export const WINDOW = 100_000

const tokens = (input: number): AgentTokens => ({ input, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 })

// Event builders for scripts.
export const ev = {
  text: (session: string, id: string, text: string): AgentEvent => ({ type: "part", session, part: { kind: "text", id, text, final: true } }),
  step: (session: string, id: string, reason = "stop", input = 100): AgentEvent => ({
    type: "part",
    session,
    part: { kind: "step-finish", id, reason, tokens: tokens(input), cost: 0.01 },
  }),
  message: (session: string, id: string, contextUsed?: number, extra: Partial<AgentMessage> = {}): AgentEvent => ({
    type: "message",
    session,
    message: { id, role: "assistant", completed: true, model: MODEL, failed: false, ...(contextUsed !== undefined ? { contextUsed } : {}), ...extra },
  }),
  tool: (session: string, id: string, tool: string, input: Record<string, unknown>, output: string): AgentEvent => ({
    type: "part",
    session,
    part: { kind: "tool", id, tool, status: "completed", input, output, title: tool },
  }),
  question: (session: string, request: string, ...questions: string[]): AgentEvent => ({ type: "question", session, request, questions }),
  permission: (session: string, request: string, permission: string, ...patterns: string[]): AgentEvent => ({
    type: "permission",
    session,
    request,
    permission,
    patterns,
  }),
  error: (session: string, error: AgentError): AgentEvent => ({ type: "error", session, error }),
  idle: (session: string): AgentEvent => ({ type: "idle", session }),
}

// The default turn: a completed message measuring 1000 tokens of context, the
// closing words "done: <prompt>", one billed step, idle.
export function defaultTurn(ctx: TurnContext): AgentEvent[] {
  const k = `${ctx.session}_${ctx.kind}_${ctx.n}`
  return [ev.message(ctx.session, `msg_${k}`, 1000), ev.text(ctx.session, `txt_${k}`, `done: ${ctx.text}`), ev.step(ctx.session, `stp_${k}`), ev.idle(ctx.session)]
}

export type FakeAgentOptions = {
  capabilities?: Partial<AgentCapabilities>
  errorPatterns?: AgentErrorPatterns
  // Script per turn; absent (or returning undefined) = defaultTurn.
  turn?: TurnScript
  // Events published on each steer; absent = none (the running turn goes on
  // with what it already queued).
  steer?: TurnScript
  // Calls that fail (resolve { ok: false }) instead of succeeding.
  fail?: Partial<Record<AgentCall, unknown>>
  // Sessions `get` reports as gone.
  gone?: string[]
  limits?: Record<string, number>
  defaultModel?: string
  // Seeded history per session (messages() returns it; forks copy it).
  history?: Record<string, AgentMessage[]>
}

export type FakeAgent = {
  client: AgentClient
  calls: { name: AgentCall; args: unknown[] }[]
  // Recorded calls of one kind, arguments only.
  argsOf: (name: AgentCall) => unknown[][]
  // Prompts and steers in dispatch order.
  prompts: PromptInput[]
  steers: string[]
}

export function fakeAgent(options: FakeAgentOptions = {}): FakeAgent {
  const capabilities: AgentCapabilities = { ...FULL_CAPABILITIES, ...options.capabilities }
  const calls: FakeAgent["calls"] = []
  const prompts: PromptInput[] = []
  const steers: string[] = []
  const history = new Map<string, AgentMessage[]>(Object.entries(options.history ?? {}).map(([k, v]) => [k, [...v]]))
  const subscribers = new Set<{ push: (event: AgentEvent) => void }>()
  let seq = 0
  let turns = 0

  const record = (name: AgentCall, ...args: unknown[]) => calls.push({ name, args })
  const failed = (name: AgentCall): AgentResult<never> | undefined =>
    options.fail && name in options.fail ? { ok: false, error: options.fail[name] ?? new Error(`${name} failed`) } : undefined

  // Publishes on the next tick, after the dispatching call returned (the
  // order a real agent's transport gives).
  const publish = (events: AgentEvent[]) =>
    setTimeout(() => {
      for (const event of events) {
        if (event.type === "message" && capabilities.history) {
          const list = history.get(event.session) ?? []
          const at = list.findIndex((m) => m.id === event.message.id)
          if (at >= 0) list[at] = event.message
          else list.push(event.message)
          history.set(event.session, list)
        }
        for (const sub of subscribers) sub.push(event)
      }
    }, 0)

  const client: AgentClient = {
    capabilities,
    ...(options.errorPatterns ? { errorPatterns: options.errorPatterns } : {}),
    async create(input) {
      record("create", input)
      const fail = failed("create")
      if (fail) return fail
      const id = `ses_${++seq}`
      history.set(id, [])
      return { ok: true, value: { id } }
    },
    async prompt(input, signal) {
      record("prompt", input, signal)
      prompts.push(input)
      const fail = failed("prompt")
      if (fail) return fail
      const ctx: TurnContext = { session: input.session, text: input.text, kind: "prompt", n: ++turns }
      publish(options.turn?.(ctx) ?? defaultTurn(ctx))
      return { ok: true, value: undefined }
    },
    async promptAsync(input) {
      record("promptAsync", input)
      steers.push(input.text)
      const fail = failed("promptAsync")
      if (fail) return fail
      const events = options.steer?.({ session: input.session, text: input.text, kind: "steer", n: turns })
      if (events) publish(events)
      return { ok: true, value: undefined }
    },
    async abort(session) {
      record("abort", session)
      return failed("abort") ?? { ok: true, value: undefined }
    },
    async fork(session, before) {
      record("fork", session, before)
      const fail = failed("fork")
      if (fail) return fail
      const id = `ses_${++seq}`
      const source = history.get(session) ?? []
      const cut = before === undefined ? source.length : source.findIndex((m) => m.id === before)
      history.set(id, source.slice(0, cut < 0 ? source.length : cut))
      return { ok: true, value: { id } }
    },
    async rename(session, title) {
      record("rename", session, title)
      return failed("rename") ?? { ok: true, value: undefined }
    },
    async messages(session) {
      record("messages", session)
      return failed("messages") ?? { ok: true, value: [...(history.get(session) ?? [])] }
    },
    async get(session) {
      record("get", session)
      const fail = failed("get")
      if (fail) return fail
      if (options.gone?.includes(session)) return { ok: false, error: new Error(`session ${session} not found`) }
      return { ok: true, value: { id: session } }
    },
    async events(signal) {
      record("events", signal)
      const queue: AgentEvent[] = []
      let wake: (() => void) | undefined
      const sub = {
        push: (event: AgentEvent) => {
          queue.push(event)
          wake?.()
        },
      }
      if (failed("events")) return (async function* () {})()
      subscribers.add(sub)
      const stopped = new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      })
      return (async function* () {
        try {
          for (;;) {
            while (queue.length) yield queue.shift()!
            if (signal.aborted) return
            await Promise.race([new Promise<void>((resolve) => (wake = resolve)), stopped])
            wake = undefined
          }
        } finally {
          subscribers.delete(sub)
        }
      })()
    },
    async replyQuestion(request, answers) {
      record("replyQuestion", request, answers)
      return failed("replyQuestion") ?? { ok: true, value: undefined }
    },
    async rejectQuestion(request) {
      record("rejectQuestion", request)
      return failed("rejectQuestion") ?? { ok: true, value: undefined }
    },
    async replyPermission(request, reply) {
      record("replyPermission", request, reply)
      return failed("replyPermission") ?? { ok: true, value: undefined }
    },
    async contextLimits() {
      record("contextLimits")
      return new Map(Object.entries(options.limits ?? { [MODEL]: WINDOW }))
    },
    async defaultModel(agent) {
      record("defaultModel", agent)
      return options.defaultModel
    },
  }

  return {
    client,
    calls,
    argsOf: (name) => calls.filter((c) => c.name === name).map((c) => c.args),
    prompts,
    steers,
  }
}
