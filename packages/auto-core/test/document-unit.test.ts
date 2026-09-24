// src/document/unit.ts (M3.1, plans/0047): unit refs and paths, the generalized
// todo/done state scan, the index parser, the unit field block, the dependency
// checks (G4) and dependency-ordered selection (G5).

import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  type UnitDecl,
  type UnitRef,
  nextReady,
  parseIndex,
  parsePhaseDir,
  parseUnitDoc,
  qualifiedId,
  renameUnitDone,
  resolveDepends,
  scanUnitStates,
  unitDir,
  unitProblems,
  unitStatePaths,
} from "../src/document/unit"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "unit-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function put(path: string, text = "x") {
  const abs = join(dir, path)
  await mkdir(abs.split("/").slice(0, -1).join("/"), { recursive: true })
  await Bun.write(abs, text)
}

const phase = { level: "phase", id: "P02", round: "R-01", type: "design" } as const
const task = { level: "task", id: "T-014" } as const
const subtask = { level: "subtask", id: "S03", task: "T-014" } as const

describe("refs and paths", () => {
  test("qualified ids", () => {
    expect(qualifiedId(phase)).toBe("R-01.P02")
    expect(qualifiedId(task)).toBe("T-014")
    expect(qualifiedId(subtask)).toBe("T-014.S03")
  })

  test("unit directories: phases in the round, tasks flat, subtasks in the task", () => {
    expect(unitDir(phase)).toBe("docs/R-01/P02-design")
    expect(unitDir(task)).toBe("docs/T-014")
    expect(unitDir(subtask)).toBe("docs/T-014/S03")
  })

  test("state paths are todo.md / done.md in the unit directory", () => {
    expect(unitStatePaths(subtask)).toEqual({ pending: "docs/T-014/S03/todo.md", complete: "docs/T-014/S03/done.md" })
  })

  test("phase directory names", () => {
    expect(parsePhaseDir("P02-design")).toEqual({ id: "P02", type: "design" })
    expect(parsePhaseDir("P10-custom-review")).toEqual({ id: "P10", type: "custom-review" })
    expect(parsePhaseDir("m-implement")).toBeUndefined()
    expect(parsePhaseDir("P2-design")).toBeUndefined()
    expect(parsePhaseDir("P02")).toBeUndefined()
  })
})

