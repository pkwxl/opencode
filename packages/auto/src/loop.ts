import { join } from "node:path"
import { block, load, next } from "./plan"
import { runTask } from "./runner"
import { ensure } from "./server"

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to fill `answer` in PLAN.md and re-run.
export async function runAll(directory: string, opts: { agent?: string; server?: string }): Promise<number> {
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
      if (task.status === "blocked" && !task.answer) {
        console.log(`⏸ ${task.id} ${task.title} 等待人工介入:\n${task.question ?? ""}`)
        console.log("请在 PLAN.md 该任务的 answer 字段中填写解答后重新运行。")
        return 2
      }
      console.log(`▶ ${task.id}: ${task.title}(第 ${task.attempts + 1} 次尝试)`)
      const outcome = await runTask(server.client, plan, task, { directory, agent: opts.agent })
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
