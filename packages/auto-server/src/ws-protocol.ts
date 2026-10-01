// The interactive transport's wire protocol (P3b, auto-core plans/0067 §四):
// the typed, versioned frame vocabulary the worker's injected Interactive
// implementation (src/worker-interactive.ts, built on the P3a
// RunAllOpts.io/Interactive seam) speaks with the daemon's WebSocket surface
// (src/interactive-ws.ts) — and the vocabulary a client of the daemon speaks
// on the same endpoint. One module, three speakers, no drift.
//
// THE RULE (the direction draft §五's no-scraping constraint, the assessment's
// risk #2, made an acceptance criterion): every fact on this wire is a typed
// frame field — a question is `{ type: "question", id, text, minutes? }`
// where `text` is an opaque payload carried verbatim, never prose either side
// parses back for state. The question's lifecycle state lives in the P2 event
// stream (`question-raised`/`question-answered`, the run-status journal
// `.auto/run-status.jsonl`, streamed by the status-events SSE channel); this
// transport's `question`/`settled` frames are the interactive channel's own
// correlation flow, joined by the frame `id` (the worker's correlation id)
// and nothing else. Correlation, not scraping, is the whole design.
//
// Versioning: every frame carries `v`. The daemon and the worker ship
// together (the daemon spawns the worker from its own binary), so a version
// skew can only appear between a client and a daemon, or a daemon and a
// stale worker of a restarted daemon. A frame whose `v` is not the version
// this end speaks is a protocol error: the socket answers one `error` frame
// naming both versions and closes (version negotiation is a conscious
// protocol change, never a silent reinterpretation).
//
// The channels (multiplexed on one client socket, the scope the auth tiers
// guard): the QUESTION channel — `question`/`answer`/`settled` — and the
// CONTROL channel — `control` (`exit`/`failback`) with `control-done` as its
// outcome. `session` frames are informational (which session the run's
// channel is attached to); `ping`/`pong` are keep-alive; `hello` is the
// daemon's connect frame; `error` is a refusal that leaves the socket open
// (a scope miss, an unknown question) unless it is a protocol error.
// Types and pure functions only — this module imports nothing, so every
// speaker (the daemon's WS surface, the worker transport, a client, tests)
// binds no behavior by reading it (the run-status-schema precedent).

// The protocol version this package speaks on both ends. Bump in one
// conscious change that updates every speaker (the daemon, the worker
// transport, and the published client vocabulary in docs/daemon.md).
export const PROTOCOL_VERSION = 1

// How a question settled on the worker's side — the transport-level fact the
// daemon forwards so a client can drop the question from its view. It names
// the TRANSPORT event, not the P2 event-stream settlement (whose words —
// human/driver/timeout — belong to the questions concern): `answered` (an
// answer arrived and resolved the ask), `timeout` (the ask's own timer — the
// timer-arms-only-with-minutes semantics of auto-core
// src/interactive.ts:163-191 — or the reconnect grace ran out), `transport`
// (the connection was lost while the ask was open), `closed` (the run closed
// its channel: the ask settles unanswered).
export const SETTLEMENTS = ["answered", "timeout", "transport", "closed"] as const
export type Settlement = (typeof SETTLEMENTS)[number]

// The control actions (the transport-neutral in-worker seams the assessment
// verified, mapped one to one): `exit` → Control.requestExit (the graceful
// /exit pause, exit 3 with progress persisted, auto-core src/exit.ts:37-42
// and src/loop.ts' ExitRequested catch); `failback` → Router.requestFailback
// (auto-core src/router.ts). Mid-run control, never config mutation — the
// config freeze is untouched.
export const CONTROL_ACTIONS = ["exit", "failback"] as const
export type ControlAction = (typeof CONTROL_ACTIONS)[number]

