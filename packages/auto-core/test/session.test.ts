// src/session.ts 的单测(经 runSession 驱动): 会话链复用开关、错误重试阶梯、
// 等待-探测环(不可重试/阶梯耗尽/候选用尽一律不退出)、attempt 模型注入接线、
// 配额降级 failover、failback 粒度与 /failback 覆写。
// 拆分自 test/runner.test.ts(plans/0024-module-split-plan.md S18,纯搬运)。

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import type { SessionChain } from "../src/chain"
import { clearSticky, consumeFailback, requestFailback, resetFailback, stickyModel } from "../src/failback"
import { recallHandover, saveHandover } from "../src/handover"
import type { Interactive } from "../src/interactive"
import { recallProgress, saveProgress } from "../src/resume"
import { resetServerModelCache } from "../src/session-api"
import { attempt } from "../src/attempt"
import { runSession } from "../src/session"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import type { TestRun } from "../src/testrun"
import { task, fakeClient, retryClient, type Outcome } from "./fixtures/runner"
import { phaseTypeOfLetter, type PhaseLetter } from "../src/phases/registry"

const key = (letter: PhaseLetter) => ({ id: "R-01.P01", entry: phaseTypeOfLetter(letter) })

// ---- 会话链复用(OPENCODE_AUTO_REUSE_SESSION,缺省 off)----

describe("会话链复用开关(OPENCODE_AUTO_REUSE_SESSION)", () => {
  const REUSE_OFF = parseSwitches({})
  const REUSE_ON = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
  // 复用阈值(占比 <50%、已用 <cap/2、闲置 ≤5 分钟)全部满足的链。
  const reusable = (): SessionChain => ({ id: "ses_new_1", pct: 10, used: 100, at: Date.now() })

  test("off(缺省): 阈值全部满足也开新会话", async () => {
    const { client, calls } = fakeClient({ current: "ses_new_1" })
    const chain = reusable()
    expect((await runSession(client, task, "提示词", {}, chain, undefined, undefined, REUSE_OFF)).type).toBe("idle")
    expect(calls.creates).toBe(1)
  })

  test("on: 阈值满足即复用链上会话,不新建", async () => {
    const { client, calls } = fakeClient({ current: "ses_new_1" })
    const chain = reusable()
    expect((await runSession(client, task, "提示词", {}, chain, undefined, undefined, REUSE_ON)).type).toBe("idle")
    expect(calls.creates).toBe(0)
    expect(chain.id).toBe("ses_new_1")
  })

  test("◈ 模型播报: 复用同会话同模型不重复,新会话(复用关)每次播报", async () => {
    resetServerModelCache()
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    try {
      const fake = fakeClient({ current: "ses_new_1" })
      // 未设路由: 经 config.get 回落播报服务端生效模型(同 test「未设路由」组)。
      ;(fake.sdk as { config?: unknown }).config = { get: async () => ({ data: { model: "prov/default" } }) }
      const chain = reusable()
      await runSession(fake.client, task, "提示词", {}, chain, undefined, undefined, REUSE_ON)
      // fake 事件流收段后 pct=100(上限未知);复位回复用阈值内,第二个提示词才真复用。
      Object.assign(chain, { pct: 10, used: 100, at: Date.now() })
      await runSession(fake.client, task, "提示词2", {}, chain, undefined, undefined, REUSE_ON)
      await runSession(fake.client, task, "提示词3", {}, chain, undefined, undefined, REUSE_OFF)
    } finally {
      console.log = orig
      resetServerModelCache()
    }
    const shown = lines.filter((line) => line.includes("◈") && line.includes("using model"))
    // 两次复用同一会话只播报一次;复用关后新开会话再播报一次(同模型)。
    expect(shown.length).toBe(2)
  })

  test("中断恢复接管(链上有会话且 note 待注入): 开关 off、阈值全不满足也进原会话;说明用后即清", async () => {
    const { client, calls } = fakeClient({ current: "ses_interrupted" })
    const chain: SessionChain = {
      id: "ses_interrupted",
      pct: 80,
      used: 90_000,
      at: Date.now() - 10 * 60_000,
      note: "[driver] 中断后的继续",
    }
    expect((await runSession(client, task, "提示词", {}, chain, undefined, undefined, REUSE_OFF)).type).toBe("idle")
    expect(calls.creates).toBe(0)
    expect(chain.id).toBe("ses_interrupted")
    expect(chain.note).toBeUndefined()
    // 恢复说明已消费: 下一个提示词回归常规规则(off → 新会话)
    expect((await runSession(client, task, "下一个提示词", {}, chain, undefined, undefined, REUSE_OFF)).type).toBe("idle")
    expect(calls.creates).toBe(1)
  })
})

// ---- 会话错误重试(plans/0015-session-error-retry-plan.md;2026-09-16 起耗尽不再阻塞)----

