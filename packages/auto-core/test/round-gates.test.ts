// Human-gate convergence (M4.2, plans/0049): the round brief, the phase gates
// inside completePhase, the round-close gate, the new config keys and the
// prompt slots that carry them.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadProjectConfig } from "../src/config"
import { acceptanceMark, p1Scope, roleOf } from "../src/document/roles"
import { clarifiedMark, completePhase, establishRound, forksWithoutRecommend, phaseGateProblems, phaseGates, readPhases, surveyForks } from "../src/phases"
import { renderPhaseHandover } from "../src/prompt"
import { renderFormulationTodo } from "../src/prompt-plan"
import { closeSection, renderRoundBrief, roundBriefText } from "../src/round-brief"
import { roundCloseLines, roundCloseProblems } from "../src/round-close"
import { phaseType, planDutiesPartial } from "../src/phases/registry"
import { parsePhaseTypeFile } from "../src/phases/custom"
import { promptFacts } from "../src/prompt-facts"
import { renderText } from "../src/template"
import { git } from "./fixtures/runner"
import { withDirFactory } from "./fixtures/dir"

const withDir = withDirFactory("auto-round-gates-")

async function gitRepo(dir: string) {
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
}

const FILLED_CLOSE = "## Close\n\n- Restated: the retry policy, in src/net/README.md.\n- Accepted as lost: none.\n"

describe("round brief (plans/0049 G2/G3)", () => {
  test("an untouched stub is no planning input and has an empty close section", async () => {
    const stub = renderRoundBrief(3)
    expect(stub).toStartWith("# Round R-03\n")
    expect(closeSection(stub)).toBe("")
    // 0106: the Close hint names the post-0101 enforcer (transfer; m mode
    // keeps plan) and carries the depth clause the field round showed a
    // proxy session needed to fill the section properly.
    expect(stub).toContain("`transfer` (m mode: `plan`) refuses to open the")
    expect(stub).toContain("each restated decision names")
    await withDir(async (dir) => {
      mkdirSync(join(dir, "docs/R-03"), { recursive: true })
      writeFileSync(join(dir, "docs/R-03/round.md"), stub)
      expect(await roundBriefText(dir, 3)).toBeUndefined()
      writeFileSync(join(dir, "docs/R-03/round.md"), stub.replace("## Goal\n", "## Goal\n\nPort the driver to arm64.\n"))
      const text = (await roundBriefText(dir, 3))!
      expect(text).toContain("Port the driver to arm64.")
      expect(text).not.toContain("<!--")
    })()
  })

  test("closeSection: missing heading → undefined; body runs to the next level-1/2 heading", () => {
    expect(closeSection("# R\n\n## Goal\n\nx\n")).toBeUndefined()
    expect(closeSection(`# R\n\n${FILLED_CLOSE}\n## Notes\n\nlater\n`)).toBe(
      "- Restated: the retry policy, in src/net/README.md.\n- Accepted as lost: none.",
    )
    expect(closeSection("## Close\n\n### Restated\n\n- a\n")).toBe("### Restated\n\n- a")
  })

  test("roles: round.md is the human-written roundBrief role (process, eof-exempt); .gitignore is in-scope by role but workspace — the scan's nested gate keeps it out (plans/0108)", () => {
    expect(roleOf("docs/R-01/round.md")).toBe("roundBrief")
    expect(roleOf("docs/R-01/P01-design/round.md")).toBe("artifact")
    expect(p1Scope("docs/R-01/round.md")).toBe(false)
    expect(p1Scope(".gitignore")).toBe(true)
    expect(p1Scope("src/main.rs")).toBe(true)
  })

  test(
    "establishRound writes the stub once for phased flows, never for m",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).text()).toBe(renderRoundBrief(1))
      writeFileSync(join(dir, "docs/R-01/round.md"), "# mine\n")
      await establishRound(dir, { phases: "amt" })
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).text()).toBe("# mine\n")
      const other = mkdtempSync(join(tmpdir(), "auto-round-gates-m-"))
      try {
        await establishRound(other, { phases: "m" })
        expect(await Bun.file(join(other, "docs/R-01/round.md")).exists()).toBe(false)
      } finally {
        rmSync(other, { recursive: true, force: true })
      }
    }),
  )
})

