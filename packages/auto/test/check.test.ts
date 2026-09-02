import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkPrinciple } from "../src/check"
import { ensurePointer } from "../src/loop"

describe("checkPrinciple", () => {
  test("verify 启用: 标记要求会话亲自运行验证/执行提交的描述,放行合规语句", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ verify: true }))
      await Bun.write(
        join(dir, "PLAN.md"),
        [
          "# 计划",
          "",
          "## T-001: 正常任务 [pending]",
          "  - verify: command: bun test",
          "实现功能并自行编写单元测试。",
          "该执行权原则经 init 下沉到 AGENTS.md 验证原则块。",
          "中断后不再复跑 verify 命令,由 driver 重新执行。",
          "",
          "## T-002: 违规任务 [pending]",
          "  - verify: 验收标准描述",
          "完成后运行验收命令确认全部通过。",
          "请执行 verify 脚本并把结果贴在报告里。",
          "run the verification suite to accept the task.",
          "不要运行任务级 verify(验收由 driver 负责)。",
          "",
        ].join("\n"),
      )
      await Bun.write(
        join(dir, "AGENTS.md"),
        ["# AGENTS.md", "", "会话结束时执行验证脚本并记录退出码。", "driver 在会话外执行 verify 脚本,会话不得执行。", ""].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      // 四处违规: AGENTS 执行验证脚本 1 处 + PLAN 运行验收命令 / 执行 verify 脚本 /
      // run the verification 各 1 处
      expect(findings.length).toBe(4)
      expect(findings[0]).toMatchObject({ file: "AGENTS.md", line: 3, text: "会话结束时执行验证脚本并记录退出码。" })
      expect(findings[1]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 11, text: "完成后运行验收命令确认全部通过。" })
      expect(findings[2]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 12 })
      expect(findings[3]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 13 })
      // verify 字段行、否定句、driver 归属句均不计;缺验证/提交原则块给出提示
      expect(notes).toEqual([`AGENTS.md 缺少验证原则块,运行 opencode-auto init 可补写`, `AGENTS.md 缺少提交原则块,运行 opencode-auto init 可补写`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("verify 未启用: 验证类描述不算违背,也不提示补写验证原则块", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(
        join(dir, "PLAN.md"),
        [
          "# 计划",
          "",
          "## T-001: 任务 [pending]",
          "完成后运行验收命令确认全部通过。",
          "请执行 verify 脚本并把结果贴在报告里。",
          "",
        ].join("\n"),
      )
      await Bun.write(
        join(dir, "AGENTS.md"),
        ["# AGENTS.md", "", "会话结束时执行验证脚本并记录退出码。", ""].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      // 验证原则块提示随 verify 关闭;提交原则块提示保留
      expect(notes).toEqual([`AGENTS.md 缺少提交原则块,运行 opencode-auto init 可补写`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("配置非法: 按未启用处理并给出提示,提交原则照常检查", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ idleTime: 999 }))
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n完成后 git commit -m 完成。\n")
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings.length).toBe(1)
      expect(notes[0]).toContain("项目配置(.opencode/auto/config.json)非法,验证原则检查按未启用处理")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("标记要求会话执行 git 提交的描述,放行否定句与 driver 归属句", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(
        join(dir, "PLAN.md"),
        [
          "# 计划",
          "",
          "## T-001: 违规任务 [pending]",
          "完成后 git add -A 并 git commit -m 完成。",
          "每完成一个模块提交全部未提交改动。",
          "不要执行 git commit,统一提交由 driver 负责。",
          "提交信息遵循仓库现有风格。",
          "",
        ].join("\n"),
      )
      const { findings } = await checkPrinciple(dir)
      expect(findings.length).toBe(2)
      expect(findings[0]).toMatchObject({ file: "PLAN.md", task: "T-001", line: 4 })
      expect(findings[1]).toMatchObject({ file: "PLAN.md", task: "T-001", line: 5 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("AGENTS.md 的 opencode-auto 块整体跳过;init 补写后无提示", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n  - verify: command: bun test\n实现功能。\n")
      const before = await checkPrinciple(dir)
      expect(before.findings).toEqual([])
      expect(before.notes.length).toBe(1)
      // init 补写指针块、验证/提交原则块与维护规则块后,块内的 driver 执行表述不再触发提示
      const ensured = await ensurePointer(dir, { verify: true })
      expect(ensured).toEqual({ pointer: true, principle: true, principleRemoved: false, commit: true, maint: true })
      const after = await checkPrinciple(dir)
      expect(after.findings).toEqual([])
      expect(after.notes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("verify 未启用: ensurePointer 不补写验证原则块,已存在的移除且前后文完好", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    const block = "<!-- opencode-auto:verify:start -->\n验证原则: 验证由 driver 执行。\n<!-- opencode-auto:verify:end -->"
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      await Bun.write(join(dir, "AGENTS.md"), "# AGENTS.md\n\n项目自有内容。\n")
      const first = await ensurePointer(dir)
      expect(first.principle).toBe(false)
      expect(first.principleRemoved).toBe(false)
      const written = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(written).toContain("项目自有内容。")
      expect(written).not.toContain("opencode-auto:verify:start")
      expect(written).toContain("opencode-auto:commit:start")
      // 已存在的验证原则块: 再次 ensure(verify 关)整块移除,前后文与空行分隔保持
      await Bun.write(join(dir, "AGENTS.md"), `# AGENTS.md\n\n前文。\n\n${block}\n\n后文。\n`)
      const second = await ensurePointer(dir)
      expect(second.principleRemoved).toBe(true)
      const cleaned = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(cleaned).not.toContain("opencode-auto:verify:start")
      expect(cleaned).toContain("前文。")
      expect(cleaned).toContain("后文。")
      expect(cleaned).not.toContain("验证由 driver 执行")
      expect(cleaned).toMatch(/前文。\n\n后文。/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("PLAN.md 缺失时给出提示", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      expect(notes.length).toBe(2)
      expect(notes[0]).toContain("AGENTS.md 不存在")
      expect(notes[1]).toContain("未找到 PLAN.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("AGENTS.md 超过 150 行输出精简提示(note 不进 findings)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      const filler = Array.from({ length: 155 }, (_, i) => `规则条目 ${i + 1}: 与工作流相关的持久约定。`).join("\n")
      await Bun.write(
        join(dir, "AGENTS.md"),
        [
          "# AGENTS.md",
          "",
          "<!-- opencode-auto:start --><!-- opencode-auto:end -->",
          "<!-- opencode-auto:verify:start --><!-- opencode-auto:verify:end -->",
          "<!-- opencode-auto:commit:start --><!-- opencode-auto:commit:end -->",
          "<!-- opencode-auto:maint:start --><!-- opencode-auto:maint:end -->",
          "",
          filler,
          "",
        ].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      // 2 行标题 + 空行 + 4 个标记块行 + 空行 + 155 行规则 = 162 行
      expect(notes).toEqual([
        "AGENTS.md 当前 162 行,超过 150 行上限(维护规则块第 1 条),建议按规则精简并把细节路由到 docs/agents/",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
