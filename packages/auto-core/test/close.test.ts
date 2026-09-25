// closeUnit (plans/0053 D17–D21): task, phase and round targets; explicit
// dependents refused and cascaded, implicit dependents noted; the m-mode
// refusals; both change options and a dirty-tree refusal; records cleared
// only for closed units; trailers and body; the close-out check; git revert
// of the close commit restoring the pending state. Run on real git fixture
// repositories (test/fixtures/runner.ts) so the commit boundary stays live.
import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeUnit } from "../src/close"
import { validHandover, HANDOVER_SECTIONS } from "../src/document/roles"
import { commitTree } from "../src/git"
import { establishRound, readPhases, type PhaseUnit } from "../src/phases"
import { loadPlan, qualifiedPhase, renderTaskIndex, renderTaskTodo } from "../src/tasks"
import { freshRepo, git } from "./fixtures/runner"

const REASON = "not needed this round"

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = await freshRepo()
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function commitAll(dir: string, message = "setup") {
  writeFileSync(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", message)
}

const exists = (dir: string, path: string) => Bun.file(join(dir, path)).exists()

const phasesOf = async (dir: string) => (await readPhases(dir))!.phases

type TaskSpec = { id: string; done?: boolean; depends?: string; report?: boolean }

// List tasks in a phase's index, each with its unit file (done ones already
// renamed); depends renders the explicit `Depends:` field (absent = implicit
// previous sibling).
async function listTasks(dir: string, phase: PhaseUnit, tasks: TaskSpec[]) {
  const q = qualifiedPhase(phase)
  await Bun.write(
    join(dir, phase.dir, "tasks.md"),
    renderTaskIndex(q, tasks.map((task) => ({ id: task.id, title: `task ${task.id}`, done: task.done }))),
  )
  for (const task of tasks) {
    mkdirSync(join(dir, "docs", task.id), { recursive: true })
    rmSync(join(dir, "docs", task.id, task.done ? "todo.md" : "done.md"), { force: true })
    await Bun.write(
      join(dir, "docs", task.id, task.done ? "done.md" : "todo.md"),
      renderTaskTodo({
        id: task.id,
        title: `task ${task.id}`,
        phase: q,
        ...(task.depends !== undefined ? { depends: task.depends } : {}),
        goal: "g",
        scope: "s",
        acceptance: "a",
      }),
    )
    if (task.report) await Bun.write(join(dir, "docs", task.id, "report.md"), `# Report\n\nResult: PASS\n`)
  }
}

const close = (dir: string, ref: string, over: Partial<Parameters<typeof closeUnit>[2]> = {}) =>
  closeUnit(dir, ref, { reason: REASON, phases: "am", ...over })

const head = (dir: string) => git(dir, "rev-parse", "HEAD")

describe("closeUnit: task targets (D17–D18, D21)", () => {
  test(
    "closes an open task: Closed: field, rename, index tick, close commit with body and trailers",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001", done: true, report: true }, { id: "T-002" }])
      await commitAll(dir)
      const result = await close(dir, "T-002")
      expect(result.type).toBe("closed")
      if (result.type !== "closed") return
      expect(result.lines[0]).toBe(`✓ closed T-002: ${REASON}`)
      expect(result.lines).toContain("⚠ closed units skip the unit-close reference scan; the whole-tree scan at round close still applies")
      expect(result.lines.at(-2)).toBe(`to undo before anything else runs: git revert ${(await head(dir)).slice(0, 7)}`)
      expect(result.lines.at(-1)).toBe(`next: opencode-auto run ${dir} to continue, or opencode-auto plan ${dir}`)
      // State: done.md with the Closed: field as the last line of the field block.
      expect(await exists(dir, "docs/T-002/done.md")).toBe(true)
      expect(await exists(dir, "docs/T-002/todo.md")).toBe(false)
      const doc = await Bun.file(join(dir, "docs/T-002/done.md")).text()
      expect(doc).toContain(`Phase: R-01.P01\nClosed: ${REASON}\n`)
      // Index tick.
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("- [x] T-002 task T-002")
      // The close commit: subject, body, trailers, and a clean tree.
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain(`T-002 closed: ${REASON}`)
      expect(message).toContain("Units closed:\n- T-002")
      expect(message).toContain("Auto-Task: T-002")
      expect(message).toContain("Auto-Stage: force-close")
      expect(await git(dir, "status", "--porcelain")).toBe("")
      // Readers see the closure (closed is done for scheduling).
      const plan = await loadPlan(dir, analysis!)
      const task = plan.tasks.find((item) => item.id === "T-002")!
      expect(task.status).toBe("done")
      expect(task.closed).toBe(REASON)
      expect(plan.closed.get("T-002")).toBe(REASON)
      // Other units untouched.
      expect(plan.tasks.find((item) => item.id === "T-001")!.closed).toBeUndefined()
    }),
  )

  test(
    "a task document without a field block gets Closed: as the block, right after the title",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: bare task\n\n## Goal\n\ng\n")
      await commitAll(dir)
      const result = await close(dir, "T-001")
      expect(result.type).toBe("closed")
      expect(await Bun.file(join(dir, "docs/T-001/done.md")).text()).toBe(`# T-001: bare task\n\nClosed: ${REASON}\n## Goal\n\ng\n`)
    }),
  )

  test(
    "works in m mode for tasks, and refuses the round and the phase",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const [implement] = await phasesOf(dir)
      await listTasks(dir, implement!, [{ id: "T-001" }])
      await commitAll(dir)
      expect(await close(dir, "R-01", { phases: "m" })).toEqual({
        type: "refused",
        lines: ["R-01: the single phase of m mode never closes; close tasks instead"],
      })
      expect(await close(dir, "R-01.P01", { phases: "m" })).toEqual({
        type: "refused",
        lines: ["R-01.P01: the single phase of m mode never closes; close tasks instead"],
      })
      expect((await close(dir, "T-001", { phases: "m" })).type).toBe("closed")
      expect(await exists(dir, "docs/T-001/done.md")).toBe(true)
    }),
  )
})

