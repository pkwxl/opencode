// The liveness concern (plans/0061 §4.5, the liveness cells of the part,
// retry and idle rows and the concurrent `probe` row): the connection's
// health and the turn's unfinished-work criterion. The probe timer and its
// probeSession call are the sources' (src/engine/sources.ts); the verdict
// arrives here as the synthetic probe input, handled even while an fx call
// is in flight (the row is declared concurrent): a successful probe resets
// the count, a failure inside an announced silence waits for the end the
// agent named, and two consecutive failures judge the connection half-open
// and settle the turn interrupted. An announced silence (the agent
// honouring a retry wait longer than its silence budget) opens a quiet
// window the probe respects and any model output closes. A step-finish
// ending on reason length means the reply was truncated — not a natural
// finish — so an idle on such a turn steers a short continuation (capped),
// keeping the session and every token of its context. The settle
// procedure's liveness step (plans/0061 §4.4 rule 5) is this concern's
// finalize: the interrupted close-out, aborting the orphan turn and
// extending the failure record with the transport message, before the
// recovery concern's final classification reads it.
import type { ErrorInfo } from "../../chain"
import { formatDuration } from "../../log"
import type { Advice, Concern, TurnState } from "../contract"

// Liveness probe parameters (plans/0026-session-boundary-hardening-design.md
// D3): the interval defaults to reusing idleTime (10 minutes, same key and
// same default as the script watchdog, config.idleTime — the timer itself
// lives in src/engine/sources.ts); **2 consecutive** failures are required
// before judging half-open — to rule out misjudging transient server jitter
// (GC pauses and the like). The short per-probe timeout (30 seconds) is
// session-api's PROBE_TIMEOUT_MS.
const PROBE_MAX_FAILURES = 2

// Truncated-output continuation (2026-09-18, kernel-spi-nor T-030 S13 field
// case): the last step-finish ending with reason length = the model reply was
// truncated by the output limit (cut mid reasoning stream) while the server
// goes idle as usual — this is not a natural finish, the session's work is
// clearly unfinished. A short "continue from the cut-off point" steer lets the
// same session carry on (not one bit of context lost), instead of closing out
// as a natural finish to run shape checks/ticks and then opening a blank
// session that re-reads everything. Consecutive truncations are capped at 3
// (keeping the degenerate form — a single over-long message — from spinning);
// past the cap it still closes out as a natural finish, caught by the existing
// artifact shape-check loop; a step finishing with a reason other than length
// (work back to normal after continuation) resets the count.
const LENGTH_CONTINUE_MAX = 3

// What one liveness turn needs beside its context. `extended` is the settle
// procedure's channel for the interrupted close-out's failure record: this
// concern's finalize extends the failure slice's record with the transport
// message of the interruption, and the recovery concern's final
// classification and the snapshot mapping read the extension through this
// cell; `error` is set exactly when the turn settled interrupted.
export type LivenessDeps = {
  extended: { error?: string; info?: ErrorInfo }
}

