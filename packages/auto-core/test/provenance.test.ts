// Bundle provenance (plans/0100 D1–D2): the sidecar materialization writes,
// the pure three-state comparison over stamp/disk/binary, and the named
// directions. The incident shape is the fixture story: a materialized pack
// that predates the running binary's charter family reports stale with the
// headings delta naming exactly the missing section — never a digest
// complaint.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bundleFileMap, materializeIntentBundle, parseIntentBundle, resolveIntentBundle, type IntentBundleFiles } from "../src/bundle"
import {
  PROVENANCE_FILE,
  compareProvenance,
  headingLines,
  headingsDelta,
  parseProvenanceStamp,
  provenanceStampOf,
  renderProvenanceStamp,
  sha256Text,
} from "../src/provenance"

// The shipped faithful bundle's files, mutably: the test's "running binary".
async function binaryFiles(mutate: (files: IntentBundleFiles) => void = () => {}): Promise<IntentBundleFiles> {
  const files = { ...(await resolveIntentBundle("faithful"))! }
  mutate(files)
  return files
}

// Materialize the (possibly mutated) bundle into a fresh directory and read
// back the stamp + the on-disk managed files.
async function materialized(mutate: (files: IntentBundleFiles) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "auto-provenance-"))
  const files = await binaryFiles(mutate)
  await materializeIntentBundle(dir, parseIntentBundle(files))
  return { dir, files }
}

function readStamp(dir: string) {
  return parseProvenanceStamp(readFileSync(join(dir, PROVENANCE_FILE), "utf8"))!
}

// The on-disk managed texts of a materialized directory (the comparison's
// disk input).
function diskOf(dir: string, stampFiles: Record<string, unknown>): Record<string, string> {
  const disk: Record<string, string> = {}
  for (const path of Object.keys(stampFiles)) disk[path] = readFileSync(join(dir, path), "utf8")
  return disk
}

