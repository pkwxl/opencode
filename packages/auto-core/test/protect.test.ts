import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeCurrent } from "../src/current"
import { protect, unprotect } from "../src/protect"
import { planOf } from "./fixtures/units"

const SAMPLE = `## T-001: 示例任务 [pending]
正文。
`

const writable = async (path: string) => ((await stat(path)).mode & 0o222) !== 0

describe("protect", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-protect-"))
    path = join(dir, "CURRENT.md")
    await Bun.write(path, "# 当前任务\n")
    await Bun.write(join(dir, "opencode.json"), "{}")
    await Bun.write(join(dir, ".opencode/auto/config.json"), "{}")
  })

  afterEach(async () => {
    // 恢复可写再清理,避免只读文件残留(以及模块开关泄漏到其它测试)
    await unprotect(dir)
    await rm(dir, { recursive: true, force: true })
  })

  test("protect 置只读,unprotect 恢复可写", async () => {
    expect(await writable(path)).toBe(true)
    await protect(dir)
    expect(await writable(path)).toBe(false)
    expect(await writable(join(dir, "opencode.json"))).toBe(false)
    expect(await writable(join(dir, ".opencode/auto/config.json"))).toBe(false)
    await unprotect(dir)
    expect(await writable(path)).toBe(true)
    expect(await writable(join(dir, ".opencode/auto/config.json"))).toBe(true)
  })

  test("AGENTS.md 与任务单元文档不在保护之列,始终保持可写", async () => {
    const agents = join(dir, "AGENTS.md")
    const todo = join(dir, "docs/T-001/todo.md")
    await Bun.write(agents, "# AGENTS.md\n")
    await Bun.write(todo, "# T-001: 示例任务\n")
    await protect(dir)
    expect(await writable(agents)).toBe(true)
    expect(await writable(todo)).toBe(true)
  })

  test("protect 对不存在的文件静默跳过", async () => {
    await rm(path)
    await protect(dir)
    expect(await writable(path).catch(() => "missing")).toBe("missing")
  })

  test("保护期间 driver 的 CURRENT.md 写入仍成功,且写后保持只读", async () => {
    await protect(dir)
    await writeCurrent(dir, planOf(SAMPLE).tasks[0]!)
    expect(await writable(path)).toBe(false)
    expect(await Bun.file(path).text()).toContain("T-001")
  })
})
