import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  checkModelReferences,
  loadModels,
  MODELS_FILE,
  ModelRegistryError,
  operatorLayerPath,
  projectLayerPath,
} from "../src/models"
import { BUILTIN_ADAPTERS, type LoadModelsOptions, type ModelRegistry, type ProfileEnvValue } from "../src/models-schema"
import { BUILTIN_PHASE_TYPES } from "../src/phases/registry"
import { setShellProfile, shellProfile } from "../src/shell"

// Every test builds its own home, operator file and target directory under a
// temporary root, and passes the environment explicitly: the operator's real
// ~/.config and OPENCODE_AUTO_MODELS are never read.
let root: string
let home: string
let target: string
let operator: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "auto-models-"))
  home = join(root, "home")
  target = join(root, "target")
  operator = join(root, "operator", "models.json")
  await mkdir(home, { recursive: true })
  await mkdir(target, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const TYPES = BUILTIN_PHASE_TYPES.map((entry) => entry.type)

async function put(path: string, content: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content, null, 2))
}
const writeOperator = (content: unknown) => put(operator, content)
const writeProject = (content: unknown) => put(projectLayerPath(target), content)

const load = (options: Partial<LoadModelsOptions> = {}) =>
  loadModels(target, { phaseTypes: TYPES, env: { OPENCODE_AUTO_MODELS: operator }, home, ...options })

async function loaded(options: Partial<LoadModelsOptions> = {}): Promise<ModelRegistry> {
  const registry = await load(options)
  if (registry === undefined) throw new Error("expected a registry")
  return registry
}

// The problem lines of a load that must fail.
async function problems(options: Partial<LoadModelsOptions> = {}): Promise<string[]> {
  try {
    await load(options)
  } catch (error) {
    if (error instanceof ModelRegistryError) {
      expect(error.message).toBe(error.problems.join("\n"))
      return error.problems
    }
    throw error
  }
  throw new Error("expected the registry to fail")
}

const OPERATOR = () => `model registry, operator layer ${operator}`
const PROJECT = `model registry, project layer ${MODELS_FILE}`

// The example registry of plans/0055 §4.2.
const EXAMPLE = {
  tz: "Asia/Shanghai",
  agents: {
    opencode: { adapter: "opencode", env: { HTTPS_PROXY: null } },
    claude: { adapter: "claude", env: { HTTPS_PROXY: "http://127.0.0.1:7890" } },
    "claude-b": { adapter: "claude", env: { CLAUDE_CONFIG_DIR: "~/.claude-b", HTTPS_PROXY: "{env:CLAUDE_B_PROXY}" } },
  },
  models: {
    opus: { agent: "claude", model: "opus", avoid: ["mon-fri 09:00-18:00"] },
    "opus-b": { agent: "claude-b", model: "opus", avoid: ["mon-fri 09:00-18:00"] },
    k3: {
      agent: "opencode",
      model: "moonshotai/kimi-k3-256k",
      wider: ["moonshotai/kimi-k3"],
      keys: ["{env:MOONSHOT_KEY_A}", "{env:MOONSHOT_KEY_B}"],
    },
    glm: {
      agent: "opencode",
      model: "zhipuai/glm-4.6",
      only: ["00:00-08:00", "sat-sun 00:00-24:00"],
      keys: ["{env:ZHIPU_KEY_A}", "{env:ZHIPU_KEY_B}", "{file:~/.secrets/zhipu-c}"],
    },
    k2: { agent: "opencode", model: "moonshotai/kimi-k2-turbo-preview" },
    free: { agent: "opencode", model: "opencode/some-free-model" },
  },
  tiers: { deep: ["opus", "opus-b", "k3"], simple: ["glm", "k2"] },
  routes: { acceptance: "deep", "phase-handover": ["k2"] },
  classifier: ["free"],
}

// A minimal registry on the implied opencode profile, extended per test.
const fleet = (models: Record<string, unknown>, rest: Record<string, unknown> = {}) => ({ models, ...rest })

describe("location: layers and no registry", () => {
  test("neither layer exists: no registry", async () => {
    expect(await load()).toBeUndefined()
  })

  test("OPENCODE_AUTO_MODELS naming a missing file is no operator layer, and the XDG file is then not read", async () => {
    const xdg = join(root, "xdg")
    await put(join(xdg, "opencode-auto", "models.json"), "not json at all")
    expect(await load({ env: { OPENCODE_AUTO_MODELS: operator, XDG_CONFIG_HOME: xdg } })).toBeUndefined()
  })

  test("without OPENCODE_AUTO_MODELS the operator layer is $XDG_CONFIG_HOME/<configDir>/models.json", async () => {
    const xdg = join(root, "xdg")
    const path = join(xdg, "opencode-auto", "models.json")
    await put(path, fleet({ k2: { agent: "opencode", model: "moonshotai/kimi-k2" } }))
    const registry = await loaded({ env: { XDG_CONFIG_HOME: xdg } })
    expect(registry.layers).toEqual([{ name: "operator", path }])
    // An empty OPENCODE_AUTO_MODELS is unset, as for the switches.
    expect((await loaded({ env: { OPENCODE_AUTO_MODELS: "", XDG_CONFIG_HOME: xdg } })).layers).toEqual([
      { name: "operator", path },
    ])
  })

  test("XDG_CONFIG_HOME defaults to ~/.config; a relative value is ignored", () => {
    expect(operatorLayerPath({ env: {}, home })).toBe(join(home, ".config", "opencode-auto", "models.json"))
    expect(operatorLayerPath({ env: { XDG_CONFIG_HOME: "" }, home })).toBe(
      join(home, ".config", "opencode-auto", "models.json"),
    )
    expect(operatorLayerPath({ env: { XDG_CONFIG_HOME: "relative/config" }, home })).toBe(
      join(home, ".config", "opencode-auto", "models.json"),
    )
  })

  test("the directory under XDG_CONFIG_HOME comes from the shell profile's configDir", () => {
    const before = shellProfile().configDir
    try {
      setShellProfile({ configDir: "opencode-auto-migrate" })
      expect(operatorLayerPath({ env: { XDG_CONFIG_HOME: "/xdg" }, home })).toBe(
        join("/xdg", "opencode-auto-migrate", "models.json"),
      )
      expect(operatorLayerPath({ env: { XDG_CONFIG_HOME: "/xdg" }, home, configDir: "other" })).toBe(
        join("/xdg", "other", "models.json"),
      )
    } finally {
      setShellProfile({ configDir: before })
    }
  })

  test("~ expands in OPENCODE_AUTO_MODELS", () => {
    expect(operatorLayerPath({ env: { OPENCODE_AUTO_MODELS: "~/fleet/models.json" }, home })).toBe(
      join(home, "fleet", "models.json"),
    )
  })

  test("a layer path that cannot be read fails and names the layer", async () => {
    await mkdir(operator, { recursive: true })
    const lines = await problems()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith(`${OPERATOR()}: cannot be read`)
  })
})

