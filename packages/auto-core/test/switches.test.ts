import { describe, expect, test } from "bun:test"
import { autoSwitches, formatSwitches, nonDefaultSwitches, parseSwitches, SWITCH_ENV } from "../src/switches"

describe("parseSwitches(实验开关环境变量层)", () => {
  test("默认组合: 全部未设取缺省(fork on / digest / fine on / steer off / step off / refCheck off / reuseSession off / stuck on / taskContext off / ask off / model off / strictResume off / handoverConcurrent off / hibernate 未设)", () => {
    expect(parseSwitches({})).toEqual({
      fork: true,
      forkBase: "digest",
      fine: true,
      steer: false,
      step: "off",
      refCheck: false,
      reuseSession: false,
      stuck: true,
      taskContext: "off",
      ask: false,
      model: { byLetter: {}, byRole: {}, fallback: [] },
      modelFailbackScope: "task",
      retryWaits: [0, 1, 2, 4, 8],
      recoveryWait: 30,
      strictResume: false,
      handoverConcurrent: false,
      hibernate: undefined,
    })
  })

  test("空串视同未设(十八个变量同测)", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "",
        [SWITCH_ENV.forkBase]: "",
        [SWITCH_ENV.fine]: "",
        [SWITCH_ENV.steer]: "",
        [SWITCH_ENV.step]: "",
        [SWITCH_ENV.refCheck]: "",
        [SWITCH_ENV.reuseSession]: "",
        [SWITCH_ENV.stuck]: "",
        [SWITCH_ENV.taskContext]: "",
        [SWITCH_ENV.ask]: "",
        [SWITCH_ENV.model]: "",
        [SWITCH_ENV.modelFallback]: "",
        [SWITCH_ENV.modelFailbackScope]: "",
        [SWITCH_ENV.retryWaits]: "",
        [SWITCH_ENV.recoveryWait]: "",
        [SWITCH_ENV.strictResume]: "",
        [SWITCH_ENV.handoverConcurrent]: "",
        [SWITCH_ENV.hibernate]: "",
      }),
    ).toEqual({
      fork: true,
      forkBase: "digest",
      fine: true,
      steer: false,
      step: "off",
      refCheck: false,
      reuseSession: false,
      stuck: true,
      taskContext: "off",
      ask: false,
      model: { byLetter: {}, byRole: {}, fallback: [] },
      modelFailbackScope: "task",
      retryWaits: [0, 1, 2, 4, 8],
      recoveryWait: 30,
      strictResume: false,
      handoverConcurrent: false,
      hibernate: undefined,
    })
  })

  test("合法值: 显式设置全部开关", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "off",
        [SWITCH_ENV.forkBase]: "session",
        [SWITCH_ENV.fine]: "off",
        [SWITCH_ENV.steer]: "on",
        [SWITCH_ENV.step]: "subtask",
        [SWITCH_ENV.refCheck]: "on",
        [SWITCH_ENV.reuseSession]: "on",
        [SWITCH_ENV.stuck]: "off",
        [SWITCH_ENV.taskContext]: "large",
        [SWITCH_ENV.ask]: "on",
        [SWITCH_ENV.modelFailbackScope]: "subtask",
        [SWITCH_ENV.retryWaits]: "0,3",
        [SWITCH_ENV.recoveryWait]: "5",
        [SWITCH_ENV.strictResume]: "on",
        [SWITCH_ENV.handoverConcurrent]: "on",
        [SWITCH_ENV.hibernate]: "04:00+6",
      }),
    ).toEqual({
      fork: false,
      forkBase: "session",
      fine: false,
      steer: true,
      step: "subtask",
      refCheck: true,
      reuseSession: true,
      stuck: false,
      taskContext: "large",
      ask: true,
      model: { byLetter: {}, byRole: {}, fallback: [] },
      modelFailbackScope: "subtask",
      retryWaits: [0, 3],
      recoveryWait: 5,
      strictResume: true,
      handoverConcurrent: true,
      hibernate: { startMin: 240, durationMin: 360 },
    })
  })

  test("显式设置缺省值等价于未设", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "on",
        [SWITCH_ENV.steer]: "off",
        [SWITCH_ENV.fine]: "on",
        [SWITCH_ENV.forkBase]: "digest",
        [SWITCH_ENV.step]: "off",
        [SWITCH_ENV.refCheck]: "off",
        [SWITCH_ENV.reuseSession]: "off",
        [SWITCH_ENV.stuck]: "on",
        [SWITCH_ENV.taskContext]: "off",
        [SWITCH_ENV.ask]: "off",
        [SWITCH_ENV.modelFailbackScope]: "task",
        [SWITCH_ENV.strictResume]: "off",
        [SWITCH_ENV.handoverConcurrent]: "off",
      }),
    ).toEqual(parseSwitches({}))
  })

  test("step 合法值域: phase/task/subtask 均可解析", () => {
    for (const value of ["phase", "task", "subtask"] as const) {
      expect(parseSwitches({ [SWITCH_ENV.step]: value }).step).toBe(value)
    }
  })

  test("taskContext 合法值域: small/medium/large 均可解析", () => {
    for (const value of ["small", "medium", "large"] as const) {
      expect(parseSwitches({ [SWITCH_ENV.taskContext]: value }).taskContext).toBe(value)
    }
  })

  test("modelFailbackScope 合法值域: phase/task/subtask/session 均可解析,缺省 task(= 现状)", () => {
    expect(parseSwitches({}).modelFailbackScope).toBe("task")
    for (const value of ["phase", "task", "subtask", "session"] as const) {
      expect(parseSwitches({ [SWITCH_ENV.modelFailbackScope]: value }).modelFailbackScope).toBe(value)
    }
  })

  test("ask 值域: on/off 两档,缺省 off(提问策略开关,docs/auto-resolve-design.md §E)", () => {
    expect(parseSwitches({}).ask).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.ask]: "on" }).ask).toBe(true)
    expect(parseSwitches({ [SWITCH_ENV.ask]: "off" }).ask).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.ask]: "" }).ask).toBe(false)
  })

  test("strictResume 值域: on/off 两档,缺省 off(严格恢复开关,docs/session-recovery-fidelity-design.md S3)", () => {
    expect(parseSwitches({}).strictResume).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.strictResume]: "on" }).strictResume).toBe(true)
    expect(parseSwitches({ [SWITCH_ENV.strictResume]: "off" }).strictResume).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.strictResume]: "" }).strictResume).toBe(false)
    expect(() => parseSwitches({ [SWITCH_ENV.strictResume]: "yes" })).toThrow(/OPENCODE_AUTO_STRICT_RESUME/)
    expect(() => parseSwitches({ [SWITCH_ENV.strictResume]: "yes" })).toThrow(/缺省 off/)
  })

  test("handoverConcurrent 值域: on/off 两档,缺省 off = 先交接后运行(docs/test-handover-early-design.md §H)", () => {
    expect(parseSwitches({}).handoverConcurrent).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.handoverConcurrent]: "on" }).handoverConcurrent).toBe(true)
    expect(parseSwitches({ [SWITCH_ENV.handoverConcurrent]: "off" }).handoverConcurrent).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.handoverConcurrent]: "" }).handoverConcurrent).toBe(false)
    expect(() => parseSwitches({ [SWITCH_ENV.handoverConcurrent]: "yes" })).toThrow(/OPENCODE_AUTO_HANDOVER_CONCURRENT/)
    expect(() => parseSwitches({ [SWITCH_ENV.handoverConcurrent]: "yes" })).toThrow(/缺省 off/)
  })

  test("hibernate 值域: HH:MM+H(UTC 每日窗口,H 允许小数),缺省未设 = 不休眠(docs/hibernate-design.md)", () => {
    expect(parseSwitches({}).hibernate).toBeUndefined()
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "" }).hibernate).toBeUndefined()
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "04:00+6" }).hibernate).toEqual({ startMin: 240, durationMin: 360 })
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "22:00+8.5" }).hibernate).toEqual({ startMin: 1320, durationMin: 510 })
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "0:30+0.5" }).hibernate).toEqual({ startMin: 30, durationMin: 30 })
    // 非法值: 报错含变量名与期望值域
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "4点+6" })).toThrow(/OPENCODE_AUTO_HIBERNATE/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "4点+6" })).toThrow(/HH:MM\+H/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "24:00+6" })).toThrow(/HH ∈ 00\.\.23/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:60+6" })).toThrow(/MM ∈ 00\.\.59/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:00+0" })).toThrow(/H ∈ \(0,24\)/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:00+24" })).toThrow(/H ∈ \(0,24\)/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:00-6" })).toThrow(/取值非法/)
  })

  test("重试阶梯: 逗号分隔的分钟表,off = 空表(不自动重试)", () => {
    expect(parseSwitches({ [SWITCH_ENV.retryWaits]: "0,1,2,4,8" }).retryWaits).toEqual([0, 1, 2, 4, 8])
    expect(parseSwitches({ [SWITCH_ENV.retryWaits]: " 0 , 0.5 " }).retryWaits).toEqual([0, 0.5])
    expect(parseSwitches({ [SWITCH_ENV.retryWaits]: "off" }).retryWaits).toEqual([])
    expect(parseSwitches({ [SWITCH_ENV.recoveryWait]: "0" }).recoveryWait).toBe(0)
    expect(parseSwitches({ [SWITCH_ENV.recoveryWait]: "90" }).recoveryWait).toBe(90)
    expect(parseSwitches({ [SWITCH_ENV.recoveryWait]: "0.5" }).recoveryWait).toBe(0.5)
  })

  test("非法值: 报错含变量名与期望值域", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.fork]: "yes" })).toThrow(/OPENCODE_AUTO_FORK/)
    expect(() => parseSwitches({ [SWITCH_ENV.fork]: "yes" })).toThrow(/on\|off/)
    expect(() => parseSwitches({ [SWITCH_ENV.forkBase]: "hybrid" })).toThrow(/OPENCODE_AUTO_FORK_BASE/)
    expect(() => parseSwitches({ [SWITCH_ENV.forkBase]: "hybrid" })).toThrow(/session\|digest/)
    expect(() => parseSwitches({ [SWITCH_ENV.fine]: "1" })).toThrow(/OPENCODE_AUTO_DECOMPOSE_FINE/)
    expect(() => parseSwitches({ [SWITCH_ENV.steer]: "disable" })).toThrow(/OPENCODE_AUTO_STEER/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "step" })).toThrow(/OPENCODE_AUTO_STEP/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "Step" })).toThrow(/off\|phase\|task\|subtask/)
    expect(() => parseSwitches({ [SWITCH_ENV.refCheck]: "1" })).toThrow(/OPENCODE_AUTO_REF_CHECK/)
    expect(() => parseSwitches({ [SWITCH_ENV.refCheck]: "1" })).toThrow(/缺省 off/)
    expect(() => parseSwitches({ [SWITCH_ENV.reuseSession]: "1" })).toThrow(/OPENCODE_AUTO_REUSE_SESSION/)
    expect(() => parseSwitches({ [SWITCH_ENV.reuseSession]: "1" })).toThrow(/缺省 off/)
    expect(() => parseSwitches({ [SWITCH_ENV.stuck]: "1" })).toThrow(/OPENCODE_AUTO_STUCK/)
    expect(() => parseSwitches({ [SWITCH_ENV.stuck]: "1" })).toThrow(/缺省 on/)
    expect(() => parseSwitches({ [SWITCH_ENV.taskContext]: "big" })).toThrow(/OPENCODE_AUTO_TASK_CONTEXT/)
    expect(() => parseSwitches({ [SWITCH_ENV.taskContext]: "big" })).toThrow(/off\|small\|medium\|large/)
    expect(() => parseSwitches({ [SWITCH_ENV.ask]: "ask" })).toThrow(/OPENCODE_AUTO_ASK/)
    expect(() => parseSwitches({ [SWITCH_ENV.ask]: "ask" })).toThrow(/on\|off/)
    expect(() => parseSwitches({ [SWITCH_ENV.ask]: "ask" })).toThrow(/缺省 off/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "turn" })).toThrow(/OPENCODE_AUTO_MODEL_FAILBACK_SCOPE/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "turn" })).toThrow(/phase\|task\|subtask\|session/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "turn" })).toThrow(/缺省 task/)
    expect(() => parseSwitches({ [SWITCH_ENV.retryWaits]: "1,-2" })).toThrow(/OPENCODE_AUTO_RETRY_WAITS/)
    expect(() => parseSwitches({ [SWITCH_ENV.retryWaits]: "1,,2" })).toThrow(/非负分钟数/)
    expect(() => parseSwitches({ [SWITCH_ENV.retryWaits]: "soon" })).toThrow(/0,1,2,4,8/)
    expect(() => parseSwitches({ [SWITCH_ENV.recoveryWait]: "-1" })).toThrow(/OPENCODE_AUTO_RECOVERY_WAIT/)
    expect(() => parseSwitches({ [SWITCH_ENV.recoveryWait]: "soon" })).toThrow(/非负分钟数/)
    // 报文提示空串语义与缺省值
    expect(() => parseSwitches({ [SWITCH_ENV.steer]: "disable" })).toThrow(/空串视同未设/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "1" })).toThrow(/缺省 off/)
  })

  test("model 用例(1) 空串 = 缺省空策略(未设)", () => {
    expect(parseSwitches({ [SWITCH_ENV.model]: "" }).model).toEqual({ byLetter: {}, byRole: {}, fallback: [] })
  })

  test("model 用例(2) 裸值 prov/model ⇒ 全量覆盖 wildcard", () => {
    expect(parseSwitches({ [SWITCH_ENV.model]: "kimi/k2" }).model).toEqual({
      wildcard: "kimi/k2",
      byLetter: {},
      byRole: {},
      fallback: [],
    })
  })

  test("model 用例(3) 条目表 ⇒ wildcard/字母/角色三项填充(分隔符 =,值可含冒号)", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.model]: "*=kimi/k2,m=anthropic/c-4,t=kimi/k2-lite,verify-judge=kimi/k2-lite,decompose=anthropic/c-4",
      }).model,
    ).toEqual({
      wildcard: "kimi/k2",
      byLetter: { m: "anthropic/c-4", t: "kimi/k2-lite" },
      byRole: { "verify-judge": "kimi/k2-lite", decompose: "anthropic/c-4" },
      fallback: [],
    })
  })

  test("model 用例(4) 越界键 ⇒ 中文报错含变量名与越界键", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "x=kimi/k2" })).toThrow(/OPENCODE_AUTO_MODEL/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "x=kimi/k2" })).toThrow(/键非法/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "x=kimi/k2" })).toThrow(/"x"/)
  })

  test("model 用例(5) 值缺 / ⇒ 中文报错", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "*=kimik2" })).toThrow(/OPENCODE_AUTO_MODEL/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "*=kimik2" })).toThrow(/取值非法/)
    // 裸值形态同样要求含 /
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "kimik2" })).toThrow(/取值非法/)
  })

  test("modelFallback 有序候选表 ⇒ fallback 数组按序", () => {
    expect(parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,anthropic/c-4" }).model.fallback).toEqual([
      "kimi/k2",
      "anthropic/c-4",
    ])
    // 空串/未设 = 不降级(空数组)
    expect(parseSwitches({ [SWITCH_ENV.modelFallback]: "" }).model.fallback).toEqual([])
  })

  test("modelFallback 坏值(缺 /)⇒ 中文报错", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,bad" })).toThrow(/OPENCODE_AUTO_MODEL_FALLBACK/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,bad" })).toThrow(/取值非法/)
  })
})