describe("phase gates in completePhase (plans/0049 G7)", () => {
  test("acceptanceMark: the last Accepted: line must be exactly the sign-off", () => {
    expect(acceptanceMark("# a\n\nsummary\n")).toEqual({ present: false, accepted: false })
    expect(acceptanceMark("Accepted: yes\n")).toEqual({ present: true, accepted: true })
    expect(acceptanceMark("  Accepted: yes  \n")).toEqual({ present: true, accepted: true })
    expect(acceptanceMark("Accepted: yes\nAccepted: no\n")).toEqual({ present: true, accepted: false })
    expect(acceptanceMark("accepted: yes\n")).toEqual({ present: false, accepted: false })
    expect(acceptanceMark("Accepted: Yes\n")).toEqual({ present: true, accepted: false })
  })

  test("phaseGates: the type's own gates plus acceptance from config acceptanceGate", () => {
    const unit = (type: string) => ({ round: "R-01", id: "P01", type, entry: phaseType(type)!, dir: "" })
    expect(phaseGates(unit("design"))).toEqual([])
    expect(phaseGates(unit("design"), ["design"])).toEqual(["acceptance"])
    expect(phaseGates(unit("acceptance"))).toEqual(["verdict"])
    expect(phaseGates(unit("acceptance"), ["acceptance", "design"])).toEqual(["verdict", "acceptance"])
  })

  test(
    "acceptance gate: missing or unsigned acceptance.md holds the phase; the sign-off completes it",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "dm" })
      const design = (await readPhases(dir))!.phases[0]!
      expect(await completePhase(dir, design, ["acceptance"])).toEqual(["acceptance: docs/R-01/P01-design/acceptance.md is missing"])
      writeFileSync(join(dir, design.dir, "acceptance.md"), "# Acceptance\n\nLooks right.\n")
      expect(await completePhase(dir, design, ["acceptance"])).toEqual([
        "acceptance: docs/R-01/P01-design/acceptance.md has no `Accepted: yes` line",
      ])
      expect((await readPhases(dir))!.done.size).toBe(0)
      writeFileSync(join(dir, design.dir, "acceptance.md"), "# Acceptance\n\nLooks right.\n\nAccepted: yes\n")
      expect(await completePhase(dir, design, ["acceptance"])).toEqual([])
      expect([...(await readPhases(dir))!.done]).toEqual(["P01"])
    }),
  )

  test(
    "verdict gate: Result: FAIL holds the phase; no verdict file or line passes, like a task report",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "mv" })
      const acceptance = (await readPhases(dir))!.phases[1]!
      writeFileSync(join(dir, acceptance.dir, "verdict.md"), "# Verdict\n\nResult: FAIL login flow regressed\n")
      expect(await completePhase(dir, acceptance, ["verdict"])).toEqual([
        "verdict: docs/R-01/P02-acceptance/verdict.md concludes Result: FAIL (login flow regressed)",
      ])
      writeFileSync(join(dir, acceptance.dir, "verdict.md"), "# Verdict\n\nResult: PASS\n")
      expect(await completePhase(dir, acceptance, ["verdict"])).toEqual([])
      const other = (await readPhases(dir))!.phases[0]!
      expect(await completePhase(dir, other, ["verdict"])).toEqual([])
    }),
  )
})

