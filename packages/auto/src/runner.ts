import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { begin, load, type Plan, type Task } from "./plan"
import { render } from "./prompt"

export type Outcome = { type: "completed" } | { type: "blocked"; question: string }

// Non-permission questions get this fixed autonomous reply instead of blocking;
// only a repeated question on the same issue escalates to human intervention.
const AUTO_ANSWER = "你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。"

type Watch = {
  blocked?: Outcome & { type: "blocked" }
  error?: string
  lastText: string
}

// Runs one task in a fresh session. Returns "completed" only when the agent
// marked the task [done] in PLAN.md; verify is interpreted and executed by
// the agent itself, never re-run by the driver.
// Non-permission questions are auto-replied with AUTO_ANSWER; blocking only
// happens on permission questions, a repeated question on the same issue,
// session error, or idle without [done].
// Transient provider failures (session.error, e.g. malformed reasoning
// content from a gateway) are retried in a fresh session before blocking.
export async function runTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: { agent?: string; verbose?: boolean },
): Promise<Outcome> {
  await begin(plan.path, task.id)
  for (let i = 1; ; i++) {
    const outcome = await attempt(client, plan, task, opts)
    const transient = outcome.type === "blocked" && outcome.question.startsWith("会话错误:")
    if (!transient) return outcome
    if (i === RETRIES) return { type: "blocked", question: `${outcome.question}\n(已换新会话自动重试 ${RETRIES - 1} 次仍失败)` }
    console.log(`↻ ${task.id} 遇到瞬时会话错误,换新会话重试(${i}/${RETRIES - 1}):\n${outcome.question}`)
  }
}

// Session errors get this many fresh-session attempts before blocking.
const RETRIES = 3

async function attempt(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: { agent?: string; verbose?: boolean },
): Promise<Outcome> {
  const session = await client.session.create({ title: `[auto] ${task.id} ${task.title}` })
  if (session.error) return { type: "blocked", question: `创建会话失败: ${JSON.stringify(session.error)}` }
  const sessionID = session.data.id

  const events = await client.event.subscribe()
  const watching = watch(client, sessionID, events.stream, opts.verbose)

  const prompt = await client.session.prompt({
    sessionID,
    agent: opts.agent,
    parts: [{ type: "text", text: render(plan, task) }],
  })
  if (prompt.error) return { type: "blocked", question: `下发任务失败: ${JSON.stringify(prompt.error)}` }

  const result = await watching
  if (result.blocked) return result.blocked
  if (result.error) return { type: "blocked", question: `会话错误: ${result.error}` }
  return confirmDone(plan.path, task.id, result.lastText)
}

async function watch(
  client: OpencodeClient,
  sessionID: string,
  stream: AsyncIterable<unknown>,
  verbose?: boolean,
): Promise<Watch> {
  let lastText = ""
  let error = ""
  const autoAnswered: string[] = []
  for await (const raw of stream) {
    const event = raw as import("@opencode-ai/sdk/v2").Event
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID === sessionID && part.type === "text" && part.time?.end) {
        lastText = part.text
        if (verbose) console.log(part.text)
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
        console.log(`❓ 收到非权限提问,自动答复:\n${text}\n→ ${AUTO_ANSWER}`)
        await client.question
          .reply({ requestID: asked.id, answers: asked.questions.map(() => [AUTO_ANSWER]) })
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

// Two questions count as the same issue when their normalized texts match or
// one contains the other (the agent may rephrase a question it already asked).
function sameIssue(a: string, b: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  const x = normalize(a)
  const y = normalize(b)
  return x === y || x.includes(y) || y.includes(x)
}
