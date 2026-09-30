// Unit tests for src/testrun.ts: handover steer construction (handoffSteer)
// and the handover criteria (since MA.3 in src/usage.ts: sessionHandoverDue /
// testHandoverDue, asserted here against opencode's events tier), test-script
// freezing (resolveTestScript), handover-document cleanup and restoration
// (cleanTestHandoffs/restoreTestHandoffs).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedFiles, commitTree } from "../src/git"
import { saveHandover } from "../src/handover"
import { planOf } from "./fixtures/units"
import {
  cleanTestHandoffs,
  handoffSteer,
  resolveTestScript,
  restoreTestHandoffs,
} from "../src/testrun"
import { sessionHandoverDue, testHandoverDue } from "../src/usage"
import { task } from "./fixtures/runner"

// Pure-function tests of handover steer construction and the handover decision
// (wired in executeWhole/runSubtask; full pipeline behavior is covered by the
// e2e in packages/auto).

describe("handoffSteer / sessionHandoverDue (OPENCODE_AUTO_STEER wiring)", () => {
  const cap = 64_000

  test("steer=on: builds a 2×cap handover steer whose text points at the handover document", () => {
    const steer = handoffSteer(true, cap, task)!
    expect(steer).toBeDefined()
    expect(steer.limit).toBe(cap * 2)
    expect(steer.text).toContain("docs/T-001/handoff.md")
    // The notice bands (plans/0056): 50% informational, 85% wind-down, each
    // text carrying the figure slots watch fills at send time.
    expect(steer.notes.map((note) => note.at)).toEqual([0.5, 0.85])
    expect(steer.notes[0]!.text).toContain("{{used}}")
    expect(steer.notes[0]!.text).toContain("{{pct}}")
    expect(steer.notes[0]!.text).toContain("{{wall}}")
    expect(steer.notes[1]!.text).toContain("docs/T-001/handoff.md")
    expect(steer.notes[1]!.text).toContain("Status: continue")
  })

  // The steerWall and fillUsageNote tables are re-homed into the usage
  // concern's suite (test/turn-usage.test.ts) since the concern was
  // extracted: watch's measurement cell was their only consumer, and the
  // policies are pinned beside the cells that apply them. handoffSteer
  // (the steer's construction from the task) is execute's, and its cases
  // stay here.

  test("steer=off: no handover steer built (no handover hint injected into the session)", () => {
    expect(handoffSteer(false, cap, task)).toBeUndefined()
  })

  test("steer=off: a naturally finished session simply settles — usage far beyond 2×cap still demands no handover document (handover decision disabled)", () => {
    expect(sessionHandoverDue("events", undefined, cap * 10)).toBe(false)
  })

  test("steer=on: handover demanded only when usage reaches 2×cap; below the threshold it finishes naturally", () => {
    const steer = handoffSteer(true, cap, task)!
    expect(sessionHandoverDue("events", steer, steer.limit)).toBe(true)
    expect(sessionHandoverDue("events", steer, steer.limit + 1)).toBe(true)
    expect(sessionHandoverDue("events", steer, steer.limit - 1)).toBe(false)
    expect(sessionHandoverDue("events", steer, 0)).toBe(false)
  })
})

// Test-handover criteria (handover-trigger decoupling, D1): sits beside
// handoverDue — two thresholds, two semantics; the former is the ondemand
// context handover's 2×cap, this one is the single --handover-test contextLimit
// condition, and the decision point is fixed at "the moment the AI initiates
// the test".
describe("testHandoverDue (--handover-test criteria)", () => {
  const test64k = { handover: true, limit: 64_000, startUsed: 0 }

  test("decoupled: test success or failure is irrelevant; context reaching contextLimit alone triggers the handover", () => {
    expect(testHandoverDue(test64k, 64_000)).toBe(true)
    expect(testHandoverDue(test64k, 64_001)).toBe(true)
    expect(testHandoverDue(test64k, 63_999)).toBe(false)
  })

  test("switch off (--handover-test not enabled): no handover however high the usage", () => {
    expect(testHandoverDue({ ...test64k, handover: false }, 640_000)).toBe(false)
  })

  test("when live usage is unavailable it falls back to the start value: a reused session already over the limit at start is detected on the first test request", () => {
    const resumed = { handover: true, limit: 64_000, startUsed: 120_000 }
    expect(testHandoverDue(resumed, 0)).toBe(true)
    // As soon as a live value arrives it wins (monotonic; the fallback only acts in the used=0 window).
    expect(testHandoverDue(resumed, 1_000)).toBe(false)
  })

  test("a fresh/forked session's start value resets to zero: the previous session's leftover value must not be misjudged as over the limit", () => {
    expect(testHandoverDue(test64k, 0)).toBe(false)
  })
})

