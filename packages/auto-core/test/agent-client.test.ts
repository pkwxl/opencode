// MA.3 (plans/0039): the opencode adapter — every AgentClient call against a
// fake SDK client. What goes on the wire must equal what the driver sent
// before the adapter (prompt shape, model split, anchors), and no call may
// reject (0037 D2). The driver-level behavior on top of it is covered by the
// existing suites, whose fakes now go through this adapter.
import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { OPENCODE_CAPABILITIES, opencodeAgent } from "../src/agent/opencode/client"
import type { AgentEvent } from "../src/agent/types"

const sdk = (surface: Record<string, unknown>) => surface as unknown as OpencodeClient

describe("opencode adapter: requests", () => {
  test("prompt: agent key always sent, model split at the first '/', no model key without a model, signal forwarded", async () => {
    const seen: { params: Record<string, unknown>; signal?: AbortSignal }[] = []
    const client = opencodeAgent(
      sdk({
        session: {
          prompt: async (params: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
            seen.push({ params, signal: options?.signal })
            return {}
          },
        },
      }),
    )
    const signal = new AbortController().signal
    expect(await client.prompt({ session: "s1", agent: "auto", model: "openai/gpt-4:128k", text: "hi" }, signal)).toEqual({ ok: true, value: undefined })
    await client.prompt({ session: "s1", text: "plain" })
    expect(seen[0]).toEqual({
      params: { sessionID: "s1", agent: "auto", model: { providerID: "openai", modelID: "gpt-4:128k" }, parts: [{ type: "text", text: "hi" }] },
      signal,
    })
    expect("agent" in seen[1]!.params).toBe(true)
    expect("model" in seen[1]!.params).toBe(false)
  })

  test("promptAsync: steer text only (no agent/model keys unless given)", async () => {
    const seen: Record<string, unknown>[] = []
    const client = opencodeAgent(sdk({ session: { promptAsync: async (params: Record<string, unknown>) => (seen.push(params), {}) } }))
    await client.promptAsync({ session: "s1", text: "steer" })
    await client.promptAsync({ session: "s1", agent: "auto", text: "typed" })
    expect(seen).toEqual([
      { sessionID: "s1", parts: [{ type: "text", text: "steer" }] },
      { sessionID: "s1", agent: "auto", parts: [{ type: "text", text: "typed" }] },
    ])
  })

  test("fork: anchor becomes messageID only when given; create/get return ids", async () => {
    const forks: Record<string, unknown>[] = []
    const client = opencodeAgent(
      sdk({
        session: {
          fork: async (params: Record<string, unknown>) => (forks.push(params), { data: { id: "ses_f" } }),
          create: async () => ({ data: { id: "ses_c" } }),
          get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
        },
      }),
    )
    expect(await client.fork("s1")).toEqual({ ok: true, value: { id: "ses_f" } })
    await client.fork("s1", "msg_2")
    expect(forks).toEqual([{ sessionID: "s1" }, { sessionID: "s1", messageID: "msg_2" }])
    expect(await client.create({ title: "t" })).toEqual({ ok: true, value: { id: "ses_c" } })
    expect(await client.get("s9")).toEqual({ ok: true, value: { id: "s9" } })
  })

  test("never rejects: error body, thrown request, missing surface and missing response all resolve ok:false", async () => {
    const body = { name: "NotFoundError", data: { message: "gone" } }
    const thrown = new Error("fetch failed")
    const client = opencodeAgent(
      sdk({
        session: {
          get: async () => ({ error: body }),
          abort: async () => {
            throw thrown
          },
          update: async () => undefined,
        },
      }),
    )
    expect(await client.get("s1")).toEqual({ ok: false, error: body })
    expect(await client.abort("s1")).toEqual({ ok: false, error: thrown })
    expect((await client.rename("s1", "t")).ok).toBe(false)
    // No question surface on the double at all.
    expect((await client.replyQuestion("q1", [["a"]])).ok).toBe(false)
  })

  test("replies go to the right request with the right payload", async () => {
    const calls: unknown[] = []
    const client = opencodeAgent(
      sdk({
        question: { reply: async (p: unknown) => (calls.push(["reply", p]), {}), reject: async (p: unknown) => (calls.push(["reject", p]), {}) },
        permission: { reply: async (p: unknown) => (calls.push(["perm", p]), {}) },
      }),
    )
    await client.replyQuestion("q1", [["yes"], ["no"]])
    await client.rejectQuestion("q2")
    await client.replyPermission("r1", "always")
    expect(calls).toEqual([
      ["reply", { requestID: "q1", answers: [["yes"], ["no"]] }],
      ["reject", { requestID: "q2" }],
      ["perm", { requestID: "r1", reply: "always" }],
    ])
  })

  test("messages: history mapped to AgentMessage (model string, context occupancy, failure)", async () => {
    const client = opencodeAgent(
      sdk({
        session: {
          messages: async () => ({
            data: [
              { info: { id: "m1", role: "user" } },
              { info: { id: "m2", role: "assistant", time: { completed: 1 }, providerID: "zai", modelID: "glm", tokens: { input: 900, cache: { read: 100 } } } },
              { info: { id: "m3", role: "assistant", providerID: "zai", modelID: "glm", tokens: { input: 0, cache: { read: 0 } }, error: { name: "APIError" } } },
            ],
          }),
        },
      }),
    )
    expect(await client.messages("s1")).toEqual({
      ok: true,
      value: [
        { id: "m1", role: "user", completed: false, failed: false },
        { id: "m2", role: "assistant", completed: true, model: "zai/glm", contextUsed: 1000, failed: false },
        { id: "m3", role: "assistant", completed: false, model: "zai/glm", contextUsed: 0, failed: true },
      ],
    })
  })

  test("contextLimits: provider table keyed by model string; any failure is an empty map", async () => {
    const ok = opencodeAgent(sdk({ provider: { list: async () => ({ data: { all: [{ id: "kimi", models: { k2: { limit: { context: 262_100 } } } }] } }) } }))
    expect([...(await ok.contextLimits())]).toEqual([["kimi/k2", 262_100]])
    const broken = opencodeAgent(sdk({ provider: { list: async () => Promise.reject(new Error("down")) } }))
    expect((await broken.contextLimits()).size).toBe(0)
  })

  test("capabilities and error names", () => {
    const client = opencodeAgent(sdk({}))
    expect(client.capabilities).toEqual(OPENCODE_CAPABILITIES)
    expect(client.capabilities.usage).toBe("events")
    expect(client.errorPatterns?.overflow?.test("ContextOverflowError: too long")).toBe(true)
    expect(client.errorPatterns?.auth?.test("ProviderAuthError")).toBe(true)
  })
})

describe("opencode adapter: event stream", () => {
  test("SSE events mapped, unrelated ones dropped, subscription signal forwarded", async () => {
    let signal: AbortSignal | undefined
    const client = opencodeAgent(
      sdk({
        event: {
          subscribe: async (_: unknown, options?: { signal?: AbortSignal }) => {
            signal = options?.signal
            return {
              stream: (async function* () {
                yield { type: "server.connected", properties: {} }
                yield { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }
                yield { type: "session.idle", properties: { sessionID: "s1" } }
              })(),
            }
          },
        },
      }),
    )
    const controller = new AbortController()
    const seen: AgentEvent[] = []
    for await (const event of await client.events(controller.signal)) seen.push(event)
    expect(seen).toEqual([{ type: "idle", session: "s1" }])
    expect(signal).toBe(controller.signal)
  })

  test("a subscription that cannot be set up is an empty stream (read by watch as transport loss)", async () => {
    const client = opencodeAgent(sdk({ event: { subscribe: async () => Promise.reject(new Error("refused")) } }))
    const seen: AgentEvent[] = []
    for await (const event of await client.events(new AbortController().signal)) seen.push(event)
    expect(seen).toEqual([])
  })
})
