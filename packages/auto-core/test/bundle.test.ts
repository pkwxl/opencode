// Intent bundles (plans/0079 §3): the named policy bundle — parse through
// the existing per-surface parsers, materialize into the target's
// .opencode/auto/ surfaces, resolve from a registered name or a bundle.json
// directory. The fixture is the Clean-Room Redesign bundle (§1.1's mapping):
// the concrete instance that validates the general mechanism.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { materializeIntentBundle, parseIntentBundle, registerIntentBundle, registeredIntentBundles, resolveIntentBundle, type IntentBundleFiles } from "../src/bundle"
import { loadIntents, packSubsection } from "../src/intent/load"
import { parseGuaranteeAsserts } from "../src/intent/guarantees"
import { loadModes } from "../src/mode"
import { loadPhaseTypes } from "../src/phases/custom"
import { resolvePhases } from "../src/phases/registry"
import { promptFacts } from "../src/prompt-facts"

// The Clean-Room fixture (plans/0079 §1.1): spec-read and audit custom types
// around the builtins, the cleanroom pack (with the repair duties the
// mechanism's bounded loop consumes as content), the cleanroom mode.
const CLEANROOM: IntentBundleFiles = {
  "bundle.json": JSON.stringify({ name: "cleanroom", phases: "spec-read,design,implement,test,audit", subtask: "ondemand" }, null, 2) + "\n",
  "phases/spec-read.md": [
    "# Spec read",
    "",
    "Phase-artifacts: spec-notes.md",
    "",
    "## plan duties",
    "",
    "Plan one task per specification concern: functional scope, public interface,",
    "error semantics, acceptance criteria. Documents only, no code.",
    "",
    "<!-- auto: eof -->",
    "",
  ].join("\n"),
  "phases/audit.md": [
    "# Spec-compliance audit",
    "",
    "Gate: verdict",
    "Reasoning: deep",
    "Phase-artifacts: audit.md",
    "",
    "## plan duties",
    "",
    "Plan one audit task per compliance dimension (coverage, behavioral,",
    "interface, scope, clean-room independence). Findings go to audit.md; the",
    "closing task writes the verdict from the findings, never from optimism.",
    "",
    "<!-- auto: eof -->",
    "",
  ].join("\n"),
  "intents/cleanroom.md": [
    "# cleanroom",
    "",
    "## quality",
    "",
    "### decompose",
    "",
    "One requirement per item; every item declares its artifact and its acceptance evidence.",
    "",
    "### self-check-whole",
    "",
    "The work satisfies the specification's external contracts, not its own description of them.",
    "",
    "## phase duties",
    "",
    "### test",
    "",
    "Verify in three layers: build, functional tests, black-box acceptance per criterion.",
    "",
    "## governance",
    "",
    "### repair",
    "",
    "A repair task fixes the finding it is named for, adds a regression check, and re-runs",
    "the verification that produced the finding; it touches nothing the finding does not name.",
    "",
  ].join("\n"),
  "modes/cleanroom.md": ["# cleanroom", "", "## init", "", "Independent implementation from the specification alone.", "", "## exec", "", "Never access, search for, reconstruct or request the reference implementation.", ""].join("\n"),
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "auto-bundle-"))
}

// A copy of the fixture without one file (the replace-a-name cases need the
// original gone, not overridden beside).
const without = (files: IntentBundleFiles, key: string): IntentBundleFiles =>
  Object.fromEntries(Object.entries(files).filter(([k]) => k !== key)) as IntentBundleFiles

