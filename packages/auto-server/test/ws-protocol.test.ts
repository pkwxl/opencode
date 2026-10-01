// The interactive transport's own seams (T-094, P3b): the typed versioned
// frame vocabulary (src/ws-protocol.ts), the daemon-side routing
// (src/interactive-ws.ts) and the worker's Interactive implementation
// (src/worker-interactive.ts), driven here against a stub WebSocket server
// that runs the REAL daemon-side handlers — so the two halves are tested
// against each other, not against doubles of each other. What these cases
// pin:
//   - the wire vocabulary: every frame round-trips through encode/parse
//     with its typed fields intact; a version skew, an unknown type and a
//     misshapen frame are fatal protocol errors an end answers with one
//     error frame and a close;
//   - the daemon-side routing: worker frames fan out to clients, a
//     connecting client is replayed the still-open questions, answers and
//     control flow only with their scope, unknown questions and a missing
//     worker are refused with an error frame (socket stays open), and the
//     bridge's loss settles every open question as a transport loss;
//   - the worker side: a question arrives at the server as a typed frame
//     with the exact prompt text and minutes, an answer resolves it, the
//     ask's own timer resolves undefined on timeout (arming only when
//     minutes is given), transport loss mid-question resolves undefined,
//     an ask while the bridge is down degrades after the reconnect grace,
//     and the control channel maps onto the in-worker seams
//     (Control.requestExit / Router.requestFailback) exactly as the
//     terminal sideband does — unapplied before the run's first attach,
//     applied after it.
// The end-to-end question/exit/failback flows over a real daemon and a real
// worker run live in test/interactive-e2e.test.ts.
import { describe, expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { createServices, installServices, services, uninstallServices } from "@opencode-ai/auto-core/services"
import { createHub, interactiveHandlers, type InteractiveHub, type SocketData } from "../src/interactive-ws"
import type { Scope } from "../src/store"
import { encodeFrame, parseFrame, PROTOCOL_VERSION, type FrameBody, type WsFrame } from "../src/ws-protocol"
import { wsInteractive } from "../src/worker-interactive"
import { wsClient } from "./fixtures/ws"

// —— the wire vocabulary ——

describe("the interactive transport protocol (typed, versioned)", () => {
  const roundTrip = (frame: FrameBody, what: string) => {
    const text = encodeFrame(frame)
    expect((JSON.parse(text) as { v: number }).v, what).toBe(PROTOCOL_VERSION)
    const back = parseFrame(text)
    expect(back.ok, what).toBe(true)
    expect(back.ok && back.frame, what).toStrictEqual({ v: PROTOCOL_VERSION, ...frame })
  }

  test("every frame round-trips with its typed fields and the stamped version", () => {
    roundTrip({ type: "question", id: "q1", text: "⏸ pause between tasks: …" }, "question without minutes")
    roundTrip({ type: "question", id: "q2", text: "enter your answer within 5 minutes …: ", minutes: 5 }, "question with minutes")
    roundTrip({ type: "answer", id: "q1", text: "" }, "the empty answer is a deliberate answer")
    roundTrip({ type: "settled", id: "q1", how: "timeout" }, "settled")
    roundTrip({ type: "session", session: "s_1" }, "session without agent")
    roundTrip({ type: "session", session: "s_2", agent: "claude" }, "session with agent")
    roundTrip({ type: "control", action: "exit" }, "control exit")
    roundTrip({ type: "control", action: "failback" }, "control failback")
    roundTrip({ type: "control", action: "failback", order: ["prov/primary", "prov/backup"] }, "control failback with order")
    roundTrip({ type: "control-done", action: "exit", applied: true }, "control-done applied")
    roundTrip({ type: "control-done", action: "failback", applied: false, reason: "usage" }, "control-done refused")
    roundTrip({ type: "ping" }, "ping")
    roundTrip({ type: "pong" }, "pong")
    roundTrip({ type: "hello", run: "run-000001", state: "running", worker: true }, "hello")
    roundTrip({ type: "error", message: "no open question q9" }, "error")
  })

  test("a version skew, an unknown type and misshapen frames are fatal protocol errors", () => {
    const fatal = (raw: string, pattern: RegExp) => {
      const parsed = parseFrame(raw)
      expect(parsed.ok).toBe(false)
      if (parsed.ok) return
      expect(parsed.fatal).toBe(true)
      expect(parsed.error.type).toBe("error")
      expect(parsed.error.message).toMatch(pattern)
    }
    fatal("{not json", /not valid JSON/)
    fatal("[1,2]", /JSON object/)
    fatal(JSON.stringify({ type: "question", id: "q1" }), /numeric field "v"/)
    fatal(JSON.stringify({ v: 2, type: "ping" }), /version skew.*v2/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "teleport" }), /unknown frame type "teleport"/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "question" }), /string fields "id" and "text"/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "question", id: "q1", text: "x", minutes: "soon" }), /"minutes" is a number/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "settled", id: "q1", how: "whenever" }), /"how"/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "control", action: "selfdestruct" }), /"action"/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "control", action: "failback", order: ["prov/a", ""] }), /"order"/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "hello", run: "run-1", state: "running" }), /"worker"/)
  })
})

