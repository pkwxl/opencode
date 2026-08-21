import { createInterface } from "node:readline/promises"
import { dirname, join } from "node:path"
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2"
import { log } from "./log"
import {
  appendSubtask,
  begin,
  countSubtasks,
  load,
  markDone,
  setSubtasks,
  subtasks,
  subtaskVerify,
  tick,
  verifyCommand,
  type Plan,
  type Task,
} from "./plan"
import { renderDecompose, renderSubtask, renderWrapup } from "./prompt"
import { allowWrite, reprotect } from "./protect"

export type Outcome = { type: "completed" } | { type: "blocked"; question: string }

// Non-permission questions get this fixed autonomous reply when no human
// answers in time (or --wait-answer was not given); only a repeated question
// on the same issue escalates to human intervention.
const AUTO_ANSWER = "你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。"

// A failing task-level acceptance produces a fix subtask; after this many
// unsuccessful fix rounds the task blocks for human intervention.
const FIX_ROUNDS = 3

// Verify commands get killed after this long to keep the driver from hanging
// on a stuck test runner.
const COMMAND_TIMEOUT = 10 * 60_000

type Opts = {
  agent?: string
  verbose?: boolean
  waitAnswer?: number
  commitSubtask?: boolean
}

type Watch = {
  blocked?: Outcome & { type: "blocked" }
  error?: string
  lastText: string
}

type SessionResult = { type: "idle"; lastText: string } | (Outcome & { type: "blocked" })

// Runs one task through the three-phase pipeline; the driver owns all state
// writes to PLAN.md and CURRENT.md, sessions never edit them:
// 1. decompose (only when the task body has no checklist yet): a read-only
//    session writes docs/<id>.subtasks.md, the driver injects the checklist;
// 2. one fresh session per unticked subtask; after each session the driver
//    runs that subtask's verify command itself — pass: tick, fail: one fix
//    session then retry, still failing: blocked (items without a command are
//    ticked on trust);
// 3. a wrap-up session (docs, sweep commit, docs/<id>.report.md), then the
//    driver runs the task-level acceptance: the "command:" verify prefix, or
//    the report's verified-command line, or — with no command at all — the
//    report's conclusion line. A gap appends a fix subtask (max FIX_ROUNDS).
// Blocking happens on permission questions, a repeated question on the same
// issue, exhausted transient session errors, or a failed verification.
export async function runTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
): Promise<Outcome> {
  await begin(plan.path, task.id)
  const decomposed = await ensureDecomposed(client, plan, task, opts)
  if (decomposed.type === "blocked") return decomposed
  task = decomposed.task
  await writeCurrent(plan.path, task)

  for (let round = 0; ; ) {
    for (const item of subtasks(task.body).filter((item) => !item.done)) {
      const blocked = await runSubtask(client, plan, task, item.text, opts)
      if (blocked) return blocked
      task = requireTask(await load(plan.path), task.id)
      await writeCurrent(plan.path, task)
    }

    const result = await runSession(client, task, renderWrapup(plan, task), opts)
    if (result.type === "blocked") return result
    const verdict = await verifyTask(plan.path, task)
    if (verdict.type === "done") return { type: "completed" }

    round++
    if (round >= FIX_ROUNDS) {
      return { type: "blocked", question: `任务级验收连续 ${FIX_ROUNDS} 轮未通过:\n${verdict.gap}` }
    }
    log(`↻ ${task.id} 验收未通过,追加修复子任务(第 ${round}/${FIX_ROUNDS - 1} 轮):\n${verdict.gap}`)
    await appendSubtask(plan.path, task.id, verdict.fixText)
    task = requireTask(await load(plan.path), task.id)
  }
}

function requireTask(plan: Plan, id: string): Task {
  const task = plan.tasks.find((task) => task.id === id)
  if (!task) throw new Error(`${plan.path}: task ${id} not found`)
  return task
}

