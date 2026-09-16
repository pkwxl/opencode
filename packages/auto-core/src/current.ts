// CURRENT.md(目标目录的当前任务镜像)的写入与删除。
// 叶子模块: 只依赖 PLAN.md 解析与写保护,不依赖任何会话驱动代码——
// unit-commit 的回滚备注与 runner 的任务流水线都要写它。
// 拆分自 src/runner.ts(docs/module-split-plan.md S3,纯搬运)。
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { countSubtasks, type Task } from "./plan"
import { allowWrite, reprotect } from "./protect"

// CURRENT.md mirrors the task in progress. Prompts already inline the task, so
// the agent contract points sessions here only as a fallback: after context
// compaction, or when a session doubts the current task/progress.
// The server re-reads it on every provider turn, so no restart is needed.
// remark: 非完成结局保留文件时附带的"中断备注"(退出原因/阶段/恢复方式)。
export async function writeCurrent(path: string, task: Task, solo = false, remark?: string) {
  const progress = countSubtasks(task.body)
  const content = [
    `# 当前任务(由 opencode-auto 维护,请勿手工编辑)`,
    ``,
    `## ${task.id}: ${task.title} [${task.status}]`,
    ...(task.verify ? [`  - verify: ${task.verify}`] : []),
    ``,
    task.body,
    ``,
    progress.total ? `进度: 子任务 ${progress.done}/${progress.total}` : solo ? `进度: 单会话执行(无子任务划分)` : `进度: 分解中`,
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
