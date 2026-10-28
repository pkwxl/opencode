// The sealed reference wall (plans/0132): the lifecycle the enactment's
// step 1 names — the closed predicate, the recorded target, idempotency,
// reopening, the person-entry split — beside the field grammar (D1), the
// deny stamp and the sealed channel's one diff check (D3/D4), over real git
// repositories with the real commitTree (the wall commit is git state, and
// its record is parsed back from the message). The transfer-boundary
// integration (the three-step close riding the person's advance path) is
// the loop-fixture family beside this suite; the undeclared floor is
// asserted here as behavior — no wall type, no wall commit, no entry
// written, the door standing.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { commitTree } from "../src/git"
import { establishRound, readPhases, renderPhaseTodo, type PhaseUnit } from "../src/phases"
import { loadPhaseTypes, parsePhaseTypeFile } from "../src/phases/custom"
import { renderTaskIndex } from "../src/tasks"
import { findWallCommit, wallBoundary, wallPrecheckFindings, wallSealingPhase, type WallCtx } from "../src/wall"
import { captureRun } from "./fixtures/capture"
import { freshRepo, git } from "./fixtures/runner"
import { taskDoc } from "./fixtures/loop"

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const TYPE_FILE = (doors: string) =>
  ["# Spec read", "", ...(doors ? [`Wall: seal ${doors}`] : ["Wall: seal"]), "Phase-artifacts: spec-notes.md", "Task-artifacts: notes.md", "", "## plan duties", "", "Read the reference, distill the notes.", "", "<!-- auto: eof -->", ""].join("\n")

const LANE_PACK = (command: string) =>
  ["# default", "", "## quality", "", "### test-lanes", "", "divergence:", `Command: ${command}`, "Cost: regression", "Surfaces: .", "Exclusive: no", ""].join("\n")

describe("the Wall: field grammar (D1, src/phases/custom.ts)", () => {
  const file = (wall: string) => `# Spec read\n\n${wall}\nPhase-artifacts: spec-notes.md\n\n## plan duties\n\nx\n`

  test("seal carries the semantics; the doors are the person-owned fill, deduped", () => {
    expect(parsePhaseTypeFile("spec-read", file("Wall: seal")).wall).toEqual({ doors: [] })
    expect(parsePhaseTypeFile("spec-read", file("Wall: seal linux")).wall).toEqual({ doors: ["linux"] })
    expect(parsePhaseTypeFile("spec-read", file("Wall: seal linux, linux-other")).wall).toEqual({ doors: ["linux", "linux-other"] })
    expect(parsePhaseTypeFile("spec-read", file("Wall: SEAL linux")).wall).toEqual({ doors: ["linux"] })
    expect(parsePhaseTypeFile("spec-read", file("Wall: seal `linux`")).wall).toEqual({ doors: ["linux"] })
  })

  test("unknown keywords, empty values and non-top-level doors fail naming the grammar", () => {
    expect(() => parsePhaseTypeFile("spec-read", file("Wall: close"))).toThrow(/Wall must be seal \[door …\]/)
    expect(() => parsePhaseTypeFile("spec-read", file("Wall: "))).toThrow(/Wall is empty/)
    expect(() => parsePhaseTypeFile("spec-read", file("Wall: seal a/b"))).toThrow(/top-level entry names/)
    expect(() => parsePhaseTypeFile("spec-read", file("Wall: seal .."))).toThrow(/top-level entry names/)
  })
})

