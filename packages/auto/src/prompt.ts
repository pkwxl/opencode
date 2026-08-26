import type { Plan, Task } from "./plan"

// --commit 四档: subtask(每子任务提交,缺省)/ task(仅任务收尾提交)/
// once(整个计划完成后提交一次)/ none(从不提交)。
export type CommitMode = "subtask" | "task" | "once" | "none"

type Opts = { commit?: CommitMode }

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
3. 把分解结果写入 docs/${task.id}.subtasks.md,格式为 Markdown 检查项,描述要自包含
   (执行会话仅凭该描述、CURRENT.md 与 docs/ 即可完成):

- [ ] <子任务描述>

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
// self-checks; ticking the checkbox is the driver's job when the session
// ends, and acceptance of the whole task happens once in the task-level
// review after wrap-up.
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
   a. 自我检查该子任务是否真正完成;整个任务的验收在最后由独立审核会话统一进行,
      不通过会把差距反馈回来修复;${
     opts.commit === "subtask"
       ? `
   b. git 提交全部未提交改动,实现子任务级别的变动历史追踪:
${indent(commitRule(`${task.id} 与子任务"${subtask}"`), "      ")};
   c.`
       : `
   b.`
   } 不要运行任务级 verify(验收由 driver 交独立审核会话处理)、不要更新 docs/(最后统一收尾);${STATE_RULE}`,
  ].join("\n\n")
}

// Wrap-up session: every subtask is already ticked by the driver. Only docs,
// the sweep commit, and the output-summary report remain. The session never
// runs the task verify and never concludes acceptance: verify handling
// belongs to the driver, which delegates it to the independent review
// session afterwards (a gap there appends a fix subtask).
export function renderWrapup(plan: Plan, task: Task, opts: Opts & { solo?: boolean } = {}): string {
  const commit = opts.commit !== "once" && opts.commit !== "none"
  const steps = [
    `1. 更新 docs/ 中受本任务影响的文档,使下一个会话仅凭磁盘文件就能理解当前进展;`,
    `2. 写 docs/${task.id}.report.md: 各子任务的产出摘要(改动了什么、关键决策与遗留事项),
   供后续会话与审核者仅凭磁盘文件了解本次任务的产出;`,
    ...(commit
      ? [
          `3. git 提交全部未提交改动(不仅限于本次会话修改的文件——之前的会话可能因中断
   遗留未提交改动,须一并提交):
${indent(commitRule(`${task.id} 与任务摘要`), "   ")}`,
        ]
      : []),
    `${commit ? 4 : 3}. 不要运行任务级 verify、不要下验收结论: verify 的处理权在 driver,任务级
   验收由它启动的独立审核会话在你结束会话后进行,不通过会把差距反馈回执行会话修复。${STATE_RULE}`,
  ]
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `${
      opts.solo
        ? "该任务的实现已在之前的会话中完成,不要重做。本次会话只执行收尾:"
        : "该任务的全部子任务已在之前的会话中逐一完成,不要重做。本次会话只执行收尾:"
    }

${steps.join("\n")}
以上全部完成前不要结束会话。`,
  ].join("\n\n")
}

// Task-level review session: independent acceptance, always a fresh side
// session (never the execution chain). The driver owns the task verify field
// and delegates its handling to this session: the reviewer may read code and
// run checks — the verify field's declared command is only a suggestion it
// may adapt or supplement — but must not modify implementation code. Its
// verdict goes to VERDICT_FILE with a final `结论: 通过` /
// `结论: 差距 <描述>` line, which the driver parses.
export function renderVerify(plan: Plan, task: Task): string {
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    `本次审核对象是整个任务(全部子任务已由之前的会话逐一完成,不要重做实现)。
先读 docs/${task.id}.report.md(收尾报告)了解各子任务产出;任务 verify 字段${
      task.verify ? `是"${task.verify}"` : "未声明"
    },作为验收标准。`,
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

// Fix round after a failed task-level review: the driver sends the review
// session's gap back and resumes the execution session chain with it. The
// session fixes exactly the reported gap; wrap-up and a fresh review session
// re-run acceptance afterwards.
export function renderFix(plan: Plan, task: Task, gap: string): string {
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    `任务级独立审核会话对本任务的验收未通过,差距如下:

${gap}

约束:
1. 只修复审核指出的差距,逐项核对并修复,不要做差距之外的实现工作;
${QUESTION_RULE}
3. 不要运行任务级 verify(验收由 driver 交独立审核会话处理)、不要更新 docs/(最后统一收尾);
   ${STATE_RULE}
