// The lead's split (plans/0059 D3–D5): the checklist-line parser, the
// structural guard, the driver-written scope file, the taken-split check, and
// the fan-out prompt's helpers (a stream's title, the driver-state filter of
// the files changed since the split, a stream's prerequisites).
// The usage half of the guard is src/usage.ts splitUsageReached; the accept /
// reject flow of executeWhole is covered in test/agent-fake.test.ts.

import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checklistPrerequisites } from "../src/document/state"
import { parseUnitDoc } from "../src/document/unit"
import { parseSplit, renderSplitTodo, splitItem, splitProblems, splitStateFile, splitTaken, writeSplitTodos } from "../src/split"
import { checklistTitle, readChecklist, reloadTask, setForkBase, setSplit } from "../src/tasks"
import { seedUnits } from "./fixtures/units"
import { splitUsageReached } from "../src/usage"

const lines = (...items: string[]) => items.map((item) => `- [ ] ${item}`).join("\n") + "\n"

describe("splitItem", () => {
  test("the description, then Depends and Artifacts in either order, read case-insensitively", () => {
    expect(splitItem("parser: the lexer in src/lex.ts, verify with its test Depends: S01 Artifacts: src/lex.ts, test/lex.test.ts", 2)).toEqual({
      index: 2,
      text: "parser: the lexer in src/lex.ts, verify with its test Depends: S01 Artifacts: src/lex.ts, test/lex.test.ts",
      description: "parser: the lexer in src/lex.ts, verify with its test",
      depends: ["S01"],
      artifacts: ["src/lex.ts", "test/lex.test.ts"],
    })
    const reversed = splitItem("docs: the guide artifacts: `docs/guide.md` depends: S01, S02.", 3)
    expect(reversed.description).toBe("docs: the guide")
    expect(reversed.depends).toEqual(["S01", "S02"])
    expect(reversed.artifacts).toEqual(["docs/guide.md"])
  })

  test("no Depends field = the grammar's default (absent); `none` declares a root; no Artifacts = no paths", () => {
    expect(splitItem("a: do it Artifacts: a.ts", 1).depends).toBeUndefined()
    expect(splitItem("a: do it Depends: none Artifacts: a.ts", 1).depends).toBe("none")
    expect(splitItem("a: do it Depends: None.", 1).depends).toBe("none")
    expect(splitItem("a: do it", 1)).toEqual({ index: 1, text: "a: do it", description: "a: do it", artifacts: [] })
  })

  test("parseSplit numbers the checklist lines in order and skips prose", () => {
    const items = parseSplit("# Split\n\nTwo streams.\n\n" + lines("one Artifacts: a.ts", "two Depends: none Artifacts: b.ts"))
    expect(items.map((item) => [item.index, item.description])).toEqual([
      [1, "one"],
      [2, "two"],
    ])
  })
})

