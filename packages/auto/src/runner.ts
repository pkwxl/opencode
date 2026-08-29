import { createInterface } from "node:readline/promises"
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2"
import type { Interactive } from "./interactive"
import { log, subbanner, vlog } from "./log"
import {
  appendSubtasks,
  begin,
  countSubtasks,
  load,
  markDone,
  setStatus,
  setSubtasks,
  subtasks,
  tick,
  verifyCommand,
  type Plan,
  type Task,
} from "./plan"
import {
  handoffFile,
  renderCommitAll,
  renderDecompose,
  renderFix,
  renderHandoffSteer,
  renderReview,
  renderReviewFix,
  renderSubtask,
  renderVerifyJudge,
  renderVerifyScriptGen,
  renderWhole,
  renderWrapup,
  REVIEW_FILE,
  VERDICT_FILE,
  type CommitMode,
  type VerifyRun,
} from "./prompt"
import { allowWrite, reprotect } from "./protect"
import { resolveVerifyScript, runVerifyScript, verifyTmpDir } from "./verify"

export type Outcome = { type: "completed" } | { type: "blocked"; question: string } | { type: "incomplete"; reason: string }

// Questions get this fixed autonomous reply when no human answers in time
// (or --wait-answer was not given for non-permission questions); only a
// repeated question on the same issue escalates to human intervention.
const AUTO_ANSWER = "你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。"

// A failing task-level acceptance feeds the gap back into the execution
// session chain; after this many unsuccessful fix rounds the task blocks for
// human intervention.
const FIX_ROUNDS = 3

// --subtask 三档: off(单会话完成)/ auto(自动分解,缺省)/ ondemand(单会话执行,
// 上下文达到 --context-limit 时交接文档 + 新会话续跑)。
export type SubtaskMode = "off" | "auto" | "ondemand"

type Opts = {
  agent?: string
  // 目标目录;用于下发失败时检测 agent 契约文件缺失并给出恢复提示。
  dir?: string
  verbose?: boolean
  waitAnswer?: number
  commit?: CommitMode
  subtask?: SubtaskMode
  // dryrun 会话: 权限请求自动拒绝但不中断(供 AI 记录受阻项),提问一律自动答复。
  dryrun?: boolean
  // 会话复用的上下文已用量上限(tokens);缺省 64k(--context-limit n 以千 tokens 计)。
  contextLimit?: number
  // --review 质量审核轮数上限(0=不启用);CLI 接线在 T-020。
  review?: number
  // --early: 审核会话挪进 verify 脚本执行窗口并行(需 review>0,设计文档 F 节),
  // 经 verifyTask 审核挂点实现。
  early?: boolean
  // --interactive 旁路: 每个会话建立/复用时 attach,人工输入经它注入会话;
  // ask 的人工等待也改由它接收(语义不变)。
  interactive?: Interactive
}

type Watch = {
  blocked?: Outcome & { type: "blocked" }
  error?: string
  lastText: string
  // 会话结束时最近一次 assistant 消息的上下文占比(0-100);上限未知记 100。
  pct: number
  // 会话结束时最近一次 assistant 消息的上下文已用量(tokens: input + cache.read)。
  used: number
}

type SessionResult = { type: "idle"; lastText: string } | (Outcome & { type: "blocked" })

// 任务内所有会话(分解/子任务/修复/收尾)串成一条链: 上一会话结束时上下文
// 占比低于 REUSE_BELOW 且已用量低于 contextLimit 则下次复用同一会话,否则新建。
// 初始 pct=100 保证首个会话新建;模型上限未知时 watch 记 100,即总是新建。
type SessionChain = { id?: string; pct: number; used: number }

// 上下文占比低于该值(%)时复用上一会话。
const REUSE_BELOW = 50

// 会话复用的上下文已用量默认上限(tokens);--context-limit n 以千 tokens 覆盖。
const DEFAULT_CONTEXT_LIMIT = 64_000

