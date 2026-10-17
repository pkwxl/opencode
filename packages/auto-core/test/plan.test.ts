// plan's prelude (plans/0053 D4–D5, D7, D15, D23, D26, D34): every route that
// needs no AI, decided over docs-tree fixtures before any agent starts; git
// fixtures where the round-close check (G8) or the row-3 re-sync's
// uncommitted change is asserted. The loop side of the stop condition (D6,
// D8) needs the loop harness (plans/0053 A7, B6); run's drift stop (D34)
// lands here too — it precedes the agent pool's start, so runAll drives it without an
// agent over the same fixtures.
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { completePhase, currentRound, establishRound, phaseLabel, phaseTailDrift, readPhases, type PhaseUnit } from "../src/phases"
import { planPrelude, plannedLines, roundCompleteNext } from "../src/plan"
import { saveProgress } from "../src/resume"
import { setSwitchModelRegistry, SWITCH_ENV } from "../src/switches"
import { qualifiedPhase, renderTaskIndex } from "../src/tasks"

const INPUT = { text: "Port the retry policy." }

// The analysis switch (plans/0084): the direct-establishment rows below run
// with it off — their fresh dirs would otherwise route into the analysis
// flow — and the analysis describe flips it back on per test. autoSwitches
// parses once per process, so every flip resets the memo through the
// exported reset (setSwitchModelRegistry clears it).
function analysisOff() {
  process.env[SWITCH_ENV.analysis] = "off"
  setSwitchModelRegistry(undefined)
}
function analysisOn() {
  delete process.env[SWITCH_ENV.analysis]
  setSwitchModelRegistry(undefined)
}
beforeAll(analysisOff)

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

// A round whose phases are all done, each with one done task — and the round
// report the close gate requires (plans/0081 D4; a run would self-heal one
// through an appended report task, the fixture writes it directly).
async function completeRound(dir: string, phases: string) {
  await establishRound(dir, { phases })
  let n = 1
  for (const phase of await phasesOf(dir)) {
    if (phase.entry.hasTasks) await listTasks(dir, phase, [[`T-00${n++}`, true]])
    await completePhase(dir, phase)
  }
  const round = await currentRound(dir)
  writeFileSync(join(dir, "docs", `R-${String(round).padStart(2, "0")}`, "report-for-user.md"), "# Round report\n\nAll done.\n\n<!-- auto: eof -->\n")
}

const FILLED_CLOSE = "# Round R-01\n\n## Close\n\n- Restated: the retry policy, in src/net/README.md.\n- Accepted as lost: none.\n"

