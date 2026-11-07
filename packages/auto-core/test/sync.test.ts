// The sync plan (plans/0100 D4/D5): the person's upgrade command's core —
// plan/apply/format over the provenance sidecar. The invariants the plan
// names are the tests: unedited managed files fast-forward byte-identically
// and the stamp rewrites; person-edited files are never written (the stamp
// keeps the tool's last-written bytes so detection keeps its visibility);
// extras and retired files are reported, never deleted; the unstamped
// bootstrap splits adopt from report-only; --from-bundle opts into the
// overwrite; an open round warns and proceeds; config.json is never touched.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { chmodSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bundleFileMap, materializeIntentBundle, parseIntentBundle, registerIntentBundle, resolveIntentBundle, provenanceComparison, type IntentBundleFiles } from "../src/bundle"
import { CONFIG_DEFAULTS } from "../src/config"
import { PROVENANCE_FILE, provenanceFindings, provenanceStampOf, renderProvenanceStamp } from "../src/provenance"
import { applySync, formatSyncPlan, planSync, syncWritesAnything } from "../src/sync"

const PACK_PATH = ".opencode/auto/intents/faithful.md"
const MODE_PATH = ".opencode/auto/modes/faithful.md"
const SURVEY_PATH = ".opencode/auto/phases/survey.md"

// A temp project directory (no git needed: sync writes files, never commits).
function project(): string {
  return mkdtempSync(join(tmpdir(), "auto-sync-"))
}

// Write the config naming the faithful bundle (the bootstrap's resolver).
async function withConfig(dir: string, intent = "faithful"): Promise<void> {
  await Bun.write(join(dir, ".opencode/auto/config.json"), `${JSON.stringify({ ...CONFIG_DEFAULTS, intent, phases: "survey,analysis,design,implement,test,acceptance" }, null, 2)}\n`)
}

// The shipped faithful bundle's files.
async function faithfulFiles(): Promise<IntentBundleFiles> {
  return (await resolveIntentBundle("faithful"))!
}

// Age the materialized pack and stamp to the pre-charter-family bytes (the
// incident's shape): the on-disk pack and the sidecar record what an older
// binary would have written.
async function ageToCharterless(dir: string): Promise<void> {
  const files = await faithfulFiles()
  const current = readFileSync(join(dir, PACK_PATH), "utf8")
  const old = `${current.slice(0, current.indexOf("### verify-plan-test")).trimEnd()}\n`
  await Bun.write(join(dir, PACK_PATH), old)
  const map = bundleFileMap(parseIntentBundle(files))
  map[PACK_PATH] = old
  await Bun.write(join(dir, PROVENANCE_FILE), renderProvenanceStamp(provenanceStampOf("faithful", map)))
}

// Age the pack and stamp to a body-reworded older bundle (plans/0214 D1's
// shape): the sha differs, the headings are identical — the
// direction-unknown case.
async function ageToRewordedBody(dir: string): Promise<void> {
  const files = await faithfulFiles()
  const current = readFileSync(join(dir, PACK_PATH), "utf8")
  const old = current.replace("never invent them.", "never invent them — the artifacts on disk are the only source.")
  await Bun.write(join(dir, PACK_PATH), old)
  const map = bundleFileMap(parseIntentBundle(files))
  map[PACK_PATH] = old
  await Bun.write(join(dir, PROVENANCE_FILE), renderProvenanceStamp(provenanceStampOf("faithful", map)))
}

