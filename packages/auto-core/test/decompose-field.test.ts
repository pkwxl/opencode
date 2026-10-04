// The plan-recorded execution mode (plans/0075, ruled 2026-10-04): the
// planning session records its per-task execution-mode decision as the
// `Decompose:` field of docs/T-NNN/todo.md and --subtask auto executes it
// mechanically. This file covers the consumer and observability halves the
// grammar tests of document-unit/tasks stay out of: the resolution matrix
// (resolveDecompose), the end-to-end runTask behavior per field value (the
// prompt the task's sessions actually receive), the hard overrides ignoring
// the field, the leadSplit downgrade, and the stats record both the booking
// (statsDecomposeRun) and the conclusion line read (taskEndLines' decompose
// line). The producer half is the golden-locked prompt copy (the
// task-decompose partial in the planning templates).

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FakeAgentOptions } from "./fixtures/agent"
import { fakeAgent } from "./fixtures/agent"
import { freshRepo, git } from "./fixtures/runner"
import { reloadUnits, seedUnits } from "./fixtures/units"
import { taskEndLines } from "../src/conclusion"
import { flushStats, loadStats, statsDecomposeOf, statsDecomposeRun, statsTask } from "../src/stats"
import { resolveDecompose, runTask } from "../src/runner"
import { services } from "../src/services"
import type { Opts } from "../src/opts"

describe("resolveDecompose (the plan-recorded mode, plans/0075)", () => {
  test("auto obeys a present field: split stays auto, whole maps to ondemand, pipeline to true", () => {
    expect(resolveDecompose(undefined, "split", undefined)).toEqual({ mode: "auto", from: "field", field: "split" })
    expect(resolveDecompose("auto", "whole", undefined)).toEqual({ mode: "ondemand", from: "field", field: "whole" })
    expect(resolveDecompose("auto", "pipeline", undefined)).toEqual({ mode: "true", from: "field", field: "pipeline" })
  })

  test("auto without a field falls back to the adaptive logic, provenance fallback", () => {
    expect(resolveDecompose(undefined, undefined, undefined)).toEqual({ mode: "auto", from: "fallback" })
    expect(resolveDecompose("auto", undefined, false)).toEqual({ mode: "auto", from: "fallback" })
  })

  test("the hard overrides off/true/ondemand ignore the field outright", () => {
    for (const mode of ["off", "true", "ondemand"] as const) {
      expect(resolveDecompose(mode, "pipeline", undefined)).toEqual({ mode, from: "override" })
      expect(resolveDecompose(mode, "whole", undefined)).toEqual({ mode, from: "override" })
      expect(resolveDecompose(mode, "split", undefined)).toEqual({ mode, from: "override" })
    }
  })

  test("leadSplit: false downgrades split to whole — logged at the call site, never blocking; other values unaffected", () => {
    expect(resolveDecompose("auto", "split", false)).toEqual({ mode: "ondemand", from: "field", field: "split", downgraded: true })
    expect(resolveDecompose("auto", "split", true)).toEqual({ mode: "auto", from: "field", field: "split" })
    expect(resolveDecompose("auto", "pipeline", false)).toEqual({ mode: "true", from: "field", field: "pipeline" })
    expect(resolveDecompose("auto", "whole", false)).toEqual({ mode: "ondemand", from: "field", field: "whole" })
  })
})

// —— End-to-end: the field drives the pipeline runTask builds ——

