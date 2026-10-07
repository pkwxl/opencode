// The remediation executor (plans/0082 §5 D7) over real temp repositories:
// the write ratchet in the chain-writes pattern — zero target writes outside
// the enumerated edit spec plus the documented commit stages — and the three
// discipline arms: old-span literal match (a stale document re-blocks, never
// a blind overwrite), mid-sequence commit failure (the partial state named),
// driver-exclusive refusal. Prelude row routing (mark present / absent /
// already executed) runs through planPrelude itself, the row the design
// names (D7: after round establishment, immediately before the drift
// re-sync).
import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { executeBlockageChoices, executionLines, planInputPhase } from "../src/blockage-execute"
import { appendExecuted } from "../src/blockage-execute"
import { planPrelude } from "../src/plan"
import { establishRound } from "../src/phases"
import { autoSwitches, clampSwitches } from "../src/switches"

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`)
  return out
}

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "auto-remediate-"))
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
  await writeFile(join(dir, ".gitignore"), ".auto/\nhooks/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "setup")
  return dir
}

const HANDOVER = "docs/R-01/P02-design/handover.md"
const HANDOVER_LINES = ["# Handover", "", "## Constraints and pitfalls", "", "uapi ABI-constant carve-out (AUTO-RESOLVE, T-011 §6.3): include/uapi/linux/ext4.h may be read by grep/extract for constants only", "", "## Artifact index", "", "- none", ""]

// One blockage document with a chosen option whose single edit rewrites the
// carve-out line (the incident's option A).
function blockageDoc(input: { seq?: number; choice?: string; option?: string; editPath?: string; first?: number; last?: number; channel?: string; secondEdit?: boolean } = {}): string {
  const seq = input.seq ?? 1
  const choice = input.choice ?? "A"
  const channel = input.channel ?? "handover-edit"
  const path = input.editPath ?? HANDOVER
  const first = input.first ?? 5
  const last = input.last ?? 5
  const oldLine = "uapi ABI-constant carve-out (AUTO-RESOLVE, T-011 §6.3): include/uapi/linux/ext4.h may be read by grep/extract for constants only"
  return [
    `# Blockage ${seq}: plan-verify (phase-plan R-01.P03)`,
    "",
    "- Round: R-01",
    "- Gate: plan-verify",
    "- Step: phase-plan R-01.P03",
    "- Verdict: INCONSISTENT — the wall",
    "",
    "## Analysis",
    "",
    "The carve-out launders a provisional default into a constraint.",
    "",
    "## Options",
    "",
    "### A Tighten the handover",
    `Channel: ${channel}`,
    "Edits:",
    `1. ${path} — replace lines ${first}–${last} (${oldLine} | ${oldLine}) with:`,
    "constants come from the restated ABI in the spec notes; no reference-header reads",
    ...(input.secondEdit
      ? [`2. ${path} — replace lines 9–9 (- none | - none) with:`, "- the tightened handover"]
      : []),
    "Consequences: the wall is strict",
    ...(input.option === "B"
      ? ["### B Advice only", "Channel: advice", "Advice: opencode-auto plan <dir> --append -p <text>", "Consequences: the person rules"]
      : []),
    "Recommendation: A",
    "",
    "## Decision",
    "",
    `Choice: ${choice}`,
    "Notes: <optional>",
    "",
    "## Execution protocol",
    "",
    "1. (the protocol the document ships with)",
    "",
  ].join("\n")
}

async function seededDoc(dir: string, doc: string, file = "docs/R-01/blockage-1.md"): Promise<void> {
  await mkdir(join(dir, "docs/R-01"), { recursive: true })
  await writeFile(join(dir, file), doc)
  await mkdir(dirname(join(dir, HANDOVER)), { recursive: true })
  await writeFile(join(dir, HANDOVER), HANDOVER_LINES.join("\n"))
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "the blockage")
}

const stageOf = async (dir: string) => (await git(dir, "log", "--pretty=%B", "--all")).split("\n").filter((line) => line.startsWith("Auto-Stage:")).map((line) => line.trim())

