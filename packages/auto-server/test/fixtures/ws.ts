// The WebSocket test client of the auto-server interactive suites (P3b):
// a thin promise-shaped wrapper over Bun's browser-standard WebSocket that
// records every typed frame the daemon (or a stub server) sends, so the
// assertions read the frames themselves — the same anti-scraping discipline
// the transport implements (typed payloads, never prose parsed back).
import { encodeFrame, parseFrame, type FrameBody, type WsFrame } from "../../src/ws-protocol"

export type TestSocket = {
  ws: WebSocket
  frames: WsFrame[]
  /** Resolves once the connection is open; rejects when it never opens (a refused upgrade). */
  opened: Promise<void>
  /** Resolves when the socket ends (either side's close). */
  dropped: Promise<void>
  /** Resolves with the first frame matching `where` (arrived or future). */
  nextOf: (where: (frame: WsFrame) => boolean, what: string, timeoutMs?: number) => Promise<WsFrame>
  send: (frame: FrameBody) => void
  close: () => Promise<void>
}

export function wsClient(url: string): TestSocket {
  const ws = new WebSocket(url)
  const frames: WsFrame[] = []
  type Waiter = { where: (frame: WsFrame) => boolean; what: string; resolve: (frame: WsFrame) => void; reject: (error: Error) => void }
  const waiters: Waiter[] = []
  let settleDropped: () => void = () => {}
  const dropped = new Promise<void>((resolve) => {
    settleDropped = resolve
  })
  let settleOpened: (error?: Error) => void = () => {}
  const opened = new Promise<void>((resolve, reject) => {
    settleOpened = (error) => (error === undefined ? resolve() : reject(error))
  })
  let open = false
  ws.onopen = () => {
    open = true
    settleOpened()
  }
  ws.onmessage = (event) => {
    const parsed = parseFrame(String(event.data))
    if (!parsed.ok) throw new Error(`the test client received a frame it cannot parse: ${parsed.error.message}`)
    frames.push(parsed.frame)
    const at = waiters.findIndex((waiter) => waiter.where(parsed.frame))
    if (at >= 0) waiters.splice(at, 1)![0]!.resolve(parsed.frame)
  }
  ws.onclose = () => {
    settleDropped()
    if (!open) settleOpened(new Error(`the server refused the websocket connection to ${url}`))
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`the socket closed before ${waiter.what}`))
  }
  ws.onerror = () => {
    // onclose follows for a refused or broken connection; the rejections
    // above name what was lost.
  }
  // A connection that neither opens nor is refused inside the window is a
  // hang the test must fail on, not outlive.
  setTimeout(() => {
    if (!open && ws.readyState !== WebSocket.OPEN) settleOpened(new Error(`the test client never connected to ${url}`))
  }, 10_000).unref?.()
  return {
    ws,
    frames,
    opened,
    dropped,
    nextOf(where, what, timeoutMs = 10_000) {
      const arrived = frames.find(where)
      if (arrived) return Promise.resolve(arrived)
      return new Promise<WsFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
          const at = waiters.findIndex((waiter) => waiter.resolve === resolve)
          if (at >= 0) waiters.splice(at, 1)
          reject(new Error(`${what} never arrived (frames so far: ${frames.map((frame) => frame.type).join(", ") || "none"})`))
        }, timeoutMs)
        waiters.push({
          where,
          what,
          resolve: (frame) => {
            clearTimeout(timer)
            resolve(frame)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
      })
    },
    send(frame) {
      ws.send(encodeFrame(frame))
    },
    async close() {
      if (ws.readyState === WebSocket.OPEN) ws.close()
      const deadline = Date.now() + 5_000
      while (ws.readyState !== WebSocket.CLOSED && Date.now() < deadline) await Bun.sleep(20)
    },
  }
}
