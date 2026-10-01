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
// src/opts.ts:184-185's never-a-hang rule): the timer arms only when minutes
// is given (auto-core src/interactive.ts:163-191), and minutes omitted
// hard-waits on the answer or the channel's end. A bridge loss does NOT
// resolve the open asks at once (P3c): the worker blocks inside question()
// exactly as askHuman with minutes === undefined does, holding every ask
// across the loss while the daemon may come back — a restart, the case the
// persistent queue exists for. The bound is the reconnect grace (the same
// 5 s window an ask raised while down waits out): a bridge that has not
// returned by its end degrades every still-pending ask (undefined — the run
// reaches blocked/exit 2, or the configured fallback — never a hang), and a
// daemon that never learns the run again (nothing journaled, its reconnect
// refused with 404) degrades the same way. On a reconnect the still-held
// asks are RE-RAISED on the fresh socket (after the session frame and the
// settles the down bridge owes), so the daemon's hub regains them whether
// or not its journal replay already held them — the two halves of the
// reconstruction, the journal and the worker's still-blocking state, meet.
import type { Interactive } from "@opencode-ai/auto-core/control-types"
import { log } from "@opencode-ai/auto-core/log"
import { services } from "@opencode-ai/auto-core/services"
import { encodeFrame, type ControlAction, type FrameBody, type WsFrame } from "./ws-protocol"

// How long the bridge has to come back after a loss (or to appear for an
// ask raised while it is down) before every still-pending ask degrades to
// undefined. Long enough to cover a daemon restart's downtime gap, short
// enough that even a hard-wait ask (minutes undefined — plan's
// humanQuestions) degrades in seconds, not forever.
// AUTO-DECISION (5 s, now the loss grace too): T-094 resolved an open ask
// the instant its socket dropped; P3c holds it across the drop for the same
// window a down bridge gets — a restart is the expected reason for a loss,
// and the queue's whole point is that the ask survives it. The window stays
// degradation, not a wait feature: past it the run reaches its own exit
// vocabulary.
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
  // The ask's own payload, held for the re-raise a reconnect sends (the
  // worker's half of the restart reconstruction).
  text: string
  minutes: number | undefined
  resolve: (answer: string | undefined) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

// One Interactive implementation over the bridge. Constructed by the worker
// entry after the audit log starts (so its lines land in the run's log) and
// closed by the loop's own finally (the channel the run owns).
export function wsInteractive(config: TransportConfig): Interactive {
  const url = `${config.url}?token=${encodeURIComponent(config.token)}`
  const pending = new Map<string, Pending>()
  // The questions the transport itself degraded (a socket loss whose grace
  // ran out): their settle frames ride the next open socket, so the
  // daemon's clients — and its journal — learn the asks are gone even
  // across a reconnect.
  const stale: Array<{ id: string; how: "timeout" | "transport" | "closed" }> = []
  let socket: WebSocket | undefined
  // The loss grace: armed when the bridge drops with asks still pending,
  // cancelled by any reconnect. REF'd deliberately — a hard-wait ask has no
  // timer of its own, and the grace is what holds the process (and bounds
  // the wait) while no socket does.
  let grace: ReturnType<typeof setTimeout> | undefined
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
    if (how !== "answered") stale.push({ id: entry.id, how })
  }

  const degradeAll = (how: "transport" | "closed" | "timeout"): void => {
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
      // The loss grace is satisfied: every still-held ask stays pending.
      if (grace !== undefined) {
        clearTimeout(grace)
        grace = undefined
      }
      // The run's current session first (a client connecting now learns
      // where input would go), then the settles the down bridge owes, then
      // the still-held asks RE-RAISED — the worker's half of the restart
      // reconstruction: whether or not the daemon's journal replay already
      // holds them (idempotent on the hub by frame id), the fresh socket
      // re-states them, so a client connecting after a loss re-sees the
      // ask it came to answer.
      if (sessionID !== undefined) send({ type: "session", session: sessionID, ...(sessionAgent !== undefined ? { agent: sessionAgent } : {}) })
      while (stale.length) {
        const owed = stale.shift()!
        send({ type: "settled", id: owed.id, how: owed.how })
      }
      for (const entry of pending.values()) {
        send({ type: "question", id: entry.id, text: entry.text, ...(entry.minutes !== undefined ? { minutes: entry.minutes } : {}) })
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
      // Transport loss with asks open holds them for the reconnect grace —
      // a daemon restart is the expected reason, and the persistent queue
      // exists so the ask survives it. Past the grace the asks degrade
      // (undefined — the run reaches its own vocabulary, never a hang) and
      // their settles ride the next socket if one ever comes.
      if (pending.size && grace === undefined) {
        grace = setTimeout(() => {
          grace = undefined
          if (socket === undefined || socket.readyState !== WebSocket.OPEN) degradeAll("timeout")
        }, RECONNECT_GRACE_MS)
      }
      if (!closed) {
        const wait = backoffOf(attempt++)
        setTimeout(connect, wait).unref?.()
      }
    }
    ws.onerror = () => {
      // The refusal surface (an unknown run, a bad secret): onclose follows
      // and schedules the retry; a daemon that keeps refusing this run
      // leaves the grace to bound every open ask — by design.
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
        const entry: Pending = { id, text: promptText, minutes, resolve, timer: undefined }
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
      if (grace !== undefined) {
        clearTimeout(grace)
        grace = undefined
      }
      degradeAll("closed")
      socket?.close(1000, "run closed")
      socket = undefined
    },
  }
}