describe("会话错误重试: isRetryable 驱动的 fork-重试 / 等待-探测环", () => {
  // 阶梯夹具: 两次重试、零等待,探测间隔也压成零(等待-探测环的轮次在单测里即时)。
  const NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
  test("isRetryable:false: 不再直接阻塞——等待后用全新临时会话探测,恢复后 fork 被中断的会话重发任务", async () => {
    // 依次: 任务下发即配额致命 → 探测仍致命 → 探测成功 → 恢复重发成功。
    const { client, calls } = retryClient(["error-fatal", "error-fatal", "ok", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    // 探测走全新临时会话(ses_new_2/3),不往被中断的会话(ses_new_1)里塞探测轮次;
    // 恢复后从被中断的会话分叉副本重发任务。
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.creates).toBe(3)
    expect(calls.prompts.map((p) => p.sessionID)).toEqual(["ses_new_1", "ses_new_2", "ses_new_3", "ses_fork_1"])
    // 探测提示词是极小探测文案,不是任务提示词。
    for (const probe of [calls.prompts[1]!, calls.prompts[2]!]) {
      expect((probe.parts[0] as { text: string }).text).toContain("Service availability probe")
    }
    // 恢复重发落在分叉副本上,带一次性恢复说明。
    const text = (calls.prompts[3]!.parts[0] as { text: string }).text
    expect(text).toContain("提示词")
    expect(text).toContain("[DRIVER]")
    expect(text).toContain("service has recovered")
    expect(chain.note).toBeUndefined()
    expect(chain.id).toBe("ses_fork_1")
  })

  test("探测持续失败期间不 fork、不重发任务(每轮都是新临时会话)", async () => {
    // 致命 → 探测致命 ×2 → 探测成功 → 恢复重发成功;探测失败轮次里绝无 fork/任务重发。
    const { client, calls } = retryClient(["error-fatal", "error-fatal", "error-fatal", "ok", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts.length).toBe(5)
  })

  test("可重试错误 + chain.id 已有真实累计上下文: fork 原会话重试,成功即晋升为 chain.id", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("fork 副本重试仍失败: 丢弃副本,从同一个原会话重新 fork(不是对失败副本再 fork)", async () => {
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "ok"])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real", "ses_real"])
    expect(chain.id).toBe("ses_fork_2")
  })

  test("chain.id 本为空(首条消息即失败): 无值得保护的内容,维持现状开空白新会话", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual([])
    expect(calls.creates).toBe(2)
  })

  // ---- 保住最值钱的会话(provider-timeout-analysis-20260912.md §8.4)----

  test("chain.id 为空但失败会话已积累上下文(子任务形态): 分叉失败会话本体,不开空白会话", async () => {
    // 子任务只有一个提示词回合,失败那一刻链上必然无会话——老策略在此开空白
    // 新会话,把会话里已核实的研究成果整份扔掉,重开后在同一点再撞墙。
    const { client, calls } = retryClient(["error-retryable", "ok"], [168_000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("失败会话用量高于链上原会话: 取失败会话(价值 = 已积累上下文)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [50_000])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
  })

  test("等待-探测环恢复时承接失败会话的前缀用量(阶梯耗尽后经探测恢复)", async () => {
    // 三次全失败(每个会话 50k 用量)→ 阶梯耗尽进入等待-探测 → 探测成功 → fork
    // 最值钱的失败会话(ses_fork_2,50k)→ 副本承接前缀用量,2×cap 交接阈值按
    // 前缀 + 新增计算。
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok", "ok"], 50_000)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(chain.used).toBe(50_000)
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1", "ses_fork_2"])
    expect(calls.creates).toBe(2)
  })

  test("失败会话用量低于链上原会话: 仍取原会话(刚失败不等于更值钱)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [800])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
  })

  test("链上无会话可分叉但基点存活: 从基点重新播种,赚回暖前缀而非纯冷启动", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0, forkBase: "ses_base" }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_base"])
    expect(calls.creates).toBe(1)
    expect(chain.forkBase).toBe("ses_base")
  })

  test("失败会话为纯报错桩(用量 0)且无基点: 维持空白新会话,不把报错桩背进副本", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(calls.forks).toEqual([])
  })

  test("重试成功后 chain.failed 清空,不残留到下一轮", async () => {
    const { client } = retryClient(["error-retryable", "ok"], [9000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(chain.failed).toBeUndefined()
  })

  test("fork 副本 0-token 即死(配额连败): 不顶替有内容的失败会话,后续每轮仍从它重新分叉", async () => {
    // 2026-09-17 virtio T-005 现场: 交接后续跑会话跑到 41.3k 遇配额连败——重试 1
    // fork 失败会话(41.3k),副本下发即死(0 tokens);旧簿记把 chain.failed 顶替成
    // 该 0-token 副本,重试 2 起失败会话引用丢失,退化为基点/空白冷播种。修复后:
    // 0-token 报错桩不进候选也不顶替记录,每一轮重试都重新 fork 那 41.3k 会话。
    const LADDER3 = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], [41_300])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, LADDER3)
    expect(result.type).toBe("idle")
    // 三次重试全部从最初那个 41.3k 失败会话重新分叉,不开空白新会话。
    expect(calls.forks).toEqual(["ses_new_1", "ses_new_1", "ses_new_1"])
    expect(calls.creates).toBe(1)
    // 第 2/3 次重发仍判「上下文完整」档: 只解释重发,不带现场核对说明。
    for (const p of [calls.prompts[2]!, calls.prompts[3]!]) {
      const text = (p.parts[0] as { text: string }).text
      expect(text).toContain("being retried now")
      expect(text).not.toContain("git status")
    }
    expect(chain.failed).toBeUndefined()
  })

  test("fork 副本跑出内容后再失败(used > 0): 正常顶替记录(副本是旧记录的严格超集)", async () => {
    // 副本带着旧前缀又跑出了新内容,失败时用量更大——记录应更新到副本,
    // 下一轮从副本分叉而非回到旧会话。
    const LADDER3 = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "ok"], [41_300, 52_000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, LADDER3)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1"])
    expect(calls.creates).toBe(1)
  })

  // ---- 重试说明: 重发同一提示词必须带一次性说明 ----
  // 两档按「接管的会话是否带着本次尝试的上下文」区分: 分叉失败会话本体(上下文完整)
  // 只解释"重发不是重复要求"; 回退空白新会话 / 分叉原会话(本次尝试已落盘的部分产出
  // 不在新会话上下文里)还须引导核对工作区,防新会话对着半成品从头重做——与跨运行
  // 恢复 resumeNote 的现场核对同一口径。

  test("分叉失败会话本体重试: 重发带一次性说明;note 与 pending 并存时接管的是副本而非复用原会话", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], 50_000)
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    // 失败会话(50k)价值高于链上原会话(5k),分叉自 ses_new_1;chain.id(原会话)刻意
    // 保留供下次重试重新分叉,故 note+id+pending 三者并存——要接管的是 pending 副本。
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("提示词")
    expect(text).toContain("being retried now")
    expect(text).not.toContain("git status")
    expect(chain.note).toBeUndefined()
  })

  test("失败会话为纯报错桩、分叉原会话重试: 原会话不含本次尝试的上下文,带现场核对说明", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
    expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
  })

  test("链上无可分叉内容回退空白新会话: 重发带现场核对说明(工作区可能有部分产出)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual([])
    expect(calls.prompts[1]!.sessionID).toBe("ses_new_2")
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
    expect(chain.note).toBeUndefined()
  })

  // ---- 重试阶梯与等待-探测环(provider-timeout-analysis-20260912.md §8.4)----

  test("阶梯次数由 waits 的元素个数决定,不再是写死的 RETRIES", async () => {
    // 0,0,0 = 三次重试 → 连同首次共四次尝试,第四次仍失败才进入等待-探测环;
    // 此处第四次成功,全程不进探测。
    const three = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, three)
    expect(result.type).toBe("idle")
    expect(calls.creates).toBe(4)
  })

  test("退避真的等待: waits 的分钟数落到实际睡眠上", async () => {
    // 0.002 分钟 = 120ms,足以与零等待区分又不拖慢测试。
    const slow = parseSwitches({ [SWITCH_ENV.retryWaits]: "0.002", [SWITCH_ENV.recoveryWait]: "0" })
    const { client } = retryClient(["error-retryable", "ok"])
    const began = Date.now()
    const result = await runSession(client, task, "提示词", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, slow)
    expect(result.type).toBe("idle")
    expect(Date.now() - began).toBeGreaterThanOrEqual(100)
  })

  test("等待-探测环的间隔真的睡眠: recoveryWait 的分钟数落到实际睡眠上", async () => {
    // 0.002 分钟 = 120ms;致命错误直达等待-探测环,探测成功即恢复。
    const slow = parseSwitches({ [SWITCH_ENV.recoveryWait]: "0.002" })
    const { client } = retryClient(["error-fatal", "ok", "ok"])
    const began = Date.now()
    const result = await runSession(client, task, "提示词", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, slow)
    expect(result.type).toBe("idle")
    expect(Date.now() - began).toBeGreaterThanOrEqual(100)
  })

  test("阶梯耗尽: 不再等人工裁决,直接进入等待-探测环(interactive 全程不被询问)", async () => {
    // 三次尝试用尽阶梯 → 等待-探测(探测 1 仍失败、探测 2 成功)→ 恢复重发成功。
    let asked = 0
    const silent: Interactive = {
      attach() {},
      question: async () => {
        asked++
        return undefined
      },
      close() {},
    }
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "error-fatal", "ok", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", { interactive: silent }, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(asked).toBe(0)
    // 三次阶梯尝试(全任务提示词)+ 两次探测 + 一次恢复重发 = 6 次下发。
    expect(calls.prompts.length).toBe(6)
    expect(calls.prompts.filter((p) => (p.parts[0] as { text: string }).text.includes("Service availability probe")).length).toBe(2)
  })

  test("waits=off: 首次失败即进等待-探测环,不做阶梯重试", async () => {
    const none = parseSwitches({ [SWITCH_ENV.retryWaits]: "off", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "ok", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, none)
    expect(result.type).toBe("idle")
    // 首次失败 → 探测成功 → 空白新会话重发(链上无可分叉内容),共 3 次下发。
    expect(calls.prompts.length).toBe(3)
    expect(calls.forks).toEqual([])
  })

  test("会话故障不退出: 创建/下发失败与 SDK 抛出的异常同样进入重试机制", async () => {
    // prompt 首次抛异常(SDK 层面)、第二次返回错误体、第三次成功——三次都是
    // 「会话故障」面,一律重试,绝不向上抛 blocked。
    let n = 0
    const { client, calls, sdk } = fakeClient()
    const raw = sdk as unknown as { session: { prompt: (p: unknown) => Promise<unknown> } }
    raw.session.prompt = async (p: unknown) => {
      calls.prompts.push(p as { sessionID: string; parts: unknown[] })
      n++
      if (n === 1) throw new Error("fetch failed: connection refused")
      if (n === 2) return { error: { name: "UnknownError" } }
      return {}
    }
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.prompts.length).toBe(3)
    expect(calls.creates).toBe(3)
  })

  test("可重试的中间失败态不落盘 progress.json,不顶替之前的真实记录(等待期间亦然)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-remember-"))
    try {
      const real: Awaited<ReturnType<typeof recallProgress>> = { task: "T-001", session: "ses_real_old", at: 1, active: true, phase: { kind: "decompose" } }
      await saveProgress(dir, real!)
      // 阶梯 0,0: 前三次尝试全部可重试失败 → 进入等待-探测(探测 1 仍失败)。
      // 在探测会话建立的瞬间窥探 progress.json: 应回复为 prior 真实记录,而不是
      // 被任何失败会话(含探测本身)的认领顶替。
      const seen: (string | undefined)[] = []
      const { client, sdk } = retryClient(["error-retryable", "error-retryable", "error-retryable", "error-fatal", "ok", "ok"])
      const raw = sdk as unknown as { session: { create: () => Promise<unknown> } }
      const origCreate = raw.session.create.bind(raw.session)
      raw.session.create = async () => {
        const made = await origCreate()
        seen.push((await recallProgress(dir, "T-001"))?.session)
        return made
      }
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "decompose" } }
      const result = await runSession(client, task, "提示词", { dir }, chain, undefined, undefined, NO_WAIT)
      expect(result.type).toBe("idle")
      // 探测会话(create #4/#5)建立时,记录仍是 prior 的 ses_real_old。
      expect(seen[3]).toBe("ses_real_old")
      expect(seen[4]).toBe("ses_real_old")
      // 全程结束后: 记录认领的是恢复重发成功的会话(探测失败轮的空白新会话,因链上
      // 无可分叉内容),而非任何失败会话或探测会话。
      expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_new_6")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("不可重试的故障: 等待期间 progress.json 正常认领被中断的会话(它是恢复点)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-remember-fatal-"))
    try {
      const seen: (string | undefined)[] = []
      const { client, sdk } = retryClient(["error-fatal", "error-fatal", "ok", "ok"])
      const raw = sdk as unknown as { session: { create: () => Promise<unknown> } }
      const origCreate = raw.session.create.bind(raw.session)
      raw.session.create = async () => {
        const made = await origCreate()
        seen.push((await recallProgress(dir, "T-001"))?.session)
        return made
      }
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "decompose" } }
      const result = await runSession(client, task, "提示词", { dir }, chain, undefined, undefined, NO_WAIT)
      expect(result.type).toBe("idle")
      // 首次致命失败后、探测会话建立时: 记录认领被中断的会话 ses_new_1(active)。
      expect(seen[1]).toBe("ses_new_1")
      // 恢复重发成功后认领分叉副本。
      expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_fork_1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- 测试交接收场(2026-09-16 修): 交接之后的会话才是重启复用/重试分叉的对象 ----

