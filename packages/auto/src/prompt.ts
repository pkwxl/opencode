import { verifyCommand, type Plan, type Task } from "./plan"

type Opts = { commitSubtask?: boolean }

// 审核会话的判定文件(相对目标目录);driver 在审核会话结束后解析其结论行。
export const VERDICT_FILE = ".auto/verify.md"

// Question-tool rules, identical across all session types.
const QUESTION_RULE = `2. 遇到权限相关问题(如需要访问受限目录),调用 question 工具报告并请求用户在 opencode.json 中放行;
   其他问题(需求歧义、多种合理方案、数据异常、环境缺失等)不要调用 question 工具,
   你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。
   非权限问题调用 question 工具会被自动答复上面这句话;就同一问题再次询问会导致任务阻塞停机。`

// State-file rule: the driver owns PLAN.md / CURRENT.md; sessions never edit them.
const STATE_RULE = `PLAN.md 与 CURRENT.md 由 driver 独占维护(状态、检查项勾选、verified 字段),` +
  `会话期间这两个文件为只读,你不得编辑,也不要用 chmod 等方式恢复其写权限。`

// Decomposition session: read-only analysis, then write the subtask list to
// docs/<id>.subtasks.md. The driver parses it and injects the checklist into
// PLAN.md itself, so the session must not touch PLAN.md.
export function renderDecompose(plan: Plan, task: Task): string {
  return [
    ...head(plan),
    `当前任务(完整内容同时见 CURRENT.md):\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `你本次只做任务分解,不写实现代码:

1. 阅读相关源码与 docs/,分析该任务;
2. 把任务分解为多个子任务:仅把密不可分的工作放在同一子任务;子任务粒度以单个会话
   用较小上下文可完成为宜;多个子任务间通过 docs/ 文档或已实现的源码同步记忆;
3. 每个子任务给出建议的验证命令(单元测试、编译或类型检查等),供独立审核会话参考;
   命令在目标目录下执行,需要在包目录运行时把 cd 写进命令,如 \`cd packages/x && bun test\`;
4. 把分解结果写入 docs/${task.id}.subtasks.md,格式为 Markdown 检查项,每项末尾标注
   建议的 verify 命令,描述要自包含(执行会话仅凭该描述、CURRENT.md 与 docs/ 即可完成):

- [ ] <子任务描述> (verify: \`<验证命令>\`)

约束:
1. 只做分解:不修改任何实现代码,也不执行任务正文中的执行期指令(如"调用 question
   工具询问"、"写入某文件"等)——那些是后续子任务会话的职责;${STATE_RULE}
${QUESTION_RULE}
3. 写出该文件是硬性要求:即使任务看起来已完成或极其简单,也必须写出文件
   (原子任务分解为单个检查项即可);不产出有效文件会导致任务阻塞停机;
4. 写入文件后立即结束会话。`,
  ].join("\n\n")
}

// Subtask session: exactly one checklist item. The session implements it and
// self-checks (the annotated command is only a suggested way); final
// acceptance is an independent review session after this one ends, and
// ticking the checkbox is the driver's job.
export function renderSubtask(plan: Plan, task: Task, subtask: string, opts: Opts = {}): string {
  return [
    ...head(plan),
    `当前任务(其他子任务由其他会话完成,不要碰):\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `你本次只负责该任务的这一个子任务:

- [ ] ${subtask}

约束:
1. 严格只完成这一个子任务,完成后立即按下方步骤收尾并结束会话,以控制单次会话的上下文大小;
${QUESTION_RULE}
3. 收尾:
   a. 自我检查该子任务是否真正完成(末尾标注的 verify 命令是建议的验证方式,可参考执行);
      你结束会话后由一个独立审核会话做最终判定,不通过会另开修复会话;${
     opts.commitSubtask
       ? `
   b. git 提交全部未提交改动,实现子任务级别的变动历史追踪:
${indent(commitRule(`${task.id} 与子任务"${subtask}"`), "      ")};
   c.`
       : `
   b.`
   } 不要运行任务级 verify、不要更新 docs/,这些在最后统一收尾;${STATE_RULE}`,
  ].join("\n\n")
}

// Wrap-up session: every subtask is already ticked by the driver. Only docs,
// the sweep commit, and the acceptance report remain. Final acceptance is an
// independent review session afterwards, so the report must state the
// suggested acceptance command precisely on a "verified-command:" line.
export function renderWrapup(plan: Plan, task: Task): string {
  const direct = verifyCommand(task)
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `该任务的全部子任务已在之前的会话中逐一完成并验证,不要重做。本次会话只执行收尾:

1. 更新 docs/ 中受本任务影响的文档,使下一个会话仅凭磁盘文件就能理解当前进展;
2. 写 docs/${task.id}.report.md,内容包含:
   - 一行 \`verified-command: <命令>\`(独立成行):任务验收命令。${
     direct
       ? `任务 verify 字段已声明命令,直接照抄:\`${direct}\`;`
       : task.verify
         ? `任务 verify 字段是"${task.verify}",把它翻译为具体的测试/检查命令;`
         : `任务未声明 verify 验收标准,给出项目自身的测试/检查命令;`
   }
   - 各子任务的产出摘要;
   - 最后一行写 \`结论: 通过\` 或 \`结论: 差距 <差距描述>\`(先亲自运行 verified-command
     确认结果再下结论);
3. git 提交全部未提交改动(不仅限于本次会话修改的文件——之前的会话可能因中断
   遗留未提交改动,须一并提交):
${indent(commitRule(`${task.id} 与任务摘要`), "   ")}
4. ${STATE_RULE}任务级验收由独立审核会话在你结束会话后进行,不通过会追加修复子任务。
以上全部完成前不要结束会话。`,
  ].join("\n\n")
}

