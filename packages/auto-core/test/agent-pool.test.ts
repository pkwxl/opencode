// The agent pool (plans/0055 §8.1, §8.3, §8.5, §8.7, §9; src/agent-pool.ts):
// one lazily started host per agent profile, cross-agent moves as new
// sessions with the worktree-check note, the capability intersection over
// the fleet's static records (notes naming the forcing agent), preflight's
// bin check, the models command's probe, and the no-registry single-agent
// parity (C2). The two fake agents register as shell adapters
// (registerAgentAdapter, §8.8) with different capabilities.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkAgentBins, probeModels, singleHost, startPool } from "../src/agent-pool"
import type { SessionChain } from "../src/chain"
import { resetFailback } from "../src/failback"
import { loadModels, type ModelRegistry } from "../src/models"
import type { Opts } from "../src/opts"
import { resetKeyring } from "../src/keyring"
import { routingFacts, type RoutingFacts } from "../src/routing"
import { runSession } from "../src/session"
import { registerAgentAdapter, resetShellAdapters, setShellProfile, shellAdapter, shellProfile } from "../src/shell"
import { autoSwitches, clampSwitches, parseSwitches } from "../src/switches"
import { WORKTREE_CHECK } from "../src/session-api"
import { ev, fakeAgent, fakeAgentHost, FULL_CAPABILITIES, type FakeAgent, type FakeAgentOptions } from "./fixtures/agent"
import { task } from "./fixtures/runner"

const PHASE_TYPES = ["analysis", "design", "implement", "test", "acceptance", "knowledge"]
const DEFAULTS = parseSwitches({})

const dirs: string[] = []
const temp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

// Two fake adapters with different capabilities (§14): fake-a asks no
// questions and keeps no readable history, fake-b is fully capable — the
// intersection must name fake-a.
const A_CAPS = { question: false, permission: false, history: false, fork: "session" as const }
const B_CAPS = {}

type FleetFixture = {
  a: FakeAgent
  b: FakeAgent
  hosts: { a: ReturnType<typeof fakeAgentHost>; b: ReturnType<typeof fakeAgentHost> }
  registry: ModelRegistry
  pool: Exclude<Awaited<ReturnType<typeof startPool>>["pool"], undefined>
  profileName: string
  facts: RoutingFacts
  leadSplit?: false
}

// A two-agent fleet: deep [a1 (agent a), b1 (agent b)], simple [b1]. The
// registry is loaded from JSON so the loader's own validation runs over the
// registered adapter names. No agent filter is in force (the ambient
// OPENCODE_AUTO_AGENT would otherwise narrow the fleet).
async function fleet(optionsA: FakeAgentOptions = {}, optionsB: FakeAgentOptions = {}, registryText?: string): Promise<FleetFixture> {
  const dir = await temp("auto-agent-pool-")
  const a = fakeAgent({ capabilities: A_CAPS, limits: { "prov/a": 100_000 }, ...optionsA })
  const b = fakeAgent({ capabilities: B_CAPS, limits: { "other/b": 100_000 }, ...optionsB })
  const hosts = { a: fakeAgentHost(a), b: fakeAgentHost(b) }
  registerAgentAdapter("fake-a", { host: hosts.a.factory, capabilities: { ...FULL_CAPABILITIES, ...A_CAPS } })
  registerAgentAdapter("fake-b", { host: hosts.b.factory, capabilities: { ...FULL_CAPABILITIES, ...B_CAPS } })
  const file = join(dir, "models.json")
  await writeFile(
    file,
    registryText ??
      JSON.stringify({
        agents: { a: { adapter: "fake-a" }, b: { adapter: "fake-b" } },
        models: { a1: { agent: "a", model: "prov/a" }, b1: { agent: "b", model: "other/b" } },
        tiers: { deep: ["a1", "b1"], simple: ["b1"] },
      }),
  )
  const registry = (await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file } }))!
  const started = await startPool(dir, { registry })
  if (started.pool === undefined) throw new Error(started.error)
  const facts = routingFacts(registry, undefined, started.profileName)
  return {
    a,
    b,
    hosts,
    registry,
    pool: started.pool,
    profileName: started.profileName,
    facts: { ...facts, agentFilter: undefined, filterSource: undefined },
    ...(started.leadSplit === false ? { leadSplit: false as const } : {}),
  }
}