// —— the two halves against each other over a stub server ——

// The stub daemon: the real interactiveHandlers over one hub, with the
// upgrade route the daemon proper guards (the run secret, the operator
// scopes) replaced by the test's own simple mapping (?kind=worker scopes a
// client with ?scopes=answer,control). The daemon's own auth refusals are
// pinned in interactive-ws.test.ts against the real startDaemon.
type Stub = {
  hub: InteractiveHub
  url: (path: string) => string
  stop: () => void
  untilWorker: () => Promise<ServerWebSocket<SocketData>>
}

async function stubServer(): Promise<Stub> {
  const hub = createHub("stub-secret")
  const server = Bun.serve<SocketData>({
    port: 0,
    fetch(request, srv) {
      const url = new URL(request.url)
      if (url.pathname === "/worker" || url.pathname === "/client") {
        const data: SocketData =
          url.pathname === "/worker"
            ? { kind: "worker", run: "run-000001" }
            : { kind: "client", run: "run-000001", scopes: (url.searchParams.get("scopes") ?? "").split(",").filter(Boolean) as Scope[] }
        if (srv.upgrade(request, { data })) return new Response(null)
        return new Response("upgrade failed", { status: 400 })
      }
      return new Response("not found", { status: 404 })
    },
    websocket: interactiveHandlers({ hubOf: () => hub, stateOf: () => "running" }),
  })
  const untilWorker = async (): Promise<ServerWebSocket<SocketData>> => {
    const deadline = Date.now() + 5_000
    while (hub.worker === undefined) {
      if (Date.now() > deadline) throw new Error("the worker socket never connected")
      await Bun.sleep(20)
    }
    return hub.worker
  }
  return { hub, url: (path) => `ws://127.0.0.1:${server.port}${path}`, stop: () => server.stop(true), untilWorker }
}

