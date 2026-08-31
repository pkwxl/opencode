import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkPrinciple } from "../src/check"
import { ensurePointer } from "../src/loop"

describe("checkPrinciple", () => {
  test("标记要求会话亲自运行验证/执行提交的描述,放行合规语句", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
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
      // init 补写指针块与验证/提交原则块后,原则块内的 driver 执行表述不再触发提示
      const ensured = await ensurePointer(dir)
      expect(ensured).toEqual({ pointer: true, principle: true, commit: true })
      const after = await checkPrinciple(dir)
      expect(after.findings).toEqual([])
      expect(after.notes).toEqual([])
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
})