describe("round-close gate (plans/0049 G8)", () => {
  // The round user report's passing shape (plans/0081 D4): non-empty and
  // eof-terminated at docs/R-NN/report-for-user.md.
  const writeReport = (dir: string, round: number, text = `# Round report\n\nWhat happened.\n\n<!-- auto: eof -->\n`) => {
    mkdirSync(join(dir, "docs", `R-${String(round).padStart(2, "0")}`), { recursive: true })
    writeFileSync(join(dir, "docs", `R-${String(round).padStart(2, "0")}`, "report-for-user.md"), text)
  }

  test(
    "an empty close listing is the problem; a destination process reference records with the other families, never a round-time problem (plans/0103 D2's second addendum); the workspace's own files and .gitignore's .auto/ are not scanned (plans/0108)",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      // The workspace's own files are process workspace since 0108 — src
      // tooling referencing docs/, the gitignore's .auto/ — never scanned.
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src/lib.rs"), "// see docs/T-004/report.md for the reason\nfn main() {}\n")
      writeFileSync(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      // The destination: a nested repository whose own file references the
      // process side — the deliverable, the one side the scan reads, and a
      // recorded finding like every other family. Since 0119 the ledger is
      // git's modified view: the finding must sit in a driver commit (the
      // unified commit's own trailers) for the round to answer for it.
      mkdirSync(join(dir, "dest", "src"), { recursive: true })
      await git(join(dir, "dest"), "init", "-q")
      await git(join(dir, "dest"), "config", "user.email", "t@example.com")
      await git(join(dir, "dest"), "config", "user.name", "t")
      writeFileSync(join(dir, "dest", "src", "lib.rs"), "// see docs/T-004/report.md for the reason\nfn main() {}\n")
      await git(join(dir, "dest"), "add", "-A")
      await git(join(dir, "dest"), "commit", "-qm", "destination\n\nAuto-Task: T-001\nAuto-Stage: implement")
      writeReport(dir, 1)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const close = await roundCloseProblems(dir, 1)
      expect(close.problems).toHaveLength(1)
      expect(close.problems[0]).toContain("docs/R-01/round.md `## Close` is empty")
      expect(close.warnings).toEqual([
        "containment: 1 reference(s) recorded for release (process-document references, task ids, paths outside a destination's own root) — restate what each anchored in place and remove the pointer when the destination ships, never delete the record it anchored; the release gate lists and enforces them",
        "build: no build command configured (config `build`); the target build was not checked",
      ])
      // 0106: the held shape names its refuser and splits the ⚠ records out
      // from under the "until these are fixed" header — a proxy session
      // reading the stop as a work list must not see records as work.
      const held = roundCloseLines(close)
      expect(held[0]).toBe("⚠ round close checks: transfer will refuse to open the next round until these are fixed")
      expect(held).toContain(`  ✗ ${close.problems[0]}`)
      expect(held).toContain("  recorded — not this stop's work; each ⚠ names its own moment (containment waits for release):")
      expect(held).toContain(`  ⚠ ${close.warnings[0]}`)
      // The m-mode caller names itself (plan.ts previousRoundClose).
      expect(roundCloseLines(close, "plan")[0]).toBe("⚠ round close checks: plan will refuse to open the next round until these are fixed")
    }),
  )

  test(
    "destination containment rides as warnings, never problems — every family counted (plans/0103 D2, its second addendum: the treatment is deferred to release)",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      writeFileSync(join(dir, "docs/R-01/round.md"), `# Round R-01\n\n${FILLED_CLOSE}`)
      writeReport(dir, 1)
      // A nested destination repository carrying exactly the recorded
      // findings: a process-document citation, a task-id citation and a
      // path climbing out of its root — landed by the driver's own commit
      // (plans/0119: the ledger is git's modified view, the run of driver
      // commits back from HEAD).
      mkdirSync(join(dir, "vendor", "src"), { recursive: true })
      await git(join(dir, "vendor"), "init", "-q")
      await git(join(dir, "vendor"), "config", "user.email", "t@example.com")
      await git(join(dir, "vendor"), "config", "user.name", "t")
      writeFileSync(join(dir, "vendor", "src", "a.rs"), "//! The slot (T-012 §2.2).\n")
      writeFileSync(join(dir, "vendor", "src", "b.c"), 'path = "../../outside"\n')
      writeFileSync(join(dir, "vendor", "src", "c.rs"), "//! Layout per docs/T-009/report.md.\n")
      await git(join(dir, "vendor"), "add", "-A")
      await git(join(dir, "vendor"), "commit", "-qm", "destination\n\nAuto-Task: T-001\nAuto-Stage: implement")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const close = await roundCloseProblems(dir, 1)
      expect(close.problems).toEqual([])
      // One aggregate containment line (plans/0109 D6: the count of pending
      // references, never the per-finding ledger) beside the build note.
      expect(close.warnings).toHaveLength(2)
      expect(close.warnings[0]).toBe(
        "containment: 3 reference(s) recorded for release (process-document references, task ids, paths outside a destination's own root) — restate what each anchored in place and remove the pointer when the destination ships, never delete the record it anchored; the release gate lists and enforces them",
      )
      expect(close.warnings[1]).toBe("build: no build command configured (config `build`); the target build was not checked")
    }),
  )

  test(
    "a clean tree, a filled close listing and a passing build pass; a failing build is a problem with its output",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      writeFileSync(join(dir, "docs/R-01/round.md"), `# Round R-01\n\n${FILLED_CLOSE}`)
      writeReport(dir, 1)
      writeFileSync(join(dir, "main.c"), "int main(void) { return 0; }\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const pass = await roundCloseProblems(dir, 1, { build: "true" })
      expect(pass).toEqual({ problems: [], warnings: [] })
      expect(roundCloseLines(pass)).toEqual(["✓ round close checks passed"])
      const fail = await roundCloseProblems(dir, 1, { build: "echo compiling; echo broken >&2; exit 3" })
      expect(fail.problems).toHaveLength(1)
      expect(fail.problems[0]).toStartWith("build: `echo compiling; echo broken >&2; exit 3` exited 3; output tail:\ncompiling\nbroken")
    }),
  )

  test(
    "scan exemptions (config scanExempt, plans/0059 X2): an exempted destination path is left out of the destination scan",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      writeFileSync(join(dir, "docs/R-01/round.md"), `# Round R-01\n\n${FILLED_CLOSE}`)
      writeReport(dir, 1)
      mkdirSync(join(dir, "dest", "test/fixtures"), { recursive: true })
      await git(join(dir, "dest"), "init", "-q")
      await git(join(dir, "dest"), "config", "user.email", "t@example.com")
      await git(join(dir, "dest"), "config", "user.name", "t")
      writeFileSync(join(dir, "dest", "test/fixtures/sample.md"), "a sample task record: docs/T-004/report.md\n")
      await git(join(dir, "dest"), "add", "-A")
      await git(join(dir, "dest"), "commit", "-qm", "fixtures\n\nAuto-Task: T-001\nAuto-Stage: implement")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const scanned = await roundCloseProblems(dir, 1, { build: "true" })
      expect(scanned.problems).toEqual([])
      expect(scanned.warnings[0]).toStartWith("containment: 1 reference(s) recorded for release")
      expect(await roundCloseProblems(dir, 1, { build: "true", scanExempt: ["dest/test/fixtures/**"] })).toEqual({ problems: [], warnings: [] })
    }),
  )

  test(
    "the ledger is git's modified view (plans/0119): a destination's person-committed content is never the round's record, the driver's commit run is, and a pristine upstream checkout costs nothing",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      writeFileSync(join(dir, "docs/R-01/round.md"), `# Round R-01\n\n${FILLED_CLOSE}`)
      writeReport(dir, 1)
      // The person brought a finished upstream repository in: committed
      // content with references everywhere, a clean tree — the migration
      // never wrote a line of it, so the round records nothing. This is the
      // cleanroom shape (a kernel-sized pristine checkout) that OOMed under
      // 0108's whole-tree scan.
      mkdirSync(join(dir, "upstream", "src"), { recursive: true })
      await git(join(dir, "upstream"), "init", "-q")
      await git(join(dir, "upstream"), "config", "user.email", "t@example.com")
      await git(join(dir, "upstream"), "config", "user.name", "t")
      writeFileSync(join(dir, "upstream", "src/old.c"), "// see docs/T-001/report.md and .auto/plan.json\n")
      await git(join(dir, "upstream"), "add", "-A")
      await git(join(dir, "upstream"), "commit", "-qm", "person history")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const person = await roundCloseProblems(dir, 1, { build: "true" })
      expect(person.warnings).toEqual([])
      // The driver's own commit into the same repository is the round's
      // record — the reference it wrote counts; the person's still does not.
      writeFileSync(join(dir, "upstream", "src/wired.c"), "// wiring per docs/T-002/report.md\n")
      await git(join(dir, "upstream"), "add", "-A")
      await git(join(dir, "upstream"), "commit", "-qm", "wire the driver\n\nAuto-Task: T-002\nAuto-Stage: implement")
      const driven = await roundCloseProblems(dir, 1, { build: "true" })
      expect(driven.problems).toEqual([])
      expect(driven.warnings[0]).toStartWith("containment: 1 reference(s) recorded for release")
    }),
  )

  test(
    "untracked files inside a destination are scanned into the count; a missing round.md is the problem",
    withDir(async (dir) => {
      await gitRepo(dir)
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      mkdirSync(join(dir, "dest"), { recursive: true })
      await git(join(dir, "dest"), "init", "-q")
      await git(join(dir, "dest"), "config", "user.email", "t@example.com")
      await git(join(dir, "dest"), "config", "user.name", "t")
      writeFileSync(join(dir, "dest", "notes.txt"), "state lives in .auto/progress.json\n")
      writeReport(dir, 1)
      const close = await roundCloseProblems(dir, 1, { build: "true" })
      expect(close.problems).toEqual(["close listing: docs/R-01/round.md is missing"])
      expect(close.warnings).toEqual([
        "containment: 1 reference(s) recorded for release (process-document references, task ids, paths outside a destination's own root) — restate what each anchored in place and remove the pointer when the destination ships, never delete the record it anchored; the release gate lists and enforces them",
      ])
    }),
  )

  // The fourth check retired (plans/0109 D1): the report's mandate is gone —
  // a report the person commissions stands as a document, and the gate never
  // reads it.
  test(
    "the round user report retired (plans/0109 D1): missing, empty or unterminated is never a close problem",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      writeFileSync(join(dir, "docs/R-01/round.md"), `# Round R-01\n\n${FILLED_CLOSE}`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      // Absent, empty, unterminated: all pass alike — the gate is the scan,
      // the build and the close listing alone.
      expect((await roundCloseProblems(dir, 1)).problems).toEqual([])
      writeReport(dir, 1, "   \n")
      expect((await roundCloseProblems(dir, 1)).problems).toEqual([])
      writeReport(dir, 1, "# Round report\n\nNeeds your attention: nothing yet.\n")
      expect((await roundCloseProblems(dir, 1)).problems).toEqual([])
    }),
  )
})

