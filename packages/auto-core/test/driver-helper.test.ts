// The person-proxy brief (plans/0105): one case per row of the D5
// state→channels map — the detection keys the state, the CHANNELS name the
// person-owned documents, RECOVERY the exact commands — plus the ROLE pin
// (prompts/run.md named as reference-not-role, PRIMER and POLICY verbatim
// from agents-block's GUIDANCE) and the D4 pin (the module imports no
// writer; a render against a fixture target leaves the tree byte-identical,
// and nothing is parsed back). The stop lines rendered into STATE are the
// shared emitters' own bytes — the same lines the terminal prints — pinned
// here against the twins' compositions.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import { GUIDANCE, ensurePointer } from "../src/agents-block"
import { renderAgentContract } from "../src/config-fix"
import { renderHelperBrief } from "../src/driver-helper"
import { ANALYSIS_DOC, reportForUserPath } from "../src/docpaths"
import { EOF_MARK } from "../src/doccheck"
import { completePhase, establishRound, readPhases, renderPhaseTodo, type PhaseUnit } from "../src/phases"
import { recordResolves } from "../src/resolve"
import { renderRoundBrief } from "../src/round-brief"
import { renderTaskIndex, renderTaskTodo } from "../src/tasks"
import { setSwitchModelRegistry } from "../src/switches"
import { git, freshRepo } from "./fixtures/runner"
import templateConfig from "../templates/opencode.json" with { type: "file" }

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// writeFileSync with parent creation — every fixture write goes through it.
function write(dir: string, rel: string, text: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), text)
}

// A phased fixture repo: initialized config, a git repo, everything the
// cases write committed (the clean-tree floor the start gates assume).
async function repo(phases = "mt"): Promise<string> {
  const dir = await freshRepo()
  made.push(dir)
  write(dir, ".opencode/auto/config.json", `{"phases": "${phases}"}\n`)
  write(dir, ".gitignore", ".auto/\ntmp/\n")
  return dir
}

const ANALYSIS = (lines: string[], clarified = false) =>
  [
    "# Project analysis",
    "",
    "## Analysis",
    "",
    "Two modules, one risk area.",
    "",
    "## Goals",
    "",
    "Ship the port with the protocol intact.",
    "",
    "## Project brief",
    "",
    "A faithful port.",
    "",
    "## Roadmap",
    "",
    ...lines,
    "",
    ...(clarified ? ["Clarified: yes"] : []),
    "",
  ].join("\n")

const FILLED_BRIEF = (round: number) =>
  renderRoundBrief(round).replace("## Goal", "## Goal\n\nPort the core; the journal deferred.").replace("## Close", "## Close\n\n- Everything restated into the target's own docs; nothing accepted as lost.")

// Establish the round and fill its brief, so the state under test is not the
// G1 window (the fill is the person's channel there, its own map row).
async function established(dir: string, phases: string): Promise<PhaseUnit[]> {
  await establishRound(dir, { phases, round: 1 })
  write(dir, "docs/R-01/round.md", FILLED_BRIEF(1))
  return (await readPhases(dir, 1))!.phases
}

// One task of a phase, ticked in the index and given its state file.
async function task(dir: string, phase: PhaseUnit, id: string, done: boolean, extra?: (taskDir: string) => void): Promise<void> {
  write(dir, join(phase.dir, "tasks.md"), `${renderTaskIndex("R-01.P01", [])}- [${done ? "x" : " "}] ${id} task ${id}\n`)
  write(dir, `docs/${id}/${done ? "done" : "todo"}.md`, `# ${id}: task ${id}\n\nPhase: R-01.P01\n\n## Goal\n\ng\n\n## Scope\n\ns\n\n## Acceptance\n\na\n\n<!-- auto: eof -->\n`)
  extra?.(join(dir, "docs", id))
}

