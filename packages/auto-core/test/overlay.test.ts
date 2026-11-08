// The overlay loader's own laws (plans/0232 D2, finding 0165-063/S01-05 —
// the module had no direct test import): the one home both overlay surfaces
// (mode files, intent packs) share — the .opencode/auto/<sub>/<name>.md
// files of a target directory, read sorted and .md-filtered under the shared
// name grammar, a missing or non-directory overlay the empty overlay (the
// built-ins alone), any other read error rethrown. The callers' section
// protocols (mode.ts, intent/load.ts) are their own suites' subject; these
// pins hold the loader's half so a drift in the shared grammar fails here
// first, at the seam every surface rides.
import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { overlayMarkdownFiles } from "../src/overlay"

const overlayDir = (dir: string) => join(dir, ".opencode", "auto", "modes")

describe("overlayMarkdownFiles", () => {
  test("reads the .md files of the overlay directory, sorted, names without the suffix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-overlay-"))
    try {
      await mkdir(overlayDir(dir), { recursive: true })
      await writeFile(join(overlayDir(dir), "b-file.md"), "the second")
      await writeFile(join(overlayDir(dir), "a-file.md"), "the first")
      const loaded = overlayMarkdownFiles(dir, "modes", "mode")
      expect(loaded.map((file) => file.name)).toEqual(["a-file", "b-file"])
      expect(loaded.map((file) => file.text)).toEqual(["the first", "the second"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("non-.md files are ignored; a directory whose name ends in .md rethrows (never silently skipped)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-overlay-"))
    try {
      await mkdir(overlayDir(dir), { recursive: true })
      await writeFile(join(overlayDir(dir), "a.txt"), "not an overlay file")
      await writeFile(join(overlayDir(dir), "notes.md.bak"), "not either")
      // The .md filter is on the name alone: a directory named nested.md
      // passes it and the read then fails EISDIR — the rethrow arm, the
      // conservative answer over a silent skip (the overlay directory is a
      // driver-owned surface; a stray directory there is surfaced, not
      // swallowed).
      await mkdir(join(overlayDir(dir), "nested.md"))
      let threw: unknown
      try {
        overlayMarkdownFiles(dir, "modes", "mode")
      } catch (error) {
        threw = error
      }
      expect((threw as NodeJS.ErrnoException)?.code).toBe("EISDIR")
      await rm(join(overlayDir(dir), "nested.md"), { recursive: true })
      expect(overlayMarkdownFiles(dir, "modes", "mode")).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a missing overlay directory and a non-directory overlay are the empty overlay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-overlay-"))
    try {
      expect(overlayMarkdownFiles(dir, "modes", "mode")).toEqual([])
      await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
      await writeFile(join(dir, ".opencode", "auto", "modes"), "a file where the directory would be")
      expect(overlayMarkdownFiles(dir, "modes", "mode")).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a name outside the shared grammar throws, naming the file class and the full overlay path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-overlay-"))
    try {
      await mkdir(overlayDir(dir), { recursive: true })
      // Uppercase, a leading digit and a leading hyphen all violate the
      // grammar (a lowercase letter, then letters/digits/hyphens).
      for (const bad of ["Bad.md", "2fast.md", "-lead.md"]) {
        await writeFile(join(overlayDir(dir), bad), "x")
        // The kind names the file class ("mode" / "intent pack"); the
        // template appends "file name".
        expect(() => overlayMarkdownFiles(dir, "modes", "mode")).toThrow(
          `mode file name ${join(".opencode", "auto", "modes", bad)} is invalid: must be a lowercase letter followed by letters/digits/hyphens`,
        )
        await rm(join(overlayDir(dir), bad))
      }
      // The legal edges load: a single letter, digits and hyphens inside.
      await writeFile(join(overlayDir(dir), "a.md"), "x")
      await writeFile(join(overlayDir(dir), "m2-alpha.md"), "y")
      expect(overlayMarkdownFiles(dir, "modes", "mode").map((file) => file.name)).toEqual(["a", "m2-alpha"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("any other read error rethrows (not the empty overlay)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-overlay-"))
    try {
      await mkdir(overlayDir(dir), { recursive: true })
      await writeFile(join(overlayDir(dir), "locked.md"), "x")
      await chmod(join(overlayDir(dir), "locked.md"), 0o000)
      let threw: unknown
      try {
        overlayMarkdownFiles(dir, "modes", "mode")
      } catch (error) {
        threw = error
      }
      expect(threw).toBeDefined()
      expect((threw as NodeJS.ErrnoException).code).toBe("EACCES")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
