// plan's prelude (plans/0053 D4–D5, D7, D15, D23, D26, D34): every route that
// needs no AI, decided over docs-tree fixtures before any agent starts; git
// fixtures where the round-close check (G8) or the row-3 re-sync's
// uncommitted change is asserted. The loop side of the stop condition (D6,
// D8) needs the loop harness (plans/0053 A7, B6); run's drift stop (D34)
// lands here too — it precedes startAgent, so runAll drives it without an
// agent over the same fixtures.
import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { completePhase, currentRound, establishRound, phaseLabel, phaseTailDrift, readPhases, type PhaseUnit } from "../src/phases"
import { planPrelude, plannedLines, roundCompleteNext } from "../src/plan"
import { saveProgress } from "../src/resume"
import { qualifiedPhase, renderTaskIndex } from "../src/tasks"

const INPUT = { text: "Port the retry policy." }

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-plan-"))
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`)
  return out
}

async function commitAll(dir: string) {
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
  writeFileSync(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "setup")
}

const exists = (dir: string, path: string) => Bun.file(join(dir, path)).exists()

const read = async (dir: string, path: string) => Bun.file(join(dir, path)).text()

const phasesOf = async (dir: string) => (await readPhases(dir))!.phases

// List tasks in a phase's index, each with its unit file; done ones as done.md.
async function listTasks(dir: string, phase: PhaseUnit, tasks: Array<[string, boolean]>) {
  const q = qualifiedPhase(phase)
  await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex(q, tasks.map(([id, done]) => ({ id, title: `task ${id}`, done }))))
  for (const [id, done] of tasks) {
    rmSync(join(dir, "docs", id, done ? "todo.md" : "done.md"), { force: true })
    await Bun.write(join(dir, "docs", id, done ? "done.md" : "todo.md"), `# ${id}: task ${id}\nPhase: ${q}\n\nbody\n\n<!-- auto: eof -->\n`)
  }
}

// A round whose phases are all done, each with one done task.
async function completeRound(dir: string, phases: string) {
  await establishRound(dir, { phases })
  let n = 1
  for (const phase of await phasesOf(dir)) {
    if (phase.entry.hasTasks) await listTasks(dir, phase, [[`T-00${n++}`, true]])
    await completePhase(dir, phase)
  }
}

const FILLED_CLOSE = "# Round R-01\n\n## Close\n\n- Restated: the retry policy, in src/net/README.md.\n- Accepted as lost: none.\n"

