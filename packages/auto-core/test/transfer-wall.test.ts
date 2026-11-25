// Verify the wall and gate ordering through deterministic transfer. The
// sealing phase's work stands done by seed (the task loop retired,
// plans/0314): the advance under test is the person's alone.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { transferDeterministic } from "../src/transfer"
import { establishRound, readPhases } from "../src/phases"
import { findWallCommit } from "../src/wall"
import { saveProgress } from "../src/resume"
import { captureRun } from "./fixtures/capture"
import { donePhase, landPhaseHandover, loopFixture, type LoopFixture } from "./fixtures/loop"

const made: string[] = []
const fixtures: LoopFixture[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const fixture of fixtures.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

// The wall project: spec-read (the sealing phase, its door declared) then
// implement, the divergence lane declared green, the corpus behind a
// tracked root symlink with its stamped allow — the aster-mig shape, small.
// `gate` adds a Gate: line to the sealing type (plans/0189 D4's order test).
async function wallFixture(gate?: string): Promise<{ f: LoopFixture; corpus: string }> {
  const f = await loopFixture("spec-read,implement")
  fixtures.push(f)
  const corpus = mkdtempSync(join(tmpdir(), "auto-wall-advance-corpus-"))
  made.push(corpus)
  writeFileSync(join(corpus, "timer.c"), "void tick(void) {}\n")
  // This fixture keeps opencode.json in the pre-0138 local-only posture —
  // the byte-identical floor of plans/0190 D2 (the retirement write stays
  // out of the wall commit's pathspec, an ignored file `git add` would
  // refuse): the tracked-posture pins — the deny riding the wall commit —
  // live in wall.test.ts.
  await Bun.write(join(f.dir, ".gitignore"), ".auto/\ntmp/\nopencode.json\n")
  mkdirSync(join(f.dir, ".opencode/auto/phases"), { recursive: true })
  writeFileSync(
    join(f.dir, ".opencode/auto/phases/spec-read.md"),
    ["# Spec read", "", ...(gate ? [`Gate: ${gate}`] : []), "Wall: seal linux", "Phase-artifacts: spec-notes.md", "Task-artifacts: notes.md", "", "## plan duties", "", "Read the reference, distill the notes.", "", "<!-- auto: eof -->", ""].join("\n"),
  )
  mkdirSync(join(f.dir, ".opencode/auto/intents"), { recursive: true })
  // The pack keeps the default's result-line rule beside the lane row (an
  // override replaces the built-in wholesale).
  writeFileSync(
    join(f.dir, ".opencode/auto/intents/default.md"),
    [
      "# default",
      "",
      "## quality",
      "",
      "### test-lanes",
      "",
      "divergence:",
      "Command: true",
      "Cost: regression",
      "Surfaces: .",
      "Exclusive: no",
      "",
      "## acceptance",
      "",
      "### result-line",
      "",
      "Write it in every report: `Result: PASS` means every acceptance criterion the task asked for was actually observed to pass.",
      "",
    ].join("\n"),
  )
  symlinkSync(corpus, join(f.dir, "linux"))
  await Bun.write(join(f.dir, "opencode.json"), JSON.stringify({ permission: { external_directory: { [`${corpus}/**`]: "allow" } } }, null, 2) + "\n")
  // The agent contract the round's scans read (the first transfer test's
  // shape).
  await Bun.write(join(f.dir, ".opencode/agent/auto.md"), "contract\n")
  await establishRound(f.dir, { phases: "spec-read,implement", round: 1 })
  await f.commit("wall project setup, door standing")
  return { f, corpus }
}

// The sealing phase's artifacts, written as its sessions would leave them
// (the fake agent writes the pipeline's documents, not the type's own
// artifacts): the consolidated spec-notes and the executed task's notes —
// the sealed channel.
async function sealArtifacts(f: LoopFixture): Promise<void> {
  const state = (await readPhases(f.dir, 1))!
  const specRead = state.phases.find((unit) => unit.type === "spec-read")!
  await Bun.write(join(f.dir, specRead.dir, "spec-notes.md"), "# Spec notes\n\nBehavior only.\n\n<!-- auto: eof -->\n")
  for (const name of await Array.fromAsync(new Bun.Glob("docs/T-*/done.md").scan({ cwd: f.dir }))) {
    const id = name.split("/")[1]!
    await Bun.write(join(f.dir, "docs", id, "notes.md"), `# Notes (${id})\n\nContracts at the boundary.\n\n<!-- auto: eof -->\n`)
  }
  await f.commit("the spec room's artifacts")
}

describe("transfer: the sealed wall closes at the person's advance (plans/0132 D2)", () => {
  test("the three-step close rides the transition path: admission → wall commit → transition, the room going clean mid-advance", async () => {
    const { f, corpus } = await wallFixture()
    // P01-spec-read's work stands done at its clean end (seeded): the spec
    // room read lawfully, the door standing.
    await donePhase(f, await f.phase(0), ["T-001"])
    expect(existsSync(join(f.dir, "linux"))).toBe(true)
    await sealArtifacts(f)
    // Land the distill output before transfer runs the admission scan, seals
    // the wall, and commits the phase transition.
    await landPhaseHandover(f, await f.phase(0))
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "spec-read,implement" }))
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("sealed reference wall closed (P01-spec-read Spec read)"))).toBe(true)
    expect(existsSync(join(f.dir, "linux"))).toBe(false)
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(true)
    const record = await findWallCommit(f.dir)
    expect(record).toBeDefined()
    expect(record!.doors).toEqual([{ name: "linux", target: corpus }])
    expect(record!.sealed).toContain("docs/R-01/P01-spec-read/spec-notes.md")
    // The order (git log newest-first): the transition commit sits above
    // the wall commit, which sits above the admission's receipt commits.
    const subjects = (await f.git("log", "--format=%s")).split("\n")
    const wallAt = subjects.findIndex((s) => s.includes("PLAN wall close"))
    const transitionAt = subjects.findIndex((s) => s.includes("PLAN transition P01-spec-read"))
    expect(wallAt).toBeGreaterThan(-1)
    expect(transitionAt).toBeGreaterThan(-1)
    expect(wallAt).toBeGreaterThan(transitionAt)
    // The allow retired, the deny standing; the tree clean.
    const config = JSON.parse(await Bun.file(join(f.dir, "opencode.json")).text()) as any
    expect(config.permission.external_directory).toEqual({ [`${corpus}/**`]: "deny" })
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
    // The advance's review stop still answers: the wall never displaced the
    // construction's rhythm.
    expect(advanced.lines.some((line) => line.includes("its todo is the review object"))).toBe(true)
  })

  test("a reopened wall blocks transfer ahead of any session, naming the door; the removal restores the advance", async () => {
    const { f, corpus } = await wallFixture()
    await donePhase(f, await f.phase(0), ["T-001"])
    await sealArtifacts(f)
    await landPhaseHandover(f, await f.phase(0))
    expect((await captureRun(() => transferDeterministic(f.dir, { phases: "spec-read,implement" }))).code).toBe(0)
    expect(existsSync(join(f.dir, "linux"))).toBe(false)
    // The person's re-created door: transfer refuses before any session.
    symlinkSync(corpus, join(f.dir, "linux"))
    const out = await captureRun(() => transferDeterministic(f.dir, { phases: "spec-read,implement" }))
    expect(out.code).toBe(2)
    expect(out.lines.some((line) => line.includes("present again") && line.includes("linux"))).toBe(true)
    // The removal restores the advance: the next transfer proceeds (here it
    // advances P02's already-constructed state; the wall stays closed).
    rmSync(join(f.dir, "linux"))
    const again = await captureRun(() => transferDeterministic(f.dir, { phases: "spec-read,implement" }))
    expect(again.code).toBe(0)
    expect(again.lines.some((line) => line.includes("present again"))).toBe(false)
    const log = await f.git("log", "--format=%s")
    expect(log.split("\n").filter((s) => s.includes("PLAN wall close"))).toHaveLength(1)
  })

  test("the undeclared floor as behavior: the plain advance's bytes carry no wall, and no wall commit ever lands", async () => {
    const f = await loopFixture("mt")
    fixtures.push(f)
    await establishRound(f.dir, { phases: "mt", round: 1 })
    await f.commit("round setup")
    await donePhase(f, await f.phase(0), ["T-001", "T-002"])
    await landPhaseHandover(f, await f.phase(0))
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "mt" }))
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.toLowerCase().includes("wall"))).toBe(false)
    expect(await findWallCommit(f.dir)).toBeUndefined()
    const state = (await readPhases(f.dir, 1))!
    expect(existsSync(join(f.dir, state.phases[0]!.dir, "done.md"))).toBe(true)
  })
})

