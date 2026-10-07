// The blockage diagnosis session through the agent-fake double (plans/0082
// §13, MA.6): a parsable plan lands as the committed blockage document; an
// unparsable reply fails closed to the static message with the raw tail in
// the round's audit; an Escalation outcome still writes the document; the
// read-only charter line rides the prompt; the kill switch returns today's
// exact behavior (no session, no document, the located-file line surviving);
// the two-consecutive-reblocks suspension prints the static message with the
// audit pointer; and the write-time handover check (§10 D14a) fails closed
// after exactly one re-distill, the blockage machinery owning the decision.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { autoSwitches, clampSwitches } from "../src/switches"
import { establishRound } from "../src/phases"
import { ev, type TurnScript } from "./fixtures/agent"
import { artifactTurns, diagnosisTurn, loopFixture, type LoopFixture } from "./fixtures/loop"
import type { Interactive } from "../src/interactive"
import type { RoutingFacts } from "../src/routing"
import { services } from "../src/services"
import type { ModelEntry } from "../src/models-schema"

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
const routing = (): RoutingFacts => ({
  registry: {
    layers: [{ name: "operator", path: "/unused/models.json" }],
    tz: "UTC",
    agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
    models: new Map([entry("free", { model: "free/model" })].map((item) => [item.name, item])),
    tiers: { deep: { tier: "deep", names: ["free"], layer: "operator" }, simple: { tier: "simple", names: ["free"], layer: "operator" } },
    routes: new Map(),
    unused: [],
    classifier: { names: ["free"], layer: "operator" },
  },
  agentFilter: "opencode",
  filterSource: undefined,
  defaultAgent: "opencode",
  runAgent: "opencode",
  router: services().router,
  clock: services().clock,
})

const VERIFY_MARK = "You read one prompt that a planning step"
const CHARTER = "This project runs a clean room: the reference implementation is never to be read, copied or translated."
const CONTRARY_INPUT = "Copy the reference implementation's modules over verbatim, reading its source directly."
const CHARTER_PACK = `# verify\n\n## guarantees\n\n### verify-plan\n\n${CHARTER}\n`
const NO_VERDICT = 'Consistent: no — the charter\'s "never to be read, copied or translated" contradicts the prompt\'s "Copy the reference implementation\'s modules over verbatim" (in the planning input)'

// The incident's option A, written by the diagnosis session into the plan
// document the prompt names (the strict format verbatim).
const THE_PLAN = [
  "## Analysis",
  "",
  "The handover's carve-out launders a provisional default into a constraint.",
  "",
  "## Options",
  "",
  "### A Tighten the handover",
  "Channel: advice",
  "Advice: fix the handover by hand",
  "Consequences: the wall is strict",
  "Recommendation: A",
].join("\n")

async function diagnosisFixture(turn: (dir: string) => TurnScript): Promise<LoopFixture> {
  const f = await loopFixture("m", (dir) => ({ turn: turn(dir) }))
  await mkdir(join(f.dir, ".opencode", "auto", "intents"), { recursive: true })
  await writeFile(join(f.dir, ".opencode", "auto", "intents", "verify.md"), CHARTER_PACK)
  await establishRound(f.dir, { phases: "m" })
  await f.commit("round setup")
  return f
}

const contraryTurn = (diagnosis: (file: string) => string | undefined): ((dir: string) => TurnScript) => (dir) => (ctx) => {
  if (ctx.text.includes(VERIFY_MARK)) return [ev.text(ctx.session, `vrf_${ctx.n}`, NO_VERDICT), ev.idle(ctx.session)]
  diagnosisTurn(dir, diagnosis)(ctx)
    return artifactTurns(dir)(ctx) ?? undefined
}

