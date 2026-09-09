import { describe, expect, test } from "bun:test"
import { autoSwitches, formatSwitches, nonDefaultSwitches, parseSwitches, SWITCH_ENV } from "../src/switches"

describe("parseSwitches(实验开关环境变量层)", () => {
  test("默认组合: 全部未设取缺省(fork on / digest / fine on / steer off / step off / refCheck off / reuseSession off / stuck on / taskContext off)", () => {
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
    })
  })

  test("空串视同未设(九个变量同测)", () => {
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
    // 报文提示空串语义与缺省值
    expect(() => parseSwitches({ [SWITCH_ENV.steer]: "disable" })).toThrow(/空串视同未设/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "1" })).toThrow(/缺省 off/)
  })
})

describe("nonDefaultSwitches / formatSwitches(启动日志)", () => {
  test("默认组合静默: 非默认项为 undefined;全量描述列出九项", () => {
    const defaults = parseSwitches({})
    expect(nonDefaultSwitches(defaults)).toBeUndefined()
    expect(formatSwitches(defaults)).toBe(
      "OPENCODE_AUTO_FORK=on, OPENCODE_AUTO_FORK_BASE=digest, OPENCODE_AUTO_DECOMPOSE_FINE=on, OPENCODE_AUTO_STEER=off, OPENCODE_AUTO_STEP=off, OPENCODE_AUTO_REF_CHECK=off, OPENCODE_AUTO_REUSE_SESSION=off, OPENCODE_AUTO_STUCK=on, OPENCODE_AUTO_TASK_CONTEXT=off",
    )
  })

  test("非默认项逐一列出,默认项不出现;全量描述始终完整", () => {
    const changed = parseSwitches({ [SWITCH_ENV.fork]: "off", [SWITCH_ENV.fine]: "off" })
    expect(nonDefaultSwitches(changed)).toBe("OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_DECOMPOSE_FINE=off")
    expect(formatSwitches(changed)).toBe(
      "OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_FORK_BASE=digest, OPENCODE_AUTO_DECOMPOSE_FINE=off, OPENCODE_AUTO_STEER=off, OPENCODE_AUTO_STEP=off, OPENCODE_AUTO_REF_CHECK=off, OPENCODE_AUTO_REUSE_SESSION=off, OPENCODE_AUTO_STUCK=on, OPENCODE_AUTO_TASK_CONTEXT=off",
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
  })
})

describe("autoSwitches(memo 一次,全流水线一致)", () => {
  test("重复调用返回同一对象", () => {
    expect(autoSwitches()).toBe(autoSwitches())
  })
})