describe("parseIntentBundle", () => {
  test("the Clean-Room fixture parses: name, comma-form phases, stamps, one pack and mode named like the bundle", () => {
    const bundle = parseIntentBundle(CLEANROOM)
    expect(bundle.name).toBe("cleanroom")
    expect(bundle.phases).toBe("spec-read,design,implement,test,audit")
    expect(bundle.stamps).toEqual({ subtask: "ondemand" })
    expect(bundle.mode).toBe("cleanroom")
    expect(Object.keys(bundle.files.phases).sort()).toEqual(["audit", "spec-read"])
    expect(bundle.files.pack).toBeDefined()
    expect(bundle.files.mode).toBeDefined()
  })

  test("invalid bundles throw naming the offending part, writing nothing", () => {
    const cases: Array<[IntentBundleFiles, RegExp]> = [
      [{ "phases/spec-read.md": CLEANROOM["phases/spec-read.md"]! }, /needs a bundle\.json manifest/],
      [{ ...CLEANROOM, "bundle.json": "{ nope" }, /not valid JSON/],
      [{ ...CLEANROOM, "bundle.json": "[]" }, /must be a JSON object/],
      [{ ...CLEANROOM, "bundle.json": JSON.stringify({ phases: "spec-read,implement" }) }, /name must be a lowercase letter/],
      [{ ...CLEANROOM, "bundle.json": JSON.stringify({ name: "cleanroom", phases: "adm" }) }, /is a letter preset; a bundle manifest uses the comma form/],
      [{ ...CLEANROOM, "bundle.json": JSON.stringify({ name: "cleanroom", phases: "review,implement" }) }, /phases is invalid/],
      [{ ...CLEANROOM, "bundle.json": JSON.stringify({ name: "cleanroom", phases: "design,implement", extra: 1 }) }, /unknown field\(s\) extra/],
      [{ ...CLEANROOM, "bundle.json": JSON.stringify({ name: "cleanroom", phases: "spec-read,implement", subtask: "sometimes" }) }, /subtask must be off\|auto\|true\|ondemand/],
      [{ ...CLEANROOM, "bundle.json": JSON.stringify({ name: "cleanroom", phases: "spec-read,implement", wrapup: "yes" }) }, /wrapup must be true\|false/],
      [{ ...without(CLEANROOM, "intents/cleanroom.md"), "intents/other.md": CLEANROOM["intents/cleanroom.md"]!.replace("# cleanroom", "# other") }, /must be named like the bundle/],
      [{ ...without(CLEANROOM, "modes/cleanroom.md"), "modes/other.md": CLEANROOM["modes/cleanroom.md"]!.replace("# cleanroom", "# other") }, /must be named like the bundle/],
      [{ ...CLEANROOM, "intents/second.md": CLEANROOM["intents/cleanroom.md"]!.replace(/cleanroom/g, "second") }, /exactly one intent pack/],
      [{ ...CLEANROOM, "notes.md": "stray" }, /outside the bundle layout/],
      // The per-surface parsers still rule their own files: a phase type
      // with an unknown field fails through parsePhaseTypeFile.
      [{ ...CLEANROOM, "phases/spec-read.md": "# Spec read\n\nOwner: me\n\n## plan duties\n\nx\n" }, /unknown field\(s\) owner/],
    ]
    for (const [files, pattern] of cases) expect(() => parseIntentBundle(files)).toThrow(pattern)
  })
})

