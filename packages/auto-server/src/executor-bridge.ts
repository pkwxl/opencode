import type { SocketData } from "./interactive-ws"
import { encodeFrame, parseFrame, type PersonDelegation, type ExecutorRoute, type StepDone } from "./ws-protocol"

type Socket = Bun.ServerWebSocket<SocketData>
type Reply = Pick<StepDone, "body"> & { status: number }
const BRIDGE_TIMEOUT_MS = 30_000

export class ExecutorBridge {
  private socket?: Socket
  private pending = new Map<string, { frame: string; finish: (reply: Reply) => void }>()
  private closed = false

  send(route: ExecutorRoute, token: string, body: unknown, delegation?: PersonDelegation): Promise<Reply> {
    if (this.closed) return Promise.resolve(this.disconnected())
    if (this.pending.size >= 64) {
      return Promise.resolve({ status: 503, body: { error: "The coordinator request queue is full." } })
    }
    const id = crypto.randomUUID()
    const frame = encodeFrame({ type: "step-request", id, route, token, body, delegation })
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Keep the slot occupied until the worker replies or disconnects.
        resolve({ status: 503, body: { error: "The coordinator response was lost or timed out. Reconcile the request before retrying." } })
      }, BRIDGE_TIMEOUT_MS)
      this.pending.set(id, { frame, finish: (reply) => {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(reply)
      } })
      this.socket?.send(frame)
    })
  }

  open(socket: Socket): void {
    if (this.closed || this.socket) {
      socket.close(1008, "coordinator bridge already attached or closed")
      return
    }
    this.socket = socket
    for (const { frame } of this.pending.values()) socket.send(frame)
  }

  message(socket: Socket, raw: string | Buffer): void {
    if (socket !== this.socket) return
    const parsed = parseFrame(String(raw))
    if (parsed.ok && parsed.frame.type === "ping") {
      socket.send(encodeFrame({ type: "pong" }))
      return
    }
    if (!parsed.ok || parsed.frame.type !== "step-done") {
      socket.close(1002, "invalid coordinator reply")
      return
    }
    this.pending.get(parsed.frame.id)?.finish(parsed.frame)
  }

  disconnect(socket: Socket): void {
    if (socket === this.socket) this.close()
  }

  close(): void {
    this.closed = true
    this.socket?.close()
    this.socket = undefined
    for (const request of this.pending.values()) request.finish(this.disconnected())
  }

  private disconnected(): Reply {
    return { status: 503, body: { error: "The coordinator bridge closed. Reconcile the request before retrying." } }
  }
}
