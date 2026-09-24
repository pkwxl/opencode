// Loop harness (plans/0053 §8, A7): drives runPhaseLoop — the loop runAll
// hands control to once preflight is done — as a LoopCtx over the native fake
// agent (fixtures/agent.ts), on a real git repository so the commit boundary
// stays live (the planning input is committed on its own, plans/0053 D9; the
// unit clean gate, the unified commit and the close-out check all run). The
// fake agent's default turn writes the artifacts the collect checks look for
// (F14: no core test drives the loop with a real agent): a planning turn
// writes the phase's task index and task documents, a handover turn writes the
// four-section handover document; both then take the default turn, whose idle
// event settles the session. The append turns (§8, B6) do the same for the
// appending session: a good turn appends one index line with its task
// document, and a bad first turn edits an existing line and document so the
// collect's feedback retry and the snapshot reset are exercisable.
// OPENCODE_AUTO_* environment is scrubbed around each run and console.log is
// captured, so the loop's switches (step pauses, strict resume, hibernation)
// default deterministically and its printed lines are assertable.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spyOn } from "bun:test"
import type { AgentHost, AgentMessage } from "../../src/agent/types"
import { EOF_MARK } from "../../src/doccheck"
import { runPhaseLoop } from "../../src/loop-phase"
import type { RunAllOpts } from "../../src/loop-preflight"
import type { LoopCtx } from "../../src/loop-task"
import { readPhases, type PhaseUnit } from "../../src/phases"
import { renderTaskIndex } from "../../src/tasks"
import { fakeAgent, type FakeAgent, type FakeAgentOptions, type TurnContext, type TurnScript } from "./agent"
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
// shortcut's rule; with the numbering record the driver checks this start
// against .auto/next-task, which the driver itself advances past the written
// ids, so "highest on disk + 1" stays valid in every harness scenario).
function nextTaskNumber(dir: string): number {
  let max = 0
  for (const name of readdirSync(join(dir, "docs"))) {
    const m = /^T-(\d+)$/.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export const artifactTurns = (dir: string): TurnScript => (ctx: TurnContext) => {
  // The handover prompt opens with "You are the handover distiller"; the
  // planning prompts (phase-plan and implement-plan alike) carry the phase's
  // task index path. A plan prompt also injects earlier phases' handover
  // texts, so the distiller marker is checked first.
  if (ctx.text.includes("You are the handover distiller")) {
    const m = new RegExp(`(${PHASE_DIR})/handover\\.md`).exec(ctx.text)
    if (m) {
      mkdirSync(join(dir, m[1]), { recursive: true })
      writeFileSync(
        join(dir, m[1], "handover.md"),
        [
          `# Handover (${m[1]})`,
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
        ].join("\n"),
      )
    }
    return undefined
  }
  const index = new RegExp(`(${PHASE_DIR})/tasks\\.md`).exec(ctx.text)
  if (index) {
    const phaseDir = index[1]!
    const task = padTask(nextTaskNumber(dir))
    mkdirSync(join(dir, "docs", task), { recursive: true })
    writeFileSync(join(dir, phaseDir, "tasks.md"), renderTaskIndex(phaseDirId(phaseDir), [{ id: task, title: `task ${task}` }]))
    writeFileSync(join(dir, "docs", task, "todo.md"), taskDoc(task, phaseDirId(phaseDir)))
  }
  return undefined
}

// —— Append turns (plans/0053 §8, B6) ——
// The appending prompt is told apart from the fresh planning prompts by its
// unique "the task index as it stands" heading: both name the phase's task
// index, but only the append session is shown the index it must build on.

const APPEND_MARK = "## Input: the task index as it stands"

// One accepted append: a single new line goes after the index's last line and
// the new task's document is written — nothing else is touched (D24's
// contract). The new number is the highest on disk + 1 (the append prompt's
// fallback start without the numbering record).
export const appendTurn = (dir: string): TurnScript => (ctx: TurnContext) => {
  if (!ctx.text.includes(APPEND_MARK)) return undefined
  const phaseDir = promptPhaseDir(ctx.text)
  if (phaseDir) appendOneTask(dir, phaseDir)
  return undefined
}

function appendOneTask(dir: string, phaseDir: string): string {
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

// A first appending session that misbehaves (plans/0053 §8, "a session that
// edits an existing line"): it renames the first existing index line, edits
// the last existing task's document and leaves a stray file next to the new
// task's document. The collect refuses (the edited line and the changed
// document are exactly what D24's prefix and file-identity checks look for),
// the retry requirement carries the problems, and the reset must restore the
// snapshot — index text, existing files, the stray directory — before the
// retry turn, which then appends cleanly (the good turn above).
export const badAppendTurns = (dir: string): TurnScript => {
  let misbehaved = false
  return (ctx: TurnContext) => {
    if (!ctx.text.includes(APPEND_MARK)) return undefined
    if (misbehaved) {
      const phaseDir = promptPhaseDir(ctx.text)
      if (phaseDir) appendOneTask(dir, phaseDir)
      return undefined
    }
    misbehaved = true
    const phaseDir = promptPhaseDir(ctx.text)
    if (!phaseDir) return undefined
    const index = readFileSync(join(dir, phaseDir, "tasks.md"), "utf8")
    const lines = index.split("\n")
    // Rename the first task line while appending the new one.
    const first = lines.findIndex((line) => /^- \[.\] T-\d{3} /.test(line))
    if (first >= 0) lines[first] = lines[first]!.replace(/^(- \[.\] T-\d{3}) .*$/, "$1 renamed by the session")
    const file = join(dir, phaseDir, "tasks.md")
    const task = padTask(nextTaskNumber(dir))
    writeFileSync(file, `${lines.join("\n").slice(0, -1)}\n- [ ] ${task} task ${task}\n`)
    // The new task's directory: a valid document plus a stray file the reset
    // must remove with it.
    mkdirSync(join(dir, "docs", task), { recursive: true })
    writeFileSync(join(dir, "docs", task, "todo.md"), taskDoc(task, phaseDirId(phaseDir)))
    writeFileSync(join(dir, "docs", task, "stray.md"), "left by the failed attempt\n")
    // Edit the last existing task's pending document.
    const listed = [...index.matchAll(/^- \[.\] (T-\d{3}) /gm)].map((m) => m[1]!)
    const last = listed[listed.length - 1]
    const doc = last ? join(dir, "docs", last, "todo.md") : undefined
    if (doc && existsSync(doc)) writeFileSync(doc, readFileSync(doc, "utf8").replace("## Goal", "## 目标"))
    return undefined
  }
}

// A completed past assistant message with real context usage, so a session id
// seeded into the fake agent's history counts as alive and reusable (the
// resume check in src/artifact.ts).
export const pastMessage = (session: string, contextUsed = 500): AgentMessage => ({
  id: `${session}_seed`,
  role: "assistant",
  completed: true,
  model: "fake/model-1",
  failed: false,
  contextUsed,
})

export type LoopRunResult = { code: number; lines: string[] }

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
  // One pass of the phase loop, as run would drive it (planInput rides the
  // ctx, not the opts; opts.stopBefore is plan's stop condition).
  run: (opts?: Partial<RunAllOpts>) => Promise<LoopRunResult>
}

const OPENCODE_AUTO = /^OPENCODE_AUTO_/

async function withQuietConsole(run: () => Promise<number>): Promise<LoopRunResult> {
  const saved = Object.entries(process.env).filter(([key]) => OPENCODE_AUTO.test(key))
  for (const [key] of saved) delete process.env[key]
  const lines: string[] = []
  const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "))
  })
  try {
    return { code: await run(), lines }
  } finally {
    printed.mockRestore()
    for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
  }
}

// agentOptions may be a factory over the fixture directory, so a turn script
// that writes into the repository (appendTurn and friends) can be built before
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
  const host: AgentHost = { client: agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
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
    async run(opts = {}) {
      const { planInput, append, ...rest } = opts
      const ctx: LoopCtx = {
        directory: dir,
        opts: { phases, ...rest },
        server: host,
        agentName: "auto",
        phases,
        manual: phases === "m",
        ran: 0,
        input: planInput,
        // plan --append rides the ctx (loop.ts seeds it from RunAllOpts).
        ...(append ? { append: true } : {}),
      }
      return withQuietConsole(() => runPhaseLoop(ctx))
    },
  }
}
