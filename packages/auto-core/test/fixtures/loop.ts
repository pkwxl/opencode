// Repository harness over the native fake agent (fixtures/agent.ts), on a
// real git repository so the commit boundary stays live: the suites that
// drive session work directly use it, and the pull-path suites seed by hand
// the boundary states the task loop once walked to (donePhase,
// finishPhaseWork, landPhaseHandover). The loop this harness drove — the
// phase loop behind runAll — retired with plans/0314; its run() member and
// its scrub-and-capture wrapper went with it.
// The fake agent's default turn writes the artifacts the collect checks look for
// (F14: no core test drives a session with a real agent): a planning turn
// writes the phase's task index and task documents, a handover turn writes the
// four-section handover document; both then take the default turn, whose idle
// event settles the session. The append turns (§8, B6) do the same for the
// appending session: a good turn appends one index line with its task
// document, and a bad first turn edits an existing line and document so the
// collect's feedback retry and the snapshot reset are exercisable.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentMessage } from "../../src/agent/types"
import { EOF_MARK } from "../../src/doccheck"
import { readPhases, type PhaseUnit } from "../../src/phases"
import { renderTaskIndex } from "../../src/tasks"
import { fakeAgent, ev, type FakeAgent, type FakeAgentOptions, type TurnContext, type TurnScript } from "./agent"
import { freshRepo, git } from "./runner"

const PHASE_DIR = "docs/R-\\d+/P\\d{2,}-[a-z][a-z0-9-]*"

// The phase directory a planning or appending prompt names (its task index
// path); undefined when the prompt carries none.
export const promptPhaseDir = (text: string): string | undefined => new RegExp(`(${PHASE_DIR})/tasks\\.md`).exec(text)?.[1]

// The qualified phase id (R-NN.P<nn>) of a phase directory path.
export const phaseDirId = (phaseDir: string): string => {
  const round = /^docs\/(R-\d+)\//.exec(phaseDir)![1]!
  return `${round}.${/\/(P\d{2,})-/.exec(phaseDir)![1]!}`
}

const padTask = (n: number) => `T-${String(n).padStart(3, "0")}`

// A task document that passes the mandatory spec check (taskTodoSpec) and
// carries the phase field plannedTaskProblems requires.
export function taskDoc(id: string, phase: string, title = `task ${id}`): string {
  return [
    `# ${id}: ${title}`,
    `Phase: ${phase}`,
    "",
    "## Goal",
    "",
    `${title} delivered.`,
    "",
    "## Scope",
    "",
    "Self-contained: the modules to touch and the context needed to execute.",
    "",
    "## Acceptance",
    "",
    "The acceptance statements of this task hold.",
    "",
    EOF_MARK,
    "",
  ].join("\n")
}

