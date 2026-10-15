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
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { EOF_MARK } from "../src/doccheck"
import { unitBaseline } from "../src/git"
import { parseLaneReceipt } from "../src/intent/test-lanes"
import { saveProgress, recallProgress } from "../src/resume"
import { runTask } from "../src/runner"
import { renderTaskTodo, setSplit } from "../src/tasks"
import { runWrapup } from "../src/wrapup"
import { renderWrapup } from "../src/prompt"
import { promptFacts } from "../src/prompt-facts"
import { promptViews } from "../src/tasks"
import { taskDocPaths } from "../src/docpaths"
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
      // form (verified-OK summary, the red lane with its bounded evidence,
      // the closing Result: FAIL line), transient (deleted at the PASS).
      const gapsCommit = (await git(dir, "log", "--diff-filter=A", "-n1", "--format=%H", "--", "docs/T-001/gaps.md")).trim()
      const show = Bun.spawn(["git", "-C", dir, "show", `${gapsCommit}:docs/T-001/gaps.md`], { stdout: "pipe" })
      const gaps = await new Response(show.stdout).text()
      expect(gaps).toContain("Result: FAIL the anchor lane gate is red (LANE_RC=1)")
      expect(gaps).toContain("Lane `gate` red")
      expect(gaps).toContain("the widget is broken")
      expect(gaps).toContain("lint")
      expect(existsSync(join(dir, "docs/T-001/gaps.md"))).toBe(false)
      // One fix round; round 1's gate re-ran the anchor narrow and greened.
      const subjects = (await git(dir, "log", "--format=%s")).split("\n")
      expect(subjects.filter((line) => line.startsWith("T-001 fix "))).toEqual(["T-001 fix 1 sample task"])
      expect(parseLaneReceipt(await Bun.file(join(dir, "docs/T-001/testhands/gate.md")).text())?.verdict).toBe("green")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("red past the budget → blocked with the repair fact, the message naming the red lanes", async () => {
    const dir = await laneRepo({ gate: `echo "the widget is broken"; exit 1` })
    try {
      const fix = fixTurn(dir, false)
      const { client } = scriptedClient([workTurn(dir), fix, fix])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off", testByDriver: true })
      expect(outcome).toMatchObject({ type: "blocked", repair: { reason: "the anchor lane gate is red (LANE_RC=1)" } })
      expect((outcome as { question: string }).question).toContain("the driver-run test lanes of T-001 concluded red")
      expect((outcome as { question: string }).question).toContain("2 fix rounds already ran (the budget is 2)")
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