describe("the daemon-side routing (interactiveHandlers over one hub)", () => {
  test("worker frames fan out to clients; a connecting client is replayed the still-open questions; settled clears the replay", async () => {
    const stub = await stubServer()
    const watcher = wsClient(stub.url("/client?scopes=answer,control"))
    try {
      await watcher.opened
      expect(watcher.frames[0]).toMatchObject({ type: "hello", run: "run-000001", state: "running", worker: false })
      // A late joiner sees the questions it came to answer: the worker
      // raises two, the second client connects and is replayed both.
      const worker = wsClient(stub.url("/worker"))
      await worker.opened
      await worker.nextOf((frame) => frame.type === "hello" && frame.worker, "the worker's hello")
      worker.send({ type: "question", id: "q1", text: "first ask" })
      worker.send({ type: "question", id: "q2", text: "second ask", minutes: 5 })
      await watcher.nextOf((frame) => frame.type === "question" && frame.id === "q2", "both questions fanned out")
      expect(watcher.frames.filter((frame) => frame.type === "question").map((frame) => (frame as { id: string }).id)).toEqual(["q1", "q2"])
      const late = wsClient(stub.url("/client?scopes=answer"))
      const replayed = await late.nextOf((frame) => frame.type === "question" && frame.id === "q2", "the replay reaches the late joiner")
      expect(replayed).toMatchObject({ type: "question", id: "q2", text: "second ask", minutes: 5 })
      // A settle leaves the replay: the next joiner sees only what is open.
      worker.send({ type: "settled", id: "q1", how: "answered" })
      await late.nextOf((frame) => frame.type === "settled" && frame.id === "q1", "the settle fans out")
      const last = wsClient(stub.url("/client?scopes=answer"))
      await last.nextOf((frame) => frame.type === "question" && frame.id === "q2", "the replay after the settle")
      expect(last.frames.filter((frame) => frame.type === "question").map((frame) => (frame as { id: string }).id)).toEqual(["q2"])
      // The informational frames ride the same fan-out.
      worker.send({ type: "session", session: "s_lead", agent: "claude" })
      await watcher.nextOf((frame) => frame.type === "session" && frame.session === "s_lead", "the session frame fans out")
      await Promise.all([watcher.close(), late.close(), last.close(), worker.close()])
    } finally {
      await watcher.close().catch(() => {})
      stub.stop()
    }
  })

  test("answers and control need their scope; unknown questions and a missing worker are refused by an error frame that keeps the socket open", async () => {
    const stub = await stubServer()
    const answerOnly = wsClient(stub.url("/client?scopes=answer"))
    try {
      await answerOnly.opened
      // The worker is not connected yet: an answer for an unknown question
      // and a control are both refused, each naming the reason, and neither
      // closes the socket.
      answerOnly.send({ type: "answer", id: "qX", text: "late" })
      const unknown = await answerOnly.nextOf((frame) => frame.type === "error" && frame.message.includes("qX"), "the unknown-question refusal")
      expect(unknown.type).toBe("error")
      if (unknown.type === "error") expect(unknown.message).toContain("no open question qX")
      answerOnly.send({ type: "control", action: "exit" })
      const scope = await answerOnly.nextOf((frame) => frame.type === "error" && frame.message.includes('"control" scope'), "the control scope refusal")
      if (scope.type === "error") expect(scope.message).toContain('requires the "control" scope')
      // A client of the control tier gets the mirror refusal on answers.
      const controlOnly = wsClient(stub.url("/client?scopes=control"))
      await controlOnly.opened
      controlOnly.send({ type: "answer", id: "qX", text: "no" })
      const answerScope = await controlOnly.nextOf((frame) => frame.type === "error" && frame.message.includes('"answer" scope'), "the answer scope refusal")
      if (answerScope.type === "error") expect(answerScope.message).toContain('requires the "answer" scope')
      await controlOnly.close()
      // With the worker connected: a known question's answer is forwarded
      // verbatim, an unknown one is refused (the replay lists the open
      // ones), and a spoofed worker frame from a client is refused too.
      const worker = wsClient(stub.url("/worker"))
      await worker.opened
      worker.send({ type: "question", id: "q1", text: "the ask" })
      await answerOnly.nextOf((frame) => frame.type === "question" && frame.id === "q1", "the ask fanned out")
      answerOnly.send({ type: "answer", id: "q9", text: "?" })
      const gone = await answerOnly.nextOf((frame) => frame.type === "error" && frame.message.includes("no open question q9"), "the unknown-question refusal")
      if (gone.type === "error") expect(gone.message).toContain("no open question q9")
      answerOnly.send({ type: "answer", id: "q1", text: "the answer" })
      const forwarded = await worker.nextOf((frame) => frame.type === "answer" && frame.id === "q1", "the answer forwarded to the worker")
      expect(forwarded).toMatchObject({ type: "answer", id: "q1", text: "the answer" })
      answerOnly.send({ type: "question", id: "q2", text: "spoofed" })
      const spoof = await answerOnly.nextOf((frame) => frame.type === "error" && frame.message.includes("client socket"), "the spoofed-worker refusal")
      if (spoof.type === "error") expect(spoof.message).toContain("does not take")
      // A fatal protocol error closes the socket: the version skew a stale
      // speaker would bring.
      answerOnly.ws.send(JSON.stringify({ v: 99, type: "ping" }))
      const skew = await answerOnly.nextOf((frame) => frame.type === "error" && frame.message.includes("version skew"), "the version-skew error frame")
      if (skew.type === "error") expect(skew.message).toContain("version skew")
      await answerOnly.dropped
      await worker.close()
    } finally {
      await answerOnly.close().catch(() => {})
      stub.stop()
    }
  })

  test("control reaches the worker; the bridge's loss settles every open question as a transport loss", async () => {
    const stub = await stubServer()
    const control = wsClient(stub.url("/client?scopes=control"))
    const worker = wsClient(stub.url("/worker"))
    try {
      await Promise.all([control.opened, worker.opened])
      control.send({ type: "control", action: "exit" })
      const exit = await worker.nextOf((frame) => frame.type === "control" && frame.action === "exit", "the exit control forwarded")
      expect(exit).toMatchObject({ type: "control", action: "exit" })
      control.send({ type: "control", action: "failback", order: ["prov/a", "prov/b"] })
      const failback = await worker.nextOf((frame) => frame.type === "control" && frame.action === "failback", "the failback control forwarded")
      expect(failback).toMatchObject({ type: "control", action: "failback", order: ["prov/a", "prov/b"] })
      // The worker answers control-done; every client hears the outcome.
      worker.send({ type: "control-done", action: "exit", applied: true })
      await control.nextOf((frame) => frame.type === "control-done" && frame.action === "exit", "the control outcome fanned out")
      // Two open questions, the bridge dies: both settle as transport
      // losses for the clients.
      worker.send({ type: "question", id: "q1", text: "one" })
      worker.send({ type: "question", id: "q2", text: "two" })
      await control.nextOf((frame) => frame.type === "question" && frame.id === "q2", "both asks fanned out")
      await worker.close()
      const settled1 = await control.nextOf((frame) => frame.type === "settled" && frame.id === "q1", "the first transport settle")
      expect(settled1).toMatchObject({ type: "settled", id: "q1", how: "transport" })
      await control.nextOf((frame) => frame.type === "settled" && frame.id === "q2", "the second transport settle")
      expect(stub.hub.worker).toBeUndefined()
      expect(stub.hub.questions.size).toBe(0)
      // A reconnecting worker answers hello again (the bridge re-opens).
      const again = wsClient(stub.url("/worker"))
      await again.opened
      const hello = await again.nextOf((frame) => frame.type === "hello", "the reconnected worker's hello")
      expect(hello).toMatchObject({ type: "hello", worker: true })
      await again.close()
    } finally {
      await control.close().catch(() => {})
      await worker.close().catch(() => {})
      stub.stop()
    }
  })
})