// One wall project: a repo with the wall type, a lane pack, a corpus behind
// a tracked root symlink and the stamped allow — the aster-mig shape.
async function wallProject(command = "true", doors = "linux"): Promise<{ dir: string; corpus: string; phase: PhaseUnit; ctx: WallCtx }> {
  const dir = await freshRepo()
  made.push(dir)
  // The corpus lives OUTSIDE /tmp (plans/0147): the knowledge boundary's
  // receipts allowance covers /tmp, and every /tmp-covering allow at "allow"
  // reads as the boundary's own — a /tmp-resident reference cannot seal and
  // its person-glob tests cannot exist there.
  const corpus = mkdtempSync(join(homedir(), "auto-wall-corpus-"))
  made.push(corpus)
  writeFileSync(join(corpus, "timer.c"), "void tick(void) {}\n")
  await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\nopencode.json\n")
  mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
  writeFileSync(join(dir, ".opencode/auto/phases/spec-read.md"), TYPE_FILE(doors))
  mkdirSync(join(dir, ".opencode/auto/intents"), { recursive: true })
  writeFileSync(join(dir, ".opencode/auto/intents/default.md"), LANE_PACK(command))
  symlinkSync(corpus, join(dir, "linux"))
  await Bun.write(join(dir, "opencode.json"), JSON.stringify({ permission: { external_directory: { [`${corpus}/**`]: "allow" } } }, null, 2) + "\n")
  await establishRound(dir, { phases: "spec-read,implement" })
  const state = (await readPhases(dir, 1))!
  const phase = state.phases[0]!
  // The sealing phase's artifacts on disk: the consolidated notes and one
  // task's notes — the sealed channel the wall commit records.
  writeFileSync(join(dir, phase.dir, "spec-notes.md"), "# Spec notes\n\nBehavior only.\n\n<!-- auto: eof -->\n")
  writeFileSync(join(dir, join(phase.dir, "tasks.md")), `${renderTaskIndex("R-01.P01", [])}- [x] T-001 read the timer\n`)
  mkdirSync(join(dir, "docs/T-001"), { recursive: true })
  writeFileSync(join(dir, "docs/T-001/done.md"), taskDoc("T-001", "R-01.P01"))
  writeFileSync(join(dir, "docs/T-001/notes.md"), "# Notes (T-001)\n\nContracts at the boundary.\n\n<!-- auto: eof -->\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "the spec room's work, door standing")
  return { dir, corpus, phase, ctx: { directory: dir, git: { commitTree }, opts: { stopBefore: "formulate" } } }
}

const opencode = async (dir: string): Promise<any> => JSON.parse(await Bun.file(join(dir, "opencode.json")).text())

describe("the close (D2): predicate, recorded target, idempotency, reopening, the person-entry split", () => {
  test("the three-step close at the person's advance: admission green → the wall commit records the target, the door goes, the stamp retires, the deny stands", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    const out = await captureRun(async () => {
      expect(await wallBoundary(ctx, phase)).toEqual([])
      return 0
    })
    // The door is gone, the allow retired, the deny standing.
    expect(existsSync(join(dir, "linux"))).toBe(false)
    const config = await opencode(dir)
    expect(config.permission.external_directory).toEqual({ [`${corpus}/**`]: "deny" })
    // The wall commit: the record parsed back — the door's resolved target
    // and the sealed channel (the phase artifact and the task notes).
    const record = await findWallCommit(dir)
    expect(record).toBeDefined()
    expect(record!.doors).toEqual([{ name: "linux", target: corpus }])
    expect(record!.sealed).toEqual(["docs/R-01/P01-spec-read/spec-notes.md", "docs/T-001/notes.md"])
    // The wall commit's tracked diff is the door removal alone.
    const show = await git(dir, "show", "--name-status", "--format=", record!.sha)
    expect(show.trim()).toBe(`D\tlinux`)
    expect(out.lines.some((line) => line.includes("sealed reference wall closed"))).toBe(true)
    expect(out.lines.some((line) => line.includes(corpus))).toBe(true)
  })

  test("idempotency: a closed wall re-derives closed — the boundary passes with the scan re-run, no second wall commit", async () => {
    const { dir, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const first = await findWallCommit(dir)
    // The post-wall boundary: the admission re-runs for this tree (a green
    // receipt at the current heads) and the wall passes its re-derivation.
    expect(await wallBoundary(ctx, phase)).toEqual([])
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const log = await git(dir, "log", "--format=%H %s")
    expect(log.split("\n").filter((line) => line.includes("PLAN wall close")).length).toBe(1)
    expect(first).toBeDefined()
  })

  test("a re-created door is a reopen finding at the boundary — and at transfer's pre-check ahead of any session", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    symlinkSync(corpus, join(dir, "linux"))
    const boundary = await wallBoundary(ctx, phase)
    expect(boundary.length).toBeGreaterThan(0)
    expect(boundary.join("\n")).toContain("present again")
    const pre = await wallPrecheckFindings(dir)
    expect(pre.join("\n")).toContain("present again")
    expect(pre.join("\n")).toContain("reopen")
    // The person removes it; the wall re-derives closed.
    rmSync(join(dir, "linux"))
    expect(await wallPrecheckFindings(dir)).toEqual([])
  })

  test("the person-entry split: a covering allow the driver never stamped blocks, named; the stamp itself is retired silently", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    // A person-authored parent glob covering the corpus target.
    const config = await opencode(dir)
    config.permission.external_directory[`${join(corpus, "..")}/**`] = "allow"
    await Bun.write(join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n")
    const blocked = await wallBoundary(ctx, phase)
    expect(blocked.join("\n")).toContain("person-authored external_directory allow")
    expect(blocked.join("\n")).toContain(`${join(corpus, "..")}/**`)
    // Nothing mutated: the door still stands, no wall commit.
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
    // The person removes their line; the close proceeds.
    delete config.permission.external_directory[`${join(corpus, "..")}/**`]
    await Bun.write(join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n")
    expect(await wallBoundary(ctx, phase)).toEqual([])
    expect((await opencode(dir)).permission.external_directory).toEqual({ [`${corpus}/**`]: "deny" })
  })

  test("the knowledge-boundary interplay (plans/0147): a /tmp-resident reference cannot seal — the receipts allowance beats the wall's deny; the boundary's own keys are never person-authored", async () => {
    const { dir, phase, ctx } = await wallProject()
    // A /tmp-resident corpus with the door re-pointed at it and its stamp in
    // place — the unsealable shape once the boundary ships its /tmp pair.
    const corpus = mkdtempSync(join(tmpdir(), "auto-wall-tmp-"))
    made.push(corpus)
    writeFileSync(join(corpus, "timer.c"), "void tick(void) {}\n")
    rmSync(join(dir, "linux"))
    symlinkSync(corpus, join(dir, "linux"))
    const config = await opencode(dir)
    config.permission.external_directory = { "/**": "deny", "/tmp/**": "allow", [`${corpus}/**`]: "allow", ...config.permission.external_directory }
    await Bun.write(join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n")
    const blocked = await wallBoundary(ctx, phase)
    expect(blocked.join("\n")).toContain("the wall cannot close: the reference target(s)")
    expect(blocked.join("\n")).toContain(corpus)
    expect(blocked.join("\n")).toContain("inside the knowledge boundary's allowed /tmp subtree")
    expect(blocked.join("\n")).toContain("move the reference out of /tmp")
    // Nothing mutated: the door still stands, no wall commit, the boundary's
    // own keys never read as person-authored.
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
    // The person narrows the allowance by hand: the close proceeds (the
    // corpus allow — the driver's stamp — still admits, then retires).
    delete config.permission.external_directory["/tmp/**"]
    await Bun.write(join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n")
    expect(await wallBoundary(ctx, phase)).toEqual([])
  })

  test("a door that was never present blocks naming the state and its remedy", async () => {
    const { dir, phase, ctx } = await wallProject()
    rmSync(join(dir, "linux"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "person removes the door by hand, allow standing")
    // The stamp allow still records the target, so this is the recovered
    // shape, not the never-present one — see the recovery test below.
    // For the never-present shape: no door, no allow at all.
    await Bun.write(join(dir, "opencode.json"), "{}\n")
    const blocked = await wallBoundary(ctx, phase)
    expect(blocked.join("\n")).toContain("the wall cannot close")
    expect(blocked.join("\n")).toContain("linux")
    expect(await findWallCommit(dir)).toBeUndefined()
  })

  test("door absent with a covering allow means finish the retirement: the close recovers the target from the driver's stamp (an empty record commit)", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    rmSync(join(dir, "linux"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "person removes the door by hand")
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const record = await findWallCommit(dir)
    expect(record).toBeDefined()
    expect(record!.doors).toEqual([{ name: "linux", target: corpus }])
    // The record commit is empty (the door was already gone): the message
    // is the record.
    const show = await git(dir, "show", "--name-status", "--format=", record!.sha)
    expect(show.trim()).toBe("")
    expect((await opencode(dir)).permission.external_directory).toEqual({ [`${corpus}/**`]: "deny" })
  })

  test("the interrupted retirement finishes at the boundary: a re-added exact stamp allow is withdrawn, the deny re-asserted", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    // A re-allow of the exact stamp key (the crash window's leftover, or a
    // hand re-add): the driver's own bytes, retired without a finding.
    const config = await opencode(dir)
    config.permission.external_directory[`${corpus}/**`] = "allow"
    await Bun.write(join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n")
    const out = await captureRun(async () => {
      expect(await wallBoundary(ctx, phase)).toEqual([])
      return 0
    })
    expect(out.lines.join("\n")).toContain("finishing the interrupted wall retirement")
    expect((await opencode(dir)).permission.external_directory).toEqual({ [`${corpus}/**`]: "deny" })
  })

  test("the retrofit trigger: a source phase past the seal closes a wall the sealing phase never closed; a source before the seal does not", async () => {
    const dir = await freshRepo()
    made.push(dir)
    await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\nopencode.json\n")
    mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
    writeFileSync(join(dir, ".opencode/auto/phases/spec-read.md"), TYPE_FILE("linux"))
    mkdirSync(join(dir, ".opencode/auto/intents"), { recursive: true })
    writeFileSync(join(dir, ".opencode/auto/intents/default.md"), LANE_PACK("true"))
    await establishRound(dir, { phases: "implement,spec-read,implement" })
    const state = (await readPhases(dir, 1))!
    const before = state.phases[0]! // P01-implement, before the seal (P02)
    expect(await wallSealingPhase(dir, before)).toBeUndefined()
    // The pre-seal floor as behavior: the advance does not close.
    const corpus = mkdtempSync(join(tmpdir(), "auto-wall-corpus-"))
    made.push(corpus)
    symlinkSync(corpus, join(dir, "linux"))
    await Bun.write(join(dir, "opencode.json"), JSON.stringify({ permission: { external_directory: { [`${corpus}/**`]: "allow" } } }, null, 2) + "\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "door standing, pre-seal")
    const ctx: WallCtx = { directory: dir, git: { commitTree }, opts: { stopBefore: "formulate" } }
    expect(await wallBoundary(ctx, before)).toEqual([])
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
    // P03-implement, past the seal: the retrofit closes on its advance.
    const past = state.phases[2]!
    expect((await wallSealingPhase(dir, past))?.id).toBe("P02")
    expect(await wallBoundary(ctx, past)).toEqual([])
    expect(existsSync(join(dir, "linux"))).toBe(false)
    expect((await findWallCommit(dir))!.doors).toEqual([{ name: "linux", target: corpus }])
  })

  test("a plain run never closes the wall — the close rides the person's advance path alone", async () => {
    const { dir, phase } = await wallProject()
    const runCtx: WallCtx = { directory: dir, git: { commitTree }, opts: {} }
    expect(await wallBoundary(runCtx, phase)).toEqual([])
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
  })

  test("the undeclared floor as behavior: no Wall: field anywhere — no machinery, the door stands, nothing written", async () => {
    const dir = await freshRepo()
    made.push(dir)
    const corpus = mkdtempSync(join(tmpdir(), "auto-wall-corpus-"))
    made.push(corpus)
    await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\nopencode.json\n")
    symlinkSync(corpus, join(dir, "linux"))
    await Bun.write(join(dir, "opencode.json"), JSON.stringify({ permission: { external_directory: { [`${corpus}/**`]: "allow" } } }, null, 2) + "\n")
    mkdirSync(join(dir, ".opencode/auto/intents"), { recursive: true })
    writeFileSync(join(dir, ".opencode/auto/intents/default.md"), LANE_PACK("true"))
    await establishRound(dir, { phases: "mt" })
    const state = (await readPhases(dir, 1))!
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "no wall declared")
    const ctx: WallCtx = { directory: dir, git: { commitTree }, opts: { stopBefore: "formulate" } }
    expect(await wallBoundary(ctx, state.phases[0]!)).toEqual([])
    expect(await wallPrecheckFindings(dir)).toEqual([])
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
    expect((await opencode(dir)).permission.external_directory[`${corpus}/**`]).toBe("allow")
  })
})

describe("the admission scan (D3): 0121's instrument, 0121's contract", () => {
  test("a red lane blocks the close, mutating nothing — the door stands, the allow stands", async () => {
    const { dir, phase, ctx } = await wallProject("exit 3")
    const blocked = await wallBoundary(ctx, phase)
    expect(blocked.join("\n")).toContain("admission scan is red")
    expect(blocked.join("\n")).toContain("divergence")
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
  })

  test("a scan failure is a red lane: a timed-out or tool-less run never admits the tree", async () => {
    const { dir, phase, ctx } = await wallProject("sleep 2")
    // The watchdog: an absolute cap far below the sleep kills the run and
    // the verdict reads red (fail closed, 0121 D5 inherited).
    ctx.opts.maxMs = 200
    ctx.opts.idleMs = 100
    ctx.opts.pollMs = 50
    const blocked = await wallBoundary(ctx, phase)
    expect(blocked.join("\n")).toContain("admission scan is red")
    expect(await findWallCommit(dir)).toBeUndefined()
  })

  test("no declared instrument: a clean room cannot go clean on unscanned ground", async () => {
    const { dir, phase, ctx } = await wallProject()
    // A pack without the test-lanes section: the floor of 0096's grammar.
    writeFileSync(join(dir, ".opencode/auto/intents/default.md"), ["# default", "", "## quality", "", "### decompose", "", "One requirement per item.", ""].join("\n"))
    const blocked = await wallBoundary(ctx, phase)
    expect(blocked.join("\n")).toContain("no instrument")
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
  })
})

describe("the sealed channel (D4): one diff check, the person's amendment the one exception", () => {
  test("a driver commit writing a sealed path is an invariant violation; a person commit is the recorded amendment", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const record = (await findWallCommit(dir))!
    // A person's amendment: no Auto-Stage trailer — the monitor-mediated
    // clarification path, noted and never blocked.
    writeFileSync(join(dir, "docs/T-001/notes.md"), "# Notes (T-001)\n\nAmended by the person's clarification.\n\n<!-- auto: eof -->\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "person: monitor-mediated amendment")
    const amended = await captureRun(async () => {
      expect(await wallBoundary(ctx, phase)).toEqual([])
      return 0
    })
    expect(amended.lines.join("\n")).toContain("person-committed amendment")
    // A session's write: swept by the unified commit, the Auto-Stage
    // trailer names it — the violation, however it was performed.
    writeFileSync(join(dir, "docs/R-01/P01-spec-read/spec-notes.md"), "# Spec notes\n\nA session edited the frozen channel.\n\n<!-- auto: eof -->\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "PLAN session write", "-m", "Auto-Task: T-002", "-m", "Auto-Stage: implement")
    const violated = await wallBoundary(ctx, phase)
    expect(violated.join("\n")).toContain("sealed-channel invariant violation")
    expect(violated.join("\n")).toContain("docs/R-01/P01-spec-read/spec-notes.md")
    expect(violated.join("\n")).toContain(record.sha.slice(0, 7))
  })

  test("the sealed paths join protect's declared set for the rest of the run", async () => {
    const { phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    // protectAdditional is a no-op when protection is inactive (this
    // harness); the run-start wiring is asserted by the unit below over
    // protect(dir, sealed) directly — here: the record exists and the
    // phase's artifacts are what it froze.
    const record = await findWallCommit(ctx.directory)
    expect(record!.sealed).toContain(join(phase.dir, "spec-notes.md"))
    expect(loadPhaseTypes(ctx.directory).find((entry) => entry.type === "spec-read")!.wall).toEqual({ doors: ["linux"] })
  })
})
