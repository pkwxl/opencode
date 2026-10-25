import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  applyExternalAllows,
  externalAllowsStatus,
  externalDirectoryEntries,
  missingExternalDirectoryAllows,
  rootSymlinkRealPaths,
  staleExternalDirectoryAllows,
  stampExternalDirectories,
} from "../src/external-dirs"

// The corpus and the project side by side under tmp (siblings, never nested:
// the scan keeps only real paths outside the project root).
async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "auto-ext-project-"))
  const corpus = await mkdtemp(join(tmpdir(), "auto-ext-corpus-"))
  await writeFile(join(corpus, "timer.c"), "enum\n")
  return { project, corpus }
}

const entries = (paths: readonly string[]) => externalDirectoryEntries(paths)

describe("rootSymlinkRealPaths (plans/0122)", () => {
  test("keeps external symlinks, skips internal, broken and non-symlink roots, excludes ancestors, dedupes", async () => {
    const { project, corpus } = await fixture()
    try {
      await mkdir(join(project, "inside"))
      await symlink(corpus, join(project, "linux"))
      await symlink(join(project, "inside"), join(project, "self"))
      await symlink(join(corpus, "gone"), join(project, "broken"))
      await symlink(dirname(project), join(project, "parent"))
      await symlink(corpus, join(project, "linux-again"))
      const found = await rootSymlinkRealPaths(project)
      expect(found).toEqual([corpus])
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })

  test("an empty root reads as no symlinks", async () => {
    const { project, corpus } = await fixture()
    try {
      expect(await rootSymlinkRealPaths(project)).toEqual([])
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })

  test("entries map real paths to allow patterns in sorted order", () => {
    expect(entries(["/b", "/a"])).toEqual({ "/a/**": "allow", "/b/**": "allow" })
  })
})

describe("missingExternalDirectoryAllows and stampExternalDirectories", () => {
  const person = (external?: string) =>
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        model: "prov/model",
        permission: {
          ...(external === undefined ? {} : { external_directory: JSON.parse(external) }),
          read: { "*": "allow", "/secrets/**": "deny" },
          bash: { "*": "allow" },
        },
      },
      null,
      2,
    ) + "\n"

  test("a key the person already set, to any action, counts as present", () => {
    const text = person(`{ "/corpus/**": "deny" }`)
    expect(missingExternalDirectoryAllows(text, entries(["/corpus"]))).toEqual([])
    // Nothing missing: the stamp returns the text unchanged.
    expect(stampExternalDirectories(text, entries(["/corpus"]))).toBe(text)
  })

  test("inserts missing entries at the front of external_directory, preserving person keys and every other key", () => {
    const text = person(`{ "/person/**": "deny", "/other/**": "allow" }`)
    const stamped = stampExternalDirectories(text, entries(["/corpus"]))!
    const parsed = JSON.parse(stamped) as any
    expect(Object.keys(parsed.permission.external_directory)).toEqual(["/corpus/**", "/person/**", "/other/**"])
    expect(parsed.permission.external_directory["/corpus/**"]).toBe("allow")
    expect(parsed.permission.external_directory["/person/**"]).toBe("deny")
    expect(Object.keys(parsed.permission)).toEqual(["external_directory", "read", "bash"])
    expect(parsed.$schema).toBe("https://opencode.ai/config.json")
    expect(parsed.model).toBe("prov/model")
    expect(stamped.endsWith("}\n")).toBe(true)
    // Idempotent: a second pass is byte-stable and changes nothing.
    expect(stampExternalDirectories(stamped, entries(["/corpus"]))).toBe(stamped)
  })

  test("creates external_directory when permission exists without it, and permission when absent", () => {
    const withoutSection = JSON.stringify({ $schema: "s", permission: { read: "allow" } }, null, 2) + "\n"
    const stamped = stampExternalDirectories(withoutSection, entries(["/corpus"]))!
    const parsed = JSON.parse(stamped) as any
    expect(Object.keys(parsed.permission)).toEqual(["external_directory", "read"])
    expect(parsed.permission.external_directory).toEqual({ "/corpus/**": "allow" })

    const withoutPermission = JSON.stringify({ model: "m" }, null, 2) + "\n"
    const stamped2 = stampExternalDirectories(withoutPermission, entries(["/corpus"]))!
    const parsed2 = JSON.parse(stamped2) as any
    expect(Object.keys(parsed2)).toEqual(["model", "permission"])
    expect(parsed2.permission.external_directory).toEqual({ "/corpus/**": "allow" })
  })

  test("malformed text and a flat external_directory action read as undefined, never a guess", () => {
    expect(stampExternalDirectories("{ not json", entries(["/corpus"]))).toBeUndefined()
    expect(missingExternalDirectoryAllows("[1,2]", entries(["/corpus"]))).toBeUndefined()
    const flat = JSON.stringify({ permission: { external_directory: "ask", read: "allow" } }, null, 2) + "\n"
    expect(missingExternalDirectoryAllows(flat, entries(["/corpus"]))).toBeUndefined()
    expect(stampExternalDirectories(flat, entries(["/corpus"]))).toBeUndefined()
  })
})

