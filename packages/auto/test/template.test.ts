import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePartials, promptTemplateNames, renderText, renderTemplate, usePromptLibrary } from "../src/template"

// 每个用例后恢复仅内置,避免覆盖状态泄漏到其他测试文件。
afterEach(() => usePromptLibrary(undefined))

describe("渲染器", () => {
  test("变量替换: string 直替,boolean/undefined 渲染为空", () => {
    expect(renderText("a{{x}}b", { x: "值" })).toBe("a值b")
    expect(renderText("a{{x}}b", { x: true })).toBe("ab")
    expect(renderText("a{{x}}b", { x: false })).toBe("ab")
    expect(renderText("a{{x}}b", {})).toBe("ab")
  })

  test("条件段: 非空字符串或 true 为真,空串/false/未定义为假", () => {
    expect(renderText("{{#if x}}有{{/if}}{{^x}}无{{/if}}", { x: "文字" })).toBe("有")
    expect(renderText("{{#if x}}有{{/if}}{{^x}}无{{/if}}", { x: true })).toBe("有")
    expect(renderText("{{#if x}}有{{/if}}{{^x}}无{{/if}}", { x: "" })).toBe("无")
    expect(renderText("{{#if x}}有{{/if}}{{^x}}无{{/if}}", {})).toBe("无")
  })

  test("条件段支持嵌套", () => {
    expect(renderText("{{#if a}}A{{#if b}}B{{/if}}{{/if}}", { a: true, b: true })).toBe("AB")
    expect(renderText("{{#if a}}A{{#if b}}B{{/if}}{{/if}}", { a: true })).toBe("A")
  })

  test("独占一行的块标签整行吞掉,不残留空行", () => {
    const text = ["前", "", "{{#if x}}", "中", "", "{{/if}}", "后"].join("\n")
    expect(renderText(text, { x: true })).toBe("前\n\n中\n\n后")
    expect(renderText(text, {})).toBe("前\n\n后")
  })

  test("未闭合/多余的闭合标签抛错", () => {
    expect(() => renderText("{{#if x}}内容", { x: true })).toThrow("未闭合")
    expect(() => renderText("{{/if}}", {})).toThrow("多余的 {{/if}}")
    expect(() => renderText("{{#if x}}内容{{/each}}", { x: true })).toThrow("未知闭合标签")
  })

  test("片段引用: 共享片段按当前上下文渲染(片段内可用变量)", () => {
    usePromptLibrary(undefined)
    expect(renderText("{{> state-rule}}", {})).toContain("由 driver 独占维护")
    expect(renderText("{{> state-rule}}", {})).toContain("git 提交由 driver 在会话结束后统一执行")
  })

  test("片段独占一行时行首缩进应用到每一行;行内引用仅应用到第二行起(片段体自带缩进叠加)", () => {
    usePromptLibrary(undefined)
    const standalone = renderText("前:\n   {{> state-rule}}\n后", { verify: true })
    expect(standalone.split("\n")[1]).toBe("   PLAN.md 与 CURRENT.md 由 driver 独占维护(状态、检查项勾选、verified 字段),会话期间这两个文件为只读,你不得编辑,也不要用 chmod 等方式恢复其写权限。")
    expect(standalone.split("\n")[2]).toBe("   git 提交由 driver 在会话结束后统一执行,你不要运行 git commit 等提交命令。")
    const inline = renderText("前:\n   {{> state-rule}};尾", { verify: true })
    expect(inline.split("\n").at(-1)).toBe("   git 提交由 driver 在会话结束后统一执行,你不要运行 git commit 等提交命令。;尾")
  })
})

describe("共享片段解析", () => {
  test("## 节解析为首尾去空行的片段体,H1 与节外说明忽略", () => {
    const partials = parsePartials("# 标题\n说明文字忽略。\n\n## a\n\n内容甲\n\n\n## b\n内容乙\n")
    expect(partials.a).toBe("内容甲")
    expect(partials.b).toBe("内容乙")
  })
})

