// Session chain and model routing evaluation: the state carriers of the task's
// chained sessions (SessionChain / Watch / SessionResult / FailedSession /
// ForkBaseInfo), the phase → role → model routing evaluation (phaseToRole /
// roleOf / resolveModel), session error classification (classifySessionError),
// and the session reuse threshold constants. See plans/0017-model-routing-design.md.
// Split from src/runner.ts (plans/0024-module-split-plan.md S2, pure move).
import type { AgentErrorPatterns } from "./agent/types"
import { type UnitBaseline } from "./git"
import { type ResolveEvent } from "./resolve"
import { type Phase } from "./resume"
import { type Usage } from "./stats"
import type { PhaseTypeEntry, Tier } from "./phases/registry"
import { type ModelPolicy, type ModelRole } from "./switches"

export type Watch = {
  // In-session blocking (askHuman timeout fallback / permission denial) is
  // always the blocked shape, never dirty — dirty arises only at the unit
  // start gate (runSubtask/requireArtifact/beginUnit), before any session.
  blocked?: { type: "blocked"; question: string }
  error?: string
  lastText: string
  // Context percentage (0-100) of the session's last assistant message;
  // recorded as 100 when the limit is unknown.
  pct: number
  // Context usage of the session's last assistant message (tokens:
  // input + cache.read).
  used: number
  // Context limit (tokens), used to compute pct; undefined when unknown.
  limit?: number
  // Session duration (ms).
  durationMs?: number
  // --handover-test: after the driver issued the test-handover requirement,
  // the session wrote the handover document and ended normally; runExecSession
  // opens a new continuation session on it.
  testHandover?: boolean
  // The in-turn handover hint went out in this session (plans/0040 D6; set
  // only when true). The post-session check reads it next to the final figure.
  hinted?: boolean
  // Context steps (plans/0055 §4.5): the session stepped up in place during
  // this watch — at the step-up point (the steer) or after the agent
  // compacted first (the late step-up). Carries the step index the session
  // reached and the model id it now runs on; attempt writes both onto the
  // chain, so the session's next prompt and every later steer name the id.
  // Set only under a registry, only when a step-up happened.
  steppedUp?: { step: number; model: string }
  // plans/0015-session-error-retry-plan.md: whether the session error is
  // worth retrying (only ApiError carries isRetryable; when the field is
  // absent or not false it always counts as retryable, the conservative
  // default; with several session.error events stacked the pessimistic
  // reading wins — one false ever seen makes it unretryable).
  retryable?: boolean
  // plans/0017-model-routing-design.md D.2: the structured error data
  // accumulated incrementally across the three trigger surfaces (message/
  // statusCode/isRetryable/responseBody, the 3rd signal adds attempt/next),
  // for classification and reporting.
  errorInfo?: ErrorInfo
  // The classification of the above errorInfo through classifySessionError
  // (meaningful only when error information exists).
  errorClass?: ErrorClass
  // Set true only on the two early-settlement surfaces, the retry part and
  // session.status retry: marks this error as failover-eligible for
  // runSession's P4 failover decision to read (this only marks, it does not
  // pick a candidate).
  failover?: boolean
  // This turn's token increments, accumulated (STATS_PLAN §2, T-003): per
  // step-finish part, summed with part.id dedup — the only accounting that
  // neither duplicates nor misses (the server-side assistantMessage.tokens
  // is a last-step overwrite and session.tokens carries the fork-inherited
  // prefix; neither can be summed directly, and neither may be fallen back
  // to). attempt books it through statsSessionEnd when the turn ends.
  usage?: Usage
  // The questions the driver proxy-answered this turn (auto-resolve H1/H2,
  // plans/0020-auto-resolve-design.md §G): fully isomorphic to usage —
  // carried out uniformly by snapshot, through all 7 return exits
  // (including the error/blocked early-settlement exits) without missing
  // one; attempt fills in the bucket identity and books them via
  // recordResolves when the turn ends.
  resolves?: ResolveEvent[]
  // Test-handover write check failed (strict recovery,
  // plans/0022-session-recovery-fidelity-design.md 3.3): the session was
  // asked to write the test handover document but the document is missing/
  // empty; strict mode does no backfill-write retry — attempt folds this
  // into the rollback flag of SessionResult below, and the unit owner rolls
  // back and redoes the unit from a cold start.
  testHandoverInvalid?: boolean
}

