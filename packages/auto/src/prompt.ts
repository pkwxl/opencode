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
  } else if (task.question) {
    sections.push(
      `该任务此前因以下问题被阻塞:"${task.question}"。用户未提供解答,直接重新运行了 driver,` +
        `说明该问题不是提问而是会话外的事务(如授权、环境修复),用户已在会话外处理完毕。` +
        `不要再就同一问题调用 question 工具,直接继续执行;若确认问题仍存在,自主决策处理方式。`,
    )
  }
  sections.push(`约束:
1. 只完成当前任务,不要提前做后续任务,也不要重做已标记 [done] 的任务。
2. 遇到权限相关问题(如需要访问受限目录),调用 question 工具报告并请求用户在 opencode.json 中放行;
   其他问题(需求歧义、多种合理方案、数据异常、环境缺失等)不要调用 question 工具,
   你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。
   非权限问题调用 question 工具会被自动答复上面这句话;就同一问题再次询问会导致任务阻塞停机。
3. 完成当前任务后,按顺序收尾:
   a. ${task.verify ? `verify 字段是验收标准描述,由你解释并执行:将 \`${task.verify}\` 翻译为具体的测试/检查命令运行` : "任务未声明 verify 验收标准,可自行运行项目自身的测试/检查"};
      验证执行通过时,把实际命令写入 PLAN.md 该任务的 verified 字段,作为高可信完成记录;
      未执行或未通过则不写 verified,不影响标记 [done];
      验证通过后必须勾选任务正文中对应的验证检查项(把验证相关的 \`- [ ]\` 改为 \`- [x]\`),
      其余检查项也按实际完成情况勾选;未实际完成的项不得勾选;
   b. 编辑 PLAN.md,把 ${task.id} 的状态标记改为 [done];
   c. 更新 docs/ 中受本任务影响的文档;
   d. git 提交全部未提交改动(不仅限于本次会话修改的文件——之前的会话可能因中断
      遗留未提交改动,须一并提交):
      - 主动在工作目录的文件系统中查找含独立 .git 的子目录(它们通常被父仓库 .gitignore 忽略,
        不是 submodule,git status/git submodule 均不可见,必须直接查目录,如 find . -name .git);
      - 先在每个子仓库内 git add 全部改动并提交(提交信息遵循该子仓库风格);
      - 若工作目录本身是 git 仓库,再 git add 全部改动(含 PLAN.md 与 docs/)并提交,
        提交信息遵循该仓库现有风格(参考 git log),注明 ${task.id} 与任务摘要;
        被父仓库 ignore 的子仓库不会进入该提交,必须在提交信息中列出其路径与新提交 SHA。
   以上全部完成前不要结束会话。`)
  return sections.join("\n\n")
}