describe("the executor's write ratchet (plans/0082 §5 D7, the chain-writes pattern)", () => {
  test("an executed mark: exactly the enumerated edits land, one remediation commit each, the Executed line records the shas, and nothing else is written", async () => {
    const dir = await repo()
    try {
      // The canary: a file the plan never names must stay byte-identical, and
      // no commit outside the documented stages may appear.
      await writeFile(join(dir, "canary.txt"), "untouched")
      await seededDoc(dir, blockageDoc({ secondEdit: true }))
      const outcome = await executeBlockageChoices(dir, 1)
      expect(outcome).toMatchObject({ type: "executed", file: "docs/R-01/blockage-1.md", option: "A" })
      if (outcome.type !== "executed") return
      expect(outcome.edits).toEqual([HANDOVER, HANDOVER])
      expect(await Bun.file(join(dir, "canary.txt")).text()).toBe("untouched")
      // The first edit's replacement is in place; the second edit shifted the
      // file and still applied by its anchors (the literal-match rule).
      const text = await Bun.file(join(dir, HANDOVER)).text()
      expect(text).toContain("constants come from the restated ABI in the spec notes; no reference-header reads")
      expect(text).toContain("- the tightened handover")
      expect(text).not.toContain("may be read by grep/extract")
      // The document carries the execution record with the commits' shas.
      const doc = await Bun.file(join(dir, "docs/R-01/blockage-1.md")).text()
      expect(doc).toMatch(/Executed: A \([0-9a-f]+, [0-9a-f]+\)/)
      // The ratchet itself: every commit is a remediation commit (the setup
      // and the blockage commits precede), and the tree ends clean.
      const stages = await stageOf(dir)
      expect(stages.every((stage) => stage === "Auto-Stage: remediation" || stage === "Auto-Stage: the blockage placeholder")).toBe(true)
      expect(stages.filter((stage) => stage === "Auto-Stage: remediation").length).toBeGreaterThanOrEqual(3)
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the planning-input channel maps onto its existing write path: its own commit stage, the input text verbatim", async () => {
    const dir = await repo()
    try {
      await mkdir(join(dir, "docs/R-01/P03-implement"), { recursive: true })
      await seededDoc(dir, blockageDoc({ channel: "planning-input", editPath: "docs/R-01/P03-implement/plan-input.md" }))
      const outcome = await executeBlockageChoices(dir, 1)
      expect(outcome.type).toBe("executed")
      expect(await Bun.file(join(dir, "docs/R-01/P03-implement/plan-input.md")).text()).toBe("constants come from the restated ABI in the spec notes; no reference-header reads\n")
      const stages = await stageOf(dir)
      expect(stages).toContain("Auto-Stage: plan-input")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the advice channel executes nothing: the advice recorded, no target writes", async () => {
    const dir = await repo()
    try {
      await seededDoc(dir, blockageDoc({ choice: "B", option: "B" }))
      const outcome = await executeBlockageChoices(dir, 1)
      expect(outcome).toMatchObject({ type: "executed", option: "B", edits: [] })
      if (outcome.type !== "executed") return
      expect(outcome.advice).toEqual(["opencode-auto plan <dir> --append -p <text>"])
      expect(await Bun.file(join(dir, HANDOVER)).text()).toBe(HANDOVER_LINES.join("\n"))
      const doc = await Bun.file(join(dir, "docs/R-01/blockage-1.md")).text()
      expect(doc).toMatch(/Executed: B \(no commits — advice recorded\)/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("old-span mismatch re-blocks: the file changed since diagnosis, nothing is written, no Executed line", async () => {
    const dir = await repo()
    try {
      await seededDoc(dir, blockageDoc())
      // The person edited the handover after the diagnosis.
      const shifted = [...HANDOVER_LINES]
      shifted[4] = "uapi ABI-constant carve-out — REWRITTEN BY HAND meanwhile"
      await writeFile(join(dir, HANDOVER), shifted.join("\n"))
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "hand edit")
      const outcome = await executeBlockageChoices(dir, 1)
      expect(outcome.type).toBe("reblocked")
      if (outcome.type === "reblocked") expect(outcome.reason).toContain("changed since diagnosis")
      expect(await Bun.file(join(dir, HANDOVER)).text()).toBe(shifted.join("\n"))
      expect((await Bun.file(join(dir, "docs/R-01/blockage-1.md")).text()).includes("Executed:")).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a mid-sequence commit failure stops the sequence and names the partial state", async () => {
    const dir = await repo()
    try {
      await seededDoc(dir, blockageDoc({ secondEdit: true }))
      // A pre-commit hook that fails from the second commit on: the first
      // edit commits, the second's commit fails with the edit in the worktree.
      // The hook fails from the second remediation commit on: the first edit
      // commits (pre-commit sees the seeded count), the second's fails. The
      // hooks directory is gitignored, so the hook never dirties the tree.
      await mkdir(join(dir, "hooks"))
      const base = Number((await git(dir, "rev-list", "--count", "HEAD")).trim())
      await writeFile(join(dir, "hooks", "pre-commit"), `#!/bin/sh\nn=$(git rev-list --count HEAD)\nif [ "$n" -gt ${base} ]; then exit 1; fi\nexit 0\n`, { mode: 0o755 })
      await git(dir, "config", "core.hooksPath", "hooks")
      const outcome = await executeBlockageChoices(dir, 1)
      expect(outcome.type).toBe("reblocked")
      if (outcome.type === "reblocked") {
        expect(outcome.reason).toContain("partial state")
        expect(outcome.landed).toEqual([HANDOVER])
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("driver-exclusive state is refused before anything is written", async () => {
    const dir = await repo()
    try {
      await seededDoc(dir, blockageDoc({ editPath: "docs/R-01/phases.md" }))
      const outcome = await executeBlockageChoices(dir, 1)
      expect(outcome.type).toBe("reblocked")
      if (outcome.type === "reblocked") expect(outcome.reason).toContain("remediation never touches")
      expect((await Bun.file(join(dir, "docs/R-01/blockage-1.md")).text()).includes("Executed:")).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the pure helpers: the execution-record append and the plan-input path shape", () => {
    expect(appendExecuted("## Decision\n\nChoice: A\n", "A", ["sha1"])).toBe("## Decision\n\nChoice: A\nExecuted: A (sha1)\n")
    expect(planInputPhase("docs/R-01/P03-implement/plan-input.md")).toEqual({ round: "R-01", id: "P03", dir: "docs/R-01/P03-implement" })
    expect(planInputPhase("docs/R-01/round.md")).toBeUndefined()
    expect(executionLines({ type: "none" })).toEqual([])
    expect(executionLines({ type: "reblocked", landed: [], reason: "r" })).toEqual(["⏸ remediation re-blocked: r"])
  })
})

describe("prelude row routing (plans/0082 §5 D7: mark present / absent / already executed)", () => {
  test("no document and no mark: the row is a no-op and the loop route is untouched", async () => {
    const dir = await repo()
    try {
      await establishRound(dir, { phases: "m" })
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const prelude = await planPrelude(dir, { phases: "m" })
      // The row is a no-op: the prelude reaches m mode's normal empty-index
      // notice (row 8), unblocked by any remediation stop.
      expect(prelude.type).toBe("stop")
      if (prelude.type === "stop") expect(prelude.code).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an unexecuted mark routes through the executor before anything else decides", async () => {
    const dir = await repo()
    try {
      await establishRound(dir, { phases: "m" })
      await mkdir(join(dir, "docs/R-01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/blockage-1.md"), blockageDoc())
      await mkdir(dirname(join(dir, HANDOVER)), { recursive: true })
      await writeFile(join(dir, HANDOVER), HANDOVER_LINES.join("\n"))
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "the blockage")
      // An m-mode round with a task listed routes to execute; the executor
      // row runs before that decision either way (it is the prelude's first
      // write).
      await mkdir(join(dir, "docs/R-01/P01-implement"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/P01-implement/tasks.md"), "- [ ] T-001 task T-001\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "tasks")
      const prelude = await planPrelude(dir, { phases: "m" })
      // The mark executed on the way to m mode's execute notice (row 9).
      expect(prelude.type).toBe("stop")
      expect(await Bun.file(join(dir, HANDOVER)).text()).toContain("constants come from the restated ABI")
      // The second run: the mark is executed, the row is a no-op again.
      const again = await planPrelude(dir, { phases: "m" })
      expect(again.type).toBe("stop")
      const stages = await stageOf(dir)
      expect(stages).toContain("Auto-Stage: remediation")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a refusal stops the prelude with the partial state named (exit 2)", async () => {
    const dir = await repo()
    try {
      await establishRound(dir, { phases: "m" })
      await mkdir(join(dir, "docs/R-01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/blockage-1.md"), blockageDoc())
      await mkdir(dirname(join(dir, HANDOVER)), { recursive: true })
      // The handover never exists: the old span cannot match → re-block.
      await writeFile(join(dir, HANDOVER), "entirely different content\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "the blockage")
      const prelude = await planPrelude(dir, { phases: "m" })
      expect(prelude.type).toBe("stop")
      if (prelude.type === "stop") {
        expect(prelude.code).toBe(2)
        expect(prelude.lines[0]).toContain("remediation re-blocked")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// The kill switch (D8): off returns today's exact behavior — the executor is
// not the switch's subject (it executes marks the person wrote either way),
// the diagnosis is; the switch's own arm lives in the diagnosis suite. What
// pins here: the switch parses, defaults on, and only removes.
describe("the remediation kill switch (plans/0082 §5 D8)", () => {
  afterAll(() => {
    clampSwitches({ remediate: true })
  })
  test("OPENCODE_AUTO_REMEDIATE clamps off without touching the rest of the snapshot", async () => {
    clampSwitches({ remediate: false })
    expect(autoSwitches().remediate).toBe(false)
    expect(autoSwitches().planVerify).toBe(true)
    clampSwitches({ remediate: true })
    expect(autoSwitches().remediate).toBe(true)
  })
})