describe("测试交接收场: 定版会话任务即告完成,丢弃为复用/分叉锚点", () => {
  const NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })

  // 驱动一次完整的测试交接(--handover-test 顺序态): 上下文超限 + AI 请求测试(tmp/
  // test.sh)→ 定版 + 收尾 steer → AI 写出交接文档(Status: continue)→ 会话以 testHandover
  // 收场。替 AI 落盘的两步写在事件流生成器里,与真实链路同一批事件驱动 watch。
  const handoverStream =
    (tmp: string, handoffFile: string) =>
    (sid: string): AsyncIterable<unknown> =>
      (async function* () {
        const msg = (id: string, input: number) => ({
          type: "message.updated",
          properties: {
            info: {
              id,
              sessionID: sid,
              role: "assistant",
              time: { completed: Date.now() },
              tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              providerID: "zai",
              modelID: "glm",
            },
          },
        })
        yield msg("m_limit", 2000)
        await Bun.write(join(tmp, "test.sh"), "echo ok")
        yield { type: "session.idle", properties: { sessionID: sid } }
        await Bun.write(handoffFile, "# 交接\n\nStatus: continue\n")
        yield msg("m_wrapup", 2100)
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()

  const makeDir = async (prefix: string) => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    const tmp = join(dir, "tmp")
    const handoffFile = join(dir, "docs", "T-001", "S01", "testhandoff.md")
    return { dir, tmp, handoffFile }
  }

  const makeTest = (dir: string, tmp: string, handoffFile: string): TestRun => ({
    dir,
    tmp,
    handoffFile,
    handover: true,
    limit: 1000,
    seq: 0,
    task,
    unit: "subtask 1",
    subject: "T-001 S1 示例任务",
    label: "T-001 S1",
    handovers: 0,
    startUsed: 0,
  })

  test("交接收场不认领定版会话: progress 转无会话在途态、chain.id 清空", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-end-")
    try {
      const { client } = fakeClient({ events: handoverStream(tmp, handoffFile) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "subtasks", index: 1 } }
      const result = await runSession(client, task, "提示词", { dir, commit: false }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("idle")
      expect((result as { testHandover?: boolean }).testHandover).toBe(true)
      // 定版会话(本会话 ses_new_1)的任务已告完成: 链与记录都不再认领它。active 保留
      // (单元在途: 恢复续跑的 clean 豁免与交接文档保留依赖它),session 缺失 = 无会话
      // 可复用,恢复只能经 handover.json 的 nextSession/定版锚点接回交接之后的会话。
      expect(chain.id).toBeUndefined()
      expect(await recallProgress(dir, "T-001")).toMatchObject({ task: "T-001", session: undefined, active: true, phase: { kind: "subtasks", index: 1 } })
      // 定版锚点照常在册(收尾未完成的中断恢复据此分叉)。
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ pinSession: "ses_new_1", pinMessage: "m_limit" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("续跑会话遇可重试错误: 阶梯耗尽进等待-探测,记录仍不认领旧会话,重启复用对象 = 之后的会话", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-retry-")
    try {
      // 第一段: 走完一次测试交接,收场丢弃定版会话(同上一用例)。
      const pin = fakeClient({ events: handoverStream(tmp, handoffFile) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "subtasks", index: 1 } }
      const handedOver = await runSession(pin.client, task, "提示词", { dir, commit: false }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect((handedOver as { testHandover?: boolean }).testHandover).toBe(true)
      // 模拟 runExecSession 的交接收口(归档 + 提交 #2 + 跑脚本后,在途记录转已收口
      // 态: 脚本与定版锚点作废,待 attempt 回填 nextSession)。
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1 })
      // 第二段: 续跑会话三轮全部可重试失败(纯报错桩、无上下文)→ 阶梯耗尽进入
      // 等待-探测 → 探测成功 → 空白新会话重发成功。
      const retry = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok", "ok"])
      const outcome = await runSession(retry.client, task, "续跑提示词", { dir, commit: false }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(outcome.type).toBe("idle")
      // 重试/恢复分叉源不含定版会话(修复前: chain.id 被还原为定版会话,凭满额上下文
      // 成为首选分叉源,把续跑提示词 fork 回交接之前的会话)。
      expect(retry.calls.forks).toEqual([])
      // 结束后 progress 认领恢复重发成功的续跑会话(ses_new_5),而非任何交接之前的会话。
      expect(await recallProgress(dir, "T-001")).toMatchObject({ session: "ses_new_5", active: true })
      // 在途交接记录认领的同样是恢复后的续跑会话: 重启复用经它分叉接回,对象 =
      // 交接之后的会话。
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_new_5" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // ---- nextSession 认领的「下发即写 + 失败还原」(2026-09-17,virtio T-005 现场)----

  test("续跑会话 0-token 即死(纯报错桩): 撤回 nextSession 认领,恢复锚点留在上一个有内容的会话", async () => {
    // 现场: 41.3k 续跑会话遇配额连败,重试的 0-token 桩逐个覆写 nextSession,重启
    // 只能 fork 空壳。修复后桩的认领被还原,锚点留在 41.3k 会话。
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-stub-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_contentful" })
      const { client } = retryClient(["error-retryable"])
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "提示词", { dir, commit: false }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_contentful" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("续跑会话带着内容失败(used > 0): 保留认领,它成为新的恢复锚点", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-content-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_old" })
      const { client } = retryClient(["error-retryable"], [41_300])
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "提示词", { dir, commit: false }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      // 41.3k 内容的失败会话比旧锚点更值钱(严格超集),认领不还原。
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_new_1" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("续跑会话 0-token 即死且不可重试(isRetryable:false): 同样撤回认领(§J.3 补齐)", async () => {
    // §J.3 的还原最初只覆盖可重试分支;不可重试的 0-token 报错桩(如首发即
    // insufficient_quota)同样不配作恢复锚点——进程在等待-探测环被强退后,重启
    // 恢复只能从上一锚点分叉。
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-fatal-stub-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_contentful" })
      const { client } = retryClient(["error-fatal"])
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "提示词", { dir, commit: false }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      expect((result as { retryable?: boolean }).retryable).toBe(false)
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_contentful" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("续跑会话下发即失败(prompt.error): 撤回认领——空会话不配作恢复锚点", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-prompt-fail-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_contentful" })
      const { client } = fakeClient({ prompt: () => ({ error: { name: "UnknownError", data: { message: "boom" } } }) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "提示词", { dir, commit: false }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      expect((result as { question: string }).question).toContain("task dispatch failed")
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_contentful" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("attempt 接线: runSession 依注入策略带/不带 model(不依赖 autoSwitches memo)", () => {
  test("字母命中: opts.phase=m → anthropic/c-4 进 prompt.model", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0 } // 无 role/phase → bypass;letter m 命中
    await runSession(client, task, "提示词", { phase: key("m") }, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.model]: "m=anthropic/c-4,*=kimi/k2" }))
    expect(calls.prompts[0]!.model).toEqual({ providerID: "anthropic", modelID: "c-4" })
  })

  test("旁路角色: chain.role=knowledge → role 覆盖 wildcard", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0, role: "knowledge" }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.model]: "knowledge=kimi/k2-lite,*=kimi/k2" }))
    expect(calls.prompts[0]!.model).toEqual({ providerID: "kimi", modelID: "k2-lite" })
  })

  test("未设策略: prompt 参数里没有 model 键(逐字节等价现状)", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", { phase: key("m") }, chain, undefined, undefined, parseSwitches({}))
    expect("model" in calls.prompts[0]!).toBe(false)
  })
})

