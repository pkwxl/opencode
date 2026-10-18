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
import { GUIDANCE } from "../src/agents-block"
import { renderHelperBrief } from "../src/driver-helper"
import { ANALYSIS_DOC, reportForUserPath } from "../src/docpaths"
import { EOF_MARK } from "../src/doccheck"
import { completePhase, establishRound, readPhases, renderPhaseTodo, type PhaseUnit } from "../src/phases"
import { renderRoundBrief } from "../src/round-brief"
import { renderTaskIndex, renderTaskTodo } from "../src/tasks"
import { setSwitchModelRegistry } from "../src/switches"
import { git, freshRepo } from "./fixtures/runner"

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
    expect(lines).toContain("⏸ the project analysis awaits you: review docs/analysis.md, then add the line `Clarified: yes` and commit")
    expect(lines).toContain(`then re-run: opencode-auto transfer ${dir} — the approved \`## Project brief\` proposal is installed and round R-01 opens`)
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

  test("row 2 — the round-start gate: the round brief is the channel, the commit the review act, recovery transfer", async () => {
    const dir = await repo()
    await establishRound(dir, { phases: "mt", round: 1 })
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines.some((line) => line.startsWith("- docs/R-01/round.md — the round brief:"))).toBe(true)
    expect(lines.some((line) => line.includes("the person fills it and commits it — the commit is the review act"))).toBe(true)
    expect(lines).toContain(`- opencode-auto transfer ${dir} — it constructs the plan task and stops for your review`)
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

  test("row 6 — the round-close gate held: the refusal lines verbatim, the ## Close channel, the run-then-transfer recovery", async () => {
    const dir = await repo()
    await completeRound(dir, "mt")
    // Unfill the close listing: the checks must hold the next round.
    write(dir, "docs/R-01/round.md", renderRoundBrief(1))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "unfill the close listing")
    const lines = await renderHelperBrief(dir, { phases: "mt" })
    expect(lines).toContain("⏸ round R-01 does not pass its round-close checks, so round R-02 cannot open yet")
    expect(lines.some((line) => line.includes("close listing: docs/R-01/round.md `## Close` is empty"))).toBe(true)
    expect(lines.some((line) => line.startsWith("- docs/R-01/round.md — fill its `## Close` section"))).toBe(true)
    expect(lines).toContain(`- opencode-auto run ${dir} — a missing report task is appended automatically`)
    expect(lines).toContain(`- then: opencode-auto transfer ${dir}`)
    // A configured build is named as deliberately not run by the brief.
    const built = await renderHelperBrief(dir, { phases: "mt", build: "make check" })
    expect(built).toContain("ℹ this brief did not run the config build (`make check`) — the close gate runs it on the next opencode-auto transfer")
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
    expect(lines).toContain(GUIDANCE.DRIVER_PRIMER)
    expect(lines).toContain(GUIDANCE.ASSIST_RULE)
    expect(text).toContain("Everything else is stop-and-ask: enumerate what is unknown, ask the person, keep undecided points open — never invent the person's answer.")
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
