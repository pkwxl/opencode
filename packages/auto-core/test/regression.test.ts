// The regression lane (plans/0098): the two-level pass's complete tier —
// round-scoped receipts, the coverage predicate (the carry-forward rule read
// at phase scope), the background slot, the phase-close hold and the strict
// test-readiness. Stage B's pure half and Stage C's runner live here: the
// receipt home, the role, the coverage predicate over real repositories,
// the in-tree and isolated runners, the boundary's janitorial commit.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { latestRegressionSeq, regressionReceiptDoc } from "../src/docpaths"
import { ROLE_POLICIES, roleOf } from "../src/document/roles"
import { parseLaneReceipt, type TestLane } from "../src/intent/test-lanes"
import { commitTree } from "../src/git"
import { phaseType } from "../src/phases/registry"
import { ensureRegressionGreen, newestGreenReceipt, recoverRegression, regressionBoundary, regressionCovered, regressionHoldLines, regressionInFlight, regressionLanes, regressionRepairInput, REGRESSION_COPY, roundNumberOf, runRegressionLane, strictRegressionWait } from "../src/regression"
import { EOF_MARK } from "../src/doccheck"
import { freshRepo, git } from "./fixtures/runner"

const lane: TestLane = { name: "verify-full", command: "bash test/verify_full.sh", cost: "regression", surfaces: ["src/", "include/"], exclusive: true }

// A driver-shaped receipt on disk, the writeLaneReceipt fields verbatim.
const receiptText = (heads: string, verdict: "green" | "red", end: string): string =>
  ["# Lane verify-full", "", `Lane: verify-full`, `Heads: .=${heads}`, `Start: ${end}`, `End: ${end}`, `Verdict: ${verdict}`, `Log: /tmp/opencode/r1.log`, "", EOF_MARK, ""].join("\n")

const writeReceipt = (dir: string, seq: number, text: string) => {
  const rel = regressionReceiptDoc(1, seq, lane.name)
  mkdirSync(join(dir, join(rel, "..")), { recursive: true })
  writeFileSync(join(dir, rel), text)
  return rel
}

