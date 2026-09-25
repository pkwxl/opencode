// Preflight's cleanup of the retired task mirror (plans/0054 D4): a CURRENT.md
// an earlier release left is recognised by its fixed header and deleted, and
// the deletion rides the start gate's carryover commit; any other CURRENT.md
// belongs to the project.
import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { beginUnit, changedFiles } from "../src/git"
import { removeRetiredCurrent } from "../src/loop-preflight"
import { freshRepo, git } from "./fixtures/runner"

const MIRROR = "# Current task (maintained by opencode-auto, do not edit manually)\n\n## T-003: task T-003 [blocked]\n\nbody\n"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await freshRepo()
  dirs.push(dir)
  await Bun.write(join(dir, "seed.txt"), "seed\n")
  for (const [path, text] of Object.entries(files)) await Bun.write(join(dir, path), text)
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "seed")
  return dir
}

describe("removeRetiredCurrent (plans/0054 D4)", () => {
  test("a tracked mirror is deleted and the start gate commits the deletion as a driver write", async () => {
    const dir = await repo({ "CURRENT.md": MIRROR })
    expect(await removeRetiredCurrent(dir)).toBe(true)
    expect(await Bun.file(join(dir, "CURRENT.md")).exists()).toBe(false)
    const gate = await beginUnit(dir, {}, { id: "PLAN", title: "pre-run baseline close-out" })
    expect(gate.type).toBe("ok")
    expect(await changedFiles(dir)).toEqual([])
    expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: carryover")
    expect(await git(dir, "show", "--name-status", "--pretty=format:", "HEAD")).toContain("D\tCURRENT.md")
  })

  test("an untracked mirror is deleted and leaves nothing to commit", async () => {
    const dir = await repo({})
    await Bun.write(join(dir, "CURRENT.md"), MIRROR)
    expect(await removeRetiredCurrent(dir)).toBe(true)
    expect(await changedFiles(dir)).toEqual([])
  })

  test("a CURRENT.md with any other first line is the project's and stays", async () => {
    const own = "# Current state of the port\n\nNotes the project keeps.\n"
    const dir = await repo({ "CURRENT.md": own })
    expect(await removeRetiredCurrent(dir)).toBe(false)
    expect(await Bun.file(join(dir, "CURRENT.md")).text()).toBe(own)
  })

  test("no CURRENT.md: nothing to do", async () => {
    const dir = await repo({})
    expect(await removeRetiredCurrent(dir)).toBe(false)
  })
})
