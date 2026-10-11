// installPrompts (plans/0093): the registry-vs-directory guard (every suite
// file registered in the same change that adds it), the resync into an
// initialized directory (byte-identical copies, differing content rewritten,
// identical content untouched), extra files reported and never deleted, the
// uninitialized-directory refusal, and the formatter's lines.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_FILE } from "../src/config"
import { formatInstallPrompts, installPrompts, PROMPT_SUITE } from "../src/install-prompts"

const SUITE_DIR = join(import.meta.dir, "../prompts")

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "install-prompts-"))
  await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
  await writeFile(join(dir, CONFIG_FILE), "{}")
  return dir
}

describe("install-prompts", () => {
  test("the registry matches the prompts/ directory", async () => {
    const onDisk = (await readdir(SUITE_DIR)).sort()
    expect([...PROMPT_SUITE].sort()).toEqual(onDisk)
  })

  test("installs every suite file byte-identical into an initialized directory", async () => {
    const dir = await makeProject()
    try {
      const result = await installPrompts(dir)
      expect(result.written.sort()).toEqual([...PROMPT_SUITE].sort())
      expect(result.unchanged).toEqual([])
      expect(result.extra).toEqual([])
      for (const name of PROMPT_SUITE) {
        const source = await Bun.file(join(SUITE_DIR, name)).arrayBuffer()
        const target = await Bun.file(join(dir, "prompts", name)).arrayBuffer()
        expect(Buffer.from(target).equals(Buffer.from(source))).toBe(true)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("resync is idempotent and rewrites drifted content", async () => {
    const dir = await makeProject()
    try {
      await installPrompts(dir)
      const again = await installPrompts(dir)
      expect(again.written).toEqual([])
      expect(again.unchanged.sort()).toEqual([...PROMPT_SUITE].sort())
      await writeFile(join(dir, "prompts", "run.md"), "drifted\n")
      const third = await installPrompts(dir)
      expect(third.written).toEqual(["run.md"])
      expect(await Bun.file(join(dir, "prompts", "run.md")).text()).toEqual(
        await Bun.file(join(SUITE_DIR, "run.md")).text(),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("extra files in the target's prompts/ are reported, never deleted", async () => {
    const dir = await makeProject()
    try {
      await installPrompts(dir)
      await writeFile(join(dir, "prompts", "local-note.md"), "the person's own\n")
      const result = await installPrompts(dir)
      expect(result.extra).toEqual(["local-note.md"])
      expect(result.written).toEqual([])
      expect(await Bun.file(join(dir, "prompts", "local-note.md")).text()).toBe("the person's own\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("refuses a directory without .opencode/auto/config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "install-prompts-"))
    try {
      await expect(installPrompts(dir)).rejects.toThrow(/nothing to install/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the formatter names the directory and the outcome", async () => {
    const current = formatInstallPrompts("/proj", { written: [], unchanged: ["run.md"], extra: [] })
    expect(current).toEqual(["prompt suite already current in /proj/prompts: 1 files"])
    const resynced = formatInstallPrompts("/proj", {
      written: ["run.md", "run-task.md"],
      unchanged: ["charter.md"],
      extra: ["local-note.md"],
    })
    expect(resynced).toEqual([
      "prompt suite resynced into /proj/prompts: 3 files (2 rewritten, 1 unchanged)",
      "  rewritten: run.md, run-task.md",
      "  left alone (not in the suite): local-note.md",
    ])
  })
})
