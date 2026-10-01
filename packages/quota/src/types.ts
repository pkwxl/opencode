// Public types of the quota module (plan 0066 §6).
//
// This package is advisory-only: it produces quota data for "which provider /
// account still has headroom" decisions and never triggers a switch itself.
// Failure semantics are "no answer" — every failure is a Result, nothing throws
// across the public boundary.

export type ProviderId = "kimi" | "zhipu"

/**
 * Minimal structural fetch for injection (tests use doubles). Bun's `typeof
 * fetch` carries a `preconnect` property, so the adapters type their
 * injectable as this plain callable instead.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Same shape as auto-core's agent/opencode client settle result (plan 0066 §6). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number }

export type WindowScope = "5h" | "7d" | "day" | "unknown"

/**
 * One rate-limit window. `utilization` is 0..1; `resetAt` is epoch ms and may
 * lie in the past — both providers define reset = last consumption + window
 * length, so an idle window keeps a stale instant that means "resets on next
 * consumption". Never schedule a wait on it.
 */
export interface QuotaWindow {
  scope: WindowScope
  utilization: number
  resetAt?: number
  enabled?: boolean
  /** Amount consumed this window (zhipu `currentValue`, passthrough). */
  used?: number
  /**
   * The window's current allowance (zhipu `usage`). It mutates with the plan
   * tier (pro→max raised it mid-day in the live probe) — never cache as fixed.
   */
  limit?: number
  /** Remaining amount exactly as the server reports it — never recomputed. */
  remaining?: number
  /** Unmapped server fields for `scope: "unknown"` windows. */
  raw?: Record<string, unknown>
}

/** Monthly subscription balance (not a rate-limit window — kept separate, plan 0066 §2). */
export interface QuotaSubscription {
  amountUsedRatio: number
  kimiCodeUsedRatio?: number
  /** Subscription expiry (kimi `expireTime`), epoch ms. */
  expireAt?: number
  unit?: string
  feature?: string
  domain?: string
}

export interface QuotaSnapshot {
  provider: ProviderId
  account: string
  fetchedAt: number
  /** Decoded JWT `exp` in epoch ms (converted from the token's exp seconds; plan 0066 §10). Undefined when the payload has no exp or is undecodable — zhipu's web JWT never yields it. */
  tokenExpiresAt?: number
  /** True when the token expires within 24h. Only defined together with tokenExpiresAt. */
  tokenStale?: boolean
  windows: QuotaWindow[]
  /** zhipu plan tier string ("pro" / "max" observed). */
  level?: string
  subscription?: QuotaSubscription
}

/** Options for the per-provider adapters. `fetchImpl` is injectable for tests. */
export interface AdapterOptions {
  token: string
  /** Account label carried into the snapshot; defaults to "adhoc". */
  account?: string
  /** zhipu multi-org/project passthrough headers (stored as account metadata). */
  org?: string
  project?: string
  fetchImpl?: FetchLike
  /** Request timeout, ms; the default is 10s and there is no retry (advisory: a failure is "no answer"). */
  timeoutMs?: number
}