describe("parsing", () => {
  test("the design's example loads with every field, reference and layer", async () => {
    await writeOperator(EXAMPLE)
    const registry = await loaded()
    expect(registry.layers).toEqual([{ name: "operator", path: operator }])
    expect(registry.tz).toBe("Asia/Shanghai")
    expect(registry.tzLayer).toBe("operator")

    expect([...registry.agents.keys()]).toEqual(["opencode", "claude", "claude-b"])
    expect(registry.agents.get("opencode")).toEqual({
      name: "opencode",
      layer: "operator",
      adapter: "opencode",
      env: new Map([["HTTPS_PROXY", null]]),
    })
    expect(registry.agents.get("claude")!.env).toEqual(new Map([["HTTPS_PROXY", "http://127.0.0.1:7890"]]))
    expect(registry.agents.get("claude-b")!.env).toEqual(
      new Map<string, ProfileEnvValue>([
        ["CLAUDE_CONFIG_DIR", join(home, ".claude-b")],
        ["HTTPS_PROXY", { kind: "env", name: "CLAUDE_B_PROXY", ref: "{env:CLAUDE_B_PROXY}", label: "CLAUDE_B_PROXY" }],
      ]),
    )

    const k3 = registry.models.get("k3")!
    expect(k3).toMatchObject({
      name: "k3",
      layer: "operator",
      agent: "opencode",
      model: "moonshotai/kimi-k3-256k",
      provider: "moonshotai",
      wider: ["moonshotai/kimi-k3"],
    })
    expect(k3.keys!.map((key) => key.label)).toEqual(["MOONSHOT_KEY_A", "MOONSHOT_KEY_B"])
    const glm = registry.models.get("glm")!
    expect(glm.only!.map((window) => window.text)).toEqual(["00:00-08:00", "sat-sun 00:00-24:00"])
    expect(glm.only![1]!.days).toEqual([0, 6])
    expect(glm.avoid).toBeUndefined()
    expect(glm.keys![2]).toEqual({
      kind: "file",
      path: join(home, ".secrets", "zhipu-c"),
      ref: `{file:${join(home, ".secrets", "zhipu-c")}}`,
      label: "~/.secrets/zhipu-c",
    })
    const opus = registry.models.get("opus")!
    expect(opus).toMatchObject({ agent: "claude", model: "opus" })
    expect(opus.provider).toBeUndefined()
    expect(opus.avoid!.map((window) => window.text)).toEqual(["mon-fri 09:00-18:00"])

    expect(registry.tiers).toEqual({
      deep: { tier: "deep", names: ["opus", "opus-b", "k3"], layer: "operator" },
      simple: { tier: "simple", names: ["glm", "k2"], layer: "operator" },
    })
    expect([...registry.routes.values()]).toEqual([
      { key: "acceptance", layer: "operator", tier: "deep" },
      { key: "phase-handover", layer: "operator", names: ["k2"] },
    ])
    expect(registry.classifier).toEqual({ names: ["free"], layer: "operator" })
    expect(registry.unused).toEqual([])
  })

  test("the time zone defaults to UTC and is shown in its canonical spelling", async () => {
    await writeOperator(fleet({ k2: { agent: "opencode" } }))
    const plain = await loaded()
    expect(plain.tz).toBe("UTC")
    expect(plain.tzLayer).toBeUndefined()
    await writeOperator(fleet({ k2: { agent: "opencode" } }, { tz: "asia/shanghai" }))
    expect((await loaded()).tz).toBe("Asia/Shanghai")
  })

  test("without an agents section one opencode profile is implied", async () => {
    await writeOperator(
      fleet({ any: { agent: "opencode", avoid: ["04:00-10:00"] } }, { tiers: { deep: ["any"], simple: ["any"] } }),
    )
    const registry = await loaded()
    expect([...registry.agents.values()]).toEqual([{ name: "opencode", layer: "implied", adapter: "opencode" }])
    // An entry without model: the agent's default model, paused by its window.
    expect(registry.models.get("any")).toMatchObject({ agent: "opencode", layer: "operator" })
    expect(registry.models.get("any")!.model).toBeUndefined()
  })

  test("a declared agents section implies nothing: agent opencode must then be declared", async () => {
    await writeOperator(
      fleet({ k2: { agent: "opencode", model: "moonshotai/kimi-k2" } }, { agents: { claude: { adapter: "claude" } } }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.k2.agent: names no agent profile: "opencode" is not defined (defined: claude)`,
    ])
  })

  test("a model in no tier, no route list and not a classifier is noted as unused", async () => {
    await writeOperator({
      ...EXAMPLE,
      models: {
        ...EXAMPLE.models,
        spare: { agent: "opencode", model: "zhipuai/glm-4.5" },
        routed: { agent: "opencode", model: "zhipuai/glm-4.5-air" },
      },
      routes: { ...EXAMPLE.routes, wrapup: ["routed"] },
    })
    expect((await loaded()).unused).toEqual(["spare"])
  })

  test("route keys: role words, phase type ids (custom types as passed in) and preset letters", async () => {
    const routes = { decompose: "deep", implement: "deep", m: ["k2"], "security-review": "deep", bypass: ["k2", "k3"] }
    await writeOperator({ ...EXAMPLE, routes })
    expect((await problems())[0]).toBe(
      `${OPERATOR()}: routes.security-review: is not a role word (decompose, whole, subtask, wrapup, phase-plan, phase-handover, knowledge, prior-knowledge, implement-scan, number-recovery, bypass), a phase type id (analysis, design, implement, test, acceptance, knowledge) or a preset letter (a, d, m, t, v, k)`,
    )
    const registry = await loaded({ phaseTypes: [...TYPES, "security-review"] })
    expect([...registry.routes.keys()]).toEqual(Object.keys(routes))
  })

  test("the adapter list is a parameter, so a registered adapter is accepted", async () => {
    await writeOperator(fleet({ k: { agent: "kimi", model: "k3" } }, { agents: { kimi: { adapter: "kimi" } } }))
    expect(await problems()).toEqual([
      `${OPERATOR()}: agents.kimi.adapter: "kimi" is unknown (known adapters: opencode, claude)`,
    ])
    const registry = await loaded({ adapters: [...BUILTIN_ADAPTERS, "kimi"] })
    expect(registry.agents.get("kimi")!.adapter).toBe("kimi")
  })

  test("profile bin and server", async () => {
    await writeOperator({
      agents: {
        opencode: { adapter: "opencode", bin: "~/opencode-dev/bin/opencode", server: "http://127.0.0.1:4096" },
        claude: { adapter: "claude", bin: "/opt/claude/bin/claude" },
      },
    })
    const registry = await loaded()
    expect(registry.agents.get("opencode")).toMatchObject({
      bin: join(home, "opencode-dev", "bin", "opencode"),
      server: "http://127.0.0.1:4096",
    })
    expect(registry.agents.get("claude")!.bin).toBe("/opt/claude/bin/claude")
  })
})

describe("strict errors name the field and the layer", () => {
  test("bad JSON fails without quoting the offending token", async () => {
    await writeOperator('{ "models": { "glm": { "agent": "opencode", "keys": [sk-live-4f2a9c] } } }')
    const lines = await problems()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith(`${OPERATOR()}: not valid JSON (`)
    expect(lines[0]).not.toContain("sk")
  })

  test("the file must be an object with known top-level fields, and sections must be objects", async () => {
    await writeOperator([])
    expect(await problems()).toEqual([`${OPERATOR()}: must be a JSON object`])
    await writeOperator({ tierz: {}, models: [] })
    expect(await problems()).toEqual([
      `${OPERATOR()}: unknown field "tierz" (known: tz, agents, models, tiers, routes, classifier)`,
      `${OPERATOR()}: models must be an object`,
    ])
  })

  test("an unknown field inside an entry fails", async () => {
    await writeOperator(
      fleet(
        { glm: { agent: "opencode", model: "zhipuai/glm-4.6", aviod: ["09:00-18:00"] } },
        { agents: { opencode: { adapter: "opencode", proxy: "x" } } },
      ),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: agents.opencode: unknown field "proxy" (known: adapter, bin, env, server)`,
      `${OPERATOR()}: models.glm: unknown field "aviod" (known: agent, model, wider, variant, context, avoid, only, keys, retry)`,
    ])
  })

  test("every problem is reported at once, one line each", async () => {
    await writeOperator(fleet({ a: { agent: "nobody" }, b: { agent: "opencode", context: 0 } }, { tz: "Mars/Olympus" }))
    const lines = await problems()
    expect(lines).toEqual([
      `${OPERATOR()}: models.a.agent: names no agent profile: "nobody" is not defined (defined: opencode)`,
      `${OPERATOR()}: models.b.context: must be a positive number of k tokens (e.g. 256 for a 256k window)`,
      `${OPERATOR()}: tz: time zone "Mars/Olympus" is unknown (expected an IANA time zone name, e.g. "UTC", "Asia/Shanghai" or "Europe/Berlin")`,
    ])
  })

  test("a bad window names the window and the expected grammar", async () => {
    await writeOperator(
      fleet({ glm: { agent: "opencode", model: "zhipuai/glm-4.6", only: ["00:00-08:00", "9:00-18:00"] } }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.glm.only[1]: window "9:00-18:00": expected [days ]HH:MM-HH:MM, e.g. "mon-fri 09:00-18:00", "sat,sun 00:00-24:00" or "22:00-06:00"`,
    ])
  })

  test("avoid and only are mutually exclusive; an empty only list never opens and is refused; an empty avoid list is none", async () => {
    await writeOperator(fleet({ glm: { agent: "opencode", avoid: ["09:00-18:00"], only: ["00:00-08:00"] } }))
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.glm: avoid and only are mutually exclusive (avoid: unusable inside the windows; only: usable only inside them)`,
    ])
    await writeOperator(fleet({ glm: { agent: "opencode", only: [] } }))
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.glm.only: must list at least one of windows such as "mon-fri 09:00-18:00" (leave the field out for none)`,
    ])
    await writeOperator(fleet({ glm: { agent: "opencode", avoid: [] } }))
    expect((await loaded()).models.get("glm")!.avoid).toEqual([])
  })

  test("a bad time zone", async () => {
    await writeOperator(fleet({}, { tz: "Mars/Olympus" }))
    expect(await problems()).toEqual([
      `${OPERATOR()}: tz: time zone "Mars/Olympus" is unknown (expected an IANA time zone name, e.g. "UTC", "Asia/Shanghai" or "Europe/Berlin")`,
    ])
    await writeOperator(fleet({}, { tz: 8 }))
    expect(await problems()).toEqual([`${OPERATOR()}: tz: must be an IANA time zone name (default UTC)`])
  })

  test("an unknown agent or adapter; a missing adapter", async () => {
    await writeOperator({
      agents: { claude: { adapter: "claude" }, kimi: { adapter: "kimi" }, bare: {} },
      models: { opus: { agent: "claud", model: "opus" } },
    })
    expect(await problems()).toEqual([
      `${OPERATOR()}: agents.kimi.adapter: "kimi" is unknown (known adapters: opencode, claude)`,
      `${OPERATOR()}: agents.bare.adapter: is required (known adapters: opencode, claude)`,
      `${OPERATOR()}: models.opus.agent: names no agent profile: "claud" is not defined (defined: claude, kimi, bare)`,
    ])
  })

  test("internal names match ^[a-z][a-z0-9.-]*$, for models and agent profiles", async () => {
    await writeOperator({
      agents: { Claude: { adapter: "claude" } },
      models: { "glm/4.6": { agent: "Claude" }, "glm-4.6": { agent: "Claude" } },
    })
    expect(await problems()).toEqual([
      `${OPERATOR()}: agents."Claude": the name must match ^[a-z][a-z0-9.-]*$ (a lowercase letter, then lowercase letters, digits, "." or "-")`,
      `${OPERATOR()}: models."glm/4.6": the name must match ^[a-z][a-z0-9.-]*$ (a lowercase letter, then lowercase letters, digits, "." or "-")`,
    ])
  })

  test("an opencode model id names its provider", async () => {
    await writeOperator(
      fleet({
        glm: { agent: "opencode", model: "glm-4.6" },
        x: { agent: "opencode", model: "zhipuai/" },
        y: { agent: "opencode", model: "" },
      }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.glm.model: "glm-4.6" is not provider/model (opencode model ids name their provider)`,
      `${OPERATOR()}: models.x.model: "zhipuai/" is not provider/model (opencode model ids name their provider)`,
      `${OPERATOR()}: models.y.model: must be a non-empty model id`,
    ])
  })

  test("context is a positive number of k tokens", async () => {
    await writeOperator(
      fleet({
        a: { agent: "opencode", context: -1 },
        b: { agent: "opencode", context: "256" },
        c: { agent: "opencode", context: 256 },
      }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.a.context: must be a positive number of k tokens (e.g. 256 for a 256k window)`,
      `${OPERATOR()}: models.b.context: must be a positive number of k tokens (e.g. 256 for a 256k window)`,
    ])
  })

  test("a ring conflict on one provider", async () => {
    const a = "{env:ZHIPU_KEY_A}"
    const b = "{env:ZHIPU_KEY_B}"
    await writeOperator(
      fleet({
        glm: { agent: "opencode", model: "zhipuai/glm-4.6", keys: [a, b] },
        air: { agent: "opencode", model: "zhipuai/glm-4.5-air", keys: [a] },
        swapped: { agent: "opencode", model: "zhipuai/glm-4.5", keys: [b, a] },
        k2: { agent: "opencode", model: "moonshotai/kimi-k2", keys: [a] },
      }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.air.keys: differs from the ring of models.glm (operator layer) on provider zhipuai; entries on one provider declare the same ring, in the same order, or none`,
      `${OPERATOR()}: models.swapped.keys: differs from the ring of models.glm (operator layer) on provider zhipuai; entries on one provider declare the same ring, in the same order, or none`,
    ])
    // The same ring, or none, on one provider is fine; another provider has its own ring.
    await writeOperator(
      fleet({
        glm: { agent: "opencode", model: "zhipuai/glm-4.6", keys: [a, b] },
        air: { agent: "opencode", model: "zhipuai/glm-4.5-air", keys: [a, b] },
        plain: { agent: "opencode", model: "zhipuai/glm-4.5" },
        k2: { agent: "opencode", model: "moonshotai/kimi-k2", keys: [a] },
      }),
    )
    expect((await loaded()).models.get("air")!.keys!.map((key) => key.ref)).toEqual([a, b])
  })

  test("keys on a claude profile", async () => {
    await writeOperator({
      agents: { claude: { adapter: "claude" } },
      models: { opus: { agent: "claude", model: "opus", keys: ["{env:ANTHROPIC_KEY}"] } },
    })
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.opus.keys: is allowed only on opencode profiles in this version (agent claude has adapter claude)`,
    ])
  })

  test("variant on claude is refused; on opencode it is kept", async () => {
    await writeOperator({
      agents: { opencode: { adapter: "opencode" }, claude: { adapter: "claude" } },
      models: {
        opus: { agent: "claude", model: "opus", variant: "high" },
        glm: { agent: "opencode", model: "zhipuai/glm-4.6", variant: "high" },
      },
    })
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.opus.variant: is not supported on claude profiles in this version (claude -p has no verified per-turn variant)`,
    ])
    await writeOperator({ models: { glm: { agent: "opencode", model: "zhipuai/glm-4.6", variant: "high" } } })
    expect((await loaded()).models.get("glm")!.variant).toBe("high")
  })

  // plans/0057 §11 item 3: the agent's retry policy, overridden per entry.
  test("a retry override keeps the fields it names, on any adapter and without model", async () => {
    await writeOperator({
      agents: { opencode: { adapter: "opencode" }, claude: { adapter: "claude" } },
      models: {
        opus: { agent: "claude", model: "opus", retry: { maxAttempts: 300, waitsOutLimit: true, silenceBudgetMs: 21_600_000 } },
        glm: { agent: "opencode", model: "zhipuai/glm-4.6", retry: { backoffCapMs: 0, honorsRetryAfter: false } },
        plain: { agent: "claude", retry: { maxAttempts: 15 } },
      },
    })
    const models = (await loaded()).models
    expect(models.get("opus")!.retry).toEqual({ maxAttempts: 300, waitsOutLimit: true, silenceBudgetMs: 21_600_000 })
    expect(models.get("glm")!.retry).toEqual({ backoffCapMs: 0, honorsRetryAfter: false })
    expect(models.get("plain")!.retry).toEqual({ maxAttempts: 15 })
  })

  test("a bad retry override names each bad field", async () => {
    await writeOperator(
      fleet({
        a: { agent: "opencode", retry: {} },
        b: { agent: "opencode", retry: [3] },
        c: { agent: "opencode", retry: { maxAttempts: 0, backoffCapMs: -1, honorsRetryAfter: "yes", attempts: 3 } },
        d: { agent: "opencode", retry: { maxAttempts: 2.5, silenceBudgetMs: "10m", waitsOutLimit: 1 } },
      }),
    )
    const known = "maxAttempts, backoffCapMs, honorsRetryAfter, waitsOutLimit, silenceBudgetMs"
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.a.retry: must be an object with at least one of ${known}`,
      `${OPERATOR()}: models.b.retry: must be an object with at least one of ${known}`,
      `${OPERATOR()}: models.c.retry: unknown field "attempts" (known: ${known})`,
      `${OPERATOR()}: models.c.retry.maxAttempts: must be a positive whole number (the agent's own attempt cap)`,
      `${OPERATOR()}: models.c.retry.backoffCapMs: must be a number of milliseconds, 0 or more (the longest wait the agent's own backoff chooses)`,
      `${OPERATOR()}: models.c.retry.honorsRetryAfter: must be true or false`,
      `${OPERATOR()}: models.d.retry.maxAttempts: must be a positive whole number (the agent's own attempt cap)`,
      `${OPERATOR()}: models.d.retry.silenceBudgetMs: must be a number of milliseconds, 0 or more (the silence taken in stride while the agent backs off)`,
      `${OPERATOR()}: models.d.retry.waitsOutLimit: must be true or false`,
    ])
  })

  test("a literal key is refused and never quoted", async () => {
    await writeOperator(
      fleet({
        glm: {
          agent: "opencode",
          model: "zhipuai/glm-4.6",
          keys: ["{env:ZHIPU_KEY_A}", "sk-live-4f2a9c", 42, "{env:ZHIPU KEY}", "{file:}"],
        },
      }),
    )
    const lines = await problems()
    expect(lines).toEqual([
      `${OPERATOR()}: models.glm.keys[1]: a literal key is refused: keys are references only ({env:NAME} or {file:path}); the value is not shown`,
      `${OPERATOR()}: models.glm.keys[2]: a literal key is refused: keys are references only ({env:NAME} or {file:path}); the value is not shown`,
      `${OPERATOR()}: models.glm.keys[3]: the {env:NAME} reference does not name a variable (letters, digits and "_", not starting with a digit)`,
      `${OPERATOR()}: models.glm.keys[4]: is not a reference: write the whole value as {env:NAME} or {file:path}`,
    ])
    expect(lines.join("\n")).not.toContain("4f2a9c")
  })

  test("keys: an empty ring and a repeated reference are refused", async () => {
    await writeOperator(
      fleet({
        glm: { agent: "opencode", model: "zhipuai/glm-4.6", keys: [] },
        k2: { agent: "opencode", model: "moonshotai/kimi-k2", keys: ["{env:A}", "{env:A}"] },
      }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.glm.keys: must be a non-empty list of references ({env:NAME} or {file:path})`,
      `${OPERATOR()}: models.k2.keys[1]: repeats the reference A`,
    ])
  })

  test("server is allowed only on opencode profiles, as an http(s) URL", async () => {
    await writeOperator({
      agents: {
        opencode: { adapter: "opencode", server: "localhost:4096" },
        claude: { adapter: "claude", server: "http://127.0.0.1:4096" },
      },
    })
    expect(await problems()).toEqual([
      `${OPERATOR()}: agents.opencode.server: must be an http or https URL of a running opencode server`,
      `${OPERATOR()}: agents.claude.server: is allowed only on opencode profiles (adapter here: claude)`,
    ])
  })

  test("tiers: only deep and simple, each a list of distinct existing names", async () => {
    await writeOperator(
      fleet({ k2: { agent: "opencode" } }, { tiers: { deep: ["k2", "k3"], simple: ["k2", "k2"], fast: ["k2"] } }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: tiers.deep: names no model: "k3" is not defined (defined: k2)`,
      `${OPERATOR()}: tiers.simple: lists "k2" twice`,
      `${OPERATOR()}: tiers.fast: is not a tier (tiers: deep, simple)`,
    ])
  })

  test("routes: * is refused, a value is a tier name or a non-empty list of existing names", async () => {
    await writeOperator(
      fleet(
        { k2: { agent: "opencode" } },
        { routes: { "*": "deep", decompose: "k2", wrapup: ["k3"], knowledge: [], implement: 3 } },
      ),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: routes."*": * is not a route key: the tier lists already are the default`,
      `${OPERATOR()}: routes.decompose: "k2" is not a tier (deep, simple); a list of models is written as ["k2"]`,
      `${OPERATOR()}: routes.wrapup: names no model: "k3" is not defined (defined: k2)`,
      `${OPERATOR()}: routes.knowledge: must list at least one of model names (leave the field out for none)`,
      `${OPERATOR()}: routes.implement: must be a list of model names`,
    ])
  })

  test("classifier names existing entries on opencode profiles", async () => {
    await writeOperator({ ...EXAMPLE, classifier: ["free", "opus", "nobody"] })
    expect(await problems()).toEqual([
      `${OPERATOR()}: classifier: names no model: "nobody" is not defined (defined: opus, opus-b, k3, glm, k2, free)`,
      `${OPERATOR()}: classifier: "opus" runs on adapter claude; classifiers run on opencode profiles only in this version (a claude session cannot yet run without tools)`,
    ])
    await writeOperator({ ...EXAMPLE, classifier: [] })
    expect((await loaded()).classifier).toEqual({ names: [], layer: "operator" })
  })
})

describe("entries without model, and context steps", () => {
  test("an entry without model has no keys, variant or wider", async () => {
    await writeOperator(fleet({ any: { agent: "opencode", keys: ["{env:A}"], variant: "high", wider: ["x/y"] } }))
    const needs =
      "needs model: an entry without model runs on the agent's default model, which has no keys, variant or wider"
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.any.wider: ${needs}`,
      `${OPERATOR()}: models.any.variant: ${needs}`,
      `${OPERATOR()}: models.any.keys: ${needs}`,
    ])
  })

  test("wider on claude is refused", async () => {
    await writeOperator({
      agents: { claude: { adapter: "claude" } },
      models: { opus: { agent: "claude", model: "opus", wider: ["opus[1m]"] } },
    })
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.opus.wider: is allowed only on opencode profiles in this version (agent claude has adapter claude)`,
    ])
  })

  test("every wider step is on the entry's provider and is not the base id", async () => {
    await writeOperator(
      fleet({
        k3: {
          agent: "opencode",
          model: "moonshotai/kimi-k3-256k",
          wider: ["moonshotai/kimi-k3", "openrouter/kimi-k3", "moonshotai/kimi-k3-256k", "moonshotai/"],
        },
      }),
    )
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.k3.wider[1]: "openrouter/kimi-k3" is not on the entry's provider moonshotai (steps share one cache, so one provider)`,
      `${OPERATOR()}: models.k3.wider[2]: repeats the entry's model "moonshotai/kimi-k3-256k"; a step is a wider-window id`,
      `${OPERATOR()}: models.k3.wider[3]: "moonshotai/" is not on the entry's provider moonshotai (steps share one cache, so one provider)`,
    ])
    await writeOperator(fleet({ k3: { agent: "opencode", model: "moonshotai/kimi-k3-256k", wider: [] } }))
    expect(await problems()).toEqual([
      `${OPERATOR()}: models.k3.wider: must list at least one of model ids on the entry's provider (leave the field out for none)`,
    ])
  })
})

