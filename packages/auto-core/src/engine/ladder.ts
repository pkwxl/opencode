// The pure ladder decision of one session prompt (plans/0061 §4.7): what
// the session-driving loop does with a dispatch's outcome — return it, wait
// out a model window, escalate a quota/auth/rate failure through the key
// ring and the model failover into the wait-and-probe loop, exhaust the
// retry ladder into the failover, or retry the transient error. runSession
// (src/session.ts) is the executor: it builds the facts at the seam (the
// routing facts' presence, the account a failure books against — volatile
// run state reaches the decision only as data), asks this function, and
// keeps every side effect in its place:
// the learned-window booking, the escalation's down marks, the server
// restart, the backoff sleep and the fork seeding.
//
// Pure means: no I/O, no module state, no chain or ladder write. The
// result and the ladder's counters are inputs; the ladder position is read
// here and advanced only by the executor's retry and failover paths.
import type { SessionResult, WindowWait } from "../chain"
import { firstLine } from "../resume-gate"

// What the wait-and-probe loop knows of the failure it waits out: its class
// and a reset with the scope a statement gave it — the failure that led into
// the loop, then each failed probe's (plans/0057 §6) — and the account it
// failed on, whose learned windows stand in when it states no reset (§8).
export type WaitCause = Pick<Extract<SessionResult, { type: "blocked" }>, "errorClass" | "resetAt" | "scope"> & { account?: string }

// The ladder's own bookkeeping, one object per runSession call: `i` is the
// next retry's ordinal (1-based; the element count of facts.waits is the
// retry cap, and a candidate switch resets i to 1 — every candidate gets
// its own full ladder round), `tried` the failover candidate strings this
// chain has already tried (ordered, for the exhaustion message and the
// dedup on re-selection) and `clipped` the candidates skipped because their
// context window falls short (for the exhaustion message and the skip log's
// dedup). nextStep reads the position; the executor's failover and retry
// paths are the only writers.
export type LadderState = { i: number; tried: string[]; clipped: string[] }

// What the decision needs of the run: the retry ladder's wait minutes (the
// minutes before each retry; the element count is the retry cap), whether a
// managed server exists that a network failure can restart, and the account
// a failure books its learned windows against (the wait cause carries it, so
// the loop that waits a failure out knows whose windows to read). Every run
// has a registry since the implicit registry (0061 F2), so the candidate
// table needs no flag: the tier lists (or the /failback override that
// replaces them) always are one.
// AUTO-DECISION: `account` sits in the facts although the ruled sketch
// named four fields — the steps' causes need it (the learned windows are
// read by the account), and the executor books the same read for its
// learnFailure/accountAnswered wiring, so one computation per dispatch
// serves both without the executor enriching the steps after the decision.
// AUTO-DECISION (0069 §2.2 D2, T-109): the `registry` flag and the
// `ringLength` field are deleted — dead in production since the implicit
// registry (0061 F2) removed the no-registry path, where the call site
// wrote the constants `registry: true` and the override ring's length.
export type LadderFacts = { waits: number[]; server: boolean; account?: string }

// The step runSession executes:
// - return: the outcome leaves the loop as-is (a live result, or an
//   in-session blocked question that needs a human reply — never a fault);
// - window-wait: selection found nothing usable but a candidate that is
//   not down opens later — sleep to the opening and dispatch again;
// - recover: the wait-and-probe loop (why is its log line; cause is absent
//   when no session ran, a no-model exhaustion);
// - escalate: the key → model → recover chain of a quota/auth/rate class
//   (label drives the log lines and the failover notes; until and
//   classified feed the down marks the escalation writes; cause is the
//   recovery's when neither the ring nor the failover can move);
// - after-ladder: the retry ladder is exhausted — the model failover runs
//   first, and why's recovery takes over when it cannot move either;
// - retry: a transient error's nth ladder round, waiting waitMinutes
//   first, restarting the managed server when the error is a network/
//   service failure.
// AUTO-DECISION: after-ladder carries the exhaustion recovery's why in
// addition to the ruled sketch's cause (the message is pure — it names the
// ladder's length — so the decision owns it and the executor stays free of
// message formats; the escalate step's exhaustion message, in contrast,
// names the down marks and tried candidates as they stand *after* the
// escalation ran, which only the executor can read).
export type Step =
  | { kind: "return"; result: SessionResult }
  | { kind: "window-wait"; wait: WindowWait }
  | { kind: "recover"; why: string; cause?: WaitCause }
  | { kind: "escalate"; label: string; until?: number; classified?: boolean; cause: WaitCause }
  | { kind: "after-ladder"; why: string; cause: WaitCause }
  | { kind: "retry"; nth: number; waitMinutes: number; restartServer: boolean }

// Signature strings marking a network/service failure inside session
// errors; on a hit the executor restarts the managed server first (an
// external server excepted — no managed server exists), then the retry
// goes to a fresh session, avoiding repeated failures against the same
// broken instance.
const NETWORK_FAILURE = /internal network failure|network error|fetch failed|econrefused|econreset|socket hang up/i

// The question prefixes that mark a blocked result as a session fault (the
// three faces of a failed dispatch: the error itself / session creation
// failed / task dispatch failed). Every other blocked outcome is an
// in-session question or permission denial that needs a human reply and
// was never a fault to begin with.
const FAULT_FACES = ["session error: ", "session creation failed: ", "task dispatch failed: "] as const

