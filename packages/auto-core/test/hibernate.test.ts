import { describe, expect, test } from "bun:test"
import { HIBERNATE_JITTER_MS, hibernatePause, hibernateSleepMs } from "../src/hibernate"
import type { HibernateWindow } from "../src/switches"

// 固定 UTC 某日 00:00 为基准,t 分钟后的 epoch 毫秒(基准恰为 UTC 零点,t 即当日分钟)。
const BASE = Date.UTC(2026, 0, 5)
const at = (minutes: number): number => BASE + minutes * 60_000

// 04:00+6 = UTC [240, 600) 分钟;22:00+8 = UTC [1320, 1800) 分钟(跨午夜,尾部 360 分钟落次日)。
const DAY_WINDOW: HibernateWindow = { startMin: 240, durationMin: 360 }
const NIGHT_WINDOW: HibernateWindow = { startMin: 1320, durationMin: 480 }

describe("hibernateSleepMs(休眠窗口计算,纯函数)", () => {
  test("窗口外返回 0: 起点前与终点后", () => {
    expect(hibernateSleepMs(DAY_WINDOW, at(0))).toBe(0)
    expect(hibernateSleepMs(DAY_WINDOW, at(239))).toBe(0)
    expect(hibernateSleepMs(DAY_WINDOW, at(600))).toBe(0)
    expect(hibernateSleepMs(DAY_WINDOW, at(1439))).toBe(0)
  })

  test("窗口内返回「到窗口结束 + random × 600s」: 起点恰在内,终点恰在外", () => {
    // random = 0 → 恰好剩余时长
    expect(hibernateSleepMs(DAY_WINDOW, at(240), () => 0)).toBe(360 * 60_000)
    expect(hibernateSleepMs(DAY_WINDOW, at(300), () => 0)).toBe(300 * 60_000)
    // random = 0.5 → 剩余 + 300s
    expect(hibernateSleepMs(DAY_WINDOW, at(599), () => 0.5)).toBe(60_000 + HIBERNATE_JITTER_MS / 2)
  })

  test("跨午夜窗口: 子夜前与次日凌晨均在内,窗口结束后在外", () => {
    expect(hibernateSleepMs(NIGHT_WINDOW, at(1320), () => 0)).toBe(480 * 60_000)
    expect(hibernateSleepMs(NIGHT_WINDOW, at(1439), () => 0)).toBe(361 * 60_000)
    // 次日 02:00(120 分钟): 距 06:00 窗口尾还有 240 分钟
    expect(hibernateSleepMs(NIGHT_WINDOW, at(120), () => 0)).toBe(240 * 60_000)
    // 次日 06:00(360 分钟)恰为窗口终点 → 在外
    expect(hibernateSleepMs(NIGHT_WINDOW, at(360))).toBe(0)
    expect(hibernateSleepMs(NIGHT_WINDOW, at(720))).toBe(0)
  })

  test("随机延迟落在 [0, 600s] 区间内", () => {
    const remaining = hibernateSleepMs(DAY_WINDOW, at(300), () => 0)
    const withJitter = hibernateSleepMs(DAY_WINDOW, at(300), () => 0.999)
    expect(withJitter - remaining).toBeGreaterThanOrEqual(0)
    expect(withJitter - remaining).toBeLessThan(HIBERNATE_JITTER_MS)
  })
})

describe("hibernatePause(边界/启动挂点)", () => {
  test("开关未设(window undefined): 零行为,不调用 sleep", async () => {
    let slept = 0
    await hibernatePause("测试边界", { window: undefined, now: at(300), sleep: async (ms) => { slept = ms } })
    expect(slept).toBe(0)
  })

  test("窗口外: 不调用 sleep", async () => {
    let slept = 0
    await hibernatePause("测试边界", { window: DAY_WINDOW, now: at(100), sleep: async (ms) => { slept = ms } })
    expect(slept).toBe(0)
  })

  test("窗口内: sleep 收到「剩余 + 随机延迟」,结束后正常返回", async () => {
    let slept = 0
    await hibernatePause("测试边界", {
      window: DAY_WINDOW,
      now: at(300),
      random: () => 0.5,
      sleep: async (ms) => { slept = ms },
    })
    expect(slept).toBe(300 * 60_000 + HIBERNATE_JITTER_MS / 2)
  })

  test("sleep 抛异常时正常向上传播(统计配对由 finally 保证,dir 未传则空转)", async () => {
    await expect(
      hibernatePause("测试边界", {
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