describe("profile env", () => {
  test("literals (~ expanded), references and null", async () => {
    await writeOperator({
      agents: {
        claude: {
          adapter: "claude",
          env: {
            CLAUDE_CONFIG_DIR: "~/.claude-b",
            HTTPS_PROXY: "{env:PROXY_URL}",
            NO_PROXY: "127.0.0.1,localhost",
            ALL_PROXY: null,
            TOKEN_FILE: "{file:proxy-token}",
          },
        },
      },
    })
    const env = (await loaded()).agents.get("claude")!.env!
    expect(env.get("CLAUDE_CONFIG_DIR")).toBe(join(home, ".claude-b"))
    expect(env.get("HTTPS_PROXY")).toEqual({
      kind: "env",
      name: "PROXY_URL",
      ref: "{env:PROXY_URL}",
      label: "PROXY_URL",
    })
    expect(env.get("NO_PROXY")).toBe("127.0.0.1,localhost")
    expect(env.get("ALL_PROXY")).toBeNull()
    expect(env.has("ALL_PROXY")).toBe(true)
    expect(env.get("TOKEN_FILE")).toMatchObject({
      kind: "file",
      path: join(dirname(operator), "proxy-token"),
      label: "proxy-token",
    })
  })

  test("bad names and values are refused without quoting the value", async () => {
    await writeOperator({
      agents: {
        claude: {
          adapter: "claude",
          env: {
            "HTTPS-PROXY": "x",
            HTTP_PROXY: "http://user:hunter2@{env:PROXY_HOST}",
            NO_PROXY: 1,
            ALL_PROXY: "{env:}",
          },
        },
      },
    })
    const lines = await problems()
    expect(lines).toEqual([
      `${OPERATOR()}: agents.claude.env: "HTTPS-PROXY" is not a variable name (letters, digits and "_", not starting with a digit)`,
      `${OPERATOR()}: agents.claude.env.HTTP_PROXY: is not a reference: write the whole value as {env:NAME} or {file:path}`,
      `${OPERATOR()}: agents.claude.env.NO_PROXY: must be a string, {env:NAME} or {file:path}, or null to remove the inherited variable`,
      `${OPERATOR()}: agents.claude.env.ALL_PROXY: the {env:NAME} reference does not name a variable (letters, digits and "_", not starting with a digit)`,
    ])
    expect(lines.join("\n")).not.toContain("hunter2")
    await writeOperator({ agents: { claude: { adapter: "claude", env: ["HTTPS_PROXY"] } } })
    expect(await problems()).toEqual([
      `${OPERATOR()}: agents.claude.env: must be an object of variable names to values`,
    ])
  })
})

