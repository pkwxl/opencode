// Unit tests for src/session-api.ts: the fork-base fork (forkSession/
// seedForkSession), end-of-session usage rebuild (sessionUsage), the askHuman
// wait deduction; also src/session.ts's ensureForkBase (base establishment
// and the fallback chain, driven through sessions — see §F.2 for ownership).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, a
// pure move).

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import type { ForkBaseInfo, SessionChain } from "../src/chain"
import type { Interactive } from "../src/interactive"
import { reloadUnits, seedUnits, unitsText } from "./fixtures/units"
import { ensureForkBase } from "../src/session"
import { askHuman, forkSession, seedForkSession, sessionUsage } from "../src/session-api"
import { flushStats, loadStats, setStatsClock, statsSessionBegin, statsSessionEnd, statsTotals } from "../src/stats"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { fakeClient } from "./fixtures/runner"

// ---- The fork three-stage pipeline (fork-decompose design §4.2/§4.3) ----

describe("forkSession (forking from the base, and the fallback)", () => {
  test("success: returns the new session id, renamed to this step's title", async () => {
    const { client, calls } = fakeClient({ fork: () => ({ data: { id: "ses_forked" } }) })
    expect(await forkSession(client, "ses_base", "T-001 S1 write the schema")).toBe("ses_forked")
    expect(calls.forks).toEqual(["ses_base"])
    expect(calls.updates).toEqual([{ id: "ses_forked", title: "T-001 S1 write the schema" }])
  })

  test("returns error (an external legacy --server without the fork route, etc.): logs, then undefined, no throw", async () => {
    const { client } = fakeClient({ fork: () => ({ error: { name: "NotFoundError" } }) })
    expect(await forkSession(client, "ses_base", "T-001 S1 x")).toBeUndefined()
  })

  test("throws (network dropped, etc.): also falls back to undefined", async () => {
    const { client } = fakeClient({ fork: () => Promise.reject(new Error("fetch failed")) })
    expect(await forkSession(client, "ses_base", "T-001 S1 x")).toBeUndefined()
  })
})

describe("seedForkSession (seeding a phase's/subtask's first session)", () => {
  const base: ForkBaseInfo = { id: "ses_base", used: 500 }
  const opts = {}
  const makeChain = (over: Partial<SessionChain> = {}): SessionChain => ({ pct: 10, used: 100, at: Date.now(), id: "ses_prev", ...over })

  test("fork succeeds: pending = the forked session, the seeded chain pct=100/used=the base's usage/at=0, returns warm", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, base, "T-001 S1 x")).resolves.toBe(true)
    expect(chain).toMatchObject({ id: undefined, pending: "ses_fork_1", forkBase: "ses_base", pct: 100, used: 500, at: 0 })
    expect(calls.forks).toEqual(["ses_base"])
  })

  test("fork fails: the chain resets to a fresh session (cold start), warm=false", async () => {
    const { client } = fakeClient({ fork: () => ({ error: { name: "NotFound" } }) })
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, base, "T-001 S1 x")).resolves.toBe(false)
    expect(chain).toMatchObject({ id: undefined, pending: undefined, pct: 100, used: 0, at: 0 })
  })

  test("base usage at cap/2: no fork, resets straight to a cold start", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, { id: "ses_base", used: 32_000 }, "T-001 S1 x")).resolves.toBe(false)
    expect(calls.forks).toEqual([])
    expect(chain).toMatchObject({ id: undefined, pending: undefined, pct: 100, used: 0, at: 0 })
  })

  test("interruption recovery reuses the session (a session on the chain with a note pending injection): no fork, the chain untouched, warm=true", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain({ id: "ses_interrupted", note: "[driver] continuation after the interruption" })
    await expect(seedForkSession(client, opts, chain, base, "T-001 S1 x")).resolves.toBe(true)
    expect(calls.forks).toEqual([])
    expect(chain.pending).toBeUndefined()
    expect(chain).toMatchObject({ id: "ses_interrupted", pct: 10, used: 100 })
  })

  test("no base (fork=off / cold start): the chain stays exactly as it is, untouched", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, undefined, "T-001 S1 x")).resolves.toBe(false)
    expect(calls.forks).toEqual([])
    expect(chain).toMatchObject({ id: "ses_prev", pct: 10, used: 100 })
  })
})

