import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { admittingCoverage, allowBase, allowCovers, externalDirectoryLive, pathsOverlap, rootSymlinkDoors, stampKey, stampWallClosure } from "../src/external-dirs"
import { admission } from "./helpers/perm-oracle"

// The wall-side family alone (plans/0296): the init/fix stamp family this
// suite once pinned — the root-symlink allows, the read-only edit denies and
// the knowledge boundary stamped into opencode.json — is gone with the file
// never being the tool's. What stays is the door scan, the wall's entry
// readers, the coverage evaluator and the closure write — the sealed
// reference wall's machinery, demolition-docketed beside its dead callers.

// The corpus and the project side by side under tmp (siblings, never nested:
// the scan keeps only real paths outside the project root).
async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "auto-ext-project-"))
  const corpus = await mkdtemp(join(tmpdir(), "auto-ext-corpus-"))
  await writeFile(join(corpus, "timer.c"), "enum\n")
  return { project, corpus }
}

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

  test("stampWallClosure: a person ask on a stamp key is overridden by the seal's standing deny; every other person key keeps its action and order (plans/0155 D3)", () => {
    const personAsk = JSON.stringify({ permission: { external_directory: { [stampKey("/corpus")]: "ask", "/person/**": "allow" } } }) + "\n"
    const closed = stampWallClosure(personAsk, ["/corpus"])!
    const external = (JSON.parse(closed) as any).permission.external_directory
    expect(external).toEqual({ [stampKey("/corpus")]: "deny", "/person/**": "allow" })
    expect(Object.keys(external)).toEqual([stampKey("/corpus"), "/person/**"])
  })
})
