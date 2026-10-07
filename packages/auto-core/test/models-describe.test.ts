// The models command's data (plans/0055 §9): checkModels (the run start's
// registry checks as data), describeModels (the effective table per phase type
// and role, with usability now) and formatModels (the printed lines), plus the
// candidate list helper of src/model-route.ts. Every test builds its own home,
// operator file and target directory and passes the environment explicitly,
// and the clock is fixed.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { candidateList, routeFor } from "../src/model-route"
import { MODELS_FILE, projectLayerPath } from "../src/models"
import {
  checkModels,
  describeModels,
  formatModels,
  projectLayerRefusal,
  type DescribeModelsOptions,
  type ModelTable,
  type RouteRow,
} from "../src/models-describe"
import { PHASE_TYPE_DIR } from "../src/phases/custom"
import { BUILTIN_PHASE_TYPES, phaseType } from "../src/phases/registry"
import { setShellProfile } from "../src/shell"
import { MODEL_ROLES, type ModelRole } from "../src/switches"

let root: string
let home: string
let target: string
let operator: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "auto-models-describe-"))
  home = join(root, "home")
  target = join(root, "target")
  operator = join(root, "operator", "models.json")
  await mkdir(home, { recursive: true })
  await mkdir(target, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(path: string, content: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content, null, 2))
}
const writeOperator = (content: unknown) => put(operator, content)
const writeProject = (content: unknown) => put(projectLayerPath(target), content)

// Friday 2026-09-25 14:00 in Asia/Shanghai (UTC+8): inside opus's
// `mon-fri 09:00-18:00` avoid window and outside glm's only windows.
const NOW = Date.parse("2026-09-25T06:00:00Z")

// The key values the tests set; none may ever reach the output.
const SECRETS = {
  MOONSHOT_KEY_A: "sk-moonshot-secret-a",
  MOONSHOT_KEY_B: "sk-moonshot-secret-b",
  ZHIPU_KEY_A: "sk-zhipu-secret-a",
  ZHIPU_KEY_B: "sk-zhipu-secret-b",
  CLAUDE_B_PROXY: "http://user:proxy-secret@10.0.0.1:3128",
}

// The environment of a run with every reference resolvable, plus extras.
const envWith = (extra: Record<string, string> = {}) => ({ OPENCODE_AUTO_MODELS: operator, ...SECRETS, ...extra })

const describeTarget = (options: Partial<DescribeModelsOptions> = {}) =>
  describeModels(target, NOW, { env: envWith(), home, ...options })

async function table(options: Partial<DescribeModelsOptions> = {}): Promise<ModelTable> {
  const description = await describeTarget(options)
  if (description.table === undefined) throw new Error(`expected a table: ${description.problems.join("\n")}`)
  return description.table
}

const row = (t: ModelTable, type: string, role: ModelRole): RouteRow =>
  t.types.find((item) => item.type === type)!.rows.find((item) => item.role === role)!
const names = (r: RouteRow) => r.candidates.map((item) => item.name)
const model = (t: ModelTable, name: string) => t.models.find((item) => item.name === name)!

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

// The example with the file reference resolvable.
async function writeExample(content: unknown = EXAMPLE): Promise<void> {
  await put(join(home, ".secrets", "zhipu-c"), "not read by the tests")
  await writeOperator(content)
}

const typeFile = (type: string, reasoning?: string) =>
  put(
    join(target, PHASE_TYPE_DIR, `${type}.md`),
    `# ${type}\n\n${reasoning ? `Reasoning: ${reasoning}\n\n` : ""}## plan duties\n\nPlan it.\n`,
  )

