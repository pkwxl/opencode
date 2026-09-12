import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { confirm } from "../src/confirm"

// 注入 io 免去真 TTY: tty 显式给 true 才走问答分支。
async function ask(answer: string | undefined, tty = true): Promise<boolean> {
  const input = new PassThrough()
  const output = new PassThrough()
  output.resume()
  const pending = confirm("继续? [y/N] ", { input, output, tty })
  if (answer === undefined) input.end()
  else input.end(`${answer}\n`)
  return pending
}

describe("confirm", () => {
  test("仅 y/yes(忽略大小写)为真", async () => {
    expect(await ask("y")).toBe(true)
    expect(await ask("Y")).toBe(true)
    expect(await ask("yes")).toBe(true)
    expect(await ask("YES")).toBe(true)
    expect(await ask("  y  ")).toBe(true)
  })

  test("空行与其余一律为假(缺省不执行)", async () => {
    expect(await ask("")).toBe(false)
    expect(await ask("n")).toBe(false)
    expect(await ask("no")).toBe(false)
    expect(await ask("yep")).toBe(false)
  })

  test("stdin 关闭(管道结束)回落为假,破坏性操作不因输入中断而放行", async () => {
    expect(await ask(undefined)).toBe(false)
  })

  test("非 TTY 视为已授权直接放行(不读输入)", async () => {
    expect(await confirm("继续? ", { tty: false })).toBe(true)
  })
})