describe("ensureForkBase (base establishment and the fallback chain: persistent digest reuse → digest rebuild → session → cold start)", () => {
  let dir: string
  const digest = parseSwitches({})
  const session = parseSwitches({ [SWITCH_ENV.forkBase]: "session" })
  const chain = { pct: 100, used: 0, at: 0 }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-fork-"))
    await mkdir(join(dir, "docs"), { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function setupTask(forkBase?: string) {
    return (await seedUnits(dir, `## T-001: sample task [in_progress]\n${forkBase ? `  - fork-base: ${forkBase}\n` : ""}Body.\n`)).tasks[0]!
  }

  test("digest succeeds: builds the base session in one shot from context.md, persists fork-base with the digest: prefix, returns the base", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files and key symbols\n- a.ts\n")
    const taskNoBase = await setupTask()
    const { client, calls } = fakeClient()
    const base = await ensureForkBase(client, await reloadUnits(dir), taskNoBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_1", used: 0, digest: true })
    // One-shot session build (the title is the commit title), no fork, no rename (a new session is already named)
    expect(calls.creates).toBe(1)
    expect(calls.forks).toEqual([])
    expect(calls.updates).toEqual([])
    // fork-base persists with the digest: prefix as the new base session id
    expect(await unitsText(dir)).toContain('"forkBase": "digest:ses_new_1"')
  })

  test("persistent digest base alive (re-run after an interruption / a task resumed unfinished): the same base session reused, no rebuild, the field untouched", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files and key symbols\n- a.ts\n")
    const taskPersisted = await setupTask("digest:ses_P")
    const { client, calls } = fakeClient({
      messages: () => ({ data: [{ info: { role: "user" } }, { info: { role: "assistant", tokens: { input: 400, cache: { read: 100 } } } }] }),
    })
    const base = await ensureForkBase(client, await reloadUnits(dir), taskPersisted, {}, chain, digest)
    // Usage rebuilt from the last assistant message (400 + 100)
    expect(base).toEqual({ id: "ses_P", used: 500, digest: true })
    expect(calls.creates).toBe(0)
    expect(await unitsText(dir)).toContain('"forkBase": "digest:ses_P"')
  })

  test("persistent digest base dead (storage cleanup): rebuilt from the digest, the field overwritten", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files and key symbols\n- a.ts\n")
    const taskPersisted = await setupTask("digest:ses_dead")
    const { client, calls } = fakeClient({ get: () => undefined })
    const base = await ensureForkBase(client, await reloadUnits(dir), taskPersisted, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_1", used: 0, digest: true })
    expect(calls.creates).toBe(1)
    expect(await unitsText(dir)).toContain('"forkBase": "digest:ses_new_1"')
  })

  test("persistent digest base dead + rebuild blocked (a blocking question inside the session): the dead base is not re-validated, falls back to a cold start", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files and key symbols\n- a.ts\n")
    const taskPersisted = await setupTask("digest:ses_dead")
    const gets: string[] = []
    const { sdk } = fakeClient({
      get: (id) => {
        gets.push(id)
        return undefined
      },
      events: (sid) =>
        (async function* () {
          yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "Permission request: write a file" }] } }
        })(),
    })
    const stubbed = opencodeAgent({ ...sdk, permission: { reply: async () => ({}) } } as unknown as OpencodeClient)
    expect(await ensureForkBase(stubbed, await reloadUnits(dir), taskPersisted, {}, chain, digest)).toBeUndefined()
    // The liveness check ran exactly once on the dead base; the fallback chain never re-validates the digest:-prefixed value
    expect(gets).toEqual(["ses_dead"])
  })

  test("digest base session blocked (a blocking question inside the session, not a failure) → falls back to the session base: liveness checked, usage rebuilt from messages", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files and key symbols\n- a.ts\n")
    const taskWithBase = await setupTask("ses_U")
    // A permission question with no --wait-answer set → the session ends blocked, not failed (session failures — errors / dispatch
    // failures — have been retried to recovery inside runSession since 2026-09-16 and no longer reach the fallback).
    const { sdk } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "Permission request: write a file" }] } }
        })(),
      messages: () => ({ data: [{ info: { role: "user" } }, { info: { role: "assistant", tokens: { input: 700, cache: { read: 300 } } } }] }),
    })
    const stubbed = opencodeAgent({ ...sdk, permission: { reply: async () => ({}) } } as unknown as OpencodeClient)
    const base = await ensureForkBase(stubbed, await reloadUnits(dir), taskWithBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_U", used: 1000 })
    expect(await unitsText(dir)).toContain('"forkBase": "ses_U"')
  })

  test("a dispatch failure in the digest base session does not fall back: after the session failure recovers through retries, the base is built anyway", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files and key symbols\n- a.ts\n")
    const taskNoBase = await setupTask()
    let n = 0
    const { client } = fakeClient({
      prompt: () => {
        n++
        return n === 1 ? { error: { message: "boom" } } : {}
      },
    })
    const base = await ensureForkBase(client, await reloadUnits(dir), taskNoBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_2", used: 0, digest: true })
    expect(await unitsText(dir)).toContain('"forkBase": "digest:ses_new_2"')
  })

  test("digest missing → falls back to the session base", async () => {
    const taskWithBase = await setupTask("ses_U")
    const { client } = fakeClient({ messages: () => ({ data: [] }) })
    const base = await ensureForkBase(client, await reloadUnits(dir), taskWithBase, {}, chain, digest)
    // The session base is alive but its usage is unreadable → counted as 0
    expect(base).toEqual({ id: "ses_U", used: 0 })
  })

  test("session mode with a dead base (storage cleanup) → falls back to a cold start (undefined)", async () => {
    const taskWithBase = await setupTask("ses_U")
    const { client } = fakeClient({ get: () => undefined })
    expect(await ensureForkBase(client, await reloadUnits(dir), taskWithBase, {}, chain, session)).toBeUndefined()
  })

  test("session mode meeting a leftover digest: prefix (the base mode switched mid-run): shelled and validated, reused as the warm prefix when alive", async () => {
    const taskPersisted = await setupTask("digest:ses_P")
    const { client } = fakeClient({ messages: () => ({ data: [] }) })
    expect(await ensureForkBase(client, await reloadUnits(dir), taskPersisted, {}, chain, session)).toEqual({ id: "ses_P", used: 0, digest: true })
  })

  test("fork=off: always undefined (the current pipeline)", async () => {
    const taskWithBase = await setupTask("ses_U")
    const { client } = fakeClient()
    const off = parseSwitches({ [SWITCH_ENV.fork]: "off" })
    expect(await ensureForkBase(client, await reloadUnits(dir), taskWithBase, {}, chain, off)).toBeUndefined()
  })
})