// ---- 配额降级(D.3/D.4,P4):runSession 降级支 + 候选钳制与耗尽 + 降级 note ----
// 复用 fakeClient(over.events 按当前会话 id 造定向事件流、over.fork 造分叉结果),
// 仅注入 switches.model.fallback 驱动降级;候选窗口钳制经扩展 provider.list 表面断言。
describe("配额降级 failover(D.3/D.4):候选切换保上下文 / 钳制跳过 / 耗尽进等待-探测环", () => {
  const FAILOVER = parseSwitches({ [SWITCH_ENV.modelFallback]: "prov/b,prov/c", [SWITCH_ENV.recoveryWait]: "0" })
  // 第 n 次订阅(n 从 1)发不可重试 quota 的 session.error,其后仍发 idle 让 watch
  // 正常结算;第 2 次起发 idle。用于「首轮配额失败、次轮成功」。
  const quotaThenIdleEvents = () => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n === 1) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }
  // 前 k 次订阅发不可重试 quota session.error(候选用尽场景),其后只发 idle
  // (服务恢复,探测会成功)。
  const quotaTimesThenIdleEvents = (k: number) => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n <= k) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }

  test("quota + 两候选:切到首个候选(prov/b),从首个失败会话 fork 保上下文,降级 note 随次轮提示词带给 AI", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdleEvents() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("idle")
    // 首轮不带 model(未设路由主模型),次轮带首个降级候选 prov/b。
    expect("model" in calls.prompts[0]!).toBe(false)
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // 上下文随迁:对首个失败会话(ses_new_1)做了一次 fork。
    expect(calls.forks).toContain("ses_new_1")
    // 降级 note(一次性)已随次轮提示词下发并自动清除。
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("[DRIVER]")
    expect(text).toContain("Switched model")
    expect(chain.note).toBeUndefined()
    // 换模型续跑落在分叉出的会话上(ses_fork_1),而非白板新会话。
    expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
  })

  test("降级 fork 失败回退空白新会话: 降级说明改现场核对版(空白会话没有前文可沿用)", async () => {
    const { client, calls } = fakeClient({
      events: quotaThenIdleEvents(),
      fork: () => ({ error: { name: "NotFound" } }),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("idle")
    // fork 失败 → 次轮落在新建的空白会话(不是分叉副本),模型切换仍生效。
    expect(calls.prompts[1]!.sessionID).toBe("ses_new_2")
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("Switched model")
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
    expect(chain.note).toBeUndefined()
  })

  test("未配候选表 + 恢复期分叉失败回退空白新会话: 恢复重发同样带现场核对说明", async () => {
    const { client, calls } = fakeClient({
      events: quotaThenIdleEvents(),
      fork: () => ({ error: { name: "NotFound" } }),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.recoveryWait]: "0" }))
    expect(result.type).toBe("idle")
    // 致命错误 → 等待-探测(探测成功)→ 分叉被中断会话失败 → 空白新会话重发。
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts[2]!.sessionID).toBe("ses_new_3")
    const text = (calls.prompts[2]!.parts[0] as { text: string }).text
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
  })

  test("候选耗尽(首选与两候选全配额受限): 不再阻塞——等待-探测环等恢复,探测沿用末个候选,恢复后从被中断会话分叉续跑", async () => {
    // 前 3 次订阅 quota(主模型 + prov/b + prov/c 各一轮)→ 候选耗尽 → 等待-探测
    // (探测会话走 prov/c)→ 探测成功 → fork 末个失败会话(ses_fork_2)重发任务。
    const { client, calls } = fakeClient({ events: quotaTimesThenIdleEvents(3) })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("idle")
    // 模型序: 首轮无 model → prov/b → prov/c →(探测)prov/c →(恢复重发)prov/c。
    expect("model" in calls.prompts[0]!).toBe(false)
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "c" })
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "c" })
    expect(calls.prompts[4]!.model).toEqual({ providerID: "prov", modelID: "c" })
    // 第 4 次下发是探测(极小提示词、全新会话),第 5 次是恢复重发(任务提示词 + 恢复说明)。
    expect((calls.prompts[3]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    const text = (calls.prompts[4]!.parts[0] as { text: string }).text
    expect(text).toContain("提示词")
    expect(text).toContain("service has recovered")
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1", "ses_fork_2"])
    expect(chain.model).toBe("prov/c")
  })

  test("候选窗口钳制:prov/b 上下文窗口 < cap 被跳过,首个生效切换为窗口足够的 prov2/c", async () => {
    const { sdk, calls } = fakeClient({ events: quotaThenIdleEvents() })
    // 扩展 provider 表面:prov/b 窗口 1000 < 显式 cap 5000(跳过),prov2/c 窗口 1_000_000(可用)。
    const clamped = opencodeAgent({
      ...sdk,
      provider: {
        list: async () => ({
          data: {
            all: [
              { id: "prov", models: { b: { limit: { context: 1000 } } } },
              { id: "prov2", models: { c: { limit: { context: 1_000_000 } } } },
            ],
          },
        }),
      },
    } as unknown as OpencodeClient)
    const CLAMP = parseSwitches({ [SWITCH_ENV.modelFallback]: "prov/b,prov2/c" })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(clamped, task, "提示词", { contextLimit: 5000 }, chain, undefined, undefined, CLAMP)
    expect(result.type).toBe("idle")
    // 被选中的降级候选跳过了 prov/b(窗口不足),直接取 prov2/c。
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov2", modelID: "c" })
    // prov/b 从未作为下发模型出现(证明是被跳过、而非选中后失败)。
    expect(calls.prompts.some((p) => p.model?.providerID === "prov" && p.model?.modelID === "b")).toBe(false)
  })

  test("未配候选表: quota 直接进等待-探测环(不换模型、prompt 不带 model),恢复后从被中断会话分叉续跑", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdleEvents() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.recoveryWait]: "0" }))
    expect(result.type).toBe("idle")
    // 无降级: 全程无 model 键;首轮失败后唯一一次 fork 是恢复期对被中断会话的分叉。
    expect(calls.prompts.every((p) => !("model" in p))).toBe(true)
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts.length).toBe(3)
    expect((calls.prompts[1]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    expect((calls.prompts[2]!.parts[0] as { text: string }).text).toContain("提示词")
  })
})