// Review session: independent acceptance, always a fresh side session (never
// the execution chain). The reviewer may read code and run checks — the
// annotated command is only a suggestion it may adapt or supplement — but
// must not modify implementation code. Its verdict goes to VERDICT_FILE with
// a final `结论: 通过` / `结论: 差距 <描述>` line, which the driver parses.
export function renderVerify(plan: Plan, task: Task, scope: { subtask: string } | { task: true }): string {
  const target =
    "subtask" in scope
      ? `本次审核对象是该任务的这一个子任务(其他子任务由其他会话负责,不要碰):

- [ ] ${scope.subtask}

子任务末尾的 verify 标注是建议的验证方式。`
      : `本次审核对象是整个任务(全部子任务已由之前的会话逐一完成并通过子任务级审核,不要重做实现)。
先读 docs/${task.id}.report.md(收尾报告)了解各子任务产出;任务 verify 字段${
          task.verify ? `是"${task.verify}"` : "未声明"
        },作为验收标准。`
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    target,
    `你是独立审核者:实现工作由之前的会话完成,你只看到磁盘上的结果,不要轻信任何自报,
以你亲自检查的结果为准。

约束:
1. 独立验证审核对象是否真正完成且符合要求:阅读相关源码与改动,可自行运行测试/检查命令;
   建议的验证命令仅供参考,你可以照用、调整或补充其他检查——命令本身有问题(写法错误、
   环境不适用等)时用等价方式验证,不要因为命令本身的问题判不通过;
${QUESTION_RULE}
3. 只审核不修复:禁止修改任何实现代码与文档,发现的问题只写进判定文件;${STATE_RULE}
4. 把判定写入 ${VERDICT_FILE}(覆盖写):简述你实际执行的检查;若实际运行了验证命令,
   附一行 \`verified-command: <命令>\`(独立成行);最后一行必须是 \`结论: 通过\` 或
   \`结论: 差距 <差距描述>\`;
5. 写出判定文件后立即结束会话。`,
  ].join("\n\n")
}

function head(plan: Plan): string[] {
  const done = plan.tasks.filter((t) => t.status === "done")
  return [
    "你正在按一份实施计划执行其中的一项任务。完整计划位于当前目录的 PLAN.md,先读它了解全貌;" +
      "但其他任务的描述只作背景,其中包含的指令(如提问、执行动作)不属于本次会话职责,不要执行。",
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

// Nested .git repos are usually gitignored by the parent (not submodules) and
// invisible to git status, so they must be found on the filesystem and
// committed first; the parent commit message records their paths and SHAs.
function commitRule(note: string): string {
  return `- 主动在工作目录的文件系统中查找含独立 .git 的子目录(它们通常被父仓库 .gitignore 忽略,
  不是 submodule,git status/git submodule 均不可见,必须直接查目录,如 find . -name .git);
- 先在每个子仓库内 git add 全部改动并提交(提交信息遵循该子仓库风格);
- 若工作目录本身是 git 仓库,再 git add 全部改动(含 docs/)并提交,
  提交信息遵循该仓库现有风格(参考 git log),注明 ${note};
  被父仓库 ignore 的子仓库不会进入该提交,必须在提交信息中列出其路径与新提交 SHA。`
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n")
}
