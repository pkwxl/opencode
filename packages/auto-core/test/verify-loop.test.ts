// The task verification loop (plans/0083, M1): verify → gaps.md → fix →
// re-verify from scratch, the constant two-round budget, the shape gates,
// the resume round preservation and the --no-wrapup floor — driven end to
// end over the native fake agent on real git repositories (the loop fixture
// for the phase loop, the scripted per-session client for runTask's own
// tail). The FAIL-verdict-blocks-and-repairs family (the ladder past the
// budget) lives in repair-loop.test.ts; the report shape gate's PASS side
// predates 0083 and stays in auto-doc-shape.test.ts. The driver-run lane
// gate (plans/0096 D5) rides the same loop: its anchor pre-gate decides
// whether the verify session dispatches at all.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { EOF_MARK } from "../src/doccheck"
import { unitBaseline } from "../src/git"
import { parseLaneReceipt } from "../src/intent/test-lanes"
import { saveProgress, recallProgress } from "../src/resume"
import { runTask } from "../src/runner"
import { renderTaskTodo, setSplit } from "../src/tasks"
import { runWrapup } from "../src/wrapup"
import { createControl, ExitRequested } from "../src/exit"
import { renderWrapup } from "../src/prompt"
import { promptFacts } from "../src/prompt-facts"
import { promptViews } from "../src/tasks"
import { taskDocPaths } from "../src/docpaths"
import { establishRound } from "../src/phases"
import { BUILTIN_PHASE_TYPES } from "../src/phases/registry"
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

// A FAIL gap list (0083 D3's form, the countable grammar of plans/0146 D1:
// verified-OK summary, one `### Gap N — <title>` heading per gap under
// `## Gaps`, the closing result line, no terminator). count controls the gap
// count — the progress rule's measure.
const gapListText = (id: string, reason = "the acceptance gap stands", count = 1) =>
  [
    `# Gaps (${id})`,
    "",
    "## Verified OK",
    "",
    "- The wrap-up session inspected the work against the task's acceptance statements.",
    "",
    "## Gaps",
    "",
    ...Array.from({ length: count }, (_, i) => `### Gap ${i + 1} — ${reason}${count > 1 ? ` (${i + 1} of ${count})` : ""}`),
    "",
    `Result: FAIL ${reason}`,
    "",
  ].join("\n")

// A PASS evidence report (the report shape gate's own fixture).
const filler = "Verification evidence line. ".repeat(20)
const passReport = `# Report\n\n${filler}\n\nResult: PASS\n\n${EOF_MARK}\n`