// ---- End-of-session usage rebuild and the "error stub" criterion (sessionUsage: the basis for reusing an old session across a process recovery) ----

describe("sessionUsage (the reuse criterion)", () => {
  // The server's messages come back in creation order (old → new); the runner
  // reads only info's role/tokens/error and providerID/modelID (to look up the
  // context limit).
  const user = { info: { role: "user" } }
  const asst = (input: number, cacheRead: number, error?: unknown) => ({
    info: {
      role: "assistant",
      providerID: "kimi",
      modelID: "k2",
      tokens: { input, cache: { read: cacheRead } },
      ...(error ? { error } : {}),
    },
  })
  const limit = 262_100
  const client = (messages: unknown[] | { error: unknown }) =>
    opencodeAgent(({
      session: {
        messages: async () => (Array.isArray(messages) ? { data: messages } : messages),
      },
      provider: { list: async () => ({ data: { all: [{ id: "kimi", models: { k2: { limit: { context: limit } } } }] } }) },
    }) as unknown as OpencodeClient)

  test("the last message is a 0-token error stub with real output before it: usage takes the real tail, not judged an error stub (T-063 field incident)", async () => {
    // Points 1-4 deliberately left this session in progress.json: it did a lot
    // of work, and the last turn hit an account-level rate limit with
    // isRetryable:false — the server appended a tokens-all-zero error line for it.
    const usage = await sessionUsage(
      client([user, asst(3981, 8448), asst(1416, 107776), asst(0, 0, { name: "APIError" })]),
      "ses_real",
    )
    expect(usage.used).toBe(109192)
    expect(usage.pct).toBe(42)
    expect(usage.errorStub).toBe(false)
  })

  test("the whole session is nothing but an error stub (a legacy shape of the old retry-opens-a-blank-session era): judged an error stub, recovery opens a new session", async () => {
    const usage = await sessionUsage(client([user, asst(0, 0, { name: "APIError" })]), "ses_stub")
    expect(usage.used).toBe(0)
    expect(usage.errorStub).toBe(true)
  })

  test("the last message is an interrupted 0-token remnant (no error, a kill/crash shape): usage takes the earlier real turn", async () => {
    const usage = await sessionUsage(client([user, asst(2675, 62720), asst(0, 0)]), "ses_killed")
    expect(usage.used).toBe(65395)
    expect(usage.errorStub).toBe(false)
  })

  test("the last error line carries real tokens (decided after step-finish, e.g. output length exceeded): it is the basis directly", async () => {
    const usage = await sessionUsage(client([user, asst(1000, 5000), asst(2000, 60000, { name: "MessageOutputLengthError" })]), "ses_partial")
    expect(usage.used).toBe(62000)
    expect(usage.errorStub).toBe(false)
  })

  test("no assistant message yet: used 0, the unknown-limit basis unchanged, not judged an error stub (an empty session is reused normally on the first turn)", async () => {
    const usage = await sessionUsage(client([user]), "ses_fresh")
    expect(usage).toEqual({ used: 0, pct: 100, errorStub: false })
  })

  test("messages fetch fails or returns an error: degrades to usage 0 without the error-stub judgment (a query failure never costs the session)", async () => {
    expect(await sessionUsage(client({ error: { name: "UnknownError" } }), "ses_x")).toEqual({ used: 0, pct: 100, errorStub: false })
    const broken = opencodeAgent({ session: { messages: async () => { throw new Error("fetch failed") } } } as unknown as OpencodeClient)
    expect(await sessionUsage(broken, "ses_x")).toEqual({ used: 0, pct: 100, errorStub: false })
  })
})

