import type { Plan, Task } from "./plan"

// Rebuilds full context for a fresh session: completed tasks, the current
// task body, prior Q&A history, and the completion contract.
export function render(plan: Plan, task: Task): string {
  const done = plan.tasks.filter((t) => t.status === "done")
  const sections = [
    "你正在按一份实施计划执行其中的一项任务。完整计划位于当前目录的 PLAN.md,先读它了解全貌。",
    done.length
      ? `以下任务已完成,不要重做:\n${done.map((t) => `- [done] ${t.id}: ${t.title}`).join("\n")}`
      : "计划中尚无已完成的任务。",
    `你本次只负责这一任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
  ]
  if (task.question && task.answer) {
    sections.push(`该任务此前被阻塞。上次的问题:"${task.question}",已获解答:"${task.answer}"。请据此继续。`)
  }
  sections.push(`约束:
1. 只完成当前任务,不要提前做后续任务,也不要重做已标记 [done] 的任务。
2. 遇到任何无法自主决策的问题,立即调用 question 工具询问,绝对不要猜测或自行假设。
3. 完成当前任务后,按顺序收尾:
   a. ${task.verify ? `运行 verify 命令 \`${task.verify}\`,确认通过` : "运行项目自身的测试/检查,确认通过"};
   b. 编辑 PLAN.md,把 ${task.id} 的状态标记改为 [done];
   c. 更新 docs/ 中受本任务影响的文档。
   以上全部完成前不要结束会话。`)
  return sections.join("\n\n")
}
