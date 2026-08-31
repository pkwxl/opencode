import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadModes, parseModeFile, readPersistedMode, writePersistedMode } from "../src/mode"

// 合法模式文件样例: 标题与文件名一致、五节齐备。
function modeText(name: string, marker = "默认"): string {
  return `# ${name}

## init
${marker}导语。

## exec
${marker}注记。

## final: audit
${marker}审计侧重。

## final: validate
${marker}回归侧重。

## final: finalize
${marker}收尾侧重。
`
}

describe("内置模式", () => {
  test("内置仅注册 migrate,三段文案齐备(逐字迁移自旧注册表)", () => {
    const modes = loadModes()
    expect(Object.keys(modes)).toEqual(["migrate"])
    const mode = modes.migrate!
    expect(mode.name).toBe("migrate")
    // init 导语: 场景定义、任务排布原则、verify 侧重
    expect(mode.init).toContain("外部行为不变")
    expect(mode.init).toContain("基线确认")
    expect(mode.init).toContain("迁移改造")
    expect(mode.init).toContain("回归验证")
    expect(mode.init).toContain("优先复用既有的测试/构建命令")
    // exec 注记: 对等行为、兼容层与 AUTO-DECISION 标注要求
    expect(mode.exec).toContain("对等行为")
    expect(mode.exec).toContain("兼容层")
    expect(mode.exec).toContain("AUTO-DECISION")
    // final 各阶段侧重
    expect(mode.final.audit).toContain("行为对等")
    expect(mode.final.audit).toContain("旧路径")
    expect(mode.final.validate).toContain("回归覆盖")
    expect(mode.final.finalize).toContain("旧实现的清理")
    expect(mode.final.finalize).toContain("兼容层的收尾")
  })

  test("未注册名不在注册表中(optimize/implement/test 须由目标目录提供)", () => {
    const modes = loadModes()
    expect(modes.optimize).toBeUndefined()
    expect(modes.implement).toBeUndefined()
    expect(modes.test).toBeUndefined()
  })
})

describe("目标目录模式扩展(.opencode/auto/modes/)", () => {
  test("新增模式零源码改动;同名覆盖内置", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mode-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "modes")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "optimize.md"), modeText("optimize", "优化"))
      writeFileSync(join(overlay, "migrate.md"), modeText("migrate", "自定义"))
      const modes = loadModes(dir)
      expect(Object.keys(modes).sort()).toEqual(["migrate", "optimize"])
      expect(modes.optimize!.init).toContain("优化导语")
      // 同名覆盖: 内置 migrate 的文案被目标目录版本替换
      expect(modes.migrate!.init).toContain("自定义导语")
      expect(modes.migrate!.init).not.toContain("外部行为不变")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("文件名不合法、标题不符、缺节、未知节均为解析错误", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mode-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "modes")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "Bad_Name.md"), modeText("Bad_Name"))
      writeFileSync(join(overlay, "mismatch.md"), modeText("其他名字"))
      writeFileSync(join(overlay, "incomplete.md"), `# incomplete\n\n## init\n只有一节。\n`)
      writeFileSync(join(overlay, "unknown.md"), `${modeText("unknown")}\n## extra\n多余节。\n`)
      expect(() => loadModes(dir)).toThrow(/Bad_Name\.md 不合法/)
      expect(() => parseModeFile("mismatch", modeText("其他名字"))).toThrow(/首行须为 "# mismatch"/)
      expect(() => parseModeFile("incomplete", `# incomplete\n\n## init\n只有一节。\n`)).toThrow(
        /缺少节: ## exec、## final: audit/,
      )
      expect(() => parseModeFile("unknown", `${modeText("unknown")}\n## extra\n多余节。\n`)).toThrow(/未知节/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("节体首尾空行被裁剪,空节视为缺失", () => {
    const spec = parseModeFile(
      "x",
      `# x\n\n## init\n\n\n导语。\n\n\n## exec\n注记。\n## final: audit\na\n## final: validate\nb\n## final: finalize\n\n\nc\n`,
    )
    expect(spec.init).toBe("导语。")
    expect(spec.final.finalize).toBe("c")
    expect(() => parseModeFile("y", `# y\n\n## init\n\n\n## exec\n注记。\n## final: audit\na\n## final: validate\nb\n## final: finalize\nc\n`)).toThrow(
      /缺少节/,
    )
  })
})

describe("模式持久化(.auto/config.json)", () => {
  test("未写入/非法文件读取为 undefined,写入后可读回", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mode-"))
    try {
      expect(readPersistedMode(dir)).toBeUndefined()
      writePersistedMode(dir, "optimize")
      expect(readPersistedMode(dir)).toBe("optimize")
      writeFileSync(join(dir, ".auto", "config.json"), "{ 非法")
      expect(readPersistedMode(dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
