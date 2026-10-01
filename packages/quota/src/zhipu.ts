// zhipu / bigmodel.cn adapter — GET the coding-plan quota/limit endpoint.
//
// Endpoint facts are live-probed (2026-10-01, plan 0066 §3.2):
// - Minimal header is the bare JWT alone (no Bearer prefix; the server also
//   tolerates a prefix but we send bare). Accept / Set-Language /
//   bigmodel-organization / bigmodel-project / referer / user-agent are all
//   optional for personal accounts.
// - HTTP status is NOT an error signal: missing or garbage credentials come
//   back as HTTP 200 with envelope code 1001 / 401. Success is decided by the
//   envelope only: code === 200 && success === true.
// - Scope mapping (rolling windows, behaviorally confirmed on a max account):
//   (unit 3, number 5) → 5h; (unit 6, number 1) → 7d; anything else stays
//   unknown with unit/number preserved in raw.
// - nextResetTime = last consumption + window length, so it can sit in the
//   past while the window is still counting — kept verbatim as resetAt.
// - percentage = round(currentValue/usage); remaining may differ from
//   usage-currentValue by 1 (rounding) and is passed through, never recomputed;
//   usage mutates with the plan tier and must not be cached as a fixed limit.
// - The web JWT payload has no exp and is not valid JSON, so tokenExpiresAt is
//   never derived here; envelope code 401 is the only invalid-credential signal.

import type { AdapterOptions, QuotaSnapshot, QuotaWindow, Result, WindowScope } from "./types.js"
import { asRec, clamp01, DEFAULT_TIMEOUT_MS, fetchErrorMessage, INVALID_TOKEN_401 } from "./util.js"
import { expiryInfo, maskText } from "./jwt.js"

const ENDPOINT = "https://bigmodel.cn/api/monitor/usage/quota/limit"

const SCOPE_BY_ROW: Record<string, WindowScope> = {
  "3:5": "5h",
  "6:1": "7d",
}

export async function queryZhipu(opts: AdapterOptions): Promise<Result<QuotaSnapshot>> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const headers: Record<string, string> = { Authorization: opts.token }
  if (opts.org) headers["Bigmodel-Organization"] = opts.org
  if (opts.project) headers["Bigmodel-Project"] = opts.project
  let res: Response
  try {
    res = await fetchImpl(ENDPOINT, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    return { ok: false, error: fetchErrorMessage(e, timeoutMs) }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: "响应不是有效 JSON", status: res.status }
  }
  const env = asRec(body)
  if (!env || env.code !== 200 || env.success !== true) {
    if (env?.code === 401) return { ok: false, error: INVALID_TOKEN_401, status: 401 }
    const code = env && env.code !== undefined ? String(env.code) : "未知"
    const msg = env && typeof env.msg === "string" ? maskText(env.msg) : ""
    return { ok: false, error: `查询失败（code ${code}${msg ? `：${msg}` : ""}）`, status: res.status }
  }
  const data = asRec(env.data) ?? {}
  const snapshot: QuotaSnapshot = {
    provider: "zhipu",
    account: opts.account ?? "adhoc",
    fetchedAt: Date.now(),
    windows: limitWindows(data.limits),
  }
  const expiry = expiryInfo(opts.token)
  if (expiry.expiresAt !== undefined) {
    snapshot.tokenExpiresAt = expiry.expiresAt
    snapshot.tokenStale = expiry.stale
  }
  if (typeof data.level === "string") snapshot.level = data.level
  return { ok: true, value: snapshot }
}

function limitWindows(raw: unknown): QuotaWindow[] {
  const out: QuotaWindow[] = []
  if (!Array.isArray(raw)) return out
  for (const item of raw) {
    const r = asRec(item)
    if (!r) continue
    if (r.type !== undefined && r.type !== "CREDIT_LIMIT") continue
    const scope = SCOPE_BY_ROW[`${String(r.unit)}:${String(r.number)}`] ?? "unknown"
    const usage = finiteNumber(r.usage)
    const used = finiteNumber(r.currentValue)
    const pct = finiteNumber(r.percentage)
    const resetAt = finiteNumber(r.nextResetTime)
    const remaining = finiteNumber(r.remaining)
    let utilization: number | undefined
    if (pct !== undefined) utilization = clamp01(pct / 100)
    else if (usage !== undefined && used !== undefined && usage > 0) utilization = clamp01(used / usage)
    if (utilization === undefined) continue
    const w: QuotaWindow = { scope, utilization }
    if (resetAt !== undefined) w.resetAt = resetAt
    if (usage !== undefined) w.limit = usage
    if (used !== undefined) w.used = used
    if (remaining !== undefined) w.remaining = remaining
    if (scope === "unknown") w.raw = { unit: r.unit, number: r.number }
    out.push(w)
  }
  return out
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
