// The io/Interactive seam (T-093, P3a of the headless direction, auto-core
// plans/0067 §四): RunAllOpts.interactive accepts an injected Interactive
// implementation or an io { input, output } factory beside today's boolean,
// and an injected implementation receives every human-interaction route the
// run owns as typed calls — askHuman's wait (session-api, both flavors: a
// --wait-answer question and plan's no-timeout humanQuestions question), the
// between-tasks pause (loop-progress), the per-session attach — never prompt
// prose to parse (the anti-scraping criterion: without the seam, the only
// worker-to-daemon bridging would be scraping the sideband's text, which the
// direction draft forbids; P3b's transport injects through exactly this
// seam). Cases, end to end through runAll:
//   - over the fake `claude` CLI (test/fixtures/fake-claude.ts, the fixture
//     family's copy): a two-task run with --wait-between pauses between the
//     tasks through the injected implementation; the answer continues the
//     run; the loop's finally closes the implementation;
//   - in-process over the native fake agent: a --wait-answer question and a
//     plan-mode humanQuestions question both wait through askHuman into the
//     injected implementation (the exact prompt text and the minutes ride
//     the typed call; plan's carries minutes undefined — the timer-arms-
//     only-with-minutes semantics preserved);
//   - an io factory: the terminal sideband is built over the caller's
//     streams (the boolean path's own code with the boolean path's banner),
//     and a question's answer arrives on the injected input line.
// The boolean path itself stays byte-identical by construction (loop.ts
// passes io undefined exactly as before, the same banner after the same
// call); it cannot be driven in-process (it would take the test process's
// own stdin), so its guard is the untouched goldens plus the existing
// interactive suite.
import { describe, expect, spyOn, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { PassThrough, Writable } from "node:stream"
import { createClaudeHost } from "../src/agent/claude/host"
import type { AgentHost } from "../src/agent/types"
import { renderAgentContract } from "../src/config-fix"
import type { Interactive } from "../src/control-types"
import { EOF_MARK } from "../src/doccheck"
import { runAll } from "../src/loop"
import { establishRound } from "../src/phases"
import { autoSwitches, setSwitchModelRegistry } from "../src/switches"
import { defaultTurn, ev, fakeAgent, type TurnScript } from "./fixtures/agent"
import { artifactTurns, promptPhaseDir } from "./fixtures/loop"
import { freshRepo, git } from "./fixtures/runner"
import { seedUnits } from "./fixtures/units"

// The wrap-up report the wrap-up gate reads (run-status.test.ts's REPORT:
// non-trivial above the stub threshold, terminator, PASS verdict).
const REPORT = [
  "# T-001 report",
  "",
  "The widget was built and read back. The session wrote the widget module, exercised it against the fake agent's scripted turn, and confirmed the read-back path works end to end without touching anything outside the task's declared scope.",
  "",
  "Result: PASS",
  "",
  EOF_MARK,
  "",
].join("\n")

// The lead's first turn raises one question beside the default settle; the
// wrap-up prompt names the report path and the turn writes the report the
// wrap-up gate reads.
const questionTurn = (dir: string): TurnScript => (ctx) => {
  if (ctx.text.includes("docs/T-001/report.md")) {
    writeFileSync(join(dir, "docs", "T-001", "report.md"), REPORT)
    return undefined
  }
  if (ctx.n === 1) return [ev.question(ctx.session, "req_widget", "Which storage should the widget use?"), ...defaultTurn(ctx)]
  return undefined
}

// —— the recording Interactive double ——

type Asked = { promptText: string; minutes: number | undefined }

// The injected implementation under test: every human-interaction route lands
// as a typed call recorded here, so the assertions read the calls themselves.
// `answer` decides each question's answer from the recorded call ("" is a
// deliberate answer — the between-tasks pause reads it as the confirm).
function recordingInteractive(answer: (ask: Asked) => string) {
  const asked: Asked[] = []
  const attached: string[] = []
  let closed = 0
  const impl: Interactive = {
    attach: (sessionID) => {
      attached.push(sessionID)
    },
    question: (promptText, minutes) => {
      asked.push({ promptText, minutes })
      return Promise.resolve(answer({ promptText, minutes }))
    },
    close: () => {
      closed++
    },
  }
  return { impl, asked, attached, closes: () => closed }
}

// —— shared fixture and harness ——

// A committed one-task (or two-task) project in m mode (the run-status e2e's
// fixture shape): the seeded units, the rendered agent contract preflight
// compares against, and the ignore set the start-clean gate needs.
async function widgetProject(tasks = 1): Promise<string> {
  const dir = await freshRepo()
  const notation =
    tasks === 2
      ? "## T-001: the widget [pending]\nBuild the widget.\n\n## T-002: the second widget [pending]\nBuild the second widget.\n"
      : "## T-001: the widget [pending]\nBuild the widget.\n"
  await seedUnits(dir, notation)
  await Bun.write(join(dir, ".opencode", "agent", "auto.md"), await renderAgentContract(false))
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "baseline")
  return dir
}