// Runs one task through the pipeline; the driver owns all state
// writes to PLAN.md and CURRENT.md, sessions never edit them.
// --subtask auto (default): decompose (when the task body has no checklist) →
// one session per subtask (driver ticks on trust) → wrap-up → verify.
// --subtask off: a single whole-task session → wrap-up → verify; any gap
// sends the task back to pending for a human to refine and re-run (no fix
// subtasks).
// --subtask ondemand: like off, but when the running session's context usage
// reaches --context-limit the driver steers in a handoff prompt; the session
// writes docs/<id>.handoff.md and a fresh session continues from it.
// The execution phase (decompose / whole-task session) runs only on the first
// round; every round then is: subtask sessions for the unticked checklist →
// wrap-up session → three-stage task-level acceptance (the driver resolves
// and runs the verify script itself, output dumped to /tmp files, never
// truncated; an independent judge session reads the results and writes the
// verdict; a gap feeds the verdict back into the execution chain for a fix
// round, max FIX_ROUNDS, except off mode).
// With --review n > 0 a quality-audit round follows each acceptance pass:
// an independent audit session (final = every task after this one is done)
// writes an audit report plus the REVIEW_FILE conclusion. A gap in off mode
// reverts the task to pending like a verify gap; otherwise the driver plans
// fix checklist items in a side session, appends them into PLAN.md and runs
// the whole round again (up to n fix rounds, then blocked).
// --early moves that audit session into the verify-script execution window
// (design doc F): verifyTask starts it right before executing the script,
// joins it before the judge session and returns its verdict together with
// the done result, so the audit below consumes it instead of opening a
// separate serial audit session.
// All execution sessions of a task share one chain: the next session reuses
// the previous one when its context usage ended below REUSE_BELOW and its used
// tokens below contextLimit (default 64k), otherwise a fresh session is created.
// Blocking happens on unanswered permission requests (an explicit non-approval
// reply rejects the permission but lets the session continue without it), a
// repeated question on the same issue, exhausted transient session errors, or
// a failed verification.
export async function runTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
): Promise<Outcome> {
  await begin(plan.path, task.id)
  const chain: SessionChain = { pct: 100, used: 0 }
  const mode = opts.subtask ?? "auto"
  // Mirror the task into CURRENT.md before the first session: the agent
  // contract requires every session to read it, and an interrupted run may
  // have left it missing or stale. Later writeCurrent calls refresh it.
  task = requireTask(await load(plan.path), task.id)
  await writeCurrent(plan.path, task, mode !== "auto")
  // 执行阶段仅首轮进入: auto 先确保分解出检查项,off/ondemand 单会话执行
  // 整个任务;review 差距注入的 fix 检查项走下方的子任务会话循环。
  if (mode === "auto") {
    const decomposed = await ensureDecomposed(client, plan, task, opts, chain)
    if (decomposed.type === "blocked") return decomposed
    task = decomposed.task
  } else {
    const blocked = await executeWhole(client, plan, task, opts, chain, mode === "ondemand")
    if (blocked) return blocked
    task = requireTask(await load(plan.path), task.id)
  }
  await writeCurrent(plan.path, task, mode !== "auto")

  const limit = opts.review ?? 0
  // --early(设计文档 F.2/F.5): review 启用时把审核会话挪进 verify 脚本执行
  // 窗口并行,verifyTask 经挂点启动并随 done 带回 audit 结论。
  const early = opts.early && limit > 0
  for (let round = 0; ; ) {
    // auto 模式此处执行分解出的检查项(含 review 注入的 fix 检查项);
    // off/ondemand 模式只有正文中人工编写的检查项。
    for (;;) {
      const items = subtasks(task.body)
      const index = items.findIndex((item) => !item.done)
      if (index === -1) break
      const blocked = await runSubtask(client, plan, task, items[index].text, index + 1, opts, chain)
      if (blocked) return blocked
      task = requireTask(await load(plan.path), task.id)
      await writeCurrent(plan.path, task, mode !== "auto")
    }

    const result = await runSession(client, task, renderWrapup(plan, task, { commit: opts.commit, solo: mode !== "auto" }), opts, chain)
    if (result.type === "blocked") return result
    // 三段式验收自带修复轮(差距反馈回执行会话链,≤ FIX_ROUNDS);
    // gap 只在 off 模式出现(该模式不修复,回退 pending 等人工改进)。
    // early 时审核挂点并行进脚本执行窗口,结论随 done 带回。
    const verdict = await verifyTask(client, plan, task, opts, chain, early ? () => reviewTask(client, plan, task, opts, true) : undefined)
    if (verdict.type === "blocked") return verdict
    if (verdict.type === "gap") {
      await setStatus(plan.path, task.id, "pending")
      return { type: "incomplete", reason: verdict.gap }
    }
    if (limit <= 0) return { type: "completed" }

    // early 的审核结论已随 verifyTask 带回(挂点在每次脚本执行前重开,done 必有
    // 结论);非 early 在验收通过后串行开审核会话。
    const audit = verdict.audit ?? (await reviewTask(client, plan, task, opts))
    if (audit.type === "blocked") return audit
    if (audit.type === "pass") return { type: "completed" }

    // off 模式不做审核修复循环: 与该模式 verify 失败语义一致。
    if (mode === "off") {
      await setStatus(plan.path, task.id, "pending")
      return { type: "incomplete", reason: audit.gap }
    }
    round++
    if (round > limit) {
      return { type: "blocked", question: `质量审核连续 ${limit} 轮修复后仍未通过:\n${audit.gap}` }
    }
    // verifyTask 通过时已把任务标 done;审核发现差距须先置回 in_progress,
    // 否则中断重跑时 next() 会跳过该任务,注入的 fix 检查项永不执行。
    await setStatus(plan.path, task.id, "in_progress")
    log(`↻ ${task.id} 质量审核未通过,规划修复子任务后继续(第 ${round}/${limit} 轮):\n${audit.gap}`)
    const planned = await planReviewFix(client, plan, task, opts, audit.gap)
    if (planned.type === "blocked") return planned
    await appendSubtasks(plan.path, task.id, planned.items)
    task = requireTask(await load(plan.path), task.id)
    await writeCurrent(plan.path, task, mode !== "auto")
  }
}

