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
import { dirname, join } from "node:path"
import { commitTree } from "../src/git"
import { establishRound, readPhases, renderPhaseTodo, type PhaseUnit } from "../src/phases"
import { loadPhaseTypes, parsePhaseTypeFile } from "../src/phases/custom"
import { renderTaskIndex } from "../src/tasks"
import { findWallCommit, sealedChannelCheck, wallBoundary, wallPrecheckFindings, wallSealingPhase, type WallCtx } from "../src/wall"
import { renderStatus } from "../src/status"
import { admission } from "./helpers/perm-oracle"
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
// `tracked` (plans/0190 D2's 0138 posture) drops the config file's ignore
// line so the fixture's setup commit tracks it: the committed-surface shape
// every post-0138 project runs.
async function wallProject(command = "true", doors = "linux", tracked = false): Promise<{ dir: string; corpus: string; phase: PhaseUnit; ctx: WallCtx }> {
  const dir = await freshRepo()
  made.push(dir)
  // The corpus lives OUTSIDE /tmp (plans/0147): the knowledge boundary's
  // receipts allowance covers /tmp, and every /tmp-covering allow at "allow"
  // reads as the boundary's own — a /tmp-resident reference cannot seal and
  // its person-glob tests cannot exist there.
  const corpus = mkdtempSync(join(homedir(), "auto-wall-corpus-"))
  made.push(corpus)
  writeFileSync(join(corpus, "timer.c"), "void tick(void) {}\n")
  await Bun.write(join(dir, ".gitignore"), `.auto/\ntmp/\n${tracked ? "" : "opencode.json\n"}`)
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
    // The wall commit's tracked diff is the door removal alone (the
    // pre-0138 local-only floor: the file stays out of the pathspec) —
    // and the record's words tell the file's real posture (plans/0190 D2:
    // the ledger wording, never the stale "untracked" clause).
    const show = await git(dir, "show", "--name-status", "--format=", record!.sha)
    expect(show.trim()).toBe(`D\tlinux`)
    const body = await git(dir, "log", "-1", "--format=%B", record!.sha)
    expect(body).toContain("door→target ledger")
    expect(body).not.toContain("untracked machine state")
    expect(out.lines.some((line) => line.includes("sealed reference wall closed"))).toBe(true)
    expect(out.lines.some((line) => line.includes(corpus))).toBe(true)
  })

  test("the 0138 posture: a tracked opencode.json rides the wall commit — the seal atomic with its own deny, the tree clean after (plans/0190 D2, 0165-147)", async () => {
    const { dir, corpus, phase, ctx } = await wallProject("true", "linux", true)
    const out = await captureRun(async () => {
      expect(await wallBoundary(ctx, phase)).toEqual([])
      return 0
    })
    const record = await findWallCommit(dir)
    expect(record).toBeDefined()
    expect(record!.doors).toEqual([{ name: "linux", target: corpus }])
    // One wall commit carrying both halves: the door removal and the
    // retirement write itself — the deny never left to the next
    // phase-transition commit or a gate hold's dirty tree.
    const show = await git(dir, "show", "--name-status", "--format=", record!.sha)
    expect(show.trim().split("\n").sort()).toEqual([`D\tlinux`, "M\topencode.json"])
    // The close leaves the tracked file clean: a hold past the wall no
    // longer hands the next run's clean gate a dirty opencode.json.
    const status = await git(dir, "status", "--porcelain", "--", "opencode.json")
    expect(status.trim()).toBe("")
    // The record's words name the tracked posture it just carried.
    const body = await git(dir, "log", "-1", "--format=%B", record!.sha)
    expect(body).toContain("carried by this same commit when the file is tracked")
    expect(body).not.toContain("untracked machine state")
    // The deny stands in the file the commit carries.
    const config = await opencode(dir)
    expect(config.permission.external_directory).toEqual({ [`${corpus}/**`]: "deny" })
    expect(out.lines.some((line) => line.includes("sealed reference wall closed"))).toBe(true)
  })

  test("the close refuses under a fleet that carries no external_directory posture (plans/0190 D1, 0165-040): nothing mutated, the door stands, the re-run seals", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    const blocked = await wallBoundary({ ...ctx, externalDirectory: false }, phase)
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.join("\n")).toContain("cannot close under this run's agent fleet")
    expect(blocked.join("\n")).toContain("the seal would be a record with no session-side enforcement")
    expect(blocked.join("\n")).toContain("OPENCODE_AUTO_AGENT=opencode")
    // The refusal sits ahead of every mutating step (P12/P20): the door
    // still stands, the stamped allow still in place, no wall commit.
    expect(existsSync(join(dir, "linux"))).toBe(true)
    const config = await opencode(dir)
    expect(config.permission.external_directory).toEqual({ [`${corpus}/**`]: "allow" })
    expect(await findWallCommit(dir)).toBeUndefined()
    // The same project seals lawfully under a carrying fleet (the field
    // absent — the byte-identical floor every carrying run reads).
    expect(await wallBoundary(ctx, phase)).toEqual([])
  })

  test("status renders the wall's agent dependence over the static agent choice (plans/0190 D1)", async () => {
    const { dir } = await wallProject()
    // The default agent (opencode) carries the posture: no row.
    expect((await renderStatus(dir)).join("\n")).not.toContain("translates none of it")
    // The config's agent key names claude — the adapter that declares it
    // carries none of the external_directory posture: one ⚠ row naming the
    // limit and the close's refusal (chooseAgent's precedence reads the
    // env override first; the switch snapshot is memoized per process, so
    // the pin goes through the config side of the same choice). The shell
    // profile's own injected agent is out of the read's reach by ruling —
    // the shell's declaration, its row to render.
    await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ agent: "claude" }, null, 2) + "\n")
    const rows = (await renderStatus(dir)).join("\n")
    expect(rows).toContain("translates none of it")
    expect(rows).toContain("the wall's close refuses under it")
    // A wall-undeclared project never renders the row (the P10 floor).
    const bare = await freshRepo()
    made.push(bare)
    await Bun.write(join(bare, ".opencode/auto/config.json"), JSON.stringify({ agent: "claude" }, null, 2) + "\n")
    expect((await renderStatus(bare)).join("\n")).not.toContain("translates none of it")
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
    expect(blocked.join("\n")).toContain("person-authored external_directory entry")
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

  test("the multi-door close (plans/0155 D2): a hand-removed door beside a surviving declared door — its stamped allow is recovered and retired, the seal complete", async () => {
    const { dir, corpus, phase, ctx } = await wallProject("true", "linux, vendor")
    // The second declared door, standing beside the first: its corpus
    // outside /tmp, its symlink tracked, its driver-stamped allow live.
    const vendor = mkdtempSync(join(homedir(), "auto-wall-vendor-"))
    made.push(vendor)
    writeFileSync(join(vendor, "vend.c"), "void vend(void) {}\n")
    symlinkSync(vendor, join(dir, "vendor"))
    const config = await opencode(dir)
    config.permission.external_directory[`${vendor}/**`] = "allow"
    await Bun.write(join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "both doors standing")
    // The person removes the vendor door by hand (a tracked removal); its
    // stamped allow stays in the untracked opencode.json. The all-or-nothing
    // recovery gate would have skipped the derivation (a declared door
    // survives), orphaned the allow — neither the person-entry split nor the
    // retirement would ever name vendor's target.
    rmSync(join(dir, "vendor"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "person removes the vendor door, its stamp standing")
    expect(await wallBoundary(ctx, phase)).toEqual([])
    // Both targets recorded — the surviving door by name, the removed one
    // recovered under its PROVEN name (plans/0189 D2: git's last
    // add/modify of the door names it — the pre-0189 "(removed)"
    // placeholder is history) — and both stamps retired to denies.
    const record = (await findWallCommit(dir))!
    expect(record.doors).toEqual([
      { name: "linux", target: corpus },
      { name: "vendor", target: vendor },
    ])
    expect((await opencode(dir)).permission.external_directory).toEqual({ [`${corpus}/**`]: "deny", [`${vendor}/**`]: "deny" })
    // The wall commit's tracked diff is the surviving door's removal alone.
    const show = await git(dir, "show", "--name-status", "--format=", record.sha)
    expect(show.trim()).toBe("D\tlinux")
    // Post-wall the boundary re-derives closed: no orphaned allow, the
    // placeholder door never read as re-created.
    expect(await wallPrecheckFindings(dir)).toEqual([])
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

  test("a plain-run handover holds at a due seal, naming transfer — the close rides the person's advance path alone (plans/0189 D1, 0165-008)", async () => {
    const { dir, corpus, phase } = await wallProject()
    // A plain run's context: no stop condition — the handover paths that
    // once crossed the seal silently (--boundary flow, the interrupted
    // handover's re-entry) hold instead of skipping the wall.
    const runCtx: WallCtx = { directory: dir, git: { commitTree }, opts: {} }
    const held = await wallBoundary(runCtx, phase)
    expect(held.length).toBeGreaterThan(0)
    expect(held.join("\n")).toContain("due to close")
    expect(held.join("\n")).toContain("only the person's advance closes it")
    expect(held.join("\n")).toContain("transfer")
    // Nothing mutated: the door stands, no wall commit, no retirement.
    expect(existsSync(join(dir, "linux"))).toBe(true)
    expect(await findWallCommit(dir)).toBeUndefined()
    expect((await opencode(dir)).permission.external_directory[`${corpus}/**`]).toBe("allow")
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

// The proven recovery and the closed predicate's every channel (plans/0189):
// the sweep that once adopted the template's /tmp allowance and person
// allows, the reachability door half, the evaluated coverage, and the
// failed commit's true remedies — the admission oracle agrees wherever an
// admission judgment is asserted.
describe("the proven recovery (plans/0189 D2, 0165-037): only targets git can name", () => {
  test("a templated project (the 0147 boundary live) with its door removed closes cleanly — the /tmp allowance is never adopted as the reference", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    rmSync(join(dir, "linux"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "person removes the door by hand")
    // The template's own file: the boundary pair with the corpus stamp.
    await Bun.write(
      join(dir, "opencode.json"),
      JSON.stringify({ permission: { external_directory: { "/**": "deny", "/tmp/**": "allow", [`${corpus}/**`]: "allow" } } }, null, 2) + "\n",
    )
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const record = (await findWallCommit(dir))!
    expect(record.doors).toEqual([{ name: "linux", target: corpus }])
    // The boundary's own keys survive the close untouched.
    const config = await opencode(dir)
    expect(config.permission.external_directory["/tmp/**"]).toBe("allow")
    expect(config.permission.external_directory["/**"]).toBe("deny")
    expect(config.permission.external_directory[`${corpus}/**`]).toBe("deny")
  })

  test("a person-authored allow on an unrelated existing path is never swept into a door: untouched, unrecorded", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    rmSync(join(dir, "linux"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "person removes the door by hand")
    const personDir = mkdtempSync(join(homedir(), "auto-wall-person-"))
    made.push(personDir)
    await Bun.write(
      join(dir, "opencode.json"),
      JSON.stringify({ permission: { external_directory: { [`${corpus}/**`]: "allow", [`${personDir}/**`]: "allow" } } }, null, 2) + "\n",
    )
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const record = (await findWallCommit(dir))!
    expect(record.doors).toEqual([{ name: "linux", target: corpus }])
    // The person's entry stands exactly as they wrote it.
    expect((await opencode(dir)).permission.external_directory[`${personDir}/**`]).toBe("allow")
    expect((await opencode(dir)).permission.external_directory[`${corpus}/**`]).toBe("deny")
  })
})

describe("the closed predicate's every channel (plans/0189 D3, 0165-038/149)", () => {
  test("a door re-created under another name or path — tracked at any depth — is a reopen finding, however committed", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    // A session's `ln -s`, swept into a tracked commit by the unified
    // commit: the shape the name-based predicate never saw.
    symlinkSync(corpus, join(dir, "reference"))
    mkdirSync(join(dir, "docs/ref"), { recursive: true })
    symlinkSync(corpus, join(dir, "docs/ref/k"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "a session's links, unified-committed")
    const pre = await wallPrecheckFindings(dir)
    expect(pre.join("\n")).toContain("reference")
    expect(pre.join("\n")).toContain("docs/ref/k")
    expect(pre.join("\n")).toContain("at the recorded target")
    const boundary = await wallBoundary(ctx, phase)
    expect(boundary.length).toBeGreaterThan(0)
    // The removals restore the closed derivation.
    rmSync(join(dir, "reference"))
    rmSync(join(dir, "docs/ref/k"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "the reopens removed")
    expect(await wallPrecheckFindings(dir)).toEqual([])
  })

  test("an ancestor symlink over the recorded target reopens the wall; a dangling re-created door counts by what it points at (plans/0189 D3/D5, 0165-149)", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    // Over: a link to the corpus's parent — reads through it reach the
    // corpus lexically in-tree.
    symlinkSync(dirname(corpus), join(dir, "up"))
    const over = await wallPrecheckFindings(dir)
    expect(over.join("\n")).toContain("up")
    expect(over.join("\n")).toContain("over the recorded target")
    rmSync(join(dir, "up"))
    expect(await wallPrecheckFindings(dir)).toEqual([])
    // Dangling: the re-created door points at a corpus child that does not
    // exist YET (another machine, a lazy mount) — stat once followed the
    // link and read closed; the pointer counts now.
    symlinkSync(join(corpus, "later"), join(dir, "linux"))
    const dangling = await wallPrecheckFindings(dir)
    expect(dangling.join("\n")).toContain("present again")
    rmSync(join(dir, "linux"))
    expect(await wallPrecheckFindings(dir)).toEqual([])
  })

  test("the evaluated coverage: a person catch-all, a subtree allow and an ask at the slot all read open — and the oracle agrees (0165-038)", async () => {
    const { dir, corpus, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const raw = await Bun.file(join(dir, "opencode.json")).text()
    const edit = async (external: Record<string, string>) => {
      const parsed = JSON.parse(raw) as any
      parsed.permission.external_directory = external
      await Bun.write(join(dir, "opencode.json"), JSON.stringify(parsed, null, 2) + "\n")
    }
    // A person catch-all allow landing last beats the seal's front deny.
    await edit({ "/**": "deny", [`${corpus}/**`]: "deny", "*": "allow" })
    const catchAll = await wallPrecheckFindings(dir)
    expect(catchAll.join("\n")).toContain("person-authored external_directory entry *")
    expect(admission(JSON.stringify({ permission: { external_directory: { "/**": "deny", [`${corpus}/**`]: "deny", "*": "allow" } } }), "external_directory", `${corpus}/*`)).not.toBe("deny")
    // A subtree allow (the shape fix once stamped past the seal).
    await edit({ "/**": "deny", [`${corpus}/**`]: "deny", [`${corpus}/sub/**`]: "allow" })
    const subtree = await wallPrecheckFindings(dir)
    expect(subtree.join("\n")).toContain(`${corpus}/sub/**`)
    expect(admission(JSON.stringify({ permission: { external_directory: { "/**": "deny", [`${corpus}/**`]: "deny", [`${corpus}/sub/**`]: "allow" } } }), "external_directory", `${corpus}/sub/*`)).not.toBe("deny")
    // Even the wall's own deny deleted: no live entry answers at all.
    await edit({ "/elsewhere/**": "deny" })
    const gone = await wallPrecheckFindings(dir)
    expect(gone.join("\n")).toContain("standing deny is gone")
    // An ask at the exact stamp slot: the driver's own bytes, re-asserted
    // by the finish (0155 D3's override) — the boundary passes with the
    // retirement line.
    await edit({ "/**": "deny", [`${corpus}/**`]: "ask" })
    const out = await captureRun(async () => {
      expect(await wallBoundary(ctx, phase)).toEqual([])
      return 0
    })
    expect(out.lines.join("\n")).toContain("finishing the interrupted wall retirement")
    expect((await opencode(dir)).permission.external_directory[`${corpus}/**`]).toBe("deny")
  })

  test("the failed wall commit teaches the re-run, and the re-run lands the record: the stamp-slot deny names the interrupted close (plans/0189 D2/D5, 0165-149)", async () => {
    const { dir, corpus, phase } = await wallProject()
    // The failing commit: the real retirement and door removal ran first.
    const failing: WallCtx = { directory: dir, git: { commitTree: async () => ({ ok: false, failures: [{ rel: "linux", error: "boom" }] }) }, opts: { stopBefore: "formulate" } }
    const blocked = await wallBoundary(failing, phase)
    expect(blocked.join("\n")).toContain("the wall commit failed")
    expect(blocked.join("\n")).toContain("re-run the same command")
    expect(blocked.join("\n")).toContain("Auto-Stage: wall")
    expect(blocked.join("\n")).toContain(`Wall-door: linux -> ${corpus}`)
    // The interrupted state on disk: door gone, stamp slot denied, no record.
    expect(existsSync(join(dir, "linux"))).toBe(false)
    expect((await opencode(dir)).permission.external_directory[`${corpus}/**`]).toBe("deny")
    expect(await findWallCommit(dir)).toBeUndefined()
    // The re-run IS the remedy: the close re-derives the state and the
    // record commit lands — carrying the door removal, which is the wall
    // commit's own tracked half.
    const retry: WallCtx = { directory: dir, git: { commitTree }, opts: { stopBefore: "formulate" } }
    expect(await wallBoundary(retry, phase)).toEqual([])
    const record = (await findWallCommit(dir))!
    expect(record.doors).toEqual([{ name: "linux", target: corpus }])
    const show = await git(dir, "show", "--name-status", "--format=", record.sha)
    expect(show.trim()).toBe("D\tlinux")
    expect(await wallPrecheckFindings(dir)).toEqual([])
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

  test("a person commit only mentioning the trailer in prose is the amendment, never the violation (plans/0173 D2)", async () => {
    const { dir, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    writeFileSync(join(dir, "docs/T-001/notes.md"), "# Notes (T-001)\n\nAmended, the message quoting the driver's mark.\n\n<!-- auto: eof -->\n")
    await git(dir, "add", "-A")
    // The last paragraph quotes the trailer mid-line — a person commit by
    // grammar (no trailer block), however loud the mention.
    await git(dir, "commit", "-qm", "person: note\n\nThis quotes the driver's Auto-Stage: implement marker in prose.")
    const amended = await captureRun(async () => {
      expect(await wallBoundary(ctx, phase)).toEqual([])
      return 0
    })
    expect(amended.lines.join("\n")).toContain("person-committed amendment")
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

  test("an unreadable history is a blocking finding, never a green freeze (plans/0155 D1: a scan failure is a red lane)", async () => {
    const { dir, phase, ctx } = await wallProject()
    expect(await wallBoundary(ctx, phase)).toEqual([])
    const record = (await findWallCommit(dir))!
    expect(record.sealed.length).toBeGreaterThan(0)
    // The one diff check cannot run (the wall commit's sha no longer
    // resolves — history surgery): the failure is the finding, never an
    // empty answer read as green.
    const problems = await sealedChannelCheck(dir, { ...record, sha: "0".repeat(40) })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("sealed-channel check failed")
    expect(problems[0]).toContain("cannot be asserted")
    expect(problems[0]).toContain("investigate the repository state")
  })
})