describe("planPrelude: the phased state refusals (plans/0101 D4) and m mode's round setup (row 1)", () => {
  const transferStart = (dir: string) =>
    `no plan task awaits dispatch and no round is established: the project start — the analysis, the round establishment, ` +
    `the first plan task's construction — is transfer's; run: opencode-auto transfer ${dir}`

  test(
    "phased, nothing established: refused naming transfer, before any write, whatever rode along",
    withDir(async (dir) => {
      for (const opts of [{}, { input: INPUT }, { newTask: "thing" }, { export: "T-001" }, { round: true }, { phase: true }]) {
        const result = await planPrelude(dir, { phases: "am", ...opts })
        expect(result).toEqual({ type: "stop", code: 1, lines: [transferStart(dir)] })
      }
      expect(await exists(dir, "docs/R-01")).toBe(false)
      expect(await exists(dir, "docs/analysis.md")).toBe(false)
    }),
  )

  test(
    "phased, an interrupted round start (R-02 exists without its index): refused naming transfer",
    withDir(async (dir) => {
      await completeRound(dir, "am")
      mkdirSync(join(dir, "docs/R-02"))
      await commitAll(dir)
      const result = await planPrelude(dir, { phases: "am" })
      expect(result).toEqual({ type: "stop", code: 1, lines: [transferStart(dir)] })
      expect(await exists(dir, "docs/R-02/phases.md")).toBe(false)
    }),
  )

  test(
    "phased, a complete round: refused naming transfer (the close and the next opening are the advance's)",
    withDir(async (dir) => {
      await completeRound(dir, "am")
      await commitAll(dir)
      for (const opts of [{}, { input: INPUT }, { newTask: "thing" }]) {
        const result = await planPrelude(dir, { phases: "am", ...opts })
        expect(result).toEqual({
          type: "stop",
          code: 1,
          lines: [`round R-01 is complete and no plan task awaits dispatch: the round close and the next round's opening are transfer's; run: opencode-auto transfer ${dir}`],
        })
      }
      expect(await exists(dir, "docs/R-02")).toBe(false)
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
          "ℹ no project brief yet; the survey phase will propose one — seed it optionally with init --brief <one line>, or name the reference in this round's planning input",
          "✓ round R-01 established: single phase P01-implement",
          "next (round-start gate): review the setup and commit it; then list tasks in docs/R-01/P01-implement/tasks.md by hand, " +
            `or run: opencode-auto plan ${dir} -p <text> | --file <path>`,
          "ℹ AGENTS.md carries this state's preparation guidance for your coding agent (the round brief's sections, and where their content comes from)",
        ],
      })
      expect(await exists(dir, "docs/R-01/round.md")).toBe(false)
    }),
  )

  test(
    "row 1, m mode with input: refused before any write (D5)",
    withDir(async (dir) => {
      const result = await planPrelude(dir, { phases: "m", input: INPUT })
      expect(result).toEqual({
        type: "stop",
        code: 1,
        lines: [`round R-01 is not established yet: run opencode-auto plan ${dir} without input to establish it, commit the setup, then pass the input.`],
      })
      expect(await exists(dir, "docs/R-01")).toBe(false)
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
    "no drift: the route decides as before (the phased plan route refusing as transfer's, plans/0101 D4)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      const phased = await planPrelude(dir, { phases: "amt" })
      expect(phased.type === "stop" && phased.code).toBe(1)
      expect(phased.type === "stop" && phased.lines[0]).toBe(
        `nothing is constructed for R-01.P01 analysis yet — transfer constructs its plan task and stops for your review; run: opencode-auto transfer ${dir}`,
      )
      // m mode never re-syncs (D34): its value is not compared with the
      // index, so the untouched round routes on.
      expect(await planPrelude(dir, { phases: "m", input: INPUT })).toEqual({ type: "loop" })
      expect((await phasesOf(dir)).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
    }),
  )

  test(
    "a roadmap-governed round is never drift against config; moving the line re-shapes the tail under the roadmap's name (D5)",
    withDir(async (dir) => {
      await commitAll(dir)
      mkdirSync(join(dir, "docs"), { recursive: true })
      // A released roadmap whose R-01 line (amt) established the round; the
      // resolution — not the switch — carries it (the document is released,
      // so it rules whatever flow wrote it).
      writeFileSync(join(dir, "docs/analysis.md"), FILLED_ANALYSIS)
      await establishRound(dir, { phases: "amt" })
      // Config says "am": against the roadmap-established index that is not
      // a drift — the roadmap's line holds, the round routes on (its plan
      // route refusing as transfer's, plans/0101 D4 — the refusal is the
      // routed state, nothing was re-shaped).
      const held = await planPrelude(dir, { phases: "am" })
      expect(held.type === "stop" && held.code).toBe(1)
      expect(held.type === "stop" && held.lines[0]).toBe(
        `nothing is constructed for R-01.P01 analysis yet — transfer constructs its plan task and stops for your review; run: opencode-auto transfer ${dir}`,
      )
      expect((await phasesOf(dir)).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
      // The person edits the line — the documents-decide channel: the tail
      // re-syncs, the stop naming the roadmap as the authority moved.
      writeFileSync(join(dir, "docs/analysis.md"), FILLED_ANALYSIS.replace("- R-01 amt — port the core and its tests", "- R-01 am — port the core"))
      const moved = await planPrelude(dir, { phases: "am" })
      expect(moved.type === "stop" && moved.code).toBe(0)
      expect(moved.type === "stop" && moved.lines[0]).toContain("re-synced to the roadmap of docs/analysis.md (P03-test dropped)")
      expect((await phasesOf(dir)).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement"])
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
    "row 6, phased plan route: refused naming transfer — bare, and with input naming its home (plans/0101 D4)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      expect(await planPrelude(dir, { phases: "am" })).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `nothing is constructed for R-01.P01 analysis yet — transfer constructs its plan task and stops for your review; run: opencode-auto transfer ${dir}`,
        ],
      })
      expect(await planPrelude(dir, { phases: "am", input: INPUT })).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `nothing is constructed for R-01.P01 analysis yet — transfer constructs its plan task and stops for your review; run: opencode-auto transfer ${dir} ` +
            `(the planning input's home is docs/R-01/P01-analysis/plan-input.md — write it there, or prepare it with opencode-auto plan ${dir} --phase, commit, and the construct reads it)`,
        ],
      })
      // A task-less phase (knowledge) leading the index refuses the same way:
      // the knowledge branch is run's, the advance transfer's.
      const phases = "knowledge,implement"
      await establishRound(dir, { phases })
      expect(await planPrelude(dir, { phases })).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `nothing is constructed for R-01.P01 knowledge yet — transfer constructs its plan task and stops for your review; run: opencode-auto transfer ${dir}`,
        ],
      })
    }),
  )

  test(
    "row 6, phased handover route: refused naming transfer (the boundary is the advance's)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis, implement] = await phasesOf(dir)
      await listTasks(dir, analysis!, [["T-001", true]])
      await completePhase(dir, analysis!)
      await listTasks(dir, implement!, [["T-002", true]])
      for (const opts of [{}, { input: INPUT }]) {
        const result = await planPrelude(dir, { phases: "am", ...opts })
        expect(result).toEqual({
          type: "stop",
          code: 1,
          lines: [
            `R-01.P02 implement is at its boundary — the handover distillation, the phase close and the next plan task's construction are transfer's; run: opencode-auto transfer ${dir}` +
              (opts.input ? ` (a planning input for the next phase belongs in its plan-input.md, after the advance)` : ""),
          ],
        })
      }
    }),
  )

  test(
    "row 7, phased execute route with no awaiting plan task: refused naming run and transfer (plans/0101 D4)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      await listTasks(dir, (await phasesOf(dir))[0]!, [["T-001", true], ["T-002", false]])
      const refusal =
        `no reviewed plan task awaits dispatch: R-01.P01 analysis holds 1 pending task(s) — execute work for opencode-auto run ${dir}; ` +
        `the boundary and the next plan task are transfer's (opencode-auto transfer ${dir})`
      expect(await planPrelude(dir, { phases: "am" })).toEqual({ type: "stop", code: 1, lines: [refusal] })
      expect(await planPrelude(dir, { phases: "am", input: INPUT })).toEqual({
        type: "stop",
        code: 1,
        lines: [`${refusal}; a planning input adds tasks with --append, it never dispatches`],
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
      // one — while the same input without the flag is row 6's boundary
      // refusal (plans/0101 D4).
      await establishRound(dir, { phases: "amk" })
      const [a, implement] = await phasesOf(dir)
      await listTasks(dir, a!, [["T-001", true]])
      await completePhase(dir, a!)
      await listTasks(dir, implement!, [["T-002", true]])
      expect(await planPrelude(dir, { phases: "amk", input: INPUT, append: true })).toEqual({ type: "loop" })
      expect(await planPrelude(dir, { phases: "amk", input: INPUT })).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `R-01.P02 implement is at its boundary — the handover distillation, the phase close and the next plan task's construction are transfer's; run: opencode-auto transfer ${dir} ` +
            `(a planning input for the next phase belongs in its plan-input.md, after the advance)`,
        ],
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
    "--append without input is a usage error everywhere; on the phased plan route the input rides row 6's refusal (plans/0101 D4)",
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
      // The phased plan route refuses the input-and-append alike: the
      // construction is transfer's, the input's home the document.
      await establishRound(dir, { phases: "am" })
      expect(await planPrelude(dir, { phases: "am", input: INPUT, append: true })).toEqual({
        type: "stop",
        code: 1,
        lines: [
          `nothing is constructed for R-01.P01 analysis yet — transfer constructs its plan task and stops for your review; run: opencode-auto transfer ${dir} ` +
            `(the planning input's home is docs/R-01/P01-analysis/plan-input.md — write it there, or prepare it with opencode-auto plan ${dir} --phase, commit, and the construct reads it)`,
        ],
      })
    }),
  )
})

