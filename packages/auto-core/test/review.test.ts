import { describe, expect, test } from "bun:test"
import { parseVerdict } from "../src/review"

// parseVerdict 的协议: 结论行为文件最后一行,取值 通过 | 差距 <描述> | 重验 <原因>。
// 判据整行锚定、取最后一个结论行(口径同 final.ts parseConclusion),正文引用判定
// 标准不得命中(2026-09-17 审查 H2: 旧实现全文取首个匹配且"通过"为前缀匹配,
// 可把实为差距的判定假通过)。
describe("parseVerdict", () => {
  test("三种结论的基本解析", () => {
    expect(parseVerdict("正文\n结论: 通过\n")).toEqual({ type: "pass", command: undefined })
    expect(parseVerdict("正文\n结论: 差距 边界条件未覆盖\n")).toEqual({ type: "gap", gap: "边界条件未覆盖" })
    expect(parseVerdict("正文\n结论: 重验 脚本未安装依赖\n")).toEqual({ type: "reverify", gap: "脚本未安装依赖" })
  })

  test("verified-command 随通过结论提取", () => {
    expect(parseVerdict("verified-command: bun test\n\n结论: 通过\n")).toEqual({ type: "pass", command: "bun test" })
  })

  test("假通过回归: 正文引用判定标准、末行才是真实结论", () => {
    const text = "# 判定\n\n通过标准是全部用例通过,即 结论: 通过 方可收口。\n\n经审核仍有问题。\n\n结论: 差距 仍有 2 个用例失败\n"
    expect(parseVerdict(text)).toEqual({ type: "gap", gap: "仍有 2 个用例失败" })
  })

  test("通过须整值相等: 通过标准是… 不算通过", () => {
    expect(parseVerdict("结论: 通过标准是全部用例通过\n")).toBeUndefined()
  })

  test("取最后一个结论行,而非全文首个", () => {
    expect(parseVerdict("结论: 差距 首轮问题\n\n修复后复审。\n\n结论: 通过\n")).toEqual({ type: "pass", command: undefined })
  })

  test("最后一个结论行取值非法即失败,不回扫更早的合法行", () => {
    expect(parseVerdict("结论: 通过\n\n结论: 不好说\n")).toBeUndefined()
  })

  test("无结论行 / 空输入", () => {
    expect(parseVerdict("")).toBeUndefined()
    expect(parseVerdict("只有正文")).toBeUndefined()
  })

  test("结论行前后空白容忍", () => {
    expect(parseVerdict("正文\n  结论:  通过  \n")).toEqual({ type: "pass", command: undefined })
  })
})