describe("nonDefaultSwitches / formatSwitches(启动日志)", () => {
  test("默认组合静默: 非默认项为 undefined;全量描述列出十八项", () => {
    const defaults = parseSwitches({})
    expect(nonDefaultSwitches(defaults)).toBeUndefined()
    expect(formatSwitches(defaults)).toBe(
      "OPENCODE_AUTO_FORK=on, OPENCODE_AUTO_FORK_BASE=digest, OPENCODE_AUTO_DECOMPOSE_FINE=on, OPENCODE_AUTO_STEER=off, OPENCODE_AUTO_STEP=off, OPENCODE_AUTO_REF_CHECK=off, OPENCODE_AUTO_REUSE_SESSION=off, OPENCODE_AUTO_STUCK=on, OPENCODE_AUTO_TASK_CONTEXT=off, OPENCODE_AUTO_ASK=off, OPENCODE_AUTO_MODEL=, OPENCODE_AUTO_MODEL_FALLBACK=, OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=task, OPENCODE_AUTO_RETRY_WAITS=0,1,2,4,8, OPENCODE_AUTO_RECOVERY_WAIT=30, OPENCODE_AUTO_STRICT_RESUME=off, OPENCODE_AUTO_HANDOVER_CONCURRENT=off, OPENCODE_AUTO_HIBERNATE=",
    )
  })

  test("非默认项逐一列出,默认项不出现;全量描述始终完整", () => {
    const changed = parseSwitches({ [SWITCH_ENV.fork]: "off", [SWITCH_ENV.fine]: "off" })
    expect(nonDefaultSwitches(changed)).toBe("OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_DECOMPOSE_FINE=off")
    expect(formatSwitches(changed)).toBe(
      "OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_FORK_BASE=digest, OPENCODE_AUTO_DECOMPOSE_FINE=off, OPENCODE_AUTO_STEER=off, OPENCODE_AUTO_STEP=off, OPENCODE_AUTO_REF_CHECK=off, OPENCODE_AUTO_REUSE_SESSION=off, OPENCODE_AUTO_STUCK=on, OPENCODE_AUTO_TASK_CONTEXT=off, OPENCODE_AUTO_ASK=off, OPENCODE_AUTO_MODEL=, OPENCODE_AUTO_MODEL_FALLBACK=, OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=task, OPENCODE_AUTO_RETRY_WAITS=0,1,2,4,8, OPENCODE_AUTO_RECOVERY_WAIT=30, OPENCODE_AUTO_STRICT_RESUME=off, OPENCODE_AUTO_HANDOVER_CONCURRENT=off, OPENCODE_AUTO_HIBERNATE=",
    )
    const all = parseSwitches({ [SWITCH_ENV.forkBase]: "session", [SWITCH_ENV.steer]: "on" })
    expect(nonDefaultSwitches(all)).toBe("OPENCODE_AUTO_FORK_BASE=session, OPENCODE_AUTO_STEER=on")
    const stepped = parseSwitches({ [SWITCH_ENV.step]: "task" })
    expect(nonDefaultSwitches(stepped)).toBe("OPENCODE_AUTO_STEP=task")
    const refChecked = parseSwitches({ [SWITCH_ENV.refCheck]: "on" })
    expect(nonDefaultSwitches(refChecked)).toBe("OPENCODE_AUTO_REF_CHECK=on")
    const reused = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
    expect(nonDefaultSwitches(reused)).toBe("OPENCODE_AUTO_REUSE_SESSION=on")
    const unstuck = parseSwitches({ [SWITCH_ENV.stuck]: "off" })
    expect(nonDefaultSwitches(unstuck)).toBe("OPENCODE_AUTO_STUCK=off")
    const widened = parseSwitches({ [SWITCH_ENV.taskContext]: "medium" })
    expect(nonDefaultSwitches(widened)).toBe("OPENCODE_AUTO_TASK_CONTEXT=medium")
    const asking = parseSwitches({ [SWITCH_ENV.ask]: "on" })
    expect(nonDefaultSwitches(asking)).toBe("OPENCODE_AUTO_ASK=on")
    expect(formatSwitches(asking)).toContain("OPENCODE_AUTO_ASK=on")
    // model 生效:路由项按 wildcard→字母→角色稳定次序回推环境变量取值;降级候选独立成项
    const routed = parseSwitches({ [SWITCH_ENV.model]: "*=kimi/k2,m=anthropic/c-4,decompose=anthropic/c-4" })
    expect(nonDefaultSwitches(routed)).toBe("OPENCODE_AUTO_MODEL=*=kimi/k2,m=anthropic/c-4,decompose=anthropic/c-4")
    const failed = parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,anthropic/c-4" })
    expect(nonDefaultSwitches(failed)).toBe("OPENCODE_AUTO_MODEL_FALLBACK=kimi/k2,anthropic/c-4")
    // failback 粒度: 缺省 task 静默,非默认粒度独立成项
    const scoped = parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "session" })
    expect(nonDefaultSwitches(scoped)).toBe("OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=session")
    expect(formatSwitches(scoped)).toContain("OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=session")
    const both = parseSwitches({ [SWITCH_ENV.model]: "kimi/k2", [SWITCH_ENV.modelFallback]: "b/y" })
    expect(nonDefaultSwitches(both)).toBe("OPENCODE_AUTO_MODEL=*=kimi/k2, OPENCODE_AUTO_MODEL_FALLBACK=b/y")
    // 严格恢复: 缺省 off 静默,on 独立成项
    const strict = parseSwitches({ [SWITCH_ENV.strictResume]: "on" })
    expect(nonDefaultSwitches(strict)).toBe("OPENCODE_AUTO_STRICT_RESUME=on")
    expect(formatSwitches(strict)).toContain("OPENCODE_AUTO_STRICT_RESUME=on")
    // 交接测试时机: 缺省 off(先交接后运行)静默,on(并发)独立成项
    const concurrent = parseSwitches({ [SWITCH_ENV.handoverConcurrent]: "on" })
    expect(nonDefaultSwitches(concurrent)).toBe("OPENCODE_AUTO_HANDOVER_CONCURRENT=on")
    expect(formatSwitches(concurrent)).toContain("OPENCODE_AUTO_HANDOVER_CONCURRENT=on")
    expect(formatSwitches(parseSwitches({}))).toContain("OPENCODE_AUTO_HANDOVER_CONCURRENT=off")
    // 休眠窗口: 缺省未设静默,设置后按规范写法 HH:MM+H 独立成项
    const hibernating = parseSwitches({ [SWITCH_ENV.hibernate]: "4:00+6.5" })
    expect(nonDefaultSwitches(hibernating)).toBe("OPENCODE_AUTO_HIBERNATE=04:00+6.5")
    expect(formatSwitches(hibernating)).toContain("OPENCODE_AUTO_HIBERNATE=04:00+6.5")
    expect(formatSwitches(parseSwitches({}))).toContain("OPENCODE_AUTO_HIBERNATE=")
  })
})

describe("autoSwitches(memo 一次,全流水线一致)", () => {
  test("重复调用返回同一对象", () => {
    expect(autoSwitches()).toBe(autoSwitches())
  })
})