describe("the stamp (plans/0100 D1)", () => {
  test("materialization writes the sidecar beside the files: bundle name, per-file sha256 and heading lines", async () => {
    const { dir } = await materialized()
    try {
      const stamp = readStamp(dir)
      expect(stamp.bundle).toBe("faithful")
      const packPath = ".opencode/auto/intents/faithful.md"
      expect(Object.keys(stamp.files).sort()).toEqual([".opencode/auto/intents/faithful.md", ".opencode/auto/modes/faithful.md", ".opencode/auto/phases/survey.md"])
      const pack = readFileSync(join(dir, packPath), "utf8")
      expect(stamp.files[packPath]!.sha256).toBe(sha256Text(pack))
      // The headings are the file's `##`/`###` lines, trimmed, in order —
      // including the canonical id-keyed charter (stage A's rename).
      expect(stamp.files[packPath]!.headings).toEqual(headingLines(pack))
      expect(stamp.files[packPath]!.headings).toContain("### verify-plan-test")
      // The bundle-level digest covers exactly the managed set.
      expect(stamp.bundleDigest).toBe(provenanceStampOf("faithful", bundleFileMap(parseIntentBundle(await binaryFiles()))).bundleDigest)
      // Round-trip: render → parse is the identity.
      expect(parseProvenanceStamp(renderProvenanceStamp(stamp))).toEqual(stamp)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("re-materializing the same bundle rewrites the same stamp (init's idempotence)", async () => {
    const { dir } = await materialized()
    try {
      const before = readFileSync(join(dir, PROVENANCE_FILE), "utf8")
      await materializeIntentBundle(dir, parseIntentBundle(await binaryFiles()))
      expect(readFileSync(join(dir, PROVENANCE_FILE), "utf8")).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("parseProvenanceStamp: garbage and wrong shapes degrade to undefined, never throw", () => {
    expect(parseProvenanceStamp("not json")).toBeUndefined()
    expect(parseProvenanceStamp("{}")).toBeUndefined()
    expect(parseProvenanceStamp(JSON.stringify({ bundle: "x", bundleDigest: "y", files: { p: { sha256: 1 } } }))).toBeUndefined()
    expect(parseProvenanceStamp(JSON.stringify({ bundle: "x", bundleDigest: "y", files: [] }))).toBeUndefined()
  })
})

describe("the three-state comparison (plans/0100 D2)", () => {
  test("a fresh materialization against the same binary: every managed file current", async () => {
    const { dir } = await materialized()
    try {
      const stamp = readStamp(dir)
      const comparison = compareProvenance(stamp, diskOf(dir, stamp.files), bundleFileMap(parseIntentBundle(await binaryFiles())))
      for (const state of Object.values(comparison.files)) expect(state.state).toBe("current")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the binary gains a charter section: stale, binary-newer, the delta naming the missing heading", async () => {
    // Materialize from the older binary (the pack lacks the charter), then
    // run the comparison against the current binary (which has it) — the
    // incident's exact shape, reversed in time.
    const { dir } = await materialized((files) => {
      files["intents/faithful.md"] = files["intents/faithful.md"]!.replace("### verify-plan-test\n", "### verify-plan-OLD\n")
    })
    try {
      const stamp = readStamp(dir)
      const comparison = compareProvenance(stamp, diskOf(dir, stamp.files), bundleFileMap(parseIntentBundle(await binaryFiles())))
      const state = comparison.files[".opencode/auto/intents/faithful.md"]!
      expect(state.state).toBe("stale")
      if (state.state === "stale") {
        expect(state.direction).toBe("diverged")
        expect(state.inBinary).toBe(true)
        expect(state.added).toContain("### verify-plan-test")
        expect(state.removed).toContain("### verify-plan-OLD")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a purely additive newer binary: stale, binary-newer, nothing removed", async () => {
    const { dir } = await materialized()
    try {
      const stamp = readStamp(dir)
      const newer = await binaryFiles((files) => {
        files["intents/faithful.md"] = `${files["intents/faithful.md"]!.trimEnd()}\n\n### extra-section\n\nAdded later.\n`
      })
      const comparison = compareProvenance(stamp, diskOf(dir, stamp.files), bundleFileMap(parseIntentBundle(newer)))
      const state = comparison.files[".opencode/auto/intents/faithful.md"]!
      expect(state.state).toBe("stale")
      if (state.state === "stale") {
        expect(state.direction).toBe("binary-newer")
        expect(state.added).toEqual(["### extra-section"])
        expect(state.removed).toEqual([])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the binary predates the stamp: the binary-older direction is named, not a false stale-newer", async () => {
    const { dir } = await materialized()
    try {
      const stamp = readStamp(dir)
      // The running binary is the older one: the pack on disk (and the
      // stamp) carry a section it does not know.
      const older = await binaryFiles((files) => {
        files["intents/faithful.md"] = files["intents/faithful.md"]!.replace("### verify-plan-test\n\n", "")
      })
      const comparison = compareProvenance(stamp, diskOf(dir, stamp.files), bundleFileMap(parseIntentBundle(older)))
      const state = comparison.files[".opencode/auto/intents/faithful.md"]!
      expect(state.state).toBe("stale")
      if (state.state === "stale") {
        expect(state.direction).toBe("binary-older")
        expect(state.removed).toContain("### verify-plan-test")
        expect(state.added).toEqual([])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a file the binary no longer ships: stale, inBinary false, its headings all removed", async () => {
    const { dir } = await materialized()
    try {
      const stamp = readStamp(dir)
      const dropped = await binaryFiles((files) => {
        delete files["modes/faithful.md"]
      })
      const comparison = compareProvenance(stamp, diskOf(dir, stamp.files), bundleFileMap(parseIntentBundle(dropped)))
      const state = comparison.files[".opencode/auto/modes/faithful.md"]!
      expect(state.state).toBe("stale")
      if (state.state === "stale") {
        expect(state.inBinary).toBe(false)
        expect(state.direction).toBe("binary-older")
        expect(state.removed.length).toBeGreaterThan(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a touched on-disk file: person-edited, the person's own edit and the binary's offer both named", async () => {
    const { dir } = await materialized()
    try {
      const stamp = readStamp(dir)
      const disk = diskOf(dir, stamp.files)
      const packPath = ".opencode/auto/intents/faithful.md"
      disk[packPath] = disk[packPath]!.replace("## guarantees", "## guarantees\n\n### my-own-section\n\nOurs.")
      const comparison = compareProvenance(stamp, disk, bundleFileMap(parseIntentBundle(await binaryFiles())))
      const state = comparison.files[packPath]!
      expect(state.state).toBe("person-edited")
      if (state.state === "person-edited") {
        expect(state.onDisk).toBe(true)
        expect(state.stampAdded).toEqual(["### my-own-section"])
        expect(state.stampRemoved).toEqual([])
        // The binary's offer stays computable beside the edit.
        expect(state.added).toEqual([])
        expect(state.removed).toEqual(["### my-own-section"])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a deleted on-disk file: person-edited, onDisk false", async () => {
    const { dir } = await materialized()
    try {
      const stamp = readStamp(dir)
      const disk = diskOf(dir, stamp.files)
      delete disk[".opencode/auto/phases/survey.md"]
      const comparison = compareProvenance(stamp, disk, bundleFileMap(parseIntentBundle(await binaryFiles())))
      const state = comparison.files[".opencode/auto/phases/survey.md"]!
      expect(state.state).toBe("person-edited")
      if (state.state === "person-edited") expect(state.onDisk).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("headingsDelta", () => {
  test("order-insensitive: a move is not a change", () => {
    expect(headingsDelta(["## a", "### b"], ["### b", "## a"])).toEqual({ added: [], removed: [] })
    expect(headingsDelta(["## a"], ["## a", "### new"])).toEqual({ added: ["### new"], removed: [] })
    expect(headingsDelta(["## a", "## b"], ["## a"])).toEqual({ added: [], removed: ["## b"] })
  })
})

// The pure module stays pure: no managed-home writes happen outside
// materialization/sync (pinned by the module having no fs imports — the
// import-direction suite's domain; here the behavioral pin is that a
// comparison over equal inputs changes nothing on disk).
describe("purity", () => {
  test("compareProvenance over a fresh materialization leaves the directory byte-identical", async () => {
    const { dir } = await materialized()
    try {
      const before = readFileSync(join(dir, PROVENANCE_FILE), "utf8")
      mkdirSync(join(dir, ".opencode/auto/intents"), { recursive: true })
      const stamp = readStamp(dir)
      compareProvenance(stamp, diskOf(dir, stamp.files), bundleFileMap(parseIntentBundle(await binaryFiles())))
      expect(readFileSync(join(dir, PROVENANCE_FILE), "utf8")).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