describe("runTask consults the Decompose field under --subtask auto", () => {
  let lines: string[]
  let printed: ReturnType<typeof spyOn>

  beforeEach(() => {
    lines = []
    printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
  })
  afterEach(() => {
    printed.mockRestore()
  })

  // A committed repository with one pending task (wrap-up off: the prompts
  // are the execution stage's alone); `field` writes the task's Decompose
  // field line beside Phase, and the plan is reloaded after the write — the
  // production shape, where the loop loads the plan after the documents
  // exist and hands runTask a current task.
  const run = async (field: string | undefined, opts: Partial<Opts> = {}, turn?: FakeAgentOptions["turn"]) => {
    const dir = await freshRepo()
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    await seedUnits(dir, "## T-001: sample task [pending]\nBody.\n")
    const doc = (await Bun.file(join(dir, "docs/T-001/todo.md")).text())
      .replace("Phase: R-01.P01\n", `Phase: R-01.P01\n${field === undefined ? "" : `Decompose: ${field}\n`}`)
    await Bun.write(join(dir, "docs/T-001/todo.md"), doc)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-q", "-m", "init")
    const plan = await reloadUnits(dir)
    const agent = fakeAgent(turn ? { turn } : {})
    const outcome = await runTask(agent.client, plan, plan.tasks[0]!, { dir, wrapup: false, subtask: "auto", router: services().router, ...opts })
    return { dir, agent, outcome, prompts: agent.prompts.map((prompt) => prompt.text) }
  }

  test("absent field: the adaptive fallback is unchanged — the lead session with its split clause", async () => {
    const { dir, outcome, prompts } = await run(undefined)
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain("You are the lead session of this task")
      expect(prompts[0]).toContain("Split rule (adaptive decomposition)")
      // No field-driven log line, and the fallback provenance is booked.
      expect(await statsDecomposeOf(dir, "T-001")).toEqual({ task: "T-001", mode: "auto", from: "fallback" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("Decompose: whole — one whole-task session to completion, the field obeyed and logged", async () => {
    const { dir, outcome, prompts } = await run("whole")
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain("You are responsible for the whole task this time, completed within a single session, without decomposing it into subtasks")
      expect(prompts[0]).not.toContain("Split rule (adaptive decomposition)")
      expect(lines.some((line) => line.includes("T-001 Decompose: whole (the task document's recorded mode; --subtask auto obeys it)"))).toBe(true)
      expect(await statsDecomposeOf(dir, "T-001")).toEqual({ task: "T-001", mode: "ondemand", from: "field", field: "whole" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("Decompose: pipeline — the planned decompose pipeline runs under the default auto mode", async () => {
    // The fake's default turn writes none of the decompose artifacts, so the
    // pipeline blocks at its own gate — the proof is which session ran first.
    const { dir, outcome, prompts } = await run("pipeline")
    try {
      expect(outcome).toMatchObject({ type: "blocked" })
      expect((outcome as { question: string }).question).toContain("decompose session ended twice")
      expect(prompts[0]).toContain("This session completes the task-background understanding and the subtask decomposition")
      expect(lines.some((line) => line.includes("T-001 Decompose: pipeline (the task document's recorded mode; --subtask auto obeys it)"))).toBe(true)
      expect(await statsDecomposeOf(dir, "T-001")).toEqual({ task: "T-001", mode: "true", from: "field", field: "pipeline" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("Decompose: split with leadSplit false — downgraded to whole, logged, never blocking", async () => {
    const { dir, outcome, prompts } = await run("split", { leadSplit: false })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain("completed within a single session, without decomposing it into subtasks")
      expect(prompts[0]).not.toContain("Split rule (adaptive decomposition)")
      expect(lines.some((line) => line.includes("its Decompose: split field cannot run — the fleet cannot fork sessions (capability degradation); downgraded to whole"))).toBe(true)
      expect(await statsDecomposeOf(dir, "T-001")).toEqual({ task: "T-001", mode: "ondemand", from: "field", field: "split", downgraded: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a hard --subtask override ignores the field: off runs one plain whole session over Decompose: pipeline", async () => {
    const { dir, outcome, prompts } = await run("pipeline", { subtask: "off" })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).not.toContain("subtask decomposition")
      expect(prompts[0]).not.toContain("Context-budget protocol")
      // No field log line under an override; the provenance says override.
      expect(lines.some((line) => line.includes("--subtask auto obeys it"))).toBe(false)
      expect(await statsDecomposeOf(dir, "T-001")).toEqual({ task: "T-001", mode: "off", from: "override" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("Decompose: split obeys today's auto behavior byte for byte — the lead prompt is the fallback's", async () => {
    const obeyed = await run("split")
    const fallback = await run(undefined)
    try {
      expect(obeyed.outcome).toEqual({ type: "completed" })
      expect(obeyed.prompts).toHaveLength(1)
      // The one prompt matches the no-field run's (the same adaptive lead).
      expect(obeyed.prompts[0]).toBe(fallback.prompts[0])
      expect(await statsDecomposeOf(obeyed.dir, "T-001")).toEqual({ task: "T-001", mode: "auto", from: "field", field: "split" })
    } finally {
      await rm(obeyed.dir, { recursive: true, force: true })
      await rm(fallback.dir, { recursive: true, force: true })
    }
  })

  // The end-to-end pipeline under a field: the artifacts a decompose session
  // writes let the pipeline complete (the same fixture shape agent-fake's
  // true-mode tests use), proving the field's pipeline runs the whole path.
  test("Decompose: pipeline completes the planned pipeline under auto (decompose, then the subtask)", async () => {
    const dir = await freshRepo()
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    await seedUnits(dir, "## T-001: sample task [pending]\nBody.\n")
    await Bun.write(
      join(dir, "docs/T-001/todo.md"),
      (await Bun.file(join(dir, "docs/T-001/todo.md")).text()).replace("Phase: R-01.P01\n", "Phase: R-01.P01\nDecompose: pipeline\n"),
    )
    await git(dir, "add", "-A")
    await git(dir, "commit", "-q", "-m", "init")
    const plan = await reloadUnits(dir)
    const doc = (head: string) => `${head}\n\n${"Background the subtasks rely on. ".repeat(6)}\n\n<!-- auto: eof -->\n`
    const checklist = "- [ ] alpha: the alpha module in src/alpha.ts, with its constant and a check that reads it back Artifacts: src/alpha.ts\n\n<!-- auto: eof -->\n"
    const agent = fakeAgent({
      turn: (ctx) => {
        if (ctx.n === 1) {
          mkdirSync(join(dir, "docs/T-001/S01"), { recursive: true })
          writeFileSync(join(dir, "docs/T-001/context.md"), doc("## Relevant files and key symbols\n- src/alpha.ts"))
          writeFileSync(join(dir, "docs/T-001/shared.md"), doc("- src/index.ts: the module index the item extends"))
          writeFileSync(join(dir, "docs/T-001/subtasks.md"), checklist)
          writeFileSync(join(dir, "docs/T-001/S01/todo.md"), doc("## Scope\n\nThe alpha module.\n\n## Artifacts\n\n- src/alpha.ts"))
        }
        if (ctx.text.includes("item 1 of that list only")) writeFileSync(join(dir, "src/alpha.ts"), "export const alpha = 1\n")
        return undefined
      },
    })
    try {
      mkdirSync(join(dir, "src"), { recursive: true })
      const outcome = await runTask(agent.client, plan, plan.tasks[0]!, { dir, wrapup: false, subtask: "auto", router: services().router })
      expect(outcome).toEqual({ type: "completed" })
      // decompose, the digest base, then the subtask.
      expect(agent.prompts.map((prompt) => prompt.text)).toHaveLength(3)
      expect(agent.prompts[0]!.text).toContain("This session completes the task-background understanding and the subtask decomposition")
      expect(agent.prompts[2]!.text).toContain("You are responsible for item 1 of that list only")
      expect(await statsDecomposeOf(dir, "T-001")).toEqual({ task: "T-001", mode: "true", from: "field", field: "pipeline" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// —— The conclusion line (plans/0075 §2.4): mode + provenance per task ——

describe("taskEndLines decompose line (the round's per-task observability)", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-decompose-line-"))
    await loadStats(dir)
  })
  afterEach(async () => {
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  const lines = async () => (await taskEndLines(dir, "T-001"))!

  test("the field provenance names the recorded mode; the downgrade is spelled out", async () => {
    await statsTask(dir, "T-001")
    await statsDecomposeRun(dir, { task: "T-001", mode: "auto", from: "field", field: "split" })
    expect((await lines()).at(-1)).toBe("  decompose: split (the task document's Decompose field)")
    await statsDecomposeRun(dir, { task: "T-001", mode: "ondemand", from: "field", field: "whole" })
    expect((await lines()).at(-1)).toBe("  decompose: whole (the task document's Decompose field)")
    await statsDecomposeRun(dir, { task: "T-001", mode: "ondemand", from: "field", field: "split", downgraded: true })
    expect((await lines()).at(-1)).toBe("  decompose: split (the task document's Decompose field; downgraded to whole — the fleet cannot fork sessions)")
  })

  test("the fallback and override provenances; no record keeps the two-line shape", async () => {
    await statsTask(dir, "T-001")
    await statsDecomposeRun(dir, { task: "T-001", mode: "auto", from: "fallback" })
    expect((await lines()).at(-1)).toBe("  decompose: auto (no Decompose field — the adaptive fallback)")
    await statsDecomposeRun(dir, { task: "T-001", mode: "true", from: "override" })
    expect((await lines()).at(-1)).toBe("  decompose: true (--subtask override)")
    await statsDecomposeRun(dir, { task: "T-001", mode: "off", from: "override" })
    expect((await lines()).at(-1)).toBe("  decompose: off (--subtask override)")
    // The record is one per current task: the next task's booking retires the
    // previous one, and the reader's own task guard drops the line (in the
    // loop the previous task's conclusion has already printed by then).
    await statsDecomposeRun(dir, { task: "T-002", mode: "off", from: "override" })
    expect(await lines()).toHaveLength(2)
    // The guard: past this task's bucket the whole block is untrustworthy.
    await statsTask(dir, "T-002")
    expect(await taskEndLines(dir, "T-001")).toBeUndefined()
    // No record at all → the tri-state block keeps its exact prior shape.
    await statsTask(dir, "T-003")
    expect((await taskEndLines(dir, "T-003"))!).toHaveLength(2)
  })

  test("a leniently dropped bad record reads as no record", async () => {
    await statsTask(dir, "T-001")
    await Bun.write(join(dir, ".auto", "stats.json"), JSON.stringify({ v: 1, decompose: { task: "T-001", mode: "sideways", from: "field" } }))
    await flushStats(dir)
    await loadStats(dir)
    await statsTask(dir, "T-001")
    expect((await taskEndLines(dir, "T-001"))!).toHaveLength(2)
  })
})
