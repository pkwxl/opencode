# Plan: opencode `packages/quota` standalone quota-query module (kimi + zhipu, multi-account)

Status: **implemented and landed (2026-10-01: `packages/quota` built out per the §8 checklist, commit `794f35095`: kimi/zhipu adapters, 0600 multi-account token storage, JSON-only CLI, fetch-double tests)**; the old status "review approved, implementation deferred" is void (2026-10-02 correction, `plans/0069` §4.2 A7), and this file is now the historical spec of the landed module.
Drafted: 2026-09-30. Sources: two browser packet captures (kimi 2026-09-29, zhipu 2026-09-30; the tokens in the captures are all expired and must **never** be written to any file or reused).

## 1. Goals

Add a **standalone module** to the opencode monorepo that queries model-provider account quota/limit status over the network (kimi: 5-hour limit, weekly limit, monthly subscription balance; zhipu/bigmodel: tiered limits of coding-plan), providing the data basis for "switch model / switch account". Queries are advisory-only: the module only produces data and **never triggers a switch automatically**.

## 2. Scope and Hard Constraints

- The new package lives in `opencode/packages/quota/` (`@opencode-ai/quota`, private). `packages/auto-core` is undergoing a wholesale refactor: **zero changes** there (`packages/auto`, `opencode.json`, and the root tsconfig are likewise untouched); the new package has **zero dependency on auto-core** and uses only the Bun standard library.
- Align with the existing auto-core vocabulary for easier wiring later: window scopes use `5h` / `7d`, field names use `utilization` / `resetAt` (epoch ms). The "monthly limit" is a subscription balance, not a rate-limit window; give it its own `subscription` entry instead of masquerading as a scope.
- Per the auto-core design document `packages/auto-core/plans/0057-session-exception-and-quota-window-design.md`: §9 had deferred "provider quota endpoint probing" (blocked by the C4 credential constraint: credential values only ever enter subprocess environments). As a **separate process/separate package**, this module bypasses that constraint and inherits the contract spirit of §9: advisory; failure means "no answer"; timeout means "no answer"; §11 item 10 (observation must not preempt scheduling) likewise applies. When it is later wired into `.auto/windows.json`, use its reserved `WindowSource = "probe"`.
- Security discipline (C4 spirit): raw tokens/cookies never enter code, docs, tests, logs, or error messages; errors are always masked; this plan document itself contains no credentials.
- `opencode/` is a nested git repo (branch auto-core); **no git commit-type commands are run**; the DRIVER does the committing uniformly.
- Settled decisions: a general-purpose `packages/quota` (kimi and zhipu as the first two adapters); token sources = `--token`/env + a 0600 local token file; CLI output is **JSON only**; **multiple accounts per provider** are supported.

## 3. Endpoint Specifications

> Live-test status: **both providers completed (2026-10-01, two rounds)**; the minimal header sets, error shapes, and window semantics are in each section live-test conclusions; sync them into the package README at implementation time.

### 3.1 kimi（www.kimi.com）

- `POST https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`
- Request body: `{}` (Content-Type: application/json; Connect-RPC; the capture shows connect-protocol-version: 1).
- Credential header: `Authorization: Bearer <JWT>`. The Bearer in the capture is an access JWT with `iss=account`, valid for only **15 minutes**; there is also a `kimi-auth` cookie (`iss=user-center`, roughly **30 days**) that is a long-lived session credential; which credential (or which combination) can query this endpoint directly is decided by live testing, with storing the long-lived credential as the preferred guidance.
- To be live-tested for necessity: `x-msh-device-id`, `x-msh-platform: web`, `x-msh-session-id`, `x-language`, `r-timezone`, etc.
- Response (direct JSON, no envelope):

```json
{
  "ratelimitCode5h": { "ratio": 0.3472, "enabled": true, "resetTime": "2026-09-29T10:30:32.618725Z" },
  "ratelimitCode7d": { "ratio": 0.4811, "enabled": true, "resetTime": "2026-10-05T00:30:32.618725Z" },
  "subscriptionBalance": {
    "id": "…", "feature": "FEATURE_OMNI", "type": "SUBSCRIPTION", "unit": "UNIT_CREDIT",
    "amountUsedRatio": 0.5937, "kimiCodeUsedRatio": 0.5756,
    "expireTime": "2026-10-10T00:00:00Z", "domain": "DOMAIN_NEXUS"
  }
}
```