// —— the worker's Interactive implementation ——

describe("the worker transport (wsInteractive over the real handlers)", () => {
  test("a question arrives as a typed frame with the exact text and minutes; an answer resolves it; the settle rides back", async () => {
    const stub = await stubServer()
    const watcher = wsClient(stub.url("/client?scopes=answer"))
    const impl = wsInteractive({ url: stub.url("/worker"), token: "stub-secret" })
    try {
      await watcher.opened
      // The minutes ride the typed call verbatim (the P3a seam's recorded
      // shape), and the prompt text is an opaque payload on the wire.
      const ask = impl.question("⏸ pause between tasks: press Enter to start T-002 now, or wait 1m to auto-continue: ", 1)
      const frame = await watcher.nextOf((f) => f.type === "question", "the ask fanned out")
      expect(frame).toMatchObject({ type: "question", text: "⏸ pause between tasks: press Enter to start T-002 now, or wait 1m to auto-continue: ", minutes: 1 })
      watcher.send({ type: "answer", id: (frame as { id: string }).id, text: "" })
      await expect(ask).resolves.toBe("")
      await watcher.nextOf((f) => f.type === "settled" && f.how === "answered", "the answered settle")
      // A second ask without minutes: the hard wait, resolved by an answer.
      const hard = impl.question("enter your answer (Enter to confirm, no timeout and no automatic answer under plan): ")
      const hardFrame = await watcher.nextOf((f) => f.type === "question" && !("minutes" in f), "the hard ask")
      expect(hardFrame.type).toBe("question")
      watcher.send({ type: "answer", id: (hardFrame as { id: string }).id, text: "sqlite, the embedded one" })
      await expect(hard).resolves.toBe("sqlite, the embedded one")
    } finally {
      await watcher.close().catch(() => {})
      impl.close()
      stub.stop()
    }
  })

  test("the ask's own timer resolves undefined on timeout; transport loss mid-question resolves undefined; an ask while down degrades after the grace", async () => {
    const stub = await stubServer()
    const watcher = wsClient(stub.url("/client?scopes=answer"))
    const impl = wsInteractive({ url: stub.url("/worker"), token: "stub-secret" })
    try {
      await watcher.opened
      // minutes is fractional in minutes: 0.03 = 1.8 s — the timer arms
      // only when minutes is given, exactly the sideband's semantics.
      const timed = impl.question("enter your answer within 0.03 minutes: ", 0.03)
      const asked = await watcher.nextOf((f) => f.type === "question", "the timed ask")
      expect((asked as { minutes?: number }).minutes).toBe(0.03)
      await expect(timed).resolves.toBeUndefined()
      await watcher.nextOf((f) => f.type === "settled" && f.how === "timeout", "the timeout settle")
      // Transport loss during an open question: the ask resolves undefined
      // at once (never a hang), and the client is told the same.
      const open = impl.question("enter your answer (Enter to confirm, hard wait): ")
      const openAsk = await watcher.nextOf((f) => f.type === "question" && f.text.includes("hard wait"), "the open ask")
      expect((openAsk as { id: string }).id).not.toBe((asked as { id: string }).id)
      stub.stop()
      await expect(open).resolves.toBeUndefined()
      impl.close()
      // With the bridge gone, a fresh ask waits out the reconnect grace
      // (5 s) and degrades — the run reaches its own vocabulary.
      const degraded = wsInteractive({ url: stub.url("/worker"), token: "stub-secret" })
      const started = Date.now()
      await expect(degraded.question("which storage? ", 5)).resolves.toBeUndefined()
      expect(Date.now() - started).toBeGreaterThanOrEqual(4_000)
      degraded.close()
    } finally {
      await watcher.close().catch(() => {})
      impl.close()
      stub.stop()
    }
  }, 20_000)

  test("the control channel maps onto the in-worker seams: unapplied before the run's first attach, applied after it, malformed failback refused", async () => {
    const stub = await stubServer()
    const watcher = wsClient(stub.url("/client?scopes=answer,control"))
    const impl = wsInteractive({ url: stub.url("/worker"), token: "stub-secret" })
    // The run's own services holder, installed the way driveRun installs
    // it — the holder the ambient accessor hands the transport.
    installServices(createServices())
    let worker: ServerWebSocket<SocketData> | undefined
    try {
      await watcher.opened
      worker = await stub.untilWorker()
      // Before the run attaches a session there is no run to control: the
      // frame is answered unapplied, never dropped on an orphan holder.
      worker.sendText(encodeFrame({ type: "control", action: "exit" }))
      let outcome = await watcher.nextOf((f) => f.type === "control-done" && f.action === "exit", "the pre-attach refusal")
      expect(outcome).toMatchObject({ type: "control-done", action: "exit", applied: false })
      if (outcome.type === "control-done") expect(outcome.reason).toContain("has not opened its interactive channel yet")
      // The run attaches (attempt.ts's per-dispatch route) — from here the
      // frames reach the run's own control and router services.
      impl.attach("s_lead", "claude")
      await watcher.nextOf((f) => f.type === "session" && f.session === "s_lead", "the attach fanned out")
      worker.sendText(encodeFrame({ type: "control", action: "exit" }))
      outcome = await watcher.nextOf((f) => f.type === "control-done" && f.action === "exit" && f.applied, "the exit applied")
      expect(outcome).toMatchObject({ type: "control-done", action: "exit", applied: true })
      expect(services().control.exitRequested()).toBe(true)
      // A malformed failback order is refused with the sideband's own usage
      // discipline; a well-formed one reaches the router.
      worker.sendText(encodeFrame({ type: "control", action: "failback", order: ["not-a-model"] }))
      outcome = await watcher.nextOf((f) => f.type === "control-done" && f.action === "failback" && !f.applied, "the malformed failback refused")
      if (outcome.type === "control-done") expect(outcome.reason).toContain("invalid /failback argument")
      expect(services().router.failbackRequested()).toBe(false)
      worker.sendText(encodeFrame({ type: "control", action: "failback" }))
      await watcher.nextOf((f) => f.type === "control-done" && f.action === "failback" && f.applied, "the plain failback applied")
      expect(services().router.failbackRequested()).toBe(true)
      worker.sendText(encodeFrame({ type: "control", action: "failback", order: ["prov/primary"] }))
      await watcher.nextOf((f) => f.type === "control-done" && f.action === "failback" && f.applied, "the ordered failback applied")
      expect(services().router.failbackRequested()).toBe(true)
    } finally {
      impl.close()
      uninstallServices()
      await watcher.close().catch(() => {})
      stub.stop()
    }
  })
})