describe("candidate lists (model-route)", () => {
  const tiers = {
    deep: { tier: "deep" as const, names: ["opus", "k3"], layer: "operator" as const },
    simple: { tier: "simple" as const, names: ["glm", "k3"], layer: "operator" as const },
  }
  const analysis = phaseType("analysis")!
  const implement = phaseType("implement")!

  test("the default tier: planning deep, task sessions the type's execute tier, the rest simple", () => {
    const registry = { tiers, routes: new Map() }
    expect(candidateList(registry, analysis, "whole")).toEqual({ tier: "deep", names: ["opus", "k3"], own: 2 })
    expect(candidateList(registry, implement, "decompose").tier).toBe("deep")
    expect(candidateList(registry, implement, "whole").tier).toBe("simple")
    expect(candidateList(registry, analysis, "wrapup").tier).toBe("simple")
  })

  test("simple continues down the deep list without repeating a model; deep never borrows", () => {
    const registry = { tiers, routes: new Map() }
    expect(candidateList(registry, implement, "subtask")).toEqual({ tier: "simple", names: ["glm", "k3", "opus"], own: 2 })
    expect(candidateList({ tiers: { deep: tiers.deep }, routes: new Map() }, implement, "subtask")).toEqual({
      tier: "simple",
      names: ["opus", "k3"],
      own: 0,
    })
    expect(candidateList({ tiers: { simple: tiers.simple }, routes: new Map() }, analysis, "whole")).toEqual({
      tier: "deep",
      names: [],
      own: 0,
    })
  })

  test("route precedence: role > type > letter; a list replaces the tier's list and borrows nothing", () => {
    const routes = new Map([
      ["implement", { key: "implement", layer: "operator" as const, tier: "deep" as const }],
      ["m", { key: "m", layer: "operator" as const, names: ["glm"] }],
      ["whole", { key: "whole", layer: "project" as const, names: ["k3"] }],
    ])
    const registry = { tiers, routes }
    expect(candidateList(registry, implement, "whole")).toEqual({ tier: "simple", route: routes.get("whole"), names: ["k3"], own: 1 })
    expect(candidateList(registry, implement, "wrapup")).toEqual({
      tier: "deep",
      route: routes.get("implement"),
      names: ["opus", "k3"],
      own: 2,
    })
    routes.delete("implement")
    expect(candidateList(registry, implement, "wrapup")).toEqual({ tier: "simple", route: routes.get("m"), names: ["glm"], own: 1 })
    // Without a phase entry only the role routes.
    expect(routeFor(routes, undefined, "wrapup")).toBeUndefined()
  })

  test("a key that is a role word routes the role only: the knowledge type goes by its letter", () => {
    const knowledge = phaseType("knowledge")!
    const routes = new Map([
      ["knowledge", { key: "knowledge", layer: "operator" as const, tier: "deep" as const }],
      ["k", { key: "k", layer: "operator" as const, names: ["glm"] }],
    ])
    expect(routeFor(routes, analysis, "knowledge")?.key).toBe("knowledge")
    expect(routeFor(routes, knowledge, "wrapup")?.key).toBe("k")
    routes.delete("k")
    expect(routeFor(routes, knowledge, "wrapup")).toBeUndefined()
  })
})

