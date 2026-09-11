import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { log, setAuditLog, setInteractive, setLogFile, setVerbose, vlog } from "../src/log"
import { formatCost, formatDuration, formatDurationCompact, formatTokens } from "../src/log"

describe("log", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-log-"))
  })

  afterEach(async () => {
    setVerbose(false)
    setAuditLog(false)
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

  test("非 verbose 下 vlog 完全静默", async () => {
    const path = setLogFile(dir)
    vlog("明细行")
    expect(await Bun.file(path).text()).toBe("")
  })

  test("audit(外壳画像 auditLog)下非 verbose 的 vlog 不上终端但仍写入日志文件(带时间戳)", async () => {
    setAuditLog(true)
    const path = setLogFile(dir)
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(" "))
    try {
      vlog("明细行")
      log("状态行")
    } finally {
      console.log = original
    }
    expect(lines).toEqual(["状态行"])
    const content = await Bun.file(path).text()
    expect(content).toMatch(/^\[\d{2}:\d{2}:\d{2}\] 明细行\n/)
    expect(content).toMatch(/\] 状态行\n/)
  })
})

describe("formatter(统计报文收口,STATS_PLAN §5)", () => {
  test("formatDuration 中文式: 秒 / 分秒 / 小时分", () => {
    expect(formatDuration(0)).toBe("0 秒")
    expect(formatDuration(999)).toBe("1 秒") // Math.round 进位,与 loop 原版一致
    expect(formatDuration(45_000)).toBe("45 秒")
    expect(formatDuration(59_499)).toBe("59 秒")
    expect(formatDuration(59_500)).toBe("1 分 0 秒") // Math.round 进位后升档(loop 原版行为)
    expect(formatDuration(60_000)).toBe("1 分 0 秒")
    expect(formatDuration(24 * 60_000 + 31_000)).toBe("24 分 31 秒")
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59 分 59 秒")
    expect(formatDuration(60 * 60_000)).toBe("1 小时 0 分")
    expect(formatDuration(52 * 60_000)).toBe("52 分 0 秒")
    expect(formatDuration(2 * 3600_000 + 5 * 60_000 + 30_000)).toBe("2 小时 5 分")
  })

  test("formatDurationCompact 紧凑式: 与 runner.ts 私有副本逐字一致", () => {
    expect(formatDurationCompact(0)).toBe("0ms")
    expect(formatDurationCompact(999)).toBe("999ms")
    expect(formatDurationCompact(1000)).toBe("1.0s")
    expect(formatDurationCompact(12_400)).toBe("12.4s")
    expect(formatDurationCompact(59_950)).toBe("60.0s")
    expect(formatDurationCompact(60_000)).toBe("1m")
    expect(formatDurationCompact(100_000)).toBe("1m40s")
    expect(formatDurationCompact(3600_000)).toBe("60m")
  })

  test("formatTokens: 万位以下原样,及以上转 N.Nk", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(9999)).toBe("9999")
    expect(formatTokens(10_000)).toBe("10.0k")
    expect(formatTokens(35_200)).toBe("35.2k")
    expect(formatTokens(1_000_000)).toBe("1000.0k")
  })

  test("formatCost: 0/假值 → undefined(省略费用项),正值自适应精度", () => {
    expect(formatCost(0)).toBeUndefined()
    expect(formatCost(0.041)).toBe("$0.041")
    expect(formatCost(0.31)).toBe("$0.31")
    expect(formatCost(1.5)).toBe("$1.5")
    expect(formatCost(0.00012)).toBe("$0.0001") // 4 位精度上限截断
  })
})