describe("layers", () => {
  test("a project layer alone is a registry", async () => {
    await writeProject(fleet({ k2: { agent: "opencode", model: "moonshotai/kimi-k2" } }, { tiers: { simple: ["k2"] } }))
    const registry = await loaded()
    expect(registry.layers).toEqual([{ name: "project", path: projectLayerPath(target) }])
    expect(registry.models.get("k2")!.layer).toBe("project")
    expect(registry.tiers.simple!.layer).toBe("project")
  })

  test("a project entry replaces the operator's whole: nothing merges inside an entry", async () => {
    await writeOperator(EXAMPLE)
    await writeProject({
      models: { glm: { agent: "opencode", model: "zhipuai/glm-4.6", avoid: ["mon-fri 09:00-18:00"] } },
      tz: "UTC",
    })
    const registry = await loaded()
    expect(registry.layers.map((layer) => layer.name)).toEqual(["operator", "project"])
    const glm = registry.models.get("glm")!
    expect(glm.layer).toBe("project")
    expect(glm.avoid!.map((window) => window.text)).toEqual(["mon-fri 09:00-18:00"])
    // The operator's `only` and `keys` are not carried over.
    expect(glm.only).toBeUndefined()
    expect(glm.keys).toBeUndefined()
    expect(registry.models.get("k3")!.layer).toBe("operator")
    // A replaced entry keeps its place in the order.
    expect([...registry.models.keys()]).toEqual(["opus", "opus-b", "k3", "glm", "k2", "free"])
    expect(registry.tz).toBe("UTC")
    expect(registry.tzLayer).toBe("project")
  })

  test("tiers, routes and classifier are replaced per key and whole", async () => {
    await writeOperator(EXAMPLE)
    await writeProject({ tiers: { simple: ["k2"] }, routes: { acceptance: ["k3"] }, classifier: ["k2"] })
    const registry = await loaded()
    expect(registry.tiers.deep).toEqual({ tier: "deep", names: ["opus", "opus-b", "k3"], layer: "operator" })
    expect(registry.tiers.simple).toEqual({ tier: "simple", names: ["k2"], layer: "project" })
    expect(registry.routes.get("acceptance")).toEqual({ key: "acceptance", layer: "project", names: ["k3"] })
    expect(registry.routes.get("phase-handover")!.layer).toBe("operator")
    expect(registry.classifier).toEqual({ names: ["k2"], layer: "project" })
    // glm and free are named nowhere any more.
    expect(registry.unused).toEqual(["glm", "free"])
  })

  test("null removes the operator's entry", async () => {
    await writeOperator(EXAMPLE)
    await writeProject({
      models: { opus: null, "opus-b": null },
      agents: { claude: null, "claude-b": null },
      tiers: { deep: ["k3"] },
      routes: { "phase-handover": null },
    })
    const registry = await loaded()
    expect([...registry.models.keys()]).toEqual(["k3", "glm", "k2", "free"])
    expect([...registry.agents.keys()]).toEqual(["opencode"])
    expect(registry.agents.get("opencode")!.layer).toBe("operator")
    expect([...registry.routes.keys()]).toEqual(["acceptance"])
  })

  test("a reference to a removed entry says which layer removed it", async () => {
    await writeOperator(EXAMPLE)
    await writeProject({ models: { k2: null } })
    expect(await problems()).toEqual([
      `${OPERATOR()}: tiers.simple: names no model: "k2" was removed by the project layer`,
      `${OPERATOR()}: routes.phase-handover: names no model: "k2" was removed by the project layer`,
    ])
  })

  test("an error names the layer its entry came from", async () => {
    await writeOperator(EXAMPLE)
    await writeProject({
      models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2", aviod: [] } },
      tiers: { simple: ["glm", "k9"] },
    })
    expect(await problems()).toEqual([
      `${PROJECT}: models.k2: unknown field "aviod" (known: agent, model, wider, variant, context, avoid, only, keys, retry)`,
      `${PROJECT}: tiers.simple: names no model: "k9" is not defined (defined: opus, opus-b, k3, glm, k2, free)`,
    ])
    // A ring conflict across layers names both.
    await writeProject({
      models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2", keys: ["{env:MOONSHOT_KEY_C}"] } },
    })
    expect(await problems()).toEqual([
      `${PROJECT}: models.k2.keys: differs from the ring of models.k3 (operator layer) on provider moonshotai; entries on one provider declare the same ring, in the same order, or none`,
    ])
    // Bad JSON in the project layer.
    await writeProject("{")
    expect((await problems())[0]).toStartWith(`${PROJECT}: not valid JSON`)
  })

  test("an operator entry that the project layer replaces or removes is not validated", async () => {
    await writeOperator({
      ...EXAMPLE,
      models: {
        ...EXAMPLE.models,
        k2: { agent: "opencode", model: "moonshotai/kimi-k2", aviod: [] },
        old: { agent: "gone" },
      },
    })
    await writeProject({ models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2" }, old: null } })
    expect((await loaded()).models.get("k2")!.layer).toBe("project")
  })

  test("a relative {file:} resolves against the directory of its own layer", async () => {
    await writeOperator(fleet({ glm: { agent: "opencode", model: "zhipuai/glm-4.6", keys: ["{file:keys/zhipu}"] } }))
    await writeProject(
      fleet({
        k2: { agent: "opencode", model: "moonshotai/kimi-k2", keys: ["{file:keys/moonshot}", "{file:/etc/moonshot}"] },
      }),
    )
    const registry = await loaded()
    expect(registry.models.get("glm")!.keys![0]).toMatchObject({
      path: join(dirname(operator), "keys", "zhipu"),
      label: "keys/zhipu",
    })
    expect(registry.models.get("k2")!.keys!.map((key) => key.ref)).toEqual([
      `{file:${join(target, ".opencode", "auto", "keys", "moonshot")}}`,
      "{file:/etc/moonshot}",
    ])
  })

  test("the implied opencode profile applies when the merged result has no profile", async () => {
    await writeOperator({
      agents: { opencode: { adapter: "opencode", server: "http://127.0.0.1:4096" } },
      models: { k2: { agent: "opencode" } },
    })
    await writeProject({ agents: { opencode: null } })
    expect([...(await loaded()).agents.values()]).toEqual([{ name: "opencode", layer: "implied", adapter: "opencode" }])
  })
})

describe("checkModelReferences", () => {
  const SECRET = "value-that-must-not-appear"

  test("names missing, empty and unreadable references, never a value", async () => {
    await writeOperator(EXAMPLE)
    const registry = await loaded()
    await put(join(home, ".secrets", "zhipu-c"), SECRET)
    const env = { MOONSHOT_KEY_A: SECRET, MOONSHOT_KEY_B: "", ZHIPU_KEY_A: SECRET, CLAUDE_B_PROXY: SECRET }
    const found = checkModelReferences(registry, env)
    expect(found).toEqual([
      {
        field: "models.k3.keys[1]",
        layer: "operator",
        label: "MOONSHOT_KEY_B",
        message: `${OPERATOR()}: models.k3.keys[1]: env MOONSHOT_KEY_B is empty`,
      },
      {
        field: "models.glm.keys[1]",
        layer: "operator",
        label: "ZHIPU_KEY_B",
        message: `${OPERATOR()}: models.glm.keys[1]: env ZHIPU_KEY_B is not set`,
      },
    ])
    expect(JSON.stringify(found)).not.toContain(SECRET)
  })

  test("profile env references are checked; literals and null are not", async () => {
    await writeOperator(EXAMPLE)
    const registry = await loaded()
    await put(join(home, ".secrets", "zhipu-c"), SECRET)
    const keys = { MOONSHOT_KEY_A: "a", MOONSHOT_KEY_B: "b", ZHIPU_KEY_A: "c", ZHIPU_KEY_B: "d" }
    expect(checkModelReferences(registry, keys).map((problem) => problem.message)).toEqual([
      `${OPERATOR()}: agents.claude-b.env.HTTPS_PROXY: env CLAUDE_B_PROXY is not set`,
    ])
    expect(checkModelReferences(registry, { ...keys, CLAUDE_B_PROXY: "http://proxy" })).toEqual([])
  })

  test("a missing file, a directory and an unreadable file are named by the path as written", async () => {
    await writeOperator(
      fleet({
        glm: {
          agent: "opencode",
          model: "zhipuai/glm-4.6",
          keys: ["{file:~/.secrets/zhipu-c}", "{file:keys}", "{file:locked}"],
        },
      }),
    )
    const registry = await loaded()
    await mkdir(join(dirname(operator), "keys"))
    await put(join(dirname(operator), "locked"), SECRET)
    await chmod(join(dirname(operator), "locked"), 0o000)
    const messages = checkModelReferences(registry, {}).map((problem) => problem.message)
    expect(messages[0]).toBe(`${OPERATOR()}: models.glm.keys[0]: file ~/.secrets/zhipu-c does not exist`)
    expect(messages[1]).toBe(`${OPERATOR()}: models.glm.keys[1]: file keys is not a regular file`)
    // root reads any file, so the unreadable case holds only for other users.
    if (process.getuid?.() !== 0)
      expect(messages[2]).toBe(`${OPERATOR()}: models.glm.keys[2]: file locked is not readable`)
    expect(messages.join("\n")).not.toContain(SECRET)
    await put(join(home, ".secrets", "zhipu-c"), SECRET)
    await chmod(join(dirname(operator), "locked"), 0o600)
    await rm(join(dirname(operator), "keys"), { recursive: true })
    await put(join(dirname(operator), "keys"), SECRET)
    expect(checkModelReferences(registry, {})).toEqual([])
  })
})
