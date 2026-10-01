// Public API orchestration (plan 0066 §6): queryQuota resolves credentials in
// the order --token > env > token store, queries every resolved account
// independently (one account failing never drags the batch), and listAccounts
// renders stored accounts without ever exposing raw tokens.

import type { AdapterOptions, FetchLike, ProviderId, QuotaSnapshot, Result } from "./types.js"
import { queryKimi } from "./kimi.js"
import { queryZhipu } from "./zhipu.js"
import * as store from "./store.js"
import { expiryInfo, maskToken } from "./jwt.js"

const ENV_TOKEN: Record<ProviderId, string> = {
  kimi: "KIMI_WEB_TOKEN",
  zhipu: "ZHIPU_WEB_TOKEN",
}

export interface QueryQuotaOptions {
  /** Query a single stored account by label. */
  account?: string
  /** One-shot credential, not persisted; reported under the label "adhoc". Takes precedence over everything. */
  token?: string
  /** Token-store base override (tests). */
  home?: string
  /** Environment override (tests); defaults to process.env. */
  env?: Record<string, string | undefined>
  fetchImpl?: FetchLike
  timeoutMs?: number
}

export type AccountResult =
  | { account: string; ok: true; value: QuotaSnapshot }
  | { account: string; ok: false; error: string; status?: number }

export interface QuotaReport {
  provider: ProviderId
  results: AccountResult[]
}

export async function queryQuota(provider: ProviderId, opts: QueryQuotaOptions = {}): Promise<Result<QuotaReport>> {
  const env = opts.env ?? process.env
  const targets: { account: string; token: string; meta?: Record<string, unknown> }[] = []
  if (opts.token?.trim()) {
    targets.push({ account: "adhoc", token: opts.token.trim() })
  } else if (opts.account) {
    const token = await store.readToken(provider, opts.account, opts.home)
    if (token === undefined) return { ok: false, error: `账号 "${opts.account}" 不存在` }
    targets.push({ account: opts.account, token, meta: await store.readMeta(provider, opts.account, opts.home) })
  } else {
    const envToken = env[ENV_TOKEN[provider]]
    if (typeof envToken === "string" && envToken.trim() !== "") {
      targets.push({ account: "adhoc", token: envToken.trim() })
    } else {
      const stored = await store.listStoredAccounts(provider, opts.home)
      if (stored.length === 0) {
        return {
          ok: false,
          error: `未存储任何 ${provider} 账号；先执行 quota ${provider} token <label> <值|--stdin> 添加，或用 --token / 环境变量临时提供`,
        }
      }
      targets.push(...stored.map((s) => ({ account: s.label, token: s.token, meta: s.meta })))
    }
  }
  const results = await Promise.all(targets.map((t) => queryOne(provider, t, opts)))
  return { ok: true, value: { provider, results } }
}

async function queryOne(
  provider: ProviderId,
  target: { account: string; token: string; meta?: Record<string, unknown> },
  opts: QueryQuotaOptions,
): Promise<AccountResult> {
  const adapterOpts: AdapterOptions = {
    token: target.token,
    account: target.account,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    org: metaString(target.meta, "org"),
    project: metaString(target.meta, "project"),
  }
  const r = provider === "kimi" ? await queryKimi(adapterOpts) : await queryZhipu(adapterOpts)
  if (r.ok) return { account: target.account, ok: true, value: r.value }
  return r.status !== undefined
    ? { account: target.account, ok: false, error: r.error, status: r.status }
    : { account: target.account, ok: false, error: r.error }
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = meta?.[key]
  return typeof v === "string" && v !== "" ? v : undefined
}

export interface ListedAccount {
  account: string
  masked: string
  tokenExpiresAt?: number
  tokenStale?: boolean
  meta?: Record<string, unknown>
}

export interface AccountList {
  provider: ProviderId
  accounts: ListedAccount[]
}

export async function listAccounts(provider: ProviderId, opts: { home?: string } = {}): Promise<Result<AccountList>> {
  const stored = await store.listStoredAccounts(provider, opts.home)
  const accounts: ListedAccount[] = stored.map((s) => {
    const info = expiryInfo(s.token)
    const item: ListedAccount = { account: s.label, masked: maskToken(s.token) }
    if (info.expiresAt !== undefined) {
      item.tokenExpiresAt = info.expiresAt
      item.tokenStale = info.stale
    }
    if (s.meta !== undefined) item.meta = s.meta
    return item
  })
  return { ok: true, value: { provider, accounts } }
}
