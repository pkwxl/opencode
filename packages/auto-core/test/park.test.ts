// The dependency park (plans/0096 D6/D7, Stage 4): the whole-task session's
// third handoff status `Status: park <blocker task id>` — the directive's
// parse (checked before handoffStatus so the park line is never the
// unrecognized-line case, and deliberately is it under the kill switch), the
// parked runtime record, the effective-done readiness at the pick (parked
// counts done for successors, not selectable while blocked, releasable when
// the blocker's done.md exists — person-closed and FAIL-closed included),
// the artifact-gated park validity (the one relaunch with feedback; the
// no-artifacts prose gate), the park commit's landing shape and the
// close-out trailer accepting it, the release note with the re-merge
// surface (the blocker's changed paths ∩ the parked task's Touches:), the
// mutual-park block (exit 2 naming the pair) and the nonexistent-id park as
// a collect problem. The end-to-end halves run on the native fake agent
// over real git repositories (the loop harness); the pure halves in memory.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionChain } from "../src/chain"
import { executeWhole } from "../src/execute"
import { noCommitGit } from "../src/git-ops"
import { unitBaseline, unitViolations } from "../src/git"
import { loadPlan, next, runtimeParked, setParked, strandedParks, withParked, type Task } from "../src/tasks"
import { unitProblems } from "../src/document/unit"
import { handoffStatus, parkDirective } from "../src/document/roles"
import { clampSwitches, SWITCH_ENV } from "../src/switches"
import { ev, fakeAgent, type FakeAgentOptions, type TurnScript } from "./fixtures/agent"
import { planOf } from "./fixtures/units"
import { artifactTurns, loopFixture, phaseDirId, promptPhaseDir, taskDoc, type LoopFixture } from "./fixtures/loop"
import { establishRound } from "../src/phases"

// —— the directive's parse (pure) ——

describe("parkDirective (the park status line, plans/0096 D7)", () => {
  test("reads the last whole-line `Status: park <task id>` line; handoffStatus answers undefined for it (why the caller checks park first)", () => {
    expect(parkDirective("# Handover\n\nBlocked on T-002; resume after it lands.\n\nStatus: park T-002\n")).toBe("T-002")
    // The last one wins, like handoffStatus.
    expect(parkDirective("Status: park T-003\n\nlater note\n\nStatus: park T-002\n")).toBe("T-002")
    // A continue/done line is not a park directive (the engine's values).
    expect(parkDirective("Status: continue\n")).toBeUndefined()
    expect(parkDirective("Status: done\n")).toBeUndefined()
    // The park line leaves handoffStatus undefined — the exact case that
    // fires the invalid-handoff feedback when the directive is not consumed
    // first (and always, under the kill switch).
    expect(handoffStatus("Status: park T-002\n")).toBeUndefined()
  })

  test("malformed lines are no directive: no id, a non-task id, trailing prose, an unanchored mention", () => {
    expect(parkDirective("Status: park\n")).toBeUndefined()
    expect(parkDirective("Status: park T-2\n")).toBeUndefined()
    expect(parkDirective("Status: park S01\n")).toBeUndefined()
    expect(parkDirective("Status: park T-002 extra\n")).toBeUndefined()
    expect(parkDirective("the line to write is `Status: park T-002`\n")).toBeUndefined()
  })
})

// —— the record and the graph check (temp directories, no repository) ——

describe("the parked record (runtime state, never a document)", () => {
  test("setParked writes the blocker and drops the in_progress mark; runtimeParked reads it back; clearing removes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-park-"))
    try {
      await setParked(dir, "T-001", "T-002")
      const text = await Bun.file(join(dir, ".auto", "units.json")).text()
      expect(text).toContain('"parked": "T-002"')
      expect(text).not.toContain("in_progress")
      expect(await runtimeParked(dir, "T-001")).toBe("T-002")
      await setParked(dir, "T-001", undefined)
      expect(await runtimeParked(dir, "T-001")).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a park naming a nonexistent id is a collect problem (unitProblems' parked validation)", () => {
    const decls = [
      { id: "T-001", depends: "none" as const },
      { id: "T-002", depends: "none" as const },
    ]
    expect(unitProblems("task", decls, { parked: new Map([["T-001", "T-999"]]) })).toEqual(["T-001 parks on unknown T-999"])
    expect(unitProblems("task", decls, { parked: new Map([["T-001", "S01"]]) })).toEqual(['T-001 parks on "S01", which is not a task id (T-NNN)'])
    expect(unitProblems("task", decls, { parked: new Map([["T-001", "T-001"]]) })).toEqual(["T-001 parks on itself"])
    // A known blocker — own or external-done — passes the graph check.
    expect(unitProblems("task", decls, { parked: new Map([["T-001", "T-002"]]), external: new Set(["T-000"]) })).toEqual([])
    expect(unitProblems("task", decls, { parked: new Map([["T-001", "T-000"]]), external: new Set(["T-000"]) })).toEqual([])
  })
})

