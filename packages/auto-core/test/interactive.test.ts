import { afterEach, describe, expect, test } from "bun:test"
import { PassThrough, Writable } from "node:stream"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { startInteractive, type Interactive } from "../src/interactive"
import { log } from "../src/log"
import { services } from "../src/services"

// Drive the resident readline with injected streams; the stub client records
// the messages promptAsync receives. chunks collects everything the output
// stream receives (for asserting side effects such as prompt redraws).
// modelNames turns the /failback input check into its registry form.
function setup(modelNames?: ReadonlySet<string>) {
  const input = new PassThrough()
  const chunks: string[] = []
  const output = new Writable({
    write: (chunk, _enc, cb) => {
      chunks.push(String(chunk))
      cb()
    },
  })
  const sent: Array<{ sessionID: string; text: string }> = []
  const client = opencodeAgent({
    session: {
      promptAsync: (params: { sessionID: string; parts?: Array<{ type: string; text?: string }> }) => {
        sent.push({ sessionID: params.sessionID, text: params.parts?.[0]?.text ?? "" })
        return Promise.resolve({ data: undefined, error: undefined, request: undefined, response: undefined })
      },
    },
  } as unknown as OpencodeClient)
  const repl = startInteractive(async () => client, undefined, { input, output }, modelNames)
  return { input, sent, repl, chunks }
}

// readline dispatches line events asynchronously; wait a tick before
// asserting.
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

describe("interactive", () => {
  let repl: Interactive | undefined

  afterEach(() => {
    repl?.close()
    repl = undefined
  })

  test("/exit is not sent to the session; it sets the exit request", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    expect(services().control.exitRequested()).toBe(false)
    ctx.input.write("/exit\n")
    await tick()
    expect(ctx.sent).toEqual([])
    expect(services().control.exitRequested()).toBe(true)
    // After the flag is set the input line stays usable; later messages are
    // sent as usual.
    ctx.input.write("keep sending messages\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "keep sending messages" }])
  })

  test("/exit still sets the flag with no active session (unlike the message-dropping semantics)", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.write("/exit\n")
    await tick()
    expect(services().control.exitRequested()).toBe(true)
  })

  test("/failback is not sent to the session; it sets the failback request", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    expect(services().router.failbackRequested()).toBe(false)
    ctx.input.write("/failback\n")
    await tick()
    expect(ctx.sent).toEqual([])
    expect(services().router.failbackRequested()).toBe(true)
    // No-argument form: consuming it only resets the failover state and
    // produces no model-order override (the chain's route clears at the
    // boundary that holds it, not here).
    expect(services().router.consumeFailback()).toBe(true)
    expect(services().router.failbackOverride()).toBeUndefined()
  })

  test("/failback with arguments: a space-separated model order — the first is the preferred model, the rest the failover candidate ring", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.write("/failback kimi/k3 zai/glm-5.3-flash zai/glm-5.3\n")
    await tick()
    expect(services().router.failbackRequested()).toBe(true)
    expect(services().router.consumeFailback()).toBe(true)
    expect(services().router.failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: ["zai/glm-5.3-flash", "zai/glm-5.3"] })
  })

  test("/failback with a slash-less argument: the request is refused, the input line stays usable", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    ctx.input.write("/failback kimi/k3 bad\n")
    await tick()
    expect(services().router.failbackRequested()).toBe(false)
    ctx.input.write("keep sending messages\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "keep sending messages" }])
  })

  // Under a model registry (plans/0055 §9) the arguments are internal names;
  // an unknown name is refused at input, as malformed arguments always were.
  test("/failback under a registry: internal names accepted, unknown names refused", async () => {
    const ctx = setup(new Set(["opus", "k3"]))
    repl = ctx.repl
    ctx.repl.attach("s1")
    ctx.input.write("/failback opus k3\n")
    await tick()
    expect(services().router.failbackRequested()).toBe(true)
    expect(services().router.consumeFailback()).toBe(true)
    expect(services().router.failbackOverride()).toEqual({ wildcard: "opus", fallback: ["k3"] })
    ctx.input.write("/failback glm\n")
    await tick()
    expect(services().router.failbackRequested()).toBe(false)
    expect(ctx.sent).toEqual([])
  })

  test("Enter sends the input as a message to the attached session", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    ctx.input.write("please also check the types\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "please also check the types" }])
    ctx.repl.attach("s2")
    ctx.input.write("send to the new session\n")
    await tick()
    expect(ctx.sent[1]).toEqual({ sessionID: "s2", text: "send to the new session" })
  })

  test("input is dropped with no active session; blank lines are not sent", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.write("too early\n\n   \n")
    await tick()
    expect(ctx.sent).toEqual([])
  })

  test("question takes over the input line for the answer; messaging resumes afterwards", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    const answer = ctx.repl.question("Question text", 1)
    ctx.input.write("this way works\n")
    expect(await answer).toBe("this way works")
    ctx.input.write("keep sending messages\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "keep sending messages" }])
  })

  test("a blank question line parses to an empty string (interpreted by the caller under the original semantics)", async () => {
    const ctx = setup()
    repl = ctx.repl
    const answer = ctx.repl.question("pause between tasks", 1)
    ctx.input.write("\n")
    expect(await answer).toBe("")
  })

  test("after stdin closes, a waiting question falls back to undefined and later input is ignored", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    const answer = ctx.repl.question("Question text", 1)
    ctx.input.end()
    expect(await answer).toBeUndefined()
    await tick()
    expect(ctx.sent).toEqual([])
  })

  test("after stdin closes, logging no longer redraws the prompt on the closed readline (2026-09-17 review H6)", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.end()
    await tick()
    // Observe only the log-triggered redraw: clear the prompt already
    // written during startup/close.
    ctx.chunks.length = 0
    log("a log line after stdin closed")
    // The close event has synchronously cleared log.ts's resident input-line
    // reference: logging no longer triggers a prompt redraw. (The report's
    // original claim that "rl.prompt(true) throws ERR_USE_AFTER_CLOSE" was
    // disproven — neither Node 20 nor Bun throws; only the promises
    // question() throws, and log.ts does not use it; the fix converged to
    // symmetric cleanup, and this assertion is the observable difference.)
    expect(ctx.chunks.join("")).not.toContain("💬")
  })
})