describe("planPrelude: round setup (rows 1–2, D5)", () => {
  test(
    "row 1, phased: establishes R-01 uncommitted and prints the round-start gate",
    withDir(async (dir) => {
      const result = await planPrelude(dir, { phases: "am" })
      expect(result).toEqual({
        type: "stop",
        code: 0,
        lines: [
          "✓ round R-01 established: P01-analysis, P02-implement",
          "next (round-start gate): review the round setup, fill in docs/R-01/round.md (goal, acceptance and release criteria), and commit it; " +
            `then run: opencode-auto plan ${dir} to plan R-01.P01 analysis (or run to plan and execute)`,
        ],
      })
      expect(await exists(dir, "docs/R-01/phases.md")).toBe(true)
      expect(await exists(dir, "docs/R-01/round.md")).toBe(true)
    }),
  )

  test(
    "row 1, m mode: the single phase, and no round.md to fill in",
    withDir(async (dir) => {
      const result = await planPrelude(dir, { phases: "m" })
      expect(result).toEqual({
        type: "stop",
        code: 0,
        lines: [
          "✓ round R-01 established: single phase P01-implement",
          "next (round-start gate): review the setup and commit it; then list tasks in docs/R-01/P01-implement/tasks.md by hand, " +
            `or run: opencode-auto plan ${dir} -p <text> | --file <path>`,
        ],
      })
      expect(await exists(dir, "docs/R-01/round.md")).toBe(false)
    }),
  )

  test(
    "row 1 with input: refused before any write (D5)",
    withDir(async (dir) => {
      const result = await planPrelude(dir, { phases: "am", input: INPUT })
      expect(result).toEqual({
        type: "stop",
        code: 1,
        lines: [`round R-01 is not established yet: run opencode-auto plan ${dir} without input to establish it, commit the setup, then pass the input.`],
      })
      expect(await exists(dir, "docs/R-01")).toBe(false)
    }),
  )

  test(
    "row 1 for R-02 (an interrupted round start): the previous round's G8 re-runs first",
    withDir(async (dir) => {
      await completeRound(dir, "am")
      mkdirSync(join(dir, "docs/R-02"))
      await commitAll(dir)
      // The stub's ## Close is empty: G8 fails, exit 2, R-02 stays unestablished.
      const refused = await planPrelude(dir, { phases: "am" })
      expect(refused.type === "stop" && refused.code).toBe(2)
      expect(refused.type === "stop" && refused.lines[0]).toBe("⏸ round R-01 does not pass its round-close checks, so round R-02 cannot open yet")
      expect(await exists(dir, "docs/R-02/phases.md")).toBe(false)
      writeFileSync(join(dir, "docs/R-01/round.md"), FILLED_CLOSE)
      const result = await planPrelude(dir, { phases: "am", build: "true" })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(result.type === "stop" && result.lines.slice(0, 2)).toEqual(["✓ round close checks passed", "✓ round R-02 established: P01-analysis, P02-implement"])
      expect(await currentRound(dir)).toBe(2)
      expect(await exists(dir, "docs/R-02/phases.md")).toBe(true)
    }),
  )

  test(
    "row 1 for R-02 while R-01 still has pending phases: refused, nothing written",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      mkdirSync(join(dir, "docs/R-02"))
      const result = await planPrelude(dir, { phases: "am" })
      expect(result.type === "stop" && result.code).toBe(1)
      expect(result.type === "stop" && result.lines[0]).toStartWith(
        "docs/R-02/ exists without its phase index, but round R-01 is not complete (pending: P01-analysis, P02-implement)",
      )
      expect(await exists(dir, "docs/R-02/phases.md")).toBe(false)
    }),
  )

  test(
    "row 2: a complete round opens the next one only past G8, which exits 2 when it fails",
    withDir(async (dir) => {
      await completeRound(dir, "am")
      await commitAll(dir)
      const refused = await planPrelude(dir, { phases: "am" })
      expect(refused.type).toBe("stop")
      if (refused.type !== "stop") return
      expect(refused.code).toBe(2)
      expect(refused.lines[0]).toBe("⏸ round R-01 does not pass its round-close checks, so round R-02 cannot open yet")
      expect(refused.lines[1]).toBe("⚠ round close checks: plan will refuse to open the next round until these are fixed")
      expect(refused.lines.at(-1)).toBe(`next: fix them, commit, then re-run: opencode-auto plan ${dir}`)
      expect(await exists(dir, "docs/R-02")).toBe(false)
      writeFileSync(join(dir, "docs/R-01/round.md"), FILLED_CLOSE)
      const opened = await planPrelude(dir, { phases: "dm" })
      expect(opened.type === "stop" && opened.code).toBe(0)
      expect(opened.type === "stop" && opened.lines.slice(0, 3)).toEqual([
        "✓ round close checks passed",
        "  ⚠ build: no build command configured (config `build`); the target build was not checked",
        "✓ round R-02 established: P01-design, P02-implement",
      ])
      expect(await currentRound(dir)).toBe(2)
    }),
  )

  test(
    "row 2 with input: refused before G8 runs or anything is written",
    withDir(async (dir) => {
      await completeRound(dir, "am")
      const result = await planPrelude(dir, { phases: "am", input: INPUT, build: "touch built" })
      expect(result).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `round R-01 is complete and round R-02 is not established yet: run opencode-auto plan ${dir} without input to establish it, commit the setup, then pass the input.`,
        ],
      })
      expect(await exists(dir, "built")).toBe(false)
      expect(await exists(dir, "docs/R-02")).toBe(false)
    }),
  )

  test(
    "a legacy layout is refused before anything is written",
    withDir(async (dir) => {
      writeFileSync(join(dir, "PLAN.md"), "# old\n")
      const result = await planPrelude(dir, { phases: "am" })
      expect(result.type === "stop" && result.code).toBe(1)
      expect(result.type === "stop" && result.lines[0]).toStartWith("legacy layout:")
      expect(await exists(dir, "docs")).toBe(false)
    }),
  )
})