// off/ondemand 的执行阶段: off 单会话完成整个任务;ondemand 会话进行中上下文
// 达到 --context-limit 时由 driver steer 交接提示,会话写出交接文档后换新会话
// 续跑,直到自然完成或交接文档标记完成。返回 undefined 表示执行阶段完成。
async function executeWhole(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  ondemand: boolean,
): Promise<(Outcome & { type: "blocked" }) | undefined> {
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const file = join(dirname(plan.path), handoffFile(task))
  // 清除上一次尝试遗留的交接文档,避免误当作本次会话的产出。
  if (ondemand) await rm(file, { force: true })
  const steer = ondemand ? { limit: cap, text: renderHandoffSteer(task) } : undefined
  let continuation = false
  let feedback = ""
  let retried = false
  for (;;) {
    const result = await runSession(
      client,
      task,
      renderWhole(plan, task, { commit: opts.commit, ondemand, continuation }) + feedback,
      opts,
      chain,
      steer,
    )
    if (result.type === "blocked") return result
    // 未触发上下文上限即结束 = 任务在单会话内自然完成。
    if (!ondemand || chain.used < cap) return undefined
    const status = /状态[:：]\s*(继续|完成)/.exec(await Bun.file(file).text().catch(() => ""))?.[1]
    if (status === "完成") return undefined
    if (status === "继续") {
      log(`↻ ${task.id} 上下文达到 ${formatTokens(cap)} 上限,已交接 ${handoffFile(task)},新会话继续`)
      continuation = true
      feedback = ""
      continue
    }
    if (retried) {
      return {
        type: "blocked",
        question:
          `会话上下文达到上限但两次未写出有效交接文档 ${handoffFile(task)}(缺失或无状态行,隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 达到上下文上限但未产出 ${handoffFile(task)},带反馈重试一次`)
    retried = true
    feedback =
      `\n\n你上次结束会话时上下文已达上限,但未写出有效的 ${handoffFile(task)}(缺失或缺少 \`状态: 继续|完成\` 行)。` +
      `这是硬性要求: 写出该文件后再结束会话。`
  }
}

// --commit once: 计划全部完成后的唯一一次整体提交会话(全新,不进任何链)。
export async function commitAll(client: OpencodeClient, plan: Plan, opts: Opts): Promise<Outcome> {
  const result = await runSession(client, pseudoTask("PLAN", "整体提交"), renderCommitAll(plan), opts, { pct: 100, used: 0 })
  if (result.type === "blocked") return result
  return { type: "completed" }
}

// init --prompt 与 --dryrun 的单次独立会话: 不属于任何任务,不进任何链。
export async function runOnce(
  client: OpencodeClient,
  title: string,
  promptText: string,
  opts: Opts,
): Promise<SessionResult> {
  return runSession(client, pseudoTask("AUTO", title), promptText, opts, { pct: 100, used: 0 })
}

function pseudoTask(id: string, title: string): Task {
  return { id, title, status: "in_progress", attempts: 0, body: "" }
}

function requireTask(plan: Plan, id: string): Task {
  const task = plan.tasks.find((task) => task.id === id)
  if (!task) throw new Error(`${plan.path}: task ${id} not found`)
  return task
}

// CURRENT.md mirrors the task in progress; the agent contract makes every
// session read it first, so the current task survives context compaction.
// The server re-reads it on every provider turn, so no restart is needed.
async function writeCurrent(path: string, task: Task, solo = false) {
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
  ].join("\n")
  const file = join(dirname(path), "CURRENT.md")
  await allowWrite(file)
  await Bun.write(file, content)
  await reprotect(file)
}

// Ensures the task body has a checklist: tasks resuming with one (or with a
// human-written one) are used as-is; otherwise a decomposition session writes
// docs/<id>.subtasks.md and the driver injects the items into PLAN.md.
async function ensureDecomposed(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
): Promise<({ type: "ok" } & { task: Task }) | (Outcome & { type: "blocked" })> {
  if (subtasks(task.body).length) return { type: "ok", task }
  const file = join(dirname(plan.path), "docs", `${task.id}.subtasks.md`)
  let feedback = ""
  // One automatic retry with feedback: a resumed session may have done the
  // work instead of writing the file; the file is a hard requirement.
  for (let i = 0; ; i++) {
    const result = await runSession(client, task, renderDecompose(plan, task) + feedback, opts, chain)
    if (result.type === "blocked") return result
    const items = subtasks(await Bun.file(file).text().catch(() => "")).map((item) => item.text)
    if (items.length) {
      await setSubtasks(plan.path, task.id, items)
      return { type: "ok", task: requireTask(await load(plan.path), task.id) }
    }
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `分解会话两次结束但 ${file} 缺失或不含有效检查项(隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 分解会话未产出 ${file},带反馈重试一次`)
    feedback =
      `\n\n你上次结束会话但未写出有效的 ${file}(缺失或无检查项)。这是硬性要求:` +
      `即使任务已完成或极简单,也必须写出该文件(原子任务写单个检查项即可)。`
  }
}

