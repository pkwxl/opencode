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
// The daemon owns no interactive state beyond this routing: the hub holds
// the run secret, the connected sockets and the still-open questions (for
// the replay a connecting client receives), lives beside the in-memory run
// registry in this process, and dies with it — a daemon restart drops the
// bridge, the worker's transport degrades every open question to undefined
// (the never-a-hang contract), and its reconnect is refused until a run of
// the new registry connects again (404: the restarted daemon does not know
// the run; inventing one is not the registry's to do).
import type { ServerWebSocket } from "bun"
import type { Scope } from "./store"
import { encodeFrame, parseFrame, type FrameBody, type WsFrame } from "./ws-protocol"

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
export type InteractiveContext = {
  hubOf: (run: string) => InteractiveHub | undefined
  stateOf: (run: string) => string | undefined
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
        case "question":
          hub.questions.set(frame.id, { id: frame.id, text: frame.text, ...(frame.minutes !== undefined ? { minutes: frame.minutes } : {}), at: Date.now() })
          broadcast(hub, frame)
          return
        case "settled":
          // Idempotent: a settle for an id the worker's own socket loss (or
          // a replacement) already cleared is simply dropped.
          hub.questions.delete(frame.id)
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
      // transport loss for the clients (the worker resolves its own pending
      // asks undefined the same way — both ends degrade, never hang). A
      // reconnecting worker re-opens the flow; these ids are gone.
      for (const id of hub.questions.keys()) broadcast(hub, { type: "settled", id, how: "transport" })
      hub.questions.clear()
      return
    }
    hub.clients.delete(ws)
  }

  return { open, message, close }
}