// ---- Wait-time deduction at the three human wait points (STATS_PLAN §2/§3, T-005): the askHuman wiring ----
// stepPause / waitBetweenTasks wiring cases live in step.test.ts / loop-progress.test.ts.
describe("askHuman wait deduction (stats wiring, T-005)", () => {
  let now: number

  beforeEach(() => {
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(() => {
    setStatsClock()
  })

  // A fake resident input line: advances the injected clock before answering,
  // simulating a human wait duration.
  function fakeInteractive(answer: string, advance: number): Interactive {
    return {
      attach: () => {},
      question: async () => {
        now += advance
        return answer
      },
      close: () => {},
    } as unknown as Interactive
  }

  test("interactive path: the in-session wait deducts synchronously from session and AI time, waitMs booked separately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-ask-"))
    try {
      await loadStats(dir)
      await statsSessionBegin(dir, "T-001")
      now += 3000 // AI active 3s
      const answer = await askHuman(5, "auto-answered on timeout", fakeInteractive("allow", 8000), dir)
      expect(answer).toBe("allow") // behavior unchanged: the answer passes through
      now += 2000 // AI active 2s more
      const report = await statsSessionEnd(dir, "s1", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 })
      expect(report?.thisAiMs).toBe(5000) // 3000 + 2000, the 8000 wait not counted
      expect(report?.session.wallMs).toBe(13_000) // per-session wallMs = aiMs + waitMs
      const round = await statsTotals(dir, "round")
      expect(round?.aiMs).toBe(5000)
      expect(round?.wallMs).toBe(5000)
      expect(round?.waitMs).toBe(8000)
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an empty answer falls back to undefined (behavior unchanged); with no dir, stats untouched", async () => {
    // The interactive path has never trimmed (only the readline path had answer?.trim()); an empty string → undefined.
    expect(await askHuman(5, "hint", fakeInteractive("", 1000))).toBeUndefined()
    // A non-empty answer (whitespace included) returns verbatim — behavior equivalent to before the change.
    expect(await askHuman(5, "hint", fakeInteractive("allow", 1000))).toBe("allow")
  })

  test("waiting with no timeout (minutes undefined, plan's humanQuestions path): the prompt carries no minutes or limit, the answer goes straight through", async () => {
    let seen: { prompt: string; minutes?: number } | undefined
    const line: Interactive = {
      attach: () => {},
      question: async (prompt: string, minutes?: number) => {
        seen = { prompt, minutes }
        now += 60_000
        return "go with plan A"
      },
      close: () => {},
    } as unknown as Interactive
    const dir = await mkdtemp(join(tmpdir(), "auto-ask-"))
    try {
      await loadStats(dir)
      await statsSessionBegin(dir, "T-001")
      expect(await askHuman(undefined, "no timeout under plan", line, dir)).toBe("go with plan A")
      expect(seen?.minutes).toBeUndefined()
      expect(seen?.prompt).toContain("enter your answer (Enter to confirm, no timeout under plan): ")
      expect(seen?.prompt).not.toContain("within")
      // The wait-deduction basis is unchanged: a no-timeout wait is likewise booked as waitMs alone, never AI time.
      const report = await statsSessionEnd(dir, "s1", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 })
      expect(report?.thisAiMs).toBe(0)
      expect(report?.session.wallMs).toBe(60_000)
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