// The native fake agent's host (the run-status e2e's shape): a managed host,
// so the run starts no adapter of its own.
const hostOf = (agent: ReturnType<typeof fakeAgent>): AgentHost => ({
  client: agent.client,
  syncContext: async () => {},
  restart: async () => false,
  close: () => {},
})

// Scrub the ambient OPENCODE_AUTO_* layer around a run and capture the
// terminal (the fixtures/loop.ts convention; the deliverables doc's
// driver-environment rule).
async function withQuietConsole(run: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const saved = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key))
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
    // The run froze the switch snapshot at its fleet start (the run's own
    // invariant): re-parse so a later clamp in this process does not throw —
    // the documented reset (test/services.test.ts's frozen-snapshot pair).
    setSwitchModelRegistry(undefined)
    autoSwitches()
  }
}

// —— the acceptance e2e: the injected Interactive over the fake claude CLI ——

// The fake `claude` wrapper at an absolute path (the packages/auto and
// auto-server e2e convention). Bun.spawn resolves a bare `claude` against the
// process-start PATH, so a test-time PATH prepend never reaches the adapter's
// own spawns; createClaudeHost's bin option (the adapter's test seam) carries
// the absolute path instead, and the sessions run the fake CLI end to end.
async function fakeClaudeBin(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "auto-core-claude-"))
  const bin = join(dir, "claude")
  await Bun.write(bin, `#!/bin/sh\nexec bun ${JSON.stringify(join(import.meta.dir, "fixtures", "fake-claude.ts"))} "$@"\n`)
  await chmod(bin, 0o755)
  return bin
}

