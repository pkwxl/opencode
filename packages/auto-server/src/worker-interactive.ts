// The worker's half of the interactive transport (P3b, auto-core plans/0067
// §四): the Interactive implementation the worker entry constructs from the
// run request's transport payload (the daemon's WS URL and the run secret)
// and injects through RunAllOpts.interactive — the P3a seam (auto-core
// src/interactive.ts's InteractiveOption, `src/loop.ts`'s channel wiring).
// Every human-interaction route the run owns (askHuman's wait, the
// between-tasks pause, the step pauses, the per-session attach) therefore
// arrives here as a typed call, and each becomes a typed, versioned frame on
// the daemon bridge (src/ws-protocol.ts) — the prompt text rides the
// question frame as an opaque payload and is never parsed back for state
// (the direction draft §五 no-scraping rule; assessment risk #2).
//
// The control channel lands on the in-worker seams the assessment verified
// as transport-neutral, exactly as the terminal sideband reaches them
// (auto-core src/interactive.ts's /exit and /failback handlers):
//   exit     → services().control.requestExit() — the run-wide /exit flag,
//              consumed at the next safe boundary into exit 3 with progress
//              persisted (auto-core src/exit.ts:37-42, src/loop.ts);
//   failback → services().router.requestFailback(order) — the pending order
//              the safe boundaries consume (auto-core src/router.ts).
// The ambient holder read is the sideband's own route (interactive is one of
// the SERVICE_ENTRIES); the frames arrive while the run holds the
// installation, which the channel knows from the run's own first attach —
// before that (the starting window) there is no run to control and the
// frame is answered unapplied, never dropped on a holder nobody reads.
//
// Degradation is the contract (the task's scope; auto-core
// src/opts.ts:184-185's never-a-hang rule): transport loss during an open
// question resolves undefined (the run degrades to blocked/exit 2 — or
// auto-continues a pause — never hangs); a question asked while the bridge
// is down waits out a short reconnect grace and degrades the same way; a
// daemon restart that never learns the run again (its registry is
// in-memory) keeps refusing the reconnect and every question degrades. The
// core's own timer discipline is preserved verbatim: the timer arms only
// when minutes is given (auto-core src/interactive.ts:163-191), and minutes
// omitted hard-waits on the answer or the channel's end.
import type { Interactive } from "@opencode-ai/auto-core/control-types"
import { log } from "@opencode-ai/auto-core/log"
import { services } from "@opencode-ai/auto-core/services"
import { encodeFrame, type ControlAction, type FrameBody, type WsFrame } from "./ws-protocol"

// How long a question asked while the bridge is down waits for a reconnect
// before degrading to undefined. Long enough to cover a daemon restart's
// downtime gap, short enough that a hard-wait question (minutes undefined —
// plan's humanQuestions) still degrades in seconds, not forever.
// AUTO-DECISION (5 s): the grace is degradation, not a wait feature — a
// question that cannot reach a client must resolve within a bounded window
// so the run reaches its own exit vocabulary (blocked/2 or auto-continue).
export const RECONNECT_GRACE_MS = 5_000

// The keep-alive cadence over an idle bridge (the question channel can sit
// quiet for minutes; the WS idle timeout would otherwise drop the socket).
const PING_MS = 30_000

// Reconnect backoff: 250 ms doubling to a 2 s cap, forever — the daemon is
// expected back (a restart), and the bridge is cheap to re-attempt.
const backoffOf = (attempt: number): number => Math.min(250 * 2 ** attempt, 2_000)

// The transport payload of a run request (the daemon writes it, the worker
// validates it — src/request.ts): the worker bridge URL (ws://…/runs/<id>/
// worker) and the per-run secret that authenticates the connection.
export type TransportConfig = { url: string; token: string }