- Field semantics: `ratelimitCode5h` → scope `5h`; `ratelimitCode7d` → scope `7d`; `ratio` is the utilization; `resetTime` is an ISO string with microseconds (parsable via `Date.parse`; mind the truncated precision); `subscriptionBalance` → monthly subscription (`amountUsedRatio`/`kimiCodeUsedRatio`/`expireTime`).
- Captured response headers for reference: 200, `Content-Type: application/json`, gzip.
- **Live-test conclusions (2026-10-01, two rounds: round one had an expired token and only yielded the error shape; round two live-tested successfully with a fresh Bearer)**:
  - **Minimal header set = the two headers `Authorization: Bearer <JWT>` + `Content-Type: application/json`**. `connect-protocol-version` is omittable (200 with or without it); `x-msh-*`, `x-language`, `r-timezone`, `origin`, `referer`, `user-agent` are all omittable. Without `Content-Type` the gateway returns HTTP 415 (empty body) before even reaching auth, so it must always be sent.
  - **The `kimi-auth` cookie cannot query this endpoint**: sent alone, with the full browser header set (including `x-msh-device-id`/`x-msh-session-id`/`x-traffic-id`), or even with the entire cookie jar, it reproducibly gets 401 `REASON_INVALID_AUTH_TOKEN`; the copy the browser currently holds has exp 2026-07-29/30, and the server rejects it per exp. The only valid credential type for this endpoint is the 15-minute Bearer; "store a long-lived credential" does not hold for kimi, so v1 can only capture-then-query (copy the Bearer → query within 15 minutes); the sustainable approach = observe the web client Bearer renewal calls in phase two (last paragraph of §4).
  - The Bearer lifetime is exactly 900s (iat→exp); in round one, probing 95s past exp already yielded all 401s. The 401 shape (expiry and invalidity look identical): HTTP 401 + `{"code":"unauthenticated","message":"invalid user token: …","details":[{"type":"common.error.v1.ErrorDetail","value":"<base64>","debug":{"reason":"REASON_INVALID_AUTH_TOKEN","localizedMessage":{"locale":"en-US|zh-CN","message":"…"}}}]}`. For 401 the adapter always outputs the masked "凭据已失效，请重新粘贴" ("credential has expired, please re-paste") and never passes the raw message through.
  - Response confirmed (200, direct JSON, no envelope): the **`ratio` of `ratelimitCode5h`/`ratelimitCode7d` can be missing**: a live test on a brand-new 5h window (zero consumption in the current period) got back only `enabled` + `resetTime`; normalization sets a missing ratio to utilization 0. `resetTime` has the same semantics as the `nextResetTime` of zhipu = the most recent consumption within the window + the window length (live tests: 5h boundary = same-day consumption + 5h; 7d boundary = consumption one week ago + 7d); likewise it must not be cached as a fixed period. `subscriptionBalance` has all fields present (amountUsedRatio/kimiCodeUsedRatio/expireTime/domain), with expireTime being the subscription expiry.

### 3.2 zhipu / bigmodel.cn

- `GET https://bigmodel.cn/api/monitor/usage/quota/limit`
- Credential header: `Authorization: <JWT>` (**bare JWT, no `Bearer` prefix**; same value as the `bigmodel_token_production` cookie in the capture).
- Optional headers: `Bigmodel-Organization: org-…`, `Bigmodel-Project: proj-…` (needed by multi-org/project accounts; made an optional pass-through and stored in account metadata); `Set-Language: zh`; `Accept: application/json`.
- Source page: `https://bigmodel.cn/coding-plan/personal/usage`.
- Response envelope:

```json
{
  "code": 200, "msg": "操作成功", "success": true,
  "data": {
    "level": "pro",
    "limits": [
      { "type": "CREDIT_LIMIT", "unit": 3, "number": 5, "usage": 12000, "currentValue": 852, "remaining": 11147, "percentage": 7,  "nextResetTime": 1790762886638 },
      { "type": "CREDIT_LIMIT", "unit": 6, "number": 1, "usage": 60000, "currentValue": 51461, "remaining": 8538, "percentage": 85, "nextResetTime": 1790821003984 }
    ]
  }
}
```