describe("closeUnit: phase and round targets (D18)", () => {
  test(
    "a phase closes with its open tasks, writes the mechanical handover and ticks phases.md",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001", done: true, report: true }, { id: "T-002" }])
      await commitAll(dir)
      const result = await close(dir, "R-01.P01", { acceptanceGate: ["analysis"] })
      expect(result.type).toBe("closed")
      if (result.type !== "closed") return
      expect(result.lines).toContain(`✓ closed R-01.P01 analysis: ${REASON}`)
      expect(result.lines).toContain("ℹ mechanical handover written: docs/R-01/P01-analysis/handover.md")
      // Both units closed; the phase index ticked.
      expect(await exists(dir, "docs/T-002/done.md")).toBe(true)
      expect(await exists(dir, "docs/R-01/P01-analysis/done.md")).toBe(true)
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/done.md")).text()).toContain(`Type: analysis\nClosed: ${REASON}`)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis")
      // The mechanical handover: driver text with the four sections.
      const handover = await Bun.file(join(dir, "docs/R-01/P01-analysis/handover.md")).text()
      expect(validHandover(handover)).toBe(true)
      expect(handover).toContain("closed, not completed")
      expect(handover).toContain(`Reason: ${REASON}`)
      expect(handover).toContain("- Done task T-001: task T-001")
      expect(handover).toContain(`- Closed task T-002: task T-002 — closed without completing: ${REASON}`)
      expect(handover).toContain("- Closed task T-002 did not deliver its acceptance criteria")
      expect(handover).toContain("- The phase's gates were skipped, not checked: acceptance.")
      expect(handover).toContain("- docs/T-001/ (done)")
      expect(handover).toContain(`- docs/T-002/ (closed: ${REASON})`)
      expect(handover).toContain("- docs/T-001/report.md")
      // The body records the phase with its skipped gates.
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Units closed:\n- T-002\n- R-01.P01 (gates skipped: acceptance)")
      // The next phase becomes current.
      const state = await readPhases(dir)
      expect(state!.done.has("P01")).toBe(true)
      expect(state!.closed.get("P01")).toBe(REASON)
    }),
  )

  test(
    "a valid existing handover is kept; an invalid partial one is replaced",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      const valid = HANDOVER_SECTIONS.map((section) => `${section}\n\ncontent\n`).join("")
      await Bun.write(join(dir, "docs/R-01/P01-analysis/handover.md"), valid)
      await commitAll(dir)
      const kept = await close(dir, "R-01.P01")
      expect(kept.type).toBe("closed")
      expect(kept.lines).not.toContain("ℹ mechanical handover written: docs/R-01/P01-analysis/handover.md")
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/handover.md")).text()).toBe(valid)
    }),
  )

  test(
    "a phase after the current one may be closed ahead of time",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [, implement] = await phasesOf(dir)
      await listTasks(dir, implement!, [{ id: "T-001" }])
      await commitAll(dir)
      const result = await close(dir, "R-01.P02")
      expect(result.type).toBe("closed")
      expect(await exists(dir, "docs/R-01/P02-implement/done.md")).toBe(true)
      expect(await exists(dir, "docs/T-001/done.md")).toBe(true)
      // The earlier phase stays open and current.
      const state = await readPhases(dir)
      expect([...state!.done]).toEqual(["P02"])
    }),
  )

  test(
    "an interrupted distillation's partial handover is replaced",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await Bun.write(join(dir, "docs/R-01/P01-analysis/handover.md"), "## Key decisions\n\nhalf-written\n")
      await commitAll(dir)
      const replaced = await close(dir, "R-01.P01")
      expect(replaced.type).toBe("closed")
      expect(replaced.lines).toContain("ℹ mechanical handover written: docs/R-01/P01-analysis/handover.md")
      expect(validHandover(await Bun.file(join(dir, "docs/R-01/P01-analysis/handover.md")).text())).toBe(true)
    }),
  )

  test(
    "a round closes through its open phases and counts as complete",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amk" })
      const [analysis, implement] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001", done: true }])
      await listTasks(dir, implement!, [{ id: "T-002" }])
      await commitAll(dir)
      const result = await close(dir, "R-01")
      expect(result.type).toBe("closed")
      if (result.type !== "closed") return
      expect(result.lines).toContain("✓ round R-01 counts as complete (its open phases were closed above)")
      const state = await readPhases(dir)
      expect([...state!.done].sort()).toEqual(["P01", "P02", "P03"])
      expect(await exists(dir, "docs/T-002/done.md")).toBe(true)
      expect(await exists(dir, "docs/R-01/P03-knowledge/done.md")).toBe(true)
      expect((await loadPlan(dir, implement!)).tasks.find((task) => task.id === "T-002")!.closed).toBe(REASON)
      expect(await git(dir, "status", "--porcelain")).toBe("")
    }),
  )
})