describe("phaseTailDrift (D34)", () => {
  test(
    "detects exactly the unstarted-tail drift: in sync, replace, shrink, extend; no index is no drift",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      expect(await phaseTailDrift(dir, 1, "amt")).toBeUndefined()
      const replace = await phaseTailDrift(dir, 1, "amv")
      expect(replace && [replace.round, replace.keep]).toEqual([1, 2])
      expect(replace && replace.index.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
      expect(replace && replace.planned.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-acceptance"])
      const shrink = await phaseTailDrift(dir, 1, "am")
      expect(shrink && [shrink.keep, shrink.planned.length]).toEqual([2, 2])
      const extend = await phaseTailDrift(dir, 1, "amvk")
      expect(extend && extend.planned.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-acceptance", "P04-knowledge"])
      expect(await exists(dir, "docs/R-01/P04-knowledge")).toBe(false)
      // m mode returns before any read, so a phased round that would drift
      // still yields no drift for "m".
      expect(await phaseTailDrift(dir, 1, "m")).toBeUndefined()
    }),
  )

  test(
    "no index and a complete round never drift — even for a value the sync would refuse",
    withDir(async (dir) => {
      expect(await phaseTailDrift(dir, 1, "am")).toBeUndefined()
      await completeRound(dir, "amt")
      // "dm" would drop the completed phases mid-round; a complete round's
      // index is history, so no drift is reported for it.
      expect(await phaseTailDrift(dir, 1, "dm")).toBeUndefined()
    }),
  )

  test(
    "a value the sync refuses throws plannedPhaseUnits's own error",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      await completePhase(dir, (await phasesOf(dir))[0]!)
      await expect(phaseTailDrift(dir, 1, "mt")).rejects.toThrow(/would drop the completed phase docs\/R-01\/P01-analysis/)
      writeFileSync(join(dir, "docs/R-01/P03-test/notes.md"), "draft\n")
      await expect(phaseTailDrift(dir, 1, "am")).rejects.toThrow(/already holds work \(notes\.md\)/)
    }),
  )
})

describe("planPrelude: row 3, the phase-index drift (D34)", () => {
  test(
    "re-syncs the unstarted tail, leaves the change uncommitted and stops for review (exit 0)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      await completePhase(dir, (await phasesOf(dir))[0]!)
      await commitAll(dir)
      const result = await planPrelude(dir, { phases: "amv" })
      expect(result).toEqual({
        type: "stop",
        code: 0,
        lines: [
          `✓ phase index of round R-01 re-synced to config phases (P03-test → P03-acceptance); ` +
            `review docs/R-01/phases.md, commit, then re-run: opencode-auto plan ${dir}`,
        ],
      })
      expect(await read(dir, "docs/R-01/phases.md")).toContain("- [x] P01 analysis\n- [ ] P02 implement\n- [ ] P03 acceptance\n")
      expect(await exists(dir, "docs/R-01/P03-test")).toBe(false)
      // Uncommitted like any round setup: the re-sync is what git reports.
      expect(await git(dir, "status", "--porcelain")).toContain("docs/R-01/phases.md")
    }),
  )

  test(
    "the extend and shrink tails render their pairs; the done prefix keeps its ticks",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const extended = await planPrelude(dir, { phases: "amk" })
      expect(extended.type === "stop" && extended.lines[0]).toContain("re-synced to config phases (+ P03-knowledge)")
      expect((await phasesOf(dir)).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-knowledge"])
      const shrunk = await planPrelude(dir, { phases: "am" })
      expect(shrunk.type === "stop" && shrunk.lines[0]).toContain("re-synced to config phases (P03-knowledge dropped)")
      expect((await phasesOf(dir)).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement"])
    }),
  )

  test(
    "input is refused before any write (D5)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      const before = await read(dir, "docs/R-01/phases.md")
      const result = await planPrelude(dir, { phases: "amv", input: INPUT })
      expect(result).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `the phase index of round R-01 differs from config phases: ` +
            `run opencode-auto plan ${dir} without input to re-sync it, commit the change, then pass the input.`,
        ],
      })
      expect(await read(dir, "docs/R-01/phases.md")).toBe(before)
      expect(await exists(dir, "docs/R-01/P03-acceptance")).toBe(false)
    }),
  )

  test(
    "a value the sync refuses stops with plannedPhaseUnits's own error, writing nothing",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      await completePhase(dir, (await phasesOf(dir))[0]!)
      const result = await planPrelude(dir, { phases: "mt" })
      expect(result.type === "stop" && result.code).toBe(1)
      expect(result.type === "stop" && result.lines[0]).toBe(
        '⏸ phase flow blocked: phases "mt" would drop the completed phase docs/R-01/P01-analysis/ from docs/R-01/phases.md',
      )
      expect(await read(dir, "docs/R-01/phases.md")).toContain("- [ ] P03 test")
    }),
  )

  test(
    "no drift: the loop decides as before",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      expect(await planPrelude(dir, { phases: "amt" })).toEqual({ type: "loop" })
      // m mode never re-syncs (D34): its value is not compared with the
      // index, so the untouched round routes on.
      expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({ type: "loop" })
      expect((await phasesOf(dir)).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
    }),
  )
})