// —— effective readiness (in-memory plans) ——

const taskOf = (over: Partial<Task> & Pick<Task, "id">): Task => ({ title: over.id, status: "pending", attempts: 0, body: "", ...over })

describe("effective readiness (done ∪ parked at the pick)", () => {
  test("a parked unit counts as done for its successors and is not selectable while its blocker is undone (index-order default and explicit Depends alike)", () => {
    // T-002 parks on T-004; the index order's default deps would run T-003
    // after T-002 — the park releases T-003 without T-002 completing.
    const tasks = [
      taskOf({ id: "T-001", status: "done" }),
      taskOf({ id: "T-002", parked: "T-004" }),
      taskOf({ id: "T-003" }),
      taskOf({ id: "T-004" }),
    ]
    const plan = { ...planOf("", "."), tasks }
    expect(next(plan)!.id).toBe("T-003")
    // Explicit Depends: T-004 declares T-002 (the parked unit) — it selects
    // once T-003 closes; the parked T-002 itself stays unselectable.
    const explicit = [
      taskOf({ id: "T-001", status: "done" }),
      taskOf({ id: "T-002", parked: "T-004", depends: "none" }),
      taskOf({ id: "T-003", status: "done", depends: "none" }),
      taskOf({ id: "T-004", depends: ["T-002"] }),
    ]
    const explicitPlan = { ...planOf("", "."), tasks: explicit }
    expect(next(explicitPlan)!.id).toBe("T-004")
    // The parked unit never comes up while the blocker runs: with T-004 done
    // it is released (below); with the blocker undone it is in the done set.
    const effective = withParked(tasks, new Set(["T-001"]))
    expect(effective.has("T-002")).toBe(true)
  })

  test("releasable when the blocker's done.md exists — including a person-closed and a FAIL-closed blocker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-park-"))
    try {
      await mkdirSync(join(dir, "docs", "R-01", "P01-implement"), { recursive: true })
      await Bun.write(join(dir, "docs", "R-01", "P01-implement", "tasks.md"), "# Tasks (R-01.P01)\n\n- [ ] T-001 first\n- [ ] T-002 blocker\n")
      for (const id of ["T-001", "T-002"]) {
        await mkdirSync(join(dir, "docs", id), { recursive: true })
        await Bun.write(join(dir, "docs", id, "todo.md"), `# ${id}: ${id}\nPhase: R-01.P01\nDepends: none\n\n## Goal\n\nG.\n\n## Scope\n\nS.\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n`)
      }
      await mkdirSync(join(dir, ".auto"), { recursive: true })
      await Bun.write(join(dir, ".auto", "units.json"), `${JSON.stringify({ tasks: { "T-001": { parked: "T-002" } } }, null, 2)}\n`)
      const phase = { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" }
      // Not released while the blocker is undone: the pick skips T-001
      // (parked) and takes T-002.
      expect(next(await loadPlan(dir, phase))!.id).toBe("T-002")
      // The blocker closes FAIL-closed under --repair: done.md with a
      // Closed: field — done for scheduling, the reason recorded.
      const closed = `# T-002: T-002\nPhase: R-01.P01\nDepends: none\nClosed: repair round 1: the task report concluded Result: FAIL\n\n## Goal\n\nG.\n\n<!-- auto: eof -->\n`
      await Bun.write(join(dir, "docs", "T-002", "done.md"), closed)
      rmSync(join(dir, "docs", "T-002", "todo.md"))
      await Bun.write(join(dir, "docs", "R-01", "P01-implement", "tasks.md"), "# Tasks (R-01.P01)\n\n- [ ] T-001 first\n- [x] T-002 blocker\n")
      const released = await loadPlan(dir, phase)
      expect(next(released)!.id).toBe("T-001")
      expect(released.closed.get("T-002")).toContain("repair round 1")
      // The record is still on file — the release dispatch clears it.
      expect(released.tasks[0]!.parked).toBe("T-002")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("mutual parks leave nothing ready: strandedParks names the pair (the loops' exit-2 block)", () => {
    const tasks = [
      taskOf({ id: "T-001", parked: "T-002", depends: "none" }),
      taskOf({ id: "T-002", parked: "T-001", depends: "none" }),
    ]
    const plan = { ...planOf("", "."), tasks }
    expect(next(plan)).toBeUndefined()
    const stranded = strandedParks(plan)
    expect(stranded.map((unit) => unit.id)).toEqual(["T-001", "T-002"])
    // A chain resolves through the closure: T-001 on T-002, T-002 on T-003,
    // T-003 free — the pick runs T-003 and nothing is stranded.
    const chain = [
      taskOf({ id: "T-001", parked: "T-002", depends: "none" }),
      taskOf({ id: "T-002", parked: "T-003", depends: "none" }),
      taskOf({ id: "T-003", depends: "none" }),
    ]
    const chainPlan = { ...planOf("", "."), tasks: chain }
    expect(next(chainPlan)!.id).toBe("T-003")
    // The two waiting parks stand in strandedParks' answer (it is the dead
    // pick's check), but the pick still finds T-003 runnable — the block
    // fires only once nothing at all is ready.
    expect(strandedParks(chainPlan).map((unit) => unit.id)).toEqual(["T-001", "T-002"])
  })
})

// —— the park flow through executeWhole (fake agent, no-commit double) ——

const chainOf = (): SessionChain => ({ pct: 100, used: 0, at: 0 })

function twoTaskPlan(dir: string) {
  return planOf(
    `## T-001: first [pending]
Body.

## T-002: second [pending]
Body.
`,
    dir,
  )
}

async function wholeSetup(turn?: TurnScript) {
  const dir = await mkdtemp(join(tmpdir(), "auto-park-"))
  const plan = twoTaskPlan(dir)
  const agent = fakeAgent(turn ? { turn } : {})
  const writeHandoff = (text: string) => {
    mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
    writeFileSync(join(dir, "docs", "T-001", "handoff.md"), text)
  }
  return { dir, plan, task: plan.tasks[0]!, agent, chain: chainOf(), writeHandoff }
}

describe("executeWhole's park verdict (off mode reads it too; the kill switch off is the invalid-handoff case)", () => {
  const clean = (dir: string) => rmSync(dir, { recursive: true, force: true })
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) clean(dir)
  })

  test("off mode: a fresh park directive parks — one session, the parked record written, the parked outcome returned", async () => {
    const { dir, plan, task, agent, chain, writeHandoff } = await wholeSetup((ctx) => {
      if (ctx.n === 1) writeHandoff("# Parked\n\nBlocked on T-002's ledger; resume: consume docs/T-002/ledger.md.\n\nStatus: park T-002\n")
      return undefined
    })
    dirs.push(dir)
    const result = await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, false)
    expect(result).toEqual({ type: "parked", blocker: "T-002" })
    expect(agent.prompts).toHaveLength(1)
    // The park paragraph named the channel in the dispatch prompt.
    expect(agent.prompts[0]!.text).toContain("Status: park <blocker task id>")
    expect(await runtimeParked(dir, "T-001")).toBe("T-002")
  })

  test("OPENCODE_AUTO_PARK=off: the park line is the invalid-handoff case — the engine's one relaunch with feedback, then its hidden-blockage block (ondemand, steer on)", async () => {
    clampSwitches({ park: false })
    try {
      const { dir, plan, task, agent, chain, writeHandoff } = await wholeSetup((ctx) => {
        // Both sessions leave the park line standing: the directive is not
        // consumed, so the engine's invalid-handoff path runs to its end.
        writeHandoff("# Parked\n\nStatus: park T-002\n")
        return undefined
      })
      dirs.push(dir)
      const result = await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, true)
      // The invalid-handoff ladder verbatim: one relaunch with the hard
      // requirement, a second failure the hidden blockage.
      expect(result).toEqual({
        type: "blocked",
        question: expect.stringContaining("failed twice to produce a valid handover document"),
      })
      expect(agent.prompts).toHaveLength(2)
      expect(agent.prompts[1]!.text).toContain("This is a hard requirement")
      expect(await runtimeParked(dir, "T-001")).toBeUndefined()
    } finally {
      clampSwitches({ park: true })
    }
  })

  test("artifact-gated validity: a declaring task missing an artifact relaunches once with feedback; the no-artifacts task parks on the prose gate", async () => {
    const { dir, plan, task, agent, chain, writeHandoff } = await wholeSetup((ctx) => {
      if (ctx.n === 1) writeHandoff("# Parked\n\nStatus: park T-002\n")
      if (ctx.n === 2) {
        // The relaunch lands the declared artifact and parks again.
        writeFileSync(join(dir, "docs", "T-001", "api.md"), "# API\n\nThe consumable.\n\n<!-- auto: eof -->\n")
        writeHandoff("# Parked\n\nStatus: park T-002\n")
      }
      return undefined
    })
    dirs.push(dir)
    // The task document declares its consumable, which is not on disk yet.
    mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
    writeFileSync(
      join(dir, "docs", "T-001", "todo.md"),
      "# T-001: first\nPhase: R-01.P01\nArtifacts: docs/T-001/api.md\n\n## Goal\n\nG.\n\n## Scope\n\nS.\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n",
    )
    const result = await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, false)
    expect(result).toEqual({ type: "parked", blocker: "T-002" })
    expect(agent.prompts).toHaveLength(2)
    expect(agent.prompts[1]!.text).toContain("the park did not pass its checks")
    expect(agent.prompts[1]!.text).toContain("declared artifact docs/T-001/api.md does not exist")
    expect(await runtimeParked(dir, "T-001")).toBe("T-002")
  })

  test("a park naming an id outside the phase's index stops as a planning failure (thrown, exit 1's grammar)", async () => {
    const { dir, plan, task, agent, chain, writeHandoff } = await wholeSetup((ctx) => {
      if (ctx.n === 1) writeHandoff("# Parked\n\nStatus: park T-009\n")
      return undefined
    })
    dirs.push(dir)
    await expect(executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, false)).rejects.toThrow(
      /T-001 parked on T-009.*planning failure/s,
    )
    expect(await runtimeParked(dir, "T-001")).toBeUndefined()
  })

  test("a stale park line the released session did not rewrite is a natural finish, not a second park", async () => {
    // The released dispatch is seeded with the committed park handoff: the
    // session ends without touching it → natural (the record was already
    // cleared by the release), no park, no retry.
    const { dir, plan, task, agent, chain } = await wholeSetup()
    dirs.push(dir)
    mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
    writeFileSync(join(dir, "docs", "T-001", "handoff.md"), "# Parked\n\nStatus: park T-002\n")
    const seeded = { ...task, parked: "T-002" }
    const result = await executeWhole(agent.client, plan, seeded, { dir, git: noCommitGit() }, chain, false)
    expect(result).toBeUndefined()
    expect(agent.prompts).toHaveLength(1)
    // The release note rode the first dispatch.
    expect(agent.prompts[0]!.text).toContain("Release note — this task parked on T-002")
    expect(await runtimeParked(dir, "T-001")).toBeUndefined()
  })
})

