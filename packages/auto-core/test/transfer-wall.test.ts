// The sealed wall at the person's advance path (plans/0132 D2, the
// enactment's step 2): the three-step close integrated with the transition
// path — the loop fixture drives the same phase loop transfer's runAll
// hands control to, under stopBefore "formulate", so the wall commit lands
// between the admission scan and the transition commit inside a real
// advance; transfer's own pre-check surfaces a reopen ahead of any session;
// and the undeclared floor is asserted as behavior on the plain "mt" shape.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runTransfer } from "../src/transfer"
import { establishRound, readPhases } from "../src/phases"
import { findWallCommit } from "../src/wall"
import { saveProgress } from "../src/resume"
import { fakeAgent } from "./fixtures/agent"
import { captureRun } from "./fixtures/capture"
import { artifactTurns, loopFixture, type LoopFixture } from "./fixtures/loop"

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
  // opencode.json is untracked machine state (0122): the retirement write
  // must never dirty the next unit's clean gate.
  await Bun.write(join(f.dir, ".gitignore"), ".auto/\ntmp/\nopencode.json\n")
  mkdirSync(join(f.dir, ".opencode/auto/phases"), { recursive: true })
  writeFileSync(
    join(f.dir, ".opencode/auto/phases/spec-read.md"),
    ["# Spec read", "", ...(gate ? [`Gate: ${gate}`] : []), "Wall: seal linux", "Phase-artifacts: spec-notes.md", "Task-artifacts: notes.md", "", "## plan duties", "", "Read the reference, distill the notes.", "", "<!-- auto: eof -->", ""].join("\n"),
  )
  mkdirSync(join(f.dir, ".opencode/auto/intents"), { recursive: true })
  // The pack keeps the default's result-line rule beside the lane row: the
  // wrap-up verification session's prompt carries its marker (an override
  // replaces the built-in wholesale).
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
  // The agent contract runAll's preflight compares against (the first
  // transfer test's shape).
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
    // run executes P01-spec-read's work (the spec room reads lawfully, door
    // standing) and stops at the phase's clean end.
    const stopped = await f.run()
    expect(stopped.code).toBe(0)
    expect(stopped.lines.some((line) => line.includes("✓ phase boundary: P01-spec-read Spec read complete"))).toBe(true)
    expect(existsSync(join(f.dir, "linux"))).toBe(true)
    await sealArtifacts(f)
    // The advance: the distillation, then the wall block — the admission
    // scan, the wall commit — then the completion rename and the transition
    // commit, then P02's construction and the review stop.
    const advanced = await f.run({ stopBefore: "formulate" })
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
    expect(advanced.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
  })

  test("a reopened wall blocks transfer ahead of any session, naming the door; the removal restores the advance", async () => {
    const { f, corpus } = await wallFixture()
    expect((await f.run()).code).toBe(0)
    await sealArtifacts(f)
    expect((await f.run({ stopBefore: "formulate" })).code).toBe(0)
    expect(existsSync(join(f.dir, "linux"))).toBe(false)
    // The person's re-created door: transfer refuses before any session.
    symlinkSync(corpus, join(f.dir, "linux"))
    const agent = fakeAgent({ turn: artifactTurns(f.dir) })
    const host = { client: agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
    const out = await captureRun(() => runTransfer(f.dir, { managed: host, phases: "spec-read,implement" }))
    expect(out.code).toBe(2)
    expect(out.lines.some((line) => line.includes("present again") && line.includes("linux"))).toBe(true)
    expect(agent.prompts).toHaveLength(0)
    // The removal restores the advance: the next transfer proceeds (here it
    // advances P02's already-constructed state; the wall stays closed).
    rmSync(join(f.dir, "linux"))
    const again = await captureRun(() => runTransfer(f.dir, { managed: host, phases: "spec-read,implement" }))
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
    expect((await f.run()).code).toBe(0)
    const advanced = await f.run({ stopBefore: "formulate" })
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.toLowerCase().includes("wall"))).toBe(false)
    expect(await findWallCommit(f.dir)).toBeUndefined()
    const state = (await readPhases(f.dir, 1))!
    expect(existsSync(join(f.dir, state.phases[0]!.dir, "done.md"))).toBe(true)
  })
})

