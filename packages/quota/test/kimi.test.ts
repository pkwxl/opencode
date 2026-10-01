import { describe, expect, test } from "bun:test"
import { queryKimi } from "../src/kimi.js"
import type { FetchLike } from "../src/types.js"
import { INVALID_TOKEN_401 } from "../src/util.js"
import { jsonResponse, makeJwt, recordingFetch, requestHeaders } from "./helpers.js"

const KIMI_ENDPOINT =
  "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats"

const statsBody = {
  ratelimitCode5h: { ratio: 0.3472, enabled: true, resetTime: "2026-09-29T10:30:32.618725Z" },
  ratelimitCode7d: { ratio: 0.4811, enabled: true, resetTime: "2026-10-05T00:30:32.618725Z" },
  subscriptionBalance: {
    id: "sub-1",
    feature: "FEATURE_OMNI",
    type: "SUBSCRIPTION",
    unit: "UNIT_CREDIT",
    amountUsedRatio: 0.5937,
    kimiCodeUsedRatio: 0.5756,
    expireTime: "2026-10-10T00:00:00Z",
    domain: "DOMAIN_NEXUS",
  },
}

describe("queryKimi", () => {
  test("success: minimal header set, windows, subscription, expiry", async () => {
    const token = makeJwt({ iss: "account", iat: 1000, exp: 1000 + 900 })
    const { fetchImpl, calls } = recordingFetch(jsonResponse(statsBody))
    const r = await queryKimi({ token, fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.provider).toBe("kimi")
    expect(r.value.windows).toEqual([
      { scope: "5h", utilization: 0.3472, enabled: true, resetAt: Date.parse("2026-09-29T10:30:32.618725Z") },
      { scope: "7d", utilization: 0.4811, enabled: true, resetAt: Date.parse("2026-10-05T00:30:32.618725Z") },
    ])
    expect(r.value.subscription).toEqual({
      amountUsedRatio: 0.5937,
      kimiCodeUsedRatio: 0.5756,
      expireAt: Date.parse("2026-10-10T00:00:00Z"),
      unit: "UNIT_CREDIT",
      feature: "FEATURE_OMNI",
      domain: "DOMAIN_NEXUS",
    })
    expect(r.value.tokenExpiresAt).toBe(1_900_000) // exp seconds × 1000, epoch ms per plan 0066 §10
    expect(r.value.tokenStale).toBe(true) // 15-minute TTL is always < 24h

    expect(calls).toHaveLength(1)
    expect(calls[0].input).toBe(KIMI_ENDPOINT)
    expect(calls[0].init?.method).toBe("POST")
    const headers = requestHeaders(calls[0])
    // Live probe: the minimal header set is exactly these two.
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`)
    expect(headers.get("Content-Type")).toBe("application/json")
  })

  test("fresh window without ratio normalizes to utilization 0 (live probe)", async () => {
    const { fetchImpl } = recordingFetch(
      jsonResponse({
        ratelimitCode5h: { enabled: true, resetTime: "2026-10-01T05:30:00.618725Z" },
        ratelimitCode7d: { ratio: 0.2, enabled: true },
      }),
    )
    const r = await queryKimi({ token: makeJwt({ exp: 1 }), fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.windows).toEqual([
      { scope: "5h", utilization: 0, enabled: true, resetAt: Date.parse("2026-10-01T05:30:00.618725Z") },
      { scope: "7d", utilization: 0.2, enabled: true },
    ])
  })

  test("401 → masked invalid-token error; server message never passes through", async () => {
    const token = makeJwt({ exp: 1 })
    const leaky = {
      code: "unauthenticated",
      message: `invalid user token: ${token}`,
      details: [
        {
          type: "common.error.v1.ErrorDetail",
          value: "base64blob",
          debug: { reason: "REASON_INVALID_AUTH_TOKEN", localizedMessage: { locale: "en-US", message: "Invalid" } },
        },
      ],
    }
    const { fetchImpl } = recordingFetch(jsonResponse(leaky, 401))
    const r = await queryKimi({ token, fetchImpl })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(401)
    expect(r.error).toBe(INVALID_TOKEN_401)
    expect(r.error).not.toContain(token)
    expect(r.error).not.toContain("REASON_INVALID_AUTH_TOKEN")
  })

  test("ill-typed ratio / missing pieces degrade without throwing", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse({ ratelimitCode5h: { ratio: "high" }, unexpected: true }))
    const r = await queryKimi({ token: makeJwt({ exp: 1 }), fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.windows).toEqual([])
    expect(r.value.subscription).toBeUndefined()
  })

  test("unparseable resetTime is omitted", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse({ ratelimitCode5h: { ratio: 0.5, resetTime: "not-a-date" } }))
    const r = await queryKimi({ token: makeJwt({ exp: 1 }), fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.windows).toEqual([{ scope: "5h", utilization: 0.5 }])
  })

  test("ratio out of [0,1] is clamped", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse({ ratelimitCode5h: { ratio: 1.5 } }))
    const r = await queryKimi({ token: makeJwt({ exp: 1 }), fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.windows).toEqual([{ scope: "5h", utilization: 1 }])
  })

  test("non-200, non-401 status → generic failure", async () => {
    const { fetchImpl } = recordingFetch(new Response("", { status: 415 }))
    const r = await queryKimi({ token: makeJwt({ exp: 1 }), fetchImpl })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(415)
    expect(r.error).toContain("HTTP 415")
  })

  test("malformed JSON body → no-answer error", async () => {
    const { fetchImpl } = recordingFetch(
      new Response("not json {", { status: 200, headers: { "Content-Type": "application/json" } }),
    )
    const r = await queryKimi({ token: makeJwt({ exp: 1 }), fetchImpl })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("JSON")
  })

  test("timeout aborts with a dedicated message", async () => {
    const never: FetchLike = (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "TimeoutError")),
        )
      })
    const r = await queryKimi({ token: makeJwt({ exp: 1 }), fetchImpl: never, timeoutMs: 5 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("查询超时")
  })
})
