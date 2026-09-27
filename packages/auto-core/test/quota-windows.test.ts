// Learned quota windows (plans/0057 §8, S5): the account key, the record's
// life across a restart (a fresh module copy reads the file back), the
// horizon, what counts as spent, and what a turn that goes through clears.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentEvent } from "../src/agent/types"
import { activateRings, resetKeyring } from "../src/keyring"
import type { ModelEntry, ModelRegistry } from "../src/models"
import { accountAnswered, accountOf, learnedReset, learnFailure, learnObserved, resetQuotaWindows } from "../src/quota-windows"
import type { RoutingFacts } from "../src/routing"

const NOW = Date.parse("2026-09-26T17:15:19Z")
const HOUR = 3_600_000
const DAY = 24 * HOUR

let dir: string
beforeEach(async () => {
  resetQuotaWindows()
  dir = await mkdtemp(join(tmpdir(), "auto-quota-windows-"))
})
afterEach(async () => {
  resetQuotaWindows()
  resetKeyring()
  await rm(dir, { recursive: true, force: true })
})

const fileOf = async (): Promise<{ windows: Record<string, unknown>[] }> => JSON.parse(await Bun.file(join(dir, ".auto", "windows.json")).text())
// A restart: the next read comes from the file alone.
const restart = () => resetQuotaWindows()

