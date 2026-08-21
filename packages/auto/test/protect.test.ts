import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load, markDone, setSubtasks, tick } from "../src/plan"
import { protect, unprotect } from "../src/protect"

const SAMPLE = `## T-001: 示例任务 [pending]
  - verify: command: bun test
正文。
`

const writable = async (path: string) => ((await stat(path)).mode & 0o222) !== 0

describe("protect", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-protect-"))
    path = join(dir, "PLAN.md")
    await Bun.write(path, SAMPLE)
    await Bun.write(join(dir, "opencode.json"), "{}")
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
    await unprotect(dir)
    expect(await writable(path)).toBe(true)
  })

  test("protect 对不存在的文件静默跳过", async () => {
    await protect(dir)
    expect(await writable(join(dir, "CURRENT.md")).catch(() => "missing")).toBe("missing")
  })

  test("保护期间 driver 的 PLAN.md 写入仍成功,且写后保持只读", async () => {
    await protect(dir)
    await setSubtasks(path, "T-001", ["甲 (verify: `bun test`)"])
    expect(await writable(path)).toBe(false)
    await tick(path, "T-001", "甲 (verify: `bun test`)")
    await markDone(path, "T-001", "bun test")
    expect(await writable(path)).toBe(false)
    const task = (await load(path)).tasks[0]!
    expect(task.status).toBe("done")
    expect(task.verified).toBe("bun test")
    expect(task.body).toContain("- [x] 甲")
  })
})