- Success criterion: `code === 200 && success === true`; any other code is treated as a failed query for that account (mask `msg` and put it into error).
- Field semantics: `percentage` (a 0-100 integer) → `utilization = percentage / 100` (can also cross-check via `currentValue / usage`); `nextResetTime` is already epoch ms; `usage`=total, `currentValue`=used, `remaining`=remaining, passed through as `limit`/`used`/`remaining`.
- **Window semantics: live-test confirmed (2026-10-01, a level=max single account)**, see the live-test conclusions below; unknown tiers still fall back to the delta rule; when in doubt, always `unknown`, keeping `unit/number` in `raw`.
  - **Live-test conclusions (2026-10-01)**:
  - Minimal header set = `Authorization: <裸 JWT>` (bare JWT) alone already gets 200; `Accept`/`Set-Language`/`bigmodel-organization`/`bigmodel-project`/`referer`/`user-agent` are all omittable (illegal org/project values are simply ignored; personal account). The server also accepts the `Bearer ` prefix (lenient), but the adapter uniformly sends the bare JWT.
  - **The HTTP status code is not an error signal**: missing Authorization header → HTTP 200 + `{"code":1001,"success":false,"msg":"Header中未收到Authorization参数…"}`; fake token → HTTP 200 + `{"code":401,"success":false,"msg":"令牌已过期或验证不正确"}`. The success criterion looks only at the envelope `code===200 && success===true`; envelope `code:401` → the masked "凭据已失效，请重新粘贴" ("credential has expired, please re-paste"); any other non-200 code → generic failure (msg masked). The response header is `Content-Type: application/json;charset=UTF-8`; parsing must tolerate the charset suffix.
  - scope mapping: `(unit:3, number:5)` → `5h`, `(unit:6, number:1)` → `7d`, both rolling windows. Behaviorally confirmed: the unit=6 row resets at exactly the moment its `nextResetTime` specifies (pct 85→23, used drops sharply), while the unit=3 row advances its boundary on an hourly scale with consumption.
  - `nextResetTime` = the most recent consumption time + the window length: it only advances when consumption occurs, and while the window is idle it can sit in the **past** (a live test saw one row whose nextResetTime was ~15h behind the present while the window was still counting usage). The adapter must not treat a past nextResetTime as a future wait-until moment; treat it as "resets only on the next consumption" and classify the scope per the mapping table.
  - Field-semantics corrections: `percentage` = `currentValue/usage` rounded; `remaining` can differ from `usage−currentValue` by 1 (rounding), passed through as-is without recomputation; `usage` is the current-period allowance and **does change** (12000→28000 and 60000→140000 were observed within a single day on one account as the plan upgraded pro→max), so it must not be cached as a fixed limit; `level` is the plan-tier string ("pro" and "max" both observed).
  - JWT shape: the payload has **no `exp`** (only user_type/user_channel/user_id/user_key/customer_id/username) and contains a comma replaced by a control byte, so it is **not valid JSON**; exp decoding must fail softly; the `tokenExpiresAt`/`tokenStale` of zhipu are always empty, and envelope `code:401` is the only expiry signal.

## 4. Credential and Login-State Design

Neither provider has a public OAuth device-flow or refresh endpoint; the credential is simply the web-session JWT. Design:

