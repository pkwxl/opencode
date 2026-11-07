import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import {
  applyExternalAllows,
  applyKnowledgeBoundary,
  catchAllFor,
  EDIT_ASKS,
  EXTERNAL_DIRECTORY_ASKS,
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
import { admission, match } from "./helpers/perm-oracle"

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

      // The relative deny's anchor: a bare directory (no repository) falls
      // back to the physical dir — the corpus is a sibling, so `../<name>`.
      const rel = relative(project, corpus).replaceAll("\\", "/")
      const status = await externalAllowsStatus(project)
      // The read-only composite (plans/0147 D2, the ask forms since 0188
      // D3): both layers named — the external_directory allow and the
      // edit-layer deny in every form the live tools ask.
      expect(status).toEqual({ status: "needs-stamp", missing: [`${corpus}/**`, `edit:${corpus}/**`, `edit:${rel}/**`, "edit:linux/**"] })
      expect(await applyExternalAllows(project)).toBe(true)
      expect(await readFile(file, "utf8")).toBe(
        JSON.stringify(
          { permission: { external_directory: { [`${corpus}/**`]: "allow" }, read: "allow", edit: { "*": "ask", [`${corpus}/**`]: "deny", [`${rel}/**`]: "deny", "linux/**": "deny" } } },
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

import { admittingCoverage, allowBase, allowCovers, externalDirectoryLive, pathsOverlap, rootSymlinkDoors, stampKey, stampWallClosure } from "../src/external-dirs"

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

  test("externalDirectoryLive: the live section, malformed undefined; pathsOverlap: same tree, beneath or over", () => {
    const t = text({ "/person/**": "allow", [stampKey("/corpus")]: "allow", "/denied/**": "deny" })
    expect(externalDirectoryLive(t)).toMatchObject({ "/person/**": "allow", [stampKey("/corpus")]: "allow", "/denied/**": "deny" })
    expect(externalDirectoryLive("not json")).toBeUndefined()
    expect(pathsOverlap("/corpus", "/corpus")).toBe(true)
    expect(pathsOverlap("/corpus/sub", "/corpus")).toBe(true)
    expect(pathsOverlap("/corpus", "/corpus-x")).toBe(false)
    // Over: an ancestor of the target re-admits it as surely as a door
    // inside it (plans/0189 D3).
    expect(pathsOverlap("/workspace", "/workspace/linux/corpus")).toBe(true)
  })

  // The coverage evaluator (plans/0189 D3): the closed predicate's allow
  // half answers with opencode's own semantics — every ask beneath the
  // target derived from the section itself, last-match-wins, `~`/`$HOME`
  // expanded, any answer other than deny open, the winning entry named.
  // Fail-before red: the retired lexical scan (coveringAllowKeys) saw only
  // `<path>/**` allows whose base prefixes the target — the shapes below
  // read closed while admitting (0165-038's measurement).
  test("admittingCoverage: the stamp slot, the person parent glob, the sealed deny", () => {
    // The interrupted retirement: the exact stamp key at allow — the
    // driver's own slot, named for the finish.
    const stamp = admittingCoverage(text({ [stampKey("/corpus")]: "allow" }), ["/corpus"])
    expect(stamp).toEqual([{ target: "/corpus", ask: "/corpus/*", key: stampKey("/corpus"), action: "allow" }])
    // A person's parent glob covering the target — the last matching entry
    // wins, and it is the person's.
    const person = admittingCoverage(text({ [stampKey("/corpus")]: "allow", "/**": "allow" }), ["/corpus"])
    expect(person).toEqual([{ target: "/corpus", ask: "/corpus/*", key: "/**", action: "allow" }])
    // The sealed shape: the stamp-slot deny answers deny — closed.
    expect(admittingCoverage(text({ [stampKey("/corpus")]: "deny", "/**": "deny" }), ["/corpus"])).toEqual([])
    expect(admittingCoverage("not json", ["/corpus"])).toEqual([])
  })

  test("admittingCoverage reads the channels the lexical scan never saw: catch-all last, subtree allow, ~-expanded, ask at the slot, the deny gone (0165-038)", () => {
    // A person catch-all allow landing last beats the seal's front deny.
    const catchAll = admittingCoverage(text({ [stampKey("/corpus")]: "deny", "*": "allow" }), ["/corpus"])
    expect(catchAll[0]).toMatchObject({ key: "*", action: "allow" })
    // A subtree allow fix once stamped past the seal: the section's own
    // scope ask carries it.
    const subtree = admittingCoverage(text({ [stampKey("/corpus")]: "deny", [stampKey("/corpus/sub")]: "allow" }), ["/corpus"])
    expect(subtree[0]).toMatchObject({ ask: "/corpus/sub/*", key: stampKey("/corpus/sub"), action: "allow" })
    // A `~`-expanded allow over the corpus (the corpus pinned under the
    // home dir for the expansion to reach it).
    const tilde = admittingCoverage(text({ "~/corp/**": "allow" }), [join(homedir(), "corp")])
    expect(tilde[0]).toMatchObject({ key: "~/corp/**", action: "allow" })
    // A person ask on the slot: any answer but deny is open (P12).
    const ask = admittingCoverage(text({ [stampKey("/corpus")]: "ask" }), ["/corpus"])
    expect(ask).toEqual([{ target: "/corpus", ask: "/corpus/*", key: stampKey("/corpus"), action: "ask" }])
    // Nothing matches at all — even the wall's deny is gone from the
    // section (key undefined, the ask default).
    const gone = admittingCoverage(text({ "/elsewhere/**": "deny" }), ["/corpus"])
    expect(gone).toEqual([{ target: "/corpus", ask: "/corpus/*", action: "ask" }])
  })

  test("admittingCoverage agrees with the admission oracle over the defect corpus (plans/0189 D3, the 0188 oracle)", () => {
    const corpus = "/corpus"
    const shapes = [
      text({ [stampKey(corpus)]: "deny", "*": "allow" }),
      text({ [stampKey(corpus)]: "deny", [stampKey(`${corpus}/sub`)]: "allow" }),
      text({ [stampKey(corpus)]: "allow" }),
      text({ [stampKey(corpus)]: "deny" }),
      text({ "/**": "deny", "/tmp/**": "allow", [stampKey(corpus)]: "deny" }),
      text({ [stampKey(corpus)]: "ask" }),
      text({}),
    ]
    const asks = [`${corpus}/*`, `${corpus}/sub/*`, `${corpus}/sub/deep/*`]
    for (const shape of shapes) {
      const open = admittingCoverage(shape, [corpus])
      for (const ask of asks) {
        const oracleAnswer = admission(shape, "external_directory", ask)
        if (oracleAnswer === "deny") continue
        // The oracle admits this ask; the evaluator must flag the target
        // open with the same ask or one beneath it.
        expect(open.length).toBeGreaterThan(0)
        expect(open.some((finding) => finding.ask === ask || ask.startsWith(`${finding.ask.slice(0, -1)}`))).toBe(true)
      }
      // And wherever the evaluator flags open, the oracle agrees the ask
      // admits (never deny).
      for (const finding of open) {
        expect(admission(shape, "external_directory", finding.ask)).not.toBe("deny")
      }
    }
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

describe("stampReadOnlyEdits (plans/0147 D2, the ask forms plans/0188 D3)", () => {
  const entries = readOnlyEditEntries([{ name: "linux", target: "/corpus" }], "/proj")

  test("an absent edit rule materializes as the object form preserving the effective default; a bare action becomes the leading * entry", () => {
    const absent = stampReadOnlyEdits(JSON.stringify({ permission: {} }) + "\n", entries)!
    expect((JSON.parse(absent) as any).permission.edit).toEqual({ "*": "ask", "/corpus/**": "deny", "../corpus/**": "deny", "linux/**": "deny" })
    const bare = stampReadOnlyEdits(JSON.stringify({ permission: { edit: "allow" } }) + "\n", entries)!
    expect((JSON.parse(bare) as any).permission.edit).toEqual({ "*": "allow", "/corpus/**": "deny", "../corpus/**": "deny", "linux/**": "deny" })
  })

  test("an existing edit object keeps its order, the denies placed to beat the blanket action and lose to the person's later keys", () => {
    const object = stampReadOnlyEdits(JSON.stringify({ permission: { edit: { "/person/**": "allow", "*": "allow" } } }) + "\n", entries)!
    expect(Object.keys((JSON.parse(object) as any).permission.edit)).toEqual(["/person/**", "*", "/corpus/**", "../corpus/**", "linux/**"])
    // Person keys already on the deny keys (any of them) are never inserted over.
    const personOwned = JSON.stringify({ permission: { edit: { "/corpus/**": "ask", "../corpus/**": "ask", "linux/**": "ask" } } }) + "\n"
    expect(missingReadOnlyEditDenies(personOwned, entries)).toEqual([])
    expect(stampReadOnlyEdits("not json", entries)).toBeUndefined()
  })

  test("the entries: one door contributes the target, its worktree-relative form and the door name; several doors share the target key", () => {
    expect(readOnlyEditEntries([{ name: "linux", target: "/corpus" }, { name: "aaa", target: "/corpus" }], "/proj")).toEqual({
      "/corpus/**": "deny",
      "../corpus/**": "deny",
      "linux/**": "deny",
      "aaa/**": "deny",
    })
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

describe("the 0155 pins: the boundary pair under a person catch-all, the seal's standing deny", () => {
  test("stampKnowledgeBoundary places the missing pair after a person-set /** key — the /tmp allowance wins its tie against that catch-all (D3)", () => {
    // The exact quiet break: a person-set "/**": "deny" with /tmp missing —
    // the old front insert left "/tmp/**" before the deny and last-match-wins
    // silently disabled the receipts convention.
    const personCatchAll = JSON.stringify({ permission: { external_directory: { "/**": "deny", "/person/**": "ask" } } }) + "\n"
    expect(knowledgeBoundaryMissing(personCatchAll)).toBe(true)
    const stamped = stampKnowledgeBoundary(personCatchAll)!
    expect(Object.keys((JSON.parse(stamped) as any).permission.external_directory)).toEqual(["/**", "/tmp/**", "/person/**"])
    // The same placement under a person catch-all of another action (never
    // inserted over): /tmp still wins its tie.
    const askWall = JSON.stringify({ permission: { external_directory: { "/**": "ask" } } }) + "\n"
    const stamped2 = stampKnowledgeBoundary(askWall)!
    expect(Object.keys((JSON.parse(stamped2) as any).permission.external_directory)).toEqual(["/**", "/tmp/**"])
    expect((JSON.parse(stamped2) as any).permission.external_directory["/**"]).toBe("ask")
  })

  test("stampWallClosure: a person ask on a stamp key is overridden by the seal's standing deny; every other person key keeps its action and order (D3)", () => {
    const personAsk = JSON.stringify({ permission: { external_directory: { [stampKey("/corpus")]: "ask", "/person/**": "allow" } } }) + "\n"
    const closed = stampWallClosure(personAsk, ["/corpus"])!
    const external = (JSON.parse(closed) as any).permission.external_directory
    expect(external).toEqual({ [stampKey("/corpus")]: "deny", "/person/**": "allow" })
    expect(Object.keys(external)).toEqual([stampKey("/corpus"), "/person/**"])
  })
})

// —— The admission oracle and the stamps it judges (plans/0188) ——

describe("the mirror pin (plans/0188 D2): the catch-all predicate agrees with opencode's own matcher", () => {
  const spellings = ["*", "**", "***", "/*", "/**", "/?*", "/a/**", "**/*", "?", "src/**", "/tmp/**", "/a/*", "*/*", "/Workspace/**"]

  test("catchAllFor equals the imported matcher's verdict over the spelling corpus, both layers", () => {
    for (const key of spellings) {
      expect(catchAllFor(EXTERNAL_DIRECTORY_ASKS, key)).toBe(EXTERNAL_DIRECTORY_ASKS.every((ask) => match(ask, key)))
      expect(catchAllFor(EDIT_ASKS, key)).toBe(EDIT_ASKS.every((ask) => match(ask, key)))
    }
  })

  test("the ruled classification: the absolute layer admits every slash-crossing wildcard; the relative edit layer only * and **", () => {
    // Every external ask is an absolute `<dirname>/*` glob — at least one
    // slash, always leading — so `/**`, `/*`, `*`, `**`, `/?*`, `**/*` and
    // `*/*` all cover it; the edit asks include a bare `z`, so only the
    // slash-free `*` and `**` cover them.
    for (const key of ["/**", "/*", "*", "**", "/?*", "**/*", "*/*"]) expect(catchAllFor(EXTERNAL_DIRECTORY_ASKS, key)).toBe(true)
    for (const key of ["*", "**"]) expect(catchAllFor(EDIT_ASKS, key)).toBe(true)
    for (const key of ["/a/**", "?", "src/**", "/tmp/**", "/a/*"]) expect(catchAllFor(EXTERNAL_DIRECTORY_ASKS, key)).toBe(false)
    for (const key of ["/**", "/*", "/?*", "/a/**", "**/*", "?", "src/**", "/tmp/**", "/a/*", "*/*"]) expect(catchAllFor(EDIT_ASKS, key)).toBe(false)
  })
})

describe("the catch-all placement under the oracle (plans/0188 D2, 0165-150): every spelling, both layers", () => {
  test("a person external catch-all spelled *, ** or /* lands last: the stamped allow and the /tmp allowance still function beneath it", () => {
    for (const catchAll of ["*", "**", "/*", "/**"]) {
      const external: Record<string, string> = { "/mine/**": "ask" }
      if (catchAll !== "/**") external["/**"] = "deny"
      external[catchAll] = "deny"
      const person = JSON.stringify({ permission: { external_directory: external } }) + "\n"
      const allowed = stampExternalDirectories(person, externalDirectoryEntries(["/workspace/linux"]))!
      const bounded = stampKnowledgeBoundary(allowed)!
      // The exact quiet break the old literal cut let through: the inserts
      // landed before the person's trailing catch-all and last-match-wins
      // killed them — the corpus read denied, the receipts convention off.
      expect(admission(bounded, "external_directory", "/workspace/linux/drivers/*")).toBe("allow")
      expect(admission(bounded, "external_directory", "/tmp/opencode/receipt.md")).toBe("allow")
      expect(admission(bounded, "external_directory", "/other/fork/src/x.c")).toBe("deny")
    }
  })

  test("an edit object's catch-all spelled ** (beside the blanket *): the read-only denies still function beneath it", () => {
    const entries = readOnlyEditEntries([{ name: "linux", target: "/corpus" }], "/proj")
    const person = JSON.stringify({ permission: { edit: { "/mine/**": "allow", "*": "allow", "**": "allow" } } }) + "\n"
    const stamped = stampReadOnlyEdits(person, entries)!
    expect(admission(stamped, "edit", "../corpus/drivers/x.c")).toBe("deny")
    expect(admission(stamped, "edit", "linux/drivers/x.c")).toBe("deny")
    // Everything of the person's keeps winning its tie.
    expect(admission(stamped, "edit", "mine/x.c")).toBe("allow")
    expect(admission(stamped, "edit", "other.c")).toBe("allow")
  })
})

describe("the read-only composite under the oracle (plans/0188 D1/D3, 0165-039)", () => {
  test("a stamped project denies both live edit ask shapes and allows the corpus read; the blanket action stays the floor", async () => {
    const { project, corpus } = await fixture()
    try {
      await symlink(corpus, join(project, "linux"))
      const file = join(project, "opencode.json")
      await writeFile(file, JSON.stringify({ permission: { edit: { "*": "allow" } } }, null, 2) + "\n")
      expect(await applyExternalAllows(project)).toBe(true)
      const stamped = await readFile(file, "utf8")
      // The read side opens (0122): the external_directory ask names the
      // corpus by its real path.
      expect(admission(stamped, "external_directory", `${corpus}/drivers/*`)).toBe("allow")
      // The write side closes on every ask shape the live tools send
      // (0188 D3): an absolute-path edit asks the worktree-relative form of
      // the corpus; an in-tree edit through the door asks the door name.
      const rel = relative(project, corpus).replaceAll("\\", "/")
      expect(admission(stamped, "edit", `${rel}/drivers/x.c`)).toBe("deny")
      expect(admission(stamped, "edit", "linux/drivers/x.c")).toBe("deny")
      // The person's blanket action still governs everything in-tree.
      expect(admission(stamped, "edit", "src/mine.c")).toBe("allow")
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })

  test("the relative key anchors at the git worktree root, not the directory: a target-directory project inside an outer repository", async () => {
    const outer = await mkdtemp(join(tmpdir(), "auto-ext-outer-"))
    const project = join(outer, "sub")
    const corpus = await mkdtemp(join(tmpdir(), "auto-ext-corpus-"))
    try {
      await mkdir(project)
      await Bun.spawn(["git", "-C", outer, "init", "-q"]).exited
      await symlink(corpus, join(project, "linux"))
      const file = join(project, "opencode.json")
      await writeFile(file, JSON.stringify({ permission: { edit: { "*": "allow" } } }, null, 2) + "\n")
      expect(await applyExternalAllows(project)).toBe(true)
      const stamped = await readFile(file, "utf8")
      // The session's worktree is the OUTER root (opencode derives it as
      // git's toplevel), so the live edit ask for an absolute-path edit of
      // the corpus is ../<corpus-name>/… relative to it — not the
      // ../../<corpus-name>/… a directory-anchored key would spell.
      const ask = relative(outer, corpus).replaceAll("\\", "/") + "/drivers/x.c"
      expect(ask.startsWith("..")).toBe(true)
      expect(admission(stamped, "edit", ask)).toBe("deny")
      expect(admission(stamped, "edit", "linux/drivers/x.c")).toBe("deny")
    } finally {
      await rm(outer, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })
})