// —— the park commit and the release note's re-merge surface (real git) ——

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

describe("the park commit and the release note (real repositories)", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function repo(dir: string) {
    await git(dir, "init", "-q")
    await Bun.write(join(dir, ".gitignore"), ".auto/\n")
    await mkdirSync(join(dir, "docs", "R-01", "P01-implement"), { recursive: true })
    await Bun.write(join(dir, "docs", "R-01", "P01-implement", "tasks.md"), "# Tasks (R-01.P01)\n\n- [ ] T-001 first\n- [ ] T-002 second\n")
    for (const id of ["T-001", "T-002"]) {
      await mkdirSync(join(dir, "docs", id), { recursive: true })
      await Bun.write(join(dir, "docs", id, "todo.md"), `# ${id}: ${id}\nPhase: R-01.P01\nDepends: none\n\n## Goal\n\nG.\n\n## Scope\n\nS.\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n`)
    }
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "setup")
    return { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" }
  }

  test("the park commit: subject `<id> park <title>`, Auto-Task and Auto-Stage: park, the handoff riding it; the close-out trailer set accepts it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-park-"))
    dirs.push(dir)
    const phase = await repo(dir)
    const baseline = await unitBaseline(dir)
    const agent = fakeAgent({
      turn: (ctx) => {
        if (ctx.n === 1) {
          mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
          writeFileSync(join(dir, "docs", "T-001", "handoff.md"), "# Parked\n\nBlocked on T-002; resume: read its ledger.\n\nStatus: park T-002\n")
        }
        return undefined
      },
    })
    const plan = await loadPlan(dir, phase)
    const result = await executeWhole(agent.client, plan, plan.tasks[0]!, { dir }, chainOf(), false)
    expect(result).toEqual({ type: "parked", blocker: "T-002" })
    const message = await git(dir, "log", "-1", "--pretty=%B")
    expect(message).toContain("T-001 park T-001")
    expect(message).toContain("Auto-Task: T-001")
    expect(message).toContain("Auto-Stage: park")
    // The handoff rides the park commit (committed content).
    expect(await git(dir, "show", "--name-only", "--pretty=", "HEAD")).toContain("docs/T-001/handoff.md")
    // The close-out's accepted trailer set: a park commit inside the unit's
    // range is legitimate protocol state (the Auto-Stage trailer passes).
    expect(await unitViolations(dir, baseline)).toEqual([])
  })

  test("the release note's re-merge surface: the blocker's changed paths ∩ the parked task's Touches:; a closed blocker names how it ended", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-park-"))
    dirs.push(dir)
    const phase = await repo(dir)
    // T-001 parks on T-002 (its document declares what it touches).
    await Bun.write(
      join(dir, "docs", "T-001", "todo.md"),
      "# T-001: first\nPhase: R-01.P01\nDepends: none\nTouches: src/shared.ts\n\n## Goal\n\nG.\n\n## Scope\n\nS.\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n",
    )
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "touches")
    const parking = fakeAgent({
      turn: (ctx) => {
        if (ctx.n === 1) {
          mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
          writeFileSync(join(dir, "docs", "T-001", "handoff.md"), "# Parked\n\nStatus: park T-002\n")
        }
        return undefined
      },
    })
    const plan1 = await loadPlan(dir, phase)
    expect(await executeWhole(parking.client, plan1, plan1.tasks[0]!, { dir }, chainOf(), false)).toEqual({ type: "parked", blocker: "T-002" })
    // The blocker runs and closes: it changes two files (one T-001 touches,
    // one it does not) and lands its done.md through the driver's commits.
    await mkdirSync(join(dir, "src"), { recursive: true })
    await Bun.write(join(dir, "src", "shared.ts"), "export const shared = 2\n")
    await Bun.write(join(dir, "docs", "T-002", "notes.md"), "# Notes\n\nn\n\n<!-- auto: eof -->\n")
    const { commitTree } = await import("../src/git")
    await commitTree(dir, { id: "T-002", title: "second" }, { stage: "execute", subject: "T-002 exec second" })
    await Bun.write(join(dir, "docs", "T-002", "done.md"), "# T-002: second\nPhase: R-01.P01\nDepends: none\nClosed: the person accepted the gap\n\n## Goal\n\nG.\n\n<!-- auto: eof -->\n")
    await rmSync(join(dir, "docs", "T-002", "todo.md"))
    await Bun.write(join(dir, "docs", "R-01", "P01-implement", "tasks.md"), "# Tasks (R-01.P01)\n\n- [ ] T-001 first\n- [x] T-002 second\n")
    await commitTree(dir, { id: "T-002", title: "second" }, { stage: "done", subject: "T-002 done second" })
    // The released dispatch: the note names the blocker, how it ended and
    // the re-merge surface (only the touched file — notes.md is filtered out).
    const plan2 = await loadPlan(dir, phase)
    expect(plan2.tasks[0]!.parked).toBe("T-002")
    const resuming = fakeAgent()
    const result = await executeWhole(resuming.client, plan2, plan2.tasks[0]!, { dir }, chainOf(), false)
    expect(result).toBeUndefined()
    expect(resuming.prompts[0]!.text).toContain("Release note — this task parked on T-002")
    expect(resuming.prompts[0]!.text).toContain("closed without completing (the person accepted the gap)")
    expect(resuming.prompts[0]!.text).toContain("- src/shared.ts")
    expect(resuming.prompts[0]!.text).not.toContain("docs/T-002/notes.md")
    // The record cleared at the release dispatch.
    expect(await runtimeParked(dir, "T-001")).toBeUndefined()
  })
})