// Consumption of the request marker (test-handover sequencing E1): the
// sequential state settles the script and takes the marker away at the freeze
// moment, execution is deferred until after the handover close-out — so
// "resolving the script" must be testable independently of "running it".
describe("resolveTestScript (consuming the tmp/test.sh request marker)", () => {
  let dir = ""
  let tmp = ""

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-test-script-"))
    tmp = join(dir, "tmp")
    await mkdir(tmp, { recursive: true })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("test/ path shape: takes that script directly, no tmp/test.<n>.sh produced", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    await writeFile(join(dir, "test", "build.sh"), "echo hi")
    await writeFile(join(tmp, "test.sh"), "test/build.sh")
    const run = { dir, tmp, seq: 0 }
    expect(await resolveTestScript(run)).toEqual({ script: join(dir, "test", "build.sh"), seq: 1 })
    expect(await Bun.file(join(tmp, "test.1.sh")).exists()).toBe(false)
  })

  // The criterion is "single line after trim": printf/echo writes usually
  // carry a trailing newline — the norm for AI-written files — and must not
  // fall into the inline fallback for that (the inline snapshot has bash run
  // the path as a command; a script without +x gets 126).
  test("trailing newline after the path: judged as a single line after trim, still the test/ path shape", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    await writeFile(join(dir, "test", "build.sh"), "echo hi")
    await writeFile(join(tmp, "test.sh"), "test/build.sh\n")
    const pending = await resolveTestScript({ dir, tmp, seq: 0 })
    expect(pending).toEqual({ script: join(dir, "test", "build.sh"), seq: 1 })
    expect(await Bun.file(join(tmp, "test.1.sh")).exists()).toBe(false)
  })

  // AI-written scripts often miss chmod +x: the path shape gets a best-effort
  // fix from the driver, no session-side troubleshooting needed.
  test("test/ path shape: the driver adds chmod +x when the script lacks the execute bit", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    const target = join(dir, "test", "build.sh")
    await writeFile(target, "echo hi", { mode: 0o644 })
    await writeFile(join(tmp, "test.sh"), "test/build.sh")
    const pending = await resolveTestScript({ dir, tmp, seq: 0 })
    expect(pending.script).toBe(target)
    const mode = (await stat(target)).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  test("inline shape fallback: written whole as tmp/test.<n>.sh, preserving the execution snapshot", async () => {
    await writeFile(join(tmp, "test.sh"), "set -e\necho inline\n")
    const run = { dir, tmp, seq: 4 }
    const pending = await resolveTestScript(run)
    expect(pending).toEqual({ script: join(tmp, "test.5.sh"), seq: 5 })
    expect(await Bun.file(pending.script).text()).toBe("set -e\necho inline\n")
  })

  test("single line but pointing at a nonexistent file: treated as an inline script (not misjudged as a path)", async () => {
    await writeFile(join(tmp, "test.sh"), "make check")
    const run = { dir, tmp, seq: 0 }
    const pending = await resolveTestScript(run)
    expect(pending.script).toBe(join(tmp, "test.1.sh"))
    expect(await Bun.file(pending.script).text()).toBe("make check")
  })

  test("the marker is deleted once read and the sequence increments: a marker rewritten during the session wrap-up cannot make the driver run the wrong script", async () => {
    await writeFile(join(tmp, "test.sh"), "echo one")
    const run = { dir, tmp, seq: 0 }
    expect((await resolveTestScript(run)).seq).toBe(1)
    expect(await Bun.file(join(tmp, "test.sh")).exists()).toBe(false)
    expect(run.seq).toBe(1)

    await writeFile(join(tmp, "test.sh"), "echo two")
    expect((await resolveTestScript(run)).seq).toBe(2)
    expect(run.seq).toBe(2)
  })
})

// Stale cleanup and scene restoration of test-handover documents (interruption
// recovery F3/F4): driven against a real temp git repository — the criterion
// itself is "tracked by git or not", which no double can cover.
describe("cleanTestHandoffs / restoreTestHandoffs (test-handover interruption recovery)", () => {
  const t028 = planOf(`## T-028: land the code [in_progress]\nBody.\n`).tasks[0]!

  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-handover-runner-"))
    const proc = Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "ignore", stderr: "ignore" })
    await proc.exited
    await mkdir(join(dir, "docs", "T-028", "S03"), { recursive: true })
    await writeFile(join(dir, "README.md"), "# README\n")
    return dir
  }

  test("an archived in-flight document is not deleted: deleting it would create a dirty area and slam the next execution unit's clean gate", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "handover body\n\nStatus: continue\n")
      await commitTree(dir, { id: "T-028", title: "land the code" }, { stage: "subtask 3 handoff-1", subject: "T-028 test handover #1" })
      await cleanTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an untracked leftover is deleted as usual", async () => {
    const dir = await fixture()
    try {
      await writeFile(join(dir, "README.md"), "# README\n")
      await commitTree(dir, { id: "T-028", title: "land the code" }, { stage: "execute", subject: "T-028 baseline" })
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "leftover from the previous attempt")
      await cleanTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("with an in-flight handover record the whole step is skipped (the untracked current copy is kept too)", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "the session is writing")
      await saveHandover(dir, { task: "T-028", scope: rel, unit: "subtask 3", n: 1 })
      await cleanTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("scene restoration: an archived document deleted by the previous run is retrieved and the dirty area disappears", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "handover body\n\nStatus: continue\n")
      await commitTree(dir, { id: "T-028", title: "land the code" }, { stage: "subtask 3 handoff-1", subject: "T-028 test handover #1" })
      await rm(join(dir, rel), { force: true })
      expect(await changedFiles(dir)).toEqual([rel])
      await restoreTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, rel)).text()).toContain("Status: continue")
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("scene restoration recognizes only this task's handover documents", async () => {
    const dir = await fixture()
    try {
      await mkdir(join(dir, "docs", "T-029"), { recursive: true })
      const mine = join("docs", "T-028", "S03", "testhandoff.md")
      const other = join("docs", "T-029", "testhandoff.md")
      const report = join("docs", "T-028", "S03", "index.md")
      for (const rel of [mine, other, report]) await writeFile(join(dir, rel), "Body.\n")
      await commitTree(dir, { id: "T-028", title: "land the code" }, { stage: "execute", subject: "T-028 baseline" })
      for (const rel of [mine, other, report]) await rm(join(dir, rel), { force: true })
      await restoreTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, mine)).exists()).toBe(true)
      expect(await Bun.file(join(dir, other)).exists()).toBe(false)
      expect(await Bun.file(join(dir, report)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
