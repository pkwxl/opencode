import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { begin, load, type Plan, type Task } from "./plan"
import { render } from "./prompt"

export type Outcome = { type: "completed" } | { type: "blocked"; question: string }

type Watch = {
  blocked?: Outcome & { type: "blocked" }
  error?: string
  lastText: string
}

// Runs one task in a fresh session. Returns "completed" only when the agent
// marked the task [done] in PLAN.md AND the external verify command passed;
// everything else (question tool, permission escalation, session error,
// idle without [done]) converges to "blocked" with a human-readable problem.
export async function runTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: { directory: string; agent?: string; verbose?: boolean },
): Promise<Outcome> {
  await begin(plan.path, task.id)

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
  return verify(plan.path, task.id, opts.directory, result.lastText)
}

async function watch(
  client: OpencodeClient,
  sessionID: string,
  stream: AsyncIterable<unknown>,
  verbose?: boolean,
): Promise<Watch> {
  let lastText = ""
  let error = ""
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
      await client.question.reject({ requestID: asked.id }).catch(() => {})
      await client.session.abort({ sessionID }).catch(() => {})
      return {
        blocked: { type: "blocked", question: asked.questions.map((q) => q.question).join("\n") },
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

// Trust nothing the agent claims: re-read PLAN.md from disk for the [done]
// marker, then run the task's verify command outside the session.
async function verify(path: string, id: string, directory: string, lastText: string): Promise<Outcome> {
  const fresh = await load(path)
  const task = fresh.tasks.find((t) => t.id === id)
  if (task?.status !== "done") {
    const tail = lastText.trim().slice(-2000) || "(无输出)"
    return {
      type: "blocked",
      question: `会话结束但任务未标记 [done](隐性阻塞)。Agent 最后的输出:\n${tail}`,
    }
  }
  if (!task.verify) return { type: "completed" }
  const proc = Bun.spawn(["sh", "-c", task.verify], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) {
    return {
      type: "blocked",
      question: `verify 命令失败(退出码 ${code}): ${task.verify}\n${stdout}\n${stderr}`,
    }
  }
  return { type: "completed" }
}
