import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderAgentsBlock } from "../src/agents-block"
import { checkPrinciple } from "../src/check"
import { ensurePointer } from "../src/agents-block"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

// The refcheck switch (refcheck-scope-design D3): the reference-check hook-point
// tests run with the switch injected on (parseSwitches as a pure-function
// injection, bypassing the environment-variable memo).
const REFCHECK_ON = parseSwitches({ [SWITCH_ENV.refCheck]: "on" })

describe("checkPrinciple", () => {
  test("testByDriver on: flags descriptions asking the session itself to run compile/test/build/lint; not checked when off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ testByDriver: true }))
      await Bun.write(
        join(dir, "docs/T-001/todo.md"),
        ["# T-001: Normal task", "", "Implement the feature and write unit tests yourself.", "The test scripts go in test/, their paths written to tmp/test.sh, run by the driver.", ""].join("\n"),
      )
      await Bun.write(
        join(dir, "docs/T-002/todo.md"),
        ["# T-002: Violating task", "", "Run the unit tests after finishing to confirm everything passes.", "Please run the build to confirm there are no type errors.", "run the tests before finishing.", ""].join("\n"),
      )
      // completed tasks (done.md) are no longer checked
      await Bun.write(join(dir, "docs/T-000/done.md"), "# T-000: Old task\n\nRun the unit tests after finishing to confirm everything passes.\n")
      const { findings, notes } = await checkPrinciple(dir)
      // three violations: run the unit tests / run the build / run the tests, one each
      expect(findings.length).toBe(3)
      expect(findings[0]).toMatchObject({ file: "docs/T-002/todo.md", task: "T-002", line: 3 })
      expect(findings[1]).toMatchObject({ file: "docs/T-002/todo.md", task: "T-002", line: 4 })
      expect(findings[2]).toMatchObject({ file: "docs/T-002/todo.md", task: "T-002", line: 5 })
      // writing (not an execution verb) and driver-attribution lines do not count; missing AGENTS.md produces the note
      expect(notes).toEqual([`AGENTS.md does not exist, run opencode-auto fix ${dir} to add the opencode-auto block`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("verification-style descriptions are outside the principle check (verify retired, plans/0044): not a violation, and no prompt to back-fill a verify principle block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(
        join(dir, "docs/T-001/todo.md"),
        ["# T-001: Task", "", "Run the acceptance commands after finishing to confirm everything passes.", "Please run the verify script and paste the results into the report.", ""].join("\n"),
      )
      await Bun.write(
        join(dir, "AGENTS.md"),
        ["# AGENTS.md", "", "Run the verification script at the end of the session and record the exit code.", ""].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      expect(notes).toEqual([`AGENTS.md is missing the opencode-auto block, run opencode-auto fix to add it`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("invalid config: treated as disabled with a note; the commit principle is still checked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ idleTime: 999 }))
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nAfter finishing, run git commit -m done.\n")
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings.length).toBe(1)
      expect(notes[0]).toContain("project config (.opencode/auto/config.json) is invalid, test principle checks treated as disabled")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("flags descriptions asking the session to make git commits; negated sentences and driver-attribution sentences pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(
        join(dir, "docs/T-001/todo.md"),
        [
          "# T-001: Violating task",
          "Phase: R-01.P01",
          "",
          "After finishing, run git add -A and git commit -m done.",
          "Commit all uncommitted changes after finishing each module.",
          "Do not run git commit; the unified commit is run by the driver.",
          "Commit messages follow the repository's existing style.",
          "",
        ].join("\n"),
      )
      const { findings } = await checkPrinciple(dir)
      expect(findings.length).toBe(2)
      expect(findings[0]).toMatchObject({ file: "docs/T-001/todo.md", task: "T-001", line: 4 })
      expect(findings[1]).toMatchObject({ file: "docs/T-001/todo.md", task: "T-001", line: 5 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the opencode-auto block in AGENTS.md is skipped as a whole; no notes after init back-fills it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ testByDriver: true }))
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      const before = await checkPrinciple(dir)
      expect(before.findings).toEqual([])
      expect(before.notes.length).toBe(1)
      // after init back-fills the opencode-auto block (every section: test / commit /
      // summary / maintenance rules / reference rules), the driver-execution wording
      // inside the block no longer triggers notes; ensurePointer takes its switches
      // from the same config.json, matching the basis checkPrinciple uses when
      // comparing the render
      const ensured = await ensurePointer(dir, { testByDriver: true })
      expect(ensured).toEqual({ block: "inserted", legacyRemoved: 0 })
      const after = await checkPrinciple(dir)
      expect(after.findings).toEqual([])
      expect(after.notes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the rendered content has no verify section (verify retired); the legacy verify sub-block is removed as a stray marker block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    const legacy = "<!-- opencode-auto:verify:start -->\nVerify principle: verification is run by the driver.\n<!-- opencode-auto:verify:end -->"
    try {
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      await Bun.write(join(dir, "AGENTS.md"), `# AGENTS.md\n\nLeading text.\n\n${legacy}\n\nTrailing text.\n`)
      const ensured = await ensurePointer(dir)
      expect(ensured.block).toBe("inserted")
      expect(ensured.legacyRemoved).toBe(1)
      const written = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(written).not.toContain("opencode-auto:verify:start")
      expect(written).not.toContain("verification is run by the driver")
      expect(written).not.toContain("Verify principle:")
      expect(written).toContain("Leading text.")
      expect(written).toContain("Trailing text.")
      expect(written).toMatch(/Leading text\.\n\nTrailing text\./)
      expect(written).toContain("opencode-auto:start")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("testByDriver off: the rendered content has no test section; the legacy test sub-block is removed as a stray marker block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    const legacy = "<!-- opencode-auto:test:start -->\nTest principle: builds/tests are run by the driver.\n<!-- opencode-auto:test:end -->"
    try {
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      await Bun.write(join(dir, "AGENTS.md"), `# AGENTS.md\n\nLeading text.\n\n${legacy}\n\nTrailing text.\n`)
      const ensured = await ensurePointer(dir)
      expect(ensured.block).toBe("inserted")
      expect(ensured.legacyRemoved).toBe(1)
      const written = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(written).not.toContain("opencode-auto:test:start")
      expect(written).not.toContain("Test principle:")
      expect(written).toMatch(/Leading text\.\n\nTrailing text\./)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the opencode-auto block content disagrees with the render for the current config: the whole block is replaced, surrounding text and blank-line separation preserved, idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    const stale = "<!-- opencode-auto:start -->\nStale content.\n<!-- opencode-auto:end -->"
    try {
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      await Bun.write(join(dir, "AGENTS.md"), `# AGENTS.md\n\nLeading text.\n\n${stale}\n\nTrailing text.\n`)
      const ensured = await ensurePointer(dir, { testByDriver: true })
      expect(ensured).toEqual({ block: "replaced", legacyRemoved: 0 })
      const written = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(written).not.toContain("Stale content.")
      expect(written).not.toContain("Verify principle:")
      expect(written).toContain("Test principle:")
      expect(written).toMatch(/Leading text\.\n\n<!-- opencode-auto:start -->/)
      expect(written).toMatch(/opencode-auto:end -->\n\nTrailing text\./)
      // idempotent: the content already matches the render, a second run does not touch the file
      const second = await ensurePointer(dir, { testByDriver: true })
      expect(second).toEqual({ block: "unchanged", legacyRemoved: 0 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("with no task documents, only the missing-AGENTS.md note (PLAN.md retired, M3.4)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      expect(notes.length).toBe(1)
      expect(notes[0]).toContain("AGENTS.md does not exist")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("AGENTS.md has no line cap any more: a long file is no note (maintenance rules retired, plans/0054 D2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      const filler = Array.from({ length: 155 }, (_, i) => `Rule ${i + 1}: a durable workflow convention.`).join("\n")
      // exactly the block content checkPrinciple renders by default (verify/testByDriver
      // both disabled), to avoid tripping the extra stale-content note.
      const content = ["# AGENTS.md", "", renderAgentsBlock(), "", filler, ""].join("\n")
      await Bun.write(join(dir, "AGENTS.md"), content)
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      expect(notes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("checkPrinciple reference check (stable-refs P4)", () => {
  test("broken references in live documents go to refs; a non-git directory gets the auto-correct-unavailable note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "Reference `src/gone.ts`.\nLine with a deleted marker exempts `docs/old.md`.\n")
      const { findings, notes, refs } = await checkPrinciple(dir, REFCHECK_ON)
      expect(findings).toEqual([])
      expect(refs).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "Reference `src/gone.ts`.", path: "src/gone.ts", problem: "missing" },
      ])
      expect(notes).toEqual([
        "AGENTS.md does not exist, run opencode-auto fix " + dir + " to add the opencode-auto block",
        "non-git target directory: pre-commit reference auto-correct (rename rewrite) unavailable, reference check only validates",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a line number past the file's total counts as beyond-eof; without docs/ nothing is scanned and there is no non-git note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      await Bun.write(join(dir, "src/mod.ts"), "l1\nl2\n")
      await Bun.write(join(dir, "docs/live.md"), "See `src/mod.ts:99`.\n")
      const first = await checkPrinciple(dir, REFCHECK_ON)
      expect(first.refs).toEqual([{ file: "docs/live.md", line: 1, text: "See `src/mod.ts:99`.", path: "src/mod.ts", problem: "beyond-eof" }])
      // docs present but not git → the auto-correct-unavailable note
      expect(first.notes).toContain("non-git target directory: pre-commit reference auto-correct (rename rewrite) unavailable, reference check only validates")
      // with docs/ removed: no refs, no non-git note
      await rm(join(dir, "docs"), { recursive: true, force: true })
      const second = await checkPrinciple(dir, REFCHECK_ON)
      expect(second.refs).toEqual([])
      expect(second.notes.every((note) => !note.includes("non-git"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("inside a git repository there is no non-git note; the opencode-auto block note disappears after init back-fills it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({}))
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      await Bun.write(join(dir, "AGENTS.md"), "# AGENTS.md\n")
      await Bun.write(join(dir, "docs/ok.md"), "Reference `docs/T-001/todo.md`.\n")
      const proc = Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "ignore", stderr: "ignore" })
      await proc.exited
      const before = await checkPrinciple(dir, REFCHECK_ON)
      expect(before.refs).toEqual([])
      expect(before.notes).toEqual(["AGENTS.md is missing the opencode-auto block, run opencode-auto fix to add it"])
      await ensurePointer(dir)
      const after = await checkPrinciple(dir, REFCHECK_ON)
      expect(after.refs).toEqual([])
      expect(after.notes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("off by default (refcheck-scope D3): the reference check no-ops — refs always empty, no non-git note, zero changes in the target directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: Task\n\nImplement the feature.\n")
      await Bun.write(join(dir, "docs/live.md"), "Reference `docs/gone.md`.\n")
      const before = await Bun.file(join(dir, "docs/live.md")).text()
      // the default switches (autoSwitches reads process.env, unset in the test environment → refCheck=off)
      const { findings, notes, refs } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      expect(refs).toEqual([])
      expect(notes.every((note) => !note.includes("non-git"))).toBe(true)
      // zero reference-check behavior: documents untouched, no invalid-ref list produced
      expect(await Bun.file(join(dir, "docs/live.md")).text()).toBe(before)
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