describe("the regression receipt home (plans/0098 D2)", () => {
  test("the path constructor and the seq scan", async () => {
    expect(regressionReceiptDoc(1, 3, "verify-full")).toBe(join("docs", "R-01", "regression", "3-verify-full.md"))
    const dir = mkdtempSync(join(tmpdir(), "auto-regression-"))
    try {
      expect(await latestRegressionSeq(dir, 1)).toBe(0)
      writeReceipt(dir, 2, receiptText("abc123", "green", "2026-10-15T10:00:00Z"))
      writeReceipt(dir, 11, receiptText("abc123", "green", "2026-10-15T11:00:00Z"))
      expect(await latestRegressionSeq(dir, 1)).toBe(11)
      // Another round's directory is not this round's counter.
      expect(await latestRegressionSeq(dir, 2)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the role: driver-written round-level evidence, eof-scanned, P1-exempt", () => {
    expect(roleOf(join("docs", "R-01", "regression", "3-verify-full.md"))).toBe("regression")
    expect(roleOf(join("docs", "R-01", "regression", "notes.md"))).toBe("artifact")
    expect(roleOf(join("docs", "T-003", "regression", "3-verify-full.md"))).toBe("artifact")
    expect(ROLE_POLICIES.regression).toEqual({ eofScan: true, process: true })
  })

  test("parseLaneReceipt reads the round receipts' machine fields unchanged", () => {
    expect(parseLaneReceipt(receiptText("deadbeef99", "green", "2026-10-15T10:00:00Z"))).toEqual({
      lane: "verify-full",
      heads: [{ root: ".", sha: "deadbeef99" }],
      verdict: "green",
      end: "2026-10-15T10:00:00Z",
    })
  })

  test("roundNumberOf parses the phase unit's round name; regressionLanes keeps the floor undefined", () => {
    expect(roundNumberOf({ round: "R-01" })).toBe(1)
    expect(roundNumberOf({ round: "R-12" })).toBe(12)
    expect(regressionLanes(undefined)).toBeUndefined()
    expect(regressionLanes([{ name: "lint", command: "x", cost: "cheap", surfaces: ["src/"], exclusive: false }])).toBeUndefined()
    expect(regressionLanes([lane, { name: "lint", command: "x", cost: "cheap", surfaces: ["src/"], exclusive: false }])).toEqual([lane])
  })
})

describe("the coverage predicate (regressionCovered — the complete-pass rule, plans/0098 D3)", () => {
  test("no receipt, a red receipt, or a headless one never cover (the fail-safe direction)", async () => {
    const dir = await freshRepo()
    try {
      writeFileSync(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(false)
      const head = (await git(dir, "rev-parse", "HEAD")).trim()
      writeReceipt(dir, 1, receiptText(head, "red", "2026-10-15T10:00:00Z"))
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(false)
      expect((await newestGreenReceipt(dir, 1, lane.name))).toBeUndefined()
      writeReceipt(dir, 2, ["# Lane verify-full", "", "Lane: verify-full", "Heads: ", "Verdict: green", "", EOF_MARK, ""].join("\n"))
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a green receipt at the current HEADs covers; a later change on its surfaces uncovers with the diff as the attribution basis", async () => {
    const dir = await freshRepo()
    try {
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "a.ts"), "a\n")
      mkdirSync(join(dir, "docs"), { recursive: true })
      writeFileSync(join(dir, "docs", "note.md"), "note\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const head = (await git(dir, "rev-parse", "HEAD")).trim()
      writeReceipt(dir, 1, receiptText(head, "green", "2026-10-15T10:00:00Z"))
      expect(await regressionCovered(dir, 1, lane)).toEqual({ covered: true, receipt: await newestGreenReceipt(dir, 1, lane.name) })
      // A newer green receipt wins by its End time; an older stale one does
      // not shadow it.
      writeReceipt(dir, 2, receiptText(head, "green", "2026-10-15T12:00:00Z"))
      expect((await newestGreenReceipt(dir, 1, lane.name))?.end).toBe("2026-10-15T12:00:00Z")
      // A change off the lane's surfaces keeps it covered (docs only).
      writeFileSync(join(dir, "docs", "note.md"), "changed\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "doc change")
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(true)
      // A change on its surfaces uncovers it, the diff named (the receipts
      // themselves ride the diff once committed — off-surfaces, harmless).
      writeFileSync(join(dir, "src", "a.ts"), "a changed\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "source change")
      const uncovered = await regressionCovered(dir, 1, lane)
      expect(uncovered.covered).toBe(false)
      expect(uncovered.changed).toContain(join("src", "a.ts"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the runner (runRegressionLane — one lane, both modes, plans/0098 D4)", () => {
  const clean = (paths: string[]) => {
    for (const path of paths) rmSync(path, { recursive: true, force: true })
  }

  test("the in-tree window: green writes a round receipt whose heads vouch for the tree; the log carries LANE_RC", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-regression-logs-"))
    try {
      writeFileSync(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      const run = await runRegressionLane(dir, 1, { ...lane, command: "echo full-gate-green" }, { isolate: false, logDir })
      expect(run).toMatchObject({ lane: "verify-full", verdict: "green", code: 0 })
      expect(run.receipt).toBe(regressionReceiptDoc(1, 1, lane.name))
      const text = await Bun.file(join(dir, run.receipt)).text()
      const parsed = parseLaneReceipt(text)
      expect(parsed).toMatchObject({ lane: "verify-full", verdict: "green", heads: [{ root: ".", sha: head }] })
      expect(text.trimEnd().endsWith(EOF_MARK)).toBe(true)
      expect(await Bun.file(run.log).text()).toContain("LANE_RC=0")
      // Green at these heads: the coverage predicate now passes.
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(true)
    } finally {
      clean([dir, logDir])
    }
  })

  test("the in-tree window: red carries the bounded evidence and never covers", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-regression-logs-"))
    try {
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const run = await runRegressionLane(dir, 1, { ...lane, command: "echo 'the regression gate failed at the snapshot test' >&2; exit 3" }, { isolate: false, logDir })
      expect(run).toMatchObject({ verdict: "red", code: 3 })
      const text = await Bun.file(join(dir, run.receipt)).text()
      expect(text).toContain("the regression gate failed at the snapshot test")
      expect(parseLaneReceipt(text)?.verdict).toBe("red")
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(false)
    } finally {
      clean([dir, logDir])
    }
  })

  test("the watchdog kills a silent lane as red (the runScript discipline)", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-regression-logs-"))
    try {
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const run = await runRegressionLane(dir, 1, { ...lane, command: "sleep 5" }, { isolate: false, logDir, idleMs: 150, pollMs: 30 })
      expect(run).toMatchObject({ verdict: "red", code: 124, timedOut: true, timeoutReason: "idle" })
      expect(await Bun.file(join(dir, run.receipt)).text()).toContain("killed by the watchdog")
    } finally {
      clean([dir, logDir])
    }
  })

  test("the isolated background copy: the command runs in the copy, the main tree stays untouched, the copy is removed and the marker cleared", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-regression-logs-"))
    try {
      writeFileSync(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      // The command reports its own cwd (the copy) and mutates its tree —
      // neither may touch the main tree.
      const run = await runRegressionLane(dir, 1, { ...lane, command: "pwd && echo mutated >> src.ts" }, { isolate: true, reflink: false, logDir })
      expect(run.verdict).toBe("green")
      const logged = await Bun.file(run.log).text()
      expect(logged).toContain(join(dir, REGRESSION_COPY))
      // The main tree: unmutated, no copy left, no marker left, and the
      // receipt's heads vouch for the committed tree the copy materialized.
      expect(await Bun.file(join(dir, "src.ts")).text()).toBe("// baseline\n")
      expect(existsSync(join(dir, REGRESSION_COPY))).toBe(false)
      expect(existsSync(join(dir, ".auto", "regression.json"))).toBe(false)
      expect(parseLaneReceipt(await Bun.file(join(dir, run.receipt)).text())?.heads).toEqual([{ root: ".", sha: head }])
      // The seq advanced: a second run lands as receipt 2 (append-only history).
      const again = await runRegressionLane(dir, 1, { ...lane, command: "true" }, { isolate: true, reflink: false, logDir })
      expect(again.receipt).toBe(regressionReceiptDoc(1, 2, lane.name))
    } finally {
      clean([dir, logDir])
    }
  })
})

describe("the boundary and the orphan recovery (plans/0098 D4)", () => {
  const phase = { round: "R-01", id: "P01", type: "implement", entry: phaseType("implement")!, dir: "docs/R-01/P01-implement" }

  test("the janitorial commit: a pending receipt is the boundary's own commit; foreign dirt keeps its owner", async () => {
    const dir = await freshRepo()
    try {
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      writeReceipt(dir, 1, receiptText((await git(dir, "rev-parse", "--short", "HEAD")).trim(), "green", "2026-10-15T10:00:00Z"))
      // testByDriver off and no lane table: the launch machinery is inert,
      // but the receipt still must not dirty the next unit's start gate.
      await regressionBoundary({ directory: dir, git: { commitTree } }, { dir, testByDriver: false }, phase)
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: regression")
      // Foreign dirt beside a pending receipt: no dedicated commit sweeps it.
      writeReceipt(dir, 2, receiptText((await git(dir, "rev-parse", "--short", "HEAD")).trim(), "green", "2026-10-15T11:00:00Z"))
      writeFileSync(join(dir, "src.ts"), "someone else's work\n")
      await regressionBoundary({ directory: dir, git: { commitTree } }, { dir, testByDriver: false }, phase)
      const status = await git(dir, "status", "--porcelain")
      expect(status).toContain("docs/R-01/regression/2-verify-full.md")
      expect(status).toContain("src.ts")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the orphan recovery: a stale marker and copy are discarded loudly; a clean directory is untouched", async () => {
    const dir = await freshRepo()
    try {
      await recoverRegression(dir)
      expect(existsSync(join(dir, ".auto"))).toBe(false)
      mkdirSync(join(dir, REGRESSION_COPY), { recursive: true })
      writeFileSync(join(dir, REGRESSION_COPY, "leftover"), "x")
      await Bun.write(join(dir, ".auto", "regression.json"), JSON.stringify({ inflight: { lane: lane.name, seq: 1, heads: [{ root: ".", sha: "abc" }], log: "/tmp/x.log", started: "2026-10-15T10:00:00Z" } }) + "\n")
      await recoverRegression(dir)
      expect(existsSync(join(dir, REGRESSION_COPY))).toBe(false)
      expect(existsSync(join(dir, ".auto", "regression.json"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the boundary never launches on a filesystem that cannot clone: the run defers (this host's tmpfs reality)", async () => {
    const dir = await freshRepo()
    try {
      mkdirSync(join(dir, ".opencode", "auto", "intents"), { recursive: true })
      writeFileSync(
        join(dir, ".opencode", "auto", "intents", "default.md"),
        ["# default", "", "## quality", "", "### test-lanes", "", "verify-full:", "Command: true", "Cost: regression", "Surfaces: src/", "Exclusive: yes", ""].join("\n"),
      )
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      // A stale lane (no receipt at all) on a tmpfs scratch: no reflink, so
      // no background copy — no receipt, no in-flight slot.
      await regressionBoundary({ directory: dir, git: { commitTree } }, { dir, testByDriver: true }, phase)
      expect(regressionInFlight(dir)).toBeUndefined()
      expect(await Bun.file(join(dir, regressionReceiptDoc(1, 1, lane.name))).exists()).toBe(false)
      // The second boundary stays silent (the once-per-directory deferral).
      await regressionBoundary({ directory: dir, git: { commitTree } }, { dir, testByDriver: true }, phase)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the phase-close hold (ensureRegressionGreen — plans/0098 D5)", () => {
  const phase = { round: "R-01", id: "P01", type: "implement", entry: phaseType("implement")!, dir: "docs/R-01/P01-implement" }
  const tasks = [
    { id: "T-001", title: "migrate the widget core" },
    { id: "T-002", title: "write the docs" },
  ]
  const withPack = (dir: string, command: string) => {
    mkdirSync(join(dir, ".opencode", "auto", "intents"), { recursive: true })
    writeFileSync(
      join(dir, ".opencode", "auto", "intents", "default.md"),
      ["# default", "", "## quality", "", "### test-lanes", "", "verify-full:", `Command: ${command}`, "Cost: regression", "Surfaces: src/", "Exclusive: yes", ""].join("\n"),
    )
  }
  // The unit's own commits carry the Auto-Task trailer taskChangedPaths scans.
  const taskCommit = async (dir: string, task: string, path: string | null, content: string) => {
    if (path !== null) {
      mkdirSync(join(dir, join(path, "..")), { recursive: true })
      writeFileSync(join(dir, path), content)
      await git(dir, "add", "-A")
    }
    return git(dir, "commit", "--allow-empty", "-qm", `${task} exec`, "-m", `Auto-Task: ${task}`)
  }

  test("covered lanes pass through without running anything; the floor conditions return ok with no runs at all", async () => {
    const dir = await freshRepo()
    try {
      withPack(dir, "echo must-not-run")
      await taskCommit(dir, "T-001", "src/a.ts", "a\n")
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      writeReceipt(dir, 1, receiptText(head, "green", "2026-10-15T10:00:00Z"))
      const covered = await ensureRegressionGreen({ directory: dir, git: { commitTree } }, { dir, testByDriver: true }, phase, tasks)
      expect(covered).toEqual({ kind: "ok" })
      expect(await latestRegressionSeq(dir, 1)).toBe(1)
      // The floor: no channel, nothing runs even though the lane is stale.
      const off = await ensureRegressionGreen({ directory: dir, git: { commitTree } }, { dir, testByDriver: false }, phase, tasks)
      expect(off).toEqual({ kind: "ok" })
      writeReceipt(dir, 2, receiptText((await git(dir, "rev-parse", "--short", "HEAD")).trim(), "red", "2026-10-15T11:00:00Z"))
      const stillOff = await ensureRegressionGreen({ directory: dir, git: { commitTree } }, { dir, testByDriver: false }, phase, tasks)
      expect(stillOff).toEqual({ kind: "ok" })
      expect(await latestRegressionSeq(dir, 1)).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a stale lane runs at the close window; green passes and its receipt is committed by the hold itself", async () => {
    const dir = await freshRepo()
    try {
      withPack(dir, "echo full-gate-green")
      await taskCommit(dir, "T-001", "src/a.ts", "a\n")
      const held = await ensureRegressionGreen({ directory: dir, git: { commitTree } }, { dir, testByDriver: true }, phase, tasks)
      expect(held).toEqual({ kind: "ok" })
      expect(await latestRegressionSeq(dir, 1)).toBe(1)
      // The janitorial commit landed inside the hold: the tree is clean and
      // the receipt carries the driver's stage.
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: regression")
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a red lane holds the phase with its suspects named, the receipts committed, and the repair input carrying the evidence", async () => {
    const dir = await freshRepo()
    try {
      withPack(dir, "echo 'the widget regressed at the edge case' >&2; exit 4")
      await taskCommit(dir, "T-001", "src/a.ts", "a\n")
      const green = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      writeReceipt(dir, 1, receiptText(green, "green", "2026-10-15T10:00:00Z"))
      // T-001's post-green change touches the lane's surfaces; T-002's does
      // not — only T-001 is a suspect.
      await taskCommit(dir, "T-001", "src/a.ts", "a changed\n")
      await taskCommit(dir, "T-002", "docs/note.md", "note\n")
      const held = await ensureRegressionGreen({ directory: dir, git: { commitTree } }, { dir, testByDriver: true }, phase, tasks)
      expect(held.kind).toBe("held")
      if (held.kind !== "held") return
      expect(held.lanes).toHaveLength(1)
      expect(held.lanes[0]).toMatchObject({ lane: "verify-full" })
      expect(held.lanes[0]!.suspects).toEqual([{ id: "T-001", title: "migrate the widget core" }])
      // The red receipt is committed evidence (the tree clean) and its
      // bounded evidence rides the repair input with the suspect named.
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      const receiptText2 = await Bun.file(join(dir, held.lanes[0]!.receipt)).text()
      expect(receiptText2).toContain("the widget regressed at the edge case")
      const input = regressionRepairInput(phase, held.lanes)
      expect(input).toContain("T-001 migrate the widget core")
      expect(input).toContain("the widget regressed at the edge case")
      expect(input).toContain("Append repair tasks that fix what the receipts found")
      const lines = regressionHoldLines(dir, phase, held.lanes)
      expect(lines[0]).toContain("held by its regression gate")
      expect(lines.some((line) => line.includes("T-001"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a close-time run that moves HEAD is the corrupted-baseline family", async () => {
    const dir = await freshRepo()
    try {
      withPack(dir, "git commit --allow-empty -qm sneaky")
      await taskCommit(dir, "T-001", "src/a.ts", "a\n")
      const corrupted = await ensureRegressionGreen({ directory: dir, git: { commitTree } }, { dir, testByDriver: true }, phase, tasks)
      expect(corrupted).toMatchObject({ kind: "corrupted" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the strict test-readiness (strictRegressionWait — plans/0098 D7)", () => {
  const strictLane: TestLane = { ...lane, strict: true }
  const opts = { testByDriver: true } as const

  test("complete dependencies proceed; the current unit's own building atop them never blocks", async () => {
    const dir = await freshRepo()
    try {
      // An initial commit — a root commit's diff-tree names no paths, and a
      // real dependency always lands on history.
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      // T-001 (the dependency) lands, then the green receipt vouches it.
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "a.ts"), "a\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "T-001 exec", "-m", "Auto-Task: T-001")
      const green = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      writeReceipt(dir, 1, receiptText(green, "green", "2026-10-15T10:00:00Z"))
      // The current unit's own commits touch the dependency's paths — its
      // own testing assesses that building; no wait, no run.
      writeFileSync(join(dir, "src", "a.ts"), "a built-upon\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "T-002 exec", "-m", "Auto-Task: T-002")
      const wait = await strictRegressionWait(dir, 1, [strictLane], ["T-001"], "T-002", opts)
      expect(wait).toBeUndefined()
      expect(await latestRegressionSeq(dir, 1)).toBe(1)
      // No dependencies at all, or nothing strict declared: the standard.
      expect(await strictRegressionWait(dir, 1, [strictLane], [], "T-002", opts)).toBeUndefined()
      expect(await strictRegressionWait(dir, 1, [lane], ["T-001"], "T-002", opts)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a dependency changed after the receipt makes the wait run it; green completes, red blocks with the run's facts", async () => {
    const greenDir = await freshRepo()
    try {
      await git(greenDir, "commit", "--allow-empty", "-qm", "init")
      mkdirSync(join(greenDir, "src"), { recursive: true })
      writeFileSync(join(greenDir, "src", "a.ts"), "a\n")
      await git(greenDir, "add", "-A")
      await git(greenDir, "commit", "-qm", "T-001 exec", "-m", "Auto-Task: T-001")
      const green = (await git(greenDir, "rev-parse", "--short", "HEAD")).trim()
      writeReceipt(greenDir, 1, receiptText(green, "green", "2026-10-15T10:00:00Z"))
      // A THIRD task changes the dependency's paths after the receipt: the
      // strict wait must run the lane before T-002's testing proceeds.
      writeFileSync(join(greenDir, "src", "a.ts"), "a moved\n")
      await git(greenDir, "add", "-A")
      await git(greenDir, "commit", "-qm", "T-003 exec", "-m", "Auto-Task: T-003")
      const laneNow = { ...strictLane, command: "echo strict-green" }
      const wait = await strictRegressionWait(greenDir, 1, [laneNow], ["T-001"], "T-002", opts)
      expect(wait).toBeUndefined()
      expect(await latestRegressionSeq(greenDir, 1)).toBe(2)
      expect((await regressionCovered(greenDir, 1, laneNow)).covered).toBe(true)
    } finally {
      rmSync(greenDir, { recursive: true, force: true })
    }
    const redDir = await freshRepo()
    try {
      await git(redDir, "commit", "--allow-empty", "-qm", "init")
      mkdirSync(join(redDir, "src"), { recursive: true })
      writeFileSync(join(redDir, "src", "a.ts"), "a\n")
      await git(redDir, "add", "-A")
      await git(redDir, "commit", "-qm", "T-001 exec", "-m", "Auto-Task: T-001")
      writeFileSync(join(redDir, "src", "a.ts"), "a moved\n")
      await git(redDir, "add", "-A")
      await git(redDir, "commit", "-qm", "T-003 exec", "-m", "Auto-Task: T-003")
      const laneRed = { ...strictLane, command: "echo 'the dependency regressed' >&2; exit 5" }
      const blocked = await strictRegressionWait(redDir, 1, [laneRed], ["T-001"], "T-002", opts)
      expect(blocked).toBeDefined()
      expect(blocked && "run" in blocked ? blocked.run : undefined).toMatchObject({ verdict: "red", code: 5 })
      expect(blocked && "deps" in blocked ? blocked.deps : undefined).toEqual(["T-001"])
    } finally {
      rmSync(redDir, { recursive: true, force: true })
    }
  })
})