describe("the io/Interactive seam, end to end over the fake claude CLI", () => {
  test("an injected Interactive receives the between-tasks pause as a typed call, the answer continues the run, close settles at the end", async () => {
    const dir = await widgetProject(2)
    const bin = await fakeClaudeBin()
    let host: AgentHost | undefined
    try {
      const startup: string[] = []
      host = await createClaudeHost({ bin })(dir, { permission: "deny", log: (line) => startup.push(line) })
      // The pause's empty answer is the confirm (waitBetween's original
      // semantics): the run continues into T-002 at once.
      const io = recordingInteractive(() => "")
      const { code, lines } = await withQuietConsole(() => runAll(dir, { agent: "claude", managed: host, waitBetween: 1, interactive: io.impl }))
      expect(code, [...startup, ...lines].join("\n")).toBe(0)

      // Exactly one question reached the injected implementation — the
      // between-tasks pause (the claude adapter raises no agent questions),
      // with the prompt text waitBetween renders and the run's minutes as
      // typed call arguments, never prose the test parses back.
      expect(io.asked).toEqual([{ promptText: "⏸ pause between tasks: press Enter to start T-002 now, or wait 1m to auto-continue: ", minutes: 1 }])
      expect(lines).toContain("→ confirmed, continuing T-002")

      // The run itself completed around the pause: both tasks closed on the
      // commit boundary and the tree is left clean.
      expect(existsSync(join(dir, "docs", "T-001", "done.md"))).toBe(true)
      expect(existsSync(join(dir, "docs", "T-002", "done.md"))).toBe(true)
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")

      // The run attached its sessions to the injected channel as they were
      // created/reused (the sideband's attach route), and the loop's finally
      // closed the implementation exactly once.
      expect(io.attached.length).toBeGreaterThanOrEqual(2)
      expect(io.closes()).toBe(1)

      // No terminal sideband was built beside the injected implementation:
      // the 💬 banner is the sideband shapes' own.
      expect(lines.some((line) => line.includes("interactive mode:"))).toBe(false)
    } finally {
      // A managed host's lifecycle belongs to the caller (the run never
      // closes it): kill whatever still runs here.
      host?.close()
      await rm(dirname(bin), { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)
})

// —— the askHuman route, in-process over the native fake agent ——

describe("the io/Interactive seam: askHuman's wait routes to the injected implementation", () => {
  test("a --wait-answer question waits through askHuman into the implementation, and the answer resolves it", async () => {
    const dir = await widgetProject()
    const agent = fakeAgent({ turn: questionTurn(dir) })
    try {
      const io = recordingInteractive(() => "sqlite, the embedded one")
      const { code, lines } = await withQuietConsole(() => runAll(dir, { managed: hostOf(agent), waitAnswer: 5, interactive: io.impl }))
      expect(code, lines.join("\n")).toBe(0)

      // askHuman's exact rendering reached the injected implementation, with
      // the run's waitAnswer minutes riding the same typed call — the askHuman
      // path (session-api), not a sideband of the run's own.
      expect(io.asked).toEqual([{ promptText: "enter your answer within 5 minutes (Enter to confirm, auto-answered on timeout): ", minutes: 5 }])
      expect(lines).toContain("→ human answer: sqlite, the embedded one")
      // The answer was delivered to the session as the question's reply.
      expect(agent.argsOf("replyQuestion")).toContainEqual(["req_widget", [["sqlite, the embedded one"]]])
      expect(existsSync(join(dir, "docs", "T-001", "done.md"))).toBe(true)
      expect(io.attached.length).toBeGreaterThanOrEqual(1)
      expect(io.closes()).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)

  test("a planning-style question (plan's humanQuestions) waits with no timeout — minutes undefined on the typed call", async () => {
    const dir = await freshRepo()
    await establishRound(dir, { phases: "m" })
    await Bun.write(join(dir, ".opencode", "agent", "auto.md"), await renderAgentContract(false))
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "baseline")
    // The planning session writes the phase's task index (the loop fixture's
    // artifact turns) and raises one question — plan's sessions hand
    // non-permission questions to the human with no timeout and never
    // proxy-answer.
    const artifacts = artifactTurns(dir)
    let raised = false
    const turn: TurnScript = (ctx) => {
      artifacts(ctx)
      if (!raised && promptPhaseDir(ctx.text)) {
        raised = true
        return [ev.question(ctx.session, "req_plan", "Which modules should the first task own?"), ...defaultTurn(ctx)]
      }
      return undefined
    }
    const agent = fakeAgent({ turn })
    try {
      const io = recordingInteractive(() => "src/widget.ts only")
      const { code, lines } = await withQuietConsole(() =>
        runAll(dir, { managed: hostOf(agent), phases: "m", planInput: { text: "Port the widget." }, stopBefore: "execute", interactive: io.impl }),
      )
      expect(code, lines.join("\n")).toBe(0)

      // The humanQuestions flavor of askHuman: minutes undefined — the hard
      // wait whose timeout discipline belongs to the implementation (the
      // timer arms only when minutes is given, interactive.ts's preserved
      // semantics).
      expect(io.asked).toEqual([{ promptText: "enter your answer (Enter to confirm, no timeout and no automatic answer under plan): ", minutes: undefined }])
      expect(lines).toContain("→ human answer: src/widget.ts only")
      expect(agent.argsOf("replyQuestion")).toContainEqual(["req_plan", [["src/widget.ts only"]]])
      // The planning step itself completed and the run stopped at plan's own
      // boundary (m mode's summary line), exactly as without the seam.
      expect(lines).toContain("✓ phase planning complete: docs/R-01/P01-implement/tasks.md lists 1 task(s)")
      expect(lines).toContain("✓ planned 1 task(s) (T-001) into docs/R-01/P01-implement/tasks.md")
      expect(existsSync(join(dir, "docs", "R-01", "P01-implement", "tasks.md"))).toBe(true)
      expect(io.closes()).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

// —— the io factory: the terminal sideband over the caller's streams ——

describe("the io/Interactive seam: an io factory builds the terminal sideband over the caller's streams", () => {
  test("the boolean path's banner, the sideband's own prompts on the injected output, and a question's answer on the injected input line", async () => {
    const dir = await widgetProject()
    const agent = fakeAgent({ turn: questionTurn(dir) })
    const input = new PassThrough()
    const chunks: string[] = []
    const output = new Writable({
      write: (chunk, _enc, cb) => {
        chunks.push(String(chunk))
        cb()
      },
    })
    // The quiet-console discipline of withQuietConsole, opened manually so
    // the test can poll the captured lines while the run is still in flight.
    const saved = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key))
    for (const [key] of saved) delete process.env[key]
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    try {
      let code: number | undefined
      const run = runAll(dir, { managed: hostOf(agent), waitAnswer: 5, interactive: () => ({ input, output }) }).then((exit) => {
        code = exit
        return exit
      })
      // Wait for the ask to take the input line (the sideband logs the ask
      // prompt synchronously before arming the pending answer), then answer
      // over the injected input — the line resolves the waiting question
      // instead of steering the session.
      const deadline = Date.now() + 60_000
      while (!lines.some((line) => line.startsWith("enter your answer within 5 minutes"))) {
        if (code !== undefined) throw new Error(`the run ended (${code}) before the question took the injected input line:\n${lines.join("\n")}`)
        if (Date.now() > deadline) throw new Error(`the question never took the injected input line:\n${lines.join("\n")}`)
        await Bun.sleep(20)
      }
      input.write("over the injected io\n")
      expect(await run, lines.join("\n")).toBe(0)

      // The sideband shapes keep the boolean path's banner (loop.ts logs it
      // for the terminal and io shapes alike), and the sideband's own
      // prompts — the resident 💬 line and the ask's ❓ — went to the
      // injected output, not to the terminal.
      expect(lines.some((line) => line.includes("interactive mode: Enter sends your input"))).toBe(true)
      const drawn = chunks.join("")
      expect(drawn).toContain("💬")
      expect(drawn).toContain("❓")
      // The answer written to the injected input line settled the question
      // as the human's answer, and the run completed around it.
      expect(lines).toContain("→ human answer: over the injected io")
      expect(agent.argsOf("replyQuestion")).toContainEqual(["req_widget", [["over the injected io"]]])
      expect(existsSync(join(dir, "docs", "T-001", "done.md"))).toBe(true)
    } finally {
      printed.mockRestore()
      for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
      setSwitchModelRegistry(undefined)
      autoSwitches()
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
