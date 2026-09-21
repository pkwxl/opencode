// Usage source (MA.2, design plans/0038): how much context a session occupies,
// and what the four usage-driven mechanisms do when the agent measures it
// exactly, reports it late, cannot report it (the driver estimates), or
// nothing is known at all. The tier is the adapter's `capabilities.usage`
// (agent/types.ts UsageTier).
//
// The whole matrix reduces to two questions per tier:
//   - is a value known? (`none`: never — callers see `undefined`)
//   - is it known *while the turn runs*? (`reported`: only once it ended)
// Every decision below takes `used: number | undefined` (undefined = unknown)
// and the tier's liveness; unknown always resolves to the side that does not
// carry context forward (no reuse, no fork) and does not end a session on a
// guess (no steer, no handover).
//
// | mechanism                       | events | reported      | estimated | none        |
// |---------------------------------|--------|---------------|-----------|-------------|
// | reuse (pct < 50, used < cap/2)  | today  | today         | estimate  | off         |
// | steer handover (used >= 2·cap)  | today  | off (no live) | estimate  | off         |
// | post-session handover check     | today¹ | off (no live) | estimate¹ | off         |
// | test handover (used >= cap)     | today  | today         | estimate  | off         |
// | fork base guard (used < cap/2)  | today  | today         | estimate  | cold start  |
// | failover window clamp           | window sizes, not usage: same in every tier  |
// ¹ also due when the hint went out, whatever the final figure (plans/0040 D6)
//
// Wired in MA.3 (plans/0039): watch tracks the session through usageSource
// and decides steer / test handover here, attempt decides reuse, execute the
// post-session check, session-api the fork base guard. For opencode (`events`)
// every decision equals the pre-MA.3 inline rules.
import type { AgentEvent, AgentPart, UsageTier } from "./agent/types"
import { REUSE_BELOW, REUSE_IDLE_MS } from "./chain"

// A value exists while the turn runs: in-turn triggers (the steer handover
// hint) can fire. `reported` learns the value only at turn end.
export function liveUsage(tier: UsageTier): boolean {
  return tier === "events" || tier === "estimated"
}

// Tracks one session's context occupancy from the unified event stream (the
// caller feeds only that session's events).
export type UsageSource = {
  readonly tier: UsageTier
  // A prompt sent to the session (initial prompt, steer text, test results).
  // Counts only for the estimated tier; measured tiers see it in the next
  // message's own figure.
  prompt(text: string): void
  observe(event: AgentEvent): void
  // Tokens occupying the context now; undefined when unknown (none, or no
  // measurement arrived yet).
  used(): number | undefined
}

// `start` seeds the estimated tier: the inherited occupancy of a reused or
// forked session, or the adapter's fixed overhead (system prompt, tool
// definitions) for a new one. Measured tiers ignore it — their figure is
// absolute.
export function usageSource(tier: UsageTier, start = 0): UsageSource {
  let measured: number | undefined
  let prompts = 0
  // Latest estimate per part id: adapters re-send a growing part, so only the
  // last size counts.
  const parts = new Map<string, number>()
  return {
    tier,
    prompt(text) {
      prompts += estimateTokens(text)
    },
    observe(event) {
      if (tier === "none") return
      if (tier !== "estimated") {
        // Same rule as watch.ts today: only completed assistant messages
        // settle the figure (an in-progress message still grows).
        if (event.type === "message" && event.message.role === "assistant" && event.message.completed) {
          if (event.message.contextUsed !== undefined) measured = event.message.contextUsed
        }
        return
      }
      if (event.type === "part") parts.set(event.part.id, partTokens(event.part))
    },
    used() {
      if (tier === "none") return undefined
      if (tier !== "estimated") return measured
      let sum = start + prompts
      for (const n of parts.values()) sum += n
      return sum
    },
  }
}

// Conservative token estimate: overestimating only makes the driver hand over
// or start fresh earlier (cost), underestimating lets a session run into the
// wall (failure). ASCII at 3 chars per token (English prose runs ~4, code
// ~3.5); every other code point counts as a whole token (CJK prompts and
// documents are the common case here). MA.5 calibrates against claude's
// reported figures.
export function estimateTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) ascii++
    else other++
  }
  return Math.ceil(ascii / 3) + other
}

function partTokens(part: AgentPart): number {
  switch (part.kind) {
    case "text":
    case "reasoning":
      return estimateTokens(part.text)
    case "tool":
      return estimateTokens(JSON.stringify(part.input ?? {})) + estimateTokens(part.output ?? "") + estimateTokens(part.error ?? "")
    default:
      // step-start / step-finish / note carry no context content of their own.
      return 0
  }
}

// ── Decisions (one per mechanism; `events` rows equal today's inline rules) ──

// Session reuse between prompts of a chain (attempt.ts; only with
// OPENCODE_AUTO_REUSE_SESSION=on). pct is 100 whenever the context window is
// unknown, which already turns reuse off; unknown usage does the same.
export function reuseAllowed(prev: { pct: number; used: number | undefined; at: number }, cap: number, now: number): boolean {
  if (prev.used === undefined) return false
  return prev.pct < REUSE_BELOW && prev.used < cap / 2 && now - prev.at <= REUSE_IDLE_MS
}

// In-turn steer handover hint (watch.ts, used >= steer.limit = 2·cap). Needs
// a live figure: under `reported` the turn is over before the value exists.
export function steerDue(tier: UsageTier, used: number | undefined, limit: number): boolean {
  return liveUsage(tier) && used !== undefined && used >= limit
}

// Post-session handover check (execute.ts; was testrun.ts handoverDue): "the
// session was over the cap, so it was asked for a handover document". Without
// a steer (OPENCODE_AUTO_STEER=off, or the off-mode whole-task session) a
// natural finish is accepted and no document is demanded; the test handover
// is a separate mechanism and never goes through this check. Only true where the
// in-turn hint could have been sent — a `reported` session over the cap was
// never asked, and demanding the document would misjudge a natural finish.
// `hinted` = the hint actually went out in this session (plans/0040 D6): the
// final figure alone misses a session that compacted after the hint and ended
// below 2·cap with a written `状态: 继续` handover (0038 §6 latent). OR-ed, so
// every session judged due before still is.
export function sessionHandoverDue(tier: UsageTier, steer: { limit: number } | undefined, used: number | undefined, hinted = false): boolean {
  return steer !== undefined && (hinted || steerDue(tier, used, steer.limit))
}

// Test handover at the moment the session requests a test run (watch.ts; was
// testrun.ts testHandoverDue; plans/0023 D1): context at the cap alone
// decides, no longer combined with a failing test, and the moment is fixed at
// the test request (tmp/test.sh appears) — the one naturally clean cut, as
// requesting a test usually means the related work is done. The request is
// read at idle, so a turn-end figure is already in (`reported` works). Before
// any figure arrives the session's starting occupancy decides; both unknown →
// no handover.
export function testHandoverDue(
  test: { handover: boolean; limit: number; startUsed: number | undefined },
  used: number | undefined,
): boolean {
  if (!test.handover) return false
  // Today a measured 0 means "nothing arrived yet"; keep that reading.
  const basis = used !== undefined && used > 0 ? used : test.startUsed
  return basis !== undefined && basis >= test.limit
}

// Fork seeding from a base session (session-api.ts seedForkSession): forking
// a base whose prefix is already half the cap makes the new session start
// near the wall. An unknown base size is treated as full: cold start.
export function forkBaseAllowed(baseUsed: number | undefined, cap: number): boolean {
  return baseUsed !== undefined && baseUsed < cap / 2
}