describe("the account key", () => {
  const entry = (name: string, fields: Partial<ModelEntry>): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
  const facts = (): RoutingFacts => {
    const registry: ModelRegistry = {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([
        ["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }],
        ["claude-b", { name: "claude-b", layer: "operator", adapter: "claude" }],
      ]),
      models: new Map(
        [
          entry("glm", {
            model: "zai-coding-plan/glm-5.3",
            provider: "zai-coding-plan",
            keys: [
              { kind: "env", name: "ZHIPU_KEY_A", ref: "{env:ZHIPU_KEY_A}", label: "ZHIPU_KEY_A" },
              { kind: "env", name: "ZHIPU_KEY_B", ref: "{env:ZHIPU_KEY_B}", label: "ZHIPU_KEY_B" },
            ],
          }),
          entry("kimi", { model: "moonshot/kimi-k2", provider: "moonshot" }),
          entry("opus", { agent: "claude-b", model: "opus" }),
        ].map((item) => [item.name, item]),
      ),
      tiers: {},
      routes: new Map(),
      unused: [],
    } as unknown as ModelRegistry
    return { registry, agentFilter: undefined, filterSource: undefined, defaultAgent: "opencode", runAgent: "opencode" }
  }

  test("without a registry: the provider of the routed model, else of the model shown, else default", () => {
    expect(accountOf({ model: "zai-coding-plan/glm-5.3" }, undefined)).toBe("zai-coding-plan")
    expect(accountOf({ modelShown: "zai-coding-plan/glm-5.3" }, undefined)).toBe("zai-coding-plan")
    expect(accountOf({ model: "anthropic/claude-opus", modelShown: "zai-coding-plan/glm-5.3" }, undefined)).toBe("anthropic")
    // claude's model ids name no provider: the agent's own login.
    expect(accountOf({ modelShown: "claude-opus-4-5" }, undefined)).toBe("default")
    expect(accountOf({}, undefined)).toBe("default")
  })

  test("under a registry: the profile, the provider and the ring's current key by name", () => {
    const routing = facts()
    expect(accountOf({ modelEntry: "kimi" }, routing)).toBe("opencode/moonshot")
    // A claude profile is its login.
    expect(accountOf({ modelEntry: "opus" }, routing)).toBe("claude-b")
    // A raw override value runs on the default agent.
    expect(accountOf({ modelEntry: "openrouter/some-model" }, routing)).toBe("opencode/openrouter")
    // Rings inactive: the provider alone.
    expect(accountOf({ modelEntry: "glm" }, routing)).toBe("opencode/zai-coding-plan")
    activateRings(routing.registry, false)
    const account = accountOf({ modelEntry: "glm" }, routing)
    expect(account).toBe("opencode/zai-coding-plan#ZHIPU_KEY_A")
    // A name, never a value.
    expect(account).not.toContain("{env:")
  })
})

describe("the record", () => {
  test("a stated reset outlives the process, and the latest spent window of the account is the one read", async () => {
    await learnFailure(dir, "zai-coding-plan", { resetAt: NOW + 3 * HOUR, scope: "5h", resetSource: "stated" }, NOW)
    await learnFailure(dir, "zai-coding-plan", { resetAt: NOW + 5 * DAY, scope: "7d", resetSource: "stated" }, NOW + 1000)
    await learnFailure(dir, "moonshot", { resetAt: NOW + 6 * DAY, scope: "7d" }, NOW)
    restart()
    expect(await learnedReset(dir, "zai-coding-plan", NOW + 2000)).toEqual({
      account: "zai-coding-plan",
      scope: "7d",
      resetAt: NOW + 5 * DAY,
      learnedAt: NOW + 1000,
      source: "stated",
      spent: true,
    })
    expect(await learnedReset(dir, "anthropic", NOW)).toBeUndefined()
    // The latest statement of a window stands.
    await learnFailure(dir, "zai-coding-plan", { resetAt: NOW + 4 * DAY, scope: "7d" }, NOW + 2000)
    expect((await learnedReset(dir, "zai-coding-plan", NOW + 3000))?.resetAt).toBe(NOW + 4 * DAY)
    expect((await fileOf()).windows.filter((w) => w.account === "zai-coding-plan")).toHaveLength(2)
  })

  test("a classifier's reset is a window of unknown scope; a per-minute cap and a past reset are not recorded", async () => {
    await learnFailure(dir, "a", { resetAt: NOW + HOUR, resetSource: "classifier" }, NOW)
    await learnFailure(dir, "b", { resetAt: NOW + 30_000, scope: "request" }, NOW)
    await learnFailure(dir, "c", { resetAt: NOW + 30_000, scope: "token" }, NOW)
    await learnFailure(dir, "d", { resetAt: NOW - 1, scope: "5h" }, NOW)
    await learnFailure(dir, "e", { scope: "5h" }, NOW)
    expect((await fileOf()).windows).toEqual([{ account: "a", scope: "unknown", resetAt: NOW + HOUR, learnedAt: NOW, source: "classifier", spent: true }])
  })

  test("never across the horizon: an entry dies at its reset, or seven days after it was learned", async () => {
    await learnFailure(dir, "a", { resetAt: NOW + 3 * HOUR, scope: "5h" }, NOW)
    expect(await learnedReset(dir, "a", NOW + 3 * HOUR)).toBeUndefined()
    // A hand-made entry that claims a reset past the horizon of its learning.
    await mkdir(join(dir, ".auto"), { recursive: true })
    await writeFile(
      join(dir, ".auto", "windows.json"),
      JSON.stringify({ windows: [{ account: "a", scope: "7d", resetAt: NOW + 30 * DAY, learnedAt: NOW, source: "stated", spent: true }] }),
    )
    restart()
    expect((await learnedReset(dir, "a", NOW + DAY))?.resetAt).toBe(NOW + 30 * DAY)
    expect(await learnedReset(dir, "a", NOW + 7 * DAY + 1)).toBeUndefined()
  })

  test("a turn that goes through clears the account's spent windows, and only that account's", async () => {
    await learnFailure(dir, "a", { resetAt: NOW + 3 * HOUR, scope: "5h" }, NOW)
    await learnFailure(dir, "a", { resetAt: NOW + 3 * DAY, scope: "7d" }, NOW)
    await learnFailure(dir, "b", { resetAt: NOW + 3 * DAY, scope: "7d" }, NOW)
    await accountAnswered(dir, "a", NOW + 1000)
    restart()
    expect(await learnedReset(dir, "a", NOW + 2000)).toBeUndefined()
    expect((await learnedReset(dir, "b", NOW + 2000))?.resetAt).toBe(NOW + 3 * DAY)
  })

  test("an observation: a used-up window, or the one a rejection names, is spent; any other supersedes a spent entry", async () => {
    const limit = (status: "allowed" | "warning" | "rejected", windows: { scope: "5h" | "7d"; resetAt: number; utilization?: number }[]): Extract<AgentEvent, { type: "limit" }> => ({
      type: "limit",
      session: "s",
      status,
      windows,
    })
    await learnObserved(dir, "claude-b", limit("warning", [{ scope: "5h", resetAt: NOW + HOUR, utilization: 0.92 }, { scope: "7d", resetAt: NOW + 2 * DAY, utilization: 1 }]), NOW)
    expect(await learnedReset(dir, "claude-b", NOW)).toMatchObject({ scope: "7d", resetAt: NOW + 2 * DAY, source: "observed", spent: true, utilization: 1 })
    expect((await fileOf()).windows.find((w) => w.scope === "5h")).toMatchObject({ spent: false, utilization: 0.92 })
    await learnObserved(dir, "claude-b", limit("allowed", [{ scope: "7d", resetAt: NOW + 9 * DAY, utilization: 0.01 }]), NOW + 1000)
    expect(await learnedReset(dir, "claude-b", NOW + 1000)).toBeUndefined()
    await learnObserved(dir, "claude-c", limit("rejected", [{ scope: "5h", resetAt: NOW + HOUR }]), NOW)
    expect((await learnedReset(dir, "claude-c", NOW))?.resetAt).toBe(NOW + HOUR)
    // A rejection naming two windows without their use does not say which.
    await learnObserved(dir, "claude-d", limit("rejected", [{ scope: "5h", resetAt: NOW + HOUR }, { scope: "7d", resetAt: NOW + DAY }]), NOW)
    expect(await learnedReset(dir, "claude-d", NOW)).toBeUndefined()
  })

  test("an observation beside a failure's statement: neither is lost", async () => {
    await Promise.all([
      learnFailure(dir, "a", { resetAt: NOW + 3 * HOUR, scope: "5h" }, NOW),
      learnObserved(dir, "a", { type: "limit", session: "s", status: "allowed", windows: [{ scope: "7d", resetAt: NOW + DAY, utilization: 0.5 }] }, NOW),
    ])
    restart()
    expect((await fileOf()).windows.map((w) => w.scope).sort()).toEqual(["5h", "7d"])
  })

  test("lenient reading: a corrupt file is an empty record, a malformed entry is skipped; no directory, no record", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await writeFile(join(dir, ".auto", "windows.json"), "{not json")
    expect(await learnedReset(dir, "a", NOW)).toBeUndefined()
    await writeFile(
      join(dir, ".auto", "windows.json"),
      JSON.stringify({
        windows: [
          { account: "a", scope: "weekly", resetAt: NOW + DAY, learnedAt: NOW, source: "stated", spent: true },
          { account: "a", scope: "7d", resetAt: String(NOW + DAY), learnedAt: NOW, source: "stated", spent: true },
          { account: "a", scope: "7d", resetAt: NOW + DAY, learnedAt: NOW, source: "probe", spent: true },
          null,
          { account: "a", scope: "5h", resetAt: NOW + HOUR, learnedAt: NOW, source: "stated", spent: true },
        ],
      }),
    )
    restart()
    expect(await learnedReset(dir, "a", NOW)).toMatchObject({ scope: "5h", resetAt: NOW + HOUR })
    await learnFailure(undefined, "a", { resetAt: NOW + HOUR, scope: "5h" }, NOW)
    expect(await learnedReset(undefined, "a", NOW)).toBeUndefined()
  })
})
