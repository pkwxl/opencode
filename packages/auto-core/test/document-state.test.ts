// Unit tests for the src/document/state.ts subtask state protocol (M1.0):
// the three scan states (no state file = the legacy layout / todo = pending /
// done = completed; once active, both files or both missing = illegal),
// effectiveDone's two-track merge, the idempotent rename, and the skip rule
// for protocol-inactive injection writes.

import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { checklistProblems, effectiveDone, nextChecklistIndex, renameTodoToDone, scanSubtaskStates, subtaskId } from "../src/document/state"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "subtask-state-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function put(path: string, text = "x") {
  const abs = join(dir, path)
  await mkdir(abs.split("/").slice(0, -1).join("/"), { recursive: true })
  await Bun.write(abs, text)
}

describe("scanSubtaskStates", () => {
  test("no state files at all: active=false, the PLAN.md ticks stay in force (legacy output)", async () => {
    const result = await scanSubtaskStates(dir, "T-001", 2)
    expect(result.active).toBe(false)
    expect(result.illegal).toEqual([])
    expect(result.states).toEqual([
      { index: 1, todo: false, done: false },
      { index: 2, todo: false, done: false },
    ])
  })

  test("both files present: illegal both", async () => {
    await put("docs/T-001/S01/todo.md")
    await put("docs/T-001/S01/done.md")
    const result = await scanSubtaskStates(dir, "T-001", 1)
    expect(result.active).toBe(true)
    expect(result.illegal).toEqual([{ index: 1, kind: "both" }])
  })

  test("both todo and done missing (the protocol already activated by another subtask): illegal neither", async () => {
    await put("docs/T-001/S01/done.md")
    const result = await scanSubtaskStates(dir, "T-001", 2)
    expect(result.active).toBe(true)
    expect(result.illegal).toEqual([{ index: 2, kind: "neither" }])
  })

  test("neither is not judged when the protocol is inactive (legacy output with no state files anywhere is not illegal)", async () => {
    const result = await scanSubtaskStates(dir, "T-001", 3)
    expect(result.active).toBe(false)
    expect(result.illegal).toEqual([])
  })

  test("mixed: todo pending / done completed, legal", async () => {
    await put("docs/T-001/S01/done.md")
    await put("docs/T-001/S02/todo.md")
    const result = await scanSubtaskStates(dir, "T-001", 2)
    expect(result.active).toBe(true)
    expect(result.illegal).toEqual([])
    expect(result.states).toEqual([
      { index: 1, todo: false, done: true },
      { index: 2, todo: true, done: false },
    ])
  })
})

describe("effectiveDone", () => {
  const items = [{ done: true }, { done: false }, { done: true }]

  test("protocol inactive: the tick track stays in force", () => {
    const scan = { active: false, states: [], illegal: [] }
    expect(effectiveDone(scan, items)).toEqual([true, false, true])
  })

  test("protocol active: done.md overrides the tick; todo.md suppresses it; both missing falls back to the tick", () => {
    const scan = {
      active: true,
      states: [
        { index: 1, todo: false, done: true },
        { index: 2, todo: true, done: false },
        { index: 3, todo: false, done: false },
      ],
      illegal: [{ index: 3, kind: "neither" as const }],
    }
    expect(effectiveDone(scan, items)).toEqual([true, false, true])
  })
})

describe("renameTodoToDone", () => {
  test("the todo → done rename keeps the content verbatim", async () => {
    await put("docs/T-001/S01/todo.md", "# S01\n")
    await renameTodoToDone(dir, "T-001", 1)
    expect(await Bun.file(join(dir, "docs/T-001/S01/done.md")).text()).toBe("# S01\n")
    expect(await Bun.file(join(dir, "docs/T-001/S01/todo.md")).exists()).toBe(false)
  })

  test("idempotent: done already exists (re-entry after an interruption between the rename and the commit) → silently skipped", async () => {
    await put("docs/T-001/S01/todo.md", "new\n")
    await put("docs/T-001/S01/done.md", "old\n")
    await renameTodoToDone(dir, "T-001", 1)
    expect(await Bun.file(join(dir, "docs/T-001/S01/done.md")).text()).toBe("old\n")
  })

  test("protocol inactive (no todo.md): silently skipped, no error", async () => {
    await renameTodoToDone(dir, "T-001", 1)
    expect(await Bun.file(join(dir, "docs/T-001/S01/done.md")).exists()).toBe(false)
  })
})

describe("subtask dependencies (M3.5)", () => {
  test("positional ids: item n is S<nn>", () => {
    expect([1, 9, 10, 100].map(subtaskId)).toEqual(["S01", "S09", "S10", "S100"])
  })

  test("without Depends fields the next subtask is the first unticked item", () => {
    expect(nextChecklistIndex([{ done: true }, { done: false }, { done: false }])).toBe(1)
    expect(nextChecklistIndex([{ done: true }, { done: true }])).toBe(-1)
  })

  test("Depends reorders: a root later in the list runs before an item waiting on it", () => {
    const items = [{ done: false, depends: ["S03"] }, { done: false }, { done: false, depends: "none" as const }]
    expect(checklistProblems(items)).toEqual([])
    expect(nextChecklistIndex(items)).toBe(2)
    expect(nextChecklistIndex([items[0]!, items[1]!, { ...items[2]!, done: true }])).toBe(0)
  })

  test("checklistProblems reports unknown ids, other levels, cycles and empty values", () => {
    expect(checklistProblems([{ done: false, depends: ["S05"] }])).toEqual(["S01 depends on unknown S05"])
    expect(checklistProblems([{ done: false }, { done: false, depends: ["T-001"] }])[0]).toContain("not a subtask id")
    expect(checklistProblems([{ done: false, depends: ["S02"] }, { done: false }]).some((p) => p.startsWith("dependency cycle"))).toBe(true)
    expect(checklistProblems([{ done: false, touches: [] }])[0]).toContain("empty Touches")
  })
})