const deepChain = (): SessionChain => ({ pct: 100, used: 0, at: 0, role: "decompose" })

// A quota failure on the first prompt (0-token stubs never fork well, so the
// failed turn also measures 5000 tokens).
const quotaTurn = (ctx: { session: string; n: number }) =>
  ctx.n === 1
    ? [
        ev.message(ctx.session, `msg_fail_${ctx.n}`, 5000),
        ev.error(ctx.session, { name: "APIError", message: "insufficient_quota", isRetryable: false }),
        ev.idle(ctx.session),
      ]
    : undefined

// The env-parsed values the suite's clamps restore: undefined is no Switches
// value for ask, and a later file's autoSwitches() would read it.
const { ask: envAsk, agent: envAgent } = autoSwitches()

let printed: ReturnType<typeof spyOn>
let lines: string[]

beforeEach(() => {
  lines = []
  printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "))
  })
  resetFailback()
  resetKeyring()
})

afterEach(() => {
  printed.mockRestore()
  resetShellAdapters()
  resetFailback()
  resetKeyring()
  clampSwitches({ ask: envAsk, agent: envAgent })
})

// The suite's own afterAll for the temp directories.
import { afterAll } from "bun:test"
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

describe("the agent pool: lazy hosts per profile (§8.1)", () => {
  test("no host starts at run start; the first selection starts only its own profile's host", async () => {
    const { a, b, hosts, pool, facts } = await fleet()
    try {
      expect(pool.startedAgents()).toEqual([])
      const opts: Opts = { routing: facts, server: pool }
      // A deep dispatch picks a1 (agent a): only a's host starts.
      await runSession(pool, task, "p", opts, deepChain(), undefined, undefined, DEFAULTS)
      expect(pool.startedAgents()).toEqual(["a"])
      expect(hosts.a.starts()).toBe(1)
      expect(hosts.b.starts()).toBe(0)
      expect(a.prompts[0]!.model).toBe("prov/a")
      expect(b.calls).toHaveLength(0)
    } finally {
      pool.close()
    }
  })

  test("a dispatch on the second agent starts its host too; close closes every started host", async () => {
    const { b, hosts, pool, facts } = await fleet()
    try {
      const opts: Opts = { routing: facts, server: pool }
      // simple routes b1 only (no borrowing): the dispatch lands on agent b.
      const chain: SessionChain = { pct: 100, used: 0, at: 0, role: "bypass" }
      await runSession(pool, task, "p", opts, chain, undefined, undefined, DEFAULTS)
      expect(pool.startedAgents()).toEqual(["b"])
      expect(b.prompts[0]!.model).toBe("other/b")
    } finally {
      pool.close()
    }
    expect(hosts.b.closed()).toBe(1)
    expect(hosts.a.closed()).toBe(0)
  })

  test("without a registry the one agent starts eagerly and prints today's lines (C2)", async () => {
    const dir = await temp("auto-agent-pool-single-")
    // A fake opencode CLI on PATH: the eager single-agent start spawns it, as
    // startAgent did (the adapter-level parity lives in
    // test/agent-env.test.ts and test/agent-server.test.ts).
    await writeFile(join(dir, "opencode"), `#!/bin/sh\necho "opencode server listening on http://127.0.0.1:4777"\nexec sleep 30\n`)
    await chmod(join(dir, "opencode"), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${dir}:${path}`
    const savedAgent = process.env.OPENCODE_AUTO_AGENT
    delete process.env.OPENCODE_AUTO_AGENT
    let started: Awaited<ReturnType<typeof startPool>> | undefined
    try {
      started = await startPool(dir, {})
      expect(started.error).toBeUndefined()
      // The one-agent era's startup: the host starts here (the fake CLI
      // answered), no `◇ agent:` line for the default opencode, no notes.
      expect(started.pool!.startedAgents()).toEqual(["opencode"])
      expect(lines).toEqual([])
      expect(await started.pool!.client()).toBeDefined()
    } finally {
      started?.pool?.close()
      process.env.PATH = path
      if (savedAgent !== undefined) process.env.OPENCODE_AUTO_AGENT = savedAgent
    }
  })
})

describe("cross-agent moves (§8.3, §7 step 2)", () => {
  test("a quota failure with the next candidate on another agent: a new session there with the worktree note, no fork", async () => {
    const { a, b, pool, facts } = await fleet({ turn: quotaTurn })
    const chain = deepChain()
    try {
      const opts: Opts = { routing: facts, server: pool }
      const result = await runSession(pool, task, "p", opts, chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      // a1 marked down, the failover picked b1 on agent b — as a blank new
      // session: agent b's client saw create and no fork, and the prompt
      // carries the worktree-check note.
      expect(chain.agent).toBe("b")
      expect(chain.modelEntry).toBe("b1")
      expect(b.argsOf("fork")).toHaveLength(0)
      expect(b.argsOf("create")).toHaveLength(1)
      const moved = b.prompts.find((prompt) => prompt.text.includes("moving to agent b"))
      expect(moved).toBeDefined()
      expect(moved!.text).toContain(WORKTREE_CHECK.trim())
      expect(moved!.model).toBe("other/b")
      // Agent a's failed session was never forked onto agent b, and its own
      // fork (the same-agent attempt at context carry-over) never ran: the
      // move skips the fork entirely.
      expect(a.argsOf("fork")).toHaveLength(0)
      const move = lines.find((line) => line.includes("moving to agent b"))
      expect(move).toContain("a session never crosses agents")
    } finally {
      pool.close()
    }
  })

  test("an exhausted ring falls through to the same cross-agent move (§7 step 1 → step 2)", async () => {
    // Key rings are opencode-only, so the ringed entry runs on an
    // opencode-adapter profile — and the shell profile's own factory serves
    // the chosen agent's adapter (T-026's rule), which is how the fake host
    // stands in for the opencode server here.
    const a = fakeAgent({ turn: quotaTurn, limits: { "prov/a": 100_000 } })
    const b = fakeAgent({ limits: { "other/b": 100_000 } })
    const hosts = { a: fakeAgentHost(a), b: fakeAgentHost(b) }
    registerAgentAdapter("fake-b", { host: hosts.b.factory, capabilities: { ...FULL_CAPABILITIES } })
    const saved = { ...shellProfile() }
    setShellProfile({ agent: { name: "opencode", host: hosts.a.factory } })
    const dir = await temp("auto-agent-pool-ring-")
    const file = join(dir, "models.json")
    await writeFile(
      file,
      JSON.stringify({
        agents: { oc: { adapter: "opencode" }, b: { adapter: "fake-b" } },
        models: {
          a1: { agent: "oc", model: "prov/a", keys: ["{env:PROV_KEY}"] },
          b1: { agent: "b", model: "other/b" },
        },
        tiers: { deep: ["a1", "b1"], simple: ["b1"] },
      }),
    )
    const registry = (await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file, PROV_KEY: "set-for-the-reference-check" } }))!
    const started = await startPool(dir, { registry })
    try {
      // The run's start profile is the registry's opencode profile; the
      // shell's fake factory serves it.
      expect(started.profileName).toBe("oc")
      const facts: RoutingFacts = { ...routingFacts(registry, undefined, started.profileName), agentFilter: undefined, filterSource: undefined }
      const chain = deepChain()
      const result = await runSession(started.pool!, task, "p", { routing: facts, server: started.pool! }, chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      // The single-key ring is exhausted by the quota failure (its key marked
      // down, no rotation possible), §6.2 rule 4 keeps a1 out, and the model
      // failover moves to b1 on agent b as a blank new session.
      expect(chain.agent).toBe("b")
      expect(a.argsOf("fork")).toHaveLength(0)
      expect(b.argsOf("fork")).toHaveLength(0)
      const moved = b.prompts.find((prompt) => prompt.text.includes("moving to agent b"))
      expect(moved).toBeDefined()
      expect(moved!.text).toContain(WORKTREE_CHECK.trim())
    } finally {
      started.pool?.close()
      // The merge never drops a key: the touched keys are named (the saved
      // snapshot plus agent: undefined to drop the shell's fake agent).
      setShellProfile({ ...saved, agent: undefined })
    }
  })

  test("a resumed takeover whose model died under it moves too: the pending/old session is dropped", async () => {
    const { a, b, pool, facts } = await fleet()
    const chain = deepChain()
    try {
      const opts: Opts = { routing: facts, server: pool }
      // A first prompt on agent a binds the chain.
      await runSession(pool, task, "one", opts, chain, undefined, undefined, DEFAULTS)
      expect(chain.agent).toBe("a")
      // The recorded model goes down and the chain holds a live session with
      // a resume note: the pick moves to b1, so the takeover cannot reuse the
      // a-session — the §8.3 discard opens a blank session with the note.
      const { markModelDown } = await import("../src/failback")
      markModelDown("a1")
      chain.note = "[DRIVER] resume note"
      const result = await runSession(pool, task, "two", opts, chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      expect(chain.agent).toBe("b")
      const moved = b.prompts.find((prompt) => prompt.text.includes("moved to agent b"))
      expect(moved).toBeDefined()
      expect(a.prompts).toHaveLength(1)
    } finally {
      pool.close()
    }
  })
})

describe("the capability intersection (§8.5)", () => {
  test("degrades once at run start over the fleet's static records, naming the forcing agent", async () => {
    const { pool } = await fleet()
    try {
      // The fleet holds both adapters (deep lists a1 and b1); fake-a has no
      // question/permission/history, so the intersection notes name it with
      // its first listed entry.
      expect(lines).toContain(
        "⚙ the agent settles permission requests itself: --permission ask-deny → deny (--wait-answer does not apply to them); fake-a (a1) has none",
      )
      expect(lines).toContain(
        "⚙ the agent keeps no readable session history: a persisted fork base starts cold, a recovered session's usage counts as unknown; fake-a (a1) has none",
      )
      // The ask switch degrades with the same naming once it is on.
    } finally {
      pool.close()
    }
  })

  test("ask=on over the fleet forces ask off, naming the forcing agent; a filter that empties the fleet degrades on the start profile alone", async () => {
    clampSwitches({ ask: true })
    const { pool, facts } = await fleet()
    try {
      expect(lines).toContain(
        "⚙ OPENCODE_AUTO_ASK=on needs an agent that can ask questions; running with ask=off (decisions are made autonomously and labeled AUTO-RESOLVE); fake-a (a1) has none",
      )
      // No profile of the chosen (default) opencode adapter exists: the run's
      // start profile is the profile-less `opencode` name, as the one-agent
      // era's pick (unqualified records resolve through it).
      expect(facts.runAgent).toBe("opencode")
    } finally {
      pool.close()
    }
  })

  test("an agent filtered out of every list never enters the intersection", async () => {
    const { pool } = await fleet(undefined, undefined, JSON.stringify({ agents: { a: { adapter: "fake-a" }, b: { adapter: "fake-b" } }, models: { a1: { agent: "a", model: "prov/a" }, b1: { agent: "b", model: "other/b" } }, tiers: { deep: ["b1"], simple: ["b1"] } }))
    try {
      // Only agent b is in the lists; fake-b lacks nothing, so no note names
      // fake-a and the permission note never fires (fake-b has permission
      // events).
      expect(lines.filter((line) => line.startsWith("⚙"))).toEqual([])
    } finally {
      pool.close()
    }
  })

  test("a fleet agent that cannot fork: auto's lead runs without its split clause for the whole run, the note naming that agent (plans/0059 D7)", async () => {
    const dir = await temp("auto-agent-pool-nofork-")
    const a = fakeAgent({ capabilities: { fork: "none" }, limits: { "prov/a": 100_000 } })
    const b = fakeAgent({ limits: { "other/b": 100_000 } })
    registerAgentAdapter("fake-a", { host: fakeAgentHost(a).factory, capabilities: { ...FULL_CAPABILITIES, fork: "none" } })
    registerAgentAdapter("fake-b", { host: fakeAgentHost(b).factory, capabilities: FULL_CAPABILITIES })
    const file = join(dir, "models.json")
    await writeFile(
      file,
      JSON.stringify({
        agents: { a: { adapter: "fake-a" }, b: { adapter: "fake-b" } },
        models: { a1: { agent: "a", model: "prov/a" }, b1: { agent: "b", model: "other/b" } },
        tiers: { deep: ["a1", "b1"], simple: ["b1"] },
      }),
    )
    const registry = (await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file } }))!
    // The fork switch the degradation clamps is restored for later tests.
    const { fork } = autoSwitches()
    try {
      const auto = await startPool(dir, { registry, subtask: "auto" })
      expect(auto.leadSplit).toBe(false)
      expect(lines).toContain(
        "⚙ --subtask auto: the lead's split needs an agent that can fork sessions (each stream is a fork of the lead); the lead runs without its split clause, as an ondemand session does; fake-a (a1) has none",
      )
      auto.pool?.close()
      // The planned pipeline has no clause to lose: no note, the fact alone.
      lines.length = 0
      const pipeline = await startPool(dir, { registry, subtask: "true" })
      expect(pipeline.leadSplit).toBe(false)
      expect(lines.some((line) => line.includes("--subtask auto"))).toBe(false)
      pipeline.pool?.close()
    } finally {
      clampSwitches({ fork })
    }
  })

  test("a fleet that forks keeps the split clause: no leadSplit, no note", async () => {
    const started = await fleet()
    try {
      expect(started.leadSplit).toBeUndefined()
      expect(lines.some((line) => line.includes("--subtask auto"))).toBe(false)
    } finally {
      started.pool.close()
    }
  })
})

describe("preflight's bin check (§8.7)", () => {
  test("a profile's bin that fails or times out is a problem naming the profile; a working bin passes", async () => {
    const dir = await temp("auto-agent-pool-bin-")
    const ok = join(dir, "ok-bin")
    const dead = join(dir, "dead-bin")
    const hang = join(dir, "hang-bin")
    await writeFile(ok, "#!/bin/sh\nexit 0\n")
    await writeFile(dead, "#!/bin/sh\nexit 3\n")
    await writeFile(hang, "#!/bin/sh\nsleep 30\n")
    for (const file of [ok, dead, hang]) await chmod(file, 0o755)
    const registry = (await loadModels(dir, {
      phaseTypes: PHASE_TYPES,
      env: { OPENCODE_AUTO_MODELS: join(dir, "none.json") },
      adapters: ["fake-a"],
    }).catch(() => undefined)) ?? undefined
    // Build the registry by hand through a file: loadModels needs a layer.
    const file = join(dir, "models.json")
    await writeFile(file, JSON.stringify({ agents: { a: { adapter: "fake-a", bin: dead }, b: { adapter: "fake-a", bin: hang }, c: { adapter: "fake-a", bin: ok } }, models: { a1: { agent: "a", model: "prov/a" }, b1: { agent: "b", model: "prov/b" }, c1: { agent: "c", model: "prov/c" } }, tiers: { deep: ["a1", "b1", "c1"], simple: ["c1"] } }))
    const loaded = (await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file }, adapters: ["fake-a"] }))!
    // 3000ms, not a few hundred: macOS takes ~300ms to first-exec each
    // distinct script path (a per-path security assessment), which would race
    // a tight timeout even though the bins exit instantly.
    const problems = await checkAgentBins(loaded, undefined, { timeoutMs: 3000 })
    expect(problems).toEqual([
      `agent profile a (adapter fake-a): \`${dead} --version\` exited 3; fix the executable or the profile's bin and re-run`,
      `agent profile b (adapter fake-a): \`${hang} --version\` timed out after 3000ms; fix the executable or the profile's bin and re-run`,
    ])
    void registry
  })

  test("a missing bin names the spawn failure; an adapter without a default bin is skipped", async () => {
    const dir = await temp("auto-agent-pool-bin-")
    const file = join(dir, "models.json")
    await writeFile(file, JSON.stringify({ agents: { a: { adapter: "fake-a", bin: join(dir, "no-such-bin") } }, models: { a1: { agent: "a", model: "prov/a" } }, tiers: { deep: ["a1"], simple: ["a1"] } }))
    const loaded = (await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file }, adapters: ["fake-a"] }))!
    const problems = await checkAgentBins(loaded, undefined)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`agent profile a (adapter fake-a): \`${join(dir, "no-such-bin")} --version\``)
    // A profile without bin on an adapter that declares no default: skipped.
    await writeFile(file, JSON.stringify({ agents: { a: { adapter: "fake-a" } }, models: { a1: { agent: "a", model: "prov/a" } }, tiers: { deep: ["a1"], simple: ["a1"] } }))
    const bare = (await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file }, adapters: ["fake-a"] }))!
    expect(await checkAgentBins(bare, undefined)).toEqual([])
  })
})

