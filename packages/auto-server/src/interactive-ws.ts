// The daemon's WebSocket interactive surface (P3b, auto-core plans/0067 §四):
// one client endpoint per run (`GET /runs/<id>/interactive`, upgraded) that
// multiplexes the question channel and the control channel, plus the worker
// bridge endpoint (`GET /runs/<id>/worker`, the run secret the daemon handed
// the worker in its spawn payload) the worker's injected Interactive
// implementation (src/worker-interactive.ts) connects back on. This module
// is the routing between the two: worker frames fan out to the clients,
// client frames are checked against their token's scopes and forwarded to
// the worker. The vocabulary on the wire is src/ws-protocol.ts's typed,
// versioned frames — never prose parsed back for state (the direction
// draft §五 no-scraping rule; a question's text is an opaque payload, and
// the question's lifecycle belongs to the P2 event stream the status-events
// channel already serves).
//
// The daemon's interactive state is this routing plus, since P3c, the
// pending-question journal (src/question-journal.ts): the hub holds the run
// secret, the connected sockets and the still-open questions (the replay a
// connecting client receives), and every durable settlement is journaled —
// the worker's own settled frames and the run's terminal retire — so a
// restarted daemon rebuilds the pending set from the journal (the runs it
// restores) and redelivers it. A bridge-socket loss settles the open
// questions for the CLIENTS as a transport loss but journals nothing: the
// worker holds a hard-wait ask across the loss (its reconnect grace,
// src/worker-interactive.ts) and re-raises it on reconnect, so the loss is
// not a settlement — the question's durable lifecycle stays with the worker
// and the P2b event stream.
import type { ServerWebSocket } from "bun"
import type { Scope } from "./store"
import { encodeFrame, parseFrame, type FrameBody, type Settlement, type WsFrame } from "./ws-protocol"

// What each socket is, stamped at upgrade time (the auth the daemon did
// before accepting the connection): the worker of the run (the run secret
// presented as ?token=) or a client (an operator token, with the scopes that
// token carries — the scope checks on the frames below read this, never the
// wire again).
export type SocketData = { kind: "worker"; run: string } | { kind: "client"; run: string; scopes: Scope[] }

// A question still open on the worker, as the daemon knows it for the replay
// a connecting client receives (the frame fields plus the arrival instant).
export type OpenQuestion = { id: string; text: string; minutes?: number; at: number }

// One run's interactive hub, created at spawn (with the secret the payload
// carries) and found by run id by both upgrade routes.
export type InteractiveHub = {
  secret: string
  worker: ServerWebSocket<SocketData> | undefined
  clients: Set<ServerWebSocket<SocketData>>
  questions: Map<string, OpenQuestion>
}

// The per-run secret the daemon hands its worker (`oar_` + 24 random bytes,
// base64url — the store's token shape, daemon-local randomness; it is never
// stored, only held here and compared at upgrade).
export function freshRunSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `oar_${Buffer.from(bytes).toString("base64url")}`
}

export function createHub(secret: string): InteractiveHub {
  return { secret, worker: undefined, clients: new Set(), questions: new Map() }
}

// Best-effort send to one socket (a socket that just died answers the
// throw; its close handler does the bookkeeping).
const send = (socket: ServerWebSocket<SocketData>, frame: FrameBody): void => {
  try {
    socket.sendText(encodeFrame(frame))
  } catch {
    // Gone; the close event cleans up.
  }
}

// Fan a frame out to every connected client of the run.
const broadcast = (hub: InteractiveHub, frame: FrameBody): void => {
  for (const client of hub.clients) send(client, frame)
}

// One protocol error: the error frame, then the socket closes (the refusal
// pair from parseFrame already decided this is fatal — a version skew or a
// frame this end cannot shape-check).
const protocolError = (socket: ServerWebSocket<SocketData>, error: WsFrame): void => {
  send(socket, error)
  socket.close(1002, "protocol error")
}

// What the handlers need from the daemon: the hub of a run (undefined when
// the run is unknown — the registry is the authority) and the run's registry
// state (for the hello frames; undefined names an unknown run the same way).
// Since P3c the two journal hooks make the queue durable: `onRaise` when the
// daemon first holds an ask (a re-raise of an id the hub still holds writes
// nothing — the fold is idempotent), `onSettle` for every durable settlement
// (the worker's own settled frame, whatever its word, and the daemon's
// run-terminal retire). Absent hooks serve an in-memory-only hub — the stub
// servers of the tests, or any embedder that opts out of persistence.
export type InteractiveContext = {
  hubOf: (run: string) => InteractiveHub | undefined
  stateOf: (run: string) => string | undefined
  onRaise?: (run: string, question: OpenQuestion) => void
  onSettle?: (run: string, id: string, how: Settlement) => void
}

// The open-question replay a client receives after its hello: every question
// still open, in arrival order — a reconnecting client re-sees the ask it
// came to answer (this is the transport's own correlation flow; the durable
// lifecycle is the P2 event stream's).
function replay(hub: InteractiveHub, client: ServerWebSocket<SocketData>): void {
  for (const question of hub.questions.values()) {
    send(client, { type: "question", id: question.id, text: question.text, ...(question.minutes !== undefined ? { minutes: question.minutes } : {}) })
  }
}

// Settle every open question of a hub for the clients (`how` names the
// transport-level event) and clear them from the replay. The CALLER owns
// durability: a bridge-socket loss settles `transport` in memory only (the
// worker may still hold the asks and re-raise them on reconnect), while a
// run's terminal retire settles `closed` and journals each id. Returns the
// ids cleared, in arrival order.
export function settleOpenQuestions(hub: InteractiveHub, how: Settlement): string[] {
  const ids = [...hub.questions.keys()]
  for (const id of ids) broadcast(hub, { type: "settled", id, how })
  hub.questions.clear()
  return ids
}