describe("checkModels", () => {
  test("no layer: no registry and no problem", async () => {
    expect(await checkModels(target, { env: { OPENCODE_AUTO_MODELS: operator }, home })).toEqual({
      problems: [],
      references: [],
    })
  })

  test("a strict load failure: the ModelRegistryError lines, no registry", async () => {
    await writeOperator({ models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2", aviod: [] } } })
    const check = await checkModels(target, { env: { OPENCODE_AUTO_MODELS: operator }, home })
    expect(check.registry).toBeUndefined()
    expect(check.problems).toEqual([
      `model registry, operator layer ${operator}: models.k2: unknown field "aviod" (known: agent, model, wider, variant, context, avoid, only, keys, retry)`,
    ])
  })

  test("broken references are problems with the registry loaded; lines name references, never values", async () => {
    await writeOperator(EXAMPLE)
    const check = await checkModels(target, { env: { OPENCODE_AUTO_MODELS: operator, MOONSHOT_KEY_A: "sk-x", MOONSHOT_KEY_B: "" }, home })
    expect(check.registry).toBeDefined()
    expect(check.references.map((problem) => problem.field)).toEqual([
      "agents.claude-b.env.HTTPS_PROXY",
      "models.k3.keys[1]",
      "models.glm.keys[0]",
      "models.glm.keys[1]",
      "models.glm.keys[2]",
    ])
    expect(check.problems).toEqual(check.references.map((problem) => problem.message))
    expect(check.problems[1]).toBe(`model registry, operator layer ${operator}: models.k3.keys[1]: env MOONSHOT_KEY_B is empty`)
    expect(check.problems.join("\n")).not.toContain("sk-x")
  })

  test("a project layer git would commit is refused first, and its content problems follow", async () => {
    expect(Bun.spawnSync(["git", "init", "-q", target]).exitCode).toBe(0)
    await writeProject({ models: { k2: { agent: "nobody" } } })
    const refusal = await projectLayerRefusal(target)
    expect(refusal).toBe(
      `model registry, project layer ${MODELS_FILE}: git does not ignore it, so the unified commit would commit it; run opencode-auto fix ${target} to add its .gitignore entry, then re-run`,
    )
    const check = await checkModels(target, { env: { OPENCODE_AUTO_MODELS: operator }, home })
    expect(check.problems[0]).toBe(refusal!)
    expect(check.problems[1]).toStartWith(`model registry, project layer ${MODELS_FILE}: models.k2.agent: names no agent profile`)
    await put(join(target, ".gitignore"), "/.opencode/auto/models.json\n")
    expect(await projectLayerRefusal(target)).toBeUndefined()
  })

  test("outside a git work tree the project layer is not refused", async () => {
    await writeProject({ models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2" } } })
    expect(await projectLayerRefusal(target)).toBeUndefined()
  })
})

describe("describeModels", () => {
  test("no layer in force: the table is the implicit registry, and the operator path it looked at", async () => {
    const description = await describeTarget()
    expect(description.operatorPath).toBe(operator)
    expect(description.problems).toEqual([])
    expect(description.notes).toEqual([])
    // The probe handle stays undefined (nothing to probe); the table names
    // the implicit registry the env switches synthesize (0061 F2).
    expect(description.registry).toBeUndefined()
    expect(description.table?.layers).toEqual([])
    expect(description.table!.agents).toEqual([{ name: "opencode", layer: "implied", adapter: "opencode", env: [] }])
    expect(description.table!.models).toEqual([
      { name: "default", layer: "implied", agent: "opencode", adapter: "opencode", steps: [], state: { usable: true, reasons: [], notes: [expect.stringContaining("context window is unknown")] } },
    ])
    expect(description.table!.tiers).toEqual([
      { tier: "deep", names: ["default"], layer: "implied" },
      { tier: "simple", names: ["default"], layer: "implied" },
    ])
  })

  test("tiers per phase type and role, with the project's custom types", async () => {
    await writeExample({ ...EXAMPLE, routes: {} })
    await typeFile("review", "simple")
    await typeFile("audit")
    const t = await table()
    expect(t.types.map((item) => [item.type, item.letter, item.origin, item.reasoning])).toEqual([
      ...BUILTIN_PHASE_TYPES.map((entry) => [entry.type, entry.letter, "builtin", entry.reasoning]),
      ["audit", undefined, "project", "deep"],
      ["review", undefined, "project", "simple"],
    ])
    for (const type of t.types) expect(type.rows.map((item) => item.role)).toEqual([...MODEL_ROLES])
    expect(row(t, "analysis", "whole").tier).toBe("deep")
    expect(row(t, "implement", "whole").tier).toBe("simple")
    expect(row(t, "implement", "decompose").tier).toBe("deep")
    expect(row(t, "review", "subtask").tier).toBe("simple")
    expect(row(t, "audit", "subtask").tier).toBe("deep")
    expect(row(t, "acceptance", "wrapup").tier).toBe("simple")
  })

  test("route precedence role > type > letter, and a custom type id is a route key", async () => {
    await typeFile("review", "simple")
    await writeExample({
      ...EXAMPLE,
      routes: { acceptance: "deep", "phase-handover": ["k2"], t: ["k3"], review: "deep", whole: ["glm"] },
    })
    const t = await table()
    expect(row(t, "acceptance", "wrapup")).toMatchObject({
      tier: "deep",
      route: { key: "acceptance", layer: "operator", kind: "tier" },
    })
    expect(names(row(t, "acceptance", "wrapup"))).toEqual(["opus", "opus-b", "k3"])
    expect(row(t, "acceptance", "phase-handover")).toMatchObject({ route: { key: "phase-handover", kind: "list" } })
    expect(names(row(t, "acceptance", "phase-handover"))).toEqual(["k2"])
    expect(names(row(t, "test", "decompose"))).toEqual(["k3"])
    expect(names(row(t, "test", "whole"))).toEqual(["glm"])
    expect(row(t, "review", "wrapup")).toMatchObject({ tier: "deep", route: { key: "review" } })
    expect(row(t, "analysis", "wrapup").route).toBeUndefined()
  })

  test("borrowing order: the simple list, then the deep list; deep lists never borrow", async () => {
    await writeExample()
    const t = await table()
    const simple = row(t, "implement", "subtask")
    expect(names(simple)).toEqual(["glm", "k2", "opus", "opus-b", "k3"])
    expect(simple.own).toBe(2)
    expect(names(row(t, "implement", "decompose"))).toEqual(["opus", "opus-b", "k3"])
    expect(row(t, "implement", "decompose").own).toBe(3)
  })

  test("window state at the fixed clock: inside an avoid window, outside only windows, open", async () => {
    await writeExample()
    const t = await table()
    expect(t.tz).toBe("Asia/Shanghai")
    expect(model(t, "opus").state).toEqual({
      usable: false,
      reasons: ["outside its windows (opens 18:00 Asia/Shanghai)"],
      notes: ["its context window is unknown until the agent reports it"],
    })
    expect(model(t, "opus").window).toBe("opens 18:00 Asia/Shanghai")
    expect(model(t, "glm").state.reasons).toEqual(["outside its windows (opens sat 00:00 Asia/Shanghai)"])
    expect(model(t, "k3").state).toEqual({
      usable: true,
      reasons: [],
      notes: ["the context window of its top step moonshotai/kimi-k3 is unknown until the server starts"],
    })
    expect(model(t, "k3").window).toBeUndefined()
    expect(row(t, "implement", "subtask").candidates).toEqual([
      { name: "glm", usable: false },
      { name: "k2", usable: true },
      { name: "opus", usable: false },
      { name: "opus-b", usable: false },
      { name: "k3", usable: true },
    ])
    // After 18:00 local the avoid window has closed until monday.
    const evening = await describeModels(target, Date.parse("2026-09-25T10:30:00Z"), { env: envWith(), home })
    expect(evening.table!.models.find((item) => item.name === "opus")!).toMatchObject({
      window: "open until mon 09:00 Asia/Shanghai",
      state: { usable: true },
    })
  })

  test("a window that never opens says so", async () => {
    await writeExample({
      models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2", avoid: ["00:00-24:00"] } },
      tiers: { simple: ["k2"] },
    })
    expect(model(await table(), "k2").state.reasons).toEqual(["outside its windows (it never opens)"])
  })

  test("the agent filter from OPENCODE_AUTO_AGENT matches profiles by adapter", async () => {
    await writeExample()
    const t = await table({ env: envWith({ OPENCODE_AUTO_AGENT: "claude" }) })
    expect(t.filter).toEqual({ agent: "claude", source: "OPENCODE_AUTO_AGENT" })
    expect(model(t, "k3").state).toMatchObject({
      usable: false,
      reasons: ["filtered out by the agent filter claude (OPENCODE_AUTO_AGENT)"],
    })
    // opus-b runs on the claude-b profile, whose adapter is claude.
    expect(model(t, "opus-b").state.reasons).toEqual(["outside its windows (opens 18:00 Asia/Shanghai)"])
  })

  test("the shell profile's agent is the filter ahead of OPENCODE_AUTO_AGENT", async () => {
    await writeExample()
    setShellProfile({ agent: { name: "opencode", host: async () => ({}) as never } })
    try {
      const t = await table({ env: envWith({ OPENCODE_AUTO_AGENT: "claude" }) })
      expect(t.filter).toEqual({ agent: "opencode", source: "shell profile" })
      expect(model(t, "k3").state.usable).toBe(true)
      expect(model(t, "opus").state.reasons).toContain("filtered out by the agent filter opencode (shell profile)")
    } finally {
      setShellProfile({ agent: undefined })
    }
  })

  test("a known context window below the project cap makes a model unusable; the cap comes from config", async () => {
    await writeExample({
      models: {
        small: { agent: "opencode", model: "zhipuai/glm-4.6", context: 32 },
        large: { agent: "opencode", model: "moonshotai/kimi-k2", context: 128 },
      },
      tiers: { simple: ["small", "large"] },
    })
    let t = await table()
    expect(t.cap).toBe(64_000)
    expect(model(t, "small").state.reasons).toEqual(["its context window 32k is below the project cap 64k"])
    expect(model(t, "large").state).toEqual({ usable: true, reasons: [], notes: [] })
    await put(join(target, ".opencode", "auto", "config.json"), { contextLimit: 200 })
    t = await table()
    expect(t.cap).toBe(200_000)
    expect(model(t, "large").state.reasons).toEqual(["its context window 128k is below the project cap 200k"])
  })

  test("an invalid project config is a note, and its defaults apply", async () => {
    await writeExample()
    await put(join(target, ".opencode", "auto", "config.json"), "{ not json")
    const description = await describeTarget()
    expect(description.problems).toEqual([])
    expect(description.notes).toHaveLength(1)
    expect(description.notes[0]).toStartWith(
      "project config (.opencode/auto/config.json) is invalid, so its defaults apply here (context limit 64k, agent opencode): ",
    )
    expect(description.table!.cap).toBe(64_000)
  })

  test("OPENCODE_AUTO_MODEL overrides the sessions it matches with a raw model on the default agent", async () => {
    await writeExample()
    await put(join(target, ".opencode", "auto", "config.json"), { agent: "claude" })
    const t = await table({ env: envWith({ OPENCODE_AUTO_MODEL: "whole=zhipuai/glm-4.6" }) })
    expect(t.override).toBe("whole=zhipuai/glm-4.6")
    expect(t.defaultAgent).toBe("claude")
    expect(row(t, "analysis", "whole").override).toEqual({
      value: "zhipuai/glm-4.6",
      state: {
        usable: true,
        reasons: [],
        notes: ["a raw provider/model on the default agent claude, without window, ring or steps"],
      },
    })
    expect(row(t, "analysis", "subtask").override).toBeUndefined()
    const filtered = await table({ env: envWith({ OPENCODE_AUTO_MODEL: "zhipuai/glm-4.6", OPENCODE_AUTO_AGENT: "opencode" }) })
    expect(row(filtered, "test", "bypass").override!.state.reasons).toEqual([
      "filtered out by the agent filter opencode (OPENCODE_AUTO_AGENT)",
    ])
  })

  // Under the loaded registry (plans/0055 §9 R7) an internal-name value parses
  // and overrides with the entry; OPENCODE_AUTO_MODEL_FALLBACK is a problem
  // naming the tier lists, as it fails a run start.
  test("OPENCODE_AUTO_MODEL under the loaded registry: internal names override with the entry; _FALLBACK is a problem", async () => {
    await writeExample()
    const t = await table({ env: envWith({ OPENCODE_AUTO_MODEL: "whole=glm" }) })
    expect(t.override).toBe("whole=glm")
    expect(row(t, "analysis", "whole").override).toMatchObject({ value: "glm", model: "glm" })
    const ring = await describeTarget({ env: envWith({ OPENCODE_AUTO_MODEL_FALLBACK: "zhipuai/glm-4.6" }) })
    expect(ring.problems).toEqual([
      "env OPENCODE_AUTO_MODEL_FALLBACK is not used under a model registry: the tier lists are the failover order (deep: opus, opus-b, k3; simple: glm, k2) (the table below ignores the OPENCODE_AUTO_* switches)",
    ])
  })

  test("a bad switch is a problem, and the table ignores the switches", async () => {
    await writeExample()
    const description = await describeTarget({ env: envWith({ OPENCODE_AUTO_AGENT: "kimi" }) })
    expect(description.problems).toHaveLength(1)
    expect(description.problems[0]).toContain("OPENCODE_AUTO_AGENT invalid value")
    expect(description.table!.filter).toBeUndefined()
  })

  test("layers: each entry is marked with the layer it came from", async () => {
    await writeExample()
    await writeProject({
      tz: "Europe/Berlin",
      agents: { "claude-b": null },
      models: { "opus-b": null, k2: { agent: "opencode", model: "moonshotai/kimi-k2", context: 128 } },
      tiers: { deep: ["opus", "k3"] },
      routes: { wrapup: ["k2"] },
    })
    const t = await table()
    expect(t.layers.map((layer) => layer.name)).toEqual(["operator", "project"])
    expect(t.tz).toBe("Europe/Berlin")
    expect(t.tzLayer).toBe("project")
    expect(t.agents.map((agent) => [agent.name, agent.layer])).toEqual([
      ["opencode", "operator"],
      ["claude", "operator"],
    ])
    expect(t.models.map((item) => [item.name, item.layer])).toEqual([
      ["opus", "operator"],
      ["k3", "operator"],
      ["glm", "operator"],
      ["k2", "project"],
      ["free", "operator"],
    ])
    expect(t.tiers).toEqual([
      { tier: "deep", names: ["opus", "k3"], layer: "project" },
      { tier: "simple", names: ["glm", "k2"], layer: "operator" },
    ])
    expect(t.routes).toEqual([
      { key: "acceptance", layer: "operator", tier: "deep" },
      { key: "phase-handover", layer: "operator", names: ["k2"] },
      { key: "wrapup", layer: "project", names: ["k2"] },
    ])
    expect(t.classifier).toEqual({ names: ["free"], layer: "operator" })
    expect(row(t, "analysis", "wrapup").route).toEqual({ key: "wrapup", layer: "project", kind: "list" })
  })

  test("the implied profile is marked implied", async () => {
    await writeExample({ models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2" } }, tiers: { simple: ["k2"] } })
    const t = await table()
    expect(t.agents).toEqual([{ name: "opencode", layer: "implied", adapter: "opencode", env: [] }])
    expect(t.tz).toBe("UTC")
    expect(t.tzLayer).toBeUndefined()
  })

  test("steps, rings as reference names with their size, env names without values", async () => {
    await writeExample({
      ...EXAMPLE,
      agents: {
        ...EXAMPLE.agents,
        remote: { adapter: "opencode", server: "http://admin:server-secret@127.0.0.1:4096", bin: "~/bin/opencode" },
      },
    })
    const t = await table()
    expect(model(t, "k3")).toMatchObject({ steps: ["moonshotai/kimi-k3-256k", "moonshotai/kimi-k3"], ring: { provider: "moonshotai", size: 2 } })
    expect(model(t, "opus")).toMatchObject({ steps: ["opus"], windows: { kind: "avoid", texts: ["mon-fri 09:00-18:00"] } })
    expect(model(t, "opus").ring).toBeUndefined()
    expect(t.rings).toEqual([
      { provider: "moonshotai", keys: ["MOONSHOT_KEY_A", "MOONSHOT_KEY_B"], models: ["k3", "k2"] },
      { provider: "zhipuai", keys: ["ZHIPU_KEY_A", "ZHIPU_KEY_B", "~/.secrets/zhipu-c"], models: ["glm"] },
    ])
    expect(t.agents.find((agent) => agent.name === "claude-b")!.env).toEqual([
      { name: "CLAUDE_CONFIG_DIR", kind: "literal" },
      { name: "HTTPS_PROXY", kind: "env", reference: "CLAUDE_B_PROXY" },
    ])
    expect(t.agents.find((agent) => agent.name === "opencode")!.env).toEqual([{ name: "HTTPS_PROXY", kind: "removed" }])
    expect(t.agents.find((agent) => agent.name === "remote")).toEqual({
      name: "remote",
      layer: "operator",
      adapter: "opencode",
      bin: join(home, "bin", "opencode"),
      server: "http://127.0.0.1:4096/",
      env: [],
    })
    const text = formatModels(await describeTarget()).join("\n")
    for (const value of [...Object.values(SECRETS), "127.0.0.1:7890", join(home, ".claude-b"), "server-secret", "admin"])
      expect(text).not.toContain(value)
    expect(text).toContain("env CLAUDE_CONFIG_DIR (literal), HTTPS_PROXY (env CLAUDE_B_PROXY)")
    expect(text).toContain("env HTTPS_PROXY (removed)")
    expect(text).toContain("  moonshotai  2 keys: MOONSHOT_KEY_A, MOONSHOT_KEY_B · models k3, k2")
    expect(text).toContain("  zhipuai     3 keys: ZHIPU_KEY_A, ZHIPU_KEY_B, ~/.secrets/zhipu-c · models glm")
  })

  test("a retry override is shown as written (plans/0057 §11 item 3)", async () => {
    await writeExample({ ...EXAMPLE, models: { ...EXAMPLE.models, opus: { ...EXAMPLE.models.opus, retry: { maxAttempts: 300, waitsOutLimit: true } } } })
    const t = await table()
    expect(model(t, "opus").retry).toEqual({ maxAttempts: 300, waitsOutLimit: true })
    expect(model(t, "k3").retry).toBeUndefined()
    const text = formatModels(await describeTarget()).join("\n")
    expect(text).toContain("avoid mon-fri 09:00-18:00 · retry maxAttempts 300, waitsOutLimit true")
  })

  test("unused models and reference problems come with the table", async () => {
    await writeOperator({ ...EXAMPLE, models: { ...EXAMPLE.models, spare: { agent: "opencode", model: "zhipuai/glm-4.5" } } })
    const description = await describeModels(target, NOW, { env: { OPENCODE_AUTO_MODELS: operator }, home })
    expect(description.table!.unused).toEqual(["spare"])
    expect(description.problems.map((line) => line.split(": ")[1])).toEqual([
      "agents.claude-b.env.HTTPS_PROXY",
      "models.k3.keys[0]",
      "models.k3.keys[1]",
      "models.glm.keys[0]",
      "models.glm.keys[1]",
      "models.glm.keys[2]",
    ])
  })
})

describe("formatModels", () => {
  test("no layer in force: the head line names the implicit registry and its source", async () => {
    const lines = formatModels(await describeTarget())
    expect(lines[0]).toBe(
      `model registry: implicit — no layer file (${operator} nor ${MODELS_FILE}); a run synthesizes it from OPENCODE_AUTO_MODEL / OPENCODE_AUTO_MODEL_FALLBACK`,
    )
    // One profile, one entry without a model, both tiers the same list.
    expect(lines).toContain("  opencode  [implied]  adapter opencode")
    expect(lines).toContain("  default  [implied]  agent opencode (opencode) · the agent's default model")
    expect(lines).toContain("  deep    [implied]  default")
    expect(lines).toContain("  simple  [implied]  default")
  })

  test("a registry that does not load: the problems and the refusal line", async () => {
    await writeOperator({ tierz: {} })
    expect(formatModels(await describeTarget())).toEqual([
      `⚠ model registry, operator layer ${operator}: unknown field "tierz" (known: tz, agents, models, tiers, routes, classifier)`,
      "1 problem(s): run and plan refuse to start until they are fixed (exit 1)",
    ])
  })

  test("the table of the design's example", async () => {
    await writeExample()
    const lines = formatModels(await describeTarget())
    expect(lines.slice(0, 5)).toEqual([
      `model registry: operator layer ${operator}`,
      "now: 2026-09-25 fri 14:00 Asia/Shanghai (tz from the operator layer)",
      "agent filter: none: models on every agent profile are candidates",
      "project cap: 64k context · default agent: opencode",
      "agent profiles:",
    ])
    const text = lines.join("\n")
    expect(text).toContain(
      [
        "models:",
        "  opus    [operator]  agent claude (claude) · model opus · avoid mon-fri 09:00-18:00",
        "          ✗ not usable now: outside its windows (opens 18:00 Asia/Shanghai) · its context window is unknown until the agent reports it",
      ].join("\n"),
    )
    expect(text).toContain(
      [
        "  k3      [operator]  agent opencode (opencode) · steps moonshotai/kimi-k3-256k → moonshotai/kimi-k3 · ring moonshotai (2 keys)",
        "          ✓ usable now · the context window of its top step moonshotai/kimi-k3 is unknown until the server starts",
      ].join("\n"),
    )
    expect(text).toContain(
      ["tiers:", "  deep    [operator]  opus, opus-b, k3", "  simple  [operator]  glm, k2"].join("\n"),
    )
    expect(text).toContain(
      ["routes:", "  acceptance      [operator]  tier deep", "  phase-handover  [operator]  models k2"].join("\n"),
    )
    expect(text).toContain("classifier: [operator]  free")
    expect(text).toContain(
      [
        "  analysis (a) · builtin · execute tier deep",
        "    decompose, whole, subtask, phase-plan, implement-scan: deep → opus ✗ · opus-b ✗ · k3 ✓",
        "    wrapup, knowledge, prior-knowledge, number-recovery, diagnose, bypass: simple → glm ✗ · k2 ✓ | opus ✗ · opus-b ✗ · k3 ✓",
        "    phase-handover: route phase-handover [operator] → k2 ✓",
      ].join("\n"),
    )
    expect(text).toContain(
      [
        "  acceptance (v) · builtin · execute tier deep",
        "    decompose, whole, subtask, wrapup, phase-plan, knowledge, prior-knowledge, implement-scan, number-recovery, diagnose, bypass: deep · route acceptance [operator] → opus ✗ · opus-b ✗ · k3 ✓",
        "    phase-handover: route phase-handover [operator] → k2 ✓",
      ].join("\n"),
    )
    expect(text).not.toContain("⚠")
  })

  test("filter, override, notes and problems are printed", async () => {
    await writeExample({ ...EXAMPLE, tiers: { deep: ["opus"] } })
    const lines = formatModels(
      await describeModels(target, NOW, {
        env: { OPENCODE_AUTO_MODELS: operator, OPENCODE_AUTO_AGENT: "claude", OPENCODE_AUTO_MODEL: "wrapup=zhipuai/glm-4.6" },
        home,
      }),
    )
    const text = lines.join("\n")
    expect(text).toContain("agent filter: claude (OPENCODE_AUTO_AGENT): only models on claude profiles are candidates")
    expect(text).toContain(
      "override: OPENCODE_AUTO_MODEL=wrapup=zhipuai/glm-4.6 replaces the candidate list of the sessions it matches",
    )
    expect(text).toContain("  simple  (not declared)")
    expect(text).toContain(
      "    wrapup: override OPENCODE_AUTO_MODEL → zhipuai/glm-4.6 ✗ (filtered out by the agent filter claude (OPENCODE_AUTO_AGENT); a raw provider/model on the default agent opencode, without window, ring or steps)",
    )
    expect(text).toContain("    knowledge, prior-knowledge, number-recovery, diagnose, bypass: simple → (none) | opus ✗")
    expect(text).toContain("ℹ unused models (no tier, route list or classifier names them): opus-b, k3, glm")
    expect(lines.at(-1)).toBe("5 problem(s): run and plan refuse to start until they are fixed (exit 1)")
    expect(lines.at(-2)).toStartWith("⚠ model registry, operator layer")
  })
})