describe("内置模板注册表", () => {
  test("20 个会话模板与 _partials 齐备", () => {
    expect(promptTemplateNames()).toEqual([
      "_partials",
      "decompose",
      "dryrun",
      "final-task",
      "fix",
      "handoff-steer",
      "infer-source",
      "knowledge",
      "phase-handover",
      "phase-plan",
      "prior-knowledge",
      "review",
      "review-fix",
      "subtask",
      "test-continue",
      "test-handover",
      "test-result",
      "verify-judge",
      "verify-script-gen",
      "whole",
      "wrapup",
    ])
  })

  test("全部内置模板可渲染(代表性上下文,无残留标签)", () => {
    const ctx = {
      taskId: "T-001",
      taskBlock: "# T-001\n\n正文",
      doneList: "- [done] T-000: 前置",
      gap: "差距",
      subtask: "子任务",
      scriptPath: "/tmp/verify.sh",
      verifyState: "未声明",
      handoffFile: "docs/T-001.handoff.md",
      stageName: "终审审计",
      round: "1",
      proposalFile: "docs/final/plan-audit-r1.md",
      runScript: "/x",
      runCode: "0",
      runMs: "1",
      runTimeout: "否",
      runOut: "/out",
      replacement: "/r",
      laterVerifyList: "   (无)",
      final: true,
      early: true,
      solo: true,
      ondemand: true,
      continuation: true,
      reaudit: false,
      stageAudit: true,
      stageRemediate: false,
      stageValidate: false,
      stageFinalize: false,
      blockedAnswered: false,
      blockedUnanswered: false,
      question: "",
      answer: "",
      modeName: "migrate",
      modeInit: "导语",
      modeExec: "注记",
      emphasis: "侧重",
      prior: "上游",
      file: "docs/migration-kb/migration-2026_01-01_00-00-00.md",
      phase: "a",
      phaseName: "分析",
      brief: "项目意图",
      handovers: "### a 分析(docs/phases/a-analysis/handover.md)",
      prevRound: "### 上一轮(第 1 轮)阶段归档索引",
      archive: "docs/phases/a-analysis",
      next: "m 迁移实现",
      sourceDir: "/legacy",
      sourcePath: "src/mod.ts",
      destDir: "target",
      finalReview: "2",
      phaseA: true,
      phaseD: false,
      phaseM: false,
      phaseT: false,
      phaseV: false,
      phaseK: false,
      verify: true,
      testByDriver: true,
      handoverTest: true,
    }
    for (const name of promptTemplateNames().filter((item) => item !== "_partials")) {
      expect(renderTemplate(name, ctx)).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("目标目录覆盖(.opencode/auto/prompts/)", () => {
  test("同名模板覆盖内置,新内容生效", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "subtask.md"), "自定义子任务提示词: {{subtask}}")
      usePromptLibrary(dir)
      expect(renderTemplate("subtask", { subtask: "任务甲" })).toBe("自定义子任务提示词: 任务甲")
      // 未覆盖的模板仍取内置
      expect(renderTemplate("dryrun", {})).toContain("权限预检")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("协议敏感模板覆盖缺失协议行时报错并指明文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "verify-judge.md"), "随便写的判定提示词,没有结论协议")
      expect(() => usePromptLibrary(dir)).toThrow(/verify-judge\.md 缺少关键协议内容/)
      expect(() => usePromptLibrary(dir)).toThrow(/结论: 通过/)
      // phase-handover 覆盖缺四个必备小节标题 → 同样报错
      writeFileSync(join(overlay, "phase-handover.md"), "自定义交接提示词,丢了小节协议")
      expect(() => usePromptLibrary(dir)).toThrow(/phase-handover\.md 缺少关键协议内容/)
      expect(() => usePromptLibrary(dir)).toThrow(/## 关键决策/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("_partials 覆盖按节名合并,未覆盖节保留内置", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "_partials.md"), "## state-rule\n自定义状态规则。")
      usePromptLibrary(dir)
      expect(renderText("{{> state-rule}}", {})).toBe("自定义状态规则。")
      expect(renderText("{{> question-rule}}", {})).toContain("AUTO-DECISION")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
