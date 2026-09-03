import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { log, setInteractive, setLogFile, setVerbose, vlog } from "../src/log"

describe("log", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-log-"))
  })

  afterEach(async () => {
    setVerbose(false)
    await rm(dir, { recursive: true, force: true })
  })

  test("setLogFile 在 .auto/logs/ 下建文件,log 输出同步落盘", async () => {
    const path = setLogFile(dir)
    expect(path).toStartWith(join(dir, ".auto", "logs", "run-"))
    log("第一行")
    log("多行\n输出")
    // writeSync 直写,无需等待 flush 即可读到;文件行始终带时间戳
    const content = await Bun.file(path).text()
    expect(content).toMatch(/^\[\d{2}:\d{2}:\d{2}\] 第一行\n/)
    expect(content).toMatch(/\] 多行\n\[\d{2}:\d{2}:\d{2}\] 输出\n/)
    expect(await readdir(join(dir, ".auto", "logs"))).toHaveLength(1)
  })

  test("verbose 下文件与终端一样带时间戳", async () => {
    setVerbose(true)
    const path = setLogFile(dir)
    log("计时输出")
    expect(await Bun.file(path).text()).toMatch(/^\[\d{2}:\d{2}:\d{2}\] 计时输出\n$/)
  })

  test("interactive 下 vlog 只进文件不上终端,log 终端无时间戳而文件有", async () => {
    setInteractive()
    const path = setLogFile(dir)
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(" "))
    try {
      log("状态行")
      vlog("明细行")
    } finally {
      console.log = original
    }
    expect(lines).toEqual(["状态行"])
    const content = await Bun.file(path).text()
    expect(content).toMatch(/^\[\d{2}:\d{2}:\d{2}\] 状态行\n/)
    expect(content).toContain("] 明细行\n")
  })

  test("非 verbose 下 vlog 不上终端但仍写入日志文件", async () => {
    const path = setLogFile(dir)
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(" "))
    try {
      vlog("明细行")
    } finally {
      console.log = original
    }
    expect(lines).toEqual([])
    expect(await Bun.file(path).text()).toContain("] 明细行\n")
  })
})