// Runs one subtask session, then ticks the checklist item on trust: the
// session self-checks its own work, and acceptance of the whole task is
// deferred to the single task-level review after wrap-up (a gap there
// appends a fix subtask).
async function runSubtask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  text: string,
  index: number,
  opts: Opts,
  chain: SessionChain,
): Promise<(Outcome & { type: "blocked" }) | undefined> {
  subbanner(`${task.id} 子任务 ${index}：${text.length > 50 ? `${text.slice(0, 50)}…` : text}`)
  const result = await runSession(client, task, renderSubtask(plan, task, text, opts), opts, chain)
  if (result.type === "blocked") return result
  await tick(plan.path, task.id, text)
  log(`  ✓ ${text.slice(0, 60)}`)
  return undefined
}

// Task-level acceptance after the wrap-up session, three stages (设计文档
// A.4/A.5): resolve and (when needed) generate the verify script, execute it
// via the driver, then run the independent judge session and parse its
// verdict file. On pass the verified field prefers the judge's
// verified-command line, then the task's original command, then the actual
// executed script path. A gap is fed back into the execution session chain
// for a fix round (wrap-up re-runs, then the same script is re-executed and
// re-judged) until it passes or FIX_ROUNDS is exhausted; off mode skips fix
// rounds and returns the gap to the caller (task reverts to pending).
// Each review round re-enters verifyTask with a fresh fix-round budget.
// --early audit hook (设计文档 F.5): when given, a fresh audit session starts
// right before each script execution (after the generate session, if any) and
// joins before the judge session — a blocked audit propagates immediately;
// the last audit verdict rides back with the done result.
async function verifyTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  audit?: () => Promise<Verdict | (Outcome & { type: "blocked" })>,
): Promise<{ type: "done"; audit?: Verdict } | { type: "gap"; gap: string } | (Outcome & { type: "blocked" })> {
  const mode = opts.subtask ?? "auto"
  for (let round = 0; ; ) {
    const execution = await executeVerifyScript(client, plan, task, opts, audit)
    if (execution.type === "blocked") return execution
    const verdict = await judge(client, plan, task, opts, execution.run)
    if (verdict.type === "blocked") return verdict
    if (verdict.type === "pass") {
      await markDone(plan.path, task.id, verdict.command ?? verifyCommand(task) ?? execution.run.script)
      return { type: "done", audit: execution.audit }
    }
    // off 模式不做修复重跑: 差距交回调用方(回退 pending,等人工改进后重试)。
    if (mode === "off") return { type: "gap", gap: verdict.gap }
    round++
    if (round >= FIX_ROUNDS) {
      return { type: "blocked", question: `任务级验收连续 ${FIX_ROUNDS} 轮未通过:\n${verdict.gap}` }
    }
    // 把判定会话的差距信息反馈回执行会话链,续跑修复后重新收尾与验收。
    log(`↻ ${task.id} 验收未通过,把审核差距反馈回执行会话续跑修复(第 ${round}/${FIX_ROUNDS - 1} 轮):\n${verdict.gap}`)
    const fixed = await runSession(client, task, renderFix(plan, task, verdict.gap), opts, chain)
    if (fixed.type === "blocked") return fixed
    const wrapped = await runSession(client, task, renderWrapup(plan, task, { commit: opts.commit, solo: mode !== "auto" }), opts, chain)
    if (wrapped.type === "blocked") return wrapped
  }
}

type Verdict = { type: "pass"; command?: string } | { type: "gap"; gap: string }

// Verify 前两段: resolveVerifyScript 判定来源(existing/wrapped 由 driver 直接
// 给出;自然语言或缺失先开一次性脚本生成旁路会话——generate 分支沿用约定名
// /tmp/<基名>/verify.sh,上一轮(或修复前)生成的脚本存在则复用,V1 不自动重新
// 生成),随后 runVerifyScript 在目标目录执行并 log 一行结果(退出码、耗时、
// out/err 路径)。退出码非 0 不在此判定——判定权在判定会话。
// --early 审核挂点(F.2 时序保证): generate 分支的脚本生成会话结束后才启动
// 审核会话,与脚本执行并行;脚本执行完毕先 join 审核(blocked 立即上抛),随后
// 才进入判定会话。每次脚本执行(含修复轮重跑)重开一次新审核。
async function executeVerifyScript(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  audit?: () => Promise<Verdict | (Outcome & { type: "blocked" })>,
): Promise<{ type: "ok"; run: VerifyRun; audit?: Verdict } | (Outcome & { type: "blocked" })> {
  const dir = opts.dir ?? dirname(plan.path)
  const tmp = verifyTmpDir(dir)
  // generate 分支的脚本约定名:上一次(或上轮修复前)生成的脚本存在则复用。
  const script = join(tmp, "verify.sh")
  const resolved = await resolveVerifyScript(task, dir)
  if (resolved.kind === "generate" && !(await Bun.file(script).exists())) {
    const failed = await generateScript(client, plan, task, opts, script)
    if (failed) return failed
  }
  const path = resolved.kind === "generate" ? script : resolved.script
  const auditing = audit?.()
  const run = await runVerifyScript(dir, path)
  const outPath = join(tmp, "verify.out")
  const errPath = join(tmp, "verify.err")
  log(
    `  ⚙ verify 脚本退出码 ${run.code}${run.timedOut ? "(超时终止)" : ""},耗时 ${run.ms}ms,输出: ${outPath} / ${errPath}`,
  )
  const audited = await auditing
  if (audited?.type === "blocked") return audited
  return { type: "ok", run: { script: path, code: run.code, ms: run.ms, timedOut: run.timedOut, out: outPath, err: errPath }, audit: audited }
}