describe("the human clarification gate (plans/0081 D14.3)", () => {
  // A survey-type phase entry parsed like a bundle's phases/survey.md.
  const survey = parsePhaseTypeFile(
    "survey",
    "# Survey\n\nGate: human\nPhase-artifacts: survey.md\n\n## plan duties\n\nInventory-level reading.\n",
  )

  test("Gate: human parses (the third PHASE_GATES kind) with survey.md its standard artifact", () => {
    expect(survey.gates).toEqual(["human"])
    expect(survey.phaseArtifacts.map((spec) => spec.path)).toEqual(["survey.md"])
  })

  test("surveyForks / clarifiedMark / forksWithoutRecommend: list-marker forks count; the whole-line release mark", () => {
    const text = ["# Survey", "", "Fork: the journal — reimplement or stub it? Recommend: stub", "- Fork: parity depth — core only or full?", "    * Fork: platform boundary — where does it sit?", "", "Forks: none (the other posture).", "Clarified: no"].join("\n")
    expect(surveyForks(text)).toBe(3)
    expect(forksWithoutRecommend(text)).toBe(2)
    expect(surveyForks("Forks: none\n")).toBe(0)
    expect(clarifiedMark(text)).toBe(false)
    expect(clarifiedMark("reviewed.\n\nClarified: yes\n")).toBe(true)
    expect(clarifiedMark("Clarified: yes, mostly")).toBe(false)
  })

  test("a missing survey.md is a gate problem, never a silent pass (§7 A6)", async () => {
    await withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const phase = (await readPhases(dir))!.phases[0]!
      expect(await phaseGateProblems(dir, phase, ["human"])).toEqual([
        "clarification: docs/R-01/P01-implement/survey.md is missing — the survey must exist before the phase can complete",
      ])
    })
  })

  test("zero Fork: lines completes the phase like an ungated one", async () => {
    await withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const phase = (await readPhases(dir))!.phases[0]!
      // Zero forks (the `Forks: none` posture): pass through, no gate wait.
      await Bun.write(join(dir, phase.dir, "survey.md"), "# Survey\n\nThe map.\n\nForks: none\n")
      expect(await phaseGateProblems(dir, phase, ["human"])).toEqual([])
      expect(await completePhase(dir, phase, ["human"])).toEqual([])
      expect(await Bun.file(join(dir, phase.dir, "done.md")).exists()).toBe(true)
    })
  })

  test("at least one Fork: line holds the phase open until the person's Clarified: yes", async () => {
    await withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const phase = (await readPhases(dir))!.phases[0]!
      const doc = join(dir, phase.dir, "survey.md")
      await Bun.write(doc, "# Survey\n\nFork: scope — the journal too reshapes R-02; Recommend: the core only\n")
      const held = await completePhase(dir, phase, ["human"])
      expect(held).toEqual([
        "clarification: docs/R-01/P01-implement/survey.md records 1 open Fork: line(s) — awaiting the person (add `Clarified: yes` to release the phase; it accepts every line's `Recommend:` default, overrides go beside the lines)",
      ])
      expect(await Bun.file(join(dir, phase.dir, "done.md")).exists()).toBe(false)
      // The release line completes the phase in one act (D15.2's approval).
      await Bun.write(doc, "# Survey\n\nFork: scope — the journal too reshapes R-02; Recommend: the core only\n\nClarified: yes\n")
      expect(await completePhase(dir, phase, ["human"])).toEqual([])
      expect(await Bun.file(join(dir, phase.dir, "done.md")).exists()).toBe(true)
    })
  })

  test("a Fork: line without its Recommend: default is a second clarification problem (plans/0085 A3)", async () => {
    await withDir(async (dir) => {
      await establishRound(dir, { phases: "m" })
      const phase = (await readPhases(dir))!.phases[0]!
      const doc = join(dir, phase.dir, "survey.md")
      await Bun.write(doc, "# Survey\n\nFork: scope — core only? Recommend: core\nFork: depth — full parity?\n")
      expect(await completePhase(dir, phase, ["human"])).toEqual([
        "clarification: docs/R-01/P01-implement/survey.md records 2 open Fork: line(s) — awaiting the person (add `Clarified: yes` to release the phase; it accepts every line's `Recommend:` default, overrides go beside the lines)",
        "clarification: docs/R-01/P01-implement/survey.md has 1 Fork: line(s) without a `Recommend:` default — the person decides from project consequences plus one default",
      ])
      // The person's release passes regardless (D15.2's approval overrides).
      await Bun.write(doc, "# Survey\n\nFork: scope — core only? Recommend: core\nFork: depth — full parity?\n\nClarified: yes\n")
      expect(await completePhase(dir, phase, ["human"])).toEqual([])
    })
  })
})

