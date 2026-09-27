// Golden render snapshots (M0.2, plans/AUTO_NEXT_REFACTOR_PLAN.md): fixed
// plan/task/opts inputs render every session template + agent contract; the
// output is frozen in test/golden/*.golden.md. The pure moves of the
// intent-externalization milestones (M1–M4) verify byte equivalence against
// them (F9); update snapshots with: UPDATE_GOLDEN=1 bun test test/golden.test.ts.
// Determinism basis: plan.dir uses the fixed absolute path /repo (task units,
// M3.4), switches take defaults (env unset), mode uses the builtin migrate
// preset.

import { describe, expect, test } from "bun:test"
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { renderAgentContract } from "../src/config-fix"
import { loadIntents, packSubsection, resolveIntent } from "../src/intent/load"
import { loadModes } from "../src/mode"
import { planOf } from "./fixtures/units"
import {
  promptCtx,
  renderContextBase,
  renderDecompose,
  renderDryrun,
  renderHandoffSteer,
  renderKnowledge,
  renderNumberRecovery,
  renderPhaseHandover,
  renderPriorKnowledge,
  renderSplitRejected,
  renderStuckHint,
  renderSubtask,
  renderTestContinue,
  renderTestResult,
  renderTestWrapup,
  renderUsageNoteInfo,
  renderUsageNoteWinddown,
  renderWhole,
  renderWrapup,
  type ScriptRun,
} from "../src/prompt"
import { renderImplementPlan, renderPhaseAppend, renderPhasePlan, existingTaskList } from "../src/prompt-plan"
import type { ResolveItem } from "../src/resolve"
import type { StuckHit } from "../src/stuck"
import { renderTemplate, renderText } from "../src/template"
import { phaseTypeOfLetter, type PhaseLetter } from "../src/phases/registry"

const UPDATE = process.env.UPDATE_GOLDEN === "1"
const GOLDEN_DIR = join(import.meta.dir, "golden")

function golden(name: string, actual: string) {
  const file = join(GOLDEN_DIR, `${name}.golden.md`)
  if (UPDATE) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(file, actual)
    return
  }
  if (!existsSync(file)) throw new Error(`golden missing: ${file} (regenerate with UPDATE_GOLDEN=1)`)
  expect(actual, name).toBe(readFileSync(file, "utf8"))
}

// —— Fixed input fixtures (self-contained in this file, independent of the
// relative-path plan in fixtures/prompt.ts) ——

const plan = planOf(
  `## T-001: build the schema [done]
Modeling.

## T-002: implement the migration [in_progress]
  - verify: command: bun test
Write the migration script.

- [x] write the schema part
- [ ] write the execution logic
- [ ] write the docs

## T-003: write the API [pending]
  - verify: API returns 200
REST endpoints.
`,
  "/repo",
)
const task = plan.tasks[1]!

const migrate = loadModes().migrate!

const run: ScriptRun = { script: "test/check.sh", code: 1, ms: 1234, timedOut: false, out: "/repo/tmp/test.1.out" }
const resolves: ResolveItem[] = [{ at: 0, task: task.id, phase: "m", round: 1, source: "driver", question: "strategy A or B?" }]
const stuck = (level: number): StuckHit => ({ kind: "repeat", tool: "bash", count: 3, level, input: "git status", detail: "(empty)" })

// Common switch combination for task-level renders: covers the
// testByDriver/handoverTest conditional blocks and mode injection.
const execOpts = { testByDriver: true, handoverTest: true, mode: migrate }

