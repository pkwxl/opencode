import { describe, expect, test } from "bun:test"
import { queryZhipu } from "../src/zhipu.js"
import { INVALID_TOKEN_401 } from "../src/util.js"
import { jsonResponse, jwtWithPayload, makeJwt, recordingFetch, requestHeaders } from "./helpers.js"

const ZHIPU_ENDPOINT = "https://bigmodel.cn/api/monitor/usage/quota/limit"

// Web JWT as observed in the live probe: payload has no exp and one comma is
// replaced by a control byte, so it is not valid JSON.
const zhipuToken = jwtWithPayload('{"user_type":"personal"\u0007"user_id":"u1"}')

const envelope = (limits: unknown[]) => ({
  code: 200,
  msg: "操作成功",
  success: true,
  data: { level: "max", limits },
})

const limitsRow = (over: Record<string, unknown>) => ({
  type: "CREDIT_LIMIT",
  unit: 3,
  number: 5,
  usage: 12000,
  currentValue: 852,
  remaining: 11147, // deliberately ≠ usage − currentValue (server-side rounding)
  percentage: 7,
  nextResetTime: 1790762886638,
  ...over,
})

describe("queryZhipu", () => {
  test("success: scope mapping, passthrough fields, bare-JWT header", async () => {
    const { fetchImpl, calls } = recordingFetch(jsonResponse(envelope([limitsRow({}), limitsRow({ unit: 6, number: 1, usage: 60000, currentValue: 51461, remaining: 8538, percentage: 85, nextResetTime: 1790821003984 })])))
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.level).toBe("max")
    expect(r.value.windows).toEqual([
      { scope: "5h", utilization: 0.07, resetAt: 1790762886638, limit: 12000, used: 852, remaining: 11147 },
      { scope: "7d", utilization: 0.85, resetAt: 1790821003984, limit: 60000, used: 51461, remaining: 8538 },
    ])
    // zhipu's web JWT never yields an expiry.
    expect(r.value.tokenExpiresAt).toBeUndefined()
    expect(r.value.tokenStale).toBeUndefined()

    expect(calls).toHaveLength(1)
    expect(calls[0].input).toBe(ZHIPU_ENDPOINT)
    expect(calls[0].init?.method).toBeUndefined() // GET
    const headers = requestHeaders(calls[0])
    expect(headers.get("Authorization")).toBe(zhipuToken) // bare JWT, no Bearer prefix
  })

  test("HTTP 200 + envelope code 1001 → no-answer failure, status stays HTTP", async () => {
    const { fetchImpl } = recordingFetch(
      jsonResponse({ code: 1001, success: false, msg: "Header中未收到Authorization参数" }, 200),
    )
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(200)
    expect(r.error).toContain("code 1001")
  })

  test("HTTP 200 + envelope code 401 → masked invalid-token error", async () => {
    const { fetchImpl } = recordingFetch(
      jsonResponse({ code: 401, success: false, msg: "令牌已过期或验证不正确" }, 200),
    )
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(401)
    expect(r.error).toBe(INVALID_TOKEN_401)
  })

  test("server msg with credential-shaped material is masked", async () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    const { fetchImpl } = recordingFetch(jsonResponse({ code: 1002, success: false, msg: `bad token ${secret}` }, 200))
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).not.toContain(secret)
    expect(r.error).toContain("***")
  })

  test("percentage missing → currentValue/usage fallback; unknown rows keep raw", async () => {
    const { fetchImpl } = recordingFetch(
      jsonResponse(
        envelope([
          { type: "CREDIT_LIMIT", unit: 9, number: 2, usage: 10, currentValue: 5, percentage: 50 },
          { type: "CREDIT_LIMIT", unit: 4, number: 7, usage: 1000, currentValue: 250 },
          { type: "SOMETHING_ELSE", unit: 3, number: 5, percentage: 1 },
          { type: "CREDIT_LIMIT", unit: 3, number: 5 }, // nothing computable → skipped
        ]),
      ),
    )
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.windows).toEqual([
      { scope: "unknown", utilization: 0.5, limit: 10, used: 5, raw: { unit: 9, number: 2 } },
      { scope: "unknown", utilization: 0.25, limit: 1000, used: 250, raw: { unit: 4, number: 7 } },
    ])
  })

  test("percentage out of range is clamped", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse(envelope([limitsRow({ percentage: 150 }), limitsRow({ percentage: -5 })])))
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.windows.map((w) => w.utilization)).toEqual([1, 0])
  })

  test("past nextResetTime is kept verbatim (means: resets on next consumption)", async () => {
    const { fetchImpl } = recordingFetch(jsonResponse(envelope([limitsRow({ nextResetTime: 1000 })])))
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.windows[0].resetAt).toBe(1000)
  })

  test("org/project headers are sent when provided", async () => {
    const { fetchImpl, calls } = recordingFetch(jsonResponse(envelope([limitsRow({})])))
    await queryZhipu({ token: zhipuToken, org: "org-1", project: "proj-1", fetchImpl })
    const headers = requestHeaders(calls[0])
    expect(headers.get("Bigmodel-Organization")).toBe("org-1")
    expect(headers.get("Bigmodel-Project")).toBe("proj-1")
  })

  test("HTTP 500 + garbage body → no-answer error", async () => {
    const { fetchImpl } = recordingFetch(new Response("<html>oops</html>", { status: 500 }))
    const r = await queryZhipu({ token: zhipuToken, fetchImpl })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("JSON")
  })

  test("well-formed JWT payload with exp still yields expiry info", async () => {
    const token = makeJwt({ user_id: "u1", exp: 1893456000 })
    const { fetchImpl } = recordingFetch(jsonResponse(envelope([limitsRow({})])))
    const r = await queryZhipu({ token, fetchImpl })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.tokenExpiresAt).toBe(1_893_456_000_000)
  })
})
