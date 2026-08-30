import { describe, expect, test } from "bun:test"
import { MODES, resolveMode } from "../src/mode"

describe("模式注册表", () => {
  test("V1 仅注册 migrate", () => {
    expect(Object.keys(MODES)).toEqual(["migrate"])
  })

  test("resolveMode 命中已注册模式,三段文案齐备", () => {
    const mode = resolveMode("migrate")
    expect(mode).toBeDefined()
    expect(mode!.name).toBe("migrate")
    // init 导语: 场景定义、任务排布原则、verify 侧重
    expect(mode!.init).toContain("外部行为不变")
    expect(mode!.init).toContain("基线确认")
    expect(mode!.init).toContain("迁移改造")
    expect(mode!.init).toContain("回归验证")
    expect(mode!.init).toContain("优先复用既有的测试/构建命令")
    // exec 注记: 对等行为、兼容层与 AUTO-DECISION 标注要求
    expect(mode!.exec).toContain("对等行为")
    expect(mode!.exec).toContain("兼容层")
    expect(mode!.exec).toContain("AUTO-DECISION")
    // final 各阶段侧重
    expect(mode!.final.audit).toContain("行为对等")
    expect(mode!.final.audit).toContain("旧路径")
    expect(mode!.final.validate).toContain("回归覆盖")
    expect(mode!.final.finalize).toContain("旧实现的清理")
    expect(mode!.final.finalize).toContain("兼容层的收尾")
  })

  test("未注册模式返回 undefined(optimize/implement/test 为既定扩展名)", () => {
    expect(resolveMode("optimize")).toBeUndefined()
    expect(resolveMode("implement")).toBeUndefined()
    expect(resolveMode("test")).toBeUndefined()
    expect(resolveMode("")).toBeUndefined()
    expect(resolveMode("Migrate")).toBeUndefined()
  })
})