4. 修复完成并自我检查后,立即结束会话。`,
  ].join("\n\n")
}

// ondemand 模式的交接文档(相对目标目录);driver 在上下文达到 --context-limit
// 时插入交接提示,会话把进度写入该文件,末行 `状态: 继续|完成` 由 driver 解析。
export function handoffFile(task: Task): string {
  return `docs/${task.id}.handoff.md`
}

// ondemand 模式: driver 在会话进行中(上下文达到上限时)插入的交接提示。
// v2 prompt 默认 steer,在下一个 provider turn 边界进入会话。
export function renderHandoffSteer(task: Task): string {
  return (
    `[driver] 本会话上下文即将达到上限。请立即停止当前工作,把已完成的进度、关键决策` +
    `与后续步骤写入 ${handoffFile(task)}(覆盖写),使下一个全新会话仅凭该文件、CURRENT.md` +
    `与 docs/ 即可无缝继续;末行写 \`状态: 继续\`(任务未完成)或 \`状态: 完成\`(任务已全部完成)。` +
    `写完立即结束会话。`
  )
}

// --subtask off/ondemand: 单会话完成整个任务(不做子任务分解)。ondemand 额外附带
// 交接条款;continuation 表示此前会话因上下文限制中断,需先读交接文档继续。
export function renderWhole(plan: Plan, task: Task, opts: Opts & { ondemand?: boolean; continuation?: boolean } = {}): string {
  const commit =
    opts.commit === "subtask"
      ? `4. git 提交全部未提交改动:
${indent(commitRule(`${task.id} 与任务摘要`), "   ")};
`
      : ""
  return [
    ...head(plan),
    `当前任务(完整内容同时见 CURRENT.md):\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    ...blockedSection(task),
    `你本次负责整个任务,在单个会话内完成,不做子任务分解。${
      opts.continuation ? `此前的会话因上下文限制中断,先读 ${handoffFile(task)} 了解进度与后续步骤,据此继续。` : ""
    }

约束:
1. 完成整个任务后自我检查是否真正完成;整个任务的验收在最后由独立审核会话统一进行;
${QUESTION_RULE}
3. 不要运行任务级 verify、不要更新 docs/ 报告,这些在最后统一收尾;${
      opts.ondemand
        ? `
   如果 driver 插入"[driver] 上下文即将达到上限"的提示,立即按提示写出 ${handoffFile(task)} 并结束会话;`
        : ""
    }
${commit}   ${STATE_RULE}`,
  ].join("\n\n")
}

// --dryrun: 权限预检会话。列出执行任务可能需要的、超出 opencode.json 授权范围的
// 目录与操作,并逐只读探查确认;被拒的访问(permission 会被 driver 自动拒绝但不中断
// 会话)正是要报告的内容。报告写入 .auto/dryrun.md 并作为最终输出。
export function renderDryrun(): string {
  return [
    "你正在为一个自动化执行计划做权限预检。完整计划位于当前目录的 PLAN.md,先读它;" +
      "当前目录的 opencode.json 中是已授权的 permission 规则,也要读。",
    `任务:
1. 通读 PLAN.md 中全部未完成任务,结合仓库结构与 docs/,分析执行这些任务可能需要
   访问的、超出 opencode.json 已授权范围的目录与操作(项目目录之外的路径、网络访问、
   特殊 bash 命令等),列出候选清单;
2. 对候选清单逐项做只读探查确认(如 ls、test -r、读取文件等无害操作),确认哪些
   访问确实会被拒绝——被拒绝的探查不会中断你,记录下来继续探查下一项;
3. 把结论写入 .auto/dryrun.md(覆盖写):确认受阻的访问清单,以及建议加入
   opencode.json permission 的放行规则;若无授权外访问需求,也要写明。

约束:
1. 只做只读探查,不修改任何实现代码,不执行 PLAN.md 中的任务;
2. ${STATE_RULE}
3. 写出报告后立即结束会话,最终消息复述报告要点。`,
  ].join("\n\n")
}

// --commit once: 整个计划完成后的唯一一次提交会话(全新会话,不进任何链)。
export function renderCommitAll(plan: Plan): string {
  return [
    ...head(plan),
    `PLAN.md 的全部任务已完成且通过验收。你本次只做一件事: git 提交全部未提交改动
(各任务执行期间按配置未做提交,须一并提交):
${commitRule("整个计划完成")}

完成后立即结束会话。`,
  ].join("\n\n")
}

// init --prompt: 初始化规划会话,按用户需求填充 PLAN.md,不实施。
export function renderInit(promptText: string): string {
  return [
    "你正在为当前目录初始化一份 opencode-auto 实施计划。",
    `任务:
1. 阅读当前目录结构、README/AGENTS.md/docs(若存在),了解项目;
2. 阅读 PLAN.md 模板,理解其格式(任务标题 \`## T-NNN: 标题 [pending]\`、紧跟标题的
   字段行如 \`  - verify: command: <命令>\`);
3. 根据下方需求,把 PLAN.md 填充为一份可执行的实施计划:任务按依赖顺序排列,每个
   任务带 verify 验收标准(具体命令用 \`command: \` 前缀,或自然语言描述);不要手工
   编写子任务检查项(driver 会自动分解);
4. 如执行计划需要访问项目目录外的路径或特殊命令,在 opencode.json 的 permission
   规则中补充放行。

约束: 只做规划,不实施任何任务,不编写 docs/ 报告;完成后立即结束会话。

需求:
${promptText}`,
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