describe("the seal's bracket at the handover boundary (plans/0189 D1/D4)", () => {
  test("the advance leaves the seal and transition to transfer, which clears an interrupted handover record", async () => {
    const { f } = await wallFixture()
    await donePhase(f, await f.phase(0), ["T-001"])
    expect(existsSync(join(f.dir, "linux"))).toBe(true)
    const phase = await f.phase(0)
    expect(existsSync(join(f.dir, phase.dir, "handover.md"))).toBe(false)
    expect(existsSync(join(f.dir, phase.dir, "done.md"))).toBe(false)
    await sealArtifacts(f)
    await saveProgress(f.dir, { task: "PLAN", at: 1, active: true, phase: { kind: "step", step: "phase-handover", unit: "R-01.P01" } })
    expect(existsSync(join(f.dir, ".auto/progress.json"))).toBe(true)
    await landPhaseHandover(f, phase)
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "spec-read,implement" }))
    expect(advanced.code).toBe(0)
    expect(existsSync(join(f.dir, "linux"))).toBe(false)
    expect(existsSync(join(f.dir, phase.dir, "done.md"))).toBe(true)
    expect(existsSync(join(f.dir, ".auto/progress.json"))).toBe(false)
  })

  test("the gates hold ahead of the seal: a FAIL verdict stops with the door standing and no wall commit, and the PASS re-run closes lawfully (plans/0189 D4, 0165-076)", async () => {
    const { f } = await wallFixture("verdict")
    await donePhase(f, await f.phase(0), ["T-001"])
    await sealArtifacts(f)
    // The phase's verdict document concludes FAIL: the person's gate.
    await Bun.write(join(f.dir, "docs/R-01/P01-spec-read/verdict.md"), "# Verdict\n\nThe rework is not done.\n\nResult: FAIL\n")
    await f.commit("the reviewer's rejection")
    await landPhaseHandover(f, await f.phase(0))
    const held = await captureRun(() => transferDeterministic(f.dir, { phases: "spec-read,implement" }))
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("verdict"))).toBe(true)
    // The seal never ran: the door stands, the stamp live, no record.
    expect(existsSync(join(f.dir, "linux"))).toBe(true)
    expect(await findWallCommit(f.dir)).toBeUndefined()
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(false)
    // The rework accepted: the wall closes and the phase completes.
    await Bun.write(join(f.dir, "docs/R-01/P01-spec-read/verdict.md"), "# Verdict\n\nThe rework landed.\n\nResult: PASS\n")
    await f.commit("the reviewer's acceptance")
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "spec-read,implement" }))
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("sealed reference wall closed"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(true)
    expect(existsSync(join(f.dir, "linux"))).toBe(false)
  })
})