describe("closeUnit: dependents (D17)", () => {
  test(
    "an explicit dependent refuses the close before any write; cascade closes it with the marked reason",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }, { id: "T-002", depends: "T-001" }, { id: "T-003", depends: "T-002" }])
      await commitAll(dir)
      const before = await head(dir)
      const refused = await close(dir, "T-001")
      expect(refused).toEqual({
        type: "refused",
        lines: ["T-002 depends on T-001 (Depends:); pass --cascade to close it too, or change its Depends: first"],
      })
      expect(await head(dir)).toBe(before)
      expect(await git(dir, "status", "--porcelain")).toBe("")
      expect(await exists(dir, "docs/T-001/todo.md")).toBe(true)
      // Cascade reaches the fixpoint (T-003 depends on the cascaded T-002).
      const cascaded = await close(dir, "T-001", { cascade: true })
      expect(cascaded.type).toBe("closed")
      if (cascaded.type !== "closed") return
      expect(cascaded.lines[0]).toBe(`✓ closed T-001: ${REASON}`)
      expect(cascaded.lines[1]).toBe(`✓ closed T-002: ${REASON} (cascade from T-001)`)
      expect(cascaded.lines[2]).toBe(`✓ closed T-003: ${REASON} (cascade from T-002)`)
      expect(await Bun.file(join(dir, "docs/T-002/done.md")).text()).toContain(`Closed: ${REASON} (cascade from T-001)`)
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("- T-001\n- T-002 (cascade from T-001)\n- T-003 (cascade from T-002)")
    }),
  )

  test(
    "an implicit dependent (no Depends: field) is satisfied and named in the output",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }, { id: "T-002" }])
      await commitAll(dir)
      const result = await close(dir, "T-001")
      expect(result.type).toBe("closed")
      if (result.type !== "closed") return
      expect(result.lines).toContain(
        "ℹ T-002 has no Depends: field, so its prerequisite T-001 counts as satisfied; do not assume T-001's deliverables exist",
      )
      expect(await exists(dir, "docs/T-002/todo.md")).toBe(true)
    }),
  )
})