describe("planPrelude: routes (rows 4–9)", () => {
  test(
    "row 4: a blocked route exits 1 with its reason",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      writeFileSync(join(dir, "docs/R-01/phases.md"), "# Phases (R-01)\n\n- [ ] P01 nosuchtype\n")
      const result = await planPrelude(dir, { phases: "am" })
      expect(result.type === "stop" && result.code).toBe(1)
      expect(result.type === "stop" && result.lines[0]).toStartWith("⏸ phase flow blocked: phase index docs/R-01/phases.md is invalid")
    }),
  )

  test(
    "row 5: an open step record goes to the loop, whatever the route",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      await listTasks(dir, (await phasesOf(dir))[0]!, [["T-001", false]])
      await saveProgress(dir, { task: "PLAN", session: "ses_plan", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      expect(await planPrelude(dir, { phases: "m" })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({ type: "loop" })
    }),
  )

  test(
    "row 6, plan route: the loop plans the phase, with or without input",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      expect(await planPrelude(dir, { phases: "am" })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "am", input: INPUT })).toEqual({ type: "loop" })
    }),
  )

  test(
    "row 6, a task-less phase on the plan route: input goes to the next phase that plans tasks",
    withDir(async (dir) => {
      // A letter preset keeps k last; a type-id list may lead with it.
      const phases = "knowledge,implement"
      await establishRound(dir, { phases })
      expect(await planPrelude(dir, { phases, input: INPUT })).toEqual({ type: "loop" })
      await listTasks(dir, (await phasesOf(dir))[1]!, [["T-001", false]])
      const result = await planPrelude(dir, { phases, input: INPUT })
      expect(result).toEqual({
        type: "stop",
        code: 1,
        lines: ["R-01.P02 implement, the next phase to plan, already lists tasks in docs/R-01/P02-implement/tasks.md; the planning input would not be used"],
      })
    }),
  )

  test(
    "row 6, handover route: input needs a phase left to plan after the handover",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amk" })
      const [analysis, implement] = await phasesOf(dir)
      await listTasks(dir, analysis!, [["T-001", true]])
      expect(await planPrelude(dir, { phases: "amk" })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "amk", input: INPUT })).toEqual({ type: "loop" })
      // The last phase with tasks, followed only by a task-less one.
      await completePhase(dir, analysis!)
      await listTasks(dir, implement!, [["T-002", true]])
      expect(await planPrelude(dir, { phases: "amk" })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "amk", input: INPUT })).toEqual({
        type: "stop",
        code: 1,
        lines: ["no phase is left to plan in round R-01; the planning input would not be used"],
      })
    }),
  )

  test(
    "row 7, phased execute route: a notice and exit 0; input is exit 1 (D7)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      await listTasks(dir, (await phasesOf(dir))[0]!, [["T-001", true], ["T-002", false]])
      const notice =
        `ℹ R-01.P01 analysis is planned (1 of 2 tasks pending); next: opencode-auto run ${dir} ` +
        `— or add tasks with opencode-auto plan ${dir} --append -p <text>, or close units with opencode-auto close <ref>`
      expect(await planPrelude(dir, { phases: "am" })).toEqual({ type: "stop", code: 0, lines: [notice] })
      expect(await planPrelude(dir, { phases: "am", input: INPUT })).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `R-01.P01 analysis already lists tasks, so the planning input would not be used; add tasks with opencode-auto plan ${dir} --append -p <text> | --file <path>`,
          notice,
        ],
      })
    }),
  )

  test(
    "row 8, m mode with an empty index: input goes to the loop; without it, a notice",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "m" })).toEqual({
        type: "stop",
        code: 0,
        lines: [
          "ℹ no tasks listed in docs/R-01/P01-implement/tasks.md yet: list them there by hand (docs/T-NNN/todo.md per task), " +
            `or run: opencode-auto plan ${dir} -p <text> | --file <path>`,
        ],
      })
    }),
  )

  test(
    "row 9, m mode with tasks listed: input implies the append and goes to the loop; without it, a notice",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const [implement] = await phasesOf(dir)
      await listTasks(dir, implement!, [["T-001", true], ["T-002", false]])
      const notice =
        `ℹ docs/R-01/P01-implement/tasks.md lists 2 task(s) (1 pending); next: opencode-auto run ${dir}, ` +
        `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`
      expect(await planPrelude(dir, { phases: "m" })).toEqual({ type: "stop", code: 0, lines: [notice] })
      // In m mode the input on a non-empty index is an append (D23): the flag
      // is implied, and an explicit one accepted as redundant.
      expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "m", input: INPUT, append: true })).toEqual({ type: "loop" })
      // All done: m mode's phase stays open, so this is still row 9.
      await listTasks(dir, implement!, [["T-001", true], ["T-002", true]])
      expect(await planPrelude(dir, { phases: "m" })).toEqual({
        type: "stop",
        code: 0,
        lines: [
          `ℹ docs/R-01/P01-implement/tasks.md lists 2 task(s) (0 pending); next: opencode-auto run ${dir}, ` +
            `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`,
        ],
      })
      expect(await planPrelude(dir, { phases: "m", input: INPUT, append: true })).toEqual({ type: "loop" })
    }),
  )

  test(
    "row 9 D26: a record of an open task stops the append; a step record or a done task's does not",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const [implement] = await phasesOf(dir)
      await listTasks(dir, implement!, [["T-001", true], ["T-002", false]])
      for (const active of [true, false]) {
        await saveProgress(dir, { task: "T-002", at: 1, active, phase: { kind: "subtasks", index: 1 } })
        expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({
          type: "stop",
          code: 1,
          lines: ["T-002 is mid-pipeline (its resume point is in .auto/progress.json); finish it with run, or close it, before appending"],
        })
      }
      // A step record (task PLAN) is the step machinery's own, and the done
      // task's leftover record names a task that is no longer open.
      await saveProgress(dir, { task: "PLAN", at: 1, active: true, phase: { kind: "step", step: "phase-append", unit: "R-01.P01" } })
      expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({ type: "loop" })
      await saveProgress(dir, { task: "T-001", at: 1, active: true, phase: { kind: "subtasks", index: 1 } })
      expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({ type: "loop" })
    }),
  )

  test(
    "row 10: --append on the phased execute and handover routes goes to the loop targeting the phase named now",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [["T-001", true], ["T-002", false]])
      // Execute route: the append targets this phase, guard passing.
      expect(await planPrelude(dir, { phases: "am", input: INPUT, append: true })).toEqual({ type: "loop" })
      // Handover route on the last task phase (only a task-less one follows):
      // the append still targets this phase — it never advances to another
      // one — while the same input without the flag is row 6's refusal (no
      // phase left to plan after the handover).
      await establishRound(dir, { phases: "amk" })
      const [a, implement] = await phasesOf(dir)
      await listTasks(dir, a!, [["T-001", true]])
      await completePhase(dir, a!)
      await listTasks(dir, implement!, [["T-002", true]])
      expect(await planPrelude(dir, { phases: "amk", input: INPUT, append: true })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "amk", input: INPUT })).toEqual({
        type: "stop",
        code: 1,
        lines: ["no phase is left to plan in round R-01; the planning input would not be used"],
      })
    }),
  )

  test(
    "row 10 D26: a record of an open task on the execute route stops the append",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [["T-001", true], ["T-002", false]])
      await saveProgress(dir, { task: "T-002", at: 1, active: true, phase: { kind: "subtasks", index: 2 } })
      expect(await planPrelude(dir, { phases: "am", input: INPUT, append: true })).toEqual({
        type: "stop",
        code: 1,
        lines: ["T-002 is mid-pipeline (its resume point is in .auto/progress.json); finish it with run, or close it, before appending"],
      })
    }),
  )

  test(
    "--append on the phased plan route plans the phase normally (D23); without input it is a usage error",
    withDir(async (dir) => {
      // A usage error before any route logic — including the round-setup
      // rows, where it fires instead of the D5 input refusal, and before
      // anything is written.
      for (const phases of ["am", "m"]) {
        expect(await planPrelude(dir, { phases, append: true })).toEqual({
          type: "stop",
          code: 1,
          lines: [
            `--append requires a planning input: pass one with opencode-auto plan ${dir} -p <text> | --file <path> — appending adds the tasks planned from the input to the current phase`,
          ],
        })
      }
      expect(await exists(dir, "docs/R-01")).toBe(false)
      await establishRound(dir, { phases: "am" })
      expect(await planPrelude(dir, { phases: "am", input: INPUT, append: true })).toEqual({ type: "loop" })
    }),
  )
})

