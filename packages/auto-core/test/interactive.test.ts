import { afterEach, describe, expect, test } from "bun:test"
import { PassThrough, Writable } from "node:stream"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { interactiveChannel, startInteractive, type Interactive } from "../src/interactive"
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

  test("a free line between turns is discarded after detach — no fresh unwatched turn starts on the idle session (plans/0181 D1, 0165-010)", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    ctx.input.write("while the turn runs\n")
    await tick()
    expect(ctx.sent.length).toBe(1)
    // The dispatch's watch ended: the sideband detached, and a free line now
    // answers 0014 §2's own rule — both adapters start a fresh, unwatched
    // agent turn on the idle session otherwise, its edits riding whichever
    // unit commits next.
    ctx.repl.detach()
    ctx.input.write("between turns\n")
    await tick()
    // No promptAsync — the discard line ("no active session, input
    // discarded") goes to the run log, 0014 §2's own wording.
    expect(ctx.sent.length).toBe(1)
    // The next dispatch's attach re-binds the sideband.
    ctx.repl.attach("s1")
    ctx.input.write("rebound\n")
    await tick()
    expect(ctx.sent.length).toBe(2)
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

  // Concurrent asks (plans/0157 D1): doc lanes run several lanes' sessions
  // through this one channel (plans/0099), so a second ask can arrive while
  // one pends. The old fallback — resolve undefined at once — proxy-answered a
  // question the human never saw and journaled a "timeout" that was none; the
  // queue gives every ask its own window, its timer armed at dequeue.
  test("a second ask while one pends joins a FIFO: each ask gets its own window, in order", async () => {
    const ctx = setup()
    repl = ctx.repl
    const first = ctx.repl.question("first question", 1)
    const second = ctx.repl.question("second question", 1)
    ctx.input.write("first answer\n")
    expect(await first).toBe("first answer")
    ctx.input.write("second answer\n")
    expect(await second).toBe("second answer")
  })

  test("a queued ask's timeout is its own: the timer is armed at dequeue, never by the queue's length", async () => {
    const ctx = setup()
    repl = ctx.repl
    const first = ctx.repl.question("first question", 1)
    // 0.005 minutes = 300 ms: the queued ask's own window, short enough to
    // observe; the first ask's minute never fires inside the test.
    const second = ctx.repl.question("second question", 0.005)
    ctx.input.write("first answer\n")
    expect(await first).toBe("first answer")
    // The second ask's window started when it dequeued: it expires on its own
    // timer, a settlement of "timeout" that is one.
    expect(await second).toBeUndefined()
  })

  test("a queued ask behind a hard wait (minutes omitted, the step-mode pause) waits for it, then gets its own window", async () => {
    const ctx = setup()
    repl = ctx.repl
    const first = ctx.repl.question("hard wait", undefined)
    const second = ctx.repl.question("after the pause", 1)
    ctx.input.write("done waiting\n")
    expect(await first).toBe("done waiting")
    ctx.input.write("queued answer\n")
    expect(await second).toBe("queued answer")
  })

  test("close() settles the pending ask, drains the queue, and later asks answer at once", async () => {
    const ctx = setup()
    repl = ctx.repl
    const first = ctx.repl.question("first question", 1)
    const second = ctx.repl.question("second question", 1)
    ctx.repl.close()
    repl = undefined
    expect(await first).toBeUndefined()
    expect(await second).toBeUndefined()
    expect(await ctx.repl.question("past the close", 1)).toBeUndefined()
  })
})

// interactiveChannel — the RunAllOpts.interactive seam's resolver (P3a): the
// boolean keeps the sideband shapes (true = the process terminal, false and
// undefined both off, the exact value preserved so the fleet's options keep
// seeing the boolean they always saw); an injected Interactive is taken as
// is; a function is the io factory, run exactly once at the point the run
// starts the channel.
describe("interactiveChannel (the io/Interactive seam's resolver)", () => {
  test("the boolean values: true = terminal, false/undefined = off with the exact value kept", () => {
    expect(interactiveChannel(true)).toEqual({ kind: "terminal" })
    expect(interactiveChannel(false)).toEqual({ kind: "off", value: false })
    expect(interactiveChannel(undefined)).toEqual({ kind: "off", value: undefined })
  })

  test("an injected Interactive is taken as is; an io factory runs once and its streams become the sideband's io", () => {
    const impl: Interactive = { attach: () => {}, detach: () => {}, question: () => Promise.resolve(undefined), close: () => {} }
    expect(interactiveChannel(impl)).toEqual({ kind: "injected", interactive: impl })
    const input = new PassThrough()
    const output = new Writable({ write: (_chunk, _enc, cb) => cb() })
    let runs = 0
    const channel = interactiveChannel(() => {
      runs++
      return { input, output }
    })
    expect(channel).toEqual({ kind: "io", io: { input, output } })
    expect(runs).toBe(1)
  })
})