// —— the end-to-end lifecycle through the phase loop (loop harness) ——
//
// The formulation task (0095) is T-001 itself, so the planned pair is
// T-002 / T-003: the formulation session's whole prompt is recognized by its
// todo's opening ("Formulate the"), the planning branch appends both tasks
// with `Depends: none` so each is selectable the moment the pick allows,
// and the wrap-ups pass through artifactTurns' verification branch. The
// lifecycle script parks T-002's first whole session on T-003; the mutual
// script parks each on the other.

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

// Plans the two tasks of this scenario (appended after the formulation
// line, like artifactTurns' planning branch); returns their ids.
const planTwo = (dir: string, phaseDir: string): [string, string] => {
  // promptPhaseDir's match already carries the docs/ prefix — the fixture's
  // phaseDirId reads the qualified id straight off it.
  const qualified = phaseDirId(phaseDir)
  const first = "T-002"
  const second = "T-003"
  const file = join(dir, phaseDir, "tasks.md")
  const current = existsSync(file) ? readFileSync(file, "utf8") : `# Tasks (${qualified})\n\n`
  if (!current.includes(`- [ ] ${first} `)) writeFileSync(file, `${current.endsWith("\n") ? current : `${current}\n`}- [ ] ${first} first\n- [ ] ${second} second\n`)
  for (const id of [first, second]) {
    mkdirSync(join(dir, "docs", id), { recursive: true })
    writeFileSync(join(dir, "docs", id, "todo.md"), taskDoc(id, qualified))
  }
  return [first, second]
}