// Complete every phase of round 1 (todo.md → done.md, the index ticked) plus
// the round-close needs — the shape-4 state transfer's roundOpen meets.
async function completeRound(dir: string, phases: string): Promise<void> {
  await established(dir, phases)
  const state = (await readPhases(dir, 1))!
  for (const unit of state.phases) {
    const todo = join(dir, unit.dir, "todo.md")
    if (!existsSync(todo)) writeFileSync(todo, renderPhaseTodo(unit))
    expect(await completePhase(dir, unit, [])).toEqual([])
  }
  write(dir, reportForUserPath(1), `# Round report\n\nThe round's account for the person.\n\n${EOF_MARK}\n`)
}

// The re-work bundle's survey type, as `init --intent` materializes it (the
// transfer suite's fixture).
const SURVEY_TYPE = ["# Survey", "", "Gate: human", "Phase-artifacts: survey.md", "", "## plan duties", "", "Inventory-level reading only.", "", "<!-- auto: eof -->", ""].join("\n")

// Every file under dir (relative paths, sorted) — the byte-identical pin's
// before/after snapshot.
function treeSnapshot(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    const entries = readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(child)
      else out.push(child)
    }
  }
  walk("")
  return out
}

describe("driver-helper: the map rows (plans/0105 D5)", () => {
  test("row 1 — the analysis flow: the awaiting lines verbatim, the analysis channel, recovery transfer", async () => {
    const dir = await repo()
    write(dir, ANALYSIS_DOC, ANALYSIS(["- R-01 mt — port the core"]))
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain(`⏸ the project analysis awaits you: review docs/analysis.md, then release it — opencode-auto clarify ${dir} writes the \`Clarified: yes\` line and commits it (or add the line and commit yourself)`)
    expect(lines).toContain(`then re-run: opencode-auto transfer ${dir} — the approved \`## Project brief\` proposal is installed and round R-01 opens`)
    expect(lines.some((line) => line.startsWith("ℹ a project brief is already on disk"))).toBe(false)
    // The order notice (plans/0133 D7): a brief on disk while the analysis is
    // unreleased — the aster-mig features shape — reads here the same way,
    // naming the replace-on-release rescue.
    write(dir, ".opencode/auto/brief.md", "Hand-authored constants.\n")
    const noticed = await renderHelperBrief(dir, { phases: "mt" })
    expect(noticed.some((line) => line.startsWith("ℹ a project brief is already on disk (.opencode/auto/brief.md); the analysis still comes first") && line.includes("replaces the whole brief on release"))).toBe(true)
    expect(lines.some((line) => line.startsWith("- docs/analysis.md — its sections"))).toBe(true)
    expect(lines).toContain(`- opencode-auto transfer ${dir}`)
    // The held variant: grammar problems hold the release, the held lines verbatim.
    write(dir, ANALYSIS_DOC, ["# no sections at all", "", "Clarified: yes", ""].join("\n"))
    const held = await renderHelperBrief(dir, { phases: "mt" })
    expect(held).toContain("⏸ docs/analysis.md has problems that hold its release:")
    // m mode keys the same rows on plan (the mode's advance command).
    const manual = await repo("m")
    write(manual, ANALYSIS_DOC, ANALYSIS(["- R-01 m — port the core"]))
    const mLines = await renderHelperBrief(manual, { phases: "m" })
    expect(mLines).toContain(`then re-run: opencode-auto plan ${manual} — the approved \`## Project brief\` proposal is installed and round R-01 opens`)
  })

  test("row 2 — the round-start gate: the round brief is the person's own writing (0107 D2), recovery transfer", async () => {
    const dir = await repo()
    await establishRound(dir, { phases: "mt", round: 1 })
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines.some((line) => line.startsWith("- docs/R-01/round.md — the round brief:"))).toBe(true)
    // 0107 D2: the channel states authorship — the person's own writing,
    // the pen discusses on request and never fills or commits it. The
    // former wording ("the person fills it and commits it") was read by
    // the field session as the pen's license.
    // 0115 D3's merge follow-up: the channel names the proposal path too —
    // the authorship clause, then the both-ways wording, then the pen rule.
    expect(lines.some((line) => line.includes("the person's own writing for the new round — they write it and commit it (the commit is the review act); the drafting can travel the released analysis instead"))).toBe(true)
    expect(lines.some((line) => line.includes("installs verbatim when the round opens — this hand-written file is the round's own when no proposal covers it; the pen discusses on request and never fills or commits it"))).toBe(true)
    expect(lines.some((line) => line.includes("the person fills it"))).toBe(false)
    expect(lines).toContain(`- opencode-auto transfer ${dir} — it constructs the plan task and stops for review`)
    // The pre-establishment rhythm (analysis released, R-01 not yet opened).
    const released = await repo()
    write(released, ANALYSIS_DOC, ANALYSIS(["- R-01 mt — port the core"], true))
    const pre = await renderHelperBrief(released, { phases: "mt" })
    expect(pre).toContain("✓ the project analysis is released; the next transfer installs the approved `## Project brief` proposal and opens round R-01 under the roadmap's line, stopping at the round-start gate")
    expect(pre).toContain(`- opencode-auto transfer ${released}`)
    // With the analysis switch off, the direct establishment rhythm names the
    // establish stop (OPENCODE_AUTO_ANALYSIS=off, the transfer suite's shape;
    // the switch layer is memoized, so the facts reset re-parses it).
    process.env.OPENCODE_AUTO_ANALYSIS = "off"
    try {
      setSwitchModelRegistry(undefined)
      const direct = await renderHelperBrief(released, { phases: "mt" })
      expect(direct.some((line) => line.startsWith(`- opencode-auto transfer ${released} — it establishes R-01`))).toBe(true)
    } finally {
      setSwitchModelRegistry(undefined)
      delete process.env.OPENCODE_AUTO_ANALYSIS
    }
  })

  test("row 3 — the formulation review stop: the awaiting todo, the plan-input channel, the reconstruct→dispatch→execute rhythm", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    write(
      dir,
      "docs/T-001/todo.md",
      renderTaskTodo({ id: "T-001", title: "Formulate the Implementation tasks", phase: "R-01.P01", formulate: "R-01.P01", decompose: "whole", depends: "none", goal: "g", scope: "s", acceptance: "a" }),
    )
    write(dir, join(phases[0]!.dir, "tasks.md"), `${renderTaskIndex("R-01.P01", [])}- [ ] T-001 Formulate the Implementation tasks\n`)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "review stop")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain("- the formulation task T-001 stands constructed and reviewed (docs/T-001/todo.md — driver-owned: fix its inputs, never the todo)")
    expect(lines.some((line) => line.startsWith("- docs/R-01/P01-implement/plan-input.md — the phase's planning input"))).toBe(true)
    expect(lines).toContain(`- opencode-auto transfer ${dir} — its idempotent reconstruct absorbs changed inputs and stops for review again`)
    expect(lines).toContain(`- opencode-auto plan ${dir} — dispatches the reviewed todo (the formulation session, the collect checks, the wrap-up)`)
    expect(lines).toContain(`- then: opencode-auto run ${dir}`)
  })

  test("row 4 — the human gate: logGateStop's own lines verbatim, the survey channel, the Recommend: defaults in POLICY", async () => {
    const dir = await repo("survey,implement")
    write(dir, ".opencode/auto/phases/survey.md", SURVEY_TYPE)
    await established(dir, "survey,implement")
    const survey = (await readPhases(dir, 1))!.phases[0]!
    await task(dir, survey, "T-001", true)
    write(dir, `${survey.dir}/survey.md`, ["# Survey", "", "The reference's map.", "", "Fork: scope — the journal too; Recommend: the core only.", "", EOF_MARK, ""].join("\n"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "survey held")
    const lines = await renderHelperBrief(dir, { phases: "survey,implement" })
    expect(lines).toContain("⏸ phase P01-survey Survey awaits your clarification:")
    expect(lines).toContain("  clarification: docs/R-01/P01-survey/survey.md records 1 open Fork: line(s) — awaiting the person (add `Clarified: yes` to release the phase; it accepts every line's `Recommend:` default, overrides go beside the lines)")
    expect(lines).toContain("  to release: review docs/R-01/P01-survey/survey.md, resolve the recorded forks — each carries a `Recommend:` default; `Clarified: yes` accepts them all (append your answers beside any line you override; the next phase's planning input is its `plan-input.md` — write it there; the next `transfer` construct reads it)")
    expect(lines.some((line) => line.startsWith("- docs/R-01/P01-survey/survey.md — resolve the recorded `Fork:` lines"))).toBe(true)
    expect(lines).toContain("Recorded defaults this state already carries: the held forks' `Recommend:` defaults — `Clarified: yes` accepts them all.")
    expect(lines).toContain(`- opencode-auto transfer ${dir}`)
  })

  test("row 5 — the phase boundary stop: run's own lines verbatim, the review channel and the next phase's plan-input ahead", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", true)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "phase done")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain("✓ phase boundary: P01-implement Implementation complete at a clean phase end — every unit closed, the lanes landed; run executes the planned work of the current phase and stops here (plans/0101 D1)")
    expect(lines).toContain(`next: opencode-auto transfer ${dir} — it distills the handover, closes the phase, and constructs the next phase's plan task for your review`)
    expect(lines.some((line) => line.startsWith("- review the completed phase — its task reports"))).toBe(true)
    expect(lines.some((line) => line.includes("ahead: docs/R-01/P02-test/plan-input.md may be written now (the next transfer's construct reads it)"))).toBe(true)
  })

  test("row 6 — the round-close gate held: the refusal lines verbatim, the ## Close channel, the transfer recovery", async () => {
    const dir = await repo()
    await completeRound(dir, "mt")
    // Unfill the close listing: the checks must hold the next round.
    write(dir, "docs/R-01/round.md", renderRoundBrief(1))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "unfill the close listing")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain("⏸ round R-01 does not pass its round-close checks, so round R-02 cannot open yet")
    expect(lines.some((line) => line.includes("close listing: docs/R-01/round.md `## Close` is empty"))).toBe(true)
    expect(lines.some((line) => line.startsWith("- docs/R-01/round.md — fill its `## Close` section: each restated decision named with where it landed"))).toBe(true)
    expect(lines).toContain(`- then: opencode-auto transfer ${dir}`)
    // 0109 D1/D5: the report's absence renders nothing at this stop — no
    // problem, no channel, no charter; the close listing is the work.
    expect(lines.some((line) => line.includes("round report:"))).toBe(false)
    expect(lines.some((line) => line.includes("report-for-user"))).toBe(false)
    expect(lines.some((line) => line.includes("Needs your attention"))).toBe(false)
    // 0106: the held close names its refuser, the ⚠ records ride under their
    // own lead, and STATE carries the glyph reading rule before the stop
    // lines — the proxy session's work list is the ✗ set alone.
    expect(lines).toContain("⚠ round close checks: transfer will refuse to open the next round until these are fixed")
    expect(lines).toContain("  recorded — not this stop's work; each ⚠ names its own moment (containment waits for release):")
    expect(lines).toContain("- reading the stop lines below: ✗ marks this stop's work; ⚠ marks a record — each names its own moment, never work for this stop")
    // 0107 D3: the `next:` reading rule rides beside the chained
    // instructions — the field session read "fix them … then re-run:
    // transfer" as its own work list and walked three further advances.
    expect(lines).toContain("- reading the stop lines below: a `next:` or `then re-run:` line names the person's act at the stop it printed — never this session's mandate to continue (ROLE's bound)")
    // A configured build is named as deliberately not run by the brief.
    const built = await renderHelperBrief(dir, { phases: "mt", build: "make check" })
    expect(built).toContain("ℹ this brief did not run the config build (`make check`) — the close gate runs it on the next opencode-auto transfer")
  })

  test("row 6 (0106, re-keyed by 0108, 0109 and 0103's second addendum) — the recorded containment count carries every family; the scanExempt fork rides the held close", async () => {
    const dir = await repo()
    await completeRound(dir, "mt")
    // Empty the close listing so the gate holds — the stop the channel rides
    // in — then plant findings inside a destination repository (plans/0108:
    // the workspace's own files are never scanned): a process-document
    // citation beside a task-id mention, both recorded now, the count the
    // only round-time record (plans/0109 D6; the process family joined by
    // 0103's second addendum).
    write(dir, "docs/R-01/round.md", renderRoundBrief(1).replace("## Goal", "## Goal\n\nPort the core; the journal deferred."))
    write(dir, "dest/notes.md", "wiring notes — the full record lives in docs/T-001.\n")
    write(dir, "dest/extra.c", "// the geometry slot (T-007 §2.2)\n")
    await git(join(dir, "dest"), "init", "-q")
    await git(join(dir, "dest"), "config", "user.email", "t@example.com")
    await git(join(dir, "dest"), "config", "user.name", "t")
    await git(join(dir, "dest"), "add", "-A")
    await git(join(dir, "dest"), "commit", "-qm", "destination\n\nAuto-Task: T-001\nAuto-Stage: implement")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "plant destination findings")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    // No process-reference ✗ line exists at round time — the blocking form
    // of "the destination must not reference process documents" is
    // release-time truth alone.
    expect(lines.some((line) => line.includes("process reference: dest/notes.md:1 references"))).toBe(false)
    expect(lines.some((line) => line.includes("must not reference process documents"))).toBe(false)
    expect(lines.some((line) => line.includes("close listing: docs/R-01/round.md `## Close` is empty"))).toBe(true)
    // The remediation fork rides the ledger, naming release as the moment.
    expect(lines.some((line) => line.startsWith("- recorded containment references — always inside a destination repository, enforced at release alone:"))).toBe(true)
    expect(lines.some((line) => line.includes(`opencode-auto amend ${dir} --scan-exempt <path> records the exemption in the config`))).toBe(true)
    // The record rides as one counted ⚠ line — both families in the figure —
    // byte-identical to the terminal's own round-close output.
    expect(lines).toContain(
      "  ⚠ containment: 2 reference(s) recorded for release (process-document references, task ids, paths outside a destination's own root) — restate what each anchored in place and remove the pointer when the destination ships, never delete the record it anchored; the release gate lists and enforces them",
    )
  })

  test("the standing decisions (plans/0109 D5) — the round's auto-answered questions and clamped grants surface as counts, never lists", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", true)
    await recordResolves(dir, [
      { at: 1, task: "T-001", phase: "R-01.P01", round: 1, source: "agent", question: "fold the third copy in?", option: "fold it in", reason: "same layer", file: "docs/T-001/report.md:4" },
      { at: 2, task: "T-001", phase: "R-01.P01", round: 1, source: "agent", question: "widen the wall?", option: "yes", reason: "the round wants it", clamped: true, clamp: "no (charter-consistent)" },
    ])
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    // The clamped grant is one of the round's resolves, so it counts in
    // both figures — the ⚑ summary's own filter, reused as-is.
    expect(lines).toContain('- ⚠ 2 question(s) this round were auto-answered and await the person\'s confirmation — each record sits in its task report\'s "Proxy-answered questions" section')
    expect(lines).toContain("- ⚠ 1 charter-clamped OPEN question(s) hold a narrower default in force — the wider grant waits for the person's ruling")
    expect(lines.some((line) => line.startsWith("Recorded defaults this state already carries: the round's 2 auto-answered question(s)"))).toBe(true)
    expect(lines.some((line) => line.includes("the 1 charter-clamped OPEN question(s)"))).toBe(true)
  })

  test("row 7 — roadmap-exhausted: transfer's own stop lines verbatim, the extend-the-document channel", async () => {
    const dir = await repo()
    write(dir, ANALYSIS_DOC, ANALYSIS(["- R-01 mt — port the core"], true))
    await completeRound(dir, "mt")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "round complete")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain("✓ round R-01 is closed, and the roadmap of docs/analysis.md holds no line for round R-02 — the planned work of the roadmap is done")
    expect(lines).toContain(`next: extend ## Roadmap of docs/analysis.md with the next round's line (\`- R-02 <phases> — <goal>\`, its phases value the round establishes under), commit, then re-run: opencode-auto transfer ${dir}`)
    expect(lines.some((line) => line.startsWith("- docs/analysis.md — extend its `## Roadmap`"))).toBe(true)
    expect(lines).toContain(`- opencode-auto transfer ${dir}`)
  })

  test("row 8 — a failed task: the gaps channel, the close/run --repair recovery", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", false, (taskDir) => writeFileSync(join(taskDir, "gaps.md"), "# Gaps\n\n- criterion 1 unmet\n"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "failed task")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines.some((line) => line.startsWith("- docs/T-001/gaps.md — the verification's gap list"))).toBe(true)
    expect(lines).toContain(`- opencode-auto close <T-NNN> ${dir} --reason "<text>" — accept the failed task (done for scheduling, never delivered)`)
    expect(lines).toContain(`- opencode-auto run ${dir} --repair <n> — bounded rework rounds over the report's evidence (the first FAIL blocks without it)`)
  })

  test("row 9 — a held blockage dossier: the Choice: channel, the next advance's executor", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", false)
    write(dir, "docs/R-01/blockage-1.md", "# Blockage 1\n\n## Remediation options\n\n- A: do the thing\n\nAwaiting your `Choice:` line.\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "dossier held")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines.some((line) => line.startsWith("- docs/R-01/blockage-1.md — the blockage dossier awaiting the person's decision"))).toBe(true)
    expect(lines.some((line) => line.includes("the next advance's remediation executor applies it"))).toBe(true)
    // A Choice'd document closes the channel (the mark's grammar: one
    // lettered option).
    write(dir, "docs/R-01/blockage-1.md", "# Blockage 1\n\nChoice: A\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "choice made")
    const answered = await renderHelperBrief(dir, { phases: "mt" })
    expect(answered.some((line) => line.startsWith("- docs/R-01/blockage-1.md"))).toBe(false)
  })

  test("row 10 — config findings: the fix channel with the amend key", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", false)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "state")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    // The bare fixture config carries the fixable drift (no agent contract,
    // no AGENTS.md block, no gitignore entries): the standing row renders.
    expect(lines.some((line) => line.startsWith("- ⚠ config findings:"))).toBe(true)
    expect(lines.some((line) => line.startsWith("- .opencode/auto/config.json and the config layer —"))).toBe(true)
  })

  test("row 10 — an info-only fix plan (a diverging covering line) renders no finding row (plans/0135; divergence-only 0136)", async () => {
    const dir = await repo()
    await established(dir, "mt")
    write(dir, ANALYSIS_DOC, ANALYSIS(["- R-01 mtv — port the core"], true))
    // The artifact-complete config layer: the divergence info note is all
    // that remains of planFix — a recorded posture, not a finding against
    // the layer, so the person-facing row stays quiet (a channel line here
    // would send the pen after the one key the design forbids amending).
    write(dir, ".opencode/agent/auto.md", await renderAgentContract(false))
    await ensurePointer(dir, { testByDriver: false })
    write(dir, "opencode.json", await Bun.file(templateConfig).text())
    write(dir, ".gitignore", ".auto/\ntmp/\n/.opencode/auto/models.json\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "covered round")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines.some((line) => line.startsWith("- ⚠ config findings:"))).toBe(false)
    expect(lines.some((line) => line.startsWith("- .opencode/auto/config.json and the config layer —"))).toBe(false)
  })

  test("row 11 — the dirty tree at a start gate; quiet at the round-start gate where the uncommitted setup is the design", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", false)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "state")
    writeFileSync(join(dir, "notes.md"), "uncommitted person file\n")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain("- ⚠ the worktree holds uncommitted changes — a start gate refuses them (driver-exclusive leftovers self-heal)")
    expect(lines.some((line) => line.startsWith("- the worktree — commit or clean"))).toBe(true)
    // The G1 window: the same dirt is the person's pending review, not a block.
    const g1 = await repo()
    await establishRound(g1, { phases: "mt", round: 1 })
    const g1Lines = await renderHelperBrief(g1, { phases: "mt" })
    expect(g1Lines.some((line) => line.startsWith("⚠ the worktree holds uncommitted"))).toBe(false)
  })

  test("row 12 — the destination's release channel rides wherever a nested repository exists", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", false)
    const dest = join(dir, "dest")
    mkdirSync(dest)
    await git(dest, "init", "-q")
    await git(dest, "config", "user.email", "t@t")
    await git(dest, "config", "user.name", "t")
    writeFileSync(join(dest, "README.md"), "the destination\n")
    await git(dest, "add", "-A")
    await git(dest, "commit", "-qm", "readme")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "state")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines.some((line) => line.startsWith("- dest — the destination repository: containment findings"))).toBe(true)
    expect(lines).toContain(`- opencode-auto release ${dir} — certifies the destination standing alone (exit 2 while findings remain)`)
    // 0106: the containment channel carries the restatement how — never
    // delete the record the id anchored.
    expect(lines.some((line) => line.includes("never delete the record it anchored (a bad reference beats a lost one)"))).toBe(true)
  })

  test("row 13 — nothing to advance: transfer's refusal line verbatim, no channels, recovery run", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", false)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "state")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain(`⏸ nothing to advance: R-01.P01 implement still holds 1 pending task(s) — execute them first: opencode-auto run ${dir}; the boundary follows their completion`)
    expect(lines).toContain("- none — the next act is execution (`run` executes; the boundary follows)")
    expect(lines).toContain(`- opencode-auto run ${dir}`)
    // m mode keeps its own rhythm: plan's notice, run the recovery.
    const manual = await repo("m")
    await establishRound(manual, { phases: "m", round: 1 })
    const mLines = await renderHelperBrief(manual, { phases: "m" })
    expect(mLines.some((line) => line.startsWith("ℹ no tasks listed in docs/R-01/P01-implement/tasks.md yet"))).toBe(true)
    expect(mLines).toContain(`- opencode-auto plan ${manual} -p <text> | --file <path>`)
  })

  test("row 14 — a live run lock: reported in STATE, the wait channel first, never a refusal", async () => {
    const dir = await repo()
    // A live other-pid holder (a lock naming this process's own pid reads as
    // stale by design — a dead predecessor whose pid was reused).
    const sleeper = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(
        join(dir, ".auto/run.lock"),
        `${JSON.stringify({ pid: sleeper.pid, host: hostname(), command: "run", started: new Date().toISOString() })}\n`,
      )
      const lines = await renderHelperBrief(dir, { phases: "mt" })
      expect(lines.some((line) => line.startsWith("- run lock live: ▶ run in progress (pid "))).toBe(true)
      expect(lines.some((line) => line.startsWith("- none while the run holds the lock — wait for it to end"))).toBe(true)
    } finally {
      sleeper.kill()
      await sleeper.exited
    }
  })
})

