// installPrompts (plans/0093): the registry-vs-directory guard (every suite
// file registered in the same change that adds it), the resync into an
// initialized directory (byte-identical copies, differing content rewritten,
// identical content untouched), extra files reported and never deleted, the
// uninitialized-directory refusal, and the formatter's lines. Plans/0164
// adds the vintage pin (prompts/MANIFEST — per-file digests plus the
// suite-level digest, excluded from extras) and its read-only half
// checkPrompts (drifted, missing, manifest state; extras reported, never
// drift).
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_FILE } from "../src/config"
import {
  checkPrompts,
  formatCheckPrompts,
  formatInstallPrompts,
  installPrompts,
  MANIFEST_NAME,
  PROMPT_SUITE,
} from "../src/install-prompts"

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

  test("the install writes and pins prompts/MANIFEST", async () => {
    const dir = await makeProject()
    try {
      const first = await installPrompts(dir)
      const manifestPath = join(dir, "prompts", MANIFEST_NAME)
      expect(await Bun.file(manifestPath).exists()).toBe(true)
      const parsed = JSON.parse(await Bun.file(manifestPath).text()) as {
        generator: string
        suite: string
        files: Record<string, string>
      }
      expect(parsed.generator).toBe("opencode-auto install-prompts")
      expect(Object.keys(parsed.files).sort()).toEqual([...PROMPT_SUITE].sort())
      expect(parsed.suite).toBe(first.suite)
      expect(parsed.suite).toMatch(/^sha256-[0-9a-f]{64}$/)
      // The pin is deterministic: a resync over identical bytes rewrites the
      // same manifest, and the extras report never counts it.
      const manifestBefore = await Bun.file(manifestPath).text()
      const second = await installPrompts(dir)
      expect(second.suite).toBe(first.suite)
      expect(second.written).toEqual([])
      expect(second.extra).toEqual([])
      expect(await Bun.file(manifestPath).text()).toEqual(manifestBefore)
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
      await expect(checkPrompts(dir)).rejects.toThrow(/nothing to install/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("checkPrompts reports a clean install as current, writing nothing", async () => {
    const dir = await makeProject()
    try {
      await installPrompts(dir)
      const before = await Bun.file(join(dir, "prompts", "run.md")).text()
      const report = await checkPrompts(dir)
      expect(report.drifted).toEqual([])
      expect(report.missing).toEqual([])
      expect(report.manifest).toBe("current")
      expect(report.extra).toEqual([])
      expect(await Bun.file(join(dir, "prompts", "run.md")).text()).toEqual(before)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("checkPrompts names drifted and missing files, and a manifest that pins another vintage", async () => {
    const dir = await makeProject()
    try {
      await installPrompts(dir)
      await writeFile(join(dir, "prompts", "run.md"), "drifted\n")
      await rm(join(dir, "prompts", "charter.md"))
      const drifted = await checkPrompts(dir)
      expect(drifted.drifted).toEqual(["run.md"])
      expect(drifted.missing).toEqual(["charter.md"])
      expect(drifted.manifest).toBe("current") // the manifest pins the suite, the disk drifted from both
      // A manifest absent or pinning something else is its own finding.
      await rm(join(dir, "prompts", MANIFEST_NAME))
      const absent = await checkPrompts(dir)
      expect(absent.manifest).toBe("missing")
      await Bun.write(join(dir, "prompts", MANIFEST_NAME), '{"generator":"x","suite":"sha256-0","files":{}}')
      const stale = await checkPrompts(dir)
      expect(stale.manifest).toBe("stale")
      // Local additions report, never as drift.
      await installPrompts(dir)
      await writeFile(join(dir, "prompts", "local-note.md"), "the person's own\n")
      const withExtra = await checkPrompts(dir)
      expect(withExtra.drifted).toEqual([])
      expect(withExtra.manifest).toBe("current")
      expect(withExtra.extra).toEqual(["local-note.md"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("checkPrompts reports a never-installed prompts/ wholesale missing", async () => {
    const dir = await makeProject()
    try {
      const report = await checkPrompts(dir)
      expect(report.drifted).toEqual([])
      expect(report.missing.sort()).toEqual([...PROMPT_SUITE].sort())
      expect(report.manifest).toBe("missing")
      expect(report.extra).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the formatter names the directory and the outcome", async () => {
    const current = formatInstallPrompts("/proj", { written: [], unchanged: ["run.md"], extra: [], suite: "sha256-abc" })
    expect(current).toEqual([
      "prompt suite already current in /proj/prompts: 1 files",
      `  manifest: prompts/${MANIFEST_NAME} pins this suite (sha256-abc)`,
    ])
    const resynced = formatInstallPrompts("/proj", {
      written: ["run.md", "run-task.md"],
      unchanged: ["charter.md"],
      extra: ["local-note.md"],
      suite: "sha256-abc",
    })
    expect(resynced).toEqual([
      "prompt suite resynced into /proj/prompts: 3 files (2 rewritten, 1 unchanged)",
      "  rewritten: run.md, run-task.md",
      `  manifest: prompts/${MANIFEST_NAME} pins this suite (sha256-abc)`,
      "  left alone (not in the suite): local-note.md",
    ])
  })

  test("the check formatter separates clean from each drift shape", async () => {
    expect(formatCheckPrompts("/proj", { drifted: [], missing: [], manifest: "current", extra: [] })).toEqual([
      "prompt suite current in /proj/prompts (the manifest pins this binary's suite)",
    ])
    expect(
      formatCheckPrompts("/proj", {
        drifted: ["run.md"],
        missing: ["charter.md"],
        manifest: "stale",
        extra: ["local-note.md"],
      }),
    ).toEqual([
      "prompt suite drift in /proj/prompts:",
      "  drifted from this binary's suite: run.md",
      "  missing: charter.md",
      `  manifest stale: it pins a suite other than this binary's`,
      "  left alone (not in the suite): local-note.md",
    ])
    expect(formatCheckPrompts("/proj", { drifted: [], missing: [], manifest: "missing", extra: [] })).toEqual([
      "prompt suite drift in /proj/prompts:",
      `  manifest absent: prompts/${MANIFEST_NAME} pins no vintage (installed before it existed, or removed)`,
    ])
  })
})