const parkTurns = (dir: string): TurnScript => {
  const parkedOnce = new Set<string>()
  return (ctx) => {
    // The formulation session's whole prompt: the phase's task index path
    // AND the todo body's own "complete task plan" phrase — the index path
    // alone also appears in a release note's re-merge surface (the blocker
    // ticks the index), and the wrap-up embeds the same todo as its task
    // block (the wrap-up marker excludes that one).
    if (promptPhaseDir(ctx.text) !== undefined && ctx.text.includes("complete task plan") && !ctx.text.includes("only performs the wrap-up")) {
      const phaseDir = promptPhaseDir(ctx.text)
      if (phaseDir) planTwo(dir, phaseDir)
      return undefined
    }
    if (ctx.text.includes("Dependency park:")) {
      const id = /its document is docs\/(T-\d+)\/todo\.md/.exec(ctx.text)?.[1]
      if (id === "T-002" && !parkedOnce.has(id)) {
        parkedOnce.add(id)
        writeFileSync(join(dir, "docs", id, "handoff.md"), "# Parked\n\nBlocked on T-003's output; resume: consume it.\n\nStatus: park T-003\n")
        return undefined
      }
      if (id) {
        mkdirSync(join(dir, "docs", id), { recursive: true })
        writeFileSync(join(dir, "docs", id, "artifact.md"), `# ${id} artifact\n\nDone.\n\n<!-- auto: eof -->\n`)
      }
    }
    return artifactTurns(dir)(ctx)
  }
}

