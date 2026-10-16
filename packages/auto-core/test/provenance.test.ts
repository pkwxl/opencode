// Bundle provenance (plans/0100 D1–D2): the sidecar materialization writes,
// the pure three-state comparison over stamp/disk/binary, and the named
// directions. The incident shape is the fixture story: a materialized pack
// that predates the running binary's charter family reports stale with the
// headings delta naming exactly the missing section — never a digest
// complaint.
import { describe, expect, spyOn, test } from "bun:test"
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

// —— the detection sites (plans/0100 D3) ——
//
// One stale project drives all three: preflight's clause beside the intent
// line, fix's manual finding (report-only — the write list stays empty for
// the pack), status's row. The staleness is built exactly as the incident
// left it: the on-disk pack and the sidecar predate the charter family, the
// running binary ships it — and no site blocks, exits nonzero, or writes.
import { ensurePointer } from "../src/agents-block"
import { renderAgentContract } from "../src/config-fix"
import { planFix } from "../src/config-fix"
import { CONFIG_DEFAULTS } from "../src/config"
import { provenanceComparison } from "../src/bundle"
import { provenanceFindings, provenanceNoticeLine } from "../src/provenance"
import { preflight } from "../src/loop-preflight"
import { unprotect } from "../src/protect"
import { renderStatus } from "../src/status"
import { freshRepo, git } from "./fixtures/runner"

// An initialized, committed project with the faithful bundle materialized;
// `stale` rewrites the pack and the sidecar to the pre-charter-family bytes
// an older binary would have written (the incident's exact shape).
async function bundleProject(stale: boolean): Promise<string> {
  const dir = await freshRepo()
  const files = await resolveIntentBundle("faithful")
  await materializeIntentBundle(dir, parseIntentBundle(files!))
  if (stale) {
    const packRel = ".opencode/auto/intents/faithful.md"
    const current = readFileSync(join(dir, packRel), "utf8")
    const old = `${current.slice(0, current.indexOf("### verify-plan-test")).trimEnd()}\n`
    await Bun.write(join(dir, packRel), old)
    const map = bundleFileMap(parseIntentBundle(files!))
    map[packRel] = old
    await Bun.write(join(dir, PROVENANCE_FILE), renderProvenanceStamp(provenanceStampOf("faithful", map)))
  }
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await Bun.write(join(dir, ".opencode/auto/config.json"), `${JSON.stringify({ ...CONFIG_DEFAULTS, intent: "faithful", phases: "survey,analysis,design,implement,test,acceptance" }, null, 2)}\n`)
  await Bun.write(join(dir, ".opencode/agent/auto.md"), await renderAgentContract(false))
  await ensurePointer(dir)
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "init")
  return dir
}

describe("the detection sites (plans/0100 D3)", () => {
  test("a current stamp stays silent everywhere: no line, no finding, no row", async () => {
    const dir = await bundleProject(false)
    try {
      const comparison = await provenanceComparison(dir)
      expect(comparison).toBeDefined()
      expect(provenanceNoticeLine(comparison!)).toBeUndefined()
      expect(provenanceFindings(comparison!)).toEqual([])
      const plan = await planFix(dir)
      expect(plan.findings.filter((finding) => finding.path.startsWith(".opencode/auto/intents") || finding.path.startsWith(".opencode/auto/modes") || finding.path.startsWith(".opencode/auto/phases"))).toEqual([])
      expect(await renderStatus(dir)).not.toContain("stale")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the stale pack: the comparison names the missing charter, preflight logs one line and still passes", async () => {
    const dir = await bundleProject(true)
    try {
      const comparison = await provenanceComparison(dir)!
      expect(comparison).toBeDefined()
      const state = comparison!.files[".opencode/auto/intents/faithful.md"]!
      expect(state.state).toBe("stale")
      if (state.state === "stale") {
        expect(state.direction).toBe("binary-newer")
        expect(state.added).toEqual(["### verify-plan-test"])
      }
      const line = provenanceNoticeLine(comparison!)
      expect(line).toContain("intent bundle faithful")
      expect(line).toContain("### verify-plan-test")
      expect(line).toContain("sync")
      // Preflight: the clause is a log line, never a gate — the run starts.
      const ambient = Object.entries(process.env).filter(([key]) => key.startsWith("OPENCODE_AUTO_"))
      for (const [key] of ambient) delete process.env[key]
      const lines: string[] = []
      const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => String(arg)).join(" "))
      })
      try {
        const result = await preflight(dir, { intent: "faithful" })
        expect("exit" in result).toBe(false)
        if (!("exit" in result)) {
          result.progress.close()
          result.watcher?.close()
        }
        expect(lines.some((logged) => logged.includes("### verify-plan-test") && logged.includes("⚠"))).toBe(true)
      } finally {
        printed.mockRestore()
        for (const [key, value] of ambient) if (value !== undefined) process.env[key] = value
        // Preflight protects the driver-state files (the sidecar among them
        // now); the module-global guard must not leak into later suites.
        await unprotect(dir)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fix reports the stale pack as a manual finding and writes nothing for it", async () => {
    const dir = await bundleProject(true)
    try {
      const plan = await planFix(dir)
      const finding = plan.findings.find((item) => item.path === ".opencode/auto/intents/faithful.md")
      expect(finding).toBeDefined()
      expect(finding!.class).toBe("manual")
      expect(finding!.problem).toContain("### verify-plan-test")
      expect(finding!.problem).toContain("sync")
      // Report-only: no write touches any managed file.
      expect(plan.writes.map((write) => write.path)).not.toContain(".opencode/auto/intents/faithful.md")
      // The pack on disk is untouched by planning alone.
      const before = readFileSync(join(dir, ".opencode/auto/intents/faithful.md"), "utf8")
      for (const write of plan.writes) await write.apply()
      expect(readFileSync(join(dir, ".opencode/auto/intents/faithful.md"), "utf8")).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("status carries the row in the fix finding's shape, person-edited included", async () => {
    const dir = await bundleProject(true)
    try {
      const lines = await renderStatus(dir)
      expect(lines.some((line) => line.includes("⚠ .opencode/auto/intents/faithful.md: stale") && line.includes("### verify-plan-test"))).toBe(true)
      // A person-edited managed file is a row too (stale files are not the
      // only finding class fix and status share).
      const packPath = join(dir, ".opencode/auto/intents/faithful.md")
      await Bun.write(packPath, `${readFileSync(packPath, "utf8").trimEnd()}\n\n### my-own-section\n\nOurs.\n`)
      const edited = await renderStatus(dir)
      expect(edited.some((line) => line.includes("edited after materialization") && line.includes("### my-own-section"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
