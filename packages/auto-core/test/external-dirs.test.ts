import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  applyExternalAllows,
  applyKnowledgeBoundary,
  externalAllowsStatus,
  externalDirectoryEntries,
  knowledgeBoundaryMissing,
  missingExternalDirectoryAllows,
  missingReadOnlyEditDenies,
  readOnlyEditEntries,
  rootSymlinkRealPaths,
  staleExternalDirectoryAllows,
  stampExternalDirectories,
  stampKnowledgeBoundary,
  stampReadOnlyEdits,
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
      // The read-only composite (plans/0147 D2): both layers named — the
      // external_directory allow and the edit-layer deny.
      expect(status).toEqual({ status: "needs-stamp", missing: [`${corpus}/**`, `edit:${corpus}/**`] })
      expect(await applyExternalAllows(project)).toBe(true)
      expect(await readFile(file, "utf8")).toBe(
        JSON.stringify(
          { permission: { external_directory: { [`${corpus}/**`]: "allow" }, read: "allow", edit: { "*": "ask", [`${corpus}/**`]: "deny" } } },
          null,
          2,
        ) + "\n",
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

// —— The wall-side entries (plans/0132 D2) ——

import { allowBase, allowCovers, coveringAllowKeys, externalDirectoryLive, rootSymlinkDoors, stampKey, stampWallClosure } from "../src/external-dirs"

describe("rootSymlinkDoors (plans/0132): the name→target pairs the wall records", () => {
  test("keeps external doors as pairs, sorted by name, with the same exclusion rules", async () => {
    const { project, corpus } = await fixture()
    try {
      await symlink(corpus, join(project, "linux"))
      await symlink(corpus, join(project, "aaa"))
      await mkdir(join(project, "inside"))
      await symlink(join(project, "inside"), join(project, "self"))
      const doors = await rootSymlinkDoors(project)
      expect(doors.map((door) => door.name)).toEqual(["aaa", "linux"])
      expect(doors.every((door) => door.target === corpus)).toBe(true)
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })
})

describe("the wall's entry readers and the closure write", () => {
  const text = (external: Record<string, string>) =>
    JSON.stringify({ permission: { external_directory: external, read: { "*": "allow" } } }, null, 2) + "\n"

  test("allowBase/allowCovers: a directory pattern covers the target itself and everything beneath, nothing else", () => {
    expect(allowBase("/corpus/**")).toBe("/corpus")
    expect(allowBase("/corpus")).toBeUndefined()
    expect(allowCovers("/corpus/**", "/corpus")).toBe(true)
    expect(allowCovers("/corpus/**", "/corpus/sub/file.c")).toBe(true)
    expect(allowCovers("/corpus/**", "/corpus-x/file.c")).toBe(false)
    expect(allowCovers("/other/**", "/corpus")).toBe(false)
  })

  test("externalDirectoryLive and coveringAllowKeys: only live allow entries covering a target, sorted; malformed stays undefined", () => {
    const t = text({ "/person/**": "allow", [stampKey("/corpus")]: "allow", "/denied/**": "deny" })
    expect(externalDirectoryLive(t)).toMatchObject({ "/person/**": "allow", [stampKey("/corpus")]: "allow", "/denied/**": "deny" })
    expect(coveringAllowKeys(t, ["/corpus"])).toEqual([stampKey("/corpus")])
    // A person's parent glob covers the target too — the person-entry split
    // names it at the close.
    expect(coveringAllowKeys(text({ "/tmp/**": "allow" }), ["/tmp/corpus"])).toEqual(["/tmp/**"])
    expect(coveringAllowKeys("not json", ["/corpus"])).toEqual([])
    expect(externalDirectoryLive("not json")).toBeUndefined()
  })

  test("stampWallClosure retires the exact stamps, keeps person keys, lands the denies at the front — idempotent", () => {
    const t = text({ "/person/**": "deny", [stampKey("/corpus")]: "allow" })
    const closed = stampWallClosure(t, ["/corpus", "/other"])!
    const parsed = JSON.parse(closed) as any
    expect(Object.keys(parsed.permission.external_directory)).toEqual([stampKey("/corpus"), stampKey("/other"), "/person/**"])
    expect(parsed.permission.external_directory[stampKey("/corpus")]).toBe("deny")
    expect(parsed.permission.external_directory[stampKey("/other")]).toBe("deny")
    expect(parsed.permission.external_directory["/person/**"]).toBe("deny")
    // Idempotent: a second pass is byte-stable; nothing else moves.
    expect(stampWallClosure(closed, ["/corpus", "/other"])).toBe(closed)
  })

  test("a person's deny on the exact key stays a deny; an absent section is created; malformed is never guessed", () => {
    const personDeny = text({ [stampKey("/corpus")]: "deny" })
    expect(stampWallClosure(personDeny, ["/corpus"])).toBe(personDeny)
    const noSection = JSON.stringify({ permission: { read: "allow" } }, null, 2) + "\n"
    const created = stampWallClosure(noSection, ["/corpus"])!
    expect((JSON.parse(created) as any).permission.external_directory).toEqual({ [stampKey("/corpus")]: "deny" })
    expect(stampWallClosure("not json", ["/corpus"])).toBeUndefined()
  })
})

// —— The working-directory knowledge boundary and the read-only composite (plans/0147) ——

describe("stampKnowledgeBoundary (plans/0147 D1)", () => {
  test("inserts deny-/** then allow-/tmp at the front; existing allows keep functioning after the deny; idempotent", () => {
    const before = JSON.stringify({ permission: { external_directory: { "/corpus/**": "allow", "/person/**": "deny" } } }) + "\n"
    const stamped = stampKnowledgeBoundary(before)!
    const parsed = JSON.parse(stamped) as any
    // The deny first, /tmp after it (winning its tie), the existing corpus
    // allow after both (still winning its tie against the deny), the
    // person's key last.
    expect(Object.keys(parsed.permission.external_directory)).toEqual(["/**", "/tmp/**", "/corpus/**", "/person/**"])
    expect(stampKnowledgeBoundary(stamped)).toBe(stamped)
    // A person's own /** key of any action is the same wall: present, never inserted over.
    const personWall = JSON.stringify({ permission: { external_directory: { "/**": "ask" } } }) + "\n"
    expect(knowledgeBoundaryMissing(personWall)).toBe(true)
    const stamped2 = stampKnowledgeBoundary(personWall)!
    expect((JSON.parse(stamped2) as any).permission.external_directory["/**"]).toBe("ask")
    expect((JSON.parse(stamped2) as any).permission.external_directory["/tmp/**"]).toBe("allow")
    expect(stampKnowledgeBoundary("not json")).toBeUndefined()
  })

  test("an absent permission or section gains the pair; apply writes idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-boundary-"))
    try {
      const file = join(dir, "opencode.json")
      await writeFile(file, JSON.stringify({ model: "mine" }, null, 2) + "\n")
      expect(await applyKnowledgeBoundary(dir)).toBe(true)
      const parsed = JSON.parse(await readFile(file, "utf8")) as any
      expect(parsed.permission.external_directory).toEqual({ "/**": "deny", "/tmp/**": "allow" })
      expect(parsed.model).toBe("mine")
      expect(await applyKnowledgeBoundary(dir)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("stampReadOnlyEdits (plans/0147 D2)", () => {
  const entries = readOnlyEditEntries(["/corpus"])

  test("an absent edit rule materializes as the object form preserving the effective default; a bare action becomes the leading * entry", () => {
    const absent = stampReadOnlyEdits(JSON.stringify({ permission: {} }) + "\n", entries)!
    expect((JSON.parse(absent) as any).permission.edit).toEqual({ "*": "ask", "/corpus/**": "deny" })
    const bare = stampReadOnlyEdits(JSON.stringify({ permission: { edit: "allow" } }) + "\n", entries)!
    expect((JSON.parse(bare) as any).permission.edit).toEqual({ "*": "allow", "/corpus/**": "deny" })
  })

  test("an existing edit object keeps its order, the deny placed to beat the blanket action and lose to the person's later keys", () => {
    const object = stampReadOnlyEdits(JSON.stringify({ permission: { edit: { "/person/**": "allow", "*": "allow" } } }) + "\n", entries)!
    expect(Object.keys((JSON.parse(object) as any).permission.edit)).toEqual(["/person/**", "*", "/corpus/**"])
    // A person key already on the deny's key is never inserted over.
    expect(missingReadOnlyEditDenies(JSON.stringify({ permission: { edit: { "/corpus/**": "ask" } } }) + "\n", entries)).toEqual([])
    expect(stampReadOnlyEdits("not json", entries)).toBeUndefined()
  })
})

describe("the stamp ordering under the boundary (plans/0147 D1/D2)", () => {
  test("a symlink allow lands after the /** deny and therefore wins its tie; without the deny, the 0122 front insert", () => {
    const withBoundary = JSON.stringify({ permission: { external_directory: { "/**": "deny", "/tmp/**": "allow" } } }) + "\n"
    const stamped = stampExternalDirectories(withBoundary, externalDirectoryEntries(["/corpus"]))!
    expect(Object.keys((JSON.parse(stamped) as any).permission.external_directory)).toEqual(["/**", "/corpus/**", "/tmp/**"])
    const without = JSON.stringify({ permission: { external_directory: { "/person/**": "deny" } } }) + "\n"
    const stamped0122 = stampExternalDirectories(without, externalDirectoryEntries(["/corpus"]))!
    expect(Object.keys((JSON.parse(stamped0122) as any).permission.external_directory)).toEqual(["/corpus/**", "/person/**"])
  })
})