// The frame vocabulary proper. `v` on every frame; `type` discriminates.
// Worker → daemon: question, settled, session, control-done, ping.
// Daemon → worker: answer, control, pong, error.
// Daemon → client: hello, question, settled, session, control-done, pong,
//                  error.
// Client → daemon: answer, control, ping.
export type WsFrame =
  // The run raised a question (worker → daemon) / the forwarded or replayed
  // question (daemon → client). `id` is the worker's correlation id — the
  // `answer` frame joins on it; `text` is the prompt text verbatim (opaque
  // payload); `minutes` the ask's own timeout in minutes, absent = the hard
  // wait (the semantics preserved from the terminal sideband).
  | { v: number; type: "question"; id: string; text: string; minutes?: number }
  // A client's answer to an open question; joined by `id`.
  | { v: number; type: "answer"; id: string; text: string }
  // The question settled on the worker's side (see SETTLEMENTS).
  | { v: number; type: "settled"; id: string; how: Settlement }
  // Informational: the run's channel attached to a session (the Interactive
  // attach route — which session human input feeds).
  | { v: number; type: "session"; session: string; agent?: string }
  // The control channel: a client's command (daemon checks the control
  // scope, forwards to the worker) — `order` is the failback model order
  // (provider/model strings, the first the primary), absent = plain failback
  // state reset.
  | { v: number; type: "control"; action: ControlAction; order?: string[] }
  // The outcome of a control frame, routed back: `applied` false with a
  // `reason` when the run refused it (not started yet, already closing, a
  // malformed failback order).
  | { v: number; type: "control-done"; action: ControlAction; applied: boolean; reason?: string }
  // Keep-alive (either direction may ping; the daemon answers pong).
  | { v: number; type: "ping" }
  | { v: number; type: "pong" }
  // The daemon's connect frame: the run id, its registry state and whether
  // the run's worker bridge is connected. Followed (client sockets) by a
  // replay of every still-open question — a reconnecting client re-sees the
  // ask it came to answer.
  | { v: number; type: "hello"; run: string; state: string; worker: boolean }
  // A refusal (the named shape below).
  | ErrorFrame

export type WsFrameType = WsFrame["type"]

// A refusal: a well-formed frame this end will not act on (a scope miss,
// an unknown question id, a control with no worker connected). The socket
// stays open — `error` is a per-frame answer, not a disconnect. Protocol
// errors (bad JSON, wrong version, unknown type) additionally close the
// socket; the refusal pair `parseFrame` returns says which. Named so the
// union's last member and the parse refusal pair spell it once.
export type ErrorFrame = { v: number; type: "error"; message: string; fatal?: boolean }

