import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { log, setAuditLog, setInteractive, setLogFile, setVerbose, vlog } from "../src/log"
import { formatCacheHit, formatCost, formatDuration, formatDurationCompact, formatTokens, formatUsageLine } from "../src/log"

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

  test("setLogFile creates the file under .auto/logs/, log output lands on disk synchronously", async () => {
    const path = setLogFile(dir)
    expect(path).toStartWith(join(dir, ".auto", "logs", "run-"))
    log("first line")
    log("multi-line\noutput")
    // writeSync writes directly: readable without waiting for a flush
    const content = await Bun.file(path).text()
    expect(content).toContain("first line\n")
    expect(content).toContain("multi-line\noutput\n")
    expect(await readdir(join(dir, ".auto", "logs"))).toHaveLength(1)
  })

  test("verbose: the file carries timestamps like the terminal", async () => {
    setVerbose(true)
    const path = setLogFile(dir)
    log("timed output")
    expect(await Bun.file(path).text()).toMatch(/^\[\d{2}:\d{2}:\d{2}\] timed output\n$/)
  })

  test("interactive: vlog goes only to the file, never the terminal; log has no timestamp on the terminal but does in the file", async () => {
    setInteractive()
    const path = setLogFile(dir)
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(" "))
    try {
      log("status line")
      vlog("detail line")
    } finally {
      console.log = original
    }
    expect(lines).toEqual(["status line"])
    const content = await Bun.file(path).text()
    expect(content).toMatch(/^\[\d{2}:\d{2}:\d{2}\] status line\n/)
    expect(content).toContain("] detail line\n")
  })

  test("non-verbose: vlog is fully silent", async () => {
    const path = setLogFile(dir)
    vlog("detail line")
    expect(await Bun.file(path).text()).toBe("")
  })

  test("audit (the shell profile's auditLog): a non-verbose vlog stays off the terminal but still enters the log file (with a timestamp)", async () => {
    setAuditLog(true)
    const path = setLogFile(dir)
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(" "))
    try {
      vlog("detail line")
      log("status line")
    } finally {
      console.log = original
    }
    expect(lines).toEqual(["status line"])
    const content = await Bun.file(path).text()
    expect(content).toMatch(/^\[\d{2}:\d{2}:\d{2}\] detail line\n/)
    expect(content).toMatch(/\] status line\n/)
  })
})

describe("formatter (stats-message consolidation, STATS_PLAN §5)", () => {
  test("formatDuration verbose style: seconds / minutes-seconds / hours-minutes", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(999)).toBe("1s") // Math.round carries, same as the original loop version
    expect(formatDuration(45_000)).toBe("45s")
    expect(formatDuration(59_499)).toBe("59s")
    expect(formatDuration(59_500)).toBe("1m 0s") // carried by Math.round, steps up a tier (original loop behavior)
    expect(formatDuration(60_000)).toBe("1m 0s")
    expect(formatDuration(24 * 60_000 + 31_000)).toBe("24m 31s")
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59m 59s")
    expect(formatDuration(60 * 60_000)).toBe("1h 0m")
    expect(formatDuration(52 * 60_000)).toBe("52m 0s")
    expect(formatDuration(2 * 3600_000 + 5 * 60_000 + 30_000)).toBe("2h 5m")
  })

  test("formatDurationCompact compact style: verbatim identical to runner.ts's private copy", () => {
    expect(formatDurationCompact(0)).toBe("0ms")
    expect(formatDurationCompact(999)).toBe("999ms")
    expect(formatDurationCompact(1000)).toBe("1.0s")
    expect(formatDurationCompact(12_400)).toBe("12.4s")
    expect(formatDurationCompact(59_950)).toBe("60.0s")
    expect(formatDurationCompact(60_000)).toBe("1m")
    expect(formatDurationCompact(100_000)).toBe("1m40s")
    expect(formatDurationCompact(3600_000)).toBe("60m")
  })

  test("formatTokens: below the ten-thousands place as-is, from there on N.Nk", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(9999)).toBe("9999")
    expect(formatTokens(10_000)).toBe("10.0k")
    expect(formatTokens(35_200)).toBe("35.2k")
    expect(formatTokens(1_000_000)).toBe("1000.0k")
  })

  test("formatCost: 0/falsy → undefined (the cost item is omitted), positive values with adaptive precision", () => {
    expect(formatCost(0)).toBeUndefined()
    expect(formatCost(0.041)).toBe("$0.041")
    expect(formatCost(0.31)).toBe("$0.31")
    expect(formatCost(1.5)).toBe("$1.5")
    expect(formatCost(0.00012)).toBe("$0.0001") // truncated at the 4-digit precision cap
  })

  test("formatCacheHit: hit = cacheRead/(cacheRead+input) with one decimal, denominator 0 → —", () => {
    expect(formatCacheHit(95, 5)).toBe("95.0%")
    expect(formatCacheHit(959, 41)).toBe("95.9%")
    expect(formatCacheHit(0, 100)).toBe("0.0%")
    expect(formatCacheHit(0, 0)).toBe("—") // denominator 0
    expect(formatCacheHit(28_400, 1200)).toBe("95.9%") // STATS_PLAN §4 draft-report example
  })

  // T-006: the formatUsageLine consolidation (a unified format for the tokens
  // line) — shared by the T-004 session-end line 2 and the T-006
  // task/phase/round conclusion lines.
  test("formatUsageLine: the reasoning item's position (between output and cache-read) / cost=0 omits the cost / hit-rate denominator 0", () => {
    const base = { input: 1200, output: 340, reasoning: 0, cacheRead: 28_400, cacheWrite: 3100, cost: 0 }
    expect(formatUsageLine(base)).toBe("tokens in 1200 / out 340 / cache-read 28.4k / cache-write 3100, hit 95.9%")
    expect(formatUsageLine({ ...base, reasoning: 120 })).toBe(
      "tokens in 1200 / out 340 / reasoning 120 / cache-read 28.4k / cache-write 3100, hit 95.9%",
    )
    expect(formatUsageLine({ ...base, cost: 0.041 })).toBe(
      "tokens in 1200 / out 340 / cache-read 28.4k / cache-write 3100, hit 95.9%, cost $0.041",
    )
    expect(formatUsageLine({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })).toBe(
      "tokens in 0 / out 0 / cache-read 0 / cache-write 0, hit —",
    )
  })
})
