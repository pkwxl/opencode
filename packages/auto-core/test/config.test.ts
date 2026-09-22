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

  test("未知键忽略(前向兼容),缺失键回落缺省;已退役的 verify 键取 false(存量 init 产物)同样忽略", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, `{"subtask": "off", "verify": false, "futureKey": {"nested": 1}}`)
      const config = await loadProjectConfig(dir)
      expect(config).toEqual({ ...CONFIG_DEFAULTS, subtask: "off" })
      expect("verify" in config).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("坏 JSON / 非对象 → throw 并指明文件", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, "{ 非法")
      await expect(loadProjectConfig(dir)).rejects.toThrow(/config\.json is not valid JSON/)
      writeConfig(dir, "[1, 2]")
      await expect(loadProjectConfig(dir)).rejects.toThrow(/must be a JSON object/)
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
        // verify 已退役(plans/0044 D2): true 严格失败,报文含键名
        ["verify", true],
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
        ["wrapup", "yes"],
        ["wrapup", 1],
      ]
      for (const [key, value] of bad) {
        writeConfig(dir, JSON.stringify({ [key]: value }))
        await expect(loadProjectConfig(dir)).rejects.toThrow(key === "source" ? "source" : key)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("commit: false 已退役 → 严格失败;true/缺失照常(plans/0021-commit-boundary-design.md 2026-09-15)", async () => {
    const dir = tempDir()
    try {
      expect(CONFIG_DEFAULTS.commit).toBe(true)
      expect((await loadProjectConfig(dir)).commit).toBe(true)
      writeConfig(dir, JSON.stringify({ commit: true }))
      expect((await loadProjectConfig(dir)).commit).toBe(true)
      writeConfig(dir, JSON.stringify({ commit: false }))
      await expect(loadProjectConfig(dir)).rejects.toThrow(/commit: false is retired/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("autoNumber 缺省 true(stable-refs D5);合法布尔原样读回", async () => {
    const dir = tempDir()
    try {
      expect(CONFIG_DEFAULTS.autoNumber).toBe(true)
      expect((await loadProjectConfig(dir)).autoNumber).toBe(true)
      writeConfig(dir, JSON.stringify({ autoNumber: false }))
      expect((await loadProjectConfig(dir)).autoNumber).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("wrapup 缺省 true;合法布尔原样读回", async () => {
    const dir = tempDir()
    try {
      expect(CONFIG_DEFAULTS.wrapup).toBe(true)
      expect((await loadProjectConfig(dir)).wrapup).toBe(true)
      writeConfig(dir, JSON.stringify({ wrapup: false }))
      expect((await loadProjectConfig(dir)).wrapup).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("handoverTest 须搭配 testByDriver,否则 throw", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ handoverTest: true }))
      await expect(loadProjectConfig(dir)).rejects.toThrow(/handoverTest requires testByDriver/)
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

  test("phases type-id list (M3.6): string or JSON array (joined), custom types from .opencode/auto/phases", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ phases: ["analysis", "implement", "test"] }))
      expect((await loadProjectConfig(dir)).phases).toBe("analysis,implement,test")
      writeConfig(dir, JSON.stringify({ phases: "review,implement" }))
      await expect(loadProjectConfig(dir)).rejects.toThrow("unknown phase type(s) review")
      mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
      writeFileSync(join(dir, ".opencode/auto/phases/review.md"), "# Review\n\n## plan duties\n\nPlan the review.\n")
      expect((await loadProjectConfig(dir)).phases).toBe("review,implement")
      writeConfig(dir, JSON.stringify({ phases: ["review", 1] }))
      await expect(loadProjectConfig(dir)).rejects.toThrow("list of phase type ids")
      // A project type named after a model-routing role word is refused
      writeFileSync(join(dir, ".opencode/auto/phases/wrapup.md"), "# Wrapup\n\n## plan duties\n\nx\n")
      writeConfig(dir, JSON.stringify({ phases: "m" }))
      await expect(loadProjectConfig(dir)).rejects.toThrow('phase type "wrapup" is a model-routing role word')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("mode 未注册 → throw 并列出支持的模式", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ mode: "optimize" }))
      await expect(loadProjectConfig(dir)).rejects.toThrow(/mode value "optimize" is not registered.*migrate/)
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
        contextLimit: 128,
        testByDriver: true,
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
      await expect(loadProjectConfig(dir)).rejects.toThrow(/idleTime must be an integer in 1\..120/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("mergeProjectConfig 与 formatProjectConfig", () => {
  const existing: ProjectConfig = { ...CONFIG_DEFAULTS, idleMax: 30, agent: "custom" }

  test("合并: 仅显式给出的键覆盖,undefined 视同未给出", () => {
    expect(mergeProjectConfig(existing, { subtask: "off" })).toEqual({ ...existing, subtask: "off" })
    expect(mergeProjectConfig(existing, { subtask: undefined, mode: "migrate" })).toEqual(existing)
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
      "mode migrate · agent auto · subtask auto · watchdog idle 10m/max unset · commit on · auto-number on · context-limit 64k · phases m",
    )
    expect(formatProjectConfig(existing)).toBe(
      "mode migrate · agent custom · subtask auto · watchdog idle 10m/max 30m · commit on · auto-number on · context-limit 64k · phases m",
    )
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, phases: "admtvk" })).toContain("phases admtvk")
    // 测试由 driver 执行键入摘要,交接修饰随 handoverTest
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, testByDriver: true })).toContain("· test-by-driver on ·")
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, testByDriver: true, handoverTest: true })).toContain("· test-by-driver on(handover) ·")
    // 自动编号缺省启用入摘要(stable-refs D5);关闭时移除该段
    expect(formatProjectConfig(CONFIG_DEFAULTS)).toContain("· auto-number on ·")
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, autoNumber: false })).not.toContain("auto-number")
    // wrapup 缺省 true 不入摘要(现状零变化);关闭时摘要现"收尾 off"
    expect(formatProjectConfig(CONFIG_DEFAULTS)).not.toContain("wrapup")
    expect(formatProjectConfig({ ...CONFIG_DEFAULTS, wrapup: false })).toContain("· wrapup off ·")
  })
})
