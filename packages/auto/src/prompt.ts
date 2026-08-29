import type { Plan, Task } from "./plan"

// --commit 四档: subtask(每子任务提交,缺省)/ task(仅任务收尾提交)/
// once(整个计划完成后提交一次)/ none(从不提交)。
export type CommitMode = "subtask" | "task" | "once" | "none"

type Opts = { commit?: CommitMode }

// 审核会话的判定文件(相对目标目录);driver 在审核会话结束后解析其结论行。
export const VERDICT_FILE = ".auto/verify.md"

// --review 质量审核会话的结论文件(相对目标目录);协议同 VERDICT_FILE,
// driver 复用同一解析逻辑读取其末行结论。
export const REVIEW_FILE = ".auto/review.md"

// 三段式 verify 的运行信息:driver 执行脚本后交判定会话。out/err 为整写输出的
// 绝对路径,内容由判定会话直读文件,不经工具输出截断(这正是三段式的目的)。
export type VerifyRun = {
  script: string
  code: number
  ms: number
  timedOut: boolean
  out: string
  err: string
}

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

// Verify script generation session (always a fresh side session, never the
// execution chain): the verify field is natural language or missing, so before
// the driver can execute anything a session must translate the acceptance
// semantics into an executable script at the given /tmp path. Read-only
// analysis; producing the file is a hard requirement (the runner retries once
// with feedback and then blocks as hidden blockage).
export function renderVerifyScriptGen(plan: Plan, task: Task, scriptPath: string): string {
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    `本次会话只为该任务生成 verify 脚本:driver 将在会话外统一执行它并交独立判定会话判定,
你不要执行任务本身的实现。任务 verify 字段${
      task.verify ? `是"${task.verify}"` : "未声明"
    },这是验收标准,按其语义(或任务正文与 docs/ 中的验收要求)设计验证方式。

任务:
1. 只读分析相关源码与 docs/,确定覆盖验收标准所需的检查(运行测试、lint、构建产物核对等);
2. 把检查写成可执行的 bash 脚本,写入 ${scriptPath}(绝对路径,driver 管理的 /tmp 下的
   目录,覆盖写):首行 #!/usr/bin/env bash,脚本自包含、可重复执行,非零退出码表示
   验证未通过;写完 chmod +x 赋予可执行位。

约束:
1. 只做验证类操作(运行测试/检查、读文件),不修改任何实现代码与 docs/;${STATE_RULE}
${QUESTION_RULE}
3. 产出该脚本是硬性要求:即使任务看起来已完成或极其简单,也必须写出文件
   (单一检查一行命令即可);不产出有效文件会导致任务阻塞停机;
4. 不要执行你写出的脚本(可做 bash -n 之类的只读语法检查),执行与判定由 driver 和
   独立判定会话负责;写出文件后立即结束会话。`,
  ].join("\n\n")
}