// The dispatch seam (plans/0101 D3/D4): a formulation task standing in the
// phase's index is the reviewed plan task plan dispatches. The guards: the
// stub-round refusal (the incident's — no planning session dispatches
// against an empty round brief), the input-invalidation rule (an input that
// changes what the todo rendered refuses naming the transfer re-run), and
// the awaiting predicate's place-independence (beside hand-added tasks).
describe("planPrelude: the dispatch seam (plans/0101 D3/D4)", () => {
  // Seed the phase's index with its formulation task (the driver-constructed
  // shape: the Formulate: field naming the owning phase) plus any extra
  // hand-added lines.
  async function listFormulation(dir: string, phase: PhaseUnit, extra: Array<[string, boolean]> = []) {
    const q = qualifiedPhase(phase)
    const rows = [["T-001", false] as [string, boolean], ...extra]
    await Bun.write(
      join(dir, phase.dir, "tasks.md"),
      renderTaskIndex(q, rows.map(([id, done]) => ({ id, title: id === "T-001" ? `Formulate the ${phase.entry.name} tasks` : `task ${id}`, done }))),
    )
    await Bun.write(
      join(dir, "docs/T-001/todo.md"),
      `# T-001: Formulate the ${phase.entry.name} tasks\nPhase: ${q}\nFormulate: ${q}\nDecompose: whole\nDepends: none\n\n## Goal\n\nPlan the phase.\n\n## Scope\n\nThe inputs.\n\n## Acceptance\n\nThe charter.\n\n<!-- auto: eof -->\n`,
    )
    for (const [id, done] of extra) {
      await Bun.write(join(dir, "docs", id, done ? "done.md" : "todo.md"), `# ${id}: task ${id}\nPhase: ${q}\n\nbody\n\n<!-- auto: eof -->\n`)
    }
  }

  const fillBrief = async (dir: string) => {
    writeFileSync(join(dir, "docs/R-01/round.md"), "# Round R-01\n\n## Goal\n\nPort the core.\n\n## Acceptance criteria\n\nIt reads back.\n\n## Release criteria\n\nClean tree.\n\n## Close\n\n- Restated.\n")
  }

  test("the dispatch: a standing formulation task routes to the loop once the round brief is filled", withDir(async (dir) => {
    await establishRound(dir, { phases: "am" })
    await fillBrief(dir)
    await listFormulation(dir, (await phasesOf(dir))[0]!)
    expect(await planPrelude(dir, { phases: "am" })).toEqual({ type: "loop" })
    // Beside a hand-added pending task the todo still awaits its dispatch
    // (the predicate is place-independent, plans/0101 D4).
    await listFormulation(dir, (await phasesOf(dir))[0]!, [["T-002", false]])
    expect(await planPrelude(dir, { phases: "am" })).toEqual({ type: "loop" })
  }))

  test("the stub-round refusal (plans/0101 D3): an untouched round.md holds the dispatch, exit 2 naming the fill and the reconstruct", withDir(async (dir) => {
    await establishRound(dir, { phases: "am" })
    await listFormulation(dir, (await phasesOf(dir))[0]!)
    const refused = await planPrelude(dir, { phases: "am" })
    expect(refused).toEqual({
      type: "stop",
      code: 2,
      lines: [
        "⏸ the round brief docs/R-01/round.md is still the untouched stub: no planning session dispatches against an empty round brief",
        `next: fill it in (## Goal, ## Acceptance criteria, ## Release criteria — opencode-auto plan ${dir} --round points the AGENTS.md guidance at it), commit, ` +
          `then re-run: opencode-auto transfer ${dir} — its idempotent reconstruct absorbs the filled brief and stops for review again`,
      ],
    })
    // The fill releases it: the dispatch routes.
    await fillBrief(dir)
    expect(await planPrelude(dir, { phases: "am" })).toEqual({ type: "loop" })
  }))

  test("the input-invalidation rule (plans/0101 D4): a changed input refuses naming the transfer re-run; the same text dispatches", withDir(async (dir) => {
    await establishRound(dir, { phases: "am" })
    await fillBrief(dir)
    const phase = (await phasesOf(dir))[0]!
    await listFormulation(dir, phase)
    // No persisted input: any input changes what the todo rendered.
    const fresh = await planPrelude(dir, { phases: "am", input: INPUT })
    expect(fresh).toEqual({
      type: "stop",
      code: 1,
      lines: [
        `the planning input changes what the reviewed plan task rendered — an input that changes after construction invalidates the todo: ` +
          `write it into docs/R-01/P01-analysis/plan-input.md (or prepare it with opencode-auto plan ${dir} --phase), commit, and re-run: opencode-auto transfer ${dir} — ` +
          `its idempotent reconstruct absorbs the input and stops for review again (the same text re-passed dispatches as-is)`,
      ],
    })
    expect(await exists(dir, "docs/R-01/P01-analysis/plan-input.md")).toBe(false)
    // The persisted input is what the todo rendered: the same text re-passed
    // dispatches; a different one refuses.
    await Bun.write(join(dir, "docs/R-01/P01-analysis/plan-input.md"), `${INPUT.text}\n`)
    expect(await planPrelude(dir, { phases: "am", input: { text: INPUT.text } })).toEqual({ type: "loop" })
    expect(await planPrelude(dir, { phases: "am", input: { text: "A different intent." } })).toEqual({
      type: "stop",
      code: 1,
      lines: [
        `the planning input changes what the reviewed plan task rendered — an input that changes after construction invalidates the todo: ` +
          `write it into docs/R-01/P01-analysis/plan-input.md (or prepare it with opencode-auto plan ${dir} --phase), commit, and re-run: opencode-auto transfer ${dir} — ` +
          `its idempotent reconstruct absorbs the input and stops for review again (the same text re-passed dispatches as-is)`,
      ],
    })
  }))
})

