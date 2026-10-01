import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "../src/cli.js"
import type { FetchLike } from "../src/types.js"
import { capture, jsonResponse, makeJwt, recordingFetch } from "./helpers.js"

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "quota-cli-test-"))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const zhipuOkBody = {
  code: 200,
  msg: "操作成功",
  success: true,
  data: {
    level: "pro",
    limits: [
      { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 12000, currentValue: 852, remaining: 11147, percentage: 7, nextResetTime: 1790762886638 },
      { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 60000, currentValue: 51461, remaining: 8538, percentage: 85, nextResetTime: 1790821003984 },
    ],
  },
}

const kimiOkBody = {
  ratelimitCode5h: { ratio: 0.3472, enabled: true, resetTime: "2026-09-29T10:30:32.618725Z" },
  ratelimitCode7d: { ratio: 0.4811, enabled: true, resetTime: "2026-10-05T00:30:32.618725Z" },
  subscriptionBalance: {
    feature: "FEATURE_OMNI", type: "SUBSCRIPTION", unit: "UNIT_CREDIT",
    amountUsedRatio: 0.5937, kimiCodeUsedRatio: 0.5756, expireTime: "2026-10-10T00:00:00Z", domain: "DOMAIN_NEXUS",
  },
}

/** Route by the Authorization header value so each stored account gets its own fate. */
function routeByToken(responses: Record<string, Response>): FetchLike {
  return (input, init) => {
    const auth = new Headers(init?.headers).get("Authorization") ?? ""
    const res = responses[auth]
    if (res === undefined) return Promise.resolve(new Response("no route", { status: 500 }))
    return Promise.resolve(res)
  }
}