type Pending = {
  id: string
  resolve: (answer: string | undefined) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

// One Interactive implementation over the bridge. Constructed by the worker
// entry after the audit log starts (so its lines land in the run's log) and
// closed by the loop's own finally (the channel the run owns).
export function wsInteractive(config: TransportConfig): Interactive {
  const url = `${config.url}?token=${encodeURIComponent(config.token)}`
  const pending = new Map<string, Pending>()
  // The questions the transport itself degraded (a socket loss): their
  // settle frames ride the next open socket, so the daemon's clients learn
  // the asks are gone even across a reconnect.
  const stale: string[] = []
  let socket: WebSocket | undefined
  let attempt = 0
  let closed = false
  // Whether the run is live enough to take control: set by the run's first
  // attach (a session exists ⇒ the services holder is installed —
  // driveRun installs before any session opens), cleared by close().
  let live = false
  let counter = 0
  let sessionID: string | undefined
  let sessionAgent: string | undefined

  const settle = (entry: Pending, answer: string | undefined, how: "answered" | "timeout" | "transport" | "closed"): void => {
    pending.delete(entry.id)
    if (entry.timer) clearTimeout(entry.timer)
    entry.resolve(answer)
    send({ type: "settled", id: entry.id, how })
    if (how !== "answered") stale.push(entry.id)
  }

  const degradeAll = (how: "transport" | "closed"): void => {
    for (const entry of [...pending.values()]) settle(entry, undefined, how)
  }

  // Best-effort send (a down bridge drops the frame; the reconnect logic
  // owns recovery, the callers own the degradation). The client-side
  // WebSocket speaks the browser API (`send`, auto-converted to a text
  // frame for a string) — sendText is the server-side counterpart.
  const send = (frame: FrameBody): void => {
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(encodeFrame(frame))
      } catch {
        // The socket died mid-send; its close handler degrades the pending.
      }
    }
  }

  // —— the control channel ——

  const control = (action: ControlAction, order?: string[]): void => {
    if (action === "failback") {
      // The argument shape the terminal sideband checks at input (the
      // no-registry discipline: provider/model with a slash). Bare internal
      // registry names are refused here — the transport cannot know the
      // registry (the run loads it inside preflight), and an unknown bare
      // name reaching the router would redefine the model order into one
      // that selects nothing; provider/model strings work under every
      // registry, the implicit one included.
      // AUTO-DECISION (slash-only failback order over the transport): the
      // sideband's registry-name branch needs the registry's internal names
      // (startInteractive's modelNames), which the worker entry never
      // holds; raw provider/model is the subset every registry accepts.
      const bad = order?.find((item) => !item.includes("/"))
      if (bad !== undefined) {
        send({ type: "control-done", action, applied: false, reason: `invalid /failback argument: "${bad}" (models must be provider/model with a slash; usage: /failback [primary prov/a candidate prov/b ...])` })
        return
      }
    }
    if (!live) {
      send({ type: "control-done", action, applied: false, reason: "the run has not opened its interactive channel yet (no session attached); retry once the run is running" })
      return
    }
    if (action === "exit") {
      services().control.requestExit()
      log("🚪 /exit received over the transport: will pause and exit at the next safe boundary (phase/task/subtask handover point, or a recovery wait); progress is persisted, re-run to resume exactly")
    } else {
      services().router.requestFailback(order ?? [])
      log(
        order?.length
          ? `⇄ /failback received over the transport: model order will be redefined at the next safe boundary (phase/task/subtask handover point) — primary ${order[0]}, fallback candidates ${order.slice(1).join(", ") || "(none)"}, and the primary will be retried`
          : "⇄ /failback received over the transport: fallback state will be reset at the next safe boundary (phase/task/subtask handover point), retrying the primary model",
      )
    }
    send({ type: "control-done", action, applied: true })
  }

  // —— the socket lifecycle ——

  const onFrame = (frame: WsFrame): void => {
    if (frame.type === "answer") {
      // The race (an answer for an ask that already settled) resolves
      // nothing: the settle frame already told the daemon it is gone.
      const entry = pending.get(frame.id)
      if (entry !== undefined) settle(entry, frame.text, "answered")
      return
    }
    if (frame.type === "control") {
      control(frame.action, frame.order)
      return
    }
    if (frame.type === "ping") {
      send({ type: "pong" })
      return
    }
    if (frame.type === "error") log(`⚠ the interactive bridge refused a frame: ${frame.message}`)
  }

  const connect = (): void => {
    if (closed) return
    const ws = new WebSocket(url)
    ws.onopen = () => {
      attempt = 0
      socket = ws
      // The run's current session first (a client connecting now learns
      // where input would go), then the settles the down bridge owes.
      if (sessionID !== undefined) send({ type: "session", session: sessionID, ...(sessionAgent !== undefined ? { agent: sessionAgent } : {}) })
      while (stale.length) {
        const id = stale.shift()!
        send({ type: "settled", id, how: "transport" })
      }
    }
    ws.onmessage = (event) => {
      try {
        onFrame(JSON.parse(String(event.data)) as WsFrame)
      } catch {
        // A frame that is not JSON cannot be from this protocol's other
        // speaker; nothing to act on. The daemon's own shape-checking is
        // parseFrame's, on its side of the wire.
      }
    }
    ws.onclose = () => {
      // Only the current socket's close proceeds (a stale socket of a
      // superseded attempt closes unnoticed).
      if (ws !== socket) return
      socket = undefined
      // Transport loss during open questions resolves undefined — the
      // never-a-hang contract; the run degrades to its own vocabulary.
      degradeAll("transport")
      if (!closed) {
        const wait = backoffOf(attempt++)
        setTimeout(connect, wait).unref?.()
      }
    }
    ws.onerror = () => {
      // The refusal surface (an unknown run, a bad secret): onclose follows
      // and schedules the retry; a restarted daemon that never learns this
      // run keeps refusing, and every question degrades — by design.
    }
  }
  connect()

  const ping = setInterval(() => send({ type: "ping" }), PING_MS)
  ping.unref?.()

  const openWithin = async (ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (closed) return false
      if (socket !== undefined && socket.readyState === WebSocket.OPEN) return true
      await Bun.sleep(50)
    }
    return socket !== undefined && socket.readyState === WebSocket.OPEN
  }

  return {
    attach(id, agent) {
      sessionID = id
      sessionAgent = agent
      // The first attach is also the run-liveness marker of the control
      // channel: a session exists ⇒ driveRun installed the run's services
      // holder ahead of it (auto-core src/loop.ts: installServices, then
      // the sessions), so a control frame from here on reaches the run's
      // own control/router.
      live = true
      send({ type: "session", session: id, ...(agent !== undefined ? { agent } : {}) })
    },
    async question(promptText, minutes) {
      if (closed) return undefined
      const id = `q${++counter}`
      // The reconnect grace: an ask while the bridge is down waits out the
      // grace (bounded degradation), then settles unanswered — the timer
      // never arms for a question that never reached a client.
      if (!(await openWithin(minutes === undefined ? RECONNECT_GRACE_MS : Math.min(RECONNECT_GRACE_MS, minutes * 60_000)))) {
        return undefined
      }
      send({ type: "question", id, text: promptText, ...(minutes !== undefined ? { minutes } : {}) })
      log(promptText)
      return new Promise<string | undefined>((resolve) => {
        const entry: Pending = { id, resolve, timer: undefined }
        // The timer arms only when minutes is given (auto-core
        // src/interactive.ts:163-191 — omitted minutes hard-waits on the
        // answer or the channel's end).
        if (minutes !== undefined) entry.timer = setTimeout(() => settle(entry, undefined, "timeout"), minutes * 60_000)
        pending.set(id, entry)
      })
    },
    close() {
      if (closed) return
      closed = true
      live = false
      clearInterval(ping)
      degradeAll("closed")
      socket?.close(1000, "run closed")
      socket = undefined
    },
  }
}