describe("planPrelude: --new-task (row 11, plans/0058)", () => {
  const TITLE = "Harden the retry policy against provider throttling"

  test("usage backstops: input or --append alongside, and a blank or multi-line title", withDir(async (dir) => {
    const excluded =
      `--new-task adds the task you name with no session; it takes no planning input and no --append — ` +
      `pass only the title (opencode-auto plan ${dir} --new-task "<title>"), or plan from an input instead (opencode-auto plan ${dir} --append -p <text> | --file <path>)`
    expect(await planPrelude(dir, { phases: "am", newTask: TITLE, input: INPUT })).toEqual({ type: "stop", code: 1, lines: [excluded] })
    expect(await planPrelude(dir, { phases: "am", newTask: TITLE, append: true })).toEqual({ type: "stop", code: 1, lines: [excluded] })
    for (const bad of ["", "   ", "two\nlines"]) {
      expect(await planPrelude(dir, { phases: "am", newTask: bad })).toEqual({
        type: "stop",
        code: 1,
        lines: ["--new-task requires a one-line task title (it becomes the index line and the task document's title); longer context goes into docs/T-NNN/todo.md after the add"],
      })
    }
    expect(await exists(dir, "docs/R-01")).toBe(false)
  }))

  test("round-setup rows refuse before any write (D5; the phased rows as transfer's, plans/0101 D4)", withDir(async (dir) => {
    // No round yet: the phased refusal names transfer, m mode row 1's own line.
    expect(await planPrelude(dir, { phases: "am", newTask: TITLE })).toEqual({
      type: "stop",
      code: 1,
      lines: [
        `no plan task awaits dispatch and no round is established: the project start — the analysis, the round establishment, ` +
          `the first plan task's construction — is transfer's; run: opencode-auto transfer ${dir}`,
      ],
    })
    expect(await planPrelude(dir, { phases: "m", newTask: TITLE })).toEqual({
      type: "stop",
      code: 1,
      lines: [`round R-01 is not established yet: run opencode-auto plan ${dir} without --new-task to establish it, commit the setup, then add the task again.`],
    })
    // Row 3: a drift is re-synced first; the task waits.
    await establishRound(dir, { phases: "amt" })
    const before = await read(dir, "docs/R-01/phases.md")
    expect(await planPrelude(dir, { phases: "amv", newTask: TITLE })).toEqual({
      type: "stop",
      code: 1,
      lines: [`the phase index of round R-01 differs from config phases: run opencode-auto plan ${dir} without --new-task to re-sync it, commit the change, then add the task again.`],
    })
    expect(await read(dir, "docs/R-01/phases.md")).toBe(before)
  }))

  test("an open step or a mid-pipeline task refuses the add", withDir(async (dir) => {
    await establishRound(dir, { phases: "m" })
    const [implement] = await phasesOf(dir)
    await listTasks(dir, implement!, [["T-001", true], ["T-002", false]])
    await saveProgress(dir, { task: "PLAN", session: "ses", at: 1, active: true, phase: { kind: "step", step: "phase-append", unit: "R-01.P01" } })
    expect(await planPrelude(dir, { phases: "m", newTask: TITLE })).toEqual({
      type: "stop",
      code: 1,
      lines: [
        `the task appending step of R-01.P01 was interrupted and is not closed out; finish it first (run: opencode-auto plan ${dir}), then add the task with --new-task`,
      ],
    })
    await saveProgress(dir, { task: "T-002", at: 1, active: true, phase: { kind: "subtasks", index: 1 } })
    expect(await planPrelude(dir, { phases: "m", newTask: TITLE })).toEqual({
      type: "stop",
      code: 1,
      lines: ["T-002 is mid-pipeline (its resume point is in .auto/progress.json); finish it with run, or close it, before appending"],
    })
    expect(await exists(dir, "docs/T-003")).toBe(false)
  }))

  test("a task-less (knowledge) phase refuses: it distills knowledge, it holds no tasks", withDir(async (dir) => {
    await establishRound(dir, { phases: "knowledge,implement" })
    expect(await planPrelude(dir, { phases: "knowledge,implement", newTask: TITLE })).toEqual({
      type: "stop",
      code: 1,
      lines: [
        `R-01.P01 knowledge holds no tasks (its type, knowledge, distills knowledge instead); ` +
          `--new-task adds a task to a phase that runs them — advance through it with opencode-auto run ${dir}`,
      ],
    })
  }))

  test("m mode: creates the index with T-001 on the empty one, appends after existing lines otherwise", withDir(async (dir) => {
    await establishRound(dir, { phases: "m" })
    const [implement] = await phasesOf(dir)
    const added = await planPrelude(dir, { phases: "m", newTask: TITLE })
    expect(added).toEqual({
      type: "stop",
      code: 0,
      lines: [
        "✓ task T-001 added to docs/R-01/P01-implement/tasks.md (no session: --new-task writes it directly)",
        `next: review it (sharpen the Goal / Scope / Acceptance of docs/T-001/todo.md if needed), then run: opencode-auto run ${dir}`,
      ],
    })
    expect(await read(dir, "docs/R-01/P01-implement/tasks.md")).toContain(`- [ ] T-001 ${TITLE}`)
    expect(await read(dir, "docs/T-001/todo.md")).toContain(`Phase: R-01.P01`)
    await listTasks(dir, implement!, [["T-001", true], ["T-002", false]])
    const again = await planPrelude(dir, { phases: "m", newTask: "Second known task" })
    expect(again.type === "stop" && again.code).toBe(0)
    expect(await read(dir, "docs/R-01/P01-implement/tasks.md")).toContain(`- [ ] T-003 Second known task`)
  }))

  test("phased: the plan route gains its first task, the execute route appends to the phase named now", withDir(async (dir) => {
    await establishRound(dir, { phases: "am" })
    const [analysis] = await phasesOf(dir)
    const planned = await planPrelude(dir, { phases: "am", newTask: TITLE })
    expect(planned.type === "stop" && planned.code).toBe(0)
    expect(await read(dir, "docs/R-01/P01-analysis/tasks.md")).toContain(`- [ ] T-001 ${TITLE}`)
    await listTasks(dir, analysis!, [["T-001", true], ["T-002", false]])
    const appended = await planPrelude(dir, { phases: "am", newTask: "Second known task" })
    expect(appended.type === "stop" && appended.code).toBe(0)
    const index = await read(dir, "docs/R-01/P01-analysis/tasks.md")
    expect(index).toContain(`- [x] T-001 task T-001`)
    expect(index.endsWith(`- [ ] T-003 Second known task\n`)).toBe(true)
  }))

  test("the handover route: a stale handover is removed first and the add is committed (git)", withDir(async (dir) => {
    await establishRound(dir, { phases: "am" })
    const [analysis] = await phasesOf(dir)
    await listTasks(dir, analysis!, [["T-001", true]])
    await Bun.write(join(dir, analysis!.dir, "handover.md"), "# Handover\n\n## Summary\n\ndone\n")
    await commitAll(dir)
    const result = await planPrelude(dir, { phases: "am", newTask: "A fix after the distillation" })
    expect(result.type === "stop" && result.code).toBe(0)
    expect(result.type === "stop" && result.lines[1]).toBe(
      "✓ stale handover removed: docs/R-01/P01-analysis/handover.md (the phase is distilled again after the task)",
    )
    expect(await exists(dir, "docs/R-01/P01-analysis/handover.md")).toBe(false)
    const subjects = (await git(dir, "log", "--format=%s")).trim().split("\n")
    expect(subjects[0]).toBe("PLAN add T-002 A fix after the distillation")
    expect(subjects[1]).toBe("PLAN add T-002: remove the stale handover")
    expect(await git(dir, "status", "--porcelain")).toBe("")
  }))

  test("a dirty worktree stops with exit 2 naming the files", withDir(async (dir) => {
    await establishRound(dir, { phases: "m" })
    await commitAll(dir)
    writeFileSync(join(dir, "unrelated.txt"), "dirty\n")
    const result = await planPrelude(dir, { phases: "m", newTask: TITLE })
    expect(result).toEqual({
      type: "stop",
      code: 2,
      lines: ["⏸ worktree not clean before adding the task; handle it manually (commit/clean) and re-run:", "  unrelated.txt"],
    })
    expect(await exists(dir, "docs/R-01/P01-implement/tasks.md")).toBe(false)
  }))
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
  // precedes the agent pool's start, so no agent has to exist.
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

  test(
    "a moved roadmap line is run's drift authority too: the stop names the roadmap, never config (D5)",
    withDir(async (dir) => {
      const { runAll } = await import("../src/loop")
      await commitAll(dir)
      mkdirSync(join(dir, "docs"), { recursive: true })
      // The released roadmap's R-01 line (amt) established the round; the
      // person then edits the line to am — run refuses before the pool,
      // naming the roadmap as the value the index drifted from (config "am"
      // agrees with the edited line; naming config would name nothing).
      writeFileSync(join(dir, "docs/analysis.md"), FILLED_ANALYSIS)
      await establishRound(dir, { phases: "amt" })
      mkdirSync(join(dir, ".opencode", "agent"), { recursive: true })
      writeFileSync(join(dir, ".opencode", "agent", "auto.md"), "contract\n")
      await commitAll(dir)
      // The person's line edit, committed like theirs would be — run's start
      // requires a clean tree.
      writeFileSync(join(dir, "docs/analysis.md"), FILLED_ANALYSIS.replace("- R-01 amt — port the core and its tests", "- R-01 am — port the core"))
      await commitAll(dir)
      const stopped = await runQuiet(() => runAll(dir, { phases: "am" }))
      expect(stopped.code).toBe(1)
      expect(stopped.lines).toContain(
        `⏸ the phase index of round R-01 (P01-analysis, P02-implement, P03-test) differs from the roadmap of docs/analysis.md ` +
          `(P01-analysis, P02-implement): run opencode-auto plan ${dir} to re-sync its unstarted phases`,
      )
      expect(stopped.lines.some((line) => line.includes("differs from config phases"))).toBe(false)
    }),
  )
})

