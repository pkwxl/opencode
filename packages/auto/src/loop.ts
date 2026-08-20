import { join } from "node:path"
import { block, load, next } from "./plan"
import { runTask } from "./runner"
import { ensure } from "./server"

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run. A blocked
// task needs no `answer`: re-running resumes it directly.
export async function runAll(
  directory: string,
  opts: { agent?: string; server?: string; verbose?: boolean; waitAnswer?: number },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    console.error(`未找到计划文件: ${path}`)
    return 1
  }

  const server = await ensure(directory, opts.server)
  try {
    for (;;) {
      const plan = await load(path)
      const task = next(plan)
      if (!task) {
        console.log("✓ 全部任务已完成")
        return 0
      }
      if (task.status === "blocked" && task.question) {
        console.log(`↻ ${task.id} 此前因问题阻塞,未填写 answer,直接续跑:\n${task.question}`)
      }
      console.log(`▶ ${task.id}: ${task.title}(第 ${task.attempts + 1} 次尝试)`)
      const outcome = await runTask(server.client, plan, task, { agent: opts.agent, verbose: opts.verbose, waitAnswer: opts.waitAnswer })
      if (outcome.type === "blocked") {
        await block(path, task.id, outcome.question)
        console.log(`⏸ ${task.id} 已阻塞,问题已写入 PLAN.md:\n${outcome.question}`)
        return 2
      }
      console.log(`✓ ${task.id} 完成`)
    }
  } finally {
    server.close()
  }
}