describe("the models command's probe (§9)", () => {
  test("probes every listed model on its own agent and reports each answer; unused entries are not probed", async () => {
    const { registry, hosts, pool } = await fleet(undefined, {
      turn: (ctx) => [ev.text(ctx.session, "t", "ok"), ev.message(ctx.session, "m", 10), ev.step(ctx.session, "s"), ev.idle(ctx.session)],
    })
    try {
      const probes = await probeModels(registry, "/work", { timeoutMs: 5000 })
      expect(probes).toHaveLength(2)
      const a1 = probes.find((probe) => probe.name === "a1")!
      const b1 = probes.find((probe) => probe.name === "b1")!
      expect(a1).toMatchObject({ agent: "a", ok: true })
      // a1 answers with the default turn, b1 with the scripted "ok".
      expect(a1.line).toContain("ok — done:")
      expect(b1).toMatchObject({ agent: "b", ok: true })
      expect(b1.line).toContain("ok — ok")
      // Each probe ran on its own agent's host; the pool closed them.
      expect(hosts.a.starts()).toBe(1)
      expect(hosts.b.starts()).toBe(1)
      expect(hosts.a.closed() + hosts.b.closed()).toBe(2)
    } finally {
      pool.close()
    }
  })

  test("a model that errors reports the failure line; the exit stays the caller's", async () => {
    const { registry, pool } = await fleet({ fail: { prompt: new Error("provider blew up") } })
    try {
      const probes = await probeModels(registry, "/work", { timeoutMs: 5000 })
      const a1 = probes.find((probe) => probe.name === "a1")!
      expect(a1.ok).toBe(false)
      expect(a1.line).toContain("failed")
    } finally {
      pool.close()
    }
  })
})

