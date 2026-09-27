// Capability degradation (MA.4, plans/0040): the run-start switch clamp, the
// permission preset, and the helper-level guards that route a missing
// capability onto an existing fallback. Degraded clients are the opencode
// adapter over the fake SDK with some flags turned off, so every assertion
// also shows which calls never reach the agent.

import { describe, expect, test } from "bun:test"
import type { AgentCapabilities, AgentClient } from "../src/agent/types"
import { OPENCODE_CAPABILITIES } from "../src/agent/opencode/client"
import { attempt } from "../src/attempt"
import { degrade, permissionPreset } from "../src/capability"
import type { SessionChain } from "../src/chain"
import { seedPinFork } from "../src/exec-session"
import { forkSession, seedForkSession, sessionAlive, sessionUsage, sessionUsed } from "../src/session-api"
import { runSession } from "../src/session"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { sessionHandoverDue } from "../src/usage"
import { fakeClient, task } from "./fixtures/runner"

const without = (client: AgentClient, caps: Partial<AgentCapabilities>): AgentClient => ({
  ...client,
  capabilities: { ...client.capabilities, ...caps },
})

// A heavily degraded headless profile (no steer, turn-end usage) that exercises
// every degradation row; the real claude adapter measured more (plans/0041 D2).
const HEADLESS: AgentCapabilities = {
  resume: true,
  fork: "session",
  steer: false,
  abort: true,
  question: false,
  permission: false,
  history: false,
  usage: "reported",
}

const ALL_ON = parseSwitches({
  [SWITCH_ENV.fork]: "on",
  [SWITCH_ENV.reuseSession]: "on",
  [SWITCH_ENV.steer]: "on",
  [SWITCH_ENV.stuck]: "on",
  [SWITCH_ENV.ask]: "on",
})

describe("degrade: run-start clamp", () => {
  test("opencode: nothing to degrade, nothing logged (byte-equal run start)", () => {
    expect(degrade(OPENCODE_CAPABILITIES, ALL_ON, { testByDriver: true, interactive: true })).toEqual({ switches: {}, notes: [] })
    expect(degrade(OPENCODE_CAPABILITIES, parseSwitches({}), {})).toEqual({ switches: {}, notes: [] })
  })

  test("headless profile: steer/stuck/ask off, fork kept (session forks), notes for each", () => {
    const got = degrade(HEADLESS, ALL_ON, { interactive: true, permission: "ask-fail" })
    expect(got.switches).toEqual({ steer: false, stuck: false, ask: false })
    expect(got.error).toBeUndefined()
    const text = got.notes.join("\n")
    expect(text).toContain(SWITCH_ENV.steer)
    expect(text).toContain(SWITCH_ENV.stuck)
    expect(text).toContain(SWITCH_ENV.ask)
    expect(text).toContain("--interactive")
    expect(text).toContain("--permission ask-fail → block")
    expect(text).toContain("history")
  })

  test("switches already off are not reported", () => {
    const got = degrade(HEADLESS, parseSwitches({ [SWITCH_ENV.stuck]: "off", [SWITCH_ENV.steer]: "off" }), {})
    expect(got.switches).toEqual({})
    // Only the two flag notes that do not hang on a switch remain.
    expect(got.notes.length).toBe(2)
  })

  test("fork none or no resume: fork off; no resume: reuse off", () => {
    expect(degrade({ ...OPENCODE_CAPABILITIES, fork: "none" }, ALL_ON, {}).switches).toEqual({ fork: false })
    expect(degrade({ ...OPENCODE_CAPABILITIES, resume: false }, ALL_ON, {}).switches).toEqual({ fork: false, reuseSession: false })
  })

  test("fork none or no resume: auto's lead loses its split clause for the run, with a note under auto only; a forking agent keeps it (plans/0059 D7)", () => {
    const none = degrade({ ...OPENCODE_CAPABILITIES, fork: "none" }, parseSwitches({}), {})
    expect(none.leadSplit).toBe(false)
    expect(none.notes).toContain(
      "--subtask auto: the lead's split needs an agent that can fork sessions (each stream is a fork of the lead); the lead runs without its split clause, as an ondemand session does",
    )
    // Whatever the pipeline's switch says: OPENCODE_AUTO_FORK governs true alone.
    const switchOff = degrade({ ...OPENCODE_CAPABILITIES, resume: false }, parseSwitches({ [SWITCH_ENV.fork]: "off" }), { subtask: "auto" })
    expect(switchOff.leadSplit).toBe(false)
    expect(switchOff.notes.some((note) => note.startsWith("--subtask auto:"))).toBe(true)
    // Another mode offers no clause, so nothing is said; the fact stays.
    const ondemand = degrade({ ...OPENCODE_CAPABILITIES, fork: "none" }, parseSwitches({}), { subtask: "ondemand" })
    expect(ondemand.leadSplit).toBe(false)
    expect(ondemand.notes.some((note) => note.startsWith("--subtask auto:"))).toBe(false)
    // A session-granularity fork is a fork.
    expect(degrade(HEADLESS, parseSwitches({}), {}).leadSplit).toBeUndefined()
  })

  test("no steer under auto: the steer note says the lead gets no split clause (the clamped steer withholds it, plans/0059 D7)", () => {
    const steer = (subtask?: "auto" | "true") => degrade(HEADLESS, ALL_ON, subtask ? { subtask } : {}).notes.find((note) => note.startsWith(SWITCH_ENV.steer))!
    expect(steer()).toContain("--subtask auto's lead gets no split clause")
    expect(steer("auto")).toContain("--subtask auto's lead gets no split clause")
    expect(steer("true")).toBe(
      `${SWITCH_ENV.steer}=on needs an agent that takes messages mid-turn; running with steer off (no handover hint, a session over the cap finishes naturally)`,
    )
  })

  test("--test-by-driver without steer has no fallback: startup error, dryrun exempt", () => {
    expect(degrade(HEADLESS, parseSwitches({}), { testByDriver: true }).error).toContain("--test-by-driver")
    expect(degrade(HEADLESS, parseSwitches({}), { testByDriver: true, dryrun: true }).error).toBeUndefined()
  })
})

