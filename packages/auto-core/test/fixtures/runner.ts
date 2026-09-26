// Shared fixture for the runner-family tests: the sample task, the fake
// client family (fakeClient/sseClient/retryClient/idleStream), the git
// temporary-repository helpers (git/freshRepo). Split out of
// test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move);
// lives in fixtures/ — bun test only picks up *.test.ts, so this file is
// never run as a test.

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../../src/agent/opencode/client"
import { planOf } from "./units"

export const task = planOf(
  `## T-001: sample task [pending]
Body.
`,
).tasks[0]!

// An event stream that settles immediately: emits only one idle event for
// the sessionID (watch settles normally on it).
async function* idleStream(sessionID: string) {
  yield { type: "session.idle", properties: { sessionID } }
}

// Emits a user message carrying the model first (the model the server
// actually resolved, which drives attempt's ◈ announcement), then the idle
// event for a normal settle.
export async function* modelThenIdle(sessionID: string, model: string) {
  const [providerID, modelID] = model.split("/")
  yield {
    type: "message.updated",
    properties: {
      info: { id: `msg_u_${sessionID}`, sessionID, role: "user", model: { providerID, modelID }, time: { created: Date.now() } },
    },
  }
  yield { type: "session.idle", properties: { sessionID } }
}

// Minimal fake client (covers only the surface runner uses; default
// behavior = everything succeeds): calls records fork/create calls, updates
// records the session-rename parameters.
export function fakeClient(
  over: {
    fork?: (sessionID: string) => unknown
    get?: (sessionID: string) => unknown
    prompt?: () => unknown
    messages?: (sessionID: string) => unknown
    // The session the event stream currently follows (the idle target when
    // nothing new is created): the reuse/recovery takeover paths never call
    // create, so idle events must go to an existing session on the chain or
    // watch sees no end event.
    current?: string
    // Custom event stream (default = a single-idle normal-end stream):
    // receives the current session id so tests can emit targeted events;
    // () => AsyncIterable works too (a function with fewer parameters is
    // assignable to one with more).
    events?: (sessionID: string) => AsyncIterable<unknown>
  } = {},
) {
  const calls = {
    forks: [] as string[],
    creates: 0,
    updates: [] as { id: string; title: string }[],
    // Records each prompt's dispatch parameters, for model-routing
    // assertions (the model property is absent when unset).
    prompts: [] as { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; parts: unknown[] }[],
    // Each prompt's options.signal (H7: the assertion point for the
    // probe-decides-half-open → abort-POST linkage).
    promptSignals: [] as (AbortSignal | undefined)[],
    // Records the session ids of session.abort calls, for early-settle /
    // stream-teardown assertions (D.2: abort before degrading).
    aborts: [] as string[],
    // Question replies/rejections (auto-resolve T-005): replies records
    // each reply text, rejects records the rejected requestIDs (a repeated
    // question goes through reject + abort).
    replies: [] as string[],
    rejects: [] as string[],
    // The fork anchor passed on each fork (undefined = fork the whole
    // history), for frozen-point fork assertions.
    forkAnchors: [] as (string | undefined)[],
    // The text dispatched on each promptAsync (steer), for
    // truncation-resume / handover-steer assertions.
    steers: [] as string[],
  }
  let seq = 0
  let lastCreated = over.current ?? "ses_new_0"
  const sdk = {
    session: {
      create: async () => {
        calls.creates++
        lastCreated = `ses_new_${++seq}`
        return { data: { id: lastCreated } }
      },
      fork: async (params: { sessionID: string; messageID?: string }) => {
        calls.forks.push(params.sessionID)
        calls.forkAnchors.push(params.messageID)
        const result = over.fork ? over.fork(params.sessionID) : { data: { id: `ses_fork_${calls.forks.length}` } }
        // The forked copy is the dispatch target of later prompts; the
        // event stream follows it (same rule as create).
        const id = (result as { data?: { id?: string } }).data?.id
        if (id) lastCreated = id
        return result
      },
      get: async (params: { sessionID: string }) => (over.get ? over.get(params.sessionID) : { data: { id: params.sessionID } }),
      update: async (params: { sessionID: string; title: string }) => {
        calls.updates.push({ id: params.sessionID, title: params.title })
        return {}
      },
      prompt: async (
        params: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; parts: unknown[] },
        options?: { signal?: AbortSignal },
      ) => {
        calls.prompts.push(params)
        calls.promptSignals.push(options?.signal)
        return over.prompt ? over.prompt() : {}
      },
      promptAsync: async (params: { sessionID: string; parts: unknown[] }) => {
        calls.steers.push(String((params.parts[0] as { text?: string } | undefined)?.text ?? ""))
        return {}
      },
      abort: async (params?: { sessionID: string }) => {
        if (params?.sessionID) calls.aborts.push(params.sessionID)
        return {}
      },
      messages: async (params: { sessionID: string }) => (over.messages ? over.messages(params.sessionID) : { data: [] }),
    },
    question: {
      reply: async (params: { requestID: string; answers: string[][] }) => {
        calls.replies.push(params.answers.flat().join(""))
        return {}
      },
      reject: async (params: { requestID: string }) => {
        calls.rejects.push(params.requestID)
        return {}
      },
    },
    event: { subscribe: async () => ({ stream: over.events ? over.events(lastCreated) : idleStream(lastCreated) }) },
  } as unknown as OpencodeClient
  // client = the driver's view (AgentClient via the opencode adapter); sdk =
  // the raw fake, for tests that patch one SDK surface and re-wrap.
  return { client: opencodeAgent(sdk), calls, sdk }
}