describe("golden render snapshots", () => {
  test("fork-base session", () => {
    golden("context-base", renderContextBase(task, "Prior distillation summary (fixed input)."))
  })

  test("decompose family (six phases + generic fallback)", () => {
    for (const phase of ["a", "d", "m", "t", "v", "k"] as PhaseLetter[]) {
      golden(`decompose-${phase}`, renderDecompose(plan, task, { ...execOpts, phase: { id: "R-01.P02", entry: phaseTypeOfLetter(phase) } }))
    }
    // The generic decompose is the fallback when the builtin library has no
    // decompose-<phase>; renderDecompose never reaches it, so it is rendered
    // directly through renderTemplate (ctx assembled on the same basis as
    // baseCtx). Intent injection (M1.2/M1.3) happens in renderDecompose; here
    // the same injection is replicated by hand: the ### decompose subsection
    // of the builtin default intent pack's quality section is evaluated with
    // the same ctx and injected as decomposeRule.
    const genericCtx = {
      ask: false,
      taskId: task.id,
      taskBlock: `# ${task.id}: ${task.title}\n\n${task.body}`,
      doneList: "- [done] T-001: build the schema",
      testByDriver: true,
      phase: "m",
      phaseName: "Implementation",
      contextBudget: "32.0k",
      contextLines: "200",
      modeName: migrate.name,
    }
    const pack = resolveIntent(loadIntents())
    const rule = packSubsection(pack, "quality", "decompose")
    // M2.1: context.md section layout (artifact spec / ### context-digest) and
    // question-rule's governance hook (promptCtx, the render exit's completion).
    const digest = packSubsection(pack, "artifactSpec", "context-digest")
    golden(
      "decompose-generic",
      renderTemplate(
        "decompose",
        promptCtx({
          ...genericCtx,
          decomposeRule: rule && renderText(rule, genericCtx),
          contextDigest: digest && renderText(digest, genericCtx),
        }),
      ),
    )
  })

  test("execution family (subtask/whole-task/wrap-up)", () => {
    golden("subtask", renderSubtask(plan, task, "write the execution logic", { ...execOpts, index: 2 }))
    golden("whole", renderWhole(plan, task, { ...execOpts, ondemand: true }))
    golden("whole-budget", renderWhole(plan, task, { ...execOpts, ondemand: true, budget: true }))
    golden("whole-adaptive", renderWhole(plan, task, { ...execOpts, ondemand: true, budget: true, adaptive: true }))
    golden("wrapup", renderWrapup(plan, task, { mode: migrate, resolves }))
  })

  test("phase-loop family (planning/handover/knowledge)", () => {
    for (const phase of ["a", "d", "m", "t", "v", "k"] as PhaseLetter[]) {
      golden(
        `phase-plan-${phase}`,
        renderPhasePlan({
          phase: phaseTypeOfLetter(phase),
          brief: "Project intent (fixed input).",
          handovers: "Prior phase handover (fixed input).",
          mode: migrate,
          phaseId: "R-01.P02",
          taskIndex: `docs/R-01/P02-${phaseTypeOfLetter(phase).type}/tasks.md`,
          ...(phase === "m" ? { trimmedPhases: true, numberStart: 5 } : {}),
        }),
      )
    }
    // MP.1: one render above parallel none (the level block); every golden
    // above renders at none and stays byte-identical.
    golden(
      "phase-plan-m-parallel-high",
      renderPhasePlan({
        phase: phaseTypeOfLetter("m"),
        brief: "Project intent (fixed input).",
        mode: migrate,
        phaseId: "R-01.P02",
        taskIndex: "docs/R-01/P02-implement/tasks.md",
        parallel: "high",
      }),
    )
    golden(
      "phase-handover",
      renderPhaseHandover({ phase: phaseTypeOfLetter("m"), handover: "docs/R-01/P02-implement/handover.md", next: "P03-test Testing" }),
    )
    // Append planning (plans/0053 D27): the shared phase-append template, both
    // modes byte-stable. The existing-task lines come from existingTaskList
    // over a fixed task set (a closed task with its reason, a done and a
    // pending one).
    const existingTasks = existingTaskList([
      { id: "T-004", title: "sort out the lexer", status: "done", closed: "superseded by T-006" },
      { id: "T-005", title: "migrate the parser", status: "done" },
      { id: "T-006", title: "wire up the pipeline", status: "pending" },
    ])
    golden(
      "phase-append",
      renderPhaseAppend({
        phase: phaseTypeOfLetter("m"),
        brief: "Project intent (fixed input).",
        handovers: "Prior phase handover (fixed input).",
        mode: migrate,
        phaseId: "R-01.P02",
        taskIndex: "docs/R-01/P02-implement/tasks.md",
        numberStart: 5,
        input: "Append input (fixed input).",
        inputPath: "docs/R-01/P02-implement/plan-input.md",
        existingTasks,
      }),
    )
    golden(
      "phase-append-m",
      renderPhaseAppend({
        phaseId: "R-01.P01",
        taskIndex: "docs/R-01/P01-implement/tasks.md",
        numberStart: 4,
        input: "Append input (fixed input).",
        inputPath: "docs/R-01/P01-implement/plan-input.md",
        existingTasks,
      }),
    )
    golden("knowledge", renderKnowledge({ file: "docs/R-01/P04-knowledge/kb.md", mode: migrate }))
    golden(
      "prior-knowledge",
      renderPriorKnowledge({ file: "docs/R-01/temp-kb.md", brief: "Second-pass migration intent.", mode: migrate, distilled: ["docs/R-00/prior-kb.md"] }),
    )
  })

  test("bypass family (plan generation/number recovery/handover steer/stuck loop/dryrun)", () => {
    golden("implement-plan", renderImplementPlan({ content: "Full implementation prompt (fixed input).", brief: "Project intent.", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md" }))
    golden(
      "implement-plan-parallel-medium",
      renderImplementPlan({ content: "Full implementation prompt (fixed input).", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", parallel: "medium" }),
    )
    golden("implement-plan-file", renderImplementPlan({ file: "spec.md", content: "Full plan file (fixed input).", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", numberStart: 4 }))
    golden("number-recovery", renderNumberRecovery({ floor: 7 }))
    golden("handoff-steer", renderHandoffSteer(task))
    golden("usage-note-info", renderUsageNoteInfo(task))
    golden("usage-note-winddown", renderUsageNoteWinddown(task))
    golden("split-rejected", renderSplitRejected(task, "1 item, where a split takes 2 to 5 streams", true))
    golden("stuck-hint-1", renderStuckHint(stuck(1)))
    golden("stuck-hint-2", renderStuckHint(stuck(2)))
    golden("stuck-hint-3", renderStuckHint(stuck(3)))
    golden("dryrun", renderDryrun())
  })

  test("test-handover family", () => {
    golden("test-result", renderTestResult({ ...run, seq: 1 }))
    golden("test-wrapup", renderTestWrapup({ handoffFile: "docs/T-002/testhandoff.md" }))
    golden("test-continue", renderTestContinue({ handoffFile: "docs/T-002/testhandoff-1.md", run: { ...run, seq: 1 } }))
  })

  test("agent contract (testByDriver two states)", async () => {
    golden("agent-contract-plain", await renderAgentContract(false))
    golden("agent-contract-testbydriver", await renderAgentContract(true))
  })
})
