// MP.1 parallel declaration surface (plans/0046 D8–D12): the planning
// guidance block follows the config level, and --max-sessions is reserved.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { phaseTypeOfLetter } from "../src/phases/registry"
import { useIntentPacks } from "../src/prompt"
import { renderImplementPlan, renderPhasePlan } from "../src/prompt-plan"

const dirs: string[] = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "auto-parallel-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  useIntentPacks(undefined)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const phasePlan = (parallel?: "low" | "medium" | "high") =>
  renderPhasePlan({ phase: phaseTypeOfLetter("m"), phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", parallel })
const implementPlan = (parallel?: "low" | "medium" | "high") =>
  renderImplementPlan({ content: "prompt.", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", parallel })

describe("planning guidance block (D10/D11)", () => {
  test("each level injects its own subsection into both planning templates; none injects nothing", () => {
    expect(phasePlan()).not.toContain("## Parallelism")
    expect(implementPlan()).not.toContain("## Parallelism")
    expect(phasePlan("low")).toContain("## Parallelism (low)")
    expect(phasePlan("low")).toContain("do not restructure the plan")
    expect(phasePlan("medium")).toContain("split work along file and module boundaries")
    expect(implementPlan("high")).toContain("## Parallelism (high)")
    expect(implementPlan("high")).toContain("split aggressively")
  })

  test("a project pack without the level's subsection renders the plain prompt", () => {
    const dir = tempDir()
    const overlay = join(dir, ".opencode", "auto", "intents")
    mkdirSync(overlay, { recursive: true })
    writeFileSync(join(overlay, "default.md"), "# default\n\n## parallelism\n\n### low\n\nProject low guidance.\n")
    useIntentPacks(dir)
    expect(phasePlan("low")).toContain("Project low guidance.")
    expect(phasePlan("high")).toBe(phasePlan())
  })
})

describe("--max-sessions is reserved (D9)", () => {
  test("runAll refuses more than one session before reading or writing the project", async () => {
    const { runAll } = await import("../src/loop")
    const dir = tempDir()
    expect(await runAll(dir, { maxSessions: 2 })).toBe(1)
    expect(readdirSync(dir)).toEqual([])
  })
})
