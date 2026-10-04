// The standalone work-order routes of plan's prelude (plans/0076, T-137):
// --export renders a ready unit's work order (constitution preamble + the
// whole-task session's prompt under the attended flag, stdout, nothing
// persisted), --adopt runs the driver half for the externally-driven unit —
// validation, the test handover (the idle loop's replacement), the ticks and
// renames, the unified commit with the Auto-Stage trailer. Fixtures in the
// plan.test.ts shape: an established m-mode round whose phase lists tasks,
// the worktree states simulated by hand (a standalone session writes files
// and commits nothing — the constitution forbids it).
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderConstitutionPreamble } from "../src/agents-block"
import { planPrelude } from "../src/plan"
import { establishRound, phaseKey, readPhases, type PhaseUnit } from "../src/phases"
import { loadPlan, renderTaskIndex } from "../src/tasks"
import { workOrder } from "../src/work-order"

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-order-"))
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

const read = async (dir: string, path: string) => Bun.file(join(dir, path)).text()

// One task document: the title/Phase head seedUnits writes, an optional
// field block (Depends: …) and body, terminator closed.
const taskDoc = (id: string, fields: string[] = [], body = "The body.") =>
  [`# ${id}: task ${id}`, "Phase: R-01.P01", ...fields, "", body, "", "<!-- auto: eof -->", ""].join("\n")

// An established m-mode round whose single phase lists the given tasks
// (done ones with done.md), everything committed.
async function fixture(dir: string, tasks: Array<{ id: string; done?: boolean; depends?: string[] }>): Promise<PhaseUnit> {
  await establishRound(dir, { phases: "m" })
  const phase = (await readPhases(dir))!.phases[0]!
  await Bun.write(
    join(dir, phase.dir, "tasks.md"),
    renderTaskIndex("R-01.P01", tasks.map((task) => ({ id: task.id, title: `task ${task.id}`, done: task.done }))),
  )
  for (const task of tasks) {
    mkdirSync(join(dir, "docs", task.id), { recursive: true })
    await Bun.write(join(dir, "docs", task.id, task.done ? "done.md" : "todo.md"), taskDoc(task.id, task.depends ? [`Depends: ${task.depends.join(", ")}`] : []))
  }
  await commitAll(dir)
  return phase
}

// The work a standalone session leaves: the report above all (long enough
// to clear the doc-shape non-triviality threshold), nothing committed (a
// source change beside it in each test).
const SESSION_REPORT = [
  "# T-002 report",
  "",
  "The work landed: the feature module, its consumers and the reading-back verification of every touched path.",
  "",
  "Result: PASS",
  "",
  "<!-- auto: eof -->",
  "",
].join("\n")

describe("planPrelude: --export (row 12, plans/0076)", () => {
  test(
    "renders the ready unit's work order: constitution preamble + the whole-task prompt, attended questions, stdout only",
    withDir(async (dir) => {
      const phase = await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
        { id: "T-003", depends: ["T-002"] },
      ])
      const result = await planPrelude(dir, { phases: "m", export: "T-002" })
      expect(result.type).toBe("stop")
      if (result.type !== "stop") return
      expect(result.code).toBe(0)
      expect(result.lines).toHaveLength(1)
      const order = result.lines[0]!
      // The order opens with the full constitution (the single source's
      // second rendering) — POINTER, COMMIT/SUMMARY/REFS; TEST_PRINCIPLE
      // only under testByDriver, which is off here.
      expect(order.startsWith(renderConstitutionPreamble())).toBe(true)
      expect(order).toContain("Commit principle:")
      expect(order).toContain("Summary principle:")
      expect(order).toContain("Reference and storage conventions")
      expect(order).not.toContain("Test principle:")
      // Then the whole-task session's prompt for the same unit: the task
      // block, the lead's protocol under the default steer switch, and the
      // attended question branch (the person is at the keyboard) — never
      // the unattended proxy-answer instruction.
      expect(order).toContain("# T-002: task T-002")
      expect(order).toContain("Context-budget protocol")
      expect(order).toContain("a human is attending this planning run and the DRIVER waits for the answer with no timeout")
      expect(order).not.toContain("do not call the question tool")
      // A template's own trailing terminator line is file metadata (loading
      // strips it), so the order ends with the prompt's last body text.
      expect(order.trimEnd().endsWith("and you finish the task yourself.")).toBe(true)
      // Byte-identical to the module's own composition over the same plan —
      // the prelude adds nothing of its own to the bytes.
      const plan = await loadPlan(dir, { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" })
      expect(order).toBe(await workOrder(dir, plan, plan.tasks[1]!, { phase: phaseKey(phase) }))
    }),
  )

  test(
    "any ready unit, not just leaves: a unit others depend on is exportable (ruling 4)",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
        { id: "T-003", depends: ["T-002"] },
      ])
      const result = await planPrelude(dir, { phases: "m", export: "T-002" })
      expect(result.type === "stop" && result.code).toBe(0)
    }),
  )

  test(
    "refuses a unit whose prerequisites are not done, a done unit, an unlisted unit",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
        { id: "T-003", depends: ["T-002"] },
      ])
      const notReady = await planPrelude(dir, { phases: "m", export: "T-003" })
      expect(notReady.type === "stop" && notReady.code).toBe(1)
      expect(notReady.type === "stop" && notReady.lines[0]).toContain("T-003 is not ready: T-002 is not done yet")
      const done = await planPrelude(dir, { phases: "m", export: "T-001" })
      expect(done.type === "stop" && done.code).toBe(1)
      expect(done.type === "stop" && done.lines[0]).toContain("T-001 is already done")
      const missing = await planPrelude(dir, { phases: "m", export: "T-009" })
      expect(missing.type === "stop" && missing.code).toBe(1)
      expect(missing.type === "stop" && missing.lines[0]).toContain("T-009 is not listed in docs/R-01/P01-implement/tasks.md")
    }),
  )
})

