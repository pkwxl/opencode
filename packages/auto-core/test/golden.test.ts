// golden 渲染快照(M0.2,plans/AUTO_NEXT_REFACTOR_PLAN.md): 固定 plan/task/opts 输入,
// 渲染全部会话模板 + agent 契约,产物固化在 test/golden/*.golden.md。
// 意图外置(M1-M4)的纯搬移段以此做逐字节等价校验(F9);更新快照: UPDATE_GOLDEN=1 bun test test/golden.test.ts。
// 确定性口径: plan.dir 用固定绝对路径 /repo(任务单元,M3.4),
// switches 走缺省(env 未设),mode 用内置 migrate 预置。

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
  renderStuckHint,
  renderSubtask,
  renderTestContinue,
  renderTestResult,
  renderTestWrapup,
  renderWhole,
  renderWrapup,
  type ScriptRun,
} from "../src/prompt"
import { renderImplementPlan, renderPhasePlan } from "../src/prompt-plan"
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
  if (!existsSync(file)) throw new Error(`golden 缺失: ${file}(UPDATE_GOLDEN=1 重新生成)`)
  expect(actual, name).toBe(readFileSync(file, "utf8"))
}

// —— 固定输入夹具(本文件自持,不依赖 fixtures/prompt.ts 的相对路径计划)——

const plan = planOf(
  `## T-001: 搭建 schema [done]
建模。

## T-002: 实现迁移 [in_progress]
  - verify: command: bun test
编写迁移脚本。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档

## T-003: 编写 API [pending]
  - verify: API 返回 200
REST 接口。
`,
  "/repo",
)
const task = plan.tasks[1]!

const migrate = loadModes().migrate!

const run: ScriptRun = { script: "test/check.sh", code: 1, ms: 1234, timedOut: false, out: "/repo/tmp/test.1.out" }
const resolves: ResolveItem[] = [{ at: 0, task: task.id, phase: "m", round: 1, source: "driver", question: "策略选 A 还是 B?" }]
const stuck = (level: number): StuckHit => ({ kind: "repeat", tool: "bash", count: 3, level, input: "git status", detail: "(空)" })

// 任务级渲染的公共开关组合: 覆盖 testByDriver/handoverTest 条件段与模式注入。
const execOpts = { testByDriver: true, handoverTest: true, mode: migrate }

describe("golden 渲染快照", () => {
  test("分叉基点会话", () => {
    golden("context-base", renderContextBase(task, "前序蒸馏摘要(固定输入)。"))
  })

  test("分解族(六阶段 + 通用兜底)", () => {
    for (const phase of ["a", "d", "m", "t", "v", "k"] as PhaseLetter[]) {
      golden(`decompose-${phase}`, renderDecompose(plan, task, { ...execOpts, phase: { id: "R-01.P02", entry: phaseTypeOfLetter(phase) } }))
    }
    // 通用 decompose 是内置库缺 decompose-<phase> 时的兜底,renderDecompose 到不了,
    // 直接经 renderTemplate 渲染(ctx 与 baseCtx 同口径组装)。意图注入(M1.2/M1.3)由
    // renderDecompose 完成,此处手动复刻同一注入:内置 default 意图包 quality 节的
    // ### decompose 子节以同一 ctx 求值后作为 decomposeRule 注入。
    const genericCtx = {
      ask: false,
      taskId: task.id,
      taskBlock: `# ${task.id}: ${task.title}\n\n${task.body}`,
      doneList: "- [done] T-001: 搭建 schema",
      testByDriver: true,
      phase: "m",
      phaseName: "实现迁移",
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

  test("执行族(子任务/整任务/收尾)", () => {
    golden("subtask", renderSubtask(plan, task, "编写执行逻辑", { ...execOpts, index: 2 }))
    golden("whole", renderWhole(plan, task, { ...execOpts, ondemand: true }))
    golden("wrapup", renderWrapup(plan, task, { mode: migrate, resolves }))
  })

  test("阶段循环族(规划/交接/知识)", () => {
    for (const phase of ["a", "d", "m", "t", "v", "k"] as PhaseLetter[]) {
      golden(
        `phase-plan-${phase}`,
        renderPhasePlan({
          phase: phaseTypeOfLetter(phase),
          brief: "项目意图(固定输入)。",
          handovers: "前序阶段交接(固定输入)。",
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
        brief: "项目意图(固定输入)。",
        mode: migrate,
        phaseId: "R-01.P02",
        taskIndex: "docs/R-01/P02-implement/tasks.md",
        parallel: "high",
      }),
    )
    golden(
      "phase-handover",
      renderPhaseHandover({ phase: phaseTypeOfLetter("m"), handover: "docs/R-01/P02-implement/handover.md", next: "P03-test 测试" }),
    )
    golden("knowledge", renderKnowledge({ file: "docs/R-01/P04-knowledge/kb.md", mode: migrate }))
    golden(
      "prior-knowledge",
      renderPriorKnowledge({ file: "docs/R-01/temp-kb.md", brief: "二次迁移意图。", mode: migrate, distilled: ["docs/R-00/prior-kb.md"] }),
    )
  })

  test("旁路族(计划生成/编号恢复/交接steer/死循环/干跑)", () => {
    golden("implement-plan", renderImplementPlan({ content: "实施提示词全文(固定输入)。", brief: "项目意图。", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md" }))
    golden(
      "implement-plan-parallel-medium",
      renderImplementPlan({ content: "实施提示词全文(固定输入)。", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", parallel: "medium" }),
    )
    golden("implement-plan-file", renderImplementPlan({ file: "spec.md", content: "计划文件全文(固定输入)。", phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", numberStart: 4 }))
    golden("number-recovery", renderNumberRecovery({ floor: 7 }))
    golden("handoff-steer", renderHandoffSteer(task))
    golden("stuck-hint-1", renderStuckHint(stuck(1)))
    golden("stuck-hint-2", renderStuckHint(stuck(2)))
    golden("stuck-hint-3", renderStuckHint(stuck(3)))
    golden("dryrun", renderDryrun())
  })

  test("测试交接族", () => {
    golden("test-result", renderTestResult({ ...run, seq: 1 }))
    golden("test-wrapup", renderTestWrapup({ handoffFile: "docs/T-002/testhandoff.md" }))
    golden("test-continue", renderTestContinue({ handoffFile: "docs/T-002/testhandoff-1.md", run: { ...run, seq: 1 } }))
  })

  test("agent 契约(testByDriver 两态)", async () => {
    golden("agent-contract-plain", await renderAgentContract(false))
    golden("agent-contract-testbydriver", await renderAgentContract(true))
  })
})
