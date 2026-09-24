import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { ensurePointer } from "../src/agents-block"
import { renderProjectBrief } from "../src/brief"
import { ensureGitignore, ensureInitGitignore, removeGitignoreEntries } from "../src/gitignore"
import { applyReset, planReset, type ResetEntry } from "../src/reset"

// init 产物的最小复刻(不跑真 CLI): 配置层四件 + 共用文件两件 + gitignore 条目。
async function seedInit(dir: string) {
  await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await writeFile(join(dir, ".opencode", "auto", "config.json"), '{"mode":"migrate"}\n')
  await writeFile(join(dir, ".opencode", "auto", "brief.md"), renderProjectBrief())
  await writeFile(join(dir, ".opencode", "agent", "auto.md"), "# auto agent\n")
  await writeFile(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
  await ensurePointer(dir)
  await writeFile(join(dir, ".gitignore"), "")
  await ensureGitignore(dir)
}

async function reset(dir: string): Promise<ResetEntry[]> {
  const entries = await planReset(dir)
  await applyReset(dir, entries)
  return entries
}

const exists = (path: string) => Bun.file(path).exists()

describe("reset: 配置层清理", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-reset-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("移除全部配置层产物,目录回收后与未初始化状态一致", async () => {
    await seedInit(dir)
    await reset(dir)
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
    expect(await exists(join(dir, ".opencode", "auto", "brief.md"))).toBe(false)
    expect(await exists(join(dir, ".opencode", "agent", "auto.md"))).toBe(false)
    expect(await exists(join(dir, "opencode.json"))).toBe(false)
    expect(await exists(join(dir, "AGENTS.md"))).toBe(false)
    expect(await readdir(dir)).toEqual([])
  })

  test("未初始化目录: 清单为空,不报错", async () => {
    expect(await planReset(dir)).toEqual([])
  })

  test("幂等: 连续两次 reset 结果相同", async () => {
    await seedInit(dir)
    await reset(dir)
    expect(await planReset(dir)).toEqual([])
    await reset(dir)
    expect(await readdir(dir)).toEqual([])
  })

  test("旧版 .auto/config.json 属配置层,一并移除;.auto/ 其余内容不动", async () => {
    await seedInit(dir)
    await mkdir(join(dir, ".auto", "logs"), { recursive: true })
    await writeFile(join(dir, ".auto", "config.json"), '{"mode":"migrate"}\n')
    await writeFile(join(dir, ".auto", "stats.json"), '{"tasks":3}\n')
    await writeFile(join(dir, ".auto", "logs", "run.log"), "日志\n")
    await reset(dir)
    expect(await exists(join(dir, ".auto", "config.json"))).toBe(false)
    expect(await Bun.file(join(dir, ".auto", "stats.json")).text()).toBe('{"tasks":3}\n')
    expect(await Bun.file(join(dir, ".auto", "logs", "run.log")).text()).toBe("日志\n")
  })
})

