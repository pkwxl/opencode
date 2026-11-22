// The registry read-side helpers the run start keeps, plus the candidate
// list helper of src/model-route.ts (its test home since plans/0055 §9).
// The models command's own surface — checkModels (the run start's registry
// checks as data), describeModels (the effective table) and formatModels —
// is retired with the command (plans/0296, the opencode severance: the tool
// spawns no agent session, ever); these tests hold what stays:
// candidateList/routeFor and the shared projectLayerRefusal (the run
// start's refusal of a project layer the unified commit would commit).
// Every test builds its own home, operator file and target directory and
// passes the environment explicitly.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { candidateList, routeFor } from "../src/model-route"
import { MODELS_FILE, projectLayerPath } from "../src/models"
import { projectLayerRefusal } from "../src/models-describe"
import { phaseType } from "../src/phases/registry"

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

  test("a key that is a role word routes the role only: the diagnose side channel goes by its letter", () => {
    // plans/0283: the knowledge routing word retired with the extraction —
    // the diagnose side channel (the read-only one-artifact session) is the
    // shape's remaining role.
    const analysisPhase = phaseType("analysis")!
    const routes = new Map([
      ["diagnose", { key: "diagnose", layer: "operator" as const, tier: "deep" as const }],
      ["a", { key: "a", layer: "operator" as const, names: ["glm"] }],
    ])
    expect(routeFor(routes, analysisPhase, "diagnose")?.key).toBe("diagnose")
    expect(routeFor(routes, analysisPhase, "wrapup")?.key).toBe("a")
    routes.delete("a")
    expect(routeFor(routes, analysisPhase, "wrapup")).toBeUndefined()
  })
})

describe("projectLayerRefusal (the run start's shared check)", () => {
  test("a project layer git would commit is refused, naming the operator's own ignore line", async () => {
    expect(Bun.spawnSync(["git", "init", "-q", target]).exitCode).toBe(0)
    await writeProject({ models: { k2: { agent: "nobody" } } })
    const refusal = await projectLayerRefusal(target)
    expect(refusal).toBe(
      `model registry, project layer ${MODELS_FILE}: git does not ignore it, so the unified commit would commit it; add its line to .gitignore yourself (/${MODELS_FILE} — the entry is the operator's own, plans/0296), then re-run`,
    )
    await put(join(target, ".gitignore"), "/.opencode/auto/models.json\n")
    expect(await projectLayerRefusal(target)).toBeUndefined()
  })

  test("outside a git work tree the project layer is not refused", async () => {
    await writeProject({ models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2" } } })
    expect(await projectLayerRefusal(target)).toBeUndefined()
  })

  test("no project layer: no refusal even beside an operator layer", async () => {
    await writeOperator({ models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2" } } })
    expect(await Bun.file(operator).exists()).toBe(true)
    expect(await projectLayerRefusal(target)).toBeUndefined()
  })
})