describe("scanUnitStates", () => {
  test("classifies each unit and lists the illegal ones", async () => {
    const units = [
      { level: "task", id: "T-001" },
      { level: "task", id: "T-002" },
      { level: "task", id: "T-003" },
      { level: "task", id: "T-004" },
    ] as const
    await put("docs/T-001/todo.md")
    await put("docs/T-002/done.md")
    await put("docs/T-003/todo.md")
    await put("docs/T-003/done.md")
    const scan = await scanUnitStates(dir, units)
    expect(scan.states.map((s) => s.state)).toEqual(["todo", "done", "both", "neither"])
    expect(scan.illegal).toEqual([
      { id: "T-003", kind: "both" },
      { id: "T-004", kind: "neither" },
    ])
    expect([...scan.done]).toEqual(["T-002", "T-003"])
  })

  test("works at the phase level", async () => {
    await put("docs/R-01/P02-design/done.md")
    const scan = await scanUnitStates(dir, [phase])
    expect(scan.states[0]).toMatchObject({ id: "P02", state: "done" })
  })

  test("a unit with both files counts as done (files win, like effectiveDone)", async () => {
    await put("docs/T-001/todo.md")
    await put("docs/T-001/done.md")
    const scan = await scanUnitStates(dir, [{ level: "task", id: "T-001" }])
    expect(scan.done.has("T-001")).toBe(true)
  })

  // Fixture files are placed through unitStatePaths, so the tests name units, not paths.
  const t1 = { level: "task", id: "T-001" } as const
  const t2 = { level: "task", id: "T-002" } as const
  const t3 = { level: "task", id: "T-003" } as const
  const done = (ref: UnitRef) => unitStatePaths(ref).complete
  const todo = (ref: UnitRef) => unitStatePaths(ref).pending

  test("closed: a done.md field block carrying `Closed:` maps the id to its reason (D16)", async () => {
    await put(done(t2), "# T-002: x\nPhase: R-01.P01\nClosed: superseded by a later task\n\nbody\n")
    const scan = await scanUnitStates(dir, [t2])
    expect(scan.done.has("T-002")).toBe(true)
    expect(scan.closed.get("T-002")).toBe("superseded by a later task")
  })

  test("closed: todo.md, a done.md without the field and a line below the field block do not count", async () => {
    await put(todo(t1), "# T-001: x\nClosed: not yet\n")
    await put(done(t2), "# T-002: x\nPhase: R-01.P01\n\nbody\n")
    await put(done(t3), "# T-003: x\nPhase: R-01.P01\n\nbody text\nClosed: prose, not a field\n")
    const scan = await scanUnitStates(dir, [t1, t2, t3])
    expect([...scan.done]).toEqual(["T-002", "T-003"])
    expect(scan.closed.size).toBe(0)
  })

  test("closed: a unit with both files reads its done.md", async () => {
    await put(todo(t1), "# T-001: x\n")
    await put(done(t1), "# T-001: x\nClosed: dropped\n")
    const scan = await scanUnitStates(dir, [t1])
    expect(scan.states[0]).toMatchObject({ id: "T-001", state: "both" })
    expect(scan.closed.get("T-001")).toBe("dropped")
  })

  test("closed: works at the phase level; an empty value still marks the unit closed", async () => {
    const implement = { level: "phase", id: "P03", round: "R-01", type: "implement" } as const
    await put(done(phase), "# R-01.P02: design\nclosed: design folded into P03\n")
    await put(done(implement), "# R-01.P03: implement\nClosed:\n")
    const scan = await scanUnitStates(dir, [phase, implement])
    expect([...scan.closed]).toEqual([
      ["P02", "design folded into P03"],
      ["P03", ""],
    ])
  })
})

