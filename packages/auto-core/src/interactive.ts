// --interactive 旁路交互: 常驻 readline 等待人工输入,回车把非空行作为额外
// 用户消息经 promptAsync(fire-and-forget)注入当前活动会话——v1 引擎对运行中
// 会话是 steer 语义,在下一个 provider turn 边界被处理;等待输入不阻塞主流程。
// ask(--wait-answer)与任务间暂停(--wait-between)的人工等待也经这条输入行
// 接收(提示语、超时、回落语义不变),ask 结束后输入行恢复为发消息模式。
// 不改动任何既有处理逻辑: 无 --wait-answer 时提问仍自动答复,权限仍阻塞。
import { createInterface } from "node:readline/promises"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { log, setInput } from "./log"

export type Interactive = {
  // 每个会话建立/复用时由 runner 调用,后续输入发往该会话。
  attach(sessionID: string): void
  // 显示提示并等待一行人工输入;minutes 缺省 = 无超时(等待输入行或 stdin 关闭),
  // 设定时则超时或关闭回落 undefined(步进暂停经缺省实现硬等待)。
  question(promptText: string, minutes?: number): Promise<string | undefined>
  close(): void
}

const PROMPT = "💬 "
const ASK_PROMPT = "❓ "

export function startInteractive(
  client: OpencodeClient,
  agent?: string,
  io?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream },
): Interactive {
  const rl = createInterface({ input: io?.input ?? process.stdin, output: io?.output ?? process.stdout })
  // raw 模式下 ^C 不会触发进程级 SIGINT,readline 会截获;转发给进程级处理器,
  // 使常驻输入期间连续两次 Ctrl+C 同样能强制终止(与 askHuman 一致)。
  rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
  let sessionID: string | undefined
  let closed = false
  // readline 已关闭,不再做任何终端操作(setPrompt/prompt)。
  let dead = false
  // 有 pending 时输入行解析给 ask/暂停,否则作为会话消息发送。
  let pending: { resolve: (answer: string | undefined) => void; timer?: ReturnType<typeof setTimeout> } | undefined

  function settle(answer: string | undefined) {
    const current = pending
    pending = undefined
    if (current?.timer) clearTimeout(current.timer)
    if (!dead) {
      rl.setPrompt(PROMPT)
      rl.prompt()
    }
    current?.resolve(answer)
  }

  rl.on("line", (line) => {
    const text = line.trim()
    // ask/暂停等待中: 任何输入行(含空行)都立即作为回答——与原 askHuman 的
    // 空行回落、waitBetween 的空行继续语义一致,由调用方解释空回答。
    if (pending) {
      settle(text)
      return
    }
    if (!text) {
      rl.prompt()
      return
    }
    if (!sessionID) {
      log(`⚠ 当前无活动会话,输入已丢弃: ${text}`)
      return
    }
    log(`→ 已发送: ${text}`)
    void client.session
      .promptAsync({ sessionID, agent, parts: [{ type: "text", text }] })
      .then((result) => {
        if (result.error) log(`⚠ 发送失败: ${JSON.stringify(result.error)}`)
      })
      .catch((error: unknown) => log(`⚠ 发送失败: ${String(error)}`))
  })
  // stdin 关闭(管道结束等): 回落为非交互行为,等待中的 ask 按超时处理。
  rl.on("close", () => {
    closed = true
    dead = true
    settle(undefined)
  })

  rl.setPrompt(PROMPT)
  rl.prompt()
  setInput(rl)

  return {
    attach(id) {
      sessionID = id
    },
    question(promptText, minutes) {
      // 已关闭或重入(正常流程不会发生)时立即回落,调用方按无人答复处理。
      if (closed || pending) return Promise.resolve(undefined)
      log(promptText)
      rl.setPrompt(ASK_PROMPT)
      rl.prompt()
      return new Promise((resolve) => {
        // minutes 缺省 = 无超时硬等待(步进暂停);定时仅在显式给值时挂。
        pending = { resolve, timer: minutes === undefined ? undefined : setTimeout(() => settle(undefined), minutes * 60_000) }
      })
    },
    close() {
      closed = true
      settle(undefined)
      setInput(undefined)
      dead = true
      rl.close()
    },
  }
}