// Verify 第三段: 独立判定旁路会话(一次性 chain,不进任务执行链),注入运行信息,
// 解析 VERDICT_FILE 结论;产出缺失的重试策略见 requireArtifact。
async function judge(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  run: VerifyRun,
): Promise<Verdict | (Outcome & { type: "blocked" })> {
  const file = join(dirname(plan.path), VERDICT_FILE)
  return requireArtifact(client, task, renderVerifyJudge(plan, task, run), opts, {
    kind: "审核",
    artifact: `有效判定文件 ${VERDICT_FILE}`,
    detail: "缺失或无结论行",
    requirement: "无论审核结论如何,都必须写出该文件,且最后一行为 `结论: 通过` 或 `结论: 差距 <描述>`。",
    reset: () => rm(file, { force: true }),
    collect: async () => parseVerdict(await Bun.file(file).text().catch(() => "")),
  })
}

// Natural-language or missing verify: a one-shot side session writes the
// executable script (retry/blockage policy shared via requireArtifact).
async function generateScript(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  script: string,
): Promise<(Outcome & { type: "blocked" }) | undefined> {
  const produced = await requireArtifact(client, task, renderVerifyScriptGen(plan, task, script), opts, {
    kind: "脚本生成",
    artifact: script,
    requirement: "必须把可执行脚本写到该路径并 chmod +x。",
    collect: async () => (await Bun.file(script).exists()) || undefined,
  })
  if (produced !== true) return produced
  return undefined
}

// --review 质量审核(设计文档 B.2/B.3): 旁路审核会话产出 audit 报告,结论写
// REVIEW_FILE(协议同 VERDICT_FILE,复用 requireArtifact/parseVerdict 的重试
// 策略)。final = 当前任务之后全部任务已 done(或无后继),即本任务是最后一
// 个任务,审核升级为全计划终审。
// --early 下同一会话经挂点在 verify 脚本执行窗口并行启动(F.3): 提示词用
// early 措辞(静态审核脚本内容、以只读检查为主),横幅随窗口启动打印。
async function reviewTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  early = false,
): Promise<Verdict | (Outcome & { type: "blocked" })> {
  // 重新加载计划判定 final: 串行路径下当前任务刚被 verifyTask 标 done;early
  // 窗口下审核先于 markDone 启动,但 final 只看后继任务,两者结论一致。
  const current = await load(plan.path)
  const index = current.tasks.findIndex((item) => item.id === task.id)
  const final = current.tasks.slice(index + 1).every((item) => item.status === "done")
  log(`⚖ ${task.id} ${final ? "最终质量审核(全计划)" : "质量审核"}${early ? "(与 verify 脚本并行)" : ""}`)
  const file = join(dirname(plan.path), REVIEW_FILE)
  return requireArtifact(client, task, renderReview(current, task, { final, early }), opts, {
    kind: "质量审核",
    artifact: `有效结论文件 ${REVIEW_FILE}`,
    detail: "缺失或无结论行",
    requirement: "无论审核结论如何,都必须写出该文件,且最后一行为 `结论: 通过` 或 `结论: 差距 <描述>`。",
    reset: () => rm(file, { force: true }),
    collect: async () => parseVerdict(await Bun.file(file).text().catch(() => "")),
  })
}

// 审核差距 → 旁路修复规划会话(设计文档 B.4): 产出 docs/<id>.fix.md 检查项,
// 调用方经 appendSubtasks 注入 PLAN.md,交既有子任务会话机制执行。
async function planReviewFix(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  gap: string,
): Promise<{ type: "ok"; items: string[] } | (Outcome & { type: "blocked" })> {
  const file = join(dirname(plan.path), "docs", `${task.id}.fix.md`)
  const collected = await requireArtifact(client, task, renderReviewFix(plan, task, gap), opts, {
    kind: "修复规划",
    artifact: `有效修复检查项文件 docs/${task.id}.fix.md`,
    detail: "缺失或无检查项",
    requirement: "必须把修复检查项写入该文件(每条差距至少一项)。",
    reset: () => rm(file, { force: true }),
    collect: async () => {
      const items = subtasks(await Bun.file(file).text().catch(() => ""))
      return items.length ? items.map((item) => item.text) : undefined
    },
  })
  if (!Array.isArray(collected)) return collected
  return { type: "ok", items: collected }
}