describe("splitProblems (the structural guard)", () => {
  const split = (...items: string[]) => splitProblems(parseSplit(lines(...items)))

  test("two independent streams with their own files pass", () => {
    expect(split("api: the endpoints Depends: none Artifacts: src/api.ts", "cli: the command Depends: none Artifacts: src/cli.ts")).toEqual([])
  })

  test("2 to 5 streams: one is no split, six is too fine", () => {
    expect(split("only: all of it Artifacts: a.ts")).toEqual(["1 item, where a split takes 2 to 5 streams"])
    const six = Array.from({ length: 6 }, (_, i) => `s${i}: part Depends: none Artifacts: f${i}.ts`)
    expect(split(...six)).toEqual(["6 items, where a split takes 2 to 5 streams"])
    const five = six.slice(0, 5)
    expect(split(...five)).toEqual([])
  })

  test("every line parses: a description and at least one Artifacts path", () => {
    expect(split("Depends: none Artifacts: a.ts", "b: work Depends: none")).toEqual(["S01 has no description before its fields", "S02 declares no `Artifacts:` paths"])
  })

  test("the dependency graph must be valid", () => {
    expect(split("a: x Depends: S03 Artifacts: a.ts", "b: y Depends: none Artifacts: b.ts")).toEqual(["S01 depends on unknown S03"])
    expect(split("a: x Depends: S02 Artifacts: a.ts", "b: y Depends: S01 Artifacts: b.ts")).toEqual(["dependency cycle: S01 -> S02 -> S01"])
    expect(split("a: x Depends: T-001 Artifacts: a.ts", "b: y Depends: none Artifacts: /etc/b.ts")).toEqual([
      'S01 depends on "T-001", which is not a subtask id (S<nn>)',
      "S02 touches an absolute path: /etc/b.ts",
    ])
  })

  test("a path two streams declare is allowed only along a dependency, transitive included", () => {
    expect(split("a: x Depends: none Artifacts: src/shared.ts, a.ts", "b: y Depends: none Artifacts: src/shared.ts")).toEqual([
      "S01 and S02 both declare src/shared.ts but neither depends on the other",
    ])
    // Ordered: S02 waits for S01.
    expect(split("a: x Depends: none Artifacts: src/shared.ts", "b: y Depends: S01 Artifacts: src/shared.ts")).toEqual([])
    // Transitive: S03 waits for S02, which waits for S01.
    expect(split("a: x Depends: none Artifacts: s.ts", "b: y Depends: S01 Artifacts: b.ts", "c: z Depends: S02 Artifacts: s.ts")).toEqual([])
    // No Depends field: each line waits for the one before it (serial).
    expect(split("a: x Artifacts: s.ts", "b: y Artifacts: s.ts")).toEqual([])
  })

  test("a directory covers the files under it", () => {
    expect(split("a: x Depends: none Artifacts: src/dma/", "b: y Depends: none Artifacts: ./src/dma/ring.ts")).toEqual([
      "S01 and S02 both declare src/dma/ but neither depends on the other",
    ])
    expect(split("a: x Depends: none Artifacts: src/dma.ts", "b: y Depends: none Artifacts: src/dma.tsx")).toEqual([])
  })
})