// ---- 降级回试粒度(OPENCODE_AUTO_MODEL_FAILBACK_SCOPE)与 /failback 覆写 ----
// scope 决定降级后何时回试首选: task(缺省)= 链内粘滞(现状);session = 新建会话即回试;
// phase = 经 failback 模块 sticky holder 跨链(跨任务)粘滞、阶段边界清零。/failback 带参
// 消费后整体重定义模型序(首选通配 + 候选环),经 override 层优先于 switches.model。
describe("failback 粒度与 /failback 覆写:回试时机 / 跨任务粘滞 / 模型序重定义 / 使用模型播报", () => {
  afterEach(() => {
    resetFailback()
  })
  const SCOPED = (scope: "task" | "session" | "phase") =>
    parseSwitches({ [SWITCH_ENV.model]: "prov/a", [SWITCH_ENV.modelFallback]: "prov/b", [SWITCH_ENV.modelFailbackScope]: scope })
  // 首轮订阅发不可重试 quota,其后 idle(与上组 quotaThenIdleEvents 同构,自带计数器
  // 以支撑同一 client 跨多次 runSession 的订阅序号)。
  const quotaThenIdle = () => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n === 1) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }

  test("缺省 task 粒度: 降级在同一条链内粘滞——第二次 runSession(同链)仍用候选 prov/b(现状不变)", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("task"))
    expect(chain.model).toBe("prov/b")
    await runSession(client, task, "提示词2", {}, chain, undefined, undefined, SCOPED("task"))
    // 第三次提示词(第二次 runSession 的首轮)仍带降级候选。
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "b" })
  })

  test("session 粒度: 新建会话起点回试首选 prov/a(降级 fork 的迁移会话不被 undo)", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("session"))
    // 降级 fork 出的迁移会话仍用候选 prov/b(不在 fork 消费点清零,防震荡)。
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(chain.model).toBe("prov/b")
    // 第二次 runSession: 复用关闭 → 全新 create,起点清零回首选 prov/a。
    await runSession(client, task, "提示词2", {}, chain, undefined, undefined, SCOPED("session"))
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "a" })
    expect(chain.model).toBeUndefined()
  })

  test("phase 粒度: 降级经 sticky holder 跨链粘滞(模拟下一任务的新链),clearSticky(阶段边界)后回首选", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("phase"))
    expect(stickyModel()).toBe("prov/b")
    // 新链(下一任务): 链上无 chain.model,sticky 兜底仍用 prov/b。
    const next: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词2", {}, next, undefined, undefined, SCOPED("phase"))
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // 阶段边界清零: 再下一条链回首选 prov/a。
    clearSticky()
    const third: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词3", {}, third, undefined, undefined, SCOPED("phase"))
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "a" })
  })

  test("/failback 带参覆写: 首选 prov/x + 候选环 prov/y;env 未设 fallback 也能经覆写环降级", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    requestFailback(["prov/x", "prov/y"])
    expect(consumeFailback()).toBe(true)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("idle")
    // 首选取覆写通配(路由表未设);quota 后从覆写环降级到 prov/y。
    expect(calls.prompts[0]!.model).toEqual({ providerID: "prov", modelID: "x" })
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "y" })
  })

  test("实际使用模型播报: ◈ 行含模型与来源,新会话即播报(同模型亦然),同会话不重复", async () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    try {
      const { client } = fakeClient({ events: quotaThenIdle() })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("task"))
      await runSession(client, task, "提示词2", {}, chain, undefined, undefined, SCOPED("task"))
    } finally {
      console.log = orig
    }
    const shown = lines.filter((line) => line.includes("◈") && line.includes("using model"))
    // 首选 prov/a(路由)一次 + 降级 prov/b(降级候选)一次;第二次 runSession 模型
    // 未变(prov/b 粘滞)但复用关、新开会话——新会话恒播报,同模型也再来一行。
    expect(shown.length).toBe(3)
    expect(shown[0]).toContain("prov/a")
    expect(shown[0]).toContain("route")
    expect(shown[1]).toContain("prov/b")
    expect(shown[1]).toContain("fallback candidate")
    expect(shown[2]).toContain("prov/b")
    expect(shown[2]).toContain("fallback candidate")
  })

  test("未设路由: 回落播报服务端生效模型(config.model),prompt 仍不带 model 键,新会话再播报", async () => {
    resetServerModelCache()
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    let calls: { prompts: { model?: unknown }[] }
    try {
      const fake = fakeClient()
      calls = fake.calls
      // fake client 缺省无 config/app/provider 表面——此处只补 config.get(全局
      // config.model 回落档),验证 attempt 在 target undefined 时的服务端模型播报。
      ;(fake.sdk as { config?: unknown }).config = { get: async () => ({ data: { model: "prov/default" } }) }
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      await runSession(fake.client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({}))
      await runSession(fake.client, task, "提示词2", {}, chain, undefined, undefined, parseSwitches({}))
    } finally {
      console.log = orig
      resetServerModelCache()
    }
    const shown = lines.filter((line) => line.includes("◈") && line.includes("using model"))
    // 两次 runSession 各开新会话(复用关),同模型也逐会话播报。
    expect(shown.length).toBe(2)
    expect(shown[0]).toContain("prov/default")
    expect(shown[0]).toContain("server default")
    expect(shown[1]).toContain("prov/default")
    // 不变量 F: 播报归播报,下发依旧不带 model 键。
    expect(calls!.prompts.every((p) => p.model === undefined)).toBe(true)
  })
})