describe("the park through the phase loop (m mode, real repository)", () => {
  test("T-002 parks on T-003, T-003 completes, T-002 resumes with the release note and completes: code 0, all done, the park commit landed", async () => {
    const f = await loopFixture("m", (dir): FakeAgentOptions => ({ turn: parkTurns(dir) }))
    made.push(f)
    await establishRound(f.dir, { phases: "m" })
    await f.commit("round setup")
    const { code, lines } = await f.run({ planInput: { text: "migrate the widget" } })
    expect(code).toBe(0)
    // The park: the loop logged it, the park commit landed under its grammar.
    expect(lines.some((line) => line.includes("T-002 parked on T-003"))).toBe(true)
    const park = (await f.git("log", "--format=%s%x00%B%x00", "--grep=^T-002 park", "-z")).split("\0")
    expect(park.some((entry) => entry.includes("Auto-Stage: park"))).toBe(true)
    // The release: the resumed dispatch carried the note.
    expect(f.agent.prompts.some((prompt) => prompt.text.includes("Release note — this task parked on T-003"))).toBe(true)
    // Every unit completed — the formulation task, the parked-then-resumed
    // task and the blocker.
    expect(existsSync(join(f.dir, "docs/T-001/done.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-003/done.md"))).toBe(true)
  })

  test("mutual parks: nothing ready with parked units remaining — the run blocks (exit 2) naming the pair", async () => {
    const f = await loopFixture("m", (dir): FakeAgentOptions => ({ turn: mutualTurns(dir) }))
    made.push(f)
    await establishRound(f.dir, { phases: "m" })
    await f.commit("round setup")
    const { code, lines } = await f.run({ planInput: { text: "migrate the widget" } })
    expect(code).toBe(2)
    expect(lines.some((line) => line.includes("mutual park: T-002 parks on T-003, T-003 parks on T-002"))).toBe(true)
    expect(lines.some((line) => line.includes("nothing is ready with parked units remaining"))).toBe(true)
  })
})