describe("closeUnit: refusals before any write (D17)", () => {
  test(
    "done and already-closed units, other rounds, subtasks and malformed refs",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001", done: true }, { id: "T-002" }])
      await commitAll(dir)
      expect(await close(dir, "T-001")).toEqual({ type: "refused", lines: ["T-001 is already done"] })
      const closed = await close(dir, "T-002")
      expect(closed.type).toBe("closed")
      expect(await close(dir, "T-002")).toEqual({ type: "refused", lines: [`T-002 is already closed: ${REASON}`] })
      expect(await close(dir, "R-02")).toEqual({
        type: "refused",
        lines: ["R-02 belongs to another round; the current round is R-01"],
      })
      expect(await close(dir, "T-002.S01")).toEqual({
        type: "refused",
        lines: ["T-002.S01: subtasks are not closed on their own; close the task T-002 instead"],
      })
      expect(await close(dir, "P01")).toEqual({
        type: "refused",
        lines: ["P01: not a unit reference; expected a round R-NN, a phase R-NN.P<nn> or a task T-NNN"],
      })
      expect(await closeUnit(dir, "T-001", { reason: "", phases: "am" })).toEqual({
        type: "refused",
        lines: ["the close reason is required and must be a non-empty single line"],
      })
      expect(await closeUnit(dir, "T-001", { reason: "two\nlines", phases: "am" })).toEqual({
        type: "refused",
        lines: ["the close reason must be one line (it is the Closed: value and the commit subject's tail)"],
      })
      // A round whose phases are all done is itself done.
      const round = await close(dir, "R-01")
      expect(round.type).toBe("closed")
      const done = await close(dir, "R-01")
      expect(done.type).toBe("refused")
      if (done.type === "refused") expect(done.lines[0]).toBe("R-01 is already complete (every phase is done)")
    }),
  )

  test(
    "a task of another round and an unlisted task are refused",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      // Hand-build a second, current round whose index lists nothing.
      mkdirSync(join(dir, "docs/R-02/P01-implement"), { recursive: true })
      await Bun.write(join(dir, "docs/R-02/phases.md"), "# Phases (R-02)\n\n- [ ] P01 implement\n")
      await Bun.write(join(dir, "docs/R-02/P01-implement/todo.md"), "# R-02.P01: implement\n\nType: implement\n\n<!-- auto: eof -->\n")
      await commitAll(dir)
      expect(await close(dir, "T-001")).toEqual({
        type: "refused",
        lines: ["T-001 is a task of round R-01, not the current round R-02"],
      })
      expect(await close(dir, "T-009")).toEqual({
        type: "refused",
        lines: ["T-009 is not listed in any phase index of round R-02"],
      })
    }),
  )
})