describe("renameUnitDone", () => {
  test("renames todo.md to done.md, keeping the content", async () => {
    await put("docs/T-014/todo.md", "# T-014: scope\n")
    await renameUnitDone(dir, task)
    expect(await Bun.file(join(dir, "docs/T-014/todo.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, "docs/T-014/done.md")).text()).toBe("# T-014: scope\n")
  })

  test("idempotent: skipped when done.md exists or todo.md is absent", async () => {
    await put("docs/T-014/todo.md", "new")
    await put("docs/T-014/done.md", "old")
    await renameUnitDone(dir, task)
    expect(await Bun.file(join(dir, "docs/T-014/done.md")).text()).toBe("old")
    expect(await Bun.file(join(dir, "docs/T-014/todo.md")).exists()).toBe(true)
    await renameUnitDone(dir, subtask)
    expect(await Bun.file(join(dir, "docs/T-014/S03/done.md")).exists()).toBe(false)
  })
})

describe("parseIndex", () => {
  test("reads order, ids, titles and ticks; ignores prose", () => {
    const text = [
      "# Tasks",
      "",
      "Planned by the phase session.",
      "- [ ] T-011 Probe the DMA engine",
      "- [x] T-012: Ring buffer layout",
      "  - [ ] nested notes are not members",
      "* [X] T-013",
      "<!-- auto: eof -->",
    ].join("\n")
    const { entries, problems } = parseIndex(text, "task")
    expect(problems).toEqual([])
    expect(entries).toEqual([
      { id: "T-011", title: "Probe the DMA engine", ticked: false, line: 4 },
      { id: "T-012", title: "Ring buffer layout", ticked: true, line: 5 },
      { id: "T-013", title: "", ticked: true, line: 7 },
    ])
  })

  test("a checklist line without an id of the index's level is a problem", () => {
    const { entries, problems } = parseIndex("- [ ] S01 wrong level\n- [ ] just prose\n- [ ] P01 ok", "phase")
    expect(entries.map((e) => e.id)).toEqual(["P01"])
    expect(problems).toEqual([
      'line 1: "S01" is not a phase id (P<nn>)',
      'line 2: "just" is not a phase id (P<nn>)',
    ])
  })

  test("duplicate ids are a problem; the first occurrence is kept", () => {
    const { entries, problems } = parseIndex("- [ ] S01 a\n- [ ] S01 b", "subtask")
    expect(entries.map((e) => e.title)).toEqual(["a"])
    expect(problems).toEqual(["line 2: duplicate S01 (first at line 1)"])
  })
})

describe("parseUnitDoc", () => {
  test("title and field block", () => {
    const doc = parseUnitDoc(
      [
        "# T-014: DMA ring buffer",
        "Phase: R-01.P03",
        "Depends: T-011, T-012",
        "Touches: `src/dma/`, include/dma.h",
        "",
        "## Goal",
        "Owner: not a field (after the block)",
      ].join("\n"),
    )
    expect(doc.title).toBe("DMA ring buffer")
    expect(doc.fields).toEqual({ phase: "R-01.P03", depends: "T-011, T-012", touches: "`src/dma/`, include/dma.h" })
    expect(doc.depends).toEqual(["T-011", "T-012"])
    expect(doc.touches).toEqual(["src/dma/", "include/dma.h"])
  })

  test("absent fields stay undefined (G3 defaults apply later)", () => {
    const doc = parseUnitDoc("# S02: Write the parser\n\n## Scope\n")
    expect(doc.title).toBe("Write the parser")
    expect(doc.depends).toBeUndefined()
    expect(doc.touches).toBeUndefined()
  })

  test("`Depends: none` declares a root; empty values are kept as empty for the checks", () => {
    expect(parseUnitDoc("# x\nDepends: none").depends).toBe("none")
    expect(parseUnitDoc("# x\nDEPENDS: None").depends).toBe("none")
    expect(parseUnitDoc("# x\nDepends:").depends).toEqual([])
    expect(parseUnitDoc("# x\nTouches:  ").touches).toEqual([])
  })

  test("a blank line between the title and the fields is allowed", () => {
    expect(parseUnitDoc("# P02: Design\n\nType: design\nDepends: P01").depends).toEqual(["P01"])
  })

  test("no title line: fields are still read from the top", () => {
    expect(parseUnitDoc("Depends: S01 S02\n").depends).toEqual(["S01", "S02"])
  })
})

const t = (id: string, rest: Partial<UnitDecl> = {}): UnitDecl => ({ id, ...rest })

describe("resolveDepends (G3)", () => {
  test("absent = previous sibling; first unit has none; `none` = root", () => {
    const resolved = resolveDepends([t("T-001"), t("T-002"), t("T-003", { depends: "none" }), t("T-004", { depends: ["T-001"] })])
    expect([...resolved]).toEqual([
      ["T-001", []],
      ["T-002", ["T-001"]],
      ["T-003", []],
      ["T-004", ["T-001"]],
    ])
  })
})

describe("unitProblems (G4)", () => {
  test("a serial index with defaults has no problems", () => {
    expect(unitProblems("task", [t("T-001"), t("T-002"), t("T-003")])).toEqual([])
  })

  test("unknown id, self-dependency, out-of-scope reference", () => {
    const problems = unitProblems("task", [
      t("T-001", { depends: ["T-009"] }),
      t("T-002", { depends: ["T-002"] }),
      t("T-003", { depends: ["S01", "R-01.P02"] }),
    ])
    expect(problems).toEqual([
      "T-001 depends on unknown T-009",
      "T-002 depends on itself",
      'T-003 depends on "S01", which is not a task id (T-NNN)',
      'T-003 depends on "R-01.P02", which is not a task id (T-NNN)',
    ])
  })

  test("external ids (e.g. tasks of earlier phases) are known", () => {
    expect(unitProblems("task", [t("T-005", { depends: ["T-001"] })], { external: new Set(["T-001"]) })).toEqual([])
  })

  test("cycles are reported once, with their path", () => {
    const problems = unitProblems("subtask", [
      t("S01", { depends: ["S03"] }),
      t("S02", { depends: ["S01"] }),
      t("S03", { depends: ["S02"] }),
      t("S04", { depends: "none" }),
    ])
    expect(problems).toEqual(["dependency cycle: S01 -> S03 -> S02 -> S01"])
  })

  test("an explicit dependency can close a cycle with a default edge", () => {
    expect(unitProblems("phase", [t("P01", { depends: ["P02"] }), t("P02")])).toEqual(["dependency cycle: P01 -> P02 -> P01"])
  })

  test("empty values and bad paths", () => {
    const problems = unitProblems("task", [
      t("T-001", { depends: [] }),
      t("T-002", { touches: [] }),
      t("T-003", { touches: ["/etc/passwd", "src/../../x", "ok/path", ".."] }),
    ])
    expect(problems).toEqual([
      "T-001 has an empty Depends value (write `Depends: none` for no prerequisite)",
      "T-002 has an empty Touches value (omit the field to mean everything)",
      "T-003 touches an absolute path: /etc/passwd",
      "T-003 touches a path with ..: src/../../x",
      "T-003 touches a path with ..: ..",
    ])
  })

  test("overlapping Touches is not a problem", () => {
    expect(unitProblems("task", [t("T-001", { touches: ["src/"] }), t("T-002", { touches: ["src/"] })])).toEqual([])
  })

  test("duplicate unit ids are a problem", () => {
    expect(unitProblems("task", [t("T-001"), t("T-001")])).toEqual(["duplicate unit T-001"])
  })
})

describe("nextReady (G5)", () => {
  const units = [t("T-001"), t("T-002"), t("T-003", { depends: "none" }), t("T-004", { depends: ["T-001", "T-003"] })]

  test("defaults reproduce today's serial order", () => {
    const serial = [t("T-001"), t("T-002"), t("T-003")]
    expect(nextReady(serial, new Set())).toBe("T-001")
    expect(nextReady(serial, new Set(["T-001"]))).toBe("T-002")
    expect(nextReady(serial, new Set(["T-001", "T-002"]))).toBe("T-003")
    expect(nextReady(serial, new Set(["T-001", "T-002", "T-003"]))).toBeUndefined()
  })

  test("the first not-done unit in index order whose dependencies are done", () => {
    expect(nextReady(units, new Set())).toBe("T-001")
    expect(nextReady(units, new Set(["T-001"]))).toBe("T-002")
    // T-002 done, T-003 is a root → picked before T-004 (which needs T-003).
    expect(nextReady(units, new Set(["T-001", "T-002"]))).toBe("T-003")
    expect(nextReady(units, new Set(["T-001", "T-002", "T-003"]))).toBe("T-004")
  })

  test("a later root can run while an earlier unit waits", () => {
    const waiting = [t("T-001", { depends: ["T-000"] }), t("T-002", { depends: "none" })]
    expect(nextReady(waiting, new Set())).toBe("T-002")
    expect(nextReady(waiting, new Set(["T-000", "T-002"]))).toBe("T-001")
  })
})

describe("subtask level stays aligned with the subtask state spec", () => {
  test("unitStatePaths equals subtaskStateSpec paths", async () => {
    const { subtaskStateSpec } = await import("../src/document/spec")
    const spec = subtaskStateSpec("T-014", 3)
    expect(unitStatePaths(subtask)).toEqual({ pending: spec.pending.path, complete: spec.complete.path })
  })
})