describe("plan's stop lines (D8, D15)", () => {
  test(
    "planned: the phase and count when phased, the id span in m mode",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      expect(plannedLines("/p", analysis!, ["T-004", "T-005"], false)).toEqual([
        "✓ planned R-01.P01 analysis: 2 task(s) in docs/R-01/P01-analysis/tasks.md",
        "next: review them (edit, close, or plan --append), then run: opencode-auto run /p",
      ])
      expect(plannedLines("/p", analysis!, ["T-012", "T-013", "T-015"], true)[0]).toBe("✓ planned 3 task(s) (T-012…T-015) into docs/R-01/P01-analysis/tasks.md")
      expect(plannedLines("/p", analysis!, ["T-012"], true)[0]).toBe("✓ planned 1 task(s) (T-012) into docs/R-01/P01-analysis/tasks.md")
    }),
  )

  test("a round completed inside plan: the next round opens on the next plan", () => {
    expect(roundCompleteNext("/p", 1)).toBe("next: fill in ## Close of docs/R-01/round.md, commit, then run opencode-auto plan /p to open round R-02")
  })
})

describe("run's drift stop (D34)", () => {
  // The OPENCODE_AUTO_* environment is scrubbed and console.log captured
  // around each runAll (the loop harness's conventions): hibernation windows
  // and ambient switches stay out, and the stop line is assertable.
  async function runQuiet(run: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
    const saved = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key))
    for (const [key] of saved) delete process.env[key]
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    try {
      return { code: await run(), lines }
    } finally {
      printed.mockRestore()
      for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
    }
  }

  // The fixture preflight needs: a git repository as init leaves it, with the
  // agent contract and a committed round — the stop the drift check makes
  // precedes startAgent, so no agent has to exist.
  test(
    "runAll exits 1 naming plan and writes nothing; a value the sync refuses stops with the guard's error",
    withDir(async (dir) => {
      const { runAll } = await import("../src/loop")
      await establishRound(dir, { phases: "amt" })
      await completePhase(dir, (await phasesOf(dir))[0]!)
      mkdirSync(join(dir, ".opencode", "agent"), { recursive: true })
      writeFileSync(join(dir, ".opencode", "agent", "auto.md"), "contract\n")
      await commitAll(dir)
      const before = await read(dir, "docs/R-01/phases.md")
      const stopped = await runQuiet(() => runAll(dir, { phases: "amv" }))
      expect(stopped.code).toBe(1)
      expect(stopped.lines).toContain(
        `⏸ the phase index of round R-01 (P01-analysis, P02-implement, P03-test) differs from config phases ` +
          `(P01-analysis, P02-implement, P03-acceptance): run opencode-auto plan ${dir} to re-sync its unstarted phases`,
      )
      expect(await read(dir, "docs/R-01/phases.md")).toBe(before)
      expect(await exists(dir, "docs/R-01/P03-acceptance")).toBe(false)
      expect(await exists(dir, "docs/R-01/P03-test/todo.md")).toBe(true)
      const refused = await runQuiet(() => runAll(dir, { phases: "mt" }))
      expect(refused.code).toBe(1)
      expect(refused.lines).toContain(
        '⏸ phase flow blocked: phases "mt" would drop the completed phase docs/R-01/P01-analysis/ from docs/R-01/phases.md',
      )
    }),
  )
})
