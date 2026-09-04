import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONFIG_DEFAULTS,
  formatProjectConfig,
  legacyModeFallback,
  loadProjectConfig,
  mergeProjectConfig,
  saveProjectConfig,
  type ProjectConfig,
} from "../src/config"

function tempDir() {
  return mkdtempSync(join(tmpdir(), "auto-config-"))
}

function writeConfig(dir: string, text: string) {
  mkdirSync(join(dir, ".opencode", "auto"), { recursive: true })
  writeFileSync(join(dir, ".opencode", "auto", "config.json"), text)
}

// 目标目录注册一个自定义模式,供未注册名/legacy 回落用例引用。
function registerMode(dir: string, name = "optimize") {
  const modes = join(dir, ".opencode", "auto", "modes")
  mkdirSync(modes, { recursive: true })
  writeFileSync(
    join(modes, `${name}.md`),
    `# ${name}\n\n## init\n导语。\n\n## exec\n注记。\n## final: audit\n审计。\n## final: validate\n回归。\n## final: finalize\n收尾。\n`,
  )
}

describe("loadProjectConfig", () => {
  test("文件缺失 → 全键缺省", async () => {
    const dir = tempDir()
    try {
      expect(await loadProjectConfig(dir)).toEqual(CONFIG_DEFAULTS)
      expect(await legacyModeFallback(dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("未知键忽略(前向兼容),缺失键回落缺省", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, `{"verify": true, "futureKey": {"nested": 1}}`)
      const config = await loadProjectConfig(dir)
      expect(config).toEqual({ ...CONFIG_DEFAULTS, verify: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("坏 JSON / 非对象 → throw 并指明文件", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, "{ 非法")
      await expect(loadProjectConfig(dir)).rejects.toThrow(/config\.json 不是合法 JSON/)
      writeConfig(dir, "[1, 2]")
      await expect(loadProjectConfig(dir)).rejects.toThrow(/须为 JSON 对象/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("键值越界 / 类型错误 → throw 含键名与期望值域", async () => {
    const dir = tempDir()
    try {
      const bad: [string, unknown][] = [
        ["idleTime", 0],
        ["idleTime", 121],
        ["idleTime", "10"],
        ["idleMax", -1],
        ["idleMax", 1441],
        ["contextLimit", 0],
        ["contextLimit", 64.5],
        ["subtask", "fast"],
        ["verify", "yes"],
        ["commit", 1],
        ["agent", ""],
        ["mode", 123],
        ["phases", ""],
        ["phases", "tma"],
        ["phases", "adk"],
        ["phases", "mm"],
        ["phases", "mx"],
        ["phases", 42],
        ["source", "dir"],
        ["source", { dir: "src" }],
        ["source", { path: "mod" }],
        ["source", { dir: "", path: "mod" }],
        ["source", { dir: "src", path: "" }],
        ["source", { dir: "src", path: "../mod" }],
        ["source", { dir: "src", path: "/abs/mod" }],
        ["source", { dir: "../legacy", path: "mod" }],
        ["source", { dir: "/abs/legacy", path: "mod" }],
        ["destDir", ""],
        ["destDir", "/abs/target"],
        ["destDir", "../up"],
        ["destDir", 42],
        ["testByDriver", "yes"],
        ["handoverTest", 1],
        ["autoNumber", "yes"],
        ["autoNumber", 1],
      ]
      for (const [key, value] of bad) {
        writeConfig(dir, JSON.stringify({ [key]: value }))
        await expect(loadProjectConfig(dir)).rejects.toThrow(key === "source" ? "source" : key)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("autoNumber 缺省 false;合法布尔原样读回", async () => {
    const dir = tempDir()
    try {
      expect(CONFIG_DEFAULTS.autoNumber).toBe(false)
      expect((await loadProjectConfig(dir)).autoNumber).toBe(false)
      writeConfig(dir, JSON.stringify({ autoNumber: true }))
      expect((await loadProjectConfig(dir)).autoNumber).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("handoverTest 须搭配 testByDriver,否则 throw", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ handoverTest: true }))
      await expect(loadProjectConfig(dir)).rejects.toThrow(/handoverTest 须搭配 testByDriver/)
      writeConfig(dir, JSON.stringify({ testByDriver: true, handoverTest: true }))
      const config = await loadProjectConfig(dir)
      expect(config.testByDriver).toBe(true)
      expect(config.handoverTest).toBe(true)
      expect(CONFIG_DEFAULTS.testByDriver).toBe(false)
      expect(CONFIG_DEFAULTS.handoverTest).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("phases / source / destDir 合法取值原样读回;source 与 destDir 缺省 undefined", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ phases: "admtvk", source: { dir: "legacy", path: "src/mod.ts" }, destDir: "target" }))
      const config = await loadProjectConfig(dir)
      expect(config.phases).toBe("admtvk")
      expect(config.source).toEqual({ dir: "legacy", path: "src/mod.ts" })
      expect(config.destDir).toBe("target")
      writeConfig(dir, JSON.stringify({ phases: "dmvk" }))
      const absent = await loadProjectConfig(dir)
      expect(absent.source).toBeUndefined()
      expect(absent.destDir).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("mode 未注册 → throw 并列出支持的模式", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ mode: "optimize" }))
      await expect(loadProjectConfig(dir)).rejects.toThrow(/mode 取值 "optimize" 未注册.*migrate/)
      registerMode(dir)
      expect((await loadProjectConfig(dir)).mode).toBe("optimize")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("saveProjectConfig 写出完整配置后可读回(Bun.write 自动建父目录)", async () => {
    const dir = tempDir()
    try {
      const config: ProjectConfig = {
        ...CONFIG_DEFAULTS,
        verify: true,
        contextLimit: 128,
        commit: false,
        phases: "admtvk",
        source: { dir: "legacy", path: "packages/core" },
        destDir: "target",
      }
      await saveProjectConfig(dir, config)
      expect(await loadProjectConfig(dir)).toEqual(config)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("legacy 回落(.auto/config.json)", () => {
  test("新文件缺失时回落读取旧 mode;新文件一经写出即不再读取", async () => {
    const dir = tempDir()
    try {
      registerMode(dir)
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto", "config.json"), JSON.stringify({ mode: "optimize" }))
      const config = await loadProjectConfig(dir)
      expect(config.mode).toBe("optimize")
      expect(await legacyModeFallback(dir)).toBe("optimize")

      await saveProjectConfig(dir, { ...config, mode: "migrate" })
      expect(await loadProjectConfig(dir)).toEqual({ ...CONFIG_DEFAULTS })
      expect(await legacyModeFallback(dir)).toBeUndefined()
      // 新文件存在时,旧值变化也不影响
      writeFileSync(join(dir, ".auto", "config.json"), JSON.stringify({ mode: "optimize" }))
      expect((await loadProjectConfig(dir)).mode).toBe("migrate")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("旧文件坏 JSON 或 mode 非字符串 → 回落终止,取缺省", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto", "config.json"), "{ 非法")
      expect((await loadProjectConfig(dir)).mode).toBe("migrate")
      expect(await legacyModeFallback(dir)).toBeUndefined()
      writeFileSync(join(dir, ".auto", "config.json"), JSON.stringify({ mode: 123 }))
      expect((await loadProjectConfig(dir)).mode).toBe("migrate")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("看门狗键更名回落(verifyIdle/verifyMax → idleTime/idleMax)", () => {
  test("新键缺失时旧键生效;新键优先;旧键坏值按新键名报错", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ verifyIdle: 20, verifyMax: 30 }))
      const config = await loadProjectConfig(dir)
      expect(config.idleTime).toBe(20)
      expect(config.idleMax).toBe(30)
      // 新键一经给出即优先于旧键
      writeConfig(dir, JSON.stringify({ verifyIdle: 20, idleTime: 15 }))
      expect((await loadProjectConfig(dir)).idleTime).toBe(15)
      // 旧键的坏值同样被校验拦截(报错含新键名与期望值域)
      writeConfig(dir, JSON.stringify({ verifyIdle: 999 }))
      await expect(loadProjectConfig(dir)).rejects.toThrow(/idleTime 须为 1\.\.120/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("mergeProjectConfig 与 formatProjectConfig", () => {
  const existing: ProjectConfig = { ...CONFIG_DEFAULTS, verify: true, idleMax: 30, agent: "custom" }

  test("合并: 仅显式给出的键覆盖,undefined 视同未给出", () => {
    expect(mergeProjectConfig(existing, { commit: false })).toEqual({ ...existing, commit: false })
    expect(mergeProjectConfig(existing, { commit: undefined, mode: "migrate" })).toEqual(existing)
    // 重复 init 无参数(空显式键)不重置已有配置
    expect(mergeProjectConfig(existing, {})).toEqual(existing)
    expect(mergeProjectConfig(CONFIG_DEFAULTS, {})).toEqual(CONFIG_DEFAULTS)
    // autoNumber amend 语义: 显式给出覆盖,未给出保留
    expect(mergeProjectConfig(existing, { autoNumber: true }).autoNumber).toBe(true)
    expect(mergeProjectConfig({ ...existing, autoNumber: true }, { autoNumber: false }).autoNumber).toBe(false)
    expect(mergeProjectConfig({ ...existing, autoNumber: true }, {}).autoNumber).toBe(true)
  })

  test("摘要一行含全部键的生效值(phases 追加在末尾)", () => {
    expect(formatProjectConfig(CONFIG_DEFAULTS)).toBe(
      "模式 migrate · agent auto · 子任务 auto · 验收 off · 看门狗 idle 10m/max 不设 · 提交 on · 上下文上限 64k · 阶段 m",
    )
    expect(formatProjectConfig(existing)).toBe(
      "模式 migrate · agent custom · 子任务 auto · 验收 on · 看门狗 idle 10m/max 30m · 提交 on · 上下文上限 64k · 阶段 m",
    )
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, phases: "admtvk" })).toContain("阶段 admtvk")
    // 测试由 driver 执行键入摘要,交接修饰随 handoverTest
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, testByDriver: true })).toContain("· 测试 driver on ·")
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, testByDriver: true, handoverTest: true })).toContain("· 测试 driver on(交接) ·")
    // 自动编号仅启用时入摘要
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, autoNumber: true })).toContain("· 自动编号 on ·")
    expect(formatProjectConfig(CONFIG_DEFAULTS)).not.toContain("自动编号")
  })
})
