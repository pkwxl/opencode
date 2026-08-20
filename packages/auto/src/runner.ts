import { createInterface } from "node:readline/promises"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { log } from "./log"
import { begin, load, subtasks, type Plan, type Task } from "./plan"
import { render, renderSubtask, renderWrapup } from "./prompt"

export type Outcome = { type: "completed" } | { type: "blocked"; question: string }

// Non-permission questions get this fixed autonomous reply when no human
// answers in time (or --wait-answer was not given); only a repeated question
// on the same issue escalates to human intervention.
const AUTO_ANSWER = "你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。"

type Opts = {
  agent?: string
  verbose?: boolean
  waitAnswer?: number
  commitSubtask?: boolean
  newSessionSubtask?: boolean
}

type Watch = {
  blocked?: Outcome & { type: "blocked" }
  error?: string
  lastText: string
}

type SessionResult = { type: "idle"; lastText: string } | (Outcome & { type: "blocked" })

// Runs one task. Default: a single fresh session executes the whole task and
// "completed" requires the [done] marker in PLAN.md; verify is interpreted
// and executed by the agent itself, never re-run by the driver.
// --new-session-subtask runs strictly one fresh session per subtask checkbox
// (bounding each session's context size), confirms each by its ticked
// checkbox, then runs a final wrap-up session for verify/[done]/docs/commit.
// A task without checkboxes falls back to a single session.
// Blocking happens on permission questions, a repeated question on the same
// issue, session error, or idle without the expected disk state.
export async function runTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
): Promise<Outcome> {
  await begin(plan.path, task.id)
  const items = opts.newSessionSubtask ? subtasks(task.body) : []
  if (!items.length) {
    const result = await runSession(client, task, render(plan, task, opts), opts)
    return result.type === "blocked" ? result : confirmDone(plan.path, task.id, result.lastText)
  }
  for (const item of items) {
    if (item.done) continue
    const result = await runSession(client, task, renderSubtask(plan, task, item.text, opts), opts)
    if (result.type === "blocked") return result
    const blocked = await confirmTick(plan.path, task.id, item.text, result.lastText)
    if (blocked) return blocked
  }
  const result = await runSession(client, task, renderWrapup(plan, task), opts)
  return result.type === "blocked" ? result : confirmDone(plan.path, task.id, result.lastText)
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
  for await (const raw of stream) {
    const event = raw as import("@opencode-ai/sdk/v2").Event
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID === sessionID && part.type === "text" && part.time?.end) {
        lastText = part.text
        if (verbose) log(part.text)
      }
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

// Completion is whatever the agent claims: re-read PLAN.md from disk for the
// [done] marker only. verify is interpreted and executed by the agent itself;
// a passing run is recorded in the task's `verified` field (high-confidence
// completion) and is never required or re-executed by the driver.
async function confirmDone(path: string, id: string, lastText: string): Promise<Outcome> {
  const fresh = await load(path)
  const task = fresh.tasks.find((t) => t.id === id)
  if (task?.status !== "done") {
    const tail = lastText.trim().slice(-2000) || "(无输出)"
    return {
      type: "blocked",
      question: `会话结束但任务未标记 [done](隐性阻塞)。Agent 最后的输出:\n${tail}`,
    }
  }
  return { type: "completed" }
}

// After a subtask's dedicated session, trust nothing the agent claims:
// re-read PLAN.md and require that subtask's checkbox to be ticked.
async function confirmTick(path: string, id: string, text: string, lastText: string): Promise<Outcome | undefined> {
  const fresh = await load(path)
  const body = fresh.tasks.find((t) => t.id === id)?.body
  const ticked = body !== undefined && subtasks(body).some((item) => item.text === text && item.done)
  if (ticked) return undefined
  const tail = lastText.trim().slice(-2000) || "(无输出)"
  return {
    type: "blocked",
    question: `子任务会话结束但对应检查项未勾选(隐性阻塞): "${text}"。Agent 最后的输出:\n${tail}`,
  }
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