describe("closeUnit: dirty tree (D20)", () => {
  test(
    "changes beyond driver state refuse the close; driver-state leftovers fold into the close commit",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await commitAll(dir)
      writeFileSync(join(dir, "notes.txt"), "human edit\n")
      const before = await head(dir)
      const refused = await close(dir, "T-001")
      expect(refused).toEqual({
        type: "refused",
        lines: ["⏸ the worktree has changes beyond the driver's own state files; commit or stash them first, or pass a change option:", "  notes.txt"],
      })
      expect(await head(dir)).toBe(before)
      expect(await exists(dir, "docs/T-001/todo.md")).toBe(true)
      // Driver-state leftovers (here the retired CURRENT.md mirror an earlier
      // release left, git.ts DRIVER_STATE) fold silently.
      rmSync(join(dir, "notes.txt"))
      writeFileSync(join(dir, "CURRENT.md"), "# Current task (maintained by opencode-auto, do not edit manually)\n\n## T-001: task T-001 [pending]\n")
      const folded = await close(dir, "T-001")
      expect(folded.type).toBe("closed")
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Changes folded into this commit:\n- CURRENT.md")
      expect(await git(dir, "status", "--porcelain")).toBe("")
    }),
  )

  test(
    "changes: commit folds the human changes into the close commit and lists them in its body",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await commitAll(dir)
      writeFileSync(join(dir, "notes.txt"), "human edit\n")
      const result = await close(dir, "T-001", { changes: "commit" })
      expect(result.type).toBe("closed")
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Changes folded into this commit:\n- notes.txt")
      expect(await Bun.file(join(dir, "notes.txt")).text()).toBe("human edit\n")
      expect(await git(dir, "status", "--porcelain")).toBe("")
    }),
  )

  test(
    "changes: stash stashes every root first and the body names the stash",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await commitAll(dir)
      writeFileSync(join(dir, "notes.txt"), "human edit\n")
      writeFileSync(join(dir, "CURRENT.md"), "# Current task (maintained by opencode-auto, do not edit manually)\n\n## T-001: task T-001 [pending]\n")
      const result = await close(dir, "T-001", { changes: "stash" })
      expect(result.type).toBe("closed")
      if (result.type !== "closed") return
      const stash = (await git(dir, "stash", "list")).trim()
      expect(stash).toContain("opencode-auto close T-001")
      expect(result.lines.some((line) => line.startsWith("↻ stashed changes (.: stash@{0}: ") && line.includes("opencode-auto close T-001"))).toBe(true)
      expect(await exists(dir, "notes.txt")).toBe(false)
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Changes stashed before closing:")
      expect(message).toContain("opencode-auto close T-001")
      // Everything dirty went to the stash (leftovers included), so the body
      // claims nothing as folded.
      expect(message).not.toContain("Changes folded into this commit")
      expect(await git(dir, "status", "--porcelain")).toBe("")
    }),
  )
})

