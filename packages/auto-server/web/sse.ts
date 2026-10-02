// The Web client's SSE reader (P4a): the daemon's three event streams (the
// P1e log and engine-journal tails, the P2b typed driver-events channel)
// consumed over fetch, because the token rides the Authorization header and a
// browser's EventSource cannot set one. The frame parser here is the SSE
// wire format's own grammar (event/data/id lines, multi-line data, comment
// frames as keep-alives) — pure and unit-tested; nothing parses a stream's
// CONTENT: the log channel's lines are prose rendered verbatim for humans,
// and the events channels' payloads are the typed JSON the daemon delivered.
//
// Reconnect: the tail re-opens with capped backoff while started (the log and
// engine-journal channels re-read from the current run's start — their
// durable view is the poll model; the status-events channel resumes after
// the last received id, the cursor its endpoint takes as ?after=).
export type SseFrame = { event: string; data: string; id?: number }

// One SSE block (the text between blank-line separators) → a frame, or null
// for a comment-only block (a keep-alive). The grammar: `event:` names the
// event type (default "message"), each `data:` line contributes one line of
// the payload (joined with newlines), `id:` is the event id. A block without
// a data line carries nothing.
export function parseSseBlock(block: string): SseFrame | null {
  let event = "message"
  let id: number | undefined
  const data: string[] = []
  for (const raw of block.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
    if (line === "" || line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "event") event = value
    else if (field === "data") data.push(value)
    else if (field === "id") {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && value.trim() !== "") id = parsed
    }
    // Unknown fields are ignored, per the SSE spec.
  }
  if (!data.length) return null
  return { event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) }
}

// Splits a growing byte stream's decoded text into complete blocks: every
// chunk ending at a blank line is a frame boundary; the remainder is the
// bytes of a frame still being written. Handles the CRLF form servers emit.
export function splitSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = []
  let rest = buffer
  for (;;) {
    const at = rest.indexOf("\n\n")
    const atCrLf = rest.indexOf("\r\n\r\n")
    if (at === -1 && atCrLf === -1) break
    // The earliest boundary wins (mixed line endings inside one buffer are
    // tolerated the way the spec's parsers do).
    const cut = at === -1 ? atCrLf : atCrLf === -1 ? at : Math.min(at, atCrLf)
    const end = rest[cut] === "\r" && rest.slice(cut, cut + 4) === "\r\n\r\n" ? cut + 4 : cut + 2
    blocks.push(rest.slice(0, cut))
    rest = rest.slice(end)
  }
  return { blocks, rest }
}

export type SseTailHandlers = {
  onFrame: (frame: SseFrame) => void
  /** Connection state changes, for the page's connection indicators. */
  onState?: (state: "connecting" | "open" | "retrying") => void
}

export type SseTailOptions = {
  /** The first reconnect delay; doubles up to `maxReconnectMs`. Default 1000. */
  reconnectMs?: number
  maxReconnectMs?: number
  /** The reader stops itself after this many connection attempts (tests). */
  maxAttempts?: number
}

// One SSE channel as a self-healing reader: open (the caller's fetch with the
// token header, aborted through the signal handed to it), read the body to
// completion frame by frame, then reconnect with backoff — a stream that ends
// (the daemon stopped, the socket dropped, the reader was stopped) is never
// an error state, it is the next connection's turn. stop() is final: it
// aborts the open stream, so a page switching projects leaves no tail behind.
export class SseTail {
  private stopped = false
  private attempt = 0
  private controller: AbortController | undefined
  private readonly open: (signal: AbortSignal) => Promise<Response>
  private readonly handlers: SseTailHandlers
  private readonly reconnectMs: number
  private readonly maxReconnectMs: number
  private readonly maxAttempts: number

  constructor(open: (signal: AbortSignal) => Promise<Response>, handlers: SseTailHandlers, options: SseTailOptions = {}) {
    this.open = open
    this.handlers = handlers
    this.reconnectMs = options.reconnectMs ?? 1000
    this.maxReconnectMs = options.maxReconnectMs ?? 15_000
    this.maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY
  }

  start(): void {
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.controller = undefined
  }

  private async loop(): Promise<void> {
    let backoff = this.reconnectMs
    while (!this.stopped) {
      this.handlers.onState?.(this.attempt === 0 ? "connecting" : "retrying")
      try {
        const controller = new AbortController()
        this.controller = controller
        const response = await this.open(controller.signal)
        this.attempt += 1
        this.handlers.onState?.("open")
        backoff = this.reconnectMs
        await this.drain(response)
      } catch {
        // A refused open, a broken body or this.stop()'s abort: the next
        // connection's turn (or none — stop() is final).
      } finally {
        this.controller = undefined
      }
      if (this.stopped) break
      if (this.attempt >= this.maxAttempts) break
      await new Promise((resolve) => setTimeout(resolve, backoff))
      backoff = Math.min(backoff * 2, this.maxReconnectMs)
    }
  }

  // Reads one response body to its end, parsing frames as their blank-line
  // boundaries land (a partial frame's bytes are held until it completes).
  // An aborted body throws out of the reader — the loop's stop() path.
  private async drain(response: Response): Promise<void> {
    if (response.body === null) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const { blocks, rest } = splitSseBlocks(buffer + decoder.decode(value, { stream: true }))
        buffer = rest
        for (const block of blocks) {
          const frame = parseSseBlock(block)
          if (frame) this.handlers.onFrame(frame)
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }
}
