// The persisted planning input (plans/0053 D9): plan-input.md in the phase
// directory, written verbatim and committed on its own before the planning unit.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { changedFiles } from "../src/git"
import { planInputPath, planInputText, readPlanInput, savePlanInput } from "../src/plan-input"
import { freshRepo, git } from "./fixtures/runner"

const PHASE = { round: "R-01", id: "P02", dir: join("docs", "R-01", "P02-implement") }
const TITLE = "P02-implement Implementation"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

// A repository with an established phase directory, committed and clean.
async function seeded(): Promise<string> {
  const dir = await freshRepo()
  dirs.push(dir)
  await mkdir(join(dir, PHASE.dir), { recursive: true })
  await writeFile(join(dir, ".gitignore"), ".auto/\n")
  await writeFile(join(dir, PHASE.dir, "todo.md"), "# P02\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "seed")
  return dir
}

const commits = async (dir: string) => Number((await git(dir, "rev-list", "--count", "HEAD")).trim())
const lastMessage = async (dir: string) => git(dir, "log", "-1", "--format=%B")

describe("planning input text", () => {
  test("verbatim, trailing whitespace trimmed, exactly one final newline", () => {
    expect(planInputText("  Port the parser.\n\n  Keep the API.  \n\n\n")).toBe("  Port the parser.\n\n  Keep the API.\n")
    expect(planInputText("one line")).toBe("one line\n")
  })

  test("the path is the phase directory's plan-input.md", () => {
    expect(planInputPath(PHASE)).toBe(join("docs", "R-01", "P02-implement", "plan-input.md"))
  })
})

describe("savePlanInput", () => {
  test("writes the file and commits it on its own (Auto-Task: PLAN, Auto-Stage: plan-input)", async () => {
    const dir = await seeded()
    expect(await savePlanInput(dir, PHASE, { text: "Port the parser.\n\n" }, TITLE)).toEqual({ type: "saved" })
    expect(await readPlanInput(dir, PHASE)).toBe("Port the parser.\n")
    expect(await commits(dir)).toBe(2)
    const message = await lastMessage(dir)
    expect(message.split("\n")[0]).toBe(`PLAN plan-input ${TITLE}`)
    expect(message).toContain("Auto-Task: PLAN")
    expect(message).toContain("Auto-Stage: plan-input")
    expect(await changedFiles(dir)).toEqual([])
  })

  test("a --file source is named in the subject by its file name, never written into the file", async () => {
    const dir = await seeded()
    await savePlanInput(dir, PHASE, { text: "Plan from a file.", source: "/tmp/notes/port-plan.md" }, TITLE)
    expect((await lastMessage(dir)).split("\n")[0]).toBe(`PLAN plan-input ${TITLE} (from port-plan.md)`)
    expect(await readPlanInput(dir, PHASE)).toBe("Plan from a file.\n")
  })

  test("the same text again: nothing written, nothing committed", async () => {
    const dir = await seeded()
    await savePlanInput(dir, PHASE, { text: "Port the parser." }, TITLE)
    expect(await savePlanInput(dir, PHASE, { text: "Port the parser.  \n\n" }, TITLE)).toEqual({ type: "same" })
    expect(await commits(dir)).toBe(2)
  })

  test("a different text replaces the file in a commit of its own, so git log is the input history", async () => {
    const dir = await seeded()
    await savePlanInput(dir, PHASE, { text: "First input." }, TITLE)
    expect(await savePlanInput(dir, PHASE, { text: "Second input." }, TITLE)).toEqual({ type: "saved" })
    expect(await readPlanInput(dir, PHASE)).toBe("Second input.\n")
    const history = (await git(dir, "log", "--format=%s", "--", planInputPath(PHASE))).trim().split("\n")
    expect(history).toEqual([`PLAN plan-input ${TITLE}`, `PLAN plan-input ${TITLE}`])
  })

  test("a dirty tree stops before any write", async () => {
    const dir = await seeded()
    await writeFile(join(dir, "notes.txt"), "a person's edit")
    expect(await savePlanInput(dir, PHASE, { text: "Port the parser." }, TITLE)).toEqual({ type: "dirty", files: ["notes.txt"] })
    expect(await readPlanInput(dir, PHASE)).toBeUndefined()
    expect(await commits(dir)).toBe(1)
  })

  test("an empty input is a caller error (the shell checks it before the lock)", async () => {
    const dir = await seeded()
    await expect(savePlanInput(dir, PHASE, { text: " \n\t" }, TITLE)).rejects.toThrow("must not be empty")
  })

  test("readPlanInput: undefined when the phase has no input", async () => {
    const dir = await seeded()
    expect(await readPlanInput(dir, PHASE)).toBeUndefined()
  })
})