describe("closeUnit: records cleared only for closed units (D19)", () => {
  test(
    "units.json, progress.json, handover.json and the handover chains of the closed task",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }, { id: "T-002", depends: "none" }])
      // Seed the records: both tasks have runtime state; the closed one owns
      // the progress, the handover record and the handoff chains.
      await Bun.write(
        join(dir, ".auto/units.json"),
        JSON.stringify({ tasks: { "T-001": { status: "blocked", attempts: 2 }, "T-002": { status: "in_progress", attempts: 1 } } }, null, 2) + "\n",
      )
      await Bun.write(join(dir, ".auto/progress.json"), JSON.stringify({ task: "T-001", at: 1, active: true, phase: { kind: "whole" } }))
      await Bun.write(join(dir, ".auto/handover.json"), JSON.stringify({ task: "T-001", scope: "docs/T-001/testhandoff.md", unit: "T-001", n: 1 }))
      await Bun.write(join(dir, "docs/T-001/handoff.md"), "# handoff\n\nStatus: continue\n")
      await Bun.write(join(dir, "docs/T-001/testhandoff.md"), "# test handoff\n\nStatus: continue\n")
      await Bun.write(join(dir, "docs/T-001/testhandoff-1.md"), "# archived\n\nStatus: continue\n")
      await Bun.write(join(dir, "docs/T-001/S01/testhandoff.md"), "# subtask test handoff\n\nStatus: continue\n")
      await commitAll(dir)
      const result = await close(dir, "T-001")
      expect(result.type).toBe("closed")
      // Runtime entries: only the open task's survive.
      expect(JSON.parse(await Bun.file(join(dir, ".auto/units.json")).text())).toEqual({ tasks: { "T-002": { status: "in_progress", attempts: 1 } } })
      // The closed task's resumable records are gone.
      expect(await exists(dir, ".auto/progress.json")).toBe(false)
      expect(await exists(dir, ".auto/handover.json")).toBe(false)
      for (const file of ["docs/T-001/handoff.md", "docs/T-001/testhandoff.md", "docs/T-001/testhandoff-1.md", "docs/T-001/S01/testhandoff.md"]) {
        expect(await exists(dir, file)).toBe(false)
      }
      // The deletions of the tracked files land in the close commit.
      const changed = await git(dir, "show", "--name-only", "--pretty=format:", "HEAD")
      for (const file of ["docs/T-001/handoff.md", "docs/T-001/testhandoff.md", "docs/T-001/testhandoff-1.md", "docs/T-001/S01/testhandoff.md"]) {
        expect(changed).toContain(file)
      }
      expect(await git(dir, "status", "--porcelain")).toBe("")
    }),
  )

  test(
    "records of units that stay open are kept, including a step record of another phase",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis, implement] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await listTasks(dir, implement!, [{ id: "T-002" }])
      await Bun.write(
        join(dir, ".auto/units.json"),
        JSON.stringify({ tasks: { "T-001": { status: "in_progress", attempts: 3 }, "T-002": { status: "blocked" } } }, null, 2) + "\n",
      )
      await Bun.write(
        join(dir, ".auto/progress.json"),
        JSON.stringify({ task: "T-002", at: 2, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P02" } }),
      )
      await commitAll(dir)
      const result = await close(dir, "T-001")
      expect(result.type).toBe("closed")
      expect(JSON.parse(await Bun.file(join(dir, ".auto/units.json")).text())).toEqual({ tasks: { "T-002": { status: "blocked" } } })
      expect(await exists(dir, ".auto/progress.json")).toBe(true)
      // A step record of the closed phase itself is cleared.
      await Bun.write(
        join(dir, ".auto/progress.json"),
        JSON.stringify({ task: "PLAN", at: 3, active: true, phase: { kind: "step", step: "phase-handover", unit: "R-01.P01" } }),
      )
      const phaseClose = await close(dir, "R-01.P01")
      expect(phaseClose.type).toBe("closed")
      expect(await exists(dir, ".auto/progress.json")).toBe(false)
    }),
  )
})

