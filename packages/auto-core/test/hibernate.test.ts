import { describe, expect, test } from "bun:test"
import { HIBERNATE_JITTER_MS, hibernatePause, hibernateSleepMs } from "../src/hibernate"
import type { HibernateWindow } from "../src/switches"

// Fix a baseline of 00:00 UTC on some day; at(t) is the epoch ms t minutes
// later (the baseline is exactly UTC midnight, so t is the minute of day).
const BASE = Date.UTC(2026, 0, 5)
const at = (minutes: number): number => BASE + minutes * 60_000

// 04:00+6h = UTC minutes [240, 600); 22:00+8h = UTC minutes [1320, 1800)
// (crosses midnight: the trailing 360 minutes land on the next day).
const DAY_WINDOW: HibernateWindow = { startMin: 240, durationMin: 360 }
const NIGHT_WINDOW: HibernateWindow = { startMin: 1320, durationMin: 480 }

describe("hibernateSleepMs (hibernate-window math, pure function)", () => {
  test("outside the window returns 0: before the start and after the end", () => {
    expect(hibernateSleepMs(DAY_WINDOW, at(0))).toBe(0)
    expect(hibernateSleepMs(DAY_WINDOW, at(239))).toBe(0)
    expect(hibernateSleepMs(DAY_WINDOW, at(600))).toBe(0)
    expect(hibernateSleepMs(DAY_WINDOW, at(1439))).toBe(0)
  })

  test("inside the window returns \"time to window end + random × 600s\": the start is exactly inside, the end exactly outside", () => {
    // random = 0 → exactly the remaining time
    expect(hibernateSleepMs(DAY_WINDOW, at(240), () => 0)).toBe(360 * 60_000)
    expect(hibernateSleepMs(DAY_WINDOW, at(300), () => 0)).toBe(300 * 60_000)
    // random = 0.5 → remaining + 300s
    expect(hibernateSleepMs(DAY_WINDOW, at(599), () => 0.5)).toBe(60_000 + HIBERNATE_JITTER_MS / 2)
  })

  test("window crossing midnight: both before midnight and in the early hours of the next day are inside; after the window ends is outside", () => {
    expect(hibernateSleepMs(NIGHT_WINDOW, at(1320), () => 0)).toBe(480 * 60_000)
    expect(hibernateSleepMs(NIGHT_WINDOW, at(1439), () => 0)).toBe(361 * 60_000)
    // Next day 02:00 (minute 120): 240 minutes remain to the 06:00 window end.
    expect(hibernateSleepMs(NIGHT_WINDOW, at(120), () => 0)).toBe(240 * 60_000)
    // Next day 06:00 (minute 360) is exactly the window end → outside.
    expect(hibernateSleepMs(NIGHT_WINDOW, at(360))).toBe(0)
    expect(hibernateSleepMs(NIGHT_WINDOW, at(720))).toBe(0)
  })

  test("the random delay stays within [0, 600s]", () => {
    const remaining = hibernateSleepMs(DAY_WINDOW, at(300), () => 0)
    const withJitter = hibernateSleepMs(DAY_WINDOW, at(300), () => 0.999)
    expect(withJitter - remaining).toBeGreaterThanOrEqual(0)
    expect(withJitter - remaining).toBeLessThan(HIBERNATE_JITTER_MS)
  })
})

describe("hibernatePause (boundary / startup hook point)", () => {
  test("switch unset (window undefined): zero behavior, sleep not called", async () => {
    let slept = 0
    await hibernatePause("test boundary", { window: undefined, now: at(300), sleep: async (ms) => { slept = ms } })
    expect(slept).toBe(0)
  })

  test("outside the window: sleep not called", async () => {
    let slept = 0
    await hibernatePause("test boundary", { window: DAY_WINDOW, now: at(100), sleep: async (ms) => { slept = ms } })
    expect(slept).toBe(0)
  })

  test("inside the window: sleep receives \"remaining + random delay\" and returns normally afterwards", async () => {
    let slept = 0
    await hibernatePause("test boundary", {
      window: DAY_WINDOW,
      now: at(300),
      random: () => 0.5,
      sleep: async (ms) => { slept = ms },
    })
    expect(slept).toBe(300 * 60_000 + HIBERNATE_JITTER_MS / 2)
  })

  test("a sleep throw propagates normally (stat pairing is guaranteed by finally; without dir it is a no-op)", async () => {
    await expect(
      hibernatePause("test boundary", {
        window: DAY_WINDOW,
        now: at(300),
        random: () => 0,
        sleep: async () => {
          throw new Error("boom")
        },
      }),
    ).rejects.toThrow("boom")
  })
})