describe("planPrelude: --adopt (row 13, plans/0076)", () => {
  test(
    "validates, runs the test handover, ticks and renames, commits with the Auto-Stage trailer",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
      ])
      // The standalone session's work: source, report, and its test request.
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "feature.ts"), "export const feature = 1\n")
      await Bun.write(join(dir, "docs", "T-002", "report.md"), SESSION_REPORT)
      mkdirSync(join(dir, "test"), { recursive: true })
      await Bun.write(join(dir, "test", "check.sh"), "echo checking\n")
      mkdirSync(join(dir, "tmp"), { recursive: true })
      await Bun.write(join(dir, "tmp", "test.sh"), "test/check.sh\n")
      const headBefore = (await git(dir, "rev-parse", "HEAD")).trim()
      const result = await planPrelude(dir, { phases: "m", adopt: "T-002" })
      expect(result.type).toBe("stop")
      if (result.type !== "stop") return
      expect(result.code).toBe(0)
      // The test handover ran (the idle loop's replacement): the marker was
      // consumed, the output archived, the result reported back.
      expect(await Bun.file(join(dir, "tmp", "test.sh")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "tmp", "test.1.out")).exists()).toBe(true)
      expect(await read(dir, "tmp/test.1.out")).toBe("checking\n")
      expect(result.lines.some((line) => line.includes("test handover executed (exit code 0)") && line.includes("tmp/test.1.out"))).toBe(true)
      // The ticks and the rename.
      expect(await Bun.file(join(dir, "docs", "T-002", "done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs", "T-002", "todo.md")).exists()).toBe(false)
      expect(await read(dir, "docs/R-01/P01-implement/tasks.md")).toContain("- [x] T-002")
      // The unified commit with the Auto-Stage trailer, and the session's
      // work swept into it.
      const head = (await git(dir, "rev-parse", "HEAD")).trim()
      expect(head).not.toBe(headBefore)
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("T-002 done task T-002")
      expect(message).toContain("Auto-Stage: done")
      const changed = await git(dir, "diff", "--name-only", headBefore, head)
      expect(changed).toContain("src/feature.ts")
      expect(changed).toContain("docs/T-002/report.md")
      expect(result.lines.some((line) => line.startsWith("✓ T-002 adopted"))).toBe(true)
    }),
  )

  test(
    "a failing validation blocks with no writes: a truncated report keeps todo.md, the tick and HEAD",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
      ])
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "feature.ts"), "export const feature = 1\n")
      // No terminator on the report: the eof scan must catch it.
      await Bun.write(join(dir, "docs", "T-002", "report.md"), "# T-002 report\n\nThe work landed and was verified by reading it back.\n\nResult: PASS\n")
      const headBefore = (await git(dir, "rev-parse", "HEAD")).trim()
      const result = await planPrelude(dir, { phases: "m", adopt: "T-002" })
      expect(result.type).toBe("stop")
      if (result.type !== "stop") return
      expect(result.code).toBe(1)
      expect(result.lines[0]).toContain("T-002 adopt blocked")
      expect(result.lines[0]).toContain("docs/T-002/report.md: missing last-line terminator")
      expect(await Bun.file(join(dir, "docs", "T-002", "todo.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs", "T-002", "done.md")).exists()).toBe(false)
      expect(await read(dir, "docs/R-01/P01-implement/tasks.md")).toContain("- [ ] T-002")
      expect((await git(dir, "rev-parse", "HEAD")).trim()).toBe(headBefore)
    }),
  )

  test(
    "a Result: FAIL report line blocks the adopt; so does zero disk writes (the hand-committed shape)",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
      ])
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "feature.ts"), "export const feature = 1\n")
      await Bun.write(
        join(dir, "docs", "T-002", "report.md"),
        ["# T-002 report", "", "The verification failed and the gap is not closed.", "", "Result: FAIL the checks do not pass", "", "<!-- auto: eof -->", ""].join("\n"),
      )
      const failed = await planPrelude(dir, { phases: "m", adopt: "T-002" })
      expect(failed.type === "stop" && failed.code).toBe(1)
      expect(failed.type === "stop" && failed.lines[0]).toContain("the task report concluded Result: FAIL (the checks do not pass)")
      expect(await Bun.file(join(dir, "docs", "T-002", "todo.md")).exists()).toBe(true)
      // Zero writes: nothing left to adopt — the exact shape of a session
      // whose work was hand-committed before the adopt (the break the
      // SHA-baseline audit exists for).
      await Bun.write(join(dir, "docs", "T-002", "report.md"), SESSION_REPORT)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "hand commit of the session's work")
      const quiet = await planPrelude(dir, { phases: "m", adopt: "T-002" })
      expect(quiet.type === "stop" && quiet.code).toBe(1)
      expect(quiet.type === "stop" && quiet.lines[0]).toContain("no changes relative to HEAD (the standalone session left nothing to adopt)")
      expect(await Bun.file(join(dir, "docs", "T-002", "todo.md")).exists()).toBe(true)
    }),
  )

  test(
    "the P1 scan blocks process-document references in deliverable files; readiness is re-checked at adopt",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
        { id: "T-003", depends: ["T-002"] },
      ])
      // Readiness first: T-003's prerequisite is pending — the export may
      // have aged, adopt re-derives.
      const notReady = await planPrelude(dir, { phases: "m", adopt: "T-003" })
      expect(notReady.type === "stop" && notReady.code).toBe(1)
      expect(notReady.type === "stop" && notReady.lines[0]).toContain("T-003 is not ready: T-002 is not done yet")
      // A deliverable file referencing a process document.
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "feature.ts"), "// see docs/T-002/report.md for the rationale\nexport const feature = 1\n")
      await Bun.write(join(dir, "docs", "T-002", "report.md"), SESSION_REPORT)
      const blocked = await planPrelude(dir, { phases: "m", adopt: "T-002" })
      expect(blocked.type === "stop" && blocked.code).toBe(1)
      expect(blocked.type === "stop" && blocked.lines[0]).toContain("src/feature.ts:1 references")
      expect(await Bun.file(join(dir, "docs", "T-002", "todo.md")).exists()).toBe(true)
    }),
  )

  test(
    "the test handover executes and reports even when the validation then blocks (the session's last request is never stranded)",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
      ])
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "feature.ts"), "// see docs/T-001/done.md\nexport const feature = 1\n")
      mkdirSync(join(dir, "test"), { recursive: true })
      await Bun.write(join(dir, "test", "check.sh"), "exit 3\n")
      mkdirSync(join(dir, "tmp"), { recursive: true })
      await Bun.write(join(dir, "tmp", "test.sh"), "test/check.sh\n")
      const result = await planPrelude(dir, { phases: "m", adopt: "T-002" })
      expect(result.type).toBe("stop")
      if (result.type !== "stop") return
      expect(result.code).toBe(1)
      // The blocked lines still carry the executed test handover's report,
      // and the marker was consumed either way.
      expect(result.lines[0]).toContain("test handover executed (exit code 3)")
      expect(await Bun.file(join(dir, "tmp", "test.sh")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs", "T-002", "todo.md")).exists()).toBe(true)
    }),
  )

  test(
    "the mutual exclusions: export and adopt together, and the planning input under either, are refused",
    withDir(async (dir) => {
      await fixture(dir, [
        { id: "T-001", done: true },
        { id: "T-002" },
      ])
      const both = await planPrelude(dir, { phases: "m", export: "T-002", adopt: "T-002" })
      expect(both.type === "stop" && both.code).toBe(1)
      expect(both.type === "stop" && both.lines[0]).toContain("--export and --adopt are mutually exclusive")
      const withInput = await planPrelude(dir, { phases: "m", adopt: "T-002", input: { text: "plan more" } })
      expect(withInput.type === "stop" && withInput.code).toBe(1)
      expect(withInput.type === "stop" && withInput.lines[0]).toContain("--export / --adopt take only a task id")
    }),
  )

  test(
    "an unestablished round refuses the work-order routes instead of establishing one (the row-1 gate)",
    withDir(async (dir) => {
      const result = await planPrelude(dir, { phases: "m", export: "T-001" })
      expect(result.type === "stop" && result.code).toBe(1)
      expect(result.type === "stop" && result.lines[0]).toContain("round R-01 is not established yet")
      expect(existsSync(join(dir, "docs", "R-01"))).toBe(false)
    }),
  )
})
