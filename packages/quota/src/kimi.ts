// kimi adapter — POST GetSubscriptionStats (Connect-RPC over JSON), direct JSON
// response without an envelope.
//
// Endpoint facts are live-probed (2026-10-01, plan 0066 §3.1):
// - Minimal header set is exactly Authorization: Bearer <JWT> + Content-Type:
//   application/json. Missing Content-Type trips HTTP 415 at the gateway before
//   auth; connect-protocol-version / x-msh-* / x-language / r-timezone /
//   origin / referer / user-agent are all optional.
// - The only credential class this endpoint accepts is the 15-minute access
//   Bearer (TTL exactly 900s); the long-lived kimi-auth cookie is rejected per
//   its own exp even with full browser context.
// - 401 (expired and invalid are the same shape) is a real HTTP status; the
//   body message may embed token material — never passed through.
// - `ratio` is optional: a fresh window with zero consumption returns only
//   enabled + resetTime; normalization then yields utilization 0.

import type { AdapterOptions, QuotaSnapshot, QuotaSubscription, QuotaWindow, Result, WindowScope } from "./types.js"
import { asRec, clamp01, DEFAULT_TIMEOUT_MS, fetchErrorMessage, INVALID_TOKEN_401 } from "./util.js"
import { expiryInfo } from "./jwt.js"

const ENDPOINT =
  "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats"

export async function queryKimi(opts: AdapterOptions): Promise<Result<QuotaSnapshot>> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let res: Response
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    return { ok: false, error: fetchErrorMessage(e, timeoutMs) }
  }
  if (res.status === 401) return { ok: false, error: INVALID_TOKEN_401, status: 401 }
  // Non-200 statuses short-circuit before body parsing: the gateway's pre-auth
  // 415 (missing Content-Type) comes with an empty body.
  if (res.status !== 200) return { ok: false, error: `查询失败（HTTP ${res.status}）`, status: res.status }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: "响应不是有效 JSON", status: res.status }
  }
  const rec = asRec(body) ?? {}
  const windows: QuotaWindow[] = []
  const w5h = ratelimitWindow(rec.ratelimitCode5h, "5h")
  if (w5h) windows.push(w5h)
  const w7d = ratelimitWindow(rec.ratelimitCode7d, "7d")
  if (w7d) windows.push(w7d)
  const snapshot: QuotaSnapshot = {
    provider: "kimi",
    account: opts.account ?? "adhoc",
    fetchedAt: Date.now(),
    windows,
  }
  const expiry = expiryInfo(opts.token)
  if (expiry.expiresAt !== undefined) {
    snapshot.tokenExpiresAt = expiry.expiresAt
    snapshot.tokenStale = expiry.stale
  }
  const subscription = subscriptionOf(rec.subscriptionBalance)
  if (subscription) snapshot.subscription = subscription
  return { ok: true, value: snapshot }
}

function ratelimitWindow(raw: unknown, scope: Extract<WindowScope, "5h" | "7d">): QuotaWindow | undefined {
  const r = asRec(raw)
  if (!r) return undefined
  let utilization: number
  if (typeof r.ratio === "number" && Number.isFinite(r.ratio)) utilization = clamp01(r.ratio)
  else if (r.ratio === undefined || r.ratio === null) utilization = 0 // fresh window, zero consumption (live probe)
  else return undefined
  const w: QuotaWindow = { scope, utilization }
  if (typeof r.enabled === "boolean") w.enabled = r.enabled
  if (typeof r.resetTime === "string") {
    // ISO string with microseconds; Date.parse truncates to ms — fine for display purposes.
    const t = Date.parse(r.resetTime)
    if (Number.isFinite(t)) w.resetAt = t
  }
  return w
}

function subscriptionOf(raw: unknown): QuotaSubscription | undefined {
  const r = asRec(raw)
  if (!r) return undefined
  const amount = r.amountUsedRatio
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined
  const sub: QuotaSubscription = { amountUsedRatio: clamp01(amount) }
  if (typeof r.kimiCodeUsedRatio === "number" && Number.isFinite(r.kimiCodeUsedRatio)) {
    sub.kimiCodeUsedRatio = clamp01(r.kimiCodeUsedRatio)
  }
  if (typeof r.expireTime === "string") {
    const t = Date.parse(r.expireTime)
    if (Number.isFinite(t)) sub.expireAt = t
  }
  if (typeof r.unit === "string") sub.unit = r.unit
  if (typeof r.feature === "string") sub.feature = r.feature
  if (typeof r.domain === "string") sub.domain = r.domain
  return sub
}
