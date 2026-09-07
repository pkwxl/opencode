import { describe, expect, test } from "bun:test"
import { autoSwitches, formatSwitches, nonDefaultSwitches, parseSwitches, SWITCH_ENV } from "../src/switches"

describe("parseSwitches(实验开关环境变量层)", () => {
  test("默认组合: 全部未设取缺省(fork on / session / fine off / steer on / step off)", () => {
    expect(parseSwitches({})).toEqual({ fork: true, forkBase: "session", fine: false, steer: true, step: "off" })
  })

  test("空串视同未设(五个变量同测)", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "",
        [SWITCH_ENV.forkBase]: "",
        [SWITCH_ENV.fine]: "",
        [SWITCH_ENV.steer]: "",
        [SWITCH_ENV.step]: "",
      }),
    ).toEqual({ fork: true, forkBase: "session", fine: false, steer: true, step: "off" })
  })

  test("合法值: 显式设置全部开关", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "off",
        [SWITCH_ENV.forkBase]: "digest",
        [SWITCH_ENV.fine]: "on",
        [SWITCH_ENV.steer]: "off",
        [SWITCH_ENV.step]: "subtask",
      }),
    ).toEqual({ fork: false, forkBase: "digest", fine: true, steer: false, step: "subtask" })
  })

  test("显式设置缺省值等价于未设", () => {
    expect(
      parseSwitches({ [SWITCH_ENV.fork]: "on", [SWITCH_ENV.steer]: "on", [SWITCH_ENV.fine]: "off", [SWITCH_ENV.forkBase]: "session", [SWITCH_ENV.step]: "off" }),
    ).toEqual(parseSwitches({}))
  })

  test("step 合法值域: phase/task/subtask 均可解析", () => {
    for (const value of ["phase", "task", "subtask"] as const) {
      expect(parseSwitches({ [SWITCH_ENV.step]: value }).step).toBe(value)
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
    // 报文提示空串语义与缺省值
    expect(() => parseSwitches({ [SWITCH_ENV.steer]: "disable" })).toThrow(/空串视同未设/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "1" })).toThrow(/缺省 off/)
  })
})

describe("nonDefaultSwitches / formatSwitches(启动日志)", () => {
  test("默认组合静默: 非默认项为 undefined;全量描述列出五项", () => {
    const defaults = parseSwitches({})
    expect(nonDefaultSwitches(defaults)).toBeUndefined()
    expect(formatSwitches(defaults)).toBe(
      "OPENCODE_AUTO_FORK=on, OPENCODE_AUTO_FORK_BASE=session, OPENCODE_AUTO_DECOMPOSE_FINE=off, OPENCODE_AUTO_STEER=on, OPENCODE_AUTO_STEP=off",
    )
  })

  test("非默认项逐一列出,默认项不出现;全量描述始终完整", () => {
    const changed = parseSwitches({ [SWITCH_ENV.fork]: "off", [SWITCH_ENV.fine]: "on" })
    expect(nonDefaultSwitches(changed)).toBe("OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_DECOMPOSE_FINE=on")
    expect(formatSwitches(changed)).toBe(
      "OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_FORK_BASE=session, OPENCODE_AUTO_DECOMPOSE_FINE=on, OPENCODE_AUTO_STEER=on, OPENCODE_AUTO_STEP=off",
    )
    const all = parseSwitches({ [SWITCH_ENV.forkBase]: "digest", [SWITCH_ENV.steer]: "off" })
    expect(nonDefaultSwitches(all)).toBe("OPENCODE_AUTO_FORK_BASE=digest, OPENCODE_AUTO_STEER=off")
    const stepped = parseSwitches({ [SWITCH_ENV.step]: "task" })
    expect(nonDefaultSwitches(stepped)).toBe("OPENCODE_AUTO_STEP=task")
  })
})

describe("autoSwitches(memo 一次,全流水线一致)", () => {
  test("重复调用返回同一对象", () => {
    expect(autoSwitches()).toBe(autoSwitches())
  })
})