describe("the driver-written scope file", () => {
  test("the field block from Depends and Artifacts, the two protocol sections, the terminator", () => {
    const text = renderSplitTodo(splitItem("api: the endpoints, verify with test/api.test.ts Depends: S01 Artifacts: src/api.ts, test/api.test.ts", 2))
    expect(text).toBe(
      [
        "Depends: S01",
        "Touches: src/api.ts, test/api.test.ts",
        "",
        "## Scope",
        "",
        "api: the endpoints, verify with test/api.test.ts",
        "",
        "## Artifacts",
        "",
        "- src/api.ts",
        "- test/api.test.ts",
        "",
        "<!-- auto: eof -->",
        "",
      ].join("\n"),
    )
    expect(parseUnitDoc(text)).toMatchObject({ depends: ["S01"], touches: ["src/api.ts", "test/api.test.ts"] })
    // No Depends field on the line, none in the file: the default order stands.
    expect(renderSplitTodo(splitItem("a: x Artifacts: a.ts", 1))).toStartWith("Touches: a.ts\n\n## Scope")
  })

  test("written per line, read back as the checklist's dependencies; a taken split is one whose state files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-split-"))
    try {
      mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
      const text = lines("a: x Depends: none Artifacts: a.ts", "b: y Depends: none Artifacts: b.ts")
      writeFileSync(join(dir, "docs", "T-001", "subtasks.md"), text)
      expect(await splitTaken(dir, "T-001", 2)).toBe(false)
      await writeSplitTodos(dir, "T-001", parseSplit(text))
      expect(await splitTaken(dir, "T-001", 2)).toBe(true)
      expect(await splitTaken(dir, "T-001", 0)).toBe(false)
      const checklist = await readChecklist(dir, "T-001")
      expect(checklist.map((item) => [item.done, item.depends, item.touches])).toEqual([
        [false, "none", ["a.ts"]],
        [false, "none", ["b.ts"]],
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("splitUsageReached (the guard's usage condition)", () => {
  test("a live tier needs half the wall; the other tiers skip the check", () => {
    expect(splitUsageReached("events", 40_000, 80_000)).toBe(true)
    expect(splitUsageReached("events", 39_999, 80_000)).toBe(false)
    expect(splitUsageReached("estimated", undefined, 80_000)).toBe(false)
    expect(splitUsageReached("reported", 1_000, 80_000)).toBe(true)
    expect(splitUsageReached("none", undefined, 80_000)).toBe(true)
  })
})

describe("the fan-out prompt's helpers (plans/0059 D5)", () => {
  test("checklistTitle: the text up to the colon ending the title, the description without one, capped at 60 characters", () => {
    expect(checklistTitle("alpha: the alpha module in src/alpha.ts Depends: none Artifacts: src/alpha.ts")).toBe("alpha")
    expect(checklistTitle("the whole rest Artifacts: src/all.ts")).toBe("the whole rest")
    // The fields end the description in either order, case-insensitively.
    expect(checklistTitle("the rest artifacts: src/all.ts Depends: S01")).toBe("the rest")
    // A colon inside a word (a URL, a path) does not end the title.
    expect(checklistTitle("fetch http://x.org/a: the client Artifacts: src/fetch.ts")).toBe("fetch http://x.org/a")
    // A line with no fields at all is its own title.
    expect(checklistTitle("write the docs")).toBe("write the docs")
    const long = checklistTitle(`${"x".repeat(80)} Artifacts: a.ts`)
    expect(long).toHaveLength(60)
    expect(long.endsWith("…")).toBe(true)
  })

  test("splitStateFile: the checklist and the S<nn> state files of the task, nothing else", () => {
    expect(splitStateFile("T-001", "docs/T-001/subtasks.md")).toBe(true)
    expect(splitStateFile("T-001", "docs/T-001/S01/todo.md")).toBe(true)
    expect(splitStateFile("T-001", "docs/T-001/S12/done.md")).toBe(true)
    expect(splitStateFile("T-001", "./docs/T-001/S02/done.md")).toBe(true)
    // A stream's own document output and every other file are content.
    expect(splitStateFile("T-001", "docs/T-001/S01/index.md")).toBe(false)
    expect(splitStateFile("T-001", "docs/T-002/subtasks.md")).toBe(false)
    expect(splitStateFile("T-001", "docs/T-002/S01/done.md")).toBe(false)
    expect(splitStateFile("T-001", "src/alpha.ts")).toBe(false)
  })

  test("checklistPrerequisites: Depends as declared, none for none, else the item before", () => {
    const items = [
      { done: true, depends: "none" as const },
      { done: false },
      { done: false, depends: ["S01", "S02"] },
      { done: false, depends: "none" as const },
    ]
    expect(checklistPrerequisites(items, 1)).toEqual([])
    expect(checklistPrerequisites(items, 2)).toEqual(["S01"])
    expect(checklistPrerequisites(items, 3)).toEqual(["S01", "S02"])
    expect(checklistPrerequisites(items, 4)).toEqual([])
  })

  test("the split record: loaded onto the task with the lead's fork base, dropped by setSplit(undefined)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-split-"))
    try {
      const plan = await seedUnits(dir, "## T-001: sample task [pending]\nBody.\n")
      expect((await reloadTask(plan, "T-001")).split).toBeUndefined()
      const point = [{ root: dir, sha: "abc1234" }]
      await setForkBase(dir, "T-001", "ses_lead")
      await setSplit(dir, "T-001", point)
      const task = await reloadTask(plan, "T-001")
      expect(task.split).toEqual(point)
      expect(task.forkBase).toBe("ses_lead")
      // A split taken with nothing committed is an empty record, still a split.
      await setSplit(dir, "T-001", [])
      expect((await reloadTask(plan, "T-001")).split).toEqual([])
      await setSplit(dir, "T-001", undefined)
      const dropped = await reloadTask(plan, "T-001")
      expect(dropped.split).toBeUndefined()
      expect(dropped.forkBase).toBe("ses_lead")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
