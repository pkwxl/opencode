// Intent bundles (plans/0079 §3): the named policy bundle — parse through
// the existing per-surface parsers, materialize into the target's
// .opencode/auto/ surfaces, resolve from a registered name or a bundle.json
// directory. The fixture is the Clean-Room Redesign bundle (§1.1's mapping):
// the concrete instance that validates the general mechanism.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { materializeIntentBundle, parseIntentBundle, registerIntentBundle, registeredIntentBundles, resolveIntentBundle, type IntentBundleFiles } from "../src/bundle"
import { loadIntents, packSubsection, parseIntentFile, planningInputScaffold } from "../src/intent/load"
import { parseGuaranteeAsserts } from "../src/intent/guarantees"
import { parseTestLanes, testLanesProblem } from "../src/intent/test-lanes"
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
        [".opencode/auto/intents/cleanroom.md", ".opencode/auto/modes/cleanroom.md", ".opencode/auto/phases/audit.md", ".opencode/auto/phases/spec-read.md", ".opencode/auto/provenance.json"].sort(),
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

  // Plans/0215 D3 (0165-157): materialization's writes are
  // write-tmp-then-rename (the init-time twin of applySync's writes — the
  // killed-materialization window 0214 D2 named). The read-only pack (a
  // killed run's stale protect bit) is the deterministic stand-in for the
  // crash mid-write: the pre-fix in-place Bun.write answers EACCES, the
  // rename replaces the entry and re-materialization heals.
  test("the files are replaced, not written in place: a read-only materialized pack is healed, not EACCES (plans/0215 D3)", async () => {
    const dir = tempDir()
    try {
      const bundle = parseIntentBundle(CLEANROOM)
      await materializeIntentBundle(dir, bundle)
      const pack = join(dir, ".opencode/auto/intents/cleanroom.md")
      chmodSync(pack, 0o444)
      try {
        await materializeIntentBundle(dir, bundle)
      } finally {
        chmodSync(pack, 0o644)
      }
      expect(readFileSync(pack, "utf8")).toBe(CLEANROOM["intents/cleanroom.md"]!)
      // The tmp rode .auto/ and was consumed by the rename; the workdir's
      // directory is not left behind (the lock's own discipline).
      expect(existsSync(join(dir, ".auto"))).toBe(false)
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

  test("the shipped survey duties carry the 0085 decision discipline: the analysis first, Settled lines, the Recommend-default fork bar", async () => {
    for (const name of ["cleanroom", "faithful", "faithful-lean"] as const) {
      const files = await resolveIntentBundle(name)
      // Wrap-insensitive: the same paragraph wraps differently per bundle.
      const duties = files!["phases/survey.md"]!.replace(/\n+/g, " ")
      // The approved analysis is the first source; its decisions land as
      // Settled lines, never re-raised as forks.
      expect(duties).toContain("docs/analysis.md")
      expect(duties).toContain("`Settled:`")
      expect(duties).toContain("already made")
      // The fork bar: project-level consequences and one Recommend: default,
      // decidable from the line alone; no person-needed item outside the
      // fork list (the depth/grading question category is retired). The
      // default's placement is part of the bar: it sits on the `Fork:` line
      // itself — one physical line, the one the release prints as the
      // person's review — with detail beneath as prose, never a separate
      // `Recommend:` item (a survey that wrote its defaults as sub-items
      // held its release: the gate scans whole lines).
      expect(duties).toContain("`Recommend:`")
      expect(duties).toContain("project's terms, not the technique's")
      expect(duties).toContain("one default, written on the `Fork:` line itself")
      expect(duties).toContain("without its `Recommend:` on it holds the release")
      expect(duties).toContain("never as a separate `Recommend:` item")
      expect(duties).toContain("no separate depth/grading question list")
      expect(duties).toContain("The survey decides what the person's approved decisions already decide")
    }
  })

  test("the built-in cleanroom bundle ships: it lists, resolves, parses, and materializes into a working project", async () => {
    expect(registeredIntentBundles()).toContain("cleanroom")
    const files = await resolveIntentBundle("cleanroom")
    expect(files).toBeDefined()
    const bundle = parseIntentBundle(files!)
    expect(bundle).toMatchObject({ name: "cleanroom", phases: "survey,spec-read,design,implement,test,audit", mode: "cleanroom", stamps: { subtask: "off" } })
    // The leading survey phase (plans/0081 D14): the human clarification gate
    // over the phase directory's survey.md, survey.md its standard artifact.
    const survey = bundle.types.find((entry) => entry.type === "survey")
    expect(survey).toMatchObject({ gates: ["human"] })
    expect(survey!.phaseArtifacts.map((spec) => spec.path)).toEqual(["survey.md"])
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
      // The generalized wall (plans/0081 D8): both wall kinds named in the
      // mode, the verify-plan charter judging prompts against the declared
      // kind. The scaling clause (D9) floors the spec-read concerns in both
      // carriers (the pack's section and the phase file's duties).
      // Line-wrap-independent: the init names both wall kinds and the
      // platform boundary clause (D8).
      const modeInit = loadModes(dir).cleanroom!.init.replaceAll("\n", " ")
      expect(modeInit).toContain("layout separation (the reference lives outside the worktrees the clean rooms use)")
      expect(modeInit).toContain("rule separation (a shared tree, with the reference's paths quarantined")
      expect(modeInit).toContain("names the platform boundary — the parts of the shared tree the clean rooms may still read")
      const modeExec = loadModes(dir).cleanroom!.exec.replaceAll("\n", " ")
      expect(modeExec).toContain("Layout separation")
      expect(modeExec).toContain("Rule separation")
      expect(modeExec).toContain("platform boundary")
      expect(packSubsection(pack, "guarantees", "verify-plan")).toContain("wall kind")
      expect(packSubsection(pack, "guarantees", "verify-plan")).toContain("quarantined")
      for (const carrier of [packSubsection(pack, "phaseDuties", "spec-read")!, loadPhaseTypes(dir).find((entry) => entry.type === "spec-read")!.planDuties!]) {
        const flat = carrier.replaceAll("\n", " ").replace(/  +/g, " ")
        expect(flat).toContain("a floor, not a ceiling")
        expect(flat).toContain("every feature area of the reference is assigned to exactly one task")
        expect(flat).toContain("coverage/accounting task")
      }
      // The pack ships its own planning-input scaffold (D12.1): the fallback
      // never needs the default pack's.
      expect(planningInputScaffold(loadIntents(dir), "cleanroom")).toContain("The reference and its wall")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The phase-document contract (plans/0124): every shipped phase type
  // declares its task documents in the one grammar — `Task-artifacts:`,
  // consumed by the formulation's seeded obligation rows — and the packs'
  // implement-phase item criteria defer to it: report.md is the
  // verification child's alone (0120's reservation), never an item's
  // declared artifact. The 0120 enactment enumerated the incident's
  // surfaces alone and missed these same-family copy sites; this pin holds
  // the whole family (the 0123 category-scope discipline's first fruit).
  test("the shipped family declares its task documents and the implement criteria reserve report.md (plans/0124)", async () => {
    const files = await resolveIntentBundle("cleanroom")
    const bundle = parseIntentBundle(files!)
    const audit = bundle.types.find((entry) => entry.type === "audit")!
    expect(audit.phaseArtifacts.map((spec) => spec.path)).toEqual(["audit.md", "verdict.md"])
    expect(audit.taskArtifacts.map((spec) => spec.path)).toEqual(["findings.md"])
    // plans/0177 D1 (0165-051): the charter's audit-plan text joins the
    // declared owners — the per-dimension findings document, the closing
    // consolidation — never the shared audit.md wording that contradicted
    // the phase's declaration. And D2 (0165-052): the source-free receipt
    // rule's mechanism is taught (the Evidence channel) and declared by the
    // divergence example row.
    const charter = files!["intents/cleanroom.md"]!
    expect(charter).toContain("its own findings document (`docs/T-NNN/findings.md`")
    expect(charter).not.toContain("with its findings written to audit.md")
    expect(charter).toContain("`Evidence:` channel")
    expect(charter).toContain("# Evidence: tmp/divergence-evidence.md")
    const specRead = bundle.types.find((entry) => entry.type === "spec-read")!
    expect(specRead.phaseArtifacts.map((spec) => spec.path)).toEqual(["spec-notes.md"])
    expect(specRead.taskArtifacts.map((spec) => spec.path)).toEqual(["notes.md"])
    expect(specRead.planDuties).toContain("`notes.md` in its own task directory")
    for (const name of ["cleanroom", "faithful", "faithful-lean"]) {
      const shipped = await resolveIntentBundle(name)
      const pack = parseIntentFile(name, shipped![`intents/${name}.md`]!)
      const m = packSubsection(pack, "phaseDuties", "m")!.replaceAll("\n", " ").replace(/  +/g, " ")
      expect(m).toContain("a document deliverable carries its own name")
      expect(m).toContain("`docs/T-NNN/report.md` is never one (the verification child's wrap-up report, reserved)")
      expect(m).not.toContain("plus its task report")
    }
  })

  // The sealed reference wall (plans/0132 D1): the shipped cleanroom bundle
  // carries the sealing semantics on the spec-read type — `Wall: seal` with
  // no door named (the universality floor: no project's path rides the
  // template; the concrete door path is the person-owned fill at
  // materialization). The survey proposes the door; the spec-read duties
  // teach the wall and the evidence layer; the audit type stays untouched
  // (the audit is a clean room under 0121).
  test("the shipped cleanroom bundle declares the wall: spec-read seals, no door named, the duties teach the evidence layer (plans/0132)", async () => {
    const files = await resolveIntentBundle("cleanroom")
    const bundle = parseIntentBundle(files!)
    const specRead = bundle.types.find((entry) => entry.type === "spec-read")!
    expect(specRead.wall).toEqual({ doors: [] })
    expect(specRead.planDuties).toContain("this phase's close seals the reference wall")
    expect(specRead.planDuties).toContain("out-of-tree compliance home")
    expect(specRead.planDuties).toContain("Commit messages are covered by the same rule")
    const survey = bundle.types.find((entry) => entry.type === "survey")!
    expect(survey.gates).toEqual(["human"])
    expect(survey.planDuties).toContain("the reference door")
    const audit = bundle.types.find((entry) => entry.type === "audit")!
    expect(audit.wall).toBeUndefined()
    // The other two postures declare no wall at all.
    for (const name of ["faithful", "faithful-lean"]) {
      const shipped = await resolveIntentBundle(name)
      const other = parseIntentBundle(shipped!)
      expect(other.types.every((entry) => entry.wall === undefined)).toBe(true)
    }
  })

  // The enumeration and provenance discipline (plans/0153): the shipped
  // cleanroom survey enumerates against the closed observable surface the
  // brief's methodology names (the source tree never the enumeration
  // instrument), lands the standing capability catalog with its status
  // semantics and completeness criterion, and teaches the pair-diff /
  // delta-round rule; the spec-read duties carry per-entry provenance and
  // the property-first clause for internal enablers. The other two
  // postures keep their survey shapes (the discipline is cleanroom's).
  test("the shipped cleanroom duties carry the enumeration and provenance discipline (plans/0153)", async () => {
    const files = await resolveIntentBundle("cleanroom")
    const bundle = parseIntentBundle(files!)
    const survey = bundle.types.find((entry) => entry.type === "survey")!
    const duties = survey.planDuties!.replaceAll("\n", " ")
    expect(duties).toContain("closed observable surface the brief's methodology names")
    expect(duties).toContain("never the enumeration instrument")
    expect(duties).toContain("docs/capability-catalog.md")
    expect(duties).toContain("Unresolved is never silently treated as Optional")
    expect(duties).toContain("every anchor of the closed set has its row")
    expect(duties).toContain("diffed id by id")
    expect(duties).toContain("recorded baseline change")
    // The review completion's additions: the small posture carries the catalog
    // too, the layering assignments cite their evidence (the criteria riding
    // the brief's methodology, never the template), and the rows stay
    // identifier-clean — the evidence column is kinds and public anchors
    // alone, never a path for reference internals past the wall.
    expect(duties).toContain("bind at every scale")
    expect(duties).toContain("names its evidence in its row")
    expect(duties).toContain("never the reference's private identifiers")
    const specRead = bundle.types.find((entry) => entry.type === "spec-read")!
    const extraction = specRead.planDuties!.replaceAll("\n", " ")
    expect(extraction).toContain("evidence kind")
    expect(extraction).toContain("never mechanism narration")
  })

  // The widened consistency gate (plans/0154): the survey's pair diff
  // covers what propagates — the decisions ledger by subject and the
  // closed anchor set itself beside the catalog rows, resolving at the
  // survey's close before anything builds on it — and the spec-read
  // duties gain sampled accuracy verification over the riskiest
  // contract classes plus the pair clause for comparative arrangements.
  // The other two postures keep their shapes (cleanroom's discipline).
  test("the shipped cleanroom duties carry the widened consistency gate and sampled verification (plans/0154)", async () => {
    const files = await resolveIntentBundle("cleanroom")
    const bundle = parseIntentBundle(files!)
    const survey = bundle.types.find((entry) => entry.type === "survey")!
    const duties = survey.planDuties!.replaceAll("\n", " ")
    expect(duties).toContain("the decision records (`Fork:` and `Settled:` lines, recorded gaps) diffed by their subject")
    expect(duties).toContain("the closed anchor set itself")
    expect(duties).toContain("resolves before the phase closes")
    const specRead = bundle.types.find((entry) => entry.type === "spec-read")!
    const extraction = specRead.planDuties!.replaceAll("\n", " ")
    expect(extraction).toContain("riskiest distilled contracts")
    expect(extraction).toContain("the wall's silent failure")
    expect(extraction).toContain("binding on the consolidated document")
    expect(extraction).toContain("never one run silently kept")
  })

  // The two-lane concurrency model (plans/0126 D1): every shipped pack — the
  // builtin default and the three bundles — carries the width-keyed
  // doc-concurrency teaching, level-free; the bundles' code-depth
  // `## parallelism` stays deferred (0125 D7's remaining half).
  test("the shipped family carries ## doc-parallelism; no bundle ships ## parallelism (plans/0126 D1)", async () => {
    for (const name of ["cleanroom", "faithful", "faithful-lean"]) {
      const shipped = await resolveIntentBundle(name)
      const pack = parseIntentFile(name, shipped![`intents/${name}.md`]!)
      expect(pack.docParallelism).toContain("same-tree concurrency admits on")
      expect(pack.docParallelism).toContain("give every doc task `Touches: docs/T-NNN/`")
      expect(pack.parallelism).toBeUndefined()
    }
    const plain = tempDir()
    try {
      expect(promptFacts({ dir: plain }).pack.docParallelism).toContain("same-tree concurrency admits on")
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  // The lane table ships as the floor (plans/0121 D7): comments-only in the
  // shipped pack, so a project declaring no lanes is byte-identically
  // unaffected; the comments teach the shape with the five example rows a
  // cleanroom project owes, each a commented-out field block in the exact
  // grammar parseTestLanes accepts once uncommented.
  test("the shipped cleanroom lane section is the comments-only floor: no lanes parsed, the five rows taught, the examples parse once uncommented (plans/0121 D7)", async () => {
    const files = await resolveIntentBundle("cleanroom")
    const pack = parseIntentFile("cleanroom", files!["intents/cleanroom.md"]!)
    // The floor: a section of comments and blanks parses to undefined — no
    // table renders anywhere (P10).
    expect(parseTestLanes(pack)).toBeUndefined()
    const section = packSubsection(pack, "quality", "test-lanes")!
    expect(section).toBeDefined()
    // The commented examples name the five rows the declarations owe.
    for (const name of ["build", "paradigm-constraints", "properties", "divergence", "acceptance"]) {
      expect(section).toContain(`# ${name}:`)
    }
    // Uncommented into a scratch pack: each commented line whose stripped form
    // already matches the row grammar (a suite header or a field line)
    // activates, the teaching prose and the per-row descriptions staying
    // comments — and the five example rows parse clean, every command a bare
    // neutral token, the divergence row the regression-cost row whose command
    // carries no path and no corpus location (D5's shape).
    const rowHead = /^([a-z][a-z0-9-]*):\s*$/
    const rowField = /^(Command|Cost|Surfaces|Exclusive|Strict):/
    const active = section
      .split("\n")
      .map((line) => {
        const marked = /^# (.*)$/.exec(line)
        if (!marked) return line
        return rowHead.test(marked[1]!) || rowField.test(marked[1]!) ? marked[1]! : line
      })
      .join("\n")
    const scratch = parseIntentFile("cleanroom", `# cleanroom\n\n## quality\n\n### test-lanes\n\n${active}\n`)
    expect(testLanesProblem(scratch)).toBeUndefined()
    const lanes = parseTestLanes(scratch)!
    expect(lanes.map((lane) => [lane.name, lane.cost])).toEqual([
      ["build", "cheap"],
      ["paradigm-constraints", "cheap"],
      ["properties", "cheap"],
      ["divergence", "regression"],
      ["acceptance", "anchor"],
    ])
    // Bare commands: a single token each — no whitespace, no path separator,
    // nothing a clean-room session could read a corpus location from.
    for (const lane of lanes) expect(lane.command).toMatch(/^[a-z0-9-]+$/)
    expect(lanes.find((lane) => lane.name === "divergence")!.command).toBe("divergence-scan")
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
      expect(Object.keys(files!).sort()).toEqual(["bundle.json", `intents/${name}.md`, `modes/${name}.md`, "phases/survey.md"])
      const bundle = parseIntentBundle(files!)
      // The builtin skeleton: the comma form of the five builtin ids, no
      // custom phase types shipped, the off subtask stamp (flipped from
      // ondemand 2026-10-05, matching the run default), the mode named like
      // the bundle.
      expect(bundle).toMatchObject({ name, phases: "survey,analysis,design,implement,test,acceptance", mode: name, stamps: { subtask: "off" } })
      expect(bundle.types.map((entry) => entry.type)).toEqual(["survey"])
      expect(bundle.files.phases).toEqual({ survey: expect.stringContaining("Fork:") })
      const dir = tempDir()
      try {
        const written = await materializeIntentBundle(dir, bundle)
        expect(written.sort()).toEqual([`.opencode/auto/intents/${name}.md`, `.opencode/auto/modes/${name}.md`, ".opencode/auto/phases/survey.md", ".opencode/auto/provenance.json"].sort())
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
        // A materialized project adds exactly the survey type (plans/0081
        // D14); the builtin registry resolves the rest of the sequence.
        expect(loadPhaseTypes(dir).filter((entry) => entry.origin === "project").map((entry) => entry.type)).toEqual(["survey"])
        expect(resolvePhases("survey,analysis,design,implement,test,acceptance", loadPhaseTypes(dir))).not.toBeNull()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })
})
