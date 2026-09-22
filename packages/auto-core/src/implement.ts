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
      { id: "PLAN", title: "计划生成(implement)", status: "in_progress", attempts: 0, body: "" },
      renderImplementPlan({ file: input.file, content: input.content, brief: input.brief, phaseId, taskIndex, numberStart }),
      sessionOpts,
      {
        kind: "计划生成",
        role: "implement-scan",
        // 独立隐藏任务单元: 启动 clean 门禁 + SHA 基线 + 收口校验(plans/0021-commit-boundary-design.md)。
        unitStart: true,
        artifact: `有效的任务索引 ${taskIndex} 与各任务文档(至少一个任务)`,
        detail: "缺失、无任务、任务文档不合格或任务编号复用了已占用的编号",
        get requirement() {
          return (
            `必须写出任务索引 ${taskIndex}(每个任务一行 \`- [ ] T-NNN <任务标题>\`,至少一个)` +
            `与每个任务的 docs/T-NNN/todo.md(标题行 \`# T-NNN: <任务标题>\`、字段行 \`Phase: ${phaseId}\`、` +
            `\`## Goal\` / \`## Scope\` / \`## Acceptance\` 三节,末行 \`<!-- auto: eof -->\`)。` +
            (problems.length ? `上次的问题: ${problems.join("; ")}。` : "")
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
