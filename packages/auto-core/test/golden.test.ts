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
import { renderDigestIndex } from "../src/knowledge"
import { loadIntents, packSubsection, resolveIntent } from "../src/intent/load"
import { loadModes } from "../src/mode"
import { planOf } from "./fixtures/units"
import {
  promptCtx,
  renderContextBase,
  renderDecompose,
  renderDryrun,
  renderFanout,
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
import { promptFacts } from "../src/prompt-facts"
import { promptViews } from "../src/tasks"
import { taskDocPaths } from "../src/docpaths"
import type { ResolveItem } from "../src/resolve"
import type { StuckHit } from "../src/stuck"
import { renderTemplate, renderText } from "../src/template"
import { phaseTypeOfLetter, planDutiesPartial, type PhaseLetter } from "../src/phases/registry"
import { workOrder } from "../src/work-order"

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

// E2 render inputs: the facts (default globals — built-in pack, ask off, no
// attending human), the plan/task views and the task's document paths.
const facts = promptFacts()
const views = promptViews(plan, task)
const docs = taskDocPaths(task.id)
// The planning renders' duty paragraph (the registry's own data, rendered
// through the active library — loop-plan's helper, replicated for the
// fixture): a builtin type's shared partial.
const duties = (letter: PhaseLetter) => renderText(`{{> ${planDutiesPartial(phaseTypeOfLetter(letter))}}}`, {}).trimEnd()

const run: ScriptRun = { script: "test/check.sh", code: 1, ms: 1234, timedOut: false, out: "/repo/tmp/test.1.out" }
const resolves: ResolveItem[] = [{ at: 0, task: task.id, phase: "m", round: 1, source: "driver", question: "strategy A or B?" }]
const stuck = (level: number): StuckHit => ({ kind: "repeat", tool: "bash", count: 3, level, input: "git status", detail: "(empty)" })

// Common switch combination for task-level renders: covers the
// testByDriver/handoverTest conditional blocks and mode injection.
const execOpts = { testByDriver: true, handoverTest: true, mode: migrate }

describe("golden render snapshots", () => {
  test("fork-base session", () => {
    golden("context-base", renderContextBase(facts, task, "Prior distillation summary (fixed input)."))
  })

  test("decompose family (six phases + generic fallback)", () => {
    for (const phase of ["a", "d", "m", "t", "v", "k"] as PhaseLetter[]) {
      golden(`decompose-${phase}`, renderDecompose(facts, views.plan, views.task, docs, { ...execOpts, phase: { id: "R-01.P02", entry: phaseTypeOfLetter(phase) } }))
    }
    // D18 (plans/0068 S5): one decompose render above a parallel level — the
    // `## parallelism` subsection of the configured level, framed onto the
    // checklist items; every golden above renders at none and stays
    // byte-identical (the byte-identical floor).
    golden(
      "decompose-m-parallel-high",
      renderDecompose(facts, views.plan, views.task, docs, { ...execOpts, phase: { id: "R-01.P02", entry: phaseTypeOfLetter("m") }, parallel: "high" }),
    )
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
        promptCtx(facts, {
          ...genericCtx,
          decomposeRule: rule && renderText(rule, genericCtx),
          contextDigest: digest && renderText(digest, genericCtx),
        }),
      ),
    )
  })

  test("execution family (subtask/whole-task/wrap-up)", () => {
    golden("subtask", renderSubtask(facts, views.plan, views.task, docs, "write the execution logic", { ...execOpts, index: 2 }))
    // A stream of auto's split without a fork of the lead (or continuing from
    // its handover): the full prompt with the context-budget protocol
    // (plans/0059 D5).
    golden("subtask-budget", renderSubtask(facts, views.plan, views.task, docs, "write the execution logic", { ...execOpts, index: 2, budget: true }))
    // The delta a fork of the lead gets (plans/0059 D5): a dependent stream
    // with the files changed since the split, the protocol and the test
    // handover; then the last stream, independent, with neither.
    golden(
      "fanout",
      renderFanout(facts, views.plan, views.task, docs, "write the execution logic: src/exec.ts, verify with its test Depends: S01 Artifacts: src/exec.ts", 2, {
        ...execOpts,
        siblings: ["S01 write the schema part (done)", "S03 write the docs"],
        changed: ["src/schema.ts", "test/schema.test.ts"],
        budget: true,
      }),
    )
    golden(
      "fanout-last",
      renderFanout(facts, views.plan, views.task, docs, "write the docs: README.md, verify by reading it back Depends: none Artifacts: README.md", 3, {
        siblings: ["S01 write the schema part (done)", "S02 write the execution logic (done)"],
        last: true,
      }),
    )
    // The cold-start delta a stream LANE gets (plans/0068 S5/D19): no fork
    // holds the task, so the delta is the whole prompt — the task block, the
    // stream's own scope file in full, the per-stream handoff document, and
    // the changed files since the split for the dependent stream.
    golden(
      "fanout-cold",
      renderFanout(facts, views.plan, views.task, docs, "write the execution logic: src/exec.ts, verify with its test Depends: S01 Artifacts: src/exec.ts", 2, {
        ...execOpts,
        siblings: ["S01 write the schema part (done)", "S03 write the docs"],
        changed: ["src/schema.ts", "test/schema.test.ts"],
        budget: true,
        cold: true,
        scope: "Depends: S01\nTouches: src/exec.ts\n\n## Scope\n\nwrite the execution logic\n\n## Artifacts\n\n- src/exec.ts\n",
        handoff: "docs/T-002/S02/handoff.md",
      }),
    )
    golden("whole", renderWhole(facts, views.plan, views.task, docs, { ...execOpts, ondemand: true }))
    golden("whole-budget", renderWhole(facts, views.plan, views.task, docs, { ...execOpts, ondemand: true, budget: true }))
    golden("whole-adaptive", renderWhole(facts, views.plan, views.task, docs, { ...execOpts, ondemand: true, budget: true, adaptive: true }))
    // D18 (plans/0068 S5): the split clause under a parallel level — the
    // lead arranges its streams for the width they will actually get.
    golden("whole-adaptive-parallel-medium", renderWhole(facts, views.plan, views.task, docs, { ...execOpts, ondemand: true, budget: true, adaptive: true, parallel: "medium" }))
    golden("wrapup", renderWrapup(facts, views.plan, views.task, docs, { mode: migrate, resolves }))
  })

  // The standalone work order (plans/0076, T-137): the constitution preamble
  // (the agents-block single source's second rendering, TEST_PRINCIPLE
  // present under the switch) + the fresh whole-task session's prompt for a
  // ready task (T-003, pending, no checklist — so the split clause is
  // offered), under the attended question flag. The steer switch is on at
  // the unset default, so the render carries the lead's own flags; the
  // readiness composition itself is the prelude's (test/work-order.test.ts).
  test("the standalone work order", async () => {
    golden(
      "work-order",
      await workOrder("/repo", plan, plan.tasks[2]!, { testByDriver: true, handoverTest: true, mode: migrate }),
    )
  })

  test("phase-loop family (planning/handover/knowledge)", () => {
    for (const phase of ["a", "d", "m", "t", "v", "k"] as PhaseLetter[]) {
      golden(
        `phase-plan-${phase}`,
        renderPhasePlan(facts, {
          phase: phaseTypeOfLetter(phase),
          planDuties: duties(phase),
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
      renderPhasePlan(facts, {
        phase: phaseTypeOfLetter("m"),
        planDuties: duties("m"),
        brief: "Project intent (fixed input).",
        mode: migrate,
        phaseId: "R-01.P02",
        taskIndex: "docs/R-01/P02-implement/tasks.md",
        parallel: "high",
      }),
    )
    golden(
      "phase-handover",
      renderPhaseHandover(facts, { phase: phaseTypeOfLetter("m"), handover: "docs/R-01/P02-implement/handover.md", next: "P03-test Testing" }),
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
      renderPhaseAppend(facts, {
        phase: phaseTypeOfLetter("m"),
        planDuties: duties("m"),
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
      renderPhaseAppend(facts, {
        phaseId: "R-01.P01",
        taskIndex: "docs/R-01/P01-implement/tasks.md",
        numberStart: 4,
        input: "Append input (fixed input).",
        inputPath: "docs/R-01/P01-implement/plan-input.md",
        existingTasks,
      }),
    )
    golden("knowledge", renderKnowledge(facts, { file: "docs/R-01/P04-knowledge/kb.md", mode: migrate }))
    golden(
      "prior-knowledge",
      renderPriorKnowledge(facts, { file: "docs/R-01/temp-kb.md", brief: "Second-pass migration intent.", mode: migrate, distilled: ["docs/R-00/prior-kb.md"] }),
    )
    // The capped digest's index form (plans/0061 R3/A7): what fills the
    // phase-plan prevRound slot when the joined digest exceeds the cap.
    golden(
      "digest-index",
      renderDigestIndex(
        [
          { file: join("docs", "R-01", "P02-implement", "handover.md"), tokens: 21_400 },
          { file: join("docs", "R-01", "P03-knowledge", "kb.md"), tokens: 18_250 },
          { file: join("docs", "R-02", "prior-kb.md"), tokens: 8_650 },
        ],
        { total: 48_300, cap: 16_000 },
      ),
    )
  })

  test("bypass family (plan generation/number recovery/handover steer/stuck loop/dryrun)", () => {
    golden("implement-plan", renderImplementPlan(facts, { content: "Full implementation prompt (fixed input).", brief: "Project intent.", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md" }))
    golden(
      "implement-plan-parallel-medium",
      renderImplementPlan(facts, { content: "Full implementation prompt (fixed input).", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", parallel: "medium" }),
    )
    golden("implement-plan-file", renderImplementPlan(facts, { file: "spec.md", content: "Full plan file (fixed input).", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", numberStart: 4 }))
    golden("number-recovery", renderNumberRecovery(facts, { floor: 7 }))
    golden("handoff-steer", renderHandoffSteer(facts, docs))
    golden("usage-note-info", renderUsageNoteInfo(facts, docs))
    golden("usage-note-winddown", renderUsageNoteWinddown(facts, docs))
    golden("split-rejected", renderSplitRejected(facts, docs, "1 item, where a split takes 2 to 5 streams", true))
    golden("stuck-hint-1", renderStuckHint(facts, stuck(1)))
    golden("stuck-hint-2", renderStuckHint(facts, stuck(2)))
    golden("stuck-hint-3", renderStuckHint(facts, stuck(3)))
    golden("dryrun", renderDryrun(facts))
  })

  test("test-handover family", () => {
    golden("test-result", renderTestResult(facts, { ...run, seq: 1 }))
    golden("test-wrapup", renderTestWrapup(facts, { handoffFile: "docs/T-002/testhandoff.md" }))
    golden("test-continue", renderTestContinue(facts, { handoffFile: "docs/T-002/testhandoff-1.md", run: { ...run, seq: 1 } }))
  })

  test("agent contract (testByDriver two states)", async () => {
    golden("agent-contract-plain", await renderAgentContract(false))
    golden("agent-contract-testbydriver", await renderAgentContract(true))
  })
})