// A filled, releasable analysis document: every section holds content, one
// recorded fork (answered beside it), a brief proposal and a two-round roadmap
// whose R-01 value deliberately differs from the config the tests pass ("am")
// so the establish advice line is exercised.
const FILLED_ANALYSIS = [
  "# Project analysis",
  "",
  "## Analysis",
  "",
  "A CLI tool of three modules; the retry ladder is the risk area.",
  "",
  "## Goals",
  "",
  "Ship the port with the protocol intact.",
  "",
  "Fork: database — sqlite (recommended: zero-ops) or postgres.",
  "Decision: sqlite, following the recommendation.",
  "",
  "## Project brief",
  "",
  "A faithful port of the core into the monorepo, tests included.",
  "",
  "## Roadmap",
  "",
  "- R-01 amt — port the core and its tests",
  "- R-02 mtv — acceptance pass and knowledge",
  "",
  "Clarified: yes",
  "",
].join("\n")

describe("planPrelude: the pre-round project analysis, m mode (rows 0a–0d, plans/0084; phased re-homed to transfer by plans/0101 D2/D4 — test/transfer.test.ts pins that flow)", () => {
  afterEach(analysisOff)

  test(
    "row 0a: a fresh m-mode target gets the analysis stub and the AGENTS.md analysis guidance",
    withDir(async (dir) => {
      analysisOn()
      const result = await planPrelude(dir, { phases: "m" })
      expect(result.type).toBe("stop")
      if (result.type !== "stop") return
      expect(result.code).toBe(0)
      expect(result.lines[0]).toBe("✓ the project analysis is open: docs/analysis.md written (a stub with section hints)")
      expect(result.lines.at(-1)).toBe(
        `then add the line \`Clarified: yes\`, commit, and re-run: opencode-auto plan ${dir} — the approved brief is installed and round R-01 opens`,
      )
      expect(await exists(dir, "docs/analysis.md")).toBe(true)
      expect(await exists(dir, "docs/R-01")).toBe(false)
      const agents = await read(dir, "AGENTS.md")
      expect(agents).toContain("Current state — project analysis")
      expect(agents).toContain("How opencode-auto works")
      expect(agents).toContain("Assisted preparation rule")
    }),
  )

  test(
    "rows 0b/0c: an unfilled stub names its problems; a filled one awaits Clarified: yes",
    withDir(async (dir) => {
      analysisOn()
      await planPrelude(dir, { phases: "m" })
      const stub = await planPrelude(dir, { phases: "m" })
      expect(stub.type === "stop" && stub.code).toBe(2)
      expect(stub.type === "stop" && stub.lines.some((line) => line.includes("holds no content yet"))).toBe(true)
      // Filled but unreleased: the awaiting-person pause names the fork count.
      writeFileSync(join(dir, "docs/analysis.md"), FILLED_ANALYSIS.replace("\nClarified: yes", ""))
      const awaiting = await planPrelude(dir, { phases: "m" })
      expect(awaiting.type === "stop" && awaiting.code).toBe(2)
      expect(awaiting.type === "stop" && awaiting.lines[0]).toBe(
        "⏸ the project analysis awaits you: review docs/analysis.md, resolve its 1 open Fork: line(s) (append your answers beside them), then add the line `Clarified: yes` and commit",
      )
      // A document that fails the grammar is told so before the release check.
      writeFileSync(join(dir, "docs/analysis.md"), "# no sections\n")
      const problems = await planPrelude(dir, { phases: "m" })
      expect(problems.type === "stop" && problems.code).toBe(2)
      expect(problems.type === "stop" && problems.lines[0]).toBe("⏸ docs/analysis.md has problems that hold its release:")
    }),
  )

  test(
    "row 0d: a released analysis installs the brief and establishes the single phase (the roadmap never rules m mode, D8/D5)",
    withDir(async (dir) => {
      analysisOn()
      await commitAll(dir)
      mkdirSync(join(dir, "docs"), { recursive: true })
      writeFileSync(join(dir, "docs/analysis.md"), FILLED_ANALYSIS)
      const result = await planPrelude(dir, { phases: "m" })
      expect(result.type === "stop" && result.code).toBe(0)
      if (result.type !== "stop") return
      expect(result.lines[0]).toBe("✓ approved project brief installed: docs/analysis.md `## Project brief` section → .opencode/auto/brief.md")
      expect(result.lines).toContain("✓ round R-01 established: single phase P01-implement")
      expect(result.lines.some((line) => line.includes("phases from the roadmap"))).toBe(false)
      expect((await read(dir, ".opencode/auto/brief.md")).trim()).toBe("A faithful port of the core into the monorepo, tests included.")
      expect(await read(dir, "AGENTS.md")).toContain("round R-01 preparation")
      // The round routes on after the release: an input plans against it.
      const again = await planPrelude(dir, { phases: "m", input: INPUT })
      expect(again).toEqual({ type: "loop" })
    }),
  )

  test(
    "OPENCODE_AUTO_ANALYSIS=off: a fresh m-mode target establishes directly, as before (the escape hatch)",
    withDir(async (dir) => {
      const result = await planPrelude(dir, { phases: "m" })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(result.type === "stop" && result.lines).toContain("✓ round R-01 established: single phase P01-implement")
      expect(await exists(dir, "docs/analysis.md")).toBe(false)
    }),
  )

  test(
    "the analysis rows refuse input, --new-task and --export before any write (D5's shape), and --phase has no phase yet",
    withDir(async (dir) => {
      analysisOn()
      const input = await planPrelude(dir, { phases: "m", input: INPUT })
      expect(input.type === "stop" && input.code).toBe(1)
      expect(input.type === "stop" && input.lines[0]).toStartWith("no round exists yet: the project analysis comes first")
      const newTask = await planPrelude(dir, { phases: "m", newTask: "thing" })
      expect(newTask.type === "stop" && newTask.code).toBe(1)
      const order = await planPrelude(dir, { phases: "m", export: "T-001" })
      expect(order.type === "stop" && order.code).toBe(1)
      const phase = await planPrelude(dir, { phases: "m", phase: true })
      expect(phase.type === "stop" && phase.code).toBe(1)
      expect(phase.type === "stop" && phase.lines[0]).toStartWith("no phase exists yet: the project analysis comes first")
      expect(await exists(dir, "docs/analysis.md")).toBe(false)
      expect(await exists(dir, "docs/R-01")).toBe(false)
    }),
  )

  test(
    "--round under the analysis routes into it: the analysis is the round-zero preparation",
    withDir(async (dir) => {
      analysisOn()
      const result = await planPrelude(dir, { phases: "m", round: true })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(result.type === "stop" && result.lines[0]).toBe("✓ the project analysis is open: docs/analysis.md written (a stub with section hints)")
    }),
  )
})