// A spent usage window with a stated reset (plans/0057 §4.1, §7): a
// five-hour, daily or weekly window cures nothing before that instant, so
// the retry ladder's fresh sessions would only hit it again. undefined for
// a per-minute cap (the agent's own ladder cures it) and for a reset of
// unknown scope (today's path).
function spentWindow(result: WaitCause): string | undefined {
  if (result.resetAt === undefined) return undefined
  return result.scope === "5h" ? "five-hour" : result.scope === "7d" ? "weekly" : result.scope === "day" ? "daily" : undefined
}

// What the session-driving loop does with a dispatch's outcome. The order
// of the branches is the ladder's policy and reproduces today's statement
// order exactly: a live outcome first, then the registry's no-model
// outcomes, then the session faults (escalation before the retry verdicts,
// the non-retryable recovery before the ladder, and the ladder's own
// exhaustion last).
export function nextStep(result: SessionResult, ladder: LadderState, facts: LadderFacts): Step {
  // A live outcome leaves the loop (the executor books the answered account
  // on the way out).
  if (result.type !== "blocked") return { kind: "return", result }
  // Registry routing: selection found nothing usable for the dispatch
  // (every candidate down or outside its windows, plans/0055 §6.3) — no
  // session ran, so this is not a session failure either. The two outcomes
  // split here: a waitable window sleeps inside the unit until the opening
  // plus the jitter and dispatches again; everything down goes to the
  // wait-and-probe loop, whose probe clears a candidate's mark when
  // service is back. No cause: nothing failed on an account.
  if (result.noModel === true) {
    if (result.windowWait !== undefined) return { kind: "window-wait", wait: result.windowWait }
    return { kind: "recover", why: firstLine(result.question) }
  }
  // Every session-fault face (the error itself / session creation failed /
  // task dispatch failed) goes into the recovery machinery below rather
  // than being returned as blocked; the only blocked results returned
  // directly are in-session blocking questions and permission denials —
  // those need a human reply and were never faults to begin with.
  if (!FAULT_FACES.some((prefix) => result.question.startsWith(prefix))) return { kind: "return", result }
  // The failure's wait cause: its class and stated reset, and the account
  // whose learned windows stand in when it states none (plans/0057 §8).
  const cause: WaitCause = { ...result, account: facts.account }
  const spent = spentWindow(result)
  // The escalation's label: the class name (quota/auth/rate), or the spent
  // window when the failure states a reset without a class — a classifier
  // answer marks the label "(classifier)" (plans/0055 §7.1).
  const classBase =
    result.errorClass === "quota"
      ? "quota restricted"
      : result.errorClass === "auth"
        ? "provider auth failed"
        : result.errorClass === "rate"
          ? "rate-limit wait too long"
          : spent !== undefined
            ? `${spent} usage window spent`
            : undefined
  const classLabel = classBase !== undefined && result.classified ? `${classBase} (classifier)` : classBase
  // The quota-failover escalation (design D.3/D.4, P4): when the class is
  // quota/auth/rate — or a spent window states a reset, whatever the class
  // — the escalation runs: key → model → wait (plans/0055 §7). A ringed
  // provider rotates to its next key first, the model failover follows only
  // when no key is left, and the wait-and-probe loop takes what neither can
  // move. A spent window reaches here at once, skipping the retry ladder:
  // a fresh session would only hit it again.
  // AUTO-DECISION (0069 §2.2 D2, T-109): the candidate-table gate is gone
  // with the fields that fed it — every run has a registry since the
  // implicit registry (0061 F2), so the tier lists (or the /failback
  // override that replaces them) are always the candidate table and the
  // escalation runs on every class label. The collapse also retires the
  // spent-window recover arm below: a spent window always builds a class
  // label, which escalates here first.
  if (classLabel !== undefined) {
    return { kind: "escalate", label: classLabel, until: result.resetAt, classified: result.classified, cause }
  }
  // Non-retryable (isRetryable:false) outside the escalation classes:
  // switching sessions is pointless, and the escalation above did not fire
  // (no class label) — the wait-and-probe loop waits indefinitely for the
  // failure to clear, probing with fresh temporary sessions, and after
  // recovery forks the interrupted session to continue.
  if (result.retryable === false) {
    return { kind: "recover", why: `non-retryable session error encountered (${firstLine(result.question)})`, cause }
  }
  // Ladder exhausted: the failover candidates are tried first (switching
  // provider is the only lever outside the ladder not yet tried); when
  // those are exhausted too, the wait-and-probe loop takes over, every
  // interval until service recovers, then continuing from a fork of the
  // interrupted session with the ladder restarted.
  // AUTO-DECISION (0069 §2.2 D2, T-109): the no-candidate-table recover
  // arm of this branch is gone with the gate — unreachable in production
  // since 0061 F2 (the call site's registry flag was the constant true).
  if (ladder.i > facts.waits.length) {
    const why = `retry ladder exhausted (${facts.waits.length} retries) without success`
    return { kind: "after-ladder", why, cause }
  }
  // The backoff before this retry: the counter advances before the action
  // (the executor writes it), and a network/service failure restarts the
  // managed server before the retry goes out.
  return {
    kind: "retry",
    nth: ladder.i,
    waitMinutes: facts.waits[ladder.i - 1] ?? 0,
    restartServer: facts.server && NETWORK_FAILURE.test(result.question),
  }
}
