// The task verification loop (plans/0083, M1): verify → gaps.md → fix →
// re-verify from scratch, the constant two-round budget, the shape gates,
// the resume round preservation and the --no-wrapup floor — driven end to
// end over the native fake agent on real git repositories (the loop fixture
// for the phase loop, the scripted per-session client for runTask's own
// tail). The FAIL-verdict-blocks-and-repairs family (the ladder past the
// budget) lives in repair-loop.test.ts; the report shape gate's PASS side
// predates 0083 and stays in auto-doc-shape.test.ts.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { EOF_MARK } from "../src/doccheck"
import { unitBaseline } from "../src/git"
import { saveProgress, recallProgress } from "../src/resume"
import { runTask } from "../src/runner"
import { setSplit } from "../src/tasks"
import { runWrapup } from "../src/wrapup"
import { establishRound } from "../src/phases"
import { loopFixture, artifactTurns, type LoopFixture } from "./fixtures/loop"
import { reloadUnits, seedUnits } from "./fixtures/units"
import { fakeClient, freshRepo, git } from "./fixtures/runner"
import type { Opts } from "../src/opts"
import type { SessionChain } from "../src/chain"
import type { FakeAgentOptions, TurnScript } from "./fixtures/agent"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

const promptText = (prompt: unknown): string => {
  const parts = (prompt as { parts?: Array<{ type: string; text?: string }> }).parts ?? []
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("")
}

// Per-round session stand-in (incident-regression's shape): round n consumes
// scripts[n-1], repeating the last once exhausted; then an idle ends it.
function scriptedClient(scripts: Array<() => Promise<unknown>>) {
  let round = 0
  return fakeClient({
    events: (sid) =>
      (async function* () {
        const script = scripts[Math.min(round++, scripts.length - 1)]
        if (script) await script()
        yield { type: "session.idle", properties: { sessionID: sid } }
      })(),
  })
}

// A FAIL gap list (0083 D3's form: verified-OK summary, one entry per gap,
// the closing result line, no terminator).
const gapListText = (id: string, reason = "the acceptance gap stands") =>
  [
    `# Gaps (${id})`,
    "",
    "## Verified OK",
    "",
    "- The wrap-up session inspected the work against the task's acceptance statements.",
    "",
    "## Gaps",
    "",
    `- ${reason} (src/widget.ts): do what the acceptance asks.`,
    "",
    `Result: FAIL ${reason}`,
    "",
  ].join("\n")

// A PASS evidence report (the report shape gate's own fixture).
const filler = "Verification evidence line. ".repeat(20)
const passReport = `# Report\n\n${filler}\n\nResult: PASS\n\n${EOF_MARK}\n`