// The websocket handlers of Bun.serve (one set for the whole server; every
// socket's data says which run and role it is).
export function interactiveHandlers(ctx: InteractiveContext) {
  const helloOf = (hub: InteractiveHub, run: string): FrameBody => ({ type: "hello", run, state: ctx.stateOf(run) ?? "unknown", worker: hub.worker !== undefined })

  const open = (ws: ServerWebSocket<SocketData>): void => {
    const hub = ctx.hubOf(ws.data.run)
    if (hub === undefined) {
      // The run left the registry between upgrade and open (a daemon
      // teardown race); nothing to route to.
      send(ws, { type: "error", message: `run ${ws.data.run} is not in this daemon's registry` })
      ws.close(1008, "unknown run")
      return
    }
    if (ws.data.kind === "worker") {
      // One worker socket per run: a second connection replaces the first —
      // the registry refuses a second spawn, so a live predecessor here is a
      // half-dead socket of the same worker (its close handler is a no-op
      // once replaced).
      if (hub.worker !== undefined && hub.worker !== ws) {
        send(hub.worker, { type: "error", message: "replaced by a new worker connection for this run" })
        hub.worker.close(1000, "replaced")
      }
      hub.worker = ws
      send(ws, helloOf(hub, ws.data.run))
      return
    }
    hub.clients.add(ws)
    send(ws, helloOf(hub, ws.data.run))
    replay(hub, ws)
  }

  const refuse = (ws: ServerWebSocket<SocketData>, message: string): void => send(ws, { type: "error", message })

  const message = (ws: ServerWebSocket<SocketData>, raw: string | Buffer): void => {
    const hub = ctx.hubOf(ws.data.run)
    if (hub === undefined) {
      refuse(ws, `run ${ws.data.run} is not in this daemon's registry`)
      return
    }
    const parsed = parseFrame(String(raw))
    if (!parsed.ok) {
      protocolError(ws, parsed.error)
      return
    }
    const frame = parsed.frame
    if (ws.data.kind === "worker") {
      switch (frame.type) {
        case "question": {
          // A re-raise (the worker's reconnect after a bridge loss — its
          // still-held asks ride the fresh socket) journals only when the
          // hub had cleared the id; the fold is idempotent either way.
          if (!hub.questions.has(frame.id)) {
            ctx.onRaise?.(ws.data.run, { id: frame.id, text: frame.text, ...(frame.minutes !== undefined ? { minutes: frame.minutes } : {}), at: Date.now() })
          }
          hub.questions.set(frame.id, { id: frame.id, text: frame.text, ...(frame.minutes !== undefined ? { minutes: frame.minutes } : {}), at: Date.now() })
          broadcast(hub, frame)
          return
        }
        case "settled":
          // The worker's own word is durable whatever it says — answered,
          // its own timeout, a transport degradation it already decided, or
          // the run closing its channel. Idempotent in memory: a settle for
          // an id a bridge loss already cleared simply re-clears.
          hub.questions.delete(frame.id)
          ctx.onSettle?.(ws.data.run, frame.id, frame.how)
          broadcast(hub, frame)
          return
        case "session":
        case "control-done":
          broadcast(hub, frame)
          return
        case "ping":
          send(ws, { type: "pong" })
          return
        default:
          refuse(ws, `the worker bridge does not take "${frame.type}" frames`)
          return
      }
    }
    // The client half. Scope first (the token's tiers, captured at upgrade):
    // `answer` guards the question channel, `control` the control channel —
    // the same words the REST surface uses, checked per frame so one socket
    // can carry a token of either tier without license for the other.
    switch (frame.type) {
      case "answer": {
        if (!ws.data.scopes.includes("answer")) {
          refuse(ws, `answering a question requires the "answer" scope; this token carries: ${ws.data.scopes.join(", ")}`)
          return
        }
        if (!hub.questions.has(frame.id)) {
          refuse(ws, `no open question ${frame.id} on run ${ws.data.run} (a settled question cannot be answered; the replay after reconnect lists the open ones)`)
          return
        }
        if (hub.worker === undefined) {
          refuse(ws, `run ${ws.data.run}'s worker bridge is not connected (the worker may not have started, or its transport is down); retry once it reconnects`)
          return
        }
        send(hub.worker, frame)
        return
      }
      case "control": {
        if (!ws.data.scopes.includes("control")) {
          refuse(ws, `run control requires the "control" scope; this token carries: ${ws.data.scopes.join(", ")}`)
          return
        }
        if (hub.worker === undefined) {
          refuse(ws, `run ${ws.data.run}'s worker bridge is not connected (the worker may not have started, or its transport is down); retry once it reconnects`)
          return
        }
        send(hub.worker, frame)
        return
      }
      case "ping":
        send(ws, { type: "pong" })
        return
      default:
        refuse(ws, `a client socket does not take "${frame.type}" frames (the worker bridge sends those)`)
        return
    }
  }

  const close = (ws: ServerWebSocket<SocketData>): void => {
    const hub = ctx.hubOf(ws.data.run)
    if (hub === undefined) return
    if (ws.data.kind === "worker") {
      if (hub.worker !== ws) return
      hub.worker = undefined
      // The bridge is gone: every still-open question settles as a
      // transport loss for the clients (in memory only — the worker may
      // still hold a hard-wait ask across the loss and re-raise it on its
      // reconnect, so this is not a durable settlement; the journal keeps
      // the ask open for a restarted daemon to redeliver). Both ends
      // degrade, never hang: the worker resolves its own pending asks
      // undefined once its reconnect grace runs out.
      settleOpenQuestions(hub, "transport")
      return
    }
    hub.clients.delete(ws)
  }

  return { open, message, close }
}
