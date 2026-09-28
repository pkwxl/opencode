// Session chain and model routing evaluation: the state carriers of the task's
// chained sessions (SessionChain / Watch / SessionResult / FailedSession /
// ForkBaseInfo), the phase → role → model routing evaluation (phaseToRole /
// roleOf / resolveModel), session error classification (classifySessionError),
// and the session reuse threshold constants. See plans/0017-model-routing-design.md.
// Split from src/runner.ts (plans/0024-module-split-plan.md S2, pure move).
import type { AgentErrorPatterns, AgentRetryPolicy, LimitScope } from "./agent/types"
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
  // The effective handover wall of this session's last measurement (testrun.ts
  // steerWall; set only with a steer and a measured figure). The post-session
  // check measures the final figure against it where it lies above the 2×cap
  // budget (a large window, plans/0059 D6), so a session that finished under
  // a wall it was never hinted at is not judged due.
  wall?: number
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
  // The failure-message classifier (plans/0055 §7.1; set only under a
  // registry with a classifier list, only when its answer applies):
  // `classified` = errorClass came from the classifier's answer, which raised
  // the pattern verdict (the ◈ and ⇄ lines mark the move "(classifier)");
  // `resetAt` = the reset time (epoch ms, accepted only in the future and at
  // most 7 days away) the provider or the agent stated (errorInfo.resetAt,
  // plans/0057 §5.3), else the answer's, which the escalation's down mark
  // lasts until instead of the scope boundary; `pendingReset` = an answer
  // still on its way when the turn ended and nothing stated a reset,
  // resolving to such a reset time or undefined — it can only set when the
  // down marks written for this failure clear, never change the class.
  // `scope` = the limit a stated resetAt belongs to (errorInfo.scope, plans/
  // 0057 §7): a spent five-hour, daily or weekly window skips the retry
  // ladder, and the wait line names it. Absent with a classifier's reset.
  // `resetSource` = who gave resetAt, a statement or the classifier: the
  // learned-window record keeps it (plans/0057 §8).
  classified?: boolean
  resetAt?: number
  scope?: LimitScope
  resetSource?: "stated" | "classifier"
  pendingReset?: Promise<number | undefined>
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
  | ({ type: "blocked"; question: string; retryable?: boolean; failover?: boolean; errorClass?: ErrorClass } & Pick<Watch, "classified" | "resetAt" | "scope" | "resetSource" | "pendingReset"> & {
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
// session chain: every prompt opens a fresh session — in-chain threshold
// reuse was removed together with its switch. The initial pct=100 guarantees
// the first session is newly created; when the model limit is unknown watch
// records 100, i.e. always a new one. The one exception is a session taken
// over by interruption recovery (attempt's resumed: the chain holds a
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
// Session-agent binding (plans/0055 §8.2): the agent profile this chain's
// session lives on. Session ids are agent-local (an opencode session cannot be
// resumed or forked by claude, and the reverse holds too), so the chain
// records where its session is; while the run has one agent (until the agent
// pool) every create, fork and reuse acquires it on the run's profile
// (RoutingFacts.runAgent), set at dispatch in attempt. Set only under a
// registry; absent = the default agent's session, so a chain of the
// no-registry era reads correctly.
// baseline is the current execution unit's SHA baseline (strict recovery,
// plans/0022-session-recovery-fidelity-design.md 3.1 ③): taken at the
// runTask entry / the persistStage phase boundary / the runSubtask subtask
// gate / the requireArtifact unit gate, recorded alongside attempt's write
// of the active record; recovery verifies against it and rolls back to it.
// hinted: the chain's current session was sent the in-turn handover hint
// (copied from its Watch by attempt; plans/0040 D6). wall: the effective
// handover wall of its last measurement (copied the same way; plans/0059 D6).
// forkLead: forkBase is auto's lead (ForkBaseInfo.lead), so a retry that
// re-seeds from it forks it the same way the stream's first session did.
// AUTO-DECISION: the lead flag rides the chain beside forkBase (the transient-error retry re-seeds from chain.forkBase alone; without the flag the cap/2 guard would turn that retry into a new session sent the delta prompt, which assumes the lead's context)
export type SessionChain = { id?: string; pct: number; used: number; at: number; hinted?: boolean; wall?: number; note?: string; phase?: Phase; subject?: string; forkBase?: string; forkLead?: boolean; pending?: string; role?: ModelRole; model?: string; modelEntry?: string; modelStep?: number; agent?: string; failed?: FailedSession; modelShown?: string; baseline?: UnitBaseline }

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
// agent (plans/0055 §8.4, under a registry only) names the agent profile the
// base session lives on: a base is agent-local like every session (§8.2), so
// the fork seeds on that agent's host and the chain's binding follows it.
// Without a registry the field stays undefined and the seeding keeps reading
// the chain alone.
// lead (plans/0059 D5) marks auto's lead as the base of its split's streams:
// seeding forks it whatever its size (usage.ts forkBaseAllowed).
// digest (plans/0059 T2) marks the planned pipeline's digest base: a fork of
// it holds the context.md digest alone, not the files the decompose session
// read, and the subtask prompt says so (the session base holds both).
export type ForkBaseInfo = { id: string; used: number | undefined; agent?: string; lead?: boolean; digest?: boolean }

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
  // The agent's error event arrived: its turn failed and it stopped retrying
  // (plans/0057 §4.1), as opposed to a retry signal it is still working
  // through.
  terminal?: boolean
  // What the provider or the agent stated about the limit (AgentError's
  // limit fields, plans/0057 §5), the latest statement of the turn. They ride
  // beside the class and never decide it (C7): a stated resetAt outranks the
  // failure-message classifier's (§5.3) and spares asking it.
  retryAfterMs?: number
  resetAt?: number
  scope?: LimitScope
  limitReason?: string
}

// The classification criteria live here (design G.2: when a new provider's
// wording slips through, the regexes evolve here, regressed by
// test/chain.test.ts's fixed message samples). The classifier asks "is
// switching models useful?", unlike opencode's own retry classifier.
// Neutral wording only (MA.3, plans/0039): an agent's own error type names
// (opencode ContextOverflowError / ProviderAuthError) come from its adapter's
// AgentClient.errorPatterns and are OR-ed in per class. Overflow has no
// neutral pattern: it is recognized by agent-specific names alone.
// "limit exhausted" is Zhipu's weekly/monthly wording (plans/0057 F24); a bare
// "limit reached" would also catch its per-minute "Rate limit reached for
// requests", which the agent's own backoff cures.
const QUOTA_RE = /insufficient_quota|quota|balance|credit|usage limit|limit exhausted/i
const AUTH_RE = /unauthorized|forbidden/i
const RATE_RE = /rate limit|resource exhausted/i
// Numeric status codes need digit/dot boundaries: a bare 500|502|503|504
// would misclassify "Error 1500", "code 5042" or version "5.0.4" as
// transient (2026-09-17 review H4). Substrings inside long numbers and
// version numbers carry no "server 5xx" signal; they should land on
// unknown, conservatively not switching models.
const TRANSIENT_RE = /overloaded|timeout|timed out|econn|socket hang up|network|temporar|internal server error|bad gateway|service unavailable|(?<![\d.])50[0234](?![\d.])/i
const QUOTA_STATUS = 402

// The retry policy the driver assumes for an agent that declares none
// (plans/0057 §4.3): the rate threshold of plans/0017 D.1 (a lone 429 only
// means the agent is still backing off, not enough to switch models on; rate
// requires "retried three times" or "next wait above a minute") as a policy
// record, so both paths run through agentGaveUp. It waits out whatever it
// meets and announces no silence.
export const NEUTRAL_RETRY_POLICY: AgentRetryPolicy = {
  maxAttempts: 3,
  backoffCapMs: 60_000,
  honorsRetryAfter: false,
  waitsOutLimit: true,
  silenceBudgetMs: 60_000,
}

// The policy one session runs under: the adapter's record (else the neutral
// one) with a registry entry's override laid over it field by field (plans/
// 0057 §11 item 3).
export function retryPolicyOf(agent: AgentRetryPolicy | undefined, override?: Partial<AgentRetryPolicy>): AgentRetryPolicy {
  return { ...(agent ?? NEUTRAL_RETRY_POLICY), ...override }
}

// Classification priority (top to bottom, first hit returns; matches the
// design D.1 criteria table):
//   1. overflow   — the message names a context-overflow error (opencode:
//                   ContextOverflowError; handled by the handover mechanism,
//                   explicitly no switch).
//   2. quota      — the server says outright non-retryable, or quota/
//                   balance/credit wording, or 402.
//   3. auth       — 401/403 or auth/forbidden wording (provider unusable).
//   4. rate       — 429/rate-limit wording, once the agent's own retrying
//                   gave up (agentGaveUp under its retry policy).
//   5. transient  — a known transient error (existing retry path, no model
//                   switch).
//   6. unknown    — conservative default (no switch when uncertain).
export function classifySessionError(info: ErrorInfo, extra: AgentErrorPatterns = {}, policy: AgentRetryPolicy = NEUTRAL_RETRY_POLICY): ErrorClass {
  const hit = hitter(info)
  if (hit(undefined, extra.overflow)) return "overflow"
  if (info.isRetryable === false || hit(QUOTA_RE, extra.quota) || info.statusCode === QUOTA_STATUS) return "quota"
  if (info.statusCode === 401 || info.statusCode === 403 || hit(AUTH_RE, extra.auth)) return "auth"
  if (rateSignal(info, extra) && rateThresholdMet(info, policy)) return "rate"
  if (hit(TRANSIENT_RE, extra.transient)) return "transient"
  return "unknown"
}

// Pattern tests over the merged message + response body: the neutral pattern
// or the agent's own, either one hits.
function hitter(info: ErrorInfo): (neutral: RegExp | undefined, own: RegExp | undefined) => boolean {
  const hay = `${info.message ?? ""}\n${info.responseBody ?? ""}`
  return (neutral, own) => (neutral?.test(hay) ?? false) || (own?.test(hay) ?? false)
}

// A spent window stated in the provider's own words (plans/0057 S4a, F24):
// for providers that send no rate-limit headers the error text is the only
// statement of the reset, and a known wording reads as deterministically as a
// header. It ranks below a reset the agent states in structured form (a
// header, claude's stream) and above the failure-message classifier (C3),
// which is then not asked. Zhipu's coding plans name the window and the reset
// instant in Beijing time with no offset ("Usage limit reached for 5 hour.
// Your limit will reset at 2026-09-16 06:28:10"); the field run of 2026-09-15
// fixes the zone: read as +08:00 that reset was 2h56m after the refusal, read
// as UTC 10h55m, which no five-hour window allows. The wording is matched,
// not the agent: the same text reaches the driver through any adapter.
const WORDING_WINDOWS: { re: RegExp; scope: LimitScope; maxMs?: number }[] = [
  { re: /usage limit reached for 5 hour/i, scope: "5h", maxMs: 5 * 3_600_000 },
  { re: /weekly\/monthly limit exhausted/i, scope: "7d" },
]
const WORDING_RESET_RE = /your limit will reset at (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/i
const WORDING_ZONE = "+08:00"
// Rounding and clock drift between the provider and this host.
const WORDING_SLACK_MS = 60_000

// The reset a known wording states, with its scope; undefined when the text
// matches no row, or its instant is past or further away than the window's
// own length (a misread zone is dropped, not guessed). The horizon of a
// stated reset (classify.ts acceptedReset) still applies downstream.
export function statedInWording(text: string, now: number): { resetAt: number; scope: LimitScope } | undefined {
  const row = WORDING_WINDOWS.find((w) => w.re.test(text))
  const got = row !== undefined ? WORDING_RESET_RE.exec(text) : null
  if (row === undefined || got === null) return undefined
  const at = Date.parse(`${got[1]}T${got[2]}${WORDING_ZONE}`)
  if (!Number.isFinite(at) || at <= now) return undefined
  if (row.maxMs !== undefined && at > now + row.maxMs + WORDING_SLACK_MS) return undefined
  return { resetAt: at, scope: row.scope }
}

// A rate signal: a 429, or rate-limit wording (neutral or the agent's own).
// It counts as the rate class only once the threshold below holds; below it,
// the agent is still backing off and the signal classes as transient or
// unknown. The failure-message classifier (src/classify.ts, plans/0055 §7.1)
// is asked about exactly that below-threshold case.
export function rateSignal(info: ErrorInfo, extra: AgentErrorPatterns = {}): boolean {
  return info.statusCode === 429 || hitter(info)(RATE_RE, extra.rate)
}

// The rate threshold: a rate signal counts as the rate class once the agent
// gave up curing it by itself.
export function rateThresholdMet(info: ErrorInfo, policy: AgentRetryPolicy = NEUTRAL_RETRY_POLICY): boolean {
  return agentGaveUp(info, policy)
}

// Whether the agent's own retrying will not cure this failure (plans/0057
// §4.1), under its declared policy: its attempt cap is spent; or the wait it
// announced is longer than any backoff of its own, so it cures nothing before
// that wait is over; or its turn already ended on the failure and it does not
// wait out a limit.
export function agentGaveUp(info: ErrorInfo, policy: AgentRetryPolicy): boolean {
  if (policy.maxAttempts !== undefined && (info.attempt ?? 0) >= policy.maxAttempts) return true
  if ((info.next ?? 0) > policy.backoffCapMs) return true
  return !policy.waitsOutLimit && info.terminal === true
}