describe("planSync / applySync: the stamped fast-forward (plans/0100 D4)", () => {
  test("a stale unedited pack fast-forwards byte-identically and the stamp rewrites; detection goes quiet", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await ageToCharterless(dir)
      const plan = await planSync(dir)
      expect(plan.nothing).toBeUndefined()
      const entry = plan.entries.find((item) => item.path === PACK_PATH)
      expect(entry).toMatchObject({ action: "fast-forward", direction: "binary-newer" })
      expect(plan.writes.map((write) => write.path)).toContain(PACK_PATH)
      expect(plan.stampText).toBeDefined()
      await applySync(dir, plan)
      const binary = bundleFileMap(parseIntentBundle(await faithfulFiles()))
      expect(readFileSync(join(dir, PACK_PATH), "utf8")).toBe(binary[PACK_PATH])
      // The stamp now records the binary's bytes: every managed file current,
      // detection silent, a second plan nothing-to-do.
      const comparison = await provenanceComparison(dir)
      expect(provenanceFindings(comparison!)).toEqual([])
      expect((await planSync(dir)).entries.every((item) => item.action === "current")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a person-edited managed file is never written; the stamp keeps the tool's last-written bytes", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      const edited = `${readFileSync(join(dir, MODE_PATH), "utf8").trimEnd()}\n\n## my own section\n\nOurs.\n`
      await Bun.write(join(dir, MODE_PATH), edited)
      const plan = await planSync(dir)
      const entry = plan.entries.find((item) => item.path === MODE_PATH)
      expect(entry).toMatchObject({ action: "edited" })
      expect(plan.writes.map((write) => write.path)).not.toContain(MODE_PATH)
      // Plans/0158: a report-only plan over a stamped project is no write at
      // all — the stamp re-renders byte-identically (edited paths keep their
      // original entries, current paths re-derive the same ones), so the
      // dryrun's exit gate counts nothing. The pre-0158 gate said
      // "something would change" for exactly this shape.
      expect(plan.stampText).toBeUndefined()
      expect(syncWritesAnything(plan)).toBe(false)
      await applySync(dir, plan)
      expect(readFileSync(join(dir, MODE_PATH), "utf8")).toBe(edited)
      // The stamp's entry for the edited path is unchanged (the tool's bytes,
      // not the person's): detection keeps naming the edit as one.
      const findings = provenanceFindings((await provenanceComparison(dir))!)
      expect(findings.some((finding) => finding.path === MODE_PATH && finding.problem.includes("edited after materialization"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("extras under the materialized homes are reported and never deleted; config.json is untouched", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      const configBefore = readFileSync(join(dir, ".opencode/auto/config.json"), "utf8")
      const extra = join(dir, ".opencode/auto/phases/my-review.md")
      await Bun.write(extra, "# My review\n\n## plan duties\n\nMine.\n")
      const plan = await planSync(dir)
      expect(plan.entries).toContainEqual({ action: "extra", path: ".opencode/auto/phases/my-review.md" })
      await applySync(dir, plan)
      expect(readFileSync(extra, "utf8")).toBe("# My review\n\n## plan duties\n\nMine.\n")
      expect(readFileSync(join(dir, ".opencode/auto/config.json"), "utf8")).toBe(configBefore)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a file the running bundle retires is reported, never deleted, and leaves the managed set", async () => {
    const dir = project()
    const v1: IntentBundleFiles = {
      "bundle.json": JSON.stringify({ name: "sync-fixture", phases: "implement" }),
      "intents/sync-fixture.md": "# sync-fixture\n\n## acceptance\n\n### result-line\n\nWrite `Result: PASS`.\n",
      "modes/sync-fixture.md": "# sync-fixture\n\n## init\n\nFixture init.\n\n## exec\n\nFixture mode.\n",
    }
    registerIntentBundle("sync-fixture", v1)
    try {
      await materializeIntentBundle(dir, parseIntentBundle(v1))
      await withConfig(dir, "sync-fixture")
      // The "newer binary" drops the mode: the file is retired.
      const v2 = { ...v1 } as Partial<IntentBundleFiles>
      delete v2["modes/sync-fixture.md"]
      registerIntentBundle("sync-fixture", v2 as IntentBundleFiles)
      const plan = await planSync(dir)
      const entry = plan.entries.find((item) => item.path === ".opencode/auto/modes/sync-fixture.md")
      expect(entry).toMatchObject({ action: "retired" })
      expect(plan.writes.map((write) => write.path)).not.toContain(".opencode/auto/modes/sync-fixture.md")
      // The managed set shrinks, so the sidecar rewrite is a real write even
      // with no file write (plans/0158's byte-honest stampText keeps it).
      expect(plan.stampText).toBeDefined()
      expect(syncWritesAnything(plan)).toBe(true)
      await applySync(dir, plan)
      expect(readFileSync(join(dir, ".opencode/auto/modes/sync-fixture.md"), "utf8")).toContain("Fixture mode.")
      // Out of the managed set: the retirement stops being a finding.
      expect(provenanceFindings((await provenanceComparison(dir))!).some((finding) => finding.path === ".opencode/auto/modes/sync-fixture.md")).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an open round warns and proceeds", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await ageToCharterless(dir)
      await Bun.write(join(dir, "docs/R-01/phases.md"), "# Phases (R-01)\n\n- [ ] P01-implement implement\n")
      const plan = await planSync(dir)
      expect(plan.openRound).toContain("a round is in flight")
      expect(plan.openRound).toContain("docs/R-01/phases.md")
      expect(plan.entries.some((item) => item.action === "fast-forward")).toBe(true)
      expect(formatSyncPlan(plan)).toContain("the boundary call is yours")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Plans/0214 D1: a body-only difference names no direction, so the plan's
  // fast-forward line carries the direction-unknown caveat (the pre-fix
  // label asserted binary-newer and printed no caveat — the confirmed sync
  // downgraded the newer committed pack).
  test("a body-only difference fast-forwards with the direction-unknown caveat, never a plain fast-forward (plans/0214 D1)", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await ageToRewordedBody(dir)
      const plan = await planSync(dir)
      const entry = plan.entries.find((item) => item.path === PACK_PATH)
      expect(entry).toMatchObject({ action: "fast-forward", direction: "body-only" })
      const text = formatSyncPlan(plan)
      expect(text).toContain("fast-forward to the running bundle (a body-only difference — either the running binary or your materialized pack may be newer; this writes the binary's bytes; upgrade the tool if that is not intended)")
      expect(text).not.toContain("predates your materialized pack")
      // The write is real and converges to the binary's bytes.
      await applySync(dir, plan)
      const binary = bundleFileMap(parseIntentBundle(await faithfulFiles()))
      expect(readFileSync(join(dir, PACK_PATH), "utf8")).toBe(binary[PACK_PATH])
      expect(provenanceFindings((await provenanceComparison(dir))!)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Plans/0214 D2: the kill window between applySync's file writes and its
  // sidecar rewrite leaves disk at the binary's bytes with a stale stamp —
  // the tool's own write, pre-fix reported as the person's edit forever
  // (the stamp entry standing, sync never converging it). The re-plan
  // re-stamps: the file is never written, the sidecar rewrite rides, and
  // the state converges.
  test("an interrupted applySync (files written, sidecar not) converges by re-stamp, never a false person-edit (plans/0214 D2)", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await ageToCharterless(dir)
      // The kill: applySync's file writes land, the sidecar rewrite never
      // does (the last write in applySync's order).
      const first = await planSync(dir)
      for (const write of first.writes) await Bun.write(join(dir, write.path), write.text)
      const packOnDisk = readFileSync(join(dir, PACK_PATH), "utf8")
      const plan = await planSync(dir)
      const entry = plan.entries.find((item) => item.path === PACK_PATH)
      expect(entry).toMatchObject({ action: "re-stamp" })
      // The file itself is never written; the sidecar rewrite is a real
      // change (0158's byte-honest gate counts it).
      expect(plan.writes.map((write) => write.path)).not.toContain(PACK_PATH)
      expect(plan.stampText).toBeDefined()
      expect(syncWritesAnything(plan)).toBe(true)
      expect(formatSyncPlan(plan)).toContain("already byte-identical to the running bundle — re-stamped (an interrupted materialization/sync write; the file was not written)")
      await applySync(dir, plan)
      expect(readFileSync(join(dir, PACK_PATH), "utf8")).toBe(packOnDisk)
      // Converged: detection goes quiet, a second plan is all-current.
      expect(provenanceFindings((await provenanceComparison(dir))!)).toEqual([])
      expect((await planSync(dir)).entries.every((item) => item.action === "current")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("planSync: the unstamped bootstrap (plans/0100 D5)", () => {
  test("byte-identical files adopt into a fresh stamp; a differing pack is report-only", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      // The legacy project: no sidecar, the pack predating the charter family.
      await ageToCharterless(dir)
      await rmSync(join(dir, PROVENANCE_FILE))
      const plan = await planSync(dir)
      expect(plan.entries.find((item) => item.path === PACK_PATH)).toMatchObject({ action: "differ" })
      expect(plan.entries.find((item) => item.path === SURVEY_PATH)).toMatchObject({ action: "adopt" })
      expect(plan.entries.find((item) => item.path === MODE_PATH)).toMatchObject({ action: "adopt" })
      // Report-only: no write touches the differing pack; the stamp lands
      // with the adopted files alone.
      expect(plan.writes.map((write) => write.path)).not.toContain(PACK_PATH)
      expect(syncWritesAnything(plan)).toBe(true)
      const agedPack = readFileSync(join(dir, PACK_PATH), "utf8")
      await applySync(dir, plan)
      expect(readFileSync(join(dir, PACK_PATH), "utf8")).toBe(agedPack)
      const comparison = await provenanceComparison(dir)
      expect(comparison!.files[PACK_PATH]).toBeUndefined()
      expect(comparison!.files[SURVEY_PATH]).toMatchObject({ state: "current" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("--from-bundle overwrites the differing unstamped files (the pristine-but-old assertion)", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await ageToCharterless(dir)
      await rmSync(join(dir, PROVENANCE_FILE))
      const plan = await planSync(dir, { fromBundle: true })
      expect(plan.entries.find((item) => item.path === PACK_PATH)).toMatchObject({ action: "fast-forward" })
      expect(plan.writes.map((write) => write.path)).toContain(PACK_PATH)
      await applySync(dir, plan)
      const binary = bundleFileMap(parseIntentBundle(await faithfulFiles()))
      expect(readFileSync(join(dir, PACK_PATH), "utf8")).toBe(binary[PACK_PATH])
      expect(provenanceFindings((await provenanceComparison(dir))!)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("no stamp and a config naming no bundle: nothing to sync", async () => {
    const dir = project()
    try {
      // The config must load: the old fixture reused withConfig's
      // bundle-shaped phases key ("survey,…"), which never validates in an
      // unmaterialized project — the pre-fix swallowed catch answered that
      // broken config with the green nothing (0165-156's own scene, green
      // through the defect). The honest nothing-path needs a loading config
      // naming a plain pack.
      await Bun.write(join(dir, ".opencode/auto/config.json"), `${JSON.stringify({ ...CONFIG_DEFAULTS, intent: "default" }, null, 2)}\n`)
      const plan = await planSync(dir)
      expect(plan.nothing).toContain("no provenance stamp")
      expect(syncWritesAnything(plan)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Plans/0215 D2 (0165-156): the nothing-verdict requires a config that
// loads — bundleNameOfConfig's swallowed catch answered a broken config.json
// with "✓ nothing to sync" and exit 0 while run/status/amend exit 1 over the
// same file. The failure now propagates; the shell answers the family's
// exit 1.
describe("planSync's verdict over a broken config (plans/0215 D2)", () => {
  test("an unparsable config rejects the plan, never the green nothing", async () => {
    const dir = project()
    try {
      await withConfig(dir)
      await Bun.write(join(dir, ".opencode/auto/config.json"), "{ not json")
      expect(planSync(dir)).rejects.toThrow("not valid JSON")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a strict retired-key failure rejects the plan with the key's own teaching", async () => {
    const dir = project()
    try {
      await Bun.write(
        join(dir, ".opencode/auto/config.json"),
        `${JSON.stringify({ ...CONFIG_DEFAULTS, intent: "faithful", phases: "survey,analysis,design,implement,test,acceptance", commit: false }, null, 2)}\n`,
      )
      expect(planSync(dir)).rejects.toThrow("commit: false is retired")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a stamped project never reads the config: sync proceeds over a broken config.json (the floor)", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await Bun.write(join(dir, ".opencode/auto/config.json"), "{ not json")
      const plan = await planSync(dir)
      expect(plan.bundle).toBe("faithful")
      expect(plan.entries.every((item) => item.action === "current")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Plans/0215 D3 (0165-157): applySync's writes are write-tmp-then-rename —
// the read-only managed file (a killed run's stale protect bit) is the
// deterministic stand-in for the crash mid-write: the pre-fix in-place
// Bun.write answers EACCES, the rename replaces the entry and the
// fast-forward heals.
describe("applySync's write discipline (plans/0215 D3)", () => {
  test("the managed files and the sidecar are replaced, not written in place: a read-only pack is healed, not EACCES", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await ageToCharterless(dir)
      const plan = await planSync(dir)
      chmodSync(join(dir, PACK_PATH), 0o444)
      try {
        await applySync(dir, plan)
      } finally {
        chmodSync(join(dir, PACK_PATH), 0o644)
      }
      const binary = bundleFileMap(parseIntentBundle(await faithfulFiles()))
      expect(readFileSync(join(dir, PACK_PATH), "utf8")).toBe(binary[PACK_PATH])
      // The tmp rode .auto/ and was consumed by the rename; the workdir's
      // directory is not left behind (the lock's own discipline).
      expect(existsSync(join(dir, ".auto"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("formatSyncPlan", () => {
  test("every action renders one line; the report-only entries say so", async () => {
    const dir = project()
    try {
      await materializeIntentBundle(dir, parseIntentBundle(await faithfulFiles()))
      await withConfig(dir)
      await ageToCharterless(dir)
      await Bun.write(join(dir, ".opencode/auto/phases/my-review.md"), "# My review\n")
      const plan = await planSync(dir)
      const text = formatSyncPlan(plan)
      expect(text).toContain(`→ ${PACK_PATH}: fast-forward to the running bundle (adds ### verify-plan-test, ### verify-plan-acceptance)`)
      expect(text).toContain(`= ${SURVEY_PATH}: current`)
      expect(text).toContain(`⚠ .opencode/auto/phases/my-review.md: not named by the running bundle`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
