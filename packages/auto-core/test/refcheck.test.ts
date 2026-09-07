import { describe, expect, test } from "bun:test"
import { extractRefs, rewriteRefs } from "../src/refcheck"

describe("extractRefs", () => {
  test("反引号 span 与 md 链接均提取;非路径 token 忽略", () => {
    const text = ["详见 `docs/T-001/subtasks.md` 与 [收尾报告](docs/T-001/report.md)。", "普通词 `hello` 与 `word` 不算引用。"].join("\n")
    expect(extractRefs(text)).toEqual([
      { path: "docs/T-001/subtasks.md", at: 1 },
      { path: "docs/T-001/report.md", at: 1 },
    ])
  })

  test(":行号 尾锚剥离为 line", () => {
    const text = "见 `docs/T-001/context.md:42` 的说明。"
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001/context.md", line: 42, at: 1 }])
  })

  test("含空白的 token 忽略", () => {
    expect(extractRefs("见 `docs / T-001.md`")).toEqual([])
  })

  test("围栏内的行豁免", () => {
    const text = ["```", "cat docs/T-001.context.md", "```", "见 `docs/T-001/context.md`。"].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001/context.md", at: 4 }])
  })

  test("标记行豁免(已删除|已归档|历史)", () => {
    const text = ["旧路径 `docs/T-001.context.md` 已删除。", "`docs/T-002.audit.md` 是历史产物。", "现行 `docs/T-002/audit.md`。"].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-002/audit.md", at: 3 }])
  })

  test("同 token 一行多次出现只取一次;at 为 1 起行号", () => {
    const text = ["x", "`docs/T-001.md` 与 `docs/T-001.md`"].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001.md", at: 2 }])
  })
})

describe("rewriteRefs", () => {
  const pair = { old: "docs/T-1.md", new: "docs/T-1/report.md" }

  test("词边界命中并计数", () => {
    const { text, count } = rewriteRefs("先读 `docs/T-1.md`,再读 [x](docs/T-1.md)。", [pair])
    expect(text).toBe("先读 `docs/T-1/report.md`,再读 [x](docs/T-1/report.md)。")
    expect(count).toBe(2)
  })

  test("不误配前缀(docs/T-1.md ≠ docs/T-11.md / docs/T-1.md.bak)", () => {
    const { text, count } = rewriteRefs("`docs/T-11.md` 与 `docs/T-1.md.bak`", [pair])
    expect(text).toBe("`docs/T-11.md` 与 `docs/T-1.md.bak`")
    expect(count).toBe(0)
  })

  test("围栏与标记行豁免", () => {
    const text = ["```", "docs/T-1.md", "```", "`docs/T-1.md` 已归档。", "`docs/T-1.md`"].join("\n")
    const result = rewriteRefs(text, [pair])
    expect(result.text).toBe(["```", "docs/T-1.md", "```", "`docs/T-1.md` 已归档。", "`docs/T-1/report.md`"].join("\n"))
    expect(result.count).toBe(1)
  })

  test("多 pair 依次应用", () => {
    const { text, count } = rewriteRefs("`docs/final/audit-r1.md` 和 `docs/final-audit.md`", [
      { old: "docs/final/audit-r1.md", new: "docs/T-F1/audit-r1.md" },
      { old: "docs/final-audit.md", new: "docs/T-F1/final-audit.md" },
    ])
    expect(text).toBe("`docs/T-F1/audit-r1.md` 和 `docs/T-F1/final-audit.md`")
    expect(count).toBe(2)
  })

  test("正则元字符路径安全转义", () => {
    const { text, count } = rewriteRefs("`docs/a+b.md`", [{ old: "docs/a+b.md", new: "docs/a+b/x.md" }])
    expect(text).toBe("`docs/a+b/x.md`")
    expect(count).toBe(1)
  })
})