describe("the per-row wrap-up of a ledger-bearing formulation task (0097 D8)", () => {
  const views = promptViews({ dir: "/repo", phase: "R-01.P01", index: "docs/R-01/P01-implement/tasks.md", tasks: [], closed: new Map() }, {
    id: "T-001",
    title: "Formulate the Implementation tasks",
    status: "pending",
    attempts: 0,
    body: ["## Goal", "", "G.", "", "## Scope", "", "Frame.", "", "## Obligations ledger", "", '- O-01 | round.md | "cover the parser errors" | the tests exercise them', "", "## Acceptance", "", "A."].join("\n"),
    formulate: "R-01.P01",
  })
  const ledger = ["- O-01 | round.md | \"cover the parser errors\" | the tests exercise them"].join("\n")

  test("with a ledger: the framing, the rows and the row-named gap form ride the prompt", () => {
    const text = renderWrapup(promptFacts(), views.plan, views.task, taskDocPaths("T-001"), { ledger })
    expect(text).toContain("judge it row by row")
    expect(text).toContain("The obligations ledger under judgment:")
    expect(text).toContain(ledger)
    expect(text).toContain("docs/T-001/coverage.md")
    expect(text).toContain("a gap against the ledger names its row")
  })

  test("without a ledger: the holistic judgment word-for-word, none of the framing", () => {
    const plain = renderWrapup(promptFacts(), views.plan, views.task, taskDocPaths("T-001"), {})
    expect(plain).not.toContain("row by row")
    expect(plain).not.toContain("obligations ledger under judgment")
  })
})

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

  test("the charter's commit range is the task's true start, not the re-anchored baseline (plans/0184 D1, 0165-023): a blocked-then-rerun task's range contains the execute commit", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const before = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      // The task's own work commits (the unified-commit shape, Auto-Task:
      // T-001) — then the re-run's callers hand runWrapup the re-anchored
      // HEAD, the shape a blocked-then-rerun task or a wrap-up kill produces.
      await Bun.write(join(dir, "src.ts"), "export const x = 1\n")
      await git(dir, "add", "-A")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "T-001 exec sample\n\nAuto-Stage: execute\nAuto-Task: T-001")
      await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
      await git(dir, "add", "-A")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "T-001 fix 1 sample\n\nAuto-Stage: execute\nAuto-Task: T-001")
      const reanchored = [{ root: dir, sha: (await git(dir, "rev-parse", "--short", "HEAD")).trim() }]
      const { client, calls } = scriptedClient([
        async () => {
          writeFileSync(join(dir, "docs/T-001/report.md"), passReport)
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session", baseline: reanchored })
      expect(result).toBeUndefined()
      // The verify prompt's range starts at the commit before the task's
      // first unit commit — the execute commit sits inside the range, where
      // the re-anchored HEAD alone would have handed the verifier HEAD..HEAD.
      expect(promptText(calls.prompts[0]!)).toContain(`in its commit range ${before}..HEAD`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a work session's committed report.md PASS never outranks the verifier (plans/0170 D1): the FAIL is seen, the fix loop opens, the report is removed at dispatch", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      // The work session's own self-verdict, committed before the round —
      // the confirmed defect's shape (0165-006 / S11-01): with the report
      // read in place, every later FAIL read as PASS, the task closed done
      // and the verifier's gap list was deleted uncommitted.
      await Bun.write(join(dir, "docs/T-001/report.md"), `# Report\n\nDone, trust me.\n\nResult: PASS\n\n${EOF_MARK}\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "work session output")
      // Every verify session writes the same one-gap FAIL; every fix round
      // closes nothing: the loop blocks at the no-progress budget — never a
      // pass, which is what the stale report used to produce. The session
      // sequence: verify, fix, verify, fix, verify (the third FAIL's
      // no-progress count reaches the two-round budget).
      const { client } = scriptedClient([
        async () => {
          writeFileSync(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          writeFileSync(join(dir, "FIXES.md"), "fix round 1\n")
        },
        async () => {
          writeFileSync(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          writeFileSync(join(dir, "FIXES.md"), "fix round 2\n")
        },
        async () => {
          writeFileSync(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session" })
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("the verification of T-001 concluded Result: FAIL")
      // The work session's report is gone — removed at the round's dispatch,
      // the deletion riding the round's wrap-up commit; the gap list stands.
      expect(existsSync(join(dir, "docs/T-001/report.md"))).toBe(false)
      expect(existsSync(join(dir, "docs/T-001/gaps.md"))).toBe(true)
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
      // One fix round already spent before the interruption — and it closed
      // no gap (plans/0146 D4's state: round 1, one no-progress round, the
      // baseline count 1): the resumed run re-enters at the verify session
      // (the whole-task session does not run again), and round 2 is the last
      // chance — a second no-progress FAIL blocks.
      await saveProgress(dir, { task: "T-001", at: Date.now(), active: false, phase: { kind: "wrapup", round: 1, noProgress: 1, gaps: 1 } })
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
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toEqual(["T-001 fix 2.1 sample task"])
      expect((outcome as { question: string }).question).toContain("the last two fix rounds closed no gap (2 fix rounds spent, the gap list still counts 1 gap)")
      // The spent count persists with the rewound phase, the progress state
      // riding it (the pre-round-2 persist: two no-progress rounds, count 1).
      expect((await recallProgress(dir, "T-001"))?.phase).toEqual({ kind: "wrapup", round: 2, noProgress: 2, gaps: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // plans/0146 D2/D3: the budget is progress, not a count — a round that
  // shrinks the gap list buys the loop another round; only two consecutive
  // no-progress rounds block.
  test("progress extends the loop (0146): 2 gaps → 1 → 1 → 1 blocks only at round 3, the message naming the stalled count", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      let verify = 0
      const gapsAt = [2, 1, 1, 1]
      const verifyScript = async () => {
        await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001", "the acceptance gap stands", gapsAt[verify++] ?? 1))
      }
      const fixScript = async () => {
        await Bun.write(join(dir, "FIXES.md"), `fix round ${verify - 1}\n`)
      }
      const { client } = scriptedClient([verifyScript, fixScript, verifyScript, fixScript, verifyScript, fixScript, verifyScript])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const persist = (phase: NonNullable<Parameters<typeof saveProgress>[1]["phase"]>) => saveProgress(dir, { task: "T-001", at: Date.now(), active: false, phase })
      const outcome = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session", persist })
      expect(outcome).toMatchObject({ type: "blocked" })
      // Round 1 shrank 2 → 1 (progress, the streak reset); rounds 2 and 3
      // each held at 1 — the two consecutive no-progress rounds that block.
      expect((outcome as { question: string }).question).toContain("the last two fix rounds closed no gap (3 fix rounds spent, the gap list still counts 1 gap)")
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toHaveLength(3)
      // The record holds the pre-round-3 persist (the block fires after the
      // FAIL measurement, before any further write): rounds 2's no-progress
      // held at 1, the baseline count 1.
      expect((await recallProgress(dir, "T-001"))?.phase).toEqual({ kind: "wrapup", round: 3, noProgress: 1, gaps: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // plans/0198 D1, enacting 0165-003 (S11-02): the ruled bound was false in
  // code — against the PREVIOUS count, an oscillating count (a fix closes one
  // gap and its round's regression breaks another, the common whack-a-mole
  // shape) reset the no-progress streak on every down step and the loop never
  // blocked. Progress now beats the loop's BEST (the minimum measured): the
  // oscillation 2,1,2,1 reaches its low at the second FAIL and never beats it
  // again — the loop blocks at round 3 with the best held at 1.
  test("an oscillating gap count blocks (0198 D1): 2 → 1 → 2 → 1 never beats the best again, the loop blocks at round 3, the record holds the best", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      let verify = 0
      const verifyScript = async () => {
        verify++
        mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
        // Four FAILs oscillating 2,1,2,1, then a PASS — the PASS is the old
        // rule's escape: against the previous count every second round was
        // "progress" and the loop reached it; against the best it never does.
        if (verify <= 4) await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001", "the acceptance gap stands", [2, 1, 2, 1][verify - 1]))
        else await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
      }
      const fixScript = async () => {
        await Bun.write(join(dir, "FIXES.md"), `fix round ${verify - 1}\n`)
      }
      const { client } = scriptedClient([verifyScript, fixScript, verifyScript, fixScript, verifyScript, fixScript, verifyScript, fixScript, verifyScript])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const persist = (phase: NonNullable<Parameters<typeof saveProgress>[1]["phase"]>) => saveProgress(dir, { task: "T-001", at: Date.now(), active: false, phase })
      const outcome = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session", persist })
      expect(outcome).toMatchObject({ type: "blocked" })
      // Round 1 took the best 2 → 1 (progress, the streak cleared); rounds 2
      // and 3 beat none of it — the two consecutive no-progress rounds that
      // block, the message naming the stalled count (the last measurement).
      expect((outcome as { question: string }).question).toContain("the last two fix rounds closed no gap (3 fix rounds spent, the gap list still counts 1 gap)")
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toHaveLength(3)
      // The record holds the pre-round-3 persist, and its gaps field holds
      // the BEST (1), not the last measurement (2) — the field's meaning
      // since 0198 D1.
      expect((await recallProgress(dir, "T-001"))?.phase).toEqual({ kind: "wrapup", round: 3, noProgress: 1, gaps: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a re-opened round continues the session numbering from the log (0148 D1): the fresh round's first dispatch is 1.2, never a second 1.1", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // The 0142 rewind shape: an unbooked round 1 already left one session's
      // batch committed (`fix 1.1`), the record rewound roundless — the
      // re-run re-opens round 1, and its first dispatch derives the ordinal
      // from the log: 1.2, never a second 1.1.
      await git(dir, "commit", "--allow-empty", "-qm", "T-001 fix 1.1 sample task")
      await saveProgress(dir, { task: "T-001", at: Date.now(), active: false, phase: { kind: "wrapup" } })
      const { client } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          await Bun.write(join(dir, "FIXES.md"), "fix round 1 session 2\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
        },
      ])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off" })
      expect(outcome).toEqual({ type: "completed" })
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      const fixSubjects = subjects.filter((line) => line.startsWith("T-001 fix "))
      expect(fixSubjects).toEqual(["T-001 fix 1.2 sample task", "T-001 fix 1.1 sample task"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("progress to a PASS (0146): 2 gaps → 1 → the evidence report completes, the loop never blocks", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      let verify = 0
      const verifyScript = async () => {
        verify++
        mkdirSync(join(dir, "docs/T-001"), { recursive: true })
        if (verify <= 2) await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001", "the acceptance gap stands", 3 - verify))
        else await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
      }
      const fixScript = async () => {
        await Bun.write(join(dir, "FIXES.md"), `fix round ${verify - 1}\n`)
      }
      const { client } = scriptedClient([verifyScript, fixScript, verifyScript, fixScript, verifyScript])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const outcome = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session" })
      expect(outcome).toBeUndefined()
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a FAIL gap list without the countable grammar: one re-prompt with feedback, still failing → blocked (0146 D1)", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // The session writes a freeform gap list — no `### Gap N —` headings:
      // the FAIL-side shape gate demands the countable grammar (the progress
      // rule measures it), the re-prompt carries the feedback, the second
      // failure blocks.
      const { client, calls } = scriptedClient([
        async () => {
          mkdirSync(join(dir, "docs/T-001"), { recursive: true })
          await Bun.write(join(dir, "docs/T-001/gaps.md"), `# Gaps (T-001)\n\n## Gaps\n\n- the acceptance gap stands (src/widget.ts): do what the acceptance asks.\n\nResult: FAIL the gap stands\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session" })
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("no `### Gap N — <title>` heading")
      expect((result as { question: string }).question).toContain("hidden blockage")
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("### Gap N — <one-line title>")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The execution stage's handover document is retired at the wrap-up tail's
  // entry (plans/0171 D5, enacting S10-01): its stale `Status: continue` once
  // seeded the first fix round as "the previous fix session ended with a
  // handover" — feeding it the execution stage's superseded next steps.
  test("the execution stage's leftover handoff never seeds the fix round: retired at the wrap-up tail's entry", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // The execution session hands itself over (a fresh Status: continue,
      // far under the wall); the continuation finishes the task WITHOUT
      // rewriting the document; the verify session FAILs; the fix round
      // runs.
      const { client, calls } = scriptedClient([
        async () => {
          writeFileSync(join(dir, "src.ts"), "// the work\n")
          mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
          await Bun.write(join(dir, "docs/T-001/handoff.md"), "# Handover\n\nHalf done; next: the rest.\n\nStatus: continue\n")
        },
        async () => {
          writeFileSync(join(dir, "MORE.md"), "the continuation finished the task\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          writeFileSync(join(dir, "FIXES.md"), "fix round 1\n")
          mkdirSync(join(dir, "tmp"), { recursive: true })
          writeFileSync(join(dir, "tmp", "fixed"), "")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
        },
      ])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off" })
      expect(outcome).toEqual({ type: "completed" })
      // work (handing over), continuation, verify (FAIL), fix, re-verify.
      expect(calls.prompts).toHaveLength(5)
      expect(promptText(calls.prompts[1]!)).toContain("First read docs/T-001/handoff.md")
      // The fix round is NOT seeded from the execution stage's leftover —
      // the clause names a FIX session's handover, and none happened.
      expect(promptText(calls.prompts[3]!)).not.toContain("context-budget handover")
      expect(promptText(calls.prompts[3]!)).toContain("You are the fix session")
      // The stage's document is gone: retired at the tail's entry, the
      // deletion riding the wrap-up's own commits.
      expect(await Bun.file(join(dir, "docs/T-001/handoff.md")).exists()).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a fix session's self-directed handover (plans/0130 D2): a fresh Status: continue document under the wall hands the round over, the continuation reads it, and the round commits once", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // The verify session FAILs with a gap list; the first fix session hands
      // itself over mid-round at a boundary of its own choosing (a fresh
      // Status: continue document, far under the wall); the continuation fix
      // session closes the gaps; the re-verification passes.
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          mkdirSync(join(dir, "docs/T-001"), { recursive: true })
          await Bun.write(join(dir, "docs/T-001/handoff.md"), "# Handover\n\nHalf the gaps closed; the rest stand.\n\nStatus: continue\n")
        },
        async () => {
          await Bun.write(join(dir, "FIXES.md"), "fix round 1\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session" })
      expect(result).toBeUndefined()
      // verify, fix (the protocol riding it), fix continuation (reading the
      // handover document), re-verify — the round's sessions in order.
      expect(calls.prompts).toHaveLength(4)
      expect(promptText(calls.prompts[1]!)).toContain("You are the fix session")
      expect(promptText(calls.prompts[1]!)).toContain("Context-budget protocol")
      expect(promptText(calls.prompts[2]!)).toContain("The previous fix session ended with a context-budget handover")
      expect(promptText(calls.prompts[2]!)).toContain("docs/T-001/handoff.md")
      // The handover split the round's sessions, and each session's batch is
      // durable at its own boundary (plans/0148 D1): the handing-over session
      // commits `fix 1.1` carrying the handover document with the work it
      // describes, the continuation's natural end commits `fix 1.2` with the
      // rest — the round's session shape readable in git by its indices.
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toEqual(["T-001 fix 1.2 sample task", "T-001 fix 1.1 sample task"])
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toContain("Result: PASS")
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // plans/0143: a fix round's handover is an /exit boundary — the round is
  // neither booked nor committed past the verdict, so the pause leaves the
  // scene a kill between the round's sessions would (the uncommitted handoff
  // document is the re-run's round-entry seeding).
  test("an /exit pending when a fix session hands itself over: the exit takes effect at the round's handover, the continuation never dispatched (plans/0143)", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // The verify session FAILs with a gap list; the fix session hands
      // itself over (a fresh Status: continue document) with the person's
      // /exit arriving mid-session; the exit takes effect at that handover.
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
        },
        async () => {
          control.requestExit()
          mkdirSync(join(dir, "docs/T-001"), { recursive: true })
          await Bun.write(join(dir, "docs/T-001/handoff.md"), "# Handover\n\nHalf the gaps closed; the rest stand.\n\nStatus: continue\n")
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const control = createControl()
      let caught: unknown
      try {
        await runWrapup(client, plan, plan.tasks[0]!, { dir, control } as Opts, chain, { solo: false, label: "wrap-up session" })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ExitRequested)
      const error = caught as ExitRequested
      expect(error.boundary).toBe("handover")
      expect(error.label).toBe("T-001 fix 1 session handover")
      // verify, fix 1 — the continuation fix session never launched, and the
      // round never committed (the kill scene between the round's sessions).
      expect(calls.prompts).toHaveLength(2)
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toEqual([])
      expect(await Bun.file(join(dir, "docs/T-001/handoff.md")).text()).toContain("Status: continue")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // plans/0143 D5: the wrap-up entry is an /exit boundary — the execution
  // session's work is committed and the wrap-up loop's stage persist has
  // written the record a re-run re-enters by, so the pause lands between the
  // execution and the verify session, never mid-verification.
  test("an /exit pending at the wrap-up entry: the exit takes effect after the stage persist, before the verify session (plans/0143 D5)", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // The execution session runs (its work commits); the wrap-up entry
      // then takes the pending /exit before the verify session dispatches.
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "WORK.md"), "the execution session's work\n")
        },
      ])
      const plan = await reloadUnits(dir)
      const control = createControl()
      control.requestExit()
      let caught: unknown
      try {
        await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", control })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ExitRequested)
      const error = caught as ExitRequested
      expect(error.boundary).toBe("wrapup")
      expect(error.label).toBe("T-001 wrap-up entry")
      // Exactly one session ran — the whole-task execution; the verify
      // session never dispatched.
      expect(calls.prompts).toHaveLength(1)
      // The execution's unified commit landed, and the progress record says
      // the wrapup stage — the persist the probe follows, and what a re-run
      // re-enters by.
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.some((line) => line.startsWith("T-001 exec "))).toBe(true)
      expect((await recallProgress(dir, "T-001"))?.phase).toEqual({ kind: "wrapup" })
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

// The driver-run lane gate (plans/0096 D5): the pack's lane table runs as
// parallel driver processes between the task's execution share and the
// verify dispatch; the anchor pre-gate (the row the task's `## Acceptance`
// names — gate here) decides the round's entry. Green → verify dispatched;
// red → the fix loop opens over the driver-synthesized gap list; a moved
// HEAD → the corrupted-baseline block; no pack table → the byte-identical
// floor (the serial tmp/test.sh channel unchanged).
describe("the driver-run lane gate (0096 D5)", () => {
  // A repo whose pack declares a two-row lane table (lint cheap, gate the
  // anchor its acceptance names) and whose task's todo carries the sections.
  // The lane commands default green; a test overrides them.
  async function laneRepo(lanes: { lint?: string; gate?: string } = {}): Promise<string> {
    const dir = await freshRepo()
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    mkdirSync(join(dir, ".opencode", "auto", "intents"), { recursive: true })
    const row = (name: string, command: string, cost: string) => [`${name}:`, `Command: ${command}`, `Cost: ${cost}`, "Surfaces: src/", "Exclusive: no", ""]
    await Bun.write(
      join(dir, ".opencode", "auto", "intents", "default.md"),
      [
        "# default",
        "",
        "## quality",
        "",
        "### test-lanes",
        "",
        ...row("lint", lanes.lint ?? "true", "cheap"),
        ...row("gate", lanes.gate ?? "true", "anchor"),
        "## acceptance",
        "",
        "### result-line",
        "",
        "Write the line when this task asked you to check work.",
        "",
      ].join("\n"),
    )
    await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
    await Bun.write(
      join(dir, "docs", "T-001", "todo.md"),
      renderTaskTodo({
        id: "T-001",
        title: "sample task",
        phase: "R-01.P01",
        goal: "Migrate the widget.",
        scope: "src/ work.",
        acceptance: "The gate lane is green over the migrated widget.",
      }),
    )
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "init")
    return dir
  }
  const workTurn = (dir: string) => async () => {
    writeFileSync(join(dir, "src.ts"), "// the work\nexport const x = 1\n")
  }
  // A fix round whose share differs per invocation (identical content would
  // make the second round's unified commit a no-op).
  const fixTurn = (dir: string, fix: boolean) => {
    let round = 0
    return async () => {
      writeFileSync(join(dir, "FIXES.md"), `fix round ${++round}\n`)
      if (fix) {
        mkdirSync(join(dir, "tmp"), { recursive: true })
        writeFileSync(join(dir, "tmp", "fixed"), "")
      }
    }
  }
  const verifyTurn = (dir: string) => async () => {
    mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
    writeFileSync(join(dir, "docs", "T-001", "report.md"), passReport)
  }

  test("green anchor → the verify session dispatches; the receipts land as committed evidence", async () => {
    const dir = await laneRepo()
    try {
      const { client, calls } = scriptedClient([workTurn(dir), verifyTurn(dir)])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", testByDriver: true })
      expect(outcome).toEqual({ type: "completed" })
      // Whole-task session then the verify session (the gate launched no
      // session and held the dispatch until its lanes exited).
      expect(calls.prompts).toHaveLength(2)
      expect(promptText(calls.prompts[1]!)).toContain("only performs the wrap-up")
      // Both rows' green receipts are committed evidence riding the unit's
      // own commits (no stage of their own).
      expect((await git(dir, "ls-files", "--", "docs/T-001/testhands")).split("\n").filter(Boolean).sort()).toEqual([
        "docs/T-001/testhands/gate.md",
        "docs/T-001/testhands/lint.md",
      ])
      for (const lane of ["lint", "gate"]) {
        expect(parseLaneReceipt(await Bun.file(join(dir, "docs/T-001/testhands", `${lane}.md`)).text())?.verdict).toBe("green")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("red anchor → straight into the fix loop with the driver-synthesized gap list; no verify session over the red tree", async () => {
    const dir = await laneRepo({ gate: `test -f tmp/fixed || { echo "the widget is broken"; exit 1; }` })
    try {
      const { client, calls } = scriptedClient([workTurn(dir), fixTurn(dir, true), verifyTurn(dir)])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", testByDriver: true })
      expect(outcome).toEqual({ type: "completed" })
      // Round 0: the gate ran red, so the first session after the whole-task
      // one is the FIX session — no verify session ever saw the red tree.
      expect(calls.prompts).toHaveLength(3)
      expect(promptText(calls.prompts[1]!)).toContain("You are the fix session")
      expect(promptText(calls.prompts[2]!)).toContain("only performs the wrap-up")
      // The synthesized gap list: committed with the wrapup stage, the 0083
      // form with the countable grammar of plans/0146 D1 (verified-OK
      // summary, the red lane as a `### Gap N —` heading with its bounded
      // evidence, the closing Result: FAIL line), transient (deleted at the
      // PASS).
      const gapsCommit = (await git(dir, "log", "--diff-filter=A", "-n1", "--format=%H", "--", "docs/T-001/gaps.md")).trim()
      const show = Bun.spawn(["git", "-C", dir, "show", `${gapsCommit}:docs/T-001/gaps.md`], { stdout: "pipe" })
      const gaps = await new Response(show.stdout).text()
      expect(gaps).toContain("Result: FAIL the anchor lane gate is red (LANE_RC=1)")
      expect(gaps).toContain("### Gap 1 — lane `gate` red")
      expect(gaps).toContain("the widget is broken")
      expect(gaps).toContain("lint")
      expect(existsSync(join(dir, "docs/T-001/gaps.md"))).toBe(false)
      // One fix round; round 1's gate re-ran the anchor narrow and greened.
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toEqual(["T-001 fix 1.1 sample task"])
      expect(parseLaneReceipt(await Bun.file(join(dir, "docs/T-001/testhands/gate.md")).text())?.verdict).toBe("green")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("red past the budget → blocked with the repair fact, the message naming the red lanes and the stalled count", async () => {
    const dir = await laneRepo({ gate: `echo "the widget is broken"; exit 1` })
    try {
      const fix = fixTurn(dir, false)
      const { client } = scriptedClient([workTurn(dir), fix, fix])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", testByDriver: true })
      expect(outcome).toMatchObject({ type: "blocked", repair: { reason: "the anchor lane gate is red (LANE_RC=1)" } })
      expect((outcome as { question: string }).question).toContain("the driver-run test lanes of T-001 concluded red")
      expect((outcome as { question: string }).question).toContain("the last two fix rounds closed no gap (2 fix rounds spent, the gap list still counts 1 gap)")
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a carried-green anchor passes the pre-gate: a red cheap lane outside it stands as inspected evidence, the verify session judges", async () => {
    const dir = await laneRepo({ lint: `echo "lint is grumpy"; exit 1` })
    try {
      // An earlier task's green gate receipt over the current tree (the
      // anchor's surfaces — include/ — untouched since): it carries, so the
      // pre-gate keys on the anchor and passes despite the red cheap lane.
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      mkdirSync(join(dir, "docs/T-000/testhands"), { recursive: true })
      await Bun.write(
        join(dir, "docs/T-000/testhands/gate.md"),
        [`# Lane gate`, ``, `Lane: gate`, `Heads: .=${head}`, `Start: 2026-10-14T00:00:00.000Z`, `End: 2026-10-14T00:01:00.000Z`, `Verdict: green`, `Log: /tmp/opencode/T-000-gate-old.log`, ``, EOF_MARK, ``].join("\n"),
      )
      // The receipt's janitor commit (plans/0171 D2): a carry-basis receipt
      // is witnessed by its introducing commit's testhands stage — the
      // earlier task's gate receipt lands the way the driver lands it.
      await git(dir, "add", "--", "docs/T-000/testhands/gate.md")
      await git(dir, "commit", "-qm", "T-000 testhands receipts (gate)", "-m", "Auto-Task: T-000", "-m", "Auto-Stage: testhands")
      // The anchor row's surfaces must miss the task's src/ work: rewrite the
      // pack's gate row before the run.
      const pack = join(dir, ".opencode/auto/intents/default.md")
      await Bun.write(pack, (await Bun.file(pack).text()).replace("Surfaces: src/\nExclusive: no\n\n## acceptance", "Surfaces: include/\nExclusive: no\n\n## acceptance"))
      const { client, calls } = scriptedClient([workTurn(dir), verifyTurn(dir)])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", testByDriver: true })
      expect(outcome).toEqual({ type: "completed" })
      expect(calls.prompts).toHaveLength(2)
      expect(promptText(calls.prompts[1]!)).toContain("only performs the wrap-up")
      // The red cheap lane's receipt is committed evidence for the verify
      // session's inspection; the anchor's own receipt records the carry.
      expect(parseLaneReceipt(await Bun.file(join(dir, "docs/T-001/testhands/lint.md")).text())?.verdict).toBe("red")
      const gate = await Bun.file(join(dir, "docs/T-001/testhands/gate.md")).text()
      expect(gate).toContain("Carried: docs/T-000/testhands/gate.md")
      expect(parseLaneReceipt(gate)?.verdict).toBe("green")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a lane that moves HEAD hard-blocks (the corrupted-baseline family)", async () => {
    const dir = await laneRepo({ gate: "git commit --allow-empty -qm sneaky" })
    try {
      const { client, calls } = scriptedClient([workTurn(dir)])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", testByDriver: true })
      expect(outcome).toMatchObject({ type: "blocked" })
      expect((outcome as { question: string }).question).toContain("a driver-run test lane ran a git state command and moved HEAD")
      // No verify session over a corrupted baseline.
      expect(calls.prompts).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("no pack table is the byte-identical floor: the channel stays the serial one, no lane launches", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await seedUnits(dir, `## T-001: sample task [pending]\n\nBody.\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const { client, calls } = scriptedClient([workTurn(dir), verifyTurn(dir)])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", testByDriver: true })
      expect(outcome).toEqual({ type: "completed" })
      expect(calls.prompts).toHaveLength(2)
      expect(existsSync(join(dir, "docs/T-001/testhands"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// The unservable test request (plans/0142): the channel's derived condition
// (testByDriver && codeWork) leaves a design-phase session with no marker
// machinery at all, while the task document / the gap list may still instruct
// the protocol by name — the T-058 incident's fix round 2 ended waiting on a
// request nobody served, the round was booked as spent, and the budget block
// taught three remedies none of which named the dead channel. The drop is now
// consumed and surfaced at every scope's close (D1); a fix round never books
// a wait (D2 — the opening persist rewound, bookAttempt skipped).
describe("the unservable test request (0142 D1/D2)", () => {
  const designEntry = BUILTIN_PHASE_TYPES.find((entry) => entry.type === "design")!
  const designOpts = (dir: string): Opts => ({ dir, testByDriver: true, phase: { id: "R-01.P01", entry: designEntry } }) as Opts
  const seedRepo = async (attempts = 2): Promise<string> => {
    const dir = await freshRepo()
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    await seedUnits(dir, `## T-001: sample task [pending]\n${attempts ? `  - attempts: ${attempts}\n` : ""}\nBody.\n`)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "init")
    return dir
  }
  const failTurn = (dir: string) => async () => {
    mkdirSync(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/gaps.md"), gapListText("T-001"))
  }
  const waitingFixTurn = (dir: string) => async () => {
    mkdirSync(join(dir, "tmp"), { recursive: true })
    // The waiting session's whole act: the task document says "run it via the
    // driver test protocol", the marker is the request, the turn ends.
    await Bun.write(join(dir, "tmp/test.sh"), "bash test/spike.sh\n")
  }
  const persistTo = (dir: string) => async (phase: { kind: string; round?: number }) => {
    await saveProgress(dir, { task: "T-001", at: Date.now(), active: false, phase: phase as Parameters<typeof saveProgress>[1]["phase"] })
  }

  test("a fix round that waits on the dead channel: blocked with the teaching, the round unbooked, the marker consumed", async () => {
    const dir = await seedRepo()
    try {
      const { client, calls } = scriptedClient([failTurn(dir), waitingFixTurn(dir)])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, designOpts(dir), chain, { solo: false, label: "wrap-up session", persist: persistTo(dir) })
      expect(result).toMatchObject({ type: "blocked" })
      const question = (result as { question: string }).question
      expect(question).toContain("ended with a driver-test request pending (tmp/test.sh)")
      expect(question).toContain("the phase (design) is not a code-work phase")
      expect(question).toContain("The round is not booked")
      expect(question).toContain("runs such a check itself in-session")
      // Unbooked: attempts untouched, the opening persist rewound to the
      // roundless wrap-up stage (a re-run re-opens round 1, the budget whole).
      expect(JSON.parse(await Bun.file(join(dir, ".auto/units.json")).text()).tasks["T-001"].attempts).toBe(2)
      expect((await recallProgress(dir, "T-001"))?.phase).toEqual({ kind: "wrapup" })
      // The request consumed — no wiring left for the next session.
      expect(existsSync(join(dir, "tmp/test.sh"))).toBe(false)
      // The sessions ran in the incident's order: verify FAIL, then the wait.
      expect(calls.prompts).toHaveLength(2)
      expect(promptText(calls.prompts[1]!)).toContain("You are the fix session")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the config-off side of the same block: the message names the flag, not the phase", async () => {
    const dir = await seedRepo()
    try {
      const { client } = scriptedClient([failTurn(dir), waitingFixTurn(dir)])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, { dir } as Opts, chain, { solo: false, label: "wrap-up session" })
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("--test-by-driver is off")
      expect(existsSync(join(dir, "tmp/test.sh"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an execution session's dead marker is consumed at its close (D1): the run proceeds, nothing reads it as wiring", async () => {
    const dir = await seedRepo(0)
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "src.ts"), "// the work\nexport const x = 1\n")
          mkdirSync(join(dir, "tmp"), { recursive: true })
          await Bun.write(join(dir, "tmp/test.sh"), "bash test/spike.sh\n")
        },
        async () => {
          mkdirSync(join(dir, "docs/T-001"), { recursive: true })
          await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
        },
      ])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { ...designOpts(dir), subtask: "off" })
      expect(outcome).toEqual({ type: "completed" })
      expect(calls.prompts).toHaveLength(2)
      expect(existsSync(join(dir, "tmp/test.sh"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the wrap-up entry consumes a stale marker (D1): a resume straight into wrap-up never verifies the wiring", async () => {
    const dir = await seedRepo(0)
    try {
      mkdirSync(join(dir, "tmp"), { recursive: true })
      await Bun.write(join(dir, "tmp/test.sh"), "bash test/spike.sh\n")
      const { client } = scriptedClient([
        async () => {
          mkdirSync(join(dir, "docs/T-001"), { recursive: true })
          await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runWrapup(client, plan, plan.tasks[0]!, designOpts(dir), chain, { solo: false, label: "wrap-up session" })
      expect(result).toBeUndefined()
      expect(existsSync(join(dir, "tmp/test.sh"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the verify session's own PASS consumes its marker (plans/0156 D8): surfaced at THIS task's close, never the next one's", async () => {
    // The T-058 shape: the verify session reads the task's gap list or
    // document naming tmp/test.sh and re-runs the request the dead channel
    // can never serve — the wrap-up template forbids it, but the marker is
    // on disk all the same. Without the PASS-site consumption it would
    // linger until the NEXT task's wrap-up entry, whose log would
    // misattribute it to that task's id.
    const dir = await seedRepo(0)
    try {
      const { client } = scriptedClient([
        async () => {
          mkdirSync(join(dir, "docs/T-001"), { recursive: true })
          await Bun.write(join(dir, "docs/T-001/report.md"), passReport)
          mkdirSync(join(dir, "tmp"), { recursive: true })
          await Bun.write(join(dir, "tmp/test.sh"), "bash test/spike.sh\n")
        },
      ])
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const lines: string[] = []
      const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "))
      })
      let result: Awaited<ReturnType<typeof runWrapup>>
      try {
        result = await runWrapup(client, plan, plan.tasks[0]!, designOpts(dir), chain, { solo: false, label: "wrap-up session" })
      } finally {
        printed.mockRestore()
      }
      expect(result).toBeUndefined()
      expect(existsSync(join(dir, "tmp/test.sh"))).toBe(false)
      // The consumption line names THIS task (the attribution the next
      // task's entry would have gotten wrong).
      expect(lines.some((line) => line.includes("T-001 left tmp/test.sh") && line.includes("the phase (design) is not a code-work phase"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