// “旁路会话必须产出文件”的通用骨架(设计文档 A.4): 会话结束但产物缺失或无效时
// 带反馈重试一次,仍失败按隐性阻塞停机(人工检查后重新运行续跑)。脚本生成、
// 判定、质量审核与修复规划会话共用;collect 返回 undefined 表示该次会话未产出
// 有效产物。
async function requireArtifact<T>(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
  spec: {
    // 会话类型,用于日志与阻塞信息(如“审核”、“脚本生成”)。
    kind: string
    // 产物描述(如 `有效判定文件 ${VERDICT_FILE}`)。
    artifact: string
    // 阻塞信息中的缺失原因补充(如“缺失或无结论行”)。
    detail?: string
    // 重试反馈中的硬性要求。
    requirement: string
    // 每次会话前清理旧产物,避免会话未写出时被误当作本次产出。
    reset?: () => Promise<void>
    // 会话结束后采集产物。
    collect: () => Promise<T | undefined>
  },
): Promise<T | (Outcome & { type: "blocked" })> {
  let feedback = ""
  for (let i = 0; ; i++) {
    await spec.reset?.()
    const result = await runSession(client, task, promptText + feedback, opts, { pct: 100, used: 0 })
    if (result.type === "blocked") return result
    const value = await spec.collect()
    if (value !== undefined) return value
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `${spec.kind}会话两次结束但未产出${spec.artifact}${spec.detail ? `(${spec.detail})` : ""}(隐性阻塞)。` +
          `请检查后重新运行。${spec.kind}会话最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} ${spec.kind}会话未产出${spec.artifact},带反馈重试一次`)
    feedback = `\n\n你上次结束会话但未产出${spec.artifact}。这是硬性要求:${spec.requirement}`
  }
}

function parseVerdict(text: string): Verdict | undefined {
  const conclusion = /结论[:：]\s*(通过|差距[^\n]*)/.exec(text)
  if (!conclusion) return undefined
  if (conclusion[1] === "通过") {
    return { type: "pass", command: /^verified-command:\s*(.+)$/m.exec(text)?.[1]?.trim() }
  }
  return { type: "gap", gap: conclusion[1]!.trim() }
}

// Runs one prompt on the session chain (reusing the previous session when its
// context ended below REUSE_BELOW). Transient provider failures
// (session.error, e.g. malformed reasoning content from a gateway) are
// retried in a fresh session before blocking.
// steer: 会话进行中已用上下文达到 limit 时,driver 向该会话插入一次 text
// (ondemand 的交接提示;v2 prompt 默认 steer,在下一个 provider turn 边界生效)。
type Steer = { limit: number; text: string }

async function runSession(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
): Promise<SessionResult> {
  for (let i = 1; ; i++) {
    const result = await attempt(client, task, promptText, opts, chain, steer)
    const transient = result.type === "blocked" && result.question.startsWith("会话错误:")
    if (!transient) return result
    if (i === RETRIES) return { type: "blocked", question: `${result.question}\n(已换新会话自动重试 ${RETRIES - 1} 次仍失败)` }
    log(`↻ ${task.id} 遇到瞬时会话错误,换新会话重试(${i}/${RETRIES - 1}):\n${result.question}`)
    // 重试保持"换新会话"语义,不复用出错的会话。
    chain.id = undefined
    chain.pct = 100
  }
}

// Session errors get this many fresh-session attempts before blocking.
const RETRIES = 3

async function attempt(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
): Promise<SessionResult> {
  // 上一会话上下文占比低于 50% 且已用量低于 contextLimit(默认 64k tokens)
  // 则复用同一会话继续,否则新建。
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const reuse = chain.id !== undefined && chain.pct < REUSE_BELOW && chain.used < cap
  if (reuse) log(`♻ 复用会话(上下文 ${chain.pct}%,已用 ${formatTokens(chain.used)} tokens)`)
  if (!reuse && chain.id !== undefined) {
    const reason =
      chain.pct >= REUSE_BELOW
        ? `上下文占比 ${chain.pct}% 达到 ${REUSE_BELOW}% 阈值`
        : `已用 ${formatTokens(chain.used)} tokens 达到 ${formatTokens(cap)} 上限`
    log(`▷ ${reason},开启新会话`)
  }
  const session = reuse ? undefined : await client.session.create({ title: `[auto] ${task.id} ${task.title}` })
  if (session?.error) return { type: "blocked", question: `创建会话失败: ${JSON.stringify(session.error)}` }
  const sessionID = session?.data.id ?? chain.id!
  // 交互旁路: 此后人工输入发往本会话(审核/收尾等旁路会话同样覆盖)。
  opts.interactive?.attach(sessionID)

  const events = await client.event.subscribe()
  const watching = watch(client, sessionID, events.stream, opts, steer)

  const prompt = await client.session.prompt({
    sessionID,
    agent: opts.agent,
    parts: [{ type: "text", text: promptText }],
  })
  if (prompt.error) return { type: "blocked", question: `下发任务失败: ${JSON.stringify(prompt.error)}${await missingAgentHint(opts)}` }

  const result = await watching
  chain.id = sessionID
  chain.pct = result.pct
  chain.used = result.used
  if (result.blocked) return result.blocked
  if (result.error) return { type: "blocked", question: `会话错误: ${result.error}` }
  return { type: "idle", lastText: result.lastText }
}

// 下发任务失败的常见根因: 目标目录缺少 agent 契约文件时服务端只回
// UnknownError(错误体不含根因),此处检测并提示恢复方式。
async function missingAgentHint(opts: Opts): Promise<string> {
  if (!opts.dir) return ""
  const file = `.opencode/agent/${opts.agent ?? "auto"}.md`
  const exists = await Bun.file(join(opts.dir, file)).exists()
  if (exists) return ""
  return `\n提示: 目标目录缺少 agent 契约文件 ${file},服务端会因此以 UnknownError 拒绝下发任务;运行 opencode-auto init ${opts.dir} 恢复后重跑`
}