// One concern instance per turn (a factory, not a module constant): the
// extended record cell is per-turn wiring, shared with the recovery concern
// built over the same cell.
export const makeLivenessConcern = (deps: LivenessDeps): Concern<"liveness"> => ({
  name: "liveness",
  initial: (): TurnState["liveness"] => ({ probeFailures: 0, halfOpen: false, lengthContinued: 0 }),
  handle: async (input, own, view, fx, ctx): Promise<Advice> => {
    // The probe row (concurrent): the verdict is handled even while an fx
    // call is in flight — the audit restricts a synthetic handler to its
    // own slice's writes and log/vlog, and the verdict's time read is the
    // input's `at` stamp (the source stamped it at emission). A successful
    // probe resets the count; PROBE_MAX_FAILURES consecutive failures judge
    // half-open and settle the turn, which the close-out returns as a
    // retryable session error (classified transient, riding the existing
    // retry ladder and failover ring; a new connection forks onward). The
    // halfOpen guard is the old callback's early return: a verdict landing
    // after the judgment changes nothing more.
    if (input.kind === "probe") {
      if (own.halfOpen) return "consumed"
      if (input.ok) {
        own.probeFailures = 0
      } else if (own.quietUntil !== undefined && input.at < own.quietUntil) {
        // The agent announced this silence (§4.2): the verdict waits for the
        // end it named.
        fx.log(`⚠ connectivity probe failed (session ${ctx.sessionID}) inside the agent's announced wait; not counted before ${new Date(own.quietUntil).toISOString()}`)
      } else {
        own.probeFailures += 1
        fx.log(`⚠ connectivity probe failure ${own.probeFailures}/${PROBE_MAX_FAILURES} (session ${ctx.sessionID}); connection suspected half-open`)
        if (own.probeFailures >= PROBE_MAX_FAILURES) {
          own.halfOpen = true
          return { settle: { kind: "interrupted" } }
        }
      }
      return "consumed"
    }
    if (input.kind !== "event") return "pass"
    // The part row's liveness cell. Model output after a retry (the failure
    // concern's cell just before ended retrying and dropped the stated
    // limit fields): an announced silence is over — the agent produced
    // output again. A step-finish records its reason — the
    // truncation-continuation criterion of the idle cell below — and a
    // finish other than length (work back to normal after continuation)
    // resets the consecutive-truncation count. The step-finish increment
    // accumulation (the transcript concern's cell, later in the row) is
    // unrelated to either.
    if (input.event.type === "part") {
      const part = input.event.part
      if (part.kind !== "step-start") own.quietUntil = undefined
      if (part.kind === "step-finish") {
        own.lastFinish = part.reason
        if (part.reason !== "length") own.lengthContinued = 0
      }
      return "pass"
    }
    // The retry row's liveness cell. An announced silence (§4.2): the agent
    // honours a wait longer than its silence budget and says nothing more
    // until it is over. The line names its end; the liveness probe counts
    // no failure before it. The clock goes through the audited fx (the same
    // services clock the old branch closed over).
    if (input.event.type === "retry") {
      const event = input.event
      if (ctx.policy.honorsRetryAfter && event.next !== undefined && event.next > ctx.policy.silenceBudgetMs) {
        const until = fx.now() + event.next
        if (own.quietUntil === undefined || Math.abs(until - own.quietUntil) >= 1000) {
          fx.log(
            `⏳ the agent waits ${formatDuration(event.next)} before retrying${event.attempt !== undefined ? ` (attempt ${event.attempt})` : ""} (session ${ctx.sessionID}); ` +
              `no events are expected until ${new Date(until).toISOString()}`,
          )
        }
        own.quietUntil = until
      }
      // The transcript concern's cell follows with the deduplicated retry
      // vlog and ends the input.
      return "pass"
    }
    if (input.event.type !== "idle") return "pass"
    // The idle row's liveness cell (the row's last): the test protocol —
    // the test cell before it — has answered by now; it either stopped the
    // input (continue, blocked, invalid) or passed it on (no test run, or
    // nothing pending and no unfinished handover).
    // Truncated-output continuation (LENGTH_CONTINUE_MAX): with the last
    // step finishing on length and no session error observed, the session's
    // work is unfinished — a short "continue from the cut-off point" steer
    // lets the same session carry on instead of closing out as a natural
    // finish. Twin-idle dedup (the guard concern's cell) and the steer-turn
    // interplay are the same as the handover/test steer paths.
    // An agent that takes no further messages (MA.4: steer off) cannot be
    // told to continue; the truncated turn ends as if the cap were used up.
    if (own.lastFinish === "length" && !view.failure.error && own.lengthContinued < LENGTH_CONTINUE_MAX && ctx.client.capabilities.steer) {
      own.lengthContinued++
      // The continuation turn's own step-finish would refresh lastFinish;
      // clear it first after the steer, so the corner case of a new turn
      // with no step-finish cannot repeat the continuation against a stale
      // criterion (the cap bounds it, at most MAX idle spins).
      own.lastFinish = undefined
      fx.log(`⚠ session reply truncated by the output length limit (step-finish reason=length); prompting it to continue from the cut-off point (${own.lengthContinued}/${LENGTH_CONTINUE_MAX})`)
      const ok = await fx.steer(
        "[DRIVER] Your previous reply was cut off by the output length limit; continue the unfinished work from the cut-off point " +
          "(do not redo what is finished; split long output into several steps / tool calls so you don't hit the limit again).",
      )
      if (!ok) return { settle: { kind: "blocked", question: "steer dispatch failed (length-continuation hint); cannot continue the session, see the log." } }
      return "consumed"
    }
    // No continuation: the row runs out, and the spine's own idle terminal
    // settles the turn naturally (the arbitration table's idle row names
    // the spine as its terminal — plans/0061 §4.5).
    return "pass"
  },
  // The settle procedure's liveness step (plans/0061 §4.4 rule 5): the
  // interrupted close-out. The finalize procedure runs it before the
  // recovery concern's final classification (the liveness cell of the part
  // row precedes the recovery cell of the retry row), so the classification
  // and the snapshot read the extended record.
  // Stream-interruption / half-open close-out: abort the orphan turn that
  // may still be running on the server, avoiding concurrent file writes
  // with the retried new session (abort is harmless to a finished session;
  // with the network already down the call fails silently). The session
  // error goes through attempt's wrapping onto the retry/blocked paths, the
  // progress record stays active, and the next run reuses this session to
  // continue. The probe-judged half-open (plans/0026 D3) and the SSE
  // interruption get distinct messages; the half-open message carries
  // network/timeout criteria for classifySessionError to file as transient
  // — transport-layer faults ride the existing retry ladder and failover
  // ring, no model switch; the failure record is extended in sync so the
  // classification and the upward report have grounds.
  finalize: async (settle, own, view, fx): Promise<void> => {
    if (settle.kind !== "interrupted") return
    await fx.abort()
    const msg = own.halfOpen
      ? `connectivity probe failed ${PROBE_MAX_FAILURES} consecutive times; connection judged half-open (server unresponsive or network down, half-open network timeout)`
      : "event stream interrupted (no session-end event received; suspected server failure or network down)"
    deps.extended.error = view.failure.error ? `${view.failure.error}\n${msg}` : msg
    deps.extended.info = own.halfOpen
      ? { ...(view.failure.info ?? {}), message: view.failure.info?.message ? `${view.failure.info.message}\n${msg}` : msg }
      : view.failure.info
  },
})
