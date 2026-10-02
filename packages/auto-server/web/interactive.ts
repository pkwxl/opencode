// The Web client's half of the interactive transport (P4a over P3b/P3c): one
// WebSocket to the daemon's /runs/<id>/interactive endpoint, speaking the
// same typed versioned frames the daemon and the worker speak — imported
// from the protocol module itself (../src/ws-protocol: one module, three
// speakers, no drift; pure types and functions, bundled in by the build).
//
// What this session keeps is the pending-question view (the P3c queue's
// client side): every `question` frame lands in the pending map keyed by its
// id, every `settled` frame leaves it, and a reconnect (the daemon's own
// replay) re-delivers the still-open asks — idempotent by id, so redelivery
// after a blip is the design working, not a duplicate. The question `text`
// is an opaque payload rendered verbatim, never parsed for state; the
// CONTROL channel carries the graceful pause (`exit`) and failback, mapped
// by the daemon onto the run's own control surface.
//
// No DOM dependency (the WebSocket is a web standard Bun implements), so the
// served smoke test drives this exact class against a live daemon.
import { encodeFrame, parseFrame, type ControlAction, type FrameBody, type WsFrame } from "../src/ws-protocol"

export type PendingQuestion = { id: string; text: string; minutes?: number; at: number }

export type InteractiveEvents = {
  /** The connect frame (and every reconnect's): the run id, state, bridge presence. */
  onHello?: (hello: WsFrame & { type: "hello" }) => void
  onQuestion?: (question: PendingQuestion, redelivered: boolean) => void
  onSettled?: (id: string, how: string) => void
  onControlDone?: (action: ControlAction, applied: boolean, reason?: string) => void
  /** An informational refusal (scope miss, unknown question, no bridge): the socket stays open. */
  onError?: (message: string) => void
  onSession?: (session: string, agent?: string) => void
  onState?: (state: InteractiveSessionState) => void
}

export type InteractiveSessionState = "idle" | "connecting" | "open" | "retrying" | "closed"

export type InteractiveSessionOptions = {
  reconnectMs?: number
  maxReconnectMs?: number
}

// The question channel and the control channel on one socket. The caller
// gates what it offers the human on the token's scopes (the socket's frames
// are scope-checked by the daemon per frame — a control-only token's answer
// is refused there, and an answer-only token's control too).
export class InteractiveSession {
  private readonly url: string
  private readonly events: InteractiveEvents
  private readonly reconnectMs: number
  private readonly maxReconnectMs: number
  private socket: WebSocket | undefined
  private stopped = false
  private stateValue: InteractiveSessionState = "idle"
  private readonly questions = new Map<string, PendingQuestion>()

  constructor(url: string, events: InteractiveEvents = {}, options: InteractiveSessionOptions = {}) {
    this.url = url
    this.events = events
    this.reconnectMs = options.reconnectMs ?? 1000
    this.maxReconnectMs = options.maxReconnectMs ?? 8000
  }

  get state(): InteractiveSessionState {
    return this.stateValue
  }

  /** The still-open questions in arrival order (the pending-question view). */
  get pending(): PendingQuestion[] {
    return [...this.questions.values()]
  }

  private setState(state: InteractiveSessionState): void {
    this.stateValue = state
    this.events.onState?.(state)
  }

  // Opens the socket (and keeps it: a drop retries with backoff while the
  // session is not closed — the daemon replays the pending set on every
  // connect, so a reconnect heals the question view by itself).
  connect(): void {
    if (this.stopped) return
    this.setState(this.socket === undefined ? "connecting" : "retrying")
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.onopen = () => {
      this.setState("open")
    }
    socket.onmessage = (event) => {
      this.take(String(event.data))
    }
    socket.onclose = () => {
      if (this.stopped || this.socket !== socket) return
      this.socket = undefined
      // A question whose ask was open when the bridge dropped settles
      // `transport` in memory on the daemon's side; the worker holds its
      // asks across the loss and re-raises on reconnect — the pending view
      // keeps them until a settled frame or a run end says otherwise.
      this.setState("retrying")
      setTimeout(() => this.connect(), this.reconnectMs)
    }
    socket.onerror = () => {
      // onclose follows; the retry state is set there.
    }
  }

  // One inbound frame: typed parse, then the bookkeeping of the question map.
  // A frame that does not parse is a protocol skew the daemon closes on —
  // nothing here needs to act on it.
  private take(raw: string): void {
    const parsed = parseFrame(raw)
    if (!parsed.ok) return
    const frame = parsed.frame
    switch (frame.type) {
      case "hello":
        this.events.onHello?.(frame)
        return
      case "question": {
        const known = this.questions.has(frame.id)
        this.questions.set(frame.id, { id: frame.id, text: frame.text, ...(frame.minutes !== undefined ? { minutes: frame.minutes } : {}), at: Date.now() })
        this.events.onQuestion?.(this.questions.get(frame.id)!, known)
        return
      }
      case "settled":
        this.questions.delete(frame.id)
        this.events.onSettled?.(frame.id, frame.how)
        return
      case "control-done":
        this.events.onControlDone?.(frame.action, frame.applied, frame.reason)
        return
      case "session":
        this.events.onSession?.(frame.session, frame.agent)
        return
      case "error":
        this.events.onError?.(frame.message)
        return
      default:
        // pong (and anything informational): the socket is alive.
        return
    }
  }

  private send(frame: FrameBody): void {
    if (this.socket === undefined || this.socket.readyState !== WebSocket.OPEN) {
      this.events.onError?.("the interactive socket is not open (connecting or reconnecting); retry in a moment")
      return
    }
    this.socket.send(encodeFrame(frame))
  }

  /** Answer an open question (the `answer` scope; joined by the frame id). */
  answer(id: string, text: string): void {
    this.send({ type: "answer", id, text })
  }

  /**
   * The graceful pause: the run exits at its next safe boundary with progress
   * persisted — exit 3, the paused-resumable state (the `control` scope; the
   * run's own /exit, never a kill).
   */
  requestExit(): void {
    this.send({ type: "control", action: "exit" })
  }

  /** The router's failback (the `control` scope): reset the failover state, or redefine the order. */
  requestFailback(order?: string[]): void {
    this.send({ type: "control", action: "failback", ...(order !== undefined ? { order } : {}) })
  }

  close(): Promise<void> {
    this.stopped = true
    const socket = this.socket
    this.socket = undefined
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) socket.close()
    this.setState("closed")
    return Promise.resolve()
  }
}