describe("config keys acceptanceGate / build (plans/0049 G9)", () => {
  const write = (dir: string, config: object) => {
    mkdirSync(join(dir, ".opencode/auto"), { recursive: true })
    writeFileSync(join(dir, ".opencode/auto/config.json"), JSON.stringify(config))
  }

  test(
    "valid values load; absent keys stay undefined",
    withDir(async (dir) => {
      write(dir, { phases: "adm", acceptanceGate: ["design", "implement"], build: "make" })
      const config = await loadProjectConfig(dir)
      expect(config.acceptanceGate).toEqual(["design", "implement"])
      expect(config.build).toBe("make")
      write(dir, { phases: "adm" })
      const bare = await loadProjectConfig(dir)
      expect(bare.acceptanceGate).toBeUndefined()
      expect(bare.build).toBeUndefined()
    }),
  )

  test(
    "unknown types, repeats, non-arrays and an empty build are rejected",
    withDir(async (dir) => {
      for (const [value, pattern] of [
        [{ acceptanceGate: ["nope"] }, /unknown phase type\(s\) nope/],
        [{ acceptanceGate: ["design", "design"] }, /lists a phase type twice/],
        [{ acceptanceGate: "design" }, /must be an array/],
        [{ build: "" }, /build must be a non-empty string/],
      ] as const) {
        write(dir, { phases: "adm", ...value })
        await expect(loadProjectConfig(dir)).rejects.toThrow(pattern)
      }
    }),
  )
})