- **Multi-account storage**: `~/.config/quota/<provider>/<label>.token` (0600), with the `label` chosen by the user (default `default`); optionally accompanied by `<label>.json` (0600) holding non-sensitive metadata (zhipu org/project, notes). The directory respects `XDG_CONFIG_HOME`.
- **Token resolution order**: CLI `--token` > env (`KIMI_WEB_TOKEN` / `ZHIPU_WEB_TOKEN`) > token file. The first two are one-shot and never touch disk.
- **First login (no device-flow)**: log in via the browser → open the quota page (kimi `https://www.kimi.com/settings/subscription?tab=quota`; zhipu `https://bigmodel.cn/coding-plan/personal/usage`) → copy the Authorization header value from the DevTools Network tab → `echo <值> | quota <provider> token <label> --stdin` (<值> = the copied value). Storage echoes back masked (masked fingerprint + decoded exp). Live-test revision (2026-10-01): the kimi `kimi-auth` cookie cannot query the quota endpoint (§3.1), so **kimi can only store the 15-minute Bearer (capture-then-query)**; a long-lived credential holds only for zhipu (its web JWT has no exp and is valid long-term); the sustainable approach for kimi = observe the web client Bearer renewal calls in phase two (see the next paragraph).
- **Staying logged in**: the CLI decodes the JWT payload (base64, **no signature verification**) to get `exp`: `list` and every query result carry `tokenExpiresAt`; with less than 24h left it sets `tokenStale: true`; on 401 it outputs an explicit "token 已失效，请重新粘贴" ("token has expired, please re-paste") JSON error. The v1 strategy = store "the longest-lived valid credential" and manually re-paste when it expires; during implementation, also observe the web client renewal calls after the access token expires; if a stable, imitable renew/refresh connect endpoint exists, phase two adds `quota <provider> refresh <label>` (optional, not promised).
- Not doing: reading browser cookie stores, automated headless login, CAPTCHA/QR-scan flows.

## 5. CLI Specification

- Entry: `src/cli.ts` (run directly with bun; a `bin` can be added). Output is **JSON only**: one compact line by default, two-space indent with `--pretty`; both success and failure are written to stdout (failure additionally sets the exit code); there is no other human-readable output.
- Commands:
  - `quota <provider>` (or `quota <provider> query`): query **all** stored accounts of that provider. Output `{ ok: true, value: { provider, results: [ { account, ok: true, value: QuotaSnapshot } | { account, ok: false, error } ] } }`: **each account succeeds or fails independently, and a single account failure does not sink the batch**; when not even one account is stored it is treated as a usage error. `--account <label>` queries just one; `--token <值>` (<值> = the token value) is an ad-hoc credential (label recorded as `adhoc`).
  - `quota <provider> list`: list stored accounts, showing only `label`, the masked fingerprint (e.g. the first and last 4 characters of `eyJ…X5uT`), `tokenExpiresAt`, `tokenStale`, metadata; never the raw token.
  - `quota <provider> token <label> <值 | --stdin>` (<值> = the token value): add/update; `--org/--project` (zhipu) stored along with the metadata.
  - `quota <provider> token <label> --clear`: delete.
- Exit codes: 0 success (including partial account failures within a batch query); 1 query failure (network/credential/endpoint); 2 usage error.
- provider id：`kimi`、`zhipu`。

## 6. Type and Implementation Specification

- `Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number }` (same shape as the settle in the auto-core `agent/opencode/client.ts`).
- `QuotaWindow { scope: "5h" | "7d" | "day" | "unknown"; utilization: number; resetAt?: number; enabled?: boolean; used?: number; limit?: number; remaining?: number; raw?: Record<string, unknown> }`
- `QuotaSnapshot { provider: "kimi" | "zhipu"; account: string; fetchedAt: number; tokenExpiresAt?: number; tokenStale?: boolean; windows: QuotaWindow[]; level?: string; subscription?: { amountUsedRatio: number; kimiCodeUsedRatio?: number; expireAt?: number; unit?: string; feature?: string; domain?: string } }`
- Adapter spec: one `src/kimi.ts` / `src/zhipu.ts` per provider, with **injectable** fetch (a double in tests), a 10s timeout (`AbortSignal.timeout` composition), no retries (advisory: failure means no answer); lenient normalization (missing fields/wrong types → skip that window or set `unknown`; never let an exception propagate through).
- `src/store.ts`: read/write/delete the 0600 token files and metadata; atomic writes (tmp → rename, modeled on auto-core quota-windows).
- `src/index.ts`: export public APIs such as `queryQuota(provider, opts)` / `listAccounts(provider)` for other packages to reference later as `"@opencode-ai/quota"`.

## 7. Engineering Wiring and Tests

