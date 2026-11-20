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
import { encodeFrame, parseFrame, PROTOCOL_VERSION, type FrameBody, type WsFrame } from "../src/ws-protocol"

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
    roundTrip({ type: "step-request", id: "r1", route: "heartbeat", token: "token-identity", body: { leases: [] } }, "executor request")
    roundTrip({ type: "step-done", id: "r1", status: 200, body: { protocol: 0.1, menu: { leases: [], claimable: [] } } }, "executor reply")
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
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "step-request", id: "r1", route: "ready", body: {} }), /invalid step-request/)
    // 0282: the answer route is tombstoned — an unknown route is the invalid step-request refusal.
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "step-request", id: "r2", route: "answer", token: "person-identity", body: {} }), /invalid step-request/)
    fatal(JSON.stringify({ v: PROTOCOL_VERSION, type: "step-done", id: "r1", status: 200, body: [] }), /invalid step-done/)
  })
})