describe("materializeIntentBundle", () => {
  test("writes the ordinary surfaces; the materialized project resolves the pack by the selection key and the phases by the custom types", async () => {
    const dir = tempDir()
    try {
      const bundle = parseIntentBundle(CLEANROOM)
      const written = await materializeIntentBundle(dir, bundle)
      expect(written.sort()).toEqual(
        [".opencode/auto/intents/cleanroom.md", ".opencode/auto/modes/cleanroom.md", ".opencode/auto/phases/audit.md", ".opencode/auto/phases/spec-read.md"].sort(),
      )
      // The pack: loadIntents resolves it by name, the render facts select
      // it by the config's intent key (§2), and its subsections address.
      const packs = loadIntents(dir)
      expect(packs.cleanroom).toBeDefined()
      expect(packSubsection(packs.cleanroom!, "governance", "repair")).toContain("re-runs")
      expect(promptFacts({ dir, intent: "cleanroom" }).pack.name).toBe("cleanroom")
      expect(promptFacts({ dir }).pack.name).toBe("default")
      // The mode and the phase types land as any hand-dropped file would.
      expect(loadModes(dir).cleanroom?.exec).toContain("Never access")
      const types = loadPhaseTypes(dir)
      const audit = types.find((entry) => entry.type === "audit")
      expect(audit).toMatchObject({ gates: ["verdict"], reasoning: "deep", origin: "project" })
      expect(resolvePhases("spec-read,design,implement,test,audit", types)).not.toBeNull()
      // Idempotent re-materialization: the same bytes, no drift copy.
      await materializeIntentBundle(dir, bundle)
      expect(existsSync(join(dir, ".opencode/auto/phases/spec-read.md"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("bundle sources", () => {
  test("a registered name resolves; a directory holding bundle.json resolves; neither names a bundle", async () => {
    registerIntentBundle("cleanroom-fixture", CLEANROOM)
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "my-bundle", "phases"), { recursive: true })
      mkdirSync(join(dir, "my-bundle", "intents"), { recursive: true })
      writeFileSync(join(dir, "my-bundle", "bundle.json"), CLEANROOM["bundle.json"]!)
      writeFileSync(join(dir, "my-bundle", "phases", "audit.md"), CLEANROOM["phases/audit.md"]!)
      writeFileSync(join(dir, "my-bundle", "phases", "spec-read.md"), CLEANROOM["phases/spec-read.md"]!)
      writeFileSync(join(dir, "my-bundle", "intents", "cleanroom.md"), CLEANROOM["intents/cleanroom.md"]!)
      const registered = await resolveIntentBundle("cleanroom-fixture")
      expect(registered).toEqual(CLEANROOM)
      expect(parseIntentBundle(registered!)).toBeDefined()
      const fromDir = await resolveIntentBundle(join(dir, "my-bundle"))
      expect(Object.keys(fromDir!).sort()).toEqual(["bundle.json", "intents/cleanroom.md", "phases/audit.md", "phases/spec-read.md"])
      expect(parseIntentBundle(fromDir!).phases).toBe("spec-read,design,implement,test,audit")
      // A value that is neither: undefined (the plain pack-name path).
      expect(await resolveIntentBundle(join(dir, "nope"))).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the built-in cleanroom bundle ships: it lists, resolves, parses, and materializes into a working project", async () => {
    expect(registeredIntentBundles()).toContain("cleanroom")
    const files = await resolveIntentBundle("cleanroom")
    expect(files).toBeDefined()
    const bundle = parseIntentBundle(files!)
    expect(bundle).toMatchObject({ name: "cleanroom", phases: "spec-read,design,implement,test,audit", mode: "cleanroom", stamps: { subtask: "off" } })
    // The load-bearing pack subsections survive wholesale pack replacement:
    // the result line (the verdict the driver parses), the process-reference
    // rule (the P1 scan's explanation), and the repair duties the bounded
    // repair loop consumes as content.
    const dir = tempDir()
    try {
      await materializeIntentBundle(dir, bundle)
      const packs = loadIntents(dir)
      const pack = packs.cleanroom!
      expect(packSubsection(pack, "acceptance", "result-line")).toContain("Result: PASS")
      expect(packSubsection(pack, "governance", "process-references")).toContain("DRIVER")
      expect(packSubsection(pack, "governance", "repair")).toContain("regression check")
      expect(packSubsection(pack, "phaseDuties", "spec-read")).toBeDefined()
      expect(packSubsection(pack, "phaseDuties", "audit")).toBeDefined()
      expect(loadModes(dir).cleanroom?.exec).toContain("never access")
      expect(loadPhaseTypes(dir).find((entry) => entry.type === "audit")).toMatchObject({ gates: ["verdict"] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The intent family's faithful postures (0080 §6): the builtin admtv
  // skeleton with no custom types — the pack re-voices all five phase duties,
  // so the `### m` tier replaces the core "code migration" partial in every
  // phase-plan/implement render, and the guarantees subsections ride along.
  const FAITHFUL_ANCHORS = {
    faithful: { m: "the reference implementation is the working input", mode: "Faithful parity rule", charter: "parity with the reference's observed" },
    "faithful-lean": { m: "remove legacy debt deliberately", mode: "Lean boundary", charter: "debt-removal accounting" },
  } as const

  test("the built-in faithful and faithful-lean bundles ship: they list, resolve, parse, and materialize with the pack tier and guarantees intact", async () => {
    expect(registeredIntentBundles()).toEqual(expect.arrayContaining(["cleanroom", "faithful", "faithful-lean"]))
    for (const name of ["faithful", "faithful-lean"] as const) {
      const files = await resolveIntentBundle(name)
      expect(files).toBeDefined()
      expect(Object.keys(files!).sort()).toEqual(["bundle.json", `intents/${name}.md`, `modes/${name}.md`])
      const bundle = parseIntentBundle(files!)
      // The builtin skeleton: the comma form of the five builtin ids, no
      // custom phase types shipped, the off subtask stamp (flipped from
      // ondemand 2026-10-05, matching the run default), the mode named like
      // the bundle.
      expect(bundle).toMatchObject({ name, phases: "analysis,design,implement,test,acceptance", mode: name, stamps: { subtask: "off" } })
      expect(bundle.types).toEqual([])
      expect(bundle.files.phases).toEqual({})
      const dir = tempDir()
      try {
        const written = await materializeIntentBundle(dir, bundle)
        expect(written.sort()).toEqual([`.opencode/auto/intents/${name}.md`, `.opencode/auto/modes/${name}.md`].sort())
        // The pack resolves by the config's intent selection key.
        expect(promptFacts({ dir, intent: name }).pack.name).toBe(name)
        const pack = loadIntents(dir)[name]!
        // The implement duties are the pack's own tier (the anchor), not the
        // core partial's migration framing.
        const m = packSubsection(pack, "phaseDuties", "m")
        expect(m).toContain(FAITHFUL_ANCHORS[name].m)
        expect(m).not.toContain("code migration")
        for (const key of ["a", "d", "t", "v"]) expect(packSubsection(pack, "phaseDuties", key)).toBeDefined()
        // The guarantees subsections survive: the precedence authority order,
        // the parseable asserts (with the implement must-not), the charter.
        expect(packSubsection(pack, "guarantees", "precedence")).toContain("outrank the planning input")
        const asserts = parseGuaranteeAsserts(pack)!
        expect(asserts).toBeDefined()
        expect(asserts.some((assert) => assert.template === "phase-plan" && assert.phase === "m" && assert.kind === "must-not" && assert.literals.includes("code migration"))).toBe(true)
        expect(packSubsection(pack, "guarantees", "verify-plan")).toContain(FAITHFUL_ANCHORS[name].charter)
        // The acceptance and governance semantics ride with the pack.
        expect(packSubsection(pack, "acceptance", "result-line")).toContain("Result: PASS")
        expect(packSubsection(pack, "governance", "repair")).toContain("regression check")
        // The mode lands as any hand-dropped file would: the exec anchor the
        // whole/subtask asserts pin.
        expect(loadModes(dir)[name]?.exec).toContain(FAITHFUL_ANCHORS[name].mode)
        // A materialized project adds no phase types: the builtin registry
        // already resolves the stamped sequence.
        expect(loadPhaseTypes(dir).some((entry) => entry.origin === "project")).toBe(false)
        expect(resolvePhases("analysis,design,implement,test,acceptance")).not.toBeNull()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })
})
