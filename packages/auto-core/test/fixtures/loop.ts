// Loop harness (plans/0053 §8, A7): drives runPhaseLoop — the loop runAll
// hands control to once preflight is done — as a LoopCtx over the native fake
// agent (fixtures/agent.ts), on a real git repository so the commit boundary
// stays live (the planning input is committed on its own, plans/0053 D9; the
// unit clean gate, the unified commit and the close-out check all run). The
// fake agent's default turn writes the artifacts the collect checks look for
// (F14: no core test drives the loop with a real agent): a planning turn
// writes the phase's task index and task documents, a handover turn writes the
// four-section handover document; both then take the default turn, whose idle
// event settles the session. OPENCODE_AUTO_* environment is scrubbed around
// each run and console.log is captured, so the loop's switches (step pauses,
// strict resume, hibernation) default deterministically and its printed lines
// are assertable.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
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
    const round = /^docs\/(R-\d+)\//.exec(phaseDir)![1]!
    const id = /\/(P\d{2,})-/.exec(phaseDir)![1]!
    const qualified = `${round}.${id}`
    const task = padTask(nextTaskNumber(dir))
    mkdirSync(join(dir, "docs", task), { recursive: true })
    writeFileSync(join(dir, phaseDir, "tasks.md"), renderTaskIndex(qualified, [{ id: task, title: `task ${task}` }]))
    writeFileSync(join(dir, "docs", task, "todo.md"), taskDoc(task, qualified))
  }
  return undefined
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

export async function loopFixture(phases: string, agentOptions: FakeAgentOptions = {}): Promise<LoopFixture> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "setup")
  const agent = fakeAgent({ ...agentOptions, turn: agentOptions.turn ?? artifactTurns(dir) })
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
      const { planInput, ...rest } = opts
      const ctx: LoopCtx = {
        directory: dir,
        opts: { phases, ...rest },
        server: host,
        agentName: "auto",
        phases,
        manual: phases === "m",
        ran: 0,
        input: planInput,
      }
      return withQuietConsole(() => runPhaseLoop(ctx))
    },
  }
}