describe("staleExternalDirectoryAllows", () => {
  test("reports allow entries whose base is neither current nor on disk", async () => {
    const { project, corpus } = await fixture()
    try {
      await symlink(corpus, join(project, "linux"))
      await mkdir(join(project, "kept"))
      const kept = join(project, "kept")
      const text =
        JSON.stringify(
          {
            permission: {
              external_directory: {
                "/gone/**": "allow",
                [`${corpus}/**`]: "allow",
                [`${kept}/**`]: "allow",
                "/denied/**": "deny",
                "/no-glob": "allow",
              },
            },
          },
          null,
          2,
        ) + "\n"
      const stale = await staleExternalDirectoryAllows(text, await rootSymlinkRealPaths(project))
      expect(stale).toEqual(["/gone/**"])
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })
})

describe("externalAllowsStatus and applyExternalAllows", () => {
  test("no root symlinks is the byte-identical floor: no findings, no writes", async () => {
    const { project, corpus } = await fixture()
    try {
      expect(await externalAllowsStatus(project)).toEqual({ status: "no-symlinks" })
      expect(await applyExternalAllows(project)).toBe(false)
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })

  test("stamps a read-only existing file, reports malformed, and is idempotent", async () => {
    const { project, corpus } = await fixture()
    try {
      await symlink(corpus, join(project, "linux"))
      const file = join(project, "opencode.json")
      await writeFile(file, JSON.stringify({ permission: { read: "allow" } }, null, 2) + "\n")
      await chmod(file, 0o444)

      const status = await externalAllowsStatus(project)
      expect(status).toEqual({ status: "needs-stamp", missing: [`${corpus}/**`] })
      expect(await applyExternalAllows(project)).toBe(true)
      expect(await readFile(file, "utf8")).toBe(
        JSON.stringify({ permission: { external_directory: { [`${corpus}/**`]: "allow" }, read: "allow" } }, null, 2) + "\n",
      )
      expect(await externalAllowsStatus(project)).toEqual({ status: "unchanged" })
      expect(await applyExternalAllows(project)).toBe(false)

      await writeFile(file, "not json")
      expect(await externalAllowsStatus(project)).toEqual({ status: "malformed" })
      const before = await readFile(file, "utf8")
      expect(await applyExternalAllows(project)).toBe(false)
      expect(await readFile(file, "utf8")).toBe(before)
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })

  test("a missing file reports missing; apply writes nothing", async () => {
    const { project, corpus } = await fixture()
    try {
      await symlink(corpus, join(project, "linux"))
      expect(await externalAllowsStatus(project)).toEqual({ status: "missing" })
      expect(await applyExternalAllows(project)).toBe(false)
      expect(await readdir(project)).toContain("linux")
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })
})