// A frame parse outcome: the typed frame, or a refusal pair — the error
// frame to answer with and whether the socket must close (protocol errors
// close; semantic refusals ride an error frame and stay open, routed by the
// caller instead).
export type ParsedFrame = { ok: true; frame: WsFrame } | { ok: false; error: ErrorFrame; fatal: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const has = (frame: Record<string, unknown>, key: string): boolean => key in frame

// The parse: JSON in, one typed frame out. Everything structural is a
// protocol error (fatal — answer the error frame, close the socket):
//   - not JSON, or not an object;
//   - `v` missing / not the version this end speaks (the error names both —
//     the negotiation is a conscious change, and a stale speaker deserves to
//     know which way the skew runs);
//   - `type` unknown to this version;
//   - a known type with missing or wrongly-typed fields (a speaker that
//     cannot shape its own vocabulary is a skew, not a mistake to paper
//     over).
export function parseFrame(raw: string): ParsedFrame {
  const bad = (message: string, fatal = true): ParsedFrame => ({ ok: false, error: { v: PROTOCOL_VERSION, type: "error", message, ...(fatal ? { fatal: true } : {}) }, fatal })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return bad(`a frame is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed)) return bad("a frame is a JSON object")
  if (!has(parsed, "v") || typeof parsed.v !== "number") return bad("a frame carries its protocol version in the numeric field \"v\"")
  if (parsed.v !== PROTOCOL_VERSION) return bad(`protocol version skew: this end speaks v${PROTOCOL_VERSION}, the frame carries v${parsed.v}`)
  const type = parsed.type
  const str = (key: string): string | undefined => (typeof parsed[key] === "string" ? (parsed[key] as string) : undefined)
  const num = (key: string): number | undefined => (typeof parsed[key] === "number" && Number.isFinite(parsed[key]) ? (parsed[key] as number) : undefined)
  switch (type) {
    case "question": {
      const id = str("id")
      const text = str("text")
      if (id === undefined || text === undefined) return bad("a question frame carries string fields \"id\" and \"text\"")
      const minutes = num("minutes")
      if (has(parsed, "minutes") && minutes === undefined) return bad("a question frame's \"minutes\" is a number (absent = the hard wait)")
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "question", id, text, ...(minutes !== undefined ? { minutes } : {}) } }
    }
    case "answer": {
      const id = str("id")
      const text = str("text")
      if (id === undefined || text === undefined) return bad("an answer frame carries string fields \"id\" and \"text\"")
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "answer", id, text } }
    }
    case "settled": {
      const id = str("id")
      const how = str("how")
      if (id === undefined || !SETTLEMENTS.includes(how as Settlement)) return bad(`a settled frame carries string fields "id" and "how" (${SETTLEMENTS.join("|")})`)
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "settled", id, how: how as Settlement } }
    }
    case "session": {
      const session = str("session")
      if (session === undefined) return bad("a session frame carries the string field \"session\"")
      const agent = str("agent")
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "session", session, ...(agent !== undefined ? { agent } : {}) } }
    }
    case "control": {
      const action = str("action")
      if (!CONTROL_ACTIONS.includes(action as ControlAction)) return bad(`a control frame's "action" is ${CONTROL_ACTIONS.join("|")}`)
      let order: string[] | undefined
      if (has(parsed, "order")) {
        if (!Array.isArray(parsed.order) || parsed.order.some((item) => typeof item !== "string" || !item.trim())) {
          return bad("a control frame's \"order\" is an array of non-empty model strings (provider/model)")
        }
        order = parsed.order as string[]
      }
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "control", action: action as ControlAction, ...(order !== undefined ? { order } : {}) } }
    }
    case "control-done": {
      const action = str("action")
      if (!CONTROL_ACTIONS.includes(action as ControlAction)) return bad(`a control-done frame's "action" is ${CONTROL_ACTIONS.join("|")}`)
      if (typeof parsed.applied !== "boolean") return bad("a control-done frame carries the boolean field \"applied\"")
      const reason = str("reason")
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "control-done", action: action as ControlAction, applied: parsed.applied, ...(reason !== undefined ? { reason } : {}) } }
    }
    case "ping":
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "ping" } }
    case "pong":
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "pong" } }
    case "hello": {
      const run = str("run")
      const state = str("state")
      if (run === undefined || state === undefined) return bad("a hello frame carries string fields \"run\" and \"state\"")
      if (typeof parsed.worker !== "boolean") return bad("a hello frame carries the boolean field \"worker\"")
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "hello", run, state, worker: parsed.worker } }
    }
    case "error": {
      const message = str("message")
      if (message === undefined) return bad("an error frame carries the string field \"message\"")
      return { ok: true, frame: { v: PROTOCOL_VERSION, type: "error", message, ...(parsed.fatal === true ? { fatal: true } : {}) } }
    }
    default:
      return bad(`unknown frame type "${String(type)}" (v${PROTOCOL_VERSION} of the interactive transport protocol)`)
  }
}

// The encode side's input: a frame without the `v` every speaker would
// otherwise have to stamp itself. Distributive over the union (a plain
// Omit over a discriminated union collapses to the common keys).
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never
export type FrameBody = DistributiveOmit<WsFrame, "v">

// The encode side: a frame in, the exact JSON string for the wire. Stamping
// `v` centrally (like the emitter stamps `run`/`at`, auto-core
// src/run-status.ts) means no speaker can send an unversioned frame.
export function encodeFrame(frame: FrameBody): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...frame })
}
