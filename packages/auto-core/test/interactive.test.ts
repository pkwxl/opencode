import { afterEach, describe, expect, test } from "bun:test"
import { PassThrough, Writable } from "node:stream"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { exitRequested, resetExitRequest } from "../src/exit"
import { startInteractive, type Interactive } from "../src/interactive"

// 用注入的流驱动常驻 readline;桩 client 记录 promptAsync 收到的消息。
function setup() {
  const input = new PassThrough()
  const output = new Writable({ write: (_chunk, _enc, cb) => cb() })
  const sent: Array<{ sessionID: string; text: string }> = []
  const client = {
    session: {
      promptAsync: (params: { sessionID: string; parts?: Array<{ type: string; text?: string }> }) => {
        sent.push({ sessionID: params.sessionID, text: params.parts?.[0]?.text ?? "" })
        return Promise.resolve({ data: undefined, error: undefined, request: undefined, response: undefined })
      },
    },
  } as unknown as OpencodeClient
  const repl = startInteractive(client, undefined, { input, output })
  return { input, sent, repl }
}

// readline 的 line 事件异步派发,等一拍再断言。
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

describe("interactive", () => {
  let repl: Interactive | undefined

  afterEach(() => {
    repl?.close()
    repl = undefined
    resetExitRequest()
  })

  test("/exit 不发往会话,置位退出请求", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    expect(exitRequested()).toBe(false)
    ctx.input.write("/exit\n")
    await tick()
    expect(ctx.sent).toEqual([])
    expect(exitRequested()).toBe(true)
    // 置位后输入行继续可用,后续消息照常发送。
    ctx.input.write("继续发消息\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "继续发消息" }])
  })

  test("无活动会话时 /exit 仍置位(与消息丢弃语义不同)", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.write("/exit\n")
    await tick()
    expect(exitRequested()).toBe(true)
  })

  test("回车把输入作为消息发往已 attach 的会话", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    ctx.input.write("请顺便检查一下类型\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "请顺便检查一下类型" }])
    ctx.repl.attach("s2")
    ctx.input.write("发到新会话\n")
    await tick()
    expect(ctx.sent[1]).toEqual({ sessionID: "s2", text: "发到新会话" })
  })

  test("无活动会话时输入被丢弃,空行不发送", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.write("太早了\n\n   \n")
    await tick()
    expect(ctx.sent).toEqual([])
  })

  test("question 占用输入行作答,应答后恢复发消息", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    const answer = ctx.repl.question("提问内容", 1)
    ctx.input.write("这样做就行\n")
    expect(await answer).toBe("这样做就行")
    ctx.input.write("继续发消息\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "继续发消息" }])
  })

  test("question 空行解析为空字符串(由调用方按原语义解释)", async () => {
    const ctx = setup()
    repl = ctx.repl
    const answer = ctx.repl.question("任务间暂停", 1)
    ctx.input.write("\n")
    expect(await answer).toBe("")
  })

  test("stdin 关闭后等待中的 question 回落 undefined,后续输入忽略", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    const answer = ctx.repl.question("提问内容", 1)
    ctx.input.end()
    expect(await answer).toBeUndefined()
    await tick()
    expect(ctx.sent).toEqual([])
  })
})