export type SessionResult =
  | { type: "idle"; lastText: string; testHandover?: boolean }
  | ({ type: "blocked"; question: string; retryable?: boolean; failover?: boolean; errorClass?: ErrorClass } & {
      // Strict recovery: this blocked outcome was triggered by an invalid
      // handover document; the unit owner (executeWhole/runSubtask) rolls
      // back to the unit baseline and redoes the unit from a cold start
      // instead of propagating the block upward; callers without a baseline
      // ignore the flag.
      rollback?: boolean
      // Registry routing (plans/0055 §6.3): selection found no usable model
      // for this dispatch — every candidate of the list is down or outside
      // its windows. runSession sends the prompt to the wait-and-probe loop
      // instead of treating this as a session failure.
      noModel?: boolean
      // The §6.3 wait decision (with noModel): every candidate is blocked
      // only by its windows and one that is not down opens later, so the
      // dispatch waits inside the unit instead of probing. runSession sleeps
      // until `until` plus hibernate's jitter and then selects again; the
      // facts carry what the wait line names.
      windowWait?: WindowWait
    })

// The window wait of one dispatch (plans/0055 §6.3): `until` is the earliest
// opening among the candidates that are not down (epoch ms), `model` the
// candidate that opens then (the key selection knows it by), `tier` the
// dispatch's list tier and `opens` the formatted opening ("opens 18:00
// Asia/Shanghai") for the wait line.
export type WindowWait = { until: number; model: string; tier: Tier; opens: string }

// All sessions of a task (decompose/subtask/repair/wrap-up) chain into one
// session chain: reuse is governed by OPENCODE_AUTO_REUSE_SESSION, default
// off = every prompt opens a new session; when on, the previous session is
// reused only if, at its end, the context percentage was below REUSE_BELOW,
// the usage below half of contextLimit, and no more than REUSE_IDLE_MS has
// passed since it ended. The initial pct=100 guarantees the first session is
// newly created; when the model limit is unknown watch records 100, i.e.
// always a new one. A session taken over by interruption recovery is exempt
// from the switch and the thresholds (attempt's resumed: the chain holds a
// session and a note awaits injection → the first prompt necessarily enters
// the original session).
// phase carries the current pipeline phase: the execution chain's sessions
// write the progress record (.auto/progress.json) from it; the chain of a
// one-shot bypass session (requireArtifact) carries no phase and writes no
// record, to avoid polluting the execution chain's memory. note is a
// one-shot remark (given to the AI with the first prompt during
// interruption recovery, cleared once used). subject is the commit title of
// this session's work (the short-label scheme): a newly created session is
// explicitly named by it, a reused session is renamed at its end when
// crossing phases (see renameSession), keeping the session list aligned
// with git history and task progress.
// The fork three-part scheme (fork-decompose design §4.3): forkBase is this
// chain's fork-base session (carried by the seed chain, for provenance);
// pending is a pre-created session id (what seedForkSession forked from the
// base), which attempt() consumes first when !reuse (equivalent to the
// result of session.create), cleared on consumption — a transient-error
// retry naturally falls back to the create path.
// modelShown is the model already announced to the terminal (each prompt
// compares against the target it evaluated — falling back to the
// server-effective model when no routing is set — and re-announces the
// "◈ … using model" line when the model changed; a new session
// (created/forked) is always announced, a continuation prompt on the same
// session and model is not repeated; memory-only, never persisted).
// The selection state under the model registry (plans/0055 §6.2, §12):
// modelEntry is the internal name of the chosen entry (for a raw override
// value, its model string) — continuation detection, failover marks and
// strict-recovery records all key on it; under the registry, model instead
// stores "the model id actually dispatched to the adapter" (undefined for an
// entry without model, the prompt carries no model key) and doubles as the
// continuation detection's current (after the session steps up it equals
// the reached step's id); modelStep is the context step the session reached
// (0 = the base step, §4.5; the step-up mechanism is a later step, only the
// base position is recorded here). Without a registry all three stay
// undefined, and the original semantics hold byte for byte.
// baseline is the current execution unit's SHA baseline (strict recovery,
// plans/0022-session-recovery-fidelity-design.md 3.1 ③): taken at the
// runTask entry / the persistStage phase boundary / the runSubtask subtask
// gate / the requireArtifact unit gate, recorded alongside attempt's write
// of the active record; recovery verifies against it and rolls back to it.
// hinted: the chain's current session was sent the in-turn handover hint
// (copied from its Watch by attempt; plans/0040 D6).
export type SessionChain = { id?: string; pct: number; used: number; at: number; hinted?: boolean; note?: string; phase?: Phase; subject?: string; forkBase?: string; pending?: string; role?: ModelRole; model?: string; modelEntry?: string; modelStep?: number; failed?: FailedSession; modelShown?: string; baseline?: UnitBaseline }