describe("the blockage diagnosis session (plans/0082 §4-§6, the agent-fake cases)", () => {
  afterAll(() => {
    clampSwitches({ remediate: true })
  })

  test("a parsable plan: the document is committed with the session's sections verbatim and the Choice protocol; the prompt carried the read-only charter", async () => {
    const f = await diagnosisFixture(contraryTurn(() => THE_PLAN))
    try {
      const { code, lines } = await f.run({ planInput: { text: CONTRARY_INPUT }, intent: "verify", routing: routing() })
      expect(code).toBe(2)
      // The honest block line named the located input file (D2: the
      // contradictory input is the planning input itself).
      expect(lines.some((line) => line.includes("plan verification found the implement-plan R-01.P01 prompt inconsistent"))).toBe(true)
      // The document: committed on its own (Auto-Stage: blockage), the
      // session's sections verbatim, the Decision and the protocol.
      const doc = "docs/R-01/blockage-1.md"
      expect(existsSync(join(f.dir, doc))).toBe(true)
      const text = await Bun.file(join(f.dir, doc)).text()
      expect(text).toContain("# Blockage 1: plan-verify (implement-plan R-01.P01")
      expect(text).toContain("- Gate: plan-verify")
      expect(text).toContain("## Analysis")
      expect(text).toContain("The handover's carve-out launders a provisional default into a constraint.")
      expect(text).toContain("### A Tighten the handover")
      expect(text).toContain("## Decision")
      expect(text).toContain("Choice: <one option letter>")
      expect(text).toContain("## Execution protocol")
      expect((await f.git("log", "--pretty=%B", "--all")).includes("Auto-Stage: blockage")).toBe(true)
      // The diagnosis prompt's read-only charter line (D4: the discipline
      // where the adapter cannot restrict tools) and the mode brief (D3).
      const diagnosis = f.agent.prompts.find((prompt) => prompt.text.includes("You are the blockage diagnosis session"))!
      expect(diagnosis.text).toContain("Propose only: you never edit any file")
      expect(diagnosis.text).toContain("## Surfaces and ownership")
      expect(lines.some((line) => line.includes("answer it by writing one line `Choice: <letter>`") || line.includes("Answer docs/R-01/blockage-1.md"))).toBe(true)
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })

  test("unparsable: fail-closed to the static message, the raw reply appended to the round's audit, no document left behind", async () => {
    const f = await diagnosisFixture(contraryTurn(() => undefined)) // undefined: the session replies without writing
    try {
      const { code, lines } = await f.run({ planInput: { text: CONTRARY_INPUT }, intent: "verify", routing: routing() })
      expect(code).toBe(2)
      expect(lines.some((line) => line.includes("blockage diagnosis failed closed"))).toBe(true)
      const audit = await Bun.file(join(f.dir, "docs/R-01/prompt-audit.md")).text()
      expect(audit).toContain("blockage diagnosis implement-plan R-01.P01: FAILED — the session produced no parsable remediation plan")
      expect(existsSync(join(f.dir, "docs/R-01/blockage-1.md"))).toBe(false)
      expect((await f.git("log", "--pretty=%B", "--all")).includes("Auto-Stage: blockage")).toBe(false)
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })

  test("an Escalation outcome still writes the document — the analysis on disk, the run staying blocked (half the value with no safe edit)", async () => {
    const escalation = ["## Analysis", "", "A substantive decision only the person can make.", "", "## Escalation", "", "No safe edit exists: the charter itself must be amended.", ""].join("\n")
    const f = await diagnosisFixture(contraryTurn(() => escalation))
    try {
      const { code } = await f.run({ planInput: { text: CONTRARY_INPUT }, intent: "verify", routing: routing() })
      expect(code).toBe(2)
      const text = await Bun.file(join(f.dir, "docs/R-01/blockage-1.md")).text()
      expect(text).toContain("## Escalation")
      expect(text).toContain("No safe edit exists: the charter itself must be amended.")
      expect(text).toContain("Choice: <one option letter>")
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })

  test("the kill switch (OPENCODE_AUTO_REMEDIATE=off): today's exact behavior — no diagnosis session, no document, the honest located-file line surviving", async () => {
    clampSwitches({ remediate: false })
    try {
      expect(autoSwitches().remediate).toBe(false)
      const f = await diagnosisFixture(contraryTurn(() => THE_PLAN))
      try {
        const { code, lines } = await f.run({ planInput: { text: CONTRARY_INPUT }, intent: "verify", routing: routing() })
        expect(code).toBe(2)
        // The located-file line (D2) survives the switch — mechanical truth.
        expect(lines.some((line) => line.includes("the conflicting span is"))).toBe(true)
        expect(lines.some((line) => line.includes("consented remediation is switched off"))).toBe(true)
        // No diagnosis session, no document, no blockage commit.
        expect(f.agent.prompts.some((prompt) => prompt.text.includes("You are the blockage diagnosis session"))).toBe(false)
        expect(existsSync(join(f.dir, "docs/R-01/blockage-1.md"))).toBe(false)
        expect((await f.git("log", "--pretty=%B", "--all")).includes("Auto-Stage: blockage")).toBe(false)
      } finally {
        await rm(f.dir, { recursive: true, force: true })
      }
    } finally {
      clampSwitches({ remediate: true })
    }
  })
})

// The interactive fast path (§6 D9): the sideband pick writes the same
// Choice line and the executor runs inline, the loop resuming without a
// process exit; declining or quitting leaves exactly the detached state.
describe("the interactive fast path (plans/0082 §6 D9)", () => {
  const ADVICE_PLAN = [
    "## Analysis",
    "",
    "The input contradicts the charter.",
    "",
    "## Options",
    "",
    "### A Amend by hand",
    "Channel: advice",
    "Advice: rewrite the planning input",
    "Consequences: the person rules",
    "Recommendation: A",
  ].join("\n")

  function fakeSideband(answers: string[]): Interactive & { asked: string[] } {
    const asked: string[] = []
    let n = 0
    return {
      asked,
      attach() {},
      question(prompt) {
        asked.push(prompt)
        return Promise.resolve(answers[n++] ?? "decline")
      },
      close() {},
    }
  }

  test("the pick writes the Choice line, the executor runs inline, the step re-verifies — two remediations then the stop (the bound beside the caps)", async () => {
    const repl = fakeSideband(["A", "A"])
    const f = await diagnosisFixture(contraryTurn(() => ADVICE_PLAN))
    try {
      const { code, lines } = await f.run({ planInput: { text: CONTRARY_INPUT }, intent: "verify", routing: routing(), repl })
      // Two inline remediations executed (advice records, no target writes),
      // the third pass stops at the loop's bound.
      expect(code).toBe(2)
      expect(lines.some((line) => line.includes("remediation executed inline"))).toBe(true)
      expect(lines.some((line) => line.includes("re-blocked after two inline remediations"))).toBe(true)
      // The sideband offered the options twice; each pick wrote the same
      // Choice line the detached protocol would.
      expect(repl.asked.length).toBe(2)
      expect(repl.asked[0]).toContain("pick a remediation option")
      expect(repl.asked[0]).toContain("A: Amend by hand")
      const doc1 = await Bun.file(join(f.dir, "docs/R-01/blockage-1.md")).text()
      expect(doc1).toMatch(/Choice: A/)
      expect(doc1).toMatch(/Executed: A \(no commits — advice recorded\)/)
      const doc2 = await Bun.file(join(f.dir, "docs/R-01/blockage-2.md")).text()
      expect(doc2).toMatch(/Choice: A/)
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })

  test("declining leaves exactly the detached state — the mark can be added later by hand", async () => {
    const repl = fakeSideband(["not now"])
    const f = await diagnosisFixture(contraryTurn(() => ADVICE_PLAN))
    try {
      const { code, lines } = await f.run({ planInput: { text: CONTRARY_INPUT }, intent: "verify", routing: routing(), repl })
      expect(code).toBe(2)
      expect(lines.some((line) => line.includes("sideband pick declined"))).toBe(true)
      const doc = await Bun.file(join(f.dir, "docs/R-01/blockage-1.md")).text()
      expect(doc).toContain("Choice: <one option letter>")
      expect(doc).not.toMatch(/^Executed:/m)
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })
})

// The render gate's covered block site (D10 v1's third): a violated assert
// throws PromptGuaranteeError at the render exit; the run boundary catches
// it, the dossier assembles over the offending literals (same shape: the
// violated assert, the literals, the located sources) and the blockage
// machinery owns the decision.
describe("the render gate's covered block site (plans/0082 §7 D10 v1)", () => {
  test("a violated assert: the catch names the located source of the literal, then the blockage document", async () => {
    const ASSERT_PACK = `# verify\n\n## guarantees\n\n### asserts\n\nimplement-plan: must-not "Copy the reference implementation"\n\n### verify-plan\n\n${CHARTER}\n`
    const f = await loopFixture("m", (dir) => ({ turn: (ctx) => diagnosisTurn(dir, () => THE_PLAN)(ctx) ?? artifactTurns(dir)(ctx) ?? undefined }))
    await mkdir(join(f.dir, ".opencode", "auto", "intents"), { recursive: true })
    await writeFile(join(f.dir, ".opencode", "auto", "intents", "verify.md"), ASSERT_PACK)
    await establishRound(f.dir, { phases: "m" })
    await f.commit("round setup")
    try {
      // The planning input is admitted and saved first (its own commit), so
      // the literal's source file exists on disk for the locator.
      const { savePlanInput } = await import("../src/plan-input")
      const phase = (await f.phase(0))!
      await savePlanInput(f.dir, { round: "R-01", id: phase.id, dir: phase.dir }, { text: CONTRARY_INPUT }, "P01-implement Implementation")
      // The render exit throws; the boundary's arm (the same function
      // loop.ts's catch calls) turns it into the honest lines + the document.
      const violation = 'the active intent pack "verify" guarantees this prompt and it failed: implement-plan must not contain "Copy the reference implementation" \u2014 found in the composed prompt'
      const { openRenderGateBlockage } = await import("../src/blockage-diagnose")
      const result = await openRenderGateBlockage({ directory: f.dir, violation, server: { client: async () => f.agent.client, syncContext: async () => {}, restart: async () => true, contextLimits: async () => new Map(), close: () => {} }, opts: { dir: f.dir, intent: "verify", routing: routing() } })
      // The offending literal located its source: the person's input file,
      // not an assumed role (D2).
      expect(result.status).toBe("documented")
      const doc = await Bun.file(join(f.dir, "docs/R-01/blockage-1.md")).text()
      expect(doc).toContain("- Gate: render-gate")
      expect(doc).toContain("Copy the reference implementation")
      expect(doc).toContain("docs/R-01/P01-implement/plan-input.md:1")
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })
})

// The two-consecutive-reblocks suspension (D8), driven over the round's
// documents directly: the gate derives from disk, so seeding the two
// executed documents suspends before any session opens.
describe("the diagnosis caps (plans/0082 §5 D8)", () => {
  const executedDoc = (seq: number) =>
    [
      `# Blockage ${seq}: plan-verify (phase-plan R-01.P01)`,
      "",
      "- Step: implement-plan R-01.P01",
      "",
      "## Analysis",
      "",
      "x",
      "",
      "## Decision",
      "",
      "Choice: A",
      `Executed: A (${"a".repeat(7)})`,
      "",
    ].join("\n")

  test("two executed documents of one step suspend the diagnosis: static message + full audit pointer, no session", async () => {
    const f = await diagnosisFixture(contraryTurn(() => THE_PLAN))
    try {
      await writeFile(join(f.dir, "docs/R-01/blockage-1.md"), executedDoc(1))
      await writeFile(join(f.dir, "docs/R-01/blockage-2.md"), executedDoc(2))
      await f.commit("the two executed blockages")
      const { code, lines } = await f.run({ planInput: { text: CONTRARY_INPUT }, intent: "verify", routing: routing() })
      expect(code).toBe(2)
      expect(lines.some((line) => line.includes("diagnosis for implement-plan R-01.P01 is suspended"))).toBe(true)
      expect(lines.some((line) => line.includes("prompt-audit.md"))).toBe(true)
      expect(f.agent.prompts.some((prompt) => prompt.text.includes("You are the blockage diagnosis session"))).toBe(false)
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })
})

// The write-time handover check (§10 D14a): one verifier call over the
// charter and the handover; INCONSISTENT re-dists once with the verdict,
// then fails closed — where the blockage machinery owns the decision.
describe("the write-time handover check (plans/0082 §10 D14a)", () => {
  const HANDOVER_VERIFY_MARK = "You read one prompt that a planning step"
  test("an inconsistent handover re-dists once with the verdict, then fails closed with the blockage document", async () => {
    // An mv round whose first phase is already done: the loop routes
    // straight to its handover, and the write-time gate checks the distilled
    // document. The distiller writes the handover every time; the verifier
    // replies no both times.
    const escalation = ["## Analysis", "", "The handover launders a default.", "", "## Escalation", "", "No safe edit exists: the person must rule on the carve-out.", ""].join("\n")
    const f = await loopFixture("mv", (dir) => ({
      turn: (ctx) => {
        if (ctx.text.includes(HANDOVER_VERIFY_MARK)) {
          return [ev.text(ctx.session, `vrf_${ctx.n}`, 'Consistent: no — the charter\'s "never to be read" contradicts the handover\'s "read the reference for the carve-out" (in the handovers)'), ev.idle(ctx.session)]
        }
        diagnosisTurn(dir, () => escalation)(ctx)
        return artifactTurns(dir)(ctx) ?? undefined
      },
    }))
    await mkdir(join(f.dir, ".opencode", "auto", "intents"), { recursive: true })
    await writeFile(join(f.dir, ".opencode", "auto", "intents", "verify.md"), CHARTER_PACK)
    await establishRound(f.dir, { phases: "mv" })
    // The phase's one task, already done: the loop routes straight to the
    // handover.
    const phase = await f.phase(0)
    await mkdir(join(f.dir, phase.dir), { recursive: true })
    await writeFile(join(f.dir, phase.dir, "tasks.md"), "- [x] T-001 task T-001\n")
    await mkdir(join(f.dir, "docs/T-001"), { recursive: true })
    await writeFile(join(f.dir, "docs/T-001/done.md"), "# T-001: task T-001\nPhase: R-01.P01\n\nbody\n\n<!-- auto: eof -->\n")
    await f.commit("round setup")
    try {
      const { code, lines } = await f.run({ intent: "verify", routing: routing() })
      expect(code).toBe(2)
      // One re-distill: two distillation sessions, two verifier calls, then
      // the fail-closed line and the blockage document.
      expect(lines.some((line) => line.includes("handover distillation failed closed on the charter check after one re-distill"))).toBe(true)
      expect(lines.some((line) => line.includes("handover verification found"))).toBe(true)
      const distills = f.agent.prompts.filter((prompt) => prompt.text.includes("You are the handover distiller"))
      expect(distills.length).toBe(2)
      const checks = f.agent.prompts.filter((prompt) => prompt.text.includes(HANDOVER_VERIFY_MARK))
      expect(checks.length).toBe(2)
      const audit = await Bun.file(join(f.dir, "docs/R-01/prompt-audit.md")).text()
      expect(audit).toContain("handover R-01.P01: INCONSISTENT")
      expect(existsSync(join(f.dir, "docs/R-01/blockage-1.md"))).toBe(true)
      const doc = await Bun.file(join(f.dir, "docs/R-01/blockage-1.md")).text()
      expect(doc).toContain("- Gate: handover-verify")
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  })
})