async function watch(
  client: OpencodeClient,
  sessionID: string,
  stream: AsyncIterable<unknown>,
  opts: Opts,
  steer?: Steer,
): Promise<Watch> {
  const verbose = opts.verbose
  const waitAnswer = opts.waitAnswer ?? 0
  let lastText = ""
  let error = ""
  // 上下文占比与已用量始终跟踪(会话复用决策依据),与 verbose 无关;拿不到上限记 100。
  let pct = 100
  let used = 0
  // steer 每会话只插入一次。
  let steerSent = false
  const autoAnswered: string[] = []
  // verbose 已输出的 part 与 message,避免同一 part 的多次更新事件重复打印。
  const seen = new Set<string>()
  // 模型上下文上限(providerID/modelID → limit.context),首次需要时拉取。
  let limits: Map<string, number> | undefined
  for await (const raw of stream) {
    const event = raw as import("@opencode-ai/sdk/v2").Event
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionID) continue
      if (part.type === "text" && part.time?.end) {
        lastText = part.text
        if (verbose) vlog(part.text)
        continue
      }
      const line = verbose ? describePart(part) : undefined
      if (line && !seen.has(part.id)) {
        seen.add(part.id)
        vlog(line)
      }
    }
    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.sessionID !== sessionID) continue
      if (info.role !== "assistant" || !info.time.completed || seen.has(info.id)) continue
      seen.add(info.id)
      limits ??= await contextLimits(client)
      used = info.tokens.input + info.tokens.cache.read
      const limit = limits.get(`${info.providerID}/${info.modelID}`)
      pct = limit ? Math.round((used / limit) * 100) : 100
      if (verbose) vlog(`  上下文: ${formatTokens(used)}${limit ? `/${formatTokens(limit)}` : ""} tokens${limit ? ` (${pct}%)` : ""}`)
      if (steer && !steerSent && used >= steer.limit) {
        steerSent = true
        log(`⚠ 上下文已用 ${formatTokens(used)} tokens 达到 ${formatTokens(steer.limit)} 上限,插入交接提示`)
        await client.session.prompt({ sessionID, parts: [{ type: "text", text: steer.text }] }).catch(() => {})
      }
    }
    if (event.type === "question.asked") {
      const asked = event.properties
      if (asked.sessionID !== sessionID) continue
      const text = asked.questions.map((q) => q.question).join("\n")
      // dryrun 预检会话一律自动答复,不因提问阻塞。
      const permission = opts.dryrun ? false : /权限|permission/i.test(text)
      const repeated = autoAnswered.some((prev) => sameIssue(prev, text))
      // 权限与非权限提问在 --wait-answer 下都先等人工答复,超时一律回落
      // AUTO_ANSWER 让 AI 自主决策继续;仅缺省 --wait-answer 时的权限提问
      // 直接阻塞(无人值守时不能替人工决定是否授权)。
      if (!repeated && (!permission || waitAnswer > 0)) {
        autoAnswered.push(text)
        log(`❓ 收到${permission ? "权限" : "非权限"}提问:\n${text}`)
        const human = waitAnswer > 0 ? await askHuman(waitAnswer, "超时将自动答复", opts.interactive) : undefined
        const reply = human ?? AUTO_ANSWER
        log(human ? `→ 人工答复: ${human}` : `→ 自动答复: ${AUTO_ANSWER}`)
        await client.question
          .reply({ requestID: asked.id, answers: asked.questions.map(() => [reply]) })
          .catch(() => {})
        continue
      }
      await client.question.reject({ requestID: asked.id }).catch(() => {})
      await client.session.abort({ sessionID }).catch(() => {})
      return {
        blocked: {
          type: "blocked",
          question: permission ? text : `自动答复后仍就同一问题再次询问,需人工在会话外处理后重新运行:\n${text}`,
        },
        lastText,
        pct,
        used,
      }
    }
    if (event.type === "permission.asked") {
      const asked = event.properties
      if (asked.sessionID !== sessionID) continue
      // dryrun 预检: 自动拒绝但不中断会话,让 AI 记录受阻项后继续探查下一项。
      if (opts.dryrun) {
        log(`🔐 预检探查被拒绝(记入报告): ${asked.permission} (${asked.patterns.join(", ")})`)
        await client.permission.reply({ requestID: asked.id, reply: "reject" }).catch(() => {})
        continue
      }
      // --wait-answer 下权限请求同样等待人工指令: 回答 allow/yes/y 等视为
      // 确认授权(always 放行本请求的 patterns);明确的其余回答拒绝该权限但
      // 不中断会话,AI 在无该权限下绕开继续工作;只有超时(等同无人值守)
      // 才拒绝并阻塞停机。
      if (waitAnswer > 0) {
        log(`🔐 收到权限请求: ${asked.permission} (${asked.patterns.join(", ")})`)
        const human = await askHuman(
          waitAnswer,
          "输入 allow/yes/y 确认授权,其余回答将拒绝该权限并继续,超时将拒绝并阻塞",
          opts.interactive,
        )
        if (human && isApproval(human)) {
          log(`→ 人工授权: ${human}(always 放行)`)
          await client.permission.reply({ requestID: asked.id, reply: "always" }).catch(() => {})
          continue
        }
        if (human) {
          log(`→ 人工未授权: ${human}(拒绝该权限,AI 无授权继续)`)
          await client.permission.reply({ requestID: asked.id, reply: "reject" }).catch(() => {})
          continue
        }
      }
      await client.permission.reply({ requestID: asked.id, reply: "reject" }).catch(() => {})
      await client.session.abort({ sessionID }).catch(() => {})
      return {
        blocked: {
          type: "blocked",
          question: `需要权限: ${asked.permission} (${asked.patterns.join(", ")})。请在目标目录 opencode.json 的 permission 规则中放行后重新运行。`,
        },
        lastText,
        pct,
        used,
      }
    }
    if (event.type === "session.error") {
      const props = event.properties
      if (props.sessionID !== sessionID || !props.error) continue
      const detail =
        "data" in props.error && props.error.data && "message" in props.error.data
          ? String(props.error.data.message)
          : String(props.error.name)
      error = error ? `${error}\n${detail}` : detail
    }
    if (
      (event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle") ||
      (event.type === "session.idle" && event.properties.sessionID === sessionID)
    ) {
      break
    }
  }
  return { lastText, error, pct, used }
}