describe("reset: 边界安全", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-reset-"))
    await seedInit(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // plans/0052 D9 (DF6): the brief is human intent; only the untouched stub is init's.
  test("a filled brief.md is kept; the untouched stub is removed", async () => {
    await writeFile(join(dir, ".opencode", "auto", "brief.md"), `${renderProjectBrief()}\nMigrate legacy/pkg to app/.\n`)
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === ".opencode/auto/brief.md")).toMatchObject({ action: "keep", reason: "filled in, not the init stub, kept" })
    expect(await Bun.file(join(dir, ".opencode", "auto", "brief.md")).text()).toContain("Migrate legacy/pkg to app/.")
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
  })

  test("opencode.json 被修改过则保留(逐字节比对模板)", async () => {
    await writeFile(join(dir, "opencode.json"), '{"model":"我自己的配置"}\n')
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === "opencode.json")).toMatchObject({ action: "keep" })
    expect(await Bun.file(join(dir, "opencode.json")).text()).toBe('{"model":"我自己的配置"}\n')
  })

  test("用户自建的 .opencode/auto/prompts/ 不被回收", async () => {
    await mkdir(join(dir, ".opencode", "auto", "prompts"), { recursive: true })
    await writeFile(join(dir, ".opencode", "auto", "prompts", "whole.md"), "我的覆盖模板\n")
    await reset(dir)
    expect(await Bun.file(join(dir, ".opencode", "auto", "prompts", "whole.md")).text()).toBe("我的覆盖模板\n")
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
  })

  test("用户自己的其他 agent 契约不被回收", async () => {
    await writeFile(join(dir, ".opencode", "agent", "reviewer.md"), "# reviewer\n")
    await reset(dir)
    expect(await Bun.file(join(dir, ".opencode", "agent", "reviewer.md")).text()).toBe("# reviewer\n")
    expect(await exists(join(dir, ".opencode", "agent", "auto.md"))).toBe(false)
  })

  test("AGENTS.md 含用户自写正文: 只摘标记块,正文原样保留", async () => {
    const text = await Bun.file(join(dir, "AGENTS.md")).text()
    await writeFile(join(dir, "AGENTS.md"), `# AGENTS.md\n\n## 我的约定\n\n用两空格缩进。\n\n${text.split("\n\n").slice(1).join("\n\n")}`)
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === "AGENTS.md")).toMatchObject({ action: "strip" })
    const after = await Bun.file(join(dir, "AGENTS.md")).text()
    expect(after).toContain("用两空格缩进。")
    expect(after).not.toContain("opencode-auto:start")
  })

  test(".gitignore 用户自有条目保留,只移除 tmp/ 与 .auto/", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\ntmp/\n.auto/\n*.log\n")
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === ".gitignore")).toMatchObject({ action: "strip" })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n*.log\n")
  })

  test("PLAN.md、docs/ 与 tmp/ 一律不动", async () => {
    await mkdir(join(dir, "docs", "R-01"), { recursive: true })
    await mkdir(join(dir, "tmp"), { recursive: true })
    await writeFile(join(dir, "PLAN.md"), "## T-001: 我的任务 [pending]\n")
    await writeFile(join(dir, "docs", "R-01", "phases.md"), "- [done] a\n")
    await writeFile(join(dir, "tmp", "verify.sh"), "#!/bin/sh\n")
    await reset(dir)
    expect(await Bun.file(join(dir, "PLAN.md")).text()).toBe("## T-001: 我的任务 [pending]\n")
    expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).text()).toBe("- [done] a\n")
    expect(await Bun.file(join(dir, "tmp", "verify.sh")).text()).toBe("#!/bin/sh\n")
  })

  test("planReset 只算不删: 清单算出后文件仍在", async () => {
    const entries = await planReset(dir)
    expect(entries.length).toBeGreaterThan(0)
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(true)
    expect(await exists(join(dir, "opencode.json"))).toBe(true)
    expect(await exists(join(dir, "AGENTS.md"))).toBe(true)
  })
})

describe("removeGitignoreEntries", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-reset-gi-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("文件不存在: 无事发生", async () => {
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: false, emptied: false })
  })

  test("只剩两条 driver 条目时整个删除文件", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: true })
    expect(await exists(join(dir, ".gitignore"))).toBe(false)
  })

  test("归一化比对: /tmp 与 .auto 等写法同样移除", async () => {
    await writeFile(join(dir, ".gitignore"), "/tmp\n.auto\nkeep/\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("keep/\n")
  })

  test("dryRun 只算不写", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\nkeep/\n")
    expect(await removeGitignoreEntries(dir, { dryRun: true })).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\nkeep/\n")
  })

  test("ensureGitignore 的逆操作: 加回后再移除回到原状", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\n")
    expect(await ensureGitignore(dir)).toBe(true)
    await removeGitignoreEntries(dir)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n")
  })

  test("the init entries are removed too (local-only files and nested repository entries); the user's own entries are kept", async () => {
    await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
    await mkdir(join(dir, "pkg"))
    await Bun.spawn(["git", "-C", join(dir, "pkg"), "init", "-q"]).exited
    await writeFile(join(dir, ".gitignore"), "node_modules/\n")
    expect(await ensureInitGitignore(dir)).toEqual(["tmp/", ".auto/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", "/pkg/"])
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n")
  })

  test("a file holding only init entries is deleted whole", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: true })
    expect(await exists(join(dir, ".gitignore"))).toBe(false)
  })
})