- Modeled on the `packages/codemode` template: `package.json` (`private: true`, `type: module`, `exports: { ".": "./src/index.ts" }`, `scripts: { typecheck: "tsgo --noEmit", test: "bun test" }`, and the three devDeps `@tsconfig/bun` / `@types/bun` / `@typescript/native-preview`, all `catalog:`); `tsconfig.json` extends `@tsconfig/bun`.
- A root-level `bun install` links the workspace (the workspaces glob `packages/*` auto-discovers it, so the root package.json needs no change); `bun turbo typecheck` covers it automatically; `turbo.json` gains a `"@opencode-ai/quota#test"` entry so that CI (`bun turbo test`) reaches it.
- Tests (`test/*.test.ts`, `bun:test`, hand-written fetch doubles, no MSW): per adapter, success / 401 / envelope code≠200 / malformed JSON / timeout; normalization boundaries (missing fields, microsecond ISO, out-of-range percentage); store (read/write/delete, 0600, corrupted-file tolerance); CLI (multi-account batch query, single-account failure isolation, list leaking no raw tokens, exit codes).

## 8. Implementation Steps (deferred; execute in order when the time comes)

1. curl live tests: **completed (2026-10-01, two rounds)**. The zhipu conclusions were backfilled into §3.2 and the kimi conclusions into §3.1 (minimal header set = Bearer + Content-Type; the `kimi-auth` cookie is invalid; `ratio` can be missing). Sync the conclusions into the package README at implementation time.
2. Build the package skeleton + root `bun install`.
3. `src/types.ts` + both adapters + normalization + unit tests.
4. `src/store.ts` (multi-account) + unit tests.
5. `src/cli.ts` (list / token / query) + unit tests.
6. `turbo.json` CI entry.
7. Verify: `bun turbo typecheck` all green; `cd opencode/packages/quota && bun test` all green; when valid tokens are available, run one real query per provider against real accounts (at least two tokens for multi-account).
8. The in-package `README.md`: endpoints and field semantics, live-tested header sets, the scope mapping table, first-login/stay-logged-in guidance, security notes, and the relation to 0057 §9.

## 9. Explicitly Not Doing / Future Directions

- Not doing: modifying `packages/auto-core` / `packages/auto` / `opencode.json` / the root tsconfig; integration with `.auto/windows.json`, routing, or the probe loop (wire it in after the refactor; the integration point = `WindowSource: "probe"`); automatic switch decisions; automatic token renewal (phase two, depending on live-test conclusions).
- Future directions: hooking into the post-refactor routing/account switching of auto-core (the output of this module is exactly the basis for "which accounts of which provider can still fire"); more provider adapters (OpenRouter/DeepSeek/Anthropic etc.; 0057 §9/F14/F15 already hold research leads).

## 10. Output Examples

`quota kimi --pretty`：

```json
{
  "ok": true,
  "value": {
    "provider": "kimi",
    "results": [
      {
        "account": "main",
        "ok": true,
        "value": {
          "provider": "kimi",
          "account": "main",
          "fetchedAt": 1791072000000,
          "tokenExpiresAt": 1791158400000,
          "tokenStale": false,
          "windows": [
            { "scope": "5h", "utilization": 0.3472, "resetAt": 1790737832618, "enabled": true },
            { "scope": "7d", "utilization": 0.4811, "resetAt": 1791251432618, "enabled": true }
          ],
          "subscription": { "amountUsedRatio": 0.5937, "kimiCodeUsedRatio": 0.5756, "expireAt": 1760054400000, "unit": "UNIT_CREDIT", "feature": "FEATURE_OMNI", "domain": "DOMAIN_NEXUS" }
        }
      },
      { "account": "backup", "ok": false, "error": "token 已失效，请重新粘贴（401）", "status": 401 }
    ]
  }
}
```

`quota zhipu --pretty` (for a single account, `results` has the same structure):

```json
{
  "ok": true,
  "value": {
    "provider": "zhipu",
    "results": [
      {
        "account": "default",
        "ok": true,
        "value": {
          "provider": "zhipu",
          "account": "default",
          "fetchedAt": 1791072000000,
          "level": "pro",
          "windows": [
            { "scope": "5h", "utilization": 0.07, "resetAt": 1790762886638, "used": 852, "limit": 12000, "remaining": 11147 },
            { "scope": "7d", "utilization": 0.85, "resetAt": 1790821003984, "used": 51461, "limit": 60000, "remaining": 8538 }
          ]
        }
      }
    ]
  }
}
```

<!-- auto: eof -->