// CURRENT.md mirrors the task in progress; the agent contract makes every
// session read it first, so the current task survives context compaction.
// The server re-reads it on every provider turn, so no restart is needed.
async function writeCurrent(path: string, task: Task) {
  const progress = countSubtasks(task.body)
  const content = [
    `# 当前任务(由 opencode-auto 维护,请勿手工编辑)`,
    ``,
    `## ${task.id}: ${task.title} [${task.status}]`,
    ...(task.verify ? [`  - verify: ${task.verify}`] : []),
    ``,
    task.body,
    ``,
    progress.total ? `进度: 子任务 ${progress.done}/${progress.total}` : `进度: 分解中`,
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
): Promise<({ type: "ok" } & { task: Task }) | (Outcome & { type: "blocked" })> {
  if (subtasks(task.body).length) return { type: "ok", task }
  const file = join(dirname(plan.path), "docs", `${task.id}.subtasks.md`)
  let feedback = ""
  // One automatic retry with feedback: a resumed session may have done the
  // work instead of writing the file; the file is a hard requirement.
  for (let i = 0; ; i++) {
    const result = await runSession(client, task, renderDecompose(plan, task) + feedback, opts)
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

// Runs one subtask session, then verifies it: the driver re-runs the item's
// verify command itself and only ticks the checkbox on success. A failure
// gets one fix session before blocking. Items without a command are ticked
// on trust (e.g. fix subtasks for natural-language acceptance gaps).
async function runSubtask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  text: string,
  opts: Opts,
): Promise<(Outcome & { type: "blocked" }) | undefined> {
  const command = subtaskVerify(text)
  const result = await runSession(client, task, renderSubtask(plan, task, text, opts), opts)
  if (result.type === "blocked") return result
  if (!command) {
    await tick(plan.path, task.id, text)
    return undefined
  }
  const first = await runCommand(dirname(plan.path), command)
  if (first.ok) {
    await tick(plan.path, task.id, text)
    log(`  ✓ ${text.slice(0, 60)}`)
    return undefined
  }
  log(`  ✗ 子任务 verify 失败,开修复会话: ${command}`)
  const fix = await runSession(
    client,
    task,
    renderSubtask(plan, task, text, opts) +
      `\n\n该子任务的 verify 命令在会话外执行失败:\n$ ${command}\n${first.output}\n请定位修复,并在会话内重新运行该命令确认通过后结束。`,
    opts,
  )
  if (fix.type === "blocked") return fix
  const second = await runCommand(dirname(plan.path), command)
  if (second.ok) {
    await tick(plan.path, task.id, text)
    log(`  ✓ ${text.slice(0, 60)}(修复后通过)`)
    return undefined
  }
  return {
    type: "blocked",
    question: `子任务 "${text}" 的 verify 命令经修复会话后仍未通过:\n$ ${command}\n${second.output}`,
  }
}

// Task-level acceptance after the wrap-up session: a "command:" verify prefix
// is run directly; otherwise the report's verified-command line is extracted
// and run; with no command at all the report's conclusion line decides.
// A gap yields the fix subtask text for the next round.
async function verifyTask(
  path: string,
  task: Task,
): Promise<{ type: "done" } | { type: "gap"; gap: string; fixText: string }> {
  const dir = dirname(path)
  const report = await Bun.file(join(dir, "docs", `${task.id}.report.md`)).text().catch(() => "")
  const command = verifyCommand(task) ?? /^verified-command:\s*(.+)$/m.exec(report)?.[1]?.trim()
  if (command) {
    const result = await runCommand(dir, command)
    if (result.ok) {
      await markDone(path, task.id, command)
      return { type: "done" }
    }
    return {
      type: "gap",
      gap: `验收命令失败: $ ${command}\n${result.output}`,
      fixText: `修复任务级验收失败,使命令通过(失败输出见 docs/${task.id}.report.md 或重跑该命令) (verify: \`${command.replaceAll("`", "'")}\`)`,
    }
  }
  const conclusion = /结论[:：]\s*(通过|差距[^\n]*)/.exec(report)
  if (conclusion?.[1] === "通过") {
    await markDone(path, task.id)
    return { type: "done" }
  }
  const gap = conclusion?.[1] ?? `收尾报告缺失或缺少结论行(docs/${task.id}.report.md)`
  return { type: "gap", gap, fixText: `修复收尾报告指出的差距: ${gap}` }
}

// Runs a shell command in the target directory and captures its output.
async function runCommand(dir: string, command: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(["sh", "-c", command], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill(), COMMAND_TIMEOUT)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { ok: code === 0, output: `${stdout}${stderr}`.trim().slice(-2000) }
  } finally {
    clearTimeout(timer)
  }
}

// Runs one prompt in a fresh session. Transient provider failures
// (session.error, e.g. malformed reasoning content from a gateway) are
// retried in a fresh session before blocking.
async function runSession(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
): Promise<SessionResult> {
  for (let i = 1; ; i++) {
    const result = await attempt(client, task, promptText, opts)
    const transient = result.type === "blocked" && result.question.startsWith("会话错误:")
    if (!transient) return result
    if (i === RETRIES) return { type: "blocked", question: `${result.question}\n(已换新会话自动重试 ${RETRIES - 1} 次仍失败)` }
    log(`↻ ${task.id} 遇到瞬时会话错误,换新会话重试(${i}/${RETRIES - 1}):\n${result.question}`)
  }
}

// Session errors get this many fresh-session attempts before blocking.
const RETRIES = 3

async function attempt(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
): Promise<SessionResult> {
  const session = await client.session.create({ title: `[auto] ${task.id} ${task.title}` })
  if (session.error) return { type: "blocked", question: `创建会话失败: ${JSON.stringify(session.error)}` }
  const sessionID = session.data.id

  const events = await client.event.subscribe()
  const watching = watch(client, sessionID, events.stream, opts)

  const prompt = await client.session.prompt({
    sessionID,
    agent: opts.agent,
    parts: [{ type: "text", text: promptText }],
  })
  if (prompt.error) return { type: "blocked", question: `下发任务失败: ${JSON.stringify(prompt.error)}` }

  const result = await watching
  if (result.blocked) return result.blocked
  if (result.error) return { type: "blocked", question: `会话错误: ${result.error}` }
  return { type: "idle", lastText: result.lastText }
}

async function watch(
  client: OpencodeClient,
  sessionID: string,
  stream: AsyncIterable<unknown>,
  opts: Opts,
): Promise<Watch> {
  const verbose = opts.verbose
  const waitAnswer = opts.waitAnswer ?? 0
  let lastText = ""
  let error = ""
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
        if (verbose) log(part.text)
        continue
      }
      const line = verbose ? describePart(part) : undefined
      if (line && !seen.has(part.id)) {
        seen.add(part.id)
        log(line)
      }
    }
    if (event.type === "message.updated") {
      const info = event.properties.info
      if (!verbose || info.sessionID !== sessionID) continue
      if (info.role !== "assistant" || !info.time.completed || seen.has(info.id)) continue
      seen.add(info.id)
      limits ??= await contextLimits(client)
      const used = info.tokens.input + info.tokens.cache.read
      const limit = limits.get(`${info.providerID}/${info.modelID}`)
      const pct = limit ? ` (${Math.round((used / limit) * 100)}%)` : ""
      log(`  上下文: ${formatTokens(used)}${limit ? `/${formatTokens(limit)}` : ""} tokens${pct}`)
    }
    if (event.type === "question.asked") {
      const asked = event.properties
      if (asked.sessionID !== sessionID) continue
      const text = asked.questions.map((q) => q.question).join("\n")
      const permission = /权限|permission/i.test(text)
      const repeated = autoAnswered.some((prev) => sameIssue(prev, text))
      if (!permission && !repeated) {
        autoAnswered.push(text)
        log(`❓ 收到非权限提问:\n${text}`)
        const human = waitAnswer > 0 ? await askHuman(waitAnswer) : undefined
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
      }
    }
    if (event.type === "permission.asked") {
      const asked = event.properties
      if (asked.sessionID !== sessionID) continue
      await client.permission.reply({ requestID: asked.id, reply: "reject" }).catch(() => {})
      await client.session.abort({ sessionID }).catch(() => {})
      return {
        blocked: {
          type: "blocked",
          question: `需要权限: ${asked.permission} (${asked.patterns.join(", ")})。请在目标目录 opencode.json 的 permission 规则中放行后重新运行。`,
        },
        lastText,
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
  return { lastText, error }
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

// Waits up to `minutes` for a human answer on stdin (Enter confirms); returns
// undefined on timeout or empty input, in which case the caller falls back to
// AUTO_ANSWER.
async function askHuman(minutes: number): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answer = await Promise.race([
      rl.question(`请在 ${minutes} 分钟内输入回答(回车确认,超时将自动答复): `),
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