describe("prompt slots (plans/0049 G3/G7)", () => {
  const design = phaseType("design")!
  const facts = promptFacts()
  const duties = renderText(`{{> ${planDutiesPartial(design)}}}>`, {}).trimEnd()

  test("phase-plan injects the round brief with its intent rules only when there is one", () => {
    const base = { phase: design, phaseId: "R-01.P02", taskIndex: "docs/R-01/P02-design/tasks.md", numberStart: 2, charter: duties }
    const withBrief = renderFormulationTodo(facts, { ...base, round: "## Goal\n\nPort the driver to arm64." }).scope
    expect(withBrief).toContain("## Input: round brief (this round's round.md)")
    expect(withBrief).toContain("Port the driver to arm64.")
    expect(withBrief).toContain("never edit round.md")
    expect(renderFormulationTodo(facts, base).scope).not.toContain("round brief")
  })

  test("phase-handover asks for the acceptance draft and forbids the sign-off only when the gate is on", () => {
    const base = { phase: design, handover: "docs/R-01/P02-design/handover.md" }
    const gated = renderPhaseHandover(facts, { ...base, acceptance: "docs/R-01/P02-design/acceptance.md" })
    expect(gated).toContain("## Artifact: acceptance draft")
    expect(gated).toContain("Never write a line starting with `Accepted:`")
    expect(gated).toContain("may write are docs/R-01/P02-design/handover.md and docs/R-01/P02-design/acceptance.md")
    expect(gated).toContain("decisions the reviewer should confirm or")
    const plain = renderPhaseHandover(facts, base)
    expect(plain).not.toContain("acceptance draft")
    expect(plain).toContain("The only file this session may write is docs/R-01/P02-design/handover.md;")
  })
})
