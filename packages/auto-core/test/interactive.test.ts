import { afterEach, describe, expect, test } from "bun:test"
import { PassThrough, Writable } from "node:stream"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { exitRequested, resetExitRequest } from "../src/exit"
import { consumeFailback, failbackOverride, failbackRequested, resetFailback } from "../src/failback"
import { startInteractive, type Interactive } from "../src/interactive"
import { log } from "../src/log"

// 用注入的流驱动常驻 readline;桩 client 记录 promptAsync 收到的消息。
// chunks 收集 output 流收到的全部内容(供断言提示符重绘等副作用)。
function setup() {
  const input = new PassThrough()
  const chunks: string[] = []
  const output = new Writable({
    write: (chunk, _enc, cb) => {
      chunks.push(String(chunk))
      cb()
    },
  })
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
  return { input, sent, repl, chunks }
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
    resetFailback()
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

  test("/failback 不发往会话,置位回试请求", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    expect(failbackRequested()).toBe(false)
    ctx.input.write("/failback\n")
    await tick()
    expect(ctx.sent).toEqual([])
    expect(failbackRequested()).toBe(true)
    // 无参形态: 消费仅重置降级状态,不产生模型序覆写。
    const chain: { model?: string } = { model: "prov/b" }
    expect(consumeFailback(chain)).toBe(true)
    expect(chain.model).toBeUndefined()
    expect(failbackOverride()).toBeUndefined()
  })

  test("/failback 带参: 空格分隔模型序,首个为首选、其余为降级候选环", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.write("/failback kimi/k3 zai/glm-5.3-flash zai/glm-5.3\n")
    await tick()
    expect(failbackRequested()).toBe(true)
    expect(consumeFailback()).toBe(true)
    expect(failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: ["zai/glm-5.3-flash", "zai/glm-5.3"] })
  })

  test("/failback 参数缺斜杠: 拒绝置位,输入行继续可用", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.repl.attach("s1")
    ctx.input.write("/failback kimi/k3 bad\n")
    await tick()
    expect(failbackRequested()).toBe(false)
    ctx.input.write("继续发消息\n")
    await tick()
    expect(ctx.sent).toEqual([{ sessionID: "s1", text: "继续发消息" }])
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

  test("stdin 关闭后日志不再向已关闭的 readline 重绘提示符(2026-09-17 审查 H6)", async () => {
    const ctx = setup()
    repl = ctx.repl
    ctx.input.end()
    await tick()
    // 只观测日志触发的重绘: 清掉启动/关闭期间已写入的提示符。
    ctx.chunks.length = 0
    log("stdin 关闭后的日志")
    // close 事件已同步清掉 log.ts 的常驻输入行引用: 日志不再触发提示符重绘。
    // (报告原判"rl.prompt(true) 抛 ERR_USE_AFTER_CLOSE"经实证不成立——Node 20/Bun
    // 均不抛,仅 promises question() 抛且 log.ts 未用;修复收敛为对称清理,可观测
    // 差异即本断言。)
    expect(ctx.chunks.join("")).not.toContain("💬")
  })
})