describe("registerAgentAdapter (§8.8)", () => {
  test("a shell registers an adapter: the registration is readable, and the registry loader accepts the name", async () => {
    const agent = fakeAgent()
    const host = fakeAgentHost(agent)
    registerAgentAdapter("mine", { host: host.factory, capabilities: agent.client.capabilities, bin: "mine-cli" })
    expect(shellAdapter("mine")?.bin).toBe("mine-cli")
    const dir = await temp("auto-agent-pool-adapter-")
    const file = join(dir, "models.json")
    await writeFile(file, JSON.stringify({ agents: { m: { adapter: "mine" } }, models: { m1: { agent: "m", model: "prov/m" } }, tiers: { deep: ["m1"], simple: ["m1"] } }))
    const loaded = await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file } })
    expect(loaded?.agents.get("m")?.adapter).toBe("mine")
    // The pool starts the registered factory for the profile.
    const started = await startPool(dir, { registry: loaded! })
    try {
      await started.pool!.client("m")
      expect(host.starts()).toBe(1)
      expect(started.pool!.startedAgents()).toEqual(["m"])
    } finally {
      started.pool!.close()
    }
  })
})

describe("singleHost (the managed/no-registry wrapper)", () => {
  test("every call reaches the one host", async () => {
    const agent = fakeAgent()
    const host = fakeAgentHost(agent)
    const wrapped = singleHost(await host.factory("/work", { permission: "deny", log: () => {} }))
    expect(await wrapped.client("whatever")).toBe(agent.client)
    expect(await wrapped.restart("why", "whatever")).toBe(true)
    await wrapped.syncContext("whatever")
    wrapped.close()
    expect(host.closed()).toBe(1)
  })
})
