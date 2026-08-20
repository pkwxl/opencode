import type { Plan, Task } from "./plan"

type Opts = { commitSubtask?: boolean }

// Question-tool rules, identical across all session types.
const QUESTION_RULE = `2. 遇到权限相关问题(如需要访问受限目录),调用 question 工具报告并请求用户在 opencode.json 中放行;
   其他问题(需求歧义、多种合理方案、数据异常、环境缺失等)不要调用 question 工具,
   你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。
   非权限问题调用 question 工具会被自动答复上面这句话;就同一问题再次询问会导致任务阻塞停机。`

// Rebuilds full context for a fresh session: completed tasks, the current
// task body, prior Q&A history, and the completion contract. commitSubtask
// (--commit-subtask) additionally requires a git commit per subtask checkbox.
export function render(plan: Plan, task: Task, opts: Opts = {}): string {
  return [
    ...head(plan),
    `你本次只负责这一任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `约束:
1. 只完成当前任务,不要提前做后续任务,也不要重做已标记 [done] 的任务。
${QUESTION_RULE}
${wrapup(task, opts)}`,
  ].join("\n\n")
}

// --new-session-subtask: a fresh session handles exactly one subtask checkbox
// of the task, ticks it, optionally commits, and ends. verify, the [done]
// marker, docs, and the sweep commit are left to the wrap-up session.
export function renderSubtask(plan: Plan, task: Task, subtask: string, opts: Opts = {}): string {
  return [
    ...head(plan),
    `当前任务(其他子任务由其他会话完成,不要碰):\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `你本次只负责该任务的这一个子任务:

- [ ] ${subtask}

约束:
1. 严格只完成这一个子任务,完成后立即按下方步骤收尾并结束会话,以控制单次会话的上下文大小。
${QUESTION_RULE}
3. 收尾:
   a. 勾选 PLAN.md 中 ${task.id} 正文里对应的检查项(把对应的 \`- [ ]\` 改为 \`- [x]\`);${
     opts.commitSubtask
       ? `
   b. git 提交全部未提交改动,实现子任务级别的变动历史追踪:
${indent(commitRule(`${task.id} 与子任务"${subtask}"`), "      ")};`
       : ""
   }
   不要运行 verify、不要把任务标记为 [done]、不要更新 docs/,这些在最后统一收尾。`,
  ].join("\n\n")
}

// --new-session-subtask final session: every subtask is already ticked in
// PLAN.md; only the completion contract (verify, [done], docs, sweep commit)
// remains. Per-subtask commits already happened in the subtask sessions, so
// the commitSubtask line is omitted from the contract here.
export function renderWrapup(plan: Plan, task: Task): string {
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `该任务的全部子任务已在之前的会话中逐一完成并勾选,不要重做。本次会话只执行收尾:

${wrapup(task, { commitSubtask: false })}`,
  ].join("\n\n")
}

function head(plan: Plan): string[] {
  const done = plan.tasks.filter((t) => t.status === "done")
  return [
    "你正在按一份实施计划执行其中的一项任务。完整计划位于当前目录的 PLAN.md,先读它了解全貌。",
    done.length
      ? `以下任务已完成,不要重做:\n${done.map((t) => `- [done] ${t.id}: ${t.title}`).join("\n")}`
      : "计划中尚无已完成的任务。",
  ]
}

function blockedSection(task: Task): string[] {
  if (task.question && task.answer) {
    return [`该任务此前被阻塞。上次的问题:"${task.question}",已获解答:"${task.answer}"。请据此继续。`]
  }
  if (task.question) {
    return [
      `该任务此前因以下问题被阻塞:"${task.question}"。用户未提供解答,直接重新运行了 driver,` +
        `说明该问题不是提问而是会话外的事务(如授权、环境修复),用户已在会话外处理完毕。` +
        `不要再就同一问题调用 question 工具,直接继续执行;若确认问题仍存在,自主决策处理方式。`,
    ]
  }
  return []
}

// The completion contract: verify, tick checkboxes, mark [done], update
// docs, sweep-commit everything (including changes stranded by interrupted
// previous sessions).
function wrapup(task: Task, opts: Opts): string {
  return `3. 完成当前任务后,按顺序收尾:
   a. ${task.verify ? `verify 字段是验收标准描述,由你解释并执行:将 \`${task.verify}\` 翻译为具体的测试/检查命令运行` : "任务未声明 verify 验收标准,可自行运行项目自身的测试/检查"};
      验证执行通过时,把实际命令写入 PLAN.md 该任务的 verified 字段,作为高可信完成记录;
      未执行或未通过则不写 verified,不影响标记 [done];
      验证通过后必须勾选任务正文中对应的验证检查项(把验证相关的 \`- [ ]\` 改为 \`- [x]\`),
      其余检查项也按实际完成情况勾选;未实际完成的项不得勾选;${
        opts.commitSubtask
          ? `\n      每完成并勾选一项子任务检查项,立即按 d 的提交规则完成一次 git 提交(含嵌套 .git
        子仓库),实现子任务级别的变动历史追踪;d 步再提交剩余全部改动;`
          : ""
      }
   b. 编辑 PLAN.md,把 ${task.id} 的状态标记改为 [done];
   c. 更新 docs/ 中受本任务影响的文档;
   d. git 提交全部未提交改动(不仅限于本次会话修改的文件——之前的会话可能因中断
      遗留未提交改动,须一并提交):
${indent(commitRule(`${task.id} 与任务摘要`), "      ")}
   以上全部完成前不要结束会话。`
}

// Nested .git repos are usually gitignored by the parent (not submodules) and
// invisible to git status, so they must be found on the filesystem and
// committed first; the parent commit message records their paths and SHAs.
function commitRule(note: string): string {
  return `- 主动在工作目录的文件系统中查找含独立 .git 的子目录(它们通常被父仓库 .gitignore 忽略,
  不是 submodule,git status/git submodule 均不可见,必须直接查目录,如 find . -name .git);
- 先在每个子仓库内 git add 全部改动并提交(提交信息遵循该子仓库风格);
- 若工作目录本身是 git 仓库,再 git add 全部改动(含 PLAN.md 与 docs/)并提交,
  提交信息遵循该仓库现有风格(参考 git log),注明 ${note};
  被父仓库 ignore 的子仓库不会进入该提交,必须在提交信息中列出其路径与新提交 SHA。`
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n")
}