describe("driver-helper: the blocks (plans/0105 D3)", () => {
  test("ROLE pins prompts/run.md as reference-not-role; PRIMER and POLICY render the guidance literals verbatim", async () => {
    const dir = await repo()
    write(dir, ANALYSIS_DOC, ANALYSIS(["- R-01 mt — port the core"]))
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    // The six blocks, in order.
    const headings = lines.filter((line) => line.startsWith("## "))
    expect(headings).toEqual(["## ROLE — the person's pen, never the driver", "## PRIMER — how the driver works", "## STATE — the live facts and this stop's own lines", "## CHANNELS — what the person's pen may touch here", "## POLICY", "## RECOVERY — the exact commands for this state"])
    const text = lines.join("\n")
    // The proxy pin: never the driver, the suite reference-not-role.
    expect(text).toContain("You never write implementation code, never launch or drive task sessions, and never take the manual-driver role of `prompts/run.md`: the manual prompt suite that may be installed in this directory is reference material for a person choosing to hand-drive, not your execution path.")
    // 0107 D1: the mandate bound — the person's instruction is the only
    // scope; a stop a command reaches is a report point, never a runway.
    expect(text).toContain("Your mandate is the person's instruction and nothing else.")
    expect(text).toContain("every stop a command reaches is your report point — report what the stop names and wait for the person")
    expect(text).toContain("The person re-renders this brief for the new stop: `opencode-auto driver-helper <dir>`.")
    // 0107 D2: the canonical bullet states authorship — never the pen's.
    expect(text).toContain("the round-start `docs/R-NN/round.md` brief the canonical one: the person's own writing and their own commit, never the pen's")
    expect(lines).toContain(GUIDANCE.DRIVER_PRIMER)
    expect(lines).toContain(GUIDANCE.ASSIST_RULE)
    expect(text).toContain("Everything beyond the person's instruction is stop-and-ask: enumerate what is unknown, ask the person, keep undecided points open — never invent the person's answer.")
    // The round report's needs-attention section rides POLICY when present.
    write(dir, reportForUserPath(1), `# Round report\n\n## Needs your attention\n\n- one open question\n\n${EOF_MARK}\n`)
    const withReport = await renderHelperBrief(dir, { phases: "mt" })
    expect(withReport).toContain("Recorded defaults this state already carries: the needs-attention section of docs/R-01/report-for-user.md — the round's provisional defaults and AUTO-RESOLVE decisions, each phrased by its project consequence.")
  })

  test("an uninitialized directory refuses (the install-prompts shape)", async () => {
    const dir = await freshRepo()
    made.push(dir)
    await expect(renderHelperBrief(dir, { phases: "mt" })).rejects.toThrow(/nothing to render: .* has no \.opencode\/auto\/config\.json/)
  })
})