// The body of the session that just ended with a retryable error (id + end
// usage). The chain state at that moment was already restored to the
// pre-dispatch snapshot (the original session is not sacrificed), and the
// failed session itself went out of scope with it — it is recorded here
// separately so the retry can fork from "the session with the most
// accumulated this round": under timeout-type failures, the 100k+ of
// verified research inside the failed session is the most valuable asset;
// opening a blank session means throwing it away and hitting the same wall
// from zero again. The copy does not replace the recovery point (progress's
// restore logic is untouched, the original session stays the recovery
// point); cleared once promoted.
// Record-replacement invariant (2026-09-17, field fix after consecutive
// quota failures): only a failure with used > 0 replaces it (the fork copy
// carries the old prefix and runs new content on top, a strict superset); a
// 0-token pure-error stub does not — otherwise a copy that dies on dispatch
// overwrites the record with itself, the next retry round loses the most
// valuable fork source and degrades to cold-seeding from the base. After
// fork seeding the record is deliberately kept (not cleared) until the copy
// closes out successfully (attempt clears it) or produces content
// (replaces it); a dead record whose fork is already invalid is cleaned up
// in passing by the source-picking loop.
export type FailedSession = { id: string; used: number }

// Fork-base information: id is the effective base session; used is the
// base's end context usage (tokens, seeded into the forked chain so that
// watch()'s 2×cap handover threshold counts "prefix + new"; the first
// turn's event tracking corrects it by itself afterwards). undefined
// = unknown (an agent without readable history, MA.4): seedForkSession then
// starts cold (plans/0038 G1).
export type ForkBaseInfo = { id: string; used: number | undefined }

// resume.Phase → session role (the fine-grained key of model routing, see
// plans/0017-model-routing-design.md B.5/C.1). Each phase of the execution
// chain maps to the like-named role (decompose is the role of the M1.0
// merged understand-and-decompose session, plans/0030 D12); subtasks takes
// the singular subtask; closeout has no session (bypass); a step variant's
// English slug is the StepKind (phase-plan / phase-handover), except
// phase-append, the append variant of the planning session (plans/0053
// D23/F6): routing keeps the phase-plan role and adds no new role word, so
// existing routing config keeps working. Returns undefined when phase is
// absent — roleOf then lands on bypass (a bare chain, and bypass sessions
// without a phase).
export function phaseToRole(phase: Phase | undefined): ModelRole | undefined {
  if (!phase) return undefined
  switch (phase.kind) {
    case "decompose":
      return "decompose"
    case "whole":
      return "whole"
    case "subtasks":
      return "subtask"
    case "wrapup":
      return "wrapup"
    case "closeout":
      return undefined
    case "step":
      return phase.step === "phase-handover" ? "phase-handover" : "phase-plan"
  }
}

// The session role (one of the routing keys): the explicit chain.role (set
// by a bypass through requireArtifact's spec.role) wins, then derivation
// from the execution chain's phase, then bypass as the final fallback. See
// design B.5/C.1.
export function roleOf(chain: SessionChain): ModelRole {
  return chain.role ?? phaseToRole(chain.phase) ?? "bypass"
}

// Routing evaluation (design C.1, priority fine to coarse): role > phase
// type id > preset letter > wildcard; when none hits, returns undefined (=
// no model). With both variables unset, the empty policy is undefined for
// every (phase, role), keeping the prompt byte-for-byte equivalent to the
// status quo. phase is the current phase's type entry (M3.6: custom types
// carry only the type key, builtin types accept both keys).
export function resolveModel(policy: ModelPolicy, phase: PhaseTypeEntry | undefined, role: ModelRole): string | undefined {
  return (
    policy.byRole[role] ??
    (phase ? (policy.byType[phase.type] ?? (phase.letter ? policy.byLetter[phase.letter] : undefined)) : undefined) ??
    policy.wildcard
  )
}

// Session error classification (plans/0017-model-routing-design.md D.1):
// whether switching models could help — the decision basis of failover
// (P4). Deliberately different from opencode retry.ts's RETRYABLE regex
// (which asks "is retrying useful?") — here the question is "is switching
// to a candidate model useful?". The default unknown means uncertain, and
// P4 conservatively does not switch on it.
export type ErrorClass = "quota" | "auth" | "rate" | "overflow" | "transient" | "unknown"

