import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { lstat, mkdtemp, rm, stat, symlink } from "node:fs/promises"
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

  test("AGENTS.md 不在保护之列,始终保持可写", async () => {
    const agents = join(dir, "AGENTS.md")
    await Bun.write(agents, "# AGENTS.md\n")
    await protect(dir)
    expect(await writable(agents)).toBe(true)
  })

  test("protect 对不存在的文件静默跳过", async () => {
    await protect(dir)
    expect(await writable(join(dir, "CURRENT.md")).catch(() => "missing")).toBe("missing")
  })

  test("保护期间 driver 的 PLAN.md 写入仍成功,且写后保持只读", async () => {
    await protect(dir)
    await setSubtasks(path, "T-001", ["甲"])
    expect(await writable(path)).toBe(false)
    await tick(path, "T-001", "甲")
    await markDone(path, "T-001", "bun test")
    expect(await writable(path)).toBe(false)
    const task = (await load(path)).tasks[0]!
    expect(task.status).toBe("done")
    expect(task.verified).toBe("bun test")
    expect(task.body).toContain("- [x] 甲")
  })

  test("PLAN.md 为符号链接(轮次目录布局): chmod 经链接作用到轮内文件,driver 写入落轮内且链接存活", async () => {
    // 轮次专用目录布局: 根 PLAN.md 是指向 docs/R-01/PLAN.md 的相对符号链接
    await Bun.write(join(dir, "docs/R-01/PLAN.md"), SAMPLE)
    await rm(path)
    await symlink(join("docs", "R-01", "PLAN.md"), path)
    const inner = join(dir, "docs/R-01/PLAN.md")
    await protect(dir)
    expect(await writable(path)).toBe(false)
    expect(await writable(inner)).toBe(false)
    // driver 写入经链接落轮内(rename 不替换链接本身,见 plan.ts writeTarget)
    await setSubtasks(path, "T-001", ["甲"])
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
    expect((await load(path)).tasks[0]!.body).toContain("甲")
    expect(await Bun.file(inner).text()).toContain("甲")
    expect(await writable(inner)).toBe(false)
    await unprotect(dir)
    expect(await writable(inner)).toBe(true)
  })
})