describe("cli", () => {
  test("token save echoes masked fingerprint only; list never leaks the raw token", async () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 900 })
    const out = capture()
    expect(await runCli(["zhipu", "token", "default", token], { ...out.io, home })).toBe(0)
    expect(out.text()).not.toContain(token)
    expect(out.last()).toEqual({
      ok: true,
      value: { provider: "zhipu", account: "default", masked: expect.any(String), tokenExpiresAt: expect.any(Number), tokenStale: true },
    })

    const list = capture()
    expect(await runCli(["zhipu", "list"], { ...list.io, home })).toBe(0)
    expect(list.text()).not.toContain(token)
    expect(list.last().value.accounts).toHaveLength(1)
    expect(list.last().value.accounts[0].account).toBe("default")
    expect(list.last().value.accounts[0].masked).toContain("…")
  })

  test("token --stdin stores a pasted credential", async () => {
    const token = makeJwt({ exp: 1893456000 })
    const out = capture()
    expect(await runCli(["zhipu", "token", "main", "--stdin"], { ...out.io, home, stdin: `${token}\n` })).toBe(0)
    const list = capture()
    await runCli(["zhipu", "list"], { ...list.io, home })
    expect(list.last().value.accounts[0].tokenStale).toBe(false) // exp far in the future
  })

  test("token --clear removes the account; metadata merges on re-save", async () => {
    const out = capture()
    expect(await runCli(["zhipu", "token", "a", "tok-a", "--org", "org-1"], { ...out.io, home })).toBe(0)
    // Re-save without --org keeps the stored metadata.
    await runCli(["zhipu", "token", "a", "tok-a2"], { ...out.io, home })
    const list1 = capture()
    await runCli(["zhipu", "list"], { ...list1.io, home })
    expect(list1.last().value.accounts[0].meta).toEqual({ org: "org-1" })

    expect(await runCli(["zhipu", "token", "a", "--clear"], { ...out.io, home })).toBe(0)
    const list2 = capture()
    await runCli(["zhipu", "list"], { ...list2.io, home })
    expect(list2.last().value.accounts).toHaveLength(0)
  })

  test("query batch: per-account isolation, partial failure still exits 0", async () => {
    const ok = makeJwt({ exp: 1 })
    const bad = makeJwt({ exp: 2 })
    await runCli(["zhipu", "token", "main", ok], { home })
    await runCli(["zhipu", "token", "backup", bad], { home })
    const fetchImpl = routeByToken({
      [ok]: jsonResponse(zhipuOkBody),
      [bad]: jsonResponse({ code: 401, success: false, msg: "令牌已过期或验证不正确" }, 200),
    })
    const out = capture()
    const code = await runCli(["zhipu", "query"], { ...out.io, home, fetchImpl })
    expect(code).toBe(0)
    const results = out.last().value.results
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ account: "backup", ok: false, status: 401 })
    expect(results[0].error).not.toContain("令牌已过期")
    expect(results[1]).toMatchObject({ account: "main", ok: true })
    expect(results[1].value.windows[0].scope).toBe("5h")
    // The raw tokens never appear anywhere in the output.
    expect(out.text()).not.toContain(ok)
    expect(out.text()).not.toContain(bad)
  })

  test("query with every account failing exits 1", async () => {
    await runCli(["zhipu", "token", "a", "tok-a"], { home })
    const out = capture()
    const code = await runCli(["zhipu"], {
      ...out.io,
      home,
      fetchImpl: routeByToken({ "tok-a": jsonResponse({ code: 401, success: false, msg: "x" }, 200) }),
    })
    expect(code).toBe(1)
    expect(out.last().value.results[0].ok).toBe(false)
  })

  test("query --token is adhoc, one-shot, works with no stored accounts", async () => {
    const token = makeJwt({ exp: 1 })
    const out = capture()
    const fetch = recordingFetch(jsonResponse(zhipuOkBody))
    const code = await runCli(["zhipu", "--token", token], { ...out.io, home, fetchImpl: fetch.fetchImpl })
    expect(code).toBe(0)
    expect(out.last().value.results[0].account).toBe("adhoc")
    expect(out.last().value.provider).toBe("zhipu")
  })

  test("query resolves the provider env var before the store", async () => {
    const token = makeJwt({ iat: 1000, exp: 1900 })
    const out = capture()
    const fetch = recordingFetch(jsonResponse(kimiOkBody))
    const code = await runCli(["kimi"], { ...out.io, home, env: { KIMI_WEB_TOKEN: token }, fetchImpl: fetch.fetchImpl })
    expect(code).toBe(0)
    expect(out.last().value.results[0].account).toBe("adhoc")
    expect(out.last().value.results[0].value.subscription.amountUsedRatio).toBe(0.5937)
  })

  test("query with no stored accounts is a usage error (exit 2)", async () => {
    const out = capture()
    const code = await runCli(["kimi"], { ...out.io, home })
    expect(code).toBe(2)
    expect(out.last().ok).toBe(false)
    expect(out.last().usage).toContain("usage:")
  })

  test("query --account for a missing label is a usage error (exit 2)", async () => {
    const out = capture()
    expect(await runCli(["zhipu", "--account", "ghost"], { ...out.io, home })).toBe(2)
  })

  test("usage errors: unknown provider, unknown flag, token without value", async () => {
    const out = capture()
    expect(await runCli(["openrouter"], { ...out.io, home })).toBe(2)
    expect(await runCli(["kimi", "--wat"], { ...out.io, home })).toBe(2)
    expect(await runCli(["kimi", "token", "lbl"], { ...out.io, home })).toBe(2)
    expect(await runCli(["kimi", "nonsense"], { ...out.io, home })).toBe(2)
  })

  test("--pretty indents the JSON", async () => {
    const token = makeJwt({ exp: 1 })
    const out = capture()
    const fetch = recordingFetch(jsonResponse(zhipuOkBody))
    const code = await runCli(["zhipu", "--token", token, "--pretty"], { ...out.io, home, fetchImpl: fetch.fetchImpl })
    expect(code).toBe(0)
    expect(out.text()).toContain('\n  "ok"')
    expect(JSON.parse(out.text())).toEqual(out.last())
  })
})