// The first task number no docs/T-NNN directory uses yet (the former init
// shortcut's rule; numbering derives from the surviving files since
// plans/0150, so "highest on disk + 1" is the whole allocation).
function nextTaskNumber(dir: string): number {
  let max = 0
  for (const name of readdirSync(join(dir, "docs"))) {
    const m = /^T-(\d+)$/.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export function phaseHandover(phaseDir: string): string {
  return [
    `# Handover (${phaseDir})`,
    "",
    "## Key decisions",
    "",
    "- The fake agent distilled this phase.",
    "",
    "## Constraints and pitfalls",
    "",
    "- Nothing recorded.",
    "",
    "## Required reading for the next phase",
    "",
    "- This phase's directory holds the task units.",
    "",
    "## Artifact index",
    "",
    "- (none)",
    "",
  ].join("\n")
}

export async function landPhaseHandover(fixture: LoopFixture, phase: PhaseUnit): Promise<void> {
  await Bun.write(join(fixture.dir, phase.dir, "handover.md"), phaseHandover(phase.dir))
  await fixture.commit("distill phase handover")
}

// A phase whose work is done the way the task loop left it at a clean phase
// end (plans/0314: the loop retired, the boundary's suites seed its state):
// every row of the index ticked, each task's done.md on disk, the phase's own
// todo.md standing — the completion rename is the advance's. One commit.
export async function donePhase(fixture: LoopFixture, phase: PhaseUnit, ids: readonly string[], subject = "phase done"): Promise<void> {
  const qualified = phaseDirId(phase.dir)
  mkdirSync(join(fixture.dir, phase.dir), { recursive: true })
  writeFileSync(join(fixture.dir, phase.dir, "tasks.md"), renderTaskIndex(qualified, ids.map((id) => ({ id, title: `task ${id}`, done: true }))))
  for (const id of ids) {
    mkdirSync(join(fixture.dir, "docs", id), { recursive: true })
    writeFileSync(join(fixture.dir, "docs", id, "done.md"), taskDoc(id, qualified))
  }
  await fixture.commit(subject)
}

// Finish a phase's listed work in place over an index a construction wrote:
// every pending row of this phase ticked, each row's todo.md renamed done.md
// (its text unchanged) — the state the phase's executed tasks leave. One
// commit. Tasks the phase's index does not list are never touched.
export async function finishPhaseWork(fixture: LoopFixture, phase: PhaseUnit, subject = "phase work done"): Promise<void> {
  const index = join(fixture.dir, phase.dir, "tasks.md")
  const text = await Bun.file(index).text()
  const ids = [...text.matchAll(/^- \[[ x]\] (T-\d+) /gm)].map((match) => match[1]!)
  await Bun.write(index, text.replace(/^- \[ \] /gm, "- [x] "))
  for (const id of ids) {
    const todo = join(fixture.dir, "docs", id, "todo.md")
    if (existsSync(todo)) renameSync(todo, join(fixture.dir, "docs", id, "done.md"))
  }
  await fixture.commit(subject)
}

export const artifactTurns = (dir: string): TurnScript => (ctx: TurnContext) => {
  // The wrap-up verification session (plans/0083, every task unit since
  // plans/0095 — the formulation task included): a passing report in the
  // evidence form, the result line verbatim.
  if (ctx.text.includes("you are this task's verification session")) {
    const id = /docs\/(T-\d{3})\/report\.md/.exec(ctx.text)?.[1]
    if (id) {
      writeFileSync(
        join(dir, "docs", id, "report.md"),
        [`# Report (${id})`, "", "- every acceptance criterion: met (the fake agent inspected the unit's work).", "", "## Overall conclusion", "", "Done.", "", "Result: PASS", "", EOF_MARK, ""].join("\n"),
      )
    }
    return undefined
  }
  // The handover prompt opens with "You are the handover distiller"; the
  // formulation session's prompt (the whole-task wrapper around the todo)
  // carries the phase's task index path in the todo's protocol section. A
  // plan prompt also injects earlier phases' handover texts, so the
  // distiller marker is checked first.
  if (ctx.text.includes("You are the handover distiller")) {
    const m = new RegExp(`(${PHASE_DIR})/handover\\.md`).exec(ctx.text)
    if (m) {
      mkdirSync(join(dir, m[1]!), { recursive: true })
      writeFileSync(join(dir, m[1]!, "handover.md"), phaseHandover(m[1]!))
    }
    return undefined
  }
  const index = new RegExp(`(${PHASE_DIR})/tasks\\.md`).exec(ctx.text)
  if (index) {
    const phaseDir = index[1]!
    const task = padTask(nextTaskNumber(dir))
    mkdirSync(join(dir, "docs", task), { recursive: true })
    writeFileSync(join(dir, "docs", task, "todo.md"), taskDoc(task, phaseDirId(phaseDir)))
    // plans/0095: the formulation task's line is already the index's first
    // line (the driver's construction commit) — the planned tasks append
    // after it, the index itself is never rewritten.
    const file = join(dir, phaseDir, "tasks.md")
    const current = existsSync(file) ? readFileSync(file, "utf8") : renderTaskIndex(phaseDirId(phaseDir), [])
    const line = `- [ ] ${task} task ${task}`
    writeFileSync(file, current.endsWith("\n") ? `${current}${line}\n` : `${current}\n${line}\n`)
    // plans/0097 D7: a synthesized formulation prompt carries an obligations
    // ledger — the fake planner writes the coverage map beside its task,
    // every ledger row mapped to the one task it wrote (O rows) or recorded
    // (C rows), the totality check's happy path.
    const ledgerAt = ctx.text.indexOf("## Obligations ledger")
    if (ledgerAt >= 0) {
      const ownId = /# (T-\d+): Formulate /.exec(ctx.text)?.[1]
      if (ownId) {
        const section = ctx.text.slice(ledgerAt)
        const rows = [...section.matchAll(/^- ((?:O|C)-\d+) \|/gm)].map((m) => m[1]!)
        mkdirSync(join(dir, "docs", ownId), { recursive: true })
        writeFileSync(
          join(dir, "docs", ownId, "coverage.md"),
          [
            `# Coverage (${ownId})`,
            "",
            ...rows.map((row) => (row.startsWith("O-") ? `- ${row} -> ${task} (the fake agent's planned task)` : `- ${row} -> conflict-recorded (the fake agent's plan records it)`)),
            "",
          ].join("\n"),
        )
      }
    }
  }
  return undefined
}

export function appendOneTask(dir: string, phaseDir: string): string {
  const file = join(dir, phaseDir, "tasks.md")
  const task = padTask(nextTaskNumber(dir))
  const line = `- [ ] ${task} task ${task}`
  // The existing text stays byte-identical: the new line goes after its last
  // line, in front of the final newline.
  const text = readFileSync(file, "utf8")
  writeFileSync(file, `${text.endsWith("\n") ? text.slice(0, -1) : text}\n${line}\n`)
  mkdirSync(join(dir, "docs", task), { recursive: true })
  writeFileSync(join(dir, "docs", task, "todo.md"), taskDoc(task, phaseDirId(phaseDir)))
  return task
}

// A completed past assistant message with real context usage, so a session id
// seeded into the fake agent's history counts as alive and reusable (the
// resume checks of the session-driving layer).
export const pastMessage = (session: string, contextUsed = 500): AgentMessage => ({
  id: `${session}_seed`,
  role: "assistant",
  completed: true,
  model: "fake/model-1",
  failed: false,
  contextUsed,
})

export type LoopFixture = {
  dir: string
  agent: FakeAgent
  phases: string
  // The round's phase by index order (readPhases).
  phase: (index: number) => Promise<PhaseUnit>
  // git -C <dir> ...
  git: (...args: string[]) => Promise<string>
  // Stage and commit everything (round setup, seeded tasks).
  commit: (subject: string) => Promise<void>
}

// agentOptions may be a factory over the fixture directory, so a turn script
// that writes into the repository (artifact turns) can be built before
// the agent exists.
export async function loopFixture(
  phases: string,
  agentOptions: FakeAgentOptions | ((dir: string) => FakeAgentOptions) = {},
): Promise<LoopFixture> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "setup")
  const options = typeof agentOptions === "function" ? agentOptions(dir) : agentOptions
  const agent = fakeAgent({ ...options, turn: options.turn ?? artifactTurns(dir) })
  return {
    dir,
    agent,
    phases,
    phase: async (index) => (await readPhases(dir))!.phases[index]!,
    git: (...args) => git(dir, ...args),
    commit: async (subject) => {
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", subject)
    },
  }
}