// The classifier's structured input: taken from B.4's three trigger
// surfaces — session.error's data, the retry part's ApiError.data
// (+attempt), and the session.status retry variant (+attempt, next). All
// fields optional, for incremental accumulation across signals (see the
// errorInfo accumulator inside watch).
export type ErrorInfo = {
  message?: string
  statusCode?: number
  isRetryable?: boolean
  responseBody?: string
  attempt?: number
  next?: number
}

// The classification criteria live here (design G.2: when a new provider's
// wording slips through, the regexes evolve here, regressed by
// test/chain.test.ts's fixed message samples). The classifier asks "is
// switching models useful?", unlike opencode's own retry classifier.
// Neutral wording only (MA.3, plans/0039): an agent's own error type names
// (opencode ContextOverflowError / ProviderAuthError) come from its adapter's
// AgentClient.errorPatterns and are OR-ed in per class. Overflow has no
// neutral pattern: it is recognized by agent-specific names alone.
const QUOTA_RE = /insufficient_quota|quota|balance|credit|usage limit/i
const AUTH_RE = /unauthorized|forbidden/i
const RATE_RE = /rate limit|resource exhausted/i
// Numeric status codes need digit/dot boundaries: a bare 500|502|503|504
// would misclassify "Error 1500", "code 5042" or version "5.0.4" as
// transient (2026-09-17 review H4). Substrings inside long numbers and
// version numbers carry no "server 5xx" signal; they should land on
// unknown, conservatively not switching models.
const TRANSIENT_RE = /overloaded|timeout|timed out|econn|socket hang up|network|temporar|internal server error|bad gateway|service unavailable|(?<![\d.])50[0234](?![\d.])/i
const QUOTA_STATUS = 402
// rate thresholds: a lone 429 only means opencode is still backing off (not
// enough to switch models on); rate requires "retried enough times" or
// "next wait above threshold" (design D.1 rate row, B.4 2nd signal).
const RATE_ATTEMPTS = 3
const RATE_WAIT_MS = 60_000

// Classification priority (top to bottom, first hit returns; matches the
// design D.1 criteria table):
//   1. overflow   — the message names a context-overflow error (opencode:
//                   ContextOverflowError; handled by the handover mechanism,
//                   explicitly no switch).
//   2. quota      — the server says outright non-retryable, or quota/
//                   balance/credit wording, or 402.
//   3. auth       — 401/403 or auth/forbidden wording (provider unusable).
//   4. rate       — 429/rate-limit wording plus retries reached or a next
//                   wait above threshold.
//   5. transient  — a known transient error (existing retry path, no model
//                   switch).
//   6. unknown    — conservative default (no switch when uncertain).
export function classifySessionError(info: ErrorInfo, extra: AgentErrorPatterns = {}): ErrorClass {
  const hay = `${info.message ?? ""}\n${info.responseBody ?? ""}`
  const hit = (neutral: RegExp | undefined, own: RegExp | undefined) => (neutral?.test(hay) ?? false) || (own?.test(hay) ?? false)
  if (hit(undefined, extra.overflow)) return "overflow"
  if (info.isRetryable === false || hit(QUOTA_RE, extra.quota) || info.statusCode === QUOTA_STATUS) return "quota"
  if (info.statusCode === 401 || info.statusCode === 403 || hit(AUTH_RE, extra.auth)) return "auth"
  const rateSignal = info.statusCode === 429 || hit(RATE_RE, extra.rate)
  const rateThreshold = (info.attempt ?? 0) >= RATE_ATTEMPTS || (info.next ?? 0) > RATE_WAIT_MS
  if (rateSignal && rateThreshold) return "rate"
  if (hit(TRANSIENT_RE, extra.transient)) return "transient"
  return "unknown"
}

// Reuse the previous session when its context percentage is below this
// value (%) (effective only with OPENCODE_AUTO_REUSE_SESSION=on).
export const REUSE_BELOW = 50

// The interval cap for session reuse (effective only with
// OPENCODE_AUTO_REUSE_SESSION=on): more than this since the previous
// session ended counts as stale context (driver-side work such as
// test-script runs can take long) — no reuse, open a new session.
export const REUSE_IDLE_MS = 5 * 60 * 1000
export const REUSE_IDLE_MINUTES = REUSE_IDLE_MS / 60_000