describe("permissionPreset: --permission for an agent without permission events", () => {
  test("each mode lands on its no-answer outcome; dryrun denies", () => {
    expect(permissionPreset("auto-allow")).toBe("allow")
    expect(permissionPreset("ask-allow")).toBe("allow")
    expect(permissionPreset("ask-deny")).toBe("deny")
    expect(permissionPreset(undefined)).toBe("deny")
    expect(permissionPreset("ask-fail")).toBe("block")
    expect(permissionPreset("auto-allow", true)).toBe("deny")
  })
})

describe("helper guards", () => {
  test("fork none: no fork request, the new-session fallback", async () => {
    const { client, calls } = fakeClient()
    expect(await forkSession(without(client, { fork: "none" }), "ses_a", "T-001 S1")).toBeUndefined()
    expect(calls.forks).toEqual([])
  })

  test("fork session: the message anchor is dropped (whole-session copy)", async () => {
    const { client, calls } = fakeClient()
    expect(await forkSession(without(client, { fork: "session" }), "ses_a", "T-001 S1", "msg_2")).toBe("ses_fork_1")
    expect(await forkSession(client, "ses_a", "T-001 S1", "msg_2")).toBe("ses_fork_2")
    expect(calls.forkAnchors).toEqual([undefined, "msg_2"])
  })

  test("no resume: no remembered session is alive", async () => {
    let gets = 0
    const { client } = fakeClient({ get: (id) => (gets++, { data: { id } }) })
    expect(await sessionAlive(without(client, { resume: false }), "ses_a")).toBe(false)
    expect(gets).toBe(0)
    expect(await sessionAlive(client, "ses_a")).toBe(true)
  })

  test("no history: usage unknown, no messages request; the fork base starts cold", async () => {
    let reads = 0
    const { client, calls } = fakeClient({ messages: () => (reads++, { data: [] }) })
    const blind = without(client, { history: false })
    expect(await sessionUsed(blind, "ses_base")).toBeUndefined()
    expect(await sessionUsage(blind, "ses_base")).toEqual({ used: 0, pct: 100, errorStub: false })
    expect(reads).toBe(0)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    expect(await seedForkSession(blind, {}, chain, { id: "ses_base", used: await sessionUsed(blind, "ses_base") }, "T-001 S1")).toBe(false)
    expect(calls.forks).toEqual([])
    expect(chain.pending).toBeUndefined()
  })

  test("no history: the handover pin fork copies the whole session", async () => {
    let reads = 0
    const { client, calls } = fakeClient({ messages: () => (reads++, { data: [] }) })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const record = { task: "T-001", scope: "docs/T-001/testhandoff.md", unit: "execute", n: 1, pinSession: "ses_pin", pinMessage: "msg_1" }
    expect(await seedPinFork(without(client, { history: false }), chain, record, "T-001 wrapup")).toBe(true)
    expect(reads).toBe(0)
    expect(calls.forkAnchors).toEqual([undefined])
  })
})