describe("closeUnit: commit boundary (D21)", () => {
  test(
    "a failing close commit is a failure result; the units stay marked closed in the worktree",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await commitAll(dir)
      writeFileSync(join(dir, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n")
      chmodSync(join(dir, ".git/hooks/pre-commit"), 0o755)
      const result = await close(dir, "T-001")
      expect(result.type).toBe("failed")
      if (result.type !== "failed") return
      expect(result.lines.at(-1)).toContain("the close commit failed")
      expect(await exists(dir, "docs/T-001/done.md")).toBe(true)
      expect(await git(dir, "status", "--porcelain")).not.toBe("")
    }),
  )

  test(
    "a foreign commit inside the close range fails the close-out check",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await commitAll(dir)
      // The post-commit hook sneaks in a commit without the Auto-Stage trailer
      // right after the close commit (a pre-commit hook would break the outer
      // commit's HEAD lock). The foreign.txt guard stops the hook from
      // re-triggering on its own commit: --no-verify does not skip post-commit.
      writeFileSync(
        join(dir, ".git/hooks/post-commit"),
        "#!/bin/sh\nunset GIT_INDEX_FILE\nif [ -f foreign.txt ]; then exit 0; fi\necho foreign > foreign.txt\ngit add foreign.txt\ngit commit --no-verify -q -m 'foreign commit' -- foreign.txt\nexit 0\n",
      )
      chmodSync(join(dir, ".git/hooks/post-commit"), 0o755)
      const result = await close(dir, "T-001")
      expect(result.type).toBe("failed")
      if (result.type !== "failed") return
      expect(result.lines.at(-1)).toContain("the close commit landed but the close-out check failed")
      expect(result.lines.at(-1)).toContain("non-driver commit(s)")
      rmSync(join(dir, ".git/hooks/post-commit"))
      expect(await git(dir, "log", "--pretty=%s")).toContain("foreign commit")
    }),
  )

  test(
    "outside git the files are written and no commit is made",
    withDir(async (dir) => {
      const plain = mkdtempSync(join(tmpdir(), "auto-close-plain-"))
      try {
        await establishRound(plain, { phases: "am" })
        const [analysis] = (await readPhases(plain))!.phases
        await listTasks(plain, analysis!, [{ id: "T-001" }])
        const result = await close(plain, "T-001")
        expect(result.type).toBe("closed")
        if (result.type !== "closed") return
        expect(result.lines).toContain("ℹ not a git repository: the closing changes are written but not committed")
        expect(result.lines.some((line) => line.startsWith("to undo"))).toBe(false)
        expect(await exists(plain, "docs/T-001/done.md")).toBe(true)
      } finally {
        rmSync(plain, { recursive: true, force: true })
      }
    }),
  )
})

describe("closeUnit: undo (D30)", () => {
  test(
    "git revert of the close commit restores the pending state",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await commitAll(dir)
      const result = await close(dir, "T-001")
      expect(result.type).toBe("closed")
      await git(dir, "revert", "--no-edit", "HEAD")
      expect(await exists(dir, "docs/T-001/todo.md")).toBe(true)
      expect(await exists(dir, "docs/T-001/done.md")).toBe(false)
      const plan = await loadPlan(dir, analysis!)
      expect(plan.tasks.find((task) => task.id === "T-001")!.status).toBe("pending")
      expect(plan.tasks.find((task) => task.id === "T-001")!.closed).toBeUndefined()
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("- [ ] T-001 task T-001")
    }),
  )

  test(
    "git revert of a phase close restores the phase and removes the mechanical handover",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "am" })
      const [analysis] = await phasesOf(dir)
      await listTasks(dir, analysis!, [{ id: "T-001" }])
      await commitAll(dir)
      expect((await close(dir, "R-01.P01")).type).toBe("closed")
      await git(dir, "revert", "--no-edit", "HEAD")
      expect(await exists(dir, "docs/R-01/P01-analysis/todo.md")).toBe(true)
      expect(await exists(dir, "docs/R-01/P01-analysis/handover.md")).toBe(false)
      expect(await exists(dir, "docs/T-001/todo.md")).toBe(true)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis")
    }),
  )
})

describe("commitTree body (D21): byte compatibility", () => {
  // The stored message, byte-exact, via the raw commit object.
  const storedMessage = async (dir: string) => {
    const raw = await git(dir, "cat-file", "commit", "HEAD")
    return raw.slice(raw.indexOf("\n\n") + 2)
  }

  test(
    "without a body the message keeps its exact shape; with one it sits between subject and trailers",
    withDir(async (dir) => {
      const task = { id: "T-001", title: "t" }
      await Bun.write(join(dir, "a.txt"), "a\n")
      await commitTree(dir, task, { stage: "execute", subject: "plain" })
      expect(await storedMessage(dir)).toBe("plain\n\nAuto-Task: T-001\nAuto-Stage: execute\n")
      await Bun.write(join(dir, "b.txt"), "b\n")
      await commitTree(dir, task, { stage: "force-close", subject: "with body", body: "Units closed:\n- T-001\n" })
      expect(await storedMessage(dir)).toBe("with body\n\nUnits closed:\n- T-001\n\nAuto-Task: T-001\nAuto-Stage: force-close\n")
    }),
  )
})
