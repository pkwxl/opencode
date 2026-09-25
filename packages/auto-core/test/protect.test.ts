import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AGENTS_BLOCK_START, ensurePointer, removePointer } from "../src/agents-block"
import { MODELS_FILE } from "../src/models"
import { protect, unprotect } from "../src/protect"

const writable = async (path: string) => ((await stat(path)).mode & 0o222) !== 0

describe("protect", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-protect-"))
    path = join(dir, "AGENTS.md")
    await Bun.write(path, "# AGENTS.md\n")
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

  // plans/0055 §4.1: the model registry's project layer is read-only during
  // run as opencode.json is (the path is the registry's own MODELS_FILE).
  test("the model registry's project layer goes read-only during protection and writable after", async () => {
    const registry = join(dir, MODELS_FILE)
    await Bun.write(registry, "{}\n")
    expect(await writable(registry)).toBe(true)
    await protect(dir)
    expect(await writable(registry)).toBe(false)
    await unprotect(dir)
    expect(await writable(registry)).toBe(true)
    expect(await Bun.file(registry).text()).toBe("{}\n")
  })

  test("no project layer: protection skips it without creating it", async () => {
    await protect(dir)
    expect(await Bun.file(join(dir, MODELS_FILE)).exists()).toBe(false)
  })

  test("任务单元文档不在保护之列,始终保持可写", async () => {
    const todo = join(dir, "docs/T-001/todo.md")
    await Bun.write(todo, "# T-001: 示例任务\n")
    await protect(dir)
    expect(await writable(todo)).toBe(true)
  })

  test("protect 对不存在的文件静默跳过", async () => {
    await rm(path)
    await protect(dir)
    expect(await writable(path).catch(() => "missing")).toBe("missing")
  })

  test("the AGENTS.md block sync still writes during protection and leaves the file read-only", async () => {
    await protect(dir)
    expect((await ensurePointer(dir)).block).toBe("inserted")
    expect(await writable(path)).toBe(false)
    expect(await Bun.file(path).text()).toContain(AGENTS_BLOCK_START)
  })

  test("a read-only AGENTS.md left by a killed run does not stop the block writers", async () => {
    // No protection active (a new process), but the file kept its 0o444.
    await chmod(path, 0o444)
    expect((await ensurePointer(dir)).block).toBe("inserted")
    expect(await writable(path)).toBe(true)
    await Bun.write(path, `# AGENTS.md\n\nProject notes.\n\n${await Bun.file(path).text().then((text) => text.slice(text.indexOf(AGENTS_BLOCK_START)))}`)
    await chmod(path, 0o444)
    expect(await removePointer(dir)).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(path).text()).toBe("# AGENTS.md\n\nProject notes.\n")
  })
})