// verbose 模式下把非文本 part 转成一行可读输出;返回 undefined 表示该 part
// 尚无终态内容可输出(后续更新事件会再触发)。工具输出与推理原文较长,
// 截断到与 verify 输出相同的 2000 字符上限。
function describePart(part: Part): string | undefined {
  if (part.type === "reasoning") return part.time.end ? `  推理:\n${part.text.trim().slice(0, 2000)}` : undefined
  if (part.type === "tool") {
    if (part.state.status === "completed") return `  工具 ${part.tool}: ${part.state.title || "完成"}`
    if (part.state.status === "error") return `  工具 ${part.tool} 出错: ${part.state.error.slice(0, 2000)}`
    return undefined
  }
  if (part.type === "step-finish") return `  步骤结束(${part.reason}): 输入 ${formatTokens(part.tokens.input)} / 输出 ${formatTokens(part.tokens.output)} tokens`
  if (part.type === "step-start") return `  步骤开始`
  if (part.type === "file") return `  文件: ${part.filename ?? part.url}`
  if (part.type === "subtask") return `  子任务(${part.agent}): ${part.description}`
  if (part.type === "agent") return `  子代理: ${part.name}`
  if (part.type === "patch") return `  补丁(${part.files.length} 个文件): ${part.files.join(", ")}`
  if (part.type === "snapshot") return `  快照: ${part.snapshot}`
  if (part.type === "retry") return `  ↻ 请求重试(第 ${part.attempt} 次)`
  if (part.type === "compaction") return `  上下文压缩${part.auto ? "(自动)" : ""}`
  return undefined
}

// 拉取一次 provider 列表,建立 providerID/modelID → 上下文上限的映射;
// 失败时返回空映射,上下文行退化为只显示用量不显示百分比。
async function contextLimits(client: OpencodeClient): Promise<Map<string, number>> {
  const response = await client.provider.list().catch(() => undefined)
  const limits = new Map<string, number>()
  for (const provider of response?.data?.all ?? []) {
    for (const [id, model] of Object.entries(provider.models)) {
      limits.set(`${provider.id}/${id}`, model.limit.context)
    }
  }
  return limits
}

function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Two questions count as the same issue when their normalized texts match or
// one contains the other (the agent may rephrase a question it already asked).
function sameIssue(a: string, b: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  const x = normalize(a)
  const y = normalize(b)
  return x === y || x.includes(y) || y.includes(x)
}

// 权限等待中,这些回答(忽略首尾空白与大小写)视为确认授权。
function isApproval(answer: string): boolean {
  return /^(allow|yes|y|ok|approve|always|允许|授权|是)$/.test(answer.trim().toLowerCase())
}

// Waits up to `minutes` for a human answer on stdin (Enter confirms); returns
// undefined on timeout or empty input, in which case the caller falls back to
// AUTO_ANSWER (questions) or blocks (permission requests).
// --interactive 下改由常驻输入行接收回答(提示语、超时与回落语义不变)。
async function askHuman(minutes: number, hint: string, interactive?: Interactive): Promise<string | undefined> {
  const promptText = `请在 ${minutes} 分钟内输入回答(回车确认,${hint}): `
  if (interactive) return (await interactive.question(promptText, minutes)) || undefined
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // raw 模式下 ^C 不会触发进程级 SIGINT,readline 会截获;转发给进程级
  // 处理器,使等待人工答复期间连续两次 Ctrl+C 同样能强制终止。
  rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answer = await Promise.race([
      rl.question(promptText),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), minutes * 60_000)
      }),
    ])
    return answer?.trim() || undefined
  } finally {
    clearTimeout(timer)
    rl.close()
  }
}
