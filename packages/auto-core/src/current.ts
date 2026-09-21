// CURRENT.md(目标目录的当前任务镜像)的写入与删除。
// 叶子模块: 只依赖 PLAN.md 解析与写保护,不依赖任何会话驱动代码——
// unit-commit 的回滚备注与 runner 的任务流水线都要写它。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S3,纯搬运)。
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { countSubtasks, type Task } from "./plan"
import { allowWrite, reprotect } from "./protect"

// CURRENT.md mirrors the task in progress. Prompts already inline the task, so
// the agent contract points sessions here only as a fallback: after context
// compaction, or when a session doubts the current task/progress.
// The server re-reads it on every provider turn, so no restart is needed.
// remark: the "interruption note" attached when the file is kept on a
// non-completed outcome (exit reason / phase / how to resume).
export async function writeCurrent(path: string, task: Task, solo = false, remark?: string) {
  const progress = countSubtasks(task.body)
  const content = [
    `# Current task (maintained by opencode-auto, do not edit manually)`,
    ``,
    `## ${task.id}: ${task.title} [${task.status}]`,
    ``,
    task.body,
    ``,
    progress.total ? `Progress: subtasks ${progress.done}/${progress.total}` : solo ? `Progress: single-session execution (no subtask split)` : `Progress: decomposing`,
    ``,
    ...(remark ? [remark, ""] : []),
  ].join("\n")
  const file = join(dirname(path), "CURRENT.md")
  await allowWrite(file)
  await Bun.write(file, content)
  await reprotect(file)
}

// 任务完成才删除 CURRENT.md;阻塞/回退 pending 时由 runTask 写中断备注后保留,
// 强制中断遗留的文件在下次任务开始时由 writeCurrent 重建。
export async function removeCurrent(path: string) {
  const file = join(dirname(path), "CURRENT.md")
  await allowWrite(file)
  await rm(file, { force: true })
}