// Verify judge session (always a fresh side session): the driver has already
// executed the script — the prompt injects the run info (script path, exit
// code, duration, timeout, out/err file paths) and the session only reads
// files and code to reach a verdict. A non-zero exit code is not an automatic
// fail: the "script itself is broken → verify an equivalent way instead"
// leniency is kept. Verdict protocol is unchanged (VERDICT_FILE + 结论 line).
export function renderVerifyJudge(plan: Plan, task: Task, run: VerifyRun): string {
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    `本次审核对象是整个任务(实现已在之前的会话中完成,不要重做)。
先读 docs/${task.id}.report.md(收尾报告)了解各子任务产出;任务 verify 字段${
      task.verify ? `是"${task.verify}"` : "未声明"
    },作为验收标准。`,
    `driver 已在会话外执行了该任务的 verify 脚本,运行信息:

- 脚本: ${run.script}
- 退出码: ${run.code}
- 耗时: ${run.ms}ms
- 超时: ${run.timedOut ? "是(已被 driver 终止)" : "否"}
- stdout(整写文件): ${run.out}
- stderr(整写文件): ${run.err}

你是独立判定者:实现与脚本执行均由其他会话和进程完成,你只看到磁盘上的结果,
不要轻信任何自报,以你亲自检查的结果为准。

要求:
1. 直读上述 out/err 文件——大文件用分段读取,不要经 bash cat 等工具回显输出
   (会被截断,这正是三段式要避免的);结合收尾报告阅读相关源码与改动;
${QUESTION_RULE}
3. 退出码非 0 或超时不直接判不通过:先从输出判断实际原因;若脚本/命令本身有问题
   (写法错误、路径不对、环境不适用等),不判不通过,说明原因并用等价方式验证
   (可自行补跑只读检查:重跑测试、grep、读文件等);
4. 只判定不修复:禁止修改任何实现代码与文档,发现的问题只写进判定文件;${STATE_RULE}
5. 把判定写入 ${VERDICT_FILE}(覆盖写):简述判定依据与你实际执行的检查;若以等价命令
   完成验证,附一行 \`verified-command: <命令>\`(独立成行);最后一行必须是
   \`结论: 通过\` 或 \`结论: 差距 <差距描述>\`;
6. 写出判定文件后立即结束会话。`,
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

// --review quality-audit session (always a fresh side session). Dimensions:
// fidelity to the task/design docs, correctness (edge cases), and whether the
// verification itself was comprehensive and effective. Non-final reviews are
// scoped to this task's changes only; final reviews audit the whole plan.
// The audit report goes to docs/<id>.audit.md (final: docs/final-audit.md)
// and the conclusion to REVIEW_FILE with the same 结论-line protocol as
// VERDICT_FILE.
export function renderReview(plan: Plan, task: Task, opts: { final: boolean }): string {
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    `你是独立质量审核者,${
      opts.final
        ? "对整个实施计划的执行做最终全面审核"
        : `对任务 ${task.id} 的完成质量做审核`
    }(实现已在之前的会话中完成,不要重做)。

审核维度:
1. 忠实性: 实现与任务描述、设计文档(docs/)的要求对齐,没有偷换或遗漏要求;
2. 正确性: 逻辑与边界情形处理正确,无明显缺陷或回归风险;
3. 验证过程: verify 脚本与判定有效覆盖任务的验收标准,没有漏验或形同虚设的检查。`,
    opts.final
      ? `本次为最终审核: 通读 PLAN.md 全部任务、docs/ 下各报告与设计文档、整体 git 历史,
对整个计划的设计、实现与文档做全面审核,不受单任务范围限制。`
      : `本次审核范围以本任务改动为限: 依 docs/${task.id}.report.md 与 git log/status
(自上一任务完成后的提交与工作区状态)界定本任务改了什么;禁止审核其他任务的代码
(无论已完成还是未开始),发现的跨任务问题在报告中记录即可,不作为本任务的差距。`,
    `产出:
1. 审计报告写入 ${opts.final ? "docs/final-audit.md" : `docs/${task.id}.audit.md`}(覆盖写):
   按上述维度逐项记录发现(依据、位置、严重程度);
2. 结论写入 ${REVIEW_FILE}(覆盖写): 概述发现,仅有可记录的轻微问题时仍判通过;最后
   一行必须是 \`结论: 通过\` 或 \`结论: 差距 <差距描述>\`(差距 = 必须修复的忠实性/
   正确性/验证有效性问题)。

约束:
1. 只审不改: 禁止修改任何实现代码与文档,唯一可写的文件是审计报告与结论文件;${STATE_RULE}
${QUESTION_RULE}
3. 写出结论文件后立即结束会话。`,
  ].join("\n\n")
}

// --review fix-planning session (always a fresh side session): turns the
// audit gap into self-contained fix checklist items in docs/<id>.fix.md,
// which the driver appends into PLAN.md for the regular subtask sessions to
// execute. Planning only — no fixes here; producing the file is a hard
// requirement (retry once with feedback, then hidden blockage).
export function renderReviewFix(plan: Plan, task: Task, gap: string): string {
  return [
    ...head(plan),
    `当前任务:\n\n# ${task.id}: ${task.title}\n\n${task.body}`,
    `任务 ${task.id} 的独立质量审核未通过,差距如下(审计报告见 docs/${task.id}.audit.md):

${gap}

你是修复规划者: 不要直接修复,把审核差距转化为可执行的修复检查项。

任务:
1. 读审计报告 docs/${task.id}.audit.md 与相关代码,理解每条差距及其上下文;
2. 把每条差距规划为一个或多个修复步骤(单步或多步均可,以凭描述即可执行为准);
3. 把修复检查项写入 docs/${task.id}.fix.md(覆盖写),格式:

- [ ] <修复步骤描述>

描述必须自包含: 仅凭该描述、CURRENT.md 与 docs/ 即可执行,并包含验证方式。

约束:
1. 只规划不修复: 不修改任何实现代码与文档,本次唯一可写的文件是 docs/${task.id}.fix.md;${STATE_RULE}
${QUESTION_RULE}
3. 产出该文件是硬性要求: 每条差距都必须有对应检查项(若认定某差距不成立,也要写
   "核实并说明该差距不成立"的检查项);不产出有效文件会导致任务阻塞停机;
4. 写出文件后立即结束会话。`,
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
