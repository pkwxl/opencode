// init 快捷模式(--implement-file/--implement-prompt,packages/auto 用法文本):
// 旁路一次性计划生成会话——复用阶段规划会话(phase-plan,src/loop-phase.ts
// planPhase)同款 requireArtifact 骨架与任务单元格式约定(任务索引 tasks.md + 各任务
// docs/T-NNN/todo.md,M3.4),但独立起停一个 server 实例: init 与随后单独调用的 run
// 是两次进程调用,不像阶段循环那样能把 server 句柄一路传给主循环复用。仅用于
// phases = "m" 项目(唯一阶段 R-01/P01-implement,plans/0047 L2);调用方(packages/auto
// 的 init 命令)负责: ① 校验 phases === "m"、互斥与非空输入;② 已建立轮次(阶段
// 索引在);③ 当前阶段的任务索引尚无任务(拒绝覆盖真实任务——会话开始前 reset
// 会清除任务索引,由调用方在起会话前把关)。
import { join } from "node:path"
import type { Interactive } from "./interactive"
import { log } from "./log"
import type { ModeSpec } from "./mode"
import { currentPhase, readPhases } from "./phases"
import { renderImplementPlan } from "./prompt"
import type { Opts, PermissionMode } from "./opts"
import { requireArtifact } from "./artifact"
import { manage } from "./agent/opencode/server"
import { plannedTaskProblems, qualifiedPhase, resetPlanning, takenTaskIds, taskIndexPath } from "./tasks"

export async function implementPlan(
  directory: string,
  input: { file?: string; content: string; brief?: string },
  config: { agent?: string; commit?: boolean; contextLimit: number; mode?: ModeSpec },
  opts: { server?: string; verbose?: boolean; waitAnswer?: number; permission?: PermissionMode; interactive?: Interactive } = {},
): Promise<{ type: "ok"; count: number } | { type: "blocked"; question: string }> {
  const state = await readPhases(directory)
  const phase = state && currentPhase(state)
  if (!phase) return { type: "blocked", question: "no open phase to plan: establish the round first (opencode-auto init)" }
  const taskIndex = taskIndexPath(phase)
  const phaseId = qualifiedPhase(phase)
  const taken = await takenTaskIds(directory, phase)
  const numberStart = Math.max(0, ...[...taken].map((id) => Number(/^T-(\d+)$/.exec(id)?.[1] ?? 0))) + 1
  const server = await manage(directory, opts.server, { log })
  try {
    log(`▶ starting plan-generation session to write ${taskIndex} and the task documents`)
    const sessionOpts: Opts = {
      agent: config.agent,
      dir: directory,
      verbose: opts.verbose,
      waitAnswer: opts.waitAnswer,
      commit: config.commit,
      contextLimit: config.contextLimit,
      permission: opts.permission,
      interactive: opts.interactive,
      server,
      mode: config.mode,
    }
    let problems: string[] = []
    const planned = await requireArtifact(
      server.client,
      { id: "PLAN", title: "plan generation (implement)", status: "in_progress", attempts: 0, body: "" },
      renderImplementPlan({ file: input.file, content: input.content, brief: input.brief, phaseId, taskIndex, numberStart }),
      sessionOpts,
      {
        kind: "plan generation",
        role: "implement-scan",
        // Independent hidden task unit: entry clean gate + SHA baseline + close-out check (plans/0021-commit-boundary-design.md).
        unitStart: true,
        artifact: `a valid task index ${taskIndex} with its task documents (at least one task)`,
        detail: "missing, no task, a non-compliant task document, or a task number reusing a taken number",
        get requirement() {
          return (
            `write the task index ${taskIndex} (one line per task, \`- [ ] T-NNN <task title>\`, at least one) ` +
            `and each task's docs/T-NNN/todo.md (title line \`# T-NNN: <task title>\`, field line \`Phase: ${phaseId}\`, ` +
            `the three sections \`## Goal\` / \`## Scope\` / \`## Acceptance\`, last line \`<!-- auto: eof -->\`).` +
            (problems.length ? ` Problems last time: ${problems.join("; ")}.` : "")
          )
        },
        commit: { stage: "implement-plan", subject: "PLAN implement plan generation" },
        reset: () => resetPlanning(directory, phase),
        collect: async () => {
          const checked = await plannedTaskProblems(directory, phase, { before: taken })
          problems = checked.problems
          return problems.length ? undefined : checked.ids.length
        },
      },
    )
    if (typeof planned !== "number") {
      // dirty(启动前工作区不净)折为 blocked 报文(init 交互语境,无 run 循环的
      // dirty 专门处理;不写状态文件,处置权在人工)。
      return {
        type: "blocked",
        question:
          planned.type === "dirty"
            ? `worktree is not clean before plan generation; please handle it manually (commit/clean) and retry:\n${planned.files.join("\n")}`
            : planned.question,
      }
    }
    return { type: "ok", count: planned }
  } finally {
    server.close()
  }
}
