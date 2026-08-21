import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { log, setLogFile, setVerbose } from "../src/log"

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
    // writeSync 直写,无需等待 flush 即可读到
    const content = await Bun.file(path).text()
    expect(content).toContain("第一行\n")
    expect(content).toContain("多行\n输出\n")
    expect(await readdir(join(dir, ".auto", "logs"))).toHaveLength(1)
  })

  test("verbose 下文件与终端一样带时间戳", async () => {
    setVerbose(true)
    const path = setLogFile(dir)
    log("计时输出")
    expect(await Bun.file(path).text()).toMatch(/^\[\d{2}:\d{2}:\d{2}\] 计时输出\n$/)
  })
})
