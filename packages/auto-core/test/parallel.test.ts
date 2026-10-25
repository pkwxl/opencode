// MP.1 parallel declaration surface (plans/0046 D8–D12): the planning
// guidance block follows the config level (its width-side reservation
// lifted by plans/0068 S3 and the activation decoupled by plans/0125 —
// width alone runs the scheduler; the preflight note and the truth tables
// carry that behavior in their own homes).
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { phaseTypeOfLetter } from "../src/phases/registry"
import { promptFacts } from "../src/prompt-facts"
import { renderFormulationTodo } from "../src/prompt-plan"

const dirs: string[] = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "auto-parallel-"))
  dirs.push(dir)
  return dir
}

// The render facts build per render call (E2), so the overlay a test plants
// is read through the facts' dir at the next render — no global to reset.
let factsDir: string | undefined
afterEach(() => {
  factsDir = undefined
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const phasePlan = (parallel?: "low" | "medium" | "high") =>
  renderFormulationTodo(promptFacts({ dir: factsDir }), { phase: phaseTypeOfLetter("m"), phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", parallel, numberStart: 2, charter: "" }).scope
const implementPlan = (parallel?: "low" | "medium" | "high") =>
  renderFormulationTodo(promptFacts({ dir: factsDir }), { phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", parallel, numberStart: 2, input: "prompt.", charter: "" }).scope

describe("planning guidance block (D10/D11)", () => {
  test("each level injects its own subsection into both formulation variants; none injects nothing", () => {
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
    factsDir = dir
    expect(phasePlan("low")).toContain("Project low guidance.")
    expect(phasePlan("high")).toBe(phasePlan())
  })
})