describe("the verification loop (0083 D1–D7)", () => {
  // The loop fixture's turn script: the whole-task session writes source,
  // the first verify session FAILs (the gap list), the fix session closes
  // it, the re-verification passes.
  const fixableTurns = (dir: string): TurnScript => {
    let wrapups = 0
    return (ctx) => {
      if (ctx.text.includes("You are the fix session")) {
        writeFileSync(join(dir, "FIXES.md"), `fix round ${wrapups}\n`)
        return undefined
      }
      if (ctx.text.includes("only performs the wrap-up")) {
        wrapups++
        mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
        writeFileSync(join(dir, "docs", "T-001", wrapups === 1 ? "gaps.md" : "report.md"), wrapups === 1 ? gapListText("T-001") : passReport)
        return undefined
      }
      if (ctx.text.includes("You are responsible for the whole task")) {
        writeFileSync(join(dir, "src.ts"), "// the work\nexport const x = 1\n")
        return undefined
      }
      return artifactTurns(dir)(ctx)
    }
  }

  test("FAIL → fix → re-verify from scratch → PASS completes: the fix commit, the deleted gap list, the evidence report", async () => {
    const f = await loopFixture("m", (dir): FakeAgentOptions => ({ turn: fixableTurns(dir) }))
    made.push(f)
    await establishRound(f.dir, { phases: "m" })
    await f.commit("round setup")
    const { code } = await f.run({ planInput: { text: "migrate the widget" } })
    expect(code).toBe(0)
    // The fix round committed with the execute stage and the round's subject.
    const bodies = (await f.git("log", "--format=%B%n---")).split("---")
    expect(bodies.some((body) => body.includes("Auto-Stage: execute") && body.includes("T-001 fix 1"))).toBe(true)
    // The gap list is transient: deleted at the PASS close-out (the deletion
    // landed in the wrap-up commit), the evidence report stands.
    expect(existsSync(join(f.dir, "docs/T-001/gaps.md"))).toBe(false)
    const report = await Bun.file(join(f.dir, "docs/T-001/report.md")).text()
    expect(report).toContain("Result: PASS")
    expect(report.trimEnd().endsWith(EOF_MARK)).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/T-001/done.md")).text()).toContain("# T-001")
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
    expect((await f.git("log", "--format=%s")).split("\n").filter((line) => line.startsWith("T-001 fix "))).toHaveLength(1)
  })

  test("a FAIL verdict without a gap list: one re-prompt with feedback, still failing → blocked, nothing committed", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // The session writes a FAIL report (the pre-0083 shape) and no gap
      // list: the verdict is FAIL, the FAIL-side shape gate demands the gap
      // list, the re-prompt carries the feedback, the second failure blocks.
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), `# Report\n\n${filler}\n\nResult: FAIL the gap\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session" })
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("docs/T-001/gaps.md missing or empty")
      expect((result as { question: string }).question).toContain("hidden blockage")
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("docs/T-001/gaps.md")
      expect(promptText(calls.prompts[1]!)).toContain("write no report")
      // Nothing committed: HEAD is still init.
      expect((await git(dir, "log", "-1", "--format=%s")).trim()).toBe("init")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("resume mid-round (D7): the persisted round is preserved — one fix round left, the spent one never re-runs", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // One fix round already spent before the interruption: the record says
      // wrapup + round 1. The resumed run re-enters at the verify session
      // (the whole-task session does not run again) and has one round left.
      await saveProgress(dir, { task: "T-001", at: Date.now(), active: false, phase: { kind: "wrapup", round: 1 } })
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          await Bun.write(join(dir, "FIXES.md"), "fix round 2\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
      ])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off" })
      expect(outcome).toMatchObject({ type: "blocked" })
      // The first dispatched session is the verify session (execution skipped).
      expect(promptText(calls.prompts[0]!)).toContain("only performs the wrap-up")
      // Exactly one fix round ran — round 2; the spent round 1 never re-ran.
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toEqual(["T-001 fix 2 sample task"])
      expect((outcome as { question: string }).question).toContain("2 fix rounds already ran (the budget is 2)")
      // The spent count persists with the rewound phase.
      expect((await recallProgress(dir, "T-001"))?.phase).toEqual({ kind: "wrapup", round: 2 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("--no-wrapup keeps its meaning: no verify session; a task-written FAIL report still blocks at closeout, unchanged (D6)", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: acceptance [pending]\n\nCheck x.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "src.ts"), "// work\nexport const x = 1\n")
          await Bun.write(join(dir, "docs/T-001/report.md"), `# Report\n\n${filler}\n\nResult: FAIL x is wrong\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", wrapup: false })
      expect(outcome).toMatchObject({ type: "blocked" })
      // Today's closeout message verbatim, with the repair fact.
      expect((outcome as { question: string }).question).toContain("the task report concluded Result: FAIL (x is wrong)")
      expect((outcome as { repair?: { reason?: string } }).repair).toEqual({ reason: "x is wrong" })
      // One session only: the whole-task session wrote the report itself.
      expect(calls.prompts.length).toBe(1)
      expect(promptText(calls.prompts[0]!)).not.toContain("only performs the wrap-up")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a stream lane runs the loop lane-locally (D8): the closing lane's own tail verifies, fails, fixes and blocks", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      // A taken split of two streams, the second one pending: this run is
      // the closing stream lane (opts.stream), and once its stream lands the
      // pipeline tail — the verification loop — runs right here, with no
      // parent involvement.
      const plan = await seedUnits(
        dir,
        [
          "## T-001: stream task [in_progress]",
          "",
          "- [x] first stream Artifacts: src/one.ts",
          "- [ ] second stream Artifacts: src/two.ts",
          "",
          "Body.",
          "",
        ].join("\n"),
      )
      void plan
      // The state-file protocol of the split's streams (M1.0): S01 done,
      // S02 pending.
      await mkdirSync(join(dir, "docs/T-001/S01"), { recursive: true })
      await Bun.write(join(dir, "docs/T-001/S01/done.md"), "# S01 done\n\n<!-- auto: eof -->\n")
      await mkdirSync(join(dir, "docs/T-001/S02"), { recursive: true })
      await Bun.write(join(dir, "docs/T-001/S02/todo.md"), "# S02\n\n## Scope\n\nsecond stream\n\n<!-- auto: eof -->\n")
      // The split record: the checklist is a taken split's streams.
      await setSplit(dir, "T-001", await unitBaseline(dir))
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "split")
      const { client } = scriptedClient([
        async () => {
          await mkdirSync(join(dir, "src"), { recursive: true })
          await Bun.write(join(dir, "src", "two.ts"), "// the stream's work\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          await Bun.write(join(dir, "FIXES.md"), "fix round 1\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          await Bun.write(join(dir, "FIXES.md"), "fix round 2\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
      ])
      const fresh = await reloadUnits(dir)
      const outcome = await runTask(client, fresh, fresh.tasks[0]!, { dir, subtask: "auto", stream: 2 })
      // The lane's own tail ran the loop to exhaustion and blocked.
      expect(outcome).toMatchObject({ type: "blocked" })
      expect((outcome as { question: string }).question).toContain("the verification of T-001 concluded Result: FAIL")
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
