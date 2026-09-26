// opencode adapter (MA.3, design plans/0039): the SDK client behind the
// frozen AgentClient interface. Every SDK call of the driver goes through
// here; nothing outside agent/opencode/ imports @opencode-ai/sdk.
//
// Failure shape: the SDK v2 client never rejects in practice — it turns fetch
// exceptions (network errors, the timeoutFetch abort) into `{ error }`, and
// its SSE generator retries until its signal aborts. The adapter maps
// `{ error }` to `{ ok: false }` and additionally catches rejections (older
// clients, test doubles), so every call resolves (0037 D2).
//
// What stays opencode-only here: the "provider/model" split of the model
// string, the SSE → AgentEvent mapping, and opencode's own error type names
// for the classifier.
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { AgentCapabilities, AgentClient, AgentErrorPatterns, AgentEvent, AgentResult, PromptInput } from "../types"
import { mapEvent, mapMessage } from "./events"

// opencode persists sessions, forks at a message anchor, accepts prompts into
// a live session, and measures context per message in the event stream.
export const OPENCODE_CAPABILITIES: AgentCapabilities = {
  resume: true,
  fork: "message",
  steer: true,
  abort: true,
  question: true,
  permission: true,
  history: true,
  usage: "events",
}

// opencode's error type names (session.error `name`; watch folds the name into
// the classified message). The neutral wording stays in chain.ts.
export const OPENCODE_ERROR_PATTERNS: AgentErrorPatterns = {
  overflow: /contextoverflowerror/i,
  auth: /providerautherror/i,
}

// "prov/model" → the SDK's model parameter, split at the first "/": the
// provider comes first, the model id is the rest and may contain colons.
// Model strings always contain "/" (switches.ts parseModelPolicy), so idx ≥ 0.
export function splitModel(s: string): { providerID: string; modelID: string } {
  const idx = s.indexOf("/")
  return { providerID: s.slice(0, idx), modelID: s.slice(idx + 1) }
}

// SDK result → AgentResult. `pick` extracts the value from `data`.
async function settle<T>(call: () => Promise<{ data?: unknown; error?: unknown } | undefined>, pick: (data: any) => T): Promise<AgentResult<T>> {
  try {
    const got = await call()
    // No response object at all is not success (the SDK always returns one;
    // only a broken double returns nothing).
    if (!got) return { ok: false, error: new Error("no response") }
    if (got.error) return { ok: false, error: got.error }
    return { ok: true, value: pick(got?.data) }
  } catch (error) {
    return { ok: false, error }
  }
}

const none = () => undefined

// The v2 body's tool map of a bare prompt, fresh per request: the wildcard
// key denies every tool name (opencode matches permission names with its
// wildcard matcher; the rule it stores is `{ permission: "*", action:
// "deny", pattern: "*" }`).
const bareTools = (): Record<string, boolean> => ({ "*": false })

export function opencodeAgent(sdk: OpencodeClient): AgentClient {
  const text = (input: PromptInput) => [{ type: "text" as const, text: input.text }]
  return {
    capabilities: OPENCODE_CAPABILITIES,
    errorPatterns: OPENCODE_ERROR_PATTERNS,
    create: ({ title }) => settle(() => sdk.session.create({ title }), (data) => ({ id: data.id as string })),
    // The synchronous POST resolves at turn end (its 2 h ceiling is
    // timeoutFetch's turn timeout). `agent` is always sent as a key, as the
    // driver did before (undefined is dropped on the wire); a prompt without
    // a model string carries no model key at all (routing invariant, 0017),
    // and a variant (a registry model entry's reasoning-effort variant,
    // plans/0055 §4.2) rides in the v2 prompt body only when one is given.
    // A bare prompt (the failure-message classifier, plans/0055 §7.1, F18)
    // adds `tools: {"*": false}`: the server stores one deny rule for every
    // permission on the session, and its request preparation drops every
    // tool that rule denies (packages/opencode session/prompt.ts and
    // session/llm/request.ts resolveTools), so the turn runs with no tool.
    prompt: (input, signal) =>
      settle(
        () =>
          sdk.session.prompt(
            {
              sessionID: input.session,
              agent: input.agent,
              ...(input.model ? { model: splitModel(input.model) } : {}),
              ...(input.variant !== undefined ? { variant: input.variant } : {}),
              ...(input.bare === true ? { tools: bareTools() } : {}),
              parts: text(input),
            },
            { signal },
          ),
        none,
      ),
    promptAsync: (input) =>
      settle(
        () =>
          sdk.session.promptAsync({
            sessionID: input.session,
            ...(input.agent !== undefined ? { agent: input.agent } : {}),
            ...(input.model ? { model: splitModel(input.model) } : {}),
            ...(input.variant !== undefined ? { variant: input.variant } : {}),
            ...(input.bare === true ? { tools: bareTools() } : {}),
            parts: text(input),
          }),
        none,
      ),
    abort: (session) => settle(() => sdk.session.abort({ sessionID: session }), none),
    // opencode copies the messages *before* `before` (the whole session when absent).
    fork: (session, before) =>
      settle(() => sdk.session.fork({ sessionID: session, ...(before ? { messageID: before } : {}) }), (data) => ({ id: data.id as string })),
    rename: (session, title) => settle(() => sdk.session.update({ sessionID: session, title }), none),
    messages: (session) =>
      settle(
        () => sdk.session.messages({ sessionID: session }),
        (data) => (data as { info: Parameters<typeof mapMessage>[0] }[]).map((message) => mapMessage(message.info)),
      ),
    get: (session) => settle(() => sdk.session.get({ sessionID: session }), (data) => ({ id: (data?.id as string | undefined) ?? session })),
    async events(signal) {
      // Same timing as before the adapter: the SDK hands back its stream at
      // once and connects on the first read, which watch does right away. A
      // subscription that cannot be set up is an empty stream (D2).
      const subscribed = await Promise.resolve()
        .then(() => sdk.event.subscribe(undefined, { signal }))
        .catch(() => undefined)
      const stream = subscribed?.stream as AsyncIterable<unknown> | undefined
      return (async function* (): AsyncGenerator<AgentEvent> {
        if (!stream) return
        for await (const raw of stream) {
          const event = mapEvent(raw as Parameters<typeof mapEvent>[0])
          if (event) yield event
        }
      })()
    },
    replyQuestion: (request, answers) => settle(() => sdk.question.reply({ requestID: request, answers }), none),
    rejectQuestion: (request) => settle(() => sdk.question.reject({ requestID: request }), none),
    replyPermission: (request, reply) => settle(() => sdk.permission.reply({ requestID: request, reply }), none),
    // providerID/modelID → context window. Any failure (request error, old
    // server, a test double without the surface) yields an empty map: the
    // caller treats the window as unknown.
    async contextLimits() {
      const limits = new Map<string, number>()
      try {
        const response = await sdk.provider.list()
        for (const provider of response?.data?.all ?? []) {
          for (const [id, model] of Object.entries(provider.models)) limits.set(`${provider.id}/${id}`, model.limit.context)
        }
      } catch {}
      return limits
    },
  }
}
