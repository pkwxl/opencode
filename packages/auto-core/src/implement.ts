// init 快捷模式(--implement-file/--implement-prompt,packages/auto 用法文本):
// 旁路一次性计划生成会话——复用阶段规划会话(phase-plan,src/loop.ts planPhase)
// 同款 requireArtifact 骨架与 PLAN.md 任务格式约定,但独立起停一个 server 实例:
// init 与随后单独调用的 run 是两次进程调用,不像 loop.ts 内的阶段循环那样能把
// server 句柄一路传给主循环复用。仅用于 phases = "m" 项目(单阶段、无轮次概念);
// 调用方(packages/auto 的 init 命令)负责: ① 校验 phases === "m"、互斥与非空
// 输入;② PLAN.md 当前为占位/空模板态(拒绝覆盖真实任务——会话开始前 reset 会
// 无条件清空 PLAN.md,由调用方在起会话前把关)。
import { join } from "node:path"
import type { Interactive } from "./interactive"
import { log } from "./log"
import type { ModeSpec } from "./mode"
import { load } from "./plan"
import { renderPlanScaffold } from "./phases"
import { renderImplementPlan } from "./prompt"
import { allowWrite, reprotect } from "./protect"
import { requireArtifact, type Opts, type PermissionMode } from "./runner"
import { manage } from "./server"

export async function implementPlan(
  directory: string,
  input: { file?: string; content: string; brief?: string },
  config: { agent?: string; commit?: boolean; contextLimit: number; verify: boolean; mode?: ModeSpec },
  opts: { server?: string; verbose?: boolean; waitAnswer?: number; permission?: PermissionMode; interactive?: Interactive } = {},
): Promise<{ type: "ok"; count: number } | { type: "blocked"; question: string }> {
  const path = join(directory, "PLAN.md")
  const server = await manage(directory, opts.server)
  try {
    log("▶ 开计划生成会话填充 PLAN.md")
    await allowWrite(path)
    try {
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
      const planned = await requireArtifact(
        server.client,
        { id: "PLAN", title: "计划生成(implement)", status: "in_progress", attempts: 0, body: "" },
        renderImplementPlan({ file: input.file, content: input.content, brief: input.brief, verify: config.verify }),
        sessionOpts,
        {
          kind: "计划生成",
          artifact: "已填充的 PLAN.md(至少一个任务)",
          detail: "缺失、无任务或任务格式无法解析",
          requirement: "必须直接编辑 PLAN.md,把任务按 `## T-NNN: <任务标题> [pending]` 格式写入(至少一个)。",
          commit: { stage: "implement-plan", subject: "PLAN implement 计划生成" },
          reset: async () => {
            await Bun.write(path, renderPlanScaffold(config.verify))
          },
          collect: async () => {
            const fresh = await load(path).catch(() => undefined)
            return fresh?.tasks.length ? fresh.tasks.length : undefined
          },
        },
      )
      if (typeof planned !== "number") return { type: "blocked", question: planned.question }
      return { type: "ok", count: planned }
    } finally {
      await reprotect(path)
    }
  } finally {
    server.close()
  }
}