describe("session driving without a capability", () => {
  const stepFinish = (sid: string, id: string, reason: string) => ({
    type: "message.part.updated",
    properties: {
      part: {
        id,
        sessionID: sid,
        messageID: "msg_1",
        type: "step-finish",
        reason,
        cost: 0,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      },
    },
  })
  const idle = (sid: string) => ({ type: "session.idle", properties: { sessionID: sid } })
  const message = (sid: string, id: string, input: number) => ({
    type: "message.updated",
    properties: {
      info: {
        id,
        sessionID: sid,
        role: "assistant",
        time: { completed: Date.now() },
        tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        providerID: "zai",
        modelID: "glm",
      },
    },
  })

  test("no steer: a length-truncated turn is not continued", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield idle(sid)
        })(),
    })
    const result = await runSession(without(client, { steer: false }), task, "p", {}, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("idle")
    expect(calls.steers).toEqual([])
  })

  test("no resume: an interrupted session on the chain is not resumed", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { id: "ses_old", note: "resume note", pct: 10, used: 100, at: Date.now() }
    const switches = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
    const result = await attempt(without(client, { resume: false }), task, "p", {}, chain, undefined, undefined, switches)
    expect(result.type).toBe("idle")
    expect(calls.creates).toBe(1)
    expect(calls.prompts[0]!.sessionID).toBe("ses_new_1")
  })

  test("hint sent: the chain records it, so a compacted session still owes its handover", async () => {
    // The hint fires at 2000 >= limit, then the session compacts and ends at 500.
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield message(sid, "msg_1", 2000)
          yield message(sid, "msg_2", 500)
          yield idle(sid)
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const steer = { limit: 1000, text: "hand over", notes: [] }
    await runSession(client, task, "p", {}, chain, steer)
    expect(calls.steers).toEqual(["hand over"])
    expect(chain.used).toBe(500)
    expect(chain.hinted).toBe(true)
    // The final figure alone says "natural finish"; the hint says otherwise.
    expect(sessionHandoverDue("events", steer, chain.used)).toBe(false)
    expect(sessionHandoverDue("events", steer, chain.used, chain.hinted)).toBe(true)
    // No steer configured: never due, hinted or not.
    expect(sessionHandoverDue("events", undefined, chain.used, true)).toBe(false)
  })

  test("no hint: chain.hinted stays false", async () => {
    const { client } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0, hinted: true }
    await runSession(client, task, "p", {}, chain, { limit: 1000, text: "hand over", notes: [] })
    expect(chain.hinted).toBe(false)
  })
})

describe("run start: the shell's agent profile", () => {
  test("the profile's factory starts the host with the preset; a gap stops the run (exit 1)", async () => {
    const { mkdir, rm, writeFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { freshRepo, git } = await import("./fixtures/runner")
    const { seedUnits } = await import("./fixtures/units")
    const { runAll } = await import("../src/loop")
    const { setShellProfile } = await import("../src/shell")
    const dir = await freshRepo()
    const { client, calls } = fakeClient()
    const seen: { directory?: string; server?: string; permission?: string } = {}
    let closed = false
    setShellProfile({
      agent: {
        name: "fake-headless",
        host: async (directory, options) => {
          Object.assign(seen, { directory, server: options.server, permission: options.permission })
          return { client: without(client, HEADLESS), syncContext: async () => {}, restart: async () => false, close: () => void (closed = true) }
        },
      },
    })
    try {
      await seedUnits(dir, "## T-001: sample task [pending]\nBody.\n")
      await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
      await writeFile(join(dir, ".opencode", "agent", "auto.md"), "contract\n")
      // As init leaves it: the driver's work dirs ignored, so the clean gate passes.
      await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      expect(await runAll(dir, { server: "http://x", permission: "ask-fail", testByDriver: true })).toBe(1)
      expect(seen).toEqual({ directory: dir, server: "http://x", permission: "block" })
      // Stopped before any session; the host is closed on the way out.
      expect(calls.creates).toBe(0)
      expect(closed).toBe(true)
    } finally {
      setShellProfile({ agent: undefined })
      await rm(dir, { recursive: true, force: true })
    }
  })
})