// Fake subscription with signal pass-through: records the AbortSignal
// subscribe received; the event stream emits one idle event first (watch
// settles normally on it), finally records the teardown — the real SDK
// generator goes through return() into finally on the consumer's break
// (releasing the lock only, not the connection); the driver closes the
// underlying connection with an explicit abort. What this test asserts is
// exactly "the signal was passed through and every exit path necessarily
// aborts".
export function sseClient(
  id: string,
  over: { prompt?: () => unknown } = {},
) {
  const state = { signal: undefined as AbortSignal | undefined, closed: false }
  const sdk = {
    session: {
      create: async () => ({ data: { id } }),
      prompt: async () => (over.prompt ? over.prompt() : {}),
      abort: async () => ({}),
    },
    event: {
      subscribe: async (_params: unknown, options?: { signal?: AbortSignal }) => {
        state.signal = options?.signal
        const stream = async function* () {
          try {
            yield { type: "session.idle", properties: { sessionID: id } }
          } finally {
            state.closed = true
          }
        }
        return { stream: stream() }
      },
    },
  } as unknown as OpencodeClient
  return { client: opencodeAgent(sdk), state }
}

// Builds an event stream that emits only session.error (optionally
// isRetryable) + session.idle, fed to the same subscribe surface as
// fakeClient — outcomes are consumed one by one in create/fork call order,
// deciding whether the session created/forked in that round reports an
// error.
export type Outcome = "error-retryable" | "error-fatal" | "ok"
// used: the "context usage at the end of that session" in the same order as
// outcomes (a number means every session gets the same amount); absent
// means 0 (a pure error stub).
// Injected through message.updated events, the same metering path as the
// real chain (input + cache.read).
// message: the error text, which decides how classifySessionError sorts it
// — the default "usage limit" falls into quota (the existing quota-branch
// cases rely on that); a transient/unknown text takes the retry ladder.
export function retryClient(outcomes: Outcome[], used: number[] | number = [], message = "usage limit") {
  // prompts records each dispatch's parameters (the model property is
  // absent when unset), for model-routing / failover assertions.
  const calls = { forks: [] as string[], creates: 0, prompts: [] as { sessionID: string; model?: { providerID: string; modelID: string }; parts: unknown[] }[] }
  const queue: unknown[] = []
  let index = 0
  let seq = 0
  const enqueue = (id: string) => {
    const tokens = typeof used === "number" ? used : (used[index] ?? 0)
    const outcome = outcomes[index++]
    if (tokens > 0) {
      queue.push({
        type: "message.updated",
        properties: {
          info: {
            id: `msg_${id}`,
            sessionID: id,
            role: "assistant",
            time: { completed: Date.now() },
            tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            providerID: "zai",
            modelID: "glm",
          },
        },
      })
    }
    if (outcome === "error-retryable" || outcome === "error-fatal") {
      queue.push({
        type: "session.error",
        properties: { sessionID: id, error: { name: "APIError", data: { message, isRetryable: outcome === "error-retryable" } } },
      })
    }
    queue.push({ type: "session.idle", properties: { sessionID: id } })
  }
  const sdk = {
    session: {
      create: async () => {
        calls.creates++
        const id = `ses_new_${++seq}`
        enqueue(id)
        return { data: { id } }
      },
      fork: async (params: { sessionID: string }) => {
        calls.forks.push(params.sessionID)
        const id = `ses_fork_${calls.forks.length}`
        enqueue(id)
        return { data: { id } }
      },
      update: async () => ({}),
      prompt: async (params: { sessionID: string; model?: { providerID: string; modelID: string }; parts: unknown[] }) => {
        calls.prompts.push(params)
        return {}
      },
      promptAsync: async () => ({}),
      abort: async () => ({}),
      messages: async () => ({ data: [] }),
      get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
    },
    event: { subscribe: async () => ({ stream: (async function* () { while (queue.length) yield queue.shift() })() }) },
  } as unknown as OpencodeClient
  // client = the driver's view (AgentClient via the opencode adapter); sdk =
  // the raw fake, for tests that patch one SDK surface and re-wrap.
  return { client: opencodeAgent(sdk), calls, sdk }
}

export async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

export async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), "auto-runner-"))
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@t")
  await git(dir, "config", "user.name", "t")
  return dir
}