describe("driver-helper: D4 — read-only, nothing parsed back (plans/0105 D4)", () => {
  test("the module imports no writer: no loop, no session-driving layer, no task pipeline", async () => {
    const source = await Bun.file(join(import.meta.dir, "../src/driver-helper.ts")).text()
    const imports = [...source.matchAll(/from "(\.\/[^"]+)"/g)].map((match) => match[1]!)
    const forbidden = ["./loop", "./loop-phase", "./loop-plan", "./loop-task", "./loop-preflight", "./runner", "./execute", "./exec-session", "./session", "./attempt", "./watch", "./artifact", "./blockage-diagnose", "./blockage-execute", "./task-add", "./work-order", "./land", "./close"]
    for (const module of imports) expect(forbidden).not.toContain(module)
  })

  test("a render leaves the target byte-identical — no file added, changed or removed, no .auto/ created", async () => {
    const dir = await repo()
    const phases = await established(dir, "mt")
    await task(dir, phases[0]!, "T-001", false)
    write(dir, "docs/R-01/blockage-1.md", "# Blockage 1\n\nAwaiting your `Choice:` line.\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "state")
    const before = treeSnapshot(dir)
    const statusBefore = await git(dir, "status", "--porcelain")
    await renderHelperBrief(dir, { phases: "mt" })
    expect(treeSnapshot(dir)).toEqual(before)
    expect(await git(dir, "status", "--porcelain")).toBe(statusBefore)
    expect(existsSync(join(dir, ".auto"))).toBe(false)
  })
})