// The handover paths that are not the person's advance (plans/0189 D1,
// 0165-008): --boundary flow and the plain run's re-entry of an interrupted
// transfer handover once closed the phase with the door open, silently —
// both hold at the seal now, naming transfer, and transfer's next advance
// seals. The gates-before-wall order (plans/0189 D4, 0165-076) and the
// re-entry's phase-closed stop variant ride the same fixture.
describe("the seal's bracket at the handover paths (plans/0189 D1/D4)", () => {
  test("--boundary flow holds at a due seal: exit 2, the door standing, the phase unrenamed — and the next transfer seals", async () => {
    const { f } = await wallFixture()
    expect((await f.run()).code).toBe(0)
    await sealArtifacts(f)
    const flowed = await f.run({ boundary: "flow" })
    expect(flowed.code).toBe(2)
    expect(flowed.lines.some((line) => line.includes("due to close") && line.includes("transfer"))).toBe(true)
    expect(existsSync(join(f.dir, "linux"))).toBe(true)
    expect(await findWallCommit(f.dir)).toBeUndefined()
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(false)
    // The person's advance seals: the wall closes and the phase completes.
    const advanced = await f.run({ stopBefore: "formulate" })
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("sealed reference wall closed"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(true)
    expect(existsSync(join(f.dir, "linux"))).toBe(false)
  })

  test("the plain run's re-entry of an interrupted transfer handover holds at the seal — the distillation kept, the close transfer's", async () => {
    const { f } = await wallFixture()
    expect((await f.run()).code).toBe(0)
    await sealArtifacts(f)
    // The interrupted advance's recovery point: an active phase-handover
    // step record the plain run re-enters (0101 D1).
    await saveProgress(f.dir, { task: "PLAN", at: 1, active: true, phase: { kind: "step", step: "phase-handover", unit: "R-01.P01" } })
    const reentry = await f.run()
    expect(reentry.code).toBe(2)
    expect(reentry.lines.some((line) => line.includes("due to close") && line.includes("transfer"))).toBe(true)
    expect(existsSync(join(f.dir, "linux"))).toBe(true)
    expect(await findWallCommit(f.dir)).toBeUndefined()
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(false)
    // The handover document the re-entry distilled is kept and committed —
    // transfer skips straight past the distillation to the seal.
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/handover.md"))).toBe(true)
    const advanced = await f.run({ stopBefore: "formulate" })
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("skipping the distillation session"))).toBe(true)
    expect(advanced.lines.some((line) => line.includes("sealed reference wall closed"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(true)
  })

  test("a completed re-entry's boundary stop prints the phase-closed variant (plans/0189 D1, the 0101 D1 re-entry truth)", async () => {
    const { f } = await wallFixture()
    expect((await f.run()).code).toBe(0)
    await sealArtifacts(f)
    expect((await f.run({ stopBefore: "formulate" })).code).toBe(0)
    // P02's work done, its handover interrupted: the re-entry completes it
    // (post-wall, the boundary checks pass) and stops with the truth.
    expect((await f.run()).code).toBe(0)
    await saveProgress(f.dir, { task: "PLAN", at: 1, active: true, phase: { kind: "step", step: "phase-handover", unit: "R-01.P02" } })
    const reentry = await f.run()
    expect(reentry.code).toBe(0)
    expect(reentry.lines.some((line) => line.includes("complete and closed"))).toBe(true)
    expect(reentry.lines.some((line) => line.includes("distills the handover"))).toBe(false)
  })

  test("the gates hold ahead of the seal: a FAIL verdict stops with the door standing and no wall commit, and the PASS re-run closes lawfully (plans/0189 D4, 0165-076)", async () => {
    const { f } = await wallFixture("verdict")
    expect((await f.run()).code).toBe(0)
    await sealArtifacts(f)
    // The phase's verdict document concludes FAIL: the person's gate.
    await Bun.write(join(f.dir, "docs/R-01/P01-spec-read/verdict.md"), "# Verdict\n\nThe rework is not done.\n\nResult: FAIL\n")
    await f.commit("the reviewer's rejection")
    const held = await f.run({ stopBefore: "formulate" })
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("verdict"))).toBe(true)
    // The seal never ran: the door stands, the stamp live, no record.
    expect(existsSync(join(f.dir, "linux"))).toBe(true)
    expect(await findWallCommit(f.dir)).toBeUndefined()
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(false)
    // The rework accepted: the wall closes and the phase completes.
    await Bun.write(join(f.dir, "docs/R-01/P01-spec-read/verdict.md"), "# Verdict\n\nThe rework landed.\n\nResult: PASS\n")
    await f.commit("the reviewer's acceptance")
    const advanced = await f.run({ stopBefore: "formulate" })
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("sealed reference wall closed"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-spec-read/done.md"))).toBe(true)
    expect(existsSync(join(f.dir, "linux"))).toBe(false)
  })
})