// The mutual-park turn script: each planned task's whole session parks on
// the other.
const mutualTurns = (dir: string): TurnScript => (ctx) => {
  // The formulation session's whole prompt (the same guards as parkTurns').
  if (promptPhaseDir(ctx.text) !== undefined && ctx.text.includes("complete task plan") && !ctx.text.includes("only performs the wrap-up")) {
    const phaseDir = promptPhaseDir(ctx.text)
    if (phaseDir) planTwo(dir, phaseDir)
    return undefined
  }
  if (ctx.text.includes("Dependency park:")) {
    const id = /its document is docs\/(T-\d+)\/todo\.md/.exec(ctx.text)?.[1]
    if (id) {
      writeFileSync(join(dir, "docs", id, "handoff.md"), `# Parked\n\nBlocked the other way round.\n\nStatus: park ${id === "T-002" ? "T-003" : "T-002"}\n`)
    }
  }
  return artifactTurns(dir)(ctx)
}

// —— the plan-time inversion warn (D6, pure over a temp directory) ——

describe("inversionWarnings (the formulation collect's soft warn)", () => {
  test("a Scope referencing an artifact of a task that depends on it warns; the sound order does not", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-park-"))
    try {
      const phase = { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" }
      await mkdirSync(join(dir, phase.dir), { recursive: true })
      await Bun.write(join(dir, phase.dir, "tasks.md"), "# Tasks (R-01.P01)\n\n- [ ] T-001 consumer\n- [ ] T-002 producer\n")
      for (const [id, fields, scope] of [
        ["T-001", "", "Read docs/T-002/api.md and build on it."],
        ["T-002", "Depends: T-001\nArtifacts: docs/T-002/api.md", "Land the api."],
      ] as const) {
        await mkdirSync(join(dir, "docs", id), { recursive: true })
        await Bun.write(join(dir, "docs", id, "todo.md"), `# ${id}: ${id}\nPhase: R-01.P01${fields}\n\n## Goal\n\nG.\n\n## Scope\n\n${scope}\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n`)
      }
      const { inversionWarnings } = await import("../src/tasks")
      const warns = await inversionWarnings(dir, phase)
      expect(warns).toHaveLength(1)
      expect(warns[0]!).toContain("T-001's ## Scope references docs/T-002/api.md, an artifact of T-002, which depends on T-001")
      // The sound order (the producer first, the consumer depends on it) is
      // not an inversion — no warn.
      await Bun.write(join(dir, "docs", "T-002", "todo.md"), `# T-002: producer\nPhase: R-01.P01\nDepends: none\nArtifacts: docs/T-002/api.md\n\n## Goal\n\nG.\n\n## Scope\n\nLand the api.\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n`)
      await Bun.write(join(dir, "docs", "T-001", "todo.md"), `# T-001: consumer\nPhase: R-01.P01\nDepends: T-002\n\n## Goal\n\nG.\n\n## Scope\n\nRead docs/T-002/api.md and build on it.\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n`)
      expect(await inversionWarnings(dir, phase)).toEqual([])
    } finally {
      await rmSync(dir, { recursive: true, force: true })
    }
  })
})