describe("planPrelude: --round / --phase (rows 14–15, plans/0084)", () => {
  test(
    "the backstops: mutually exclusive, and no other route option rides them",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const both = await planPrelude(dir, { phases: "am", round: true, phase: true })
      expect(both.type === "stop" && both.code).toBe(1)
      expect(both.type === "stop" && both.lines[0]).toStartWith("--round and --phase are mutually exclusive")
      const withInput = await planPrelude(dir, { phases: "am", round: true, input: INPUT })
      expect(withInput.type === "stop" && withInput.code).toBe(1)
      expect(withInput.type === "stop" && withInput.lines[0]).toStartWith("--round / --phase take no other option")
    }),
  )

  test(
    "--round on an established round points the guidance at the stub brief; a filled one says so",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const stub = await planPrelude(dir, { phases: "am", round: true })
      expect(stub.type === "stop" && stub.code).toBe(0)
      expect(stub.type === "stop" && stub.lines[0]).toStartWith("ℹ the round brief docs/R-01/round.md is the stub")
      expect(await read(dir, "AGENTS.md")).toContain("round R-01 preparation")
      writeFileSync(join(dir, "docs/R-01/round.md"), "# Round R-01\n\n## Goal\n\nPort it.\n")
      const filled = await planPrelude(dir, { phases: "am", round: true })
      expect(filled.type === "stop" && filled.code).toBe(0)
      expect(filled.type === "stop" && filled.lines[0]).toStartWith("ℹ the round brief docs/R-01/round.md is filled")
    }),
  )

  test(
    "--round in m mode writes the stub establishment never wrote (round-close needs it)",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      expect(await exists(dir, "docs/R-01/round.md")).toBe(false)
      const result = await planPrelude(dir, { phases: "m", round: true })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(await exists(dir, "docs/R-01/round.md")).toBe(true)
    }),
  )

  test(
    "--phase names the next phase to plan and its input path, the pack's scaffold riding in the guidance",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const result = await planPrelude(dir, { phases: "am", phase: true, intent: "default" })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(result.type === "stop" && result.lines[0]).toBe("ℹ prepare the planning input of R-01.P01 analysis: docs/R-01/P01-analysis/plan-input.md")
      const agents = await read(dir, "AGENTS.md")
      expect(agents).toContain("phase R-01.P01 preparation")
      expect(agents).toContain("docs/R-01/P01-analysis/plan-input.md")
      expect(agents).toContain("What this step is for")
    }),
  )

  test(
    "--phase in m mode targets the single phase; on an execute route it points at --append",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const result = await planPrelude(dir, { phases: "m", phase: true, intent: "default" })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(result.type === "stop" && result.lines[0]).toBe("ℹ prepare the planning input of R-01.P01 implement: docs/R-01/P01-implement/plan-input.md")
      await listTasks(dir, (await phasesOf(dir))[0]!, [["T-001", false]])
      const past = await planPrelude(dir, { phases: "m", phase: true })
      expect(past.type === "stop" && past.code).toBe(1)
      expect(past.type === "stop" && past.lines[0]).toStartWith("the single phase already lists tasks")
    }),
  )

  test(
    "--phase on a phased execute route points at --append",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      await listTasks(dir, (await phasesOf(dir))[0]!, [["T-001", false]])
      const past = await planPrelude(dir, { phases: "am", phase: true })
      expect(past.type === "stop" && past.code).toBe(1)
      expect(past.type === "stop" && past.lines[0]).toStartWith("R-01.P01 analysis is past planning")
    }),
  )
})