// ---- 阶梯耗尽后的回落接入配额降级环(T1):transient/unknown 耗尽阶梯 → 换候选续跑 ----
// 与上组的区别:触发面不是 quota/auth/rate(那三类在阶梯之前就换模型),而是重试阶梯
// 跑完后的回落支(2026-09-16 起不再等人工裁决)。用 retryClient:它按 create/fork 顺序
// 给每个会话排事件,能如实模拟「每次重试都失败」并让失败会话带上真实用量。
describe("阶梯耗尽回落 → 候选降级:换模型重开一轮阶梯 / 候选耗尽进等待-探测环", () => {
  // 零等待两级阶梯(首次 + 两次重试 = 三次尝试)+ 零间隔等待-探测 + 两个候选。
  const LADDER_FAILOVER = parseSwitches({
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.recoveryWait]: "0",
    [SWITCH_ENV.modelFallback]: "prov/b,prov/c",
  })
  // 可重试(未标 isRetryable:false)⇒ 归类落 transient/unknown ⇒ 不进 quota 支,只能
  // 走阶梯。每个会话带 50k 用量:失败会话有真实上下文才进分叉候选(0 用量是纯报错桩,
  // 按设计不保),而这正是本项要保住的资产。
  const TRANSIENT = "stream disconnected"
  const allFail = (n = 12) => Array<Outcome>(n).fill("error-retryable")

  test("阶梯耗尽 + 回落:切到首个候选(prov/b)、带降级 note 从最值钱的会话 fork 续跑,阶梯重开一轮", async () => {
    // 三次尝试全失败 → 回落降级 → 第四次带 prov/b 成功。
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, LADDER_FAILOVER)
    expect(result.type).toBe("idle")
    expect(calls.prompts.length).toBe(4)
    // 阶梯内三次尝试都不带 model(未设路由主模型),降级后第四次带首个候选。
    for (const p of calls.prompts.slice(0, 3)) expect("model" in p).toBe(false)
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // 上下文随迁:降级从上一轮的失败会话(50k 用量,链上 chain.id 已被 attempt 还原为空)
    // 分叉,而不是开白板新会话。
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1", "ses_fork_2"])
    expect(calls.creates).toBe(1)
    expect(calls.prompts[3]!.sessionID).toBe("ses_fork_3")
    // 一次性降级 note 已随该提示词下发并清除,文案点名触发原因。
    const text = (calls.prompts[3]!.parts[0] as { text: string }).text
    expect(text).toContain("[DRIVER]")
    expect(text).toContain("retry ladder exhausted")
    expect(text).toContain("Switched model")
    expect(chain.note).toBeUndefined()
    // chain.model 停在生效候选上(作用域:chain 由 runTask 逐任务新建,下一个任务自动
    // 回首选模型,无需退回逻辑)。
    expect(chain.model).toBe("prov/b")
  })

  test("候选耗尽(每个候选各跑一轮完整阶梯仍失败):不再阻塞——等待-探测环等恢复后从被中断会话分叉续跑", async () => {
    // 主模型 + 两候选各跑一轮三轮阶梯(9 次失败)→ 候选耗尽 → 等待-探测(探测成功)
    // → fork 末个失败会话重发成功。
    const outcomes: Outcome[] = [...allFail(9), "ok", "ok"]
    const { client, calls } = retryClient(outcomes, 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, LADDER_FAILOVER)
    expect(result.type).toBe("idle")
    // 9 次阶梯尝试 + 1 次探测 + 1 次恢复重发 = 11 次下发。
    expect(calls.prompts.length).toBe(11)
    // 三轮阶梯的模型序: 无 model → prov/b → prov/c;探测与恢复重发沿用末个候选。
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(calls.prompts[6]!.model).toEqual({ providerID: "prov", modelID: "c" })
    expect(calls.prompts[9]!.model).toEqual({ providerID: "prov", modelID: "c" })
    expect((calls.prompts[9]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    expect((calls.prompts[10]!.parts[0] as { text: string }).text).toContain("提示词")
    // 恢复重发落在被中断会话(末个失败会话 ses_fork_8,50k 前缀)的分叉副本上;
    // 探测走全新临时会话(第 2 次 create)。
    expect(calls.prompts[9]!.sessionID).toBe("ses_new_2")
    expect(calls.prompts[10]!.sessionID).toBe("ses_fork_9")
    expect(chain.model).toBe("prov/c")
  })

  test("候选窗口钳制同样生效:窗口不足的候选被跳过,不作为回落目标下发", async () => {
    const { sdk: base, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], 50_000, TRANSIENT)
    const clamped = opencodeAgent({
      ...base,
      provider: {
        list: async () => ({
          data: { all: [{ id: "prov", models: { b: { limit: { context: 1000 } } } }, { id: "prov2", models: { c: { limit: { context: 1_000_000 } } } }] },
        }),
      },
    } as unknown as OpencodeClient)
    const CLAMP = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0", [SWITCH_ENV.modelFallback]: "prov/b,prov2/c" })
    const result = await runSession(clamped, task, "提示词", { contextLimit: 5000 }, { pct: 100, used: 0, at: 0 }, undefined, undefined, CLAMP)
    expect(result.type).toBe("idle")
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov2", modelID: "c" })
    expect(calls.prompts.some((p) => p.model?.providerID === "prov" && p.model?.modelID === "b")).toBe(false)
  })

  test("未配候选表: 阶梯耗尽直接进等待-探测环(全程不换模型),恢复后从被中断会话分叉续跑", async () => {
    const NO_FAILOVER = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient([...allFail(3), "ok", "ok"], 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_FAILOVER)
    expect(result.type).toBe("idle")
    // 三次阶梯尝试(无 model)→ 探测 → 恢复重发,全程不换模型。
    expect(calls.prompts.length).toBe(5)
    expect(calls.prompts.every((p) => !("model" in p))).toBe(true)
    expect(chain.model).toBeUndefined()
    expect((calls.prompts[3]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    expect(calls.prompts[4]!.sessionID).toBe("ses_fork_3")
  })
})
