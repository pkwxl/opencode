import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePartials, promptTemplateNames, registerTemplate, renderText, renderTemplate, usePromptLibrary } from "../src/template"
import tplDryrun from "../templates/prompts/dryrun.md" with { type: "file" }

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

  test("doc-layout 节存在且不含模板变量;任务模板引用渲染为永久路径规范", () => {
    usePromptLibrary(undefined)
    const text = renderText("{{> doc-layout}}", {})
    expect(text).toContain("文档存放规范")
    expect(text).toContain("docs/T-NNN/")
    expect(text).toContain("S<两位序号>/index.md")
    expect(text).toContain("永久路径")
    expect(text).toContain("不要在 docs/ 顶层另建平铺任务文件")
    // 不含模板变量: phase-plan 等无 taskId 的模板同样可引用
    expect(text).not.toMatch(/\{\{|\}\}/)
    // 引用渲染: understand(任务文档写者)与 phase-plan(无 taskId 的规划者)都带该段
    expect(renderTemplate("understand", { taskId: "T-001", taskBlock: "x" })).toContain("文档存放规范")
    expect(renderTemplate("phase-plan", { phase: "a", phaseName: "分析" })).toContain("文档存放规范")
  })
})

describe("内置模板注册表", () => {
  test("29 个会话模板与 _partials 齐备", () => {
    expect(promptTemplateNames()).toEqual([
      "_partials",
      "context-base",
      "decompose",
      "decompose-a",
      "decompose-d",
      "decompose-k",
      "decompose-m",
      "decompose-t",
      "decompose-v",
      "dryrun",
      "final-task",
      "fix",
      "handoff-steer",
      "infer-source",
      "knowledge",
      "number-recovery",
      "phase-handover",
      "phase-plan",
      "prior-knowledge",
      "review",
      "review-fix",
      "subtask",
      "test-continue",
      "test-handover",
      "test-result",
      "understand",
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
      digest: "## 相关文件与关键符号\n- src/x.ts",
      subtask: "子任务",
      index: "1",
      subtaskList: "1. 任务甲\n2. 任务乙",
      outputFile: "docs/T-001/S01/index.md",
      warm: true,
      scriptPath: "/tmp/verify.sh",
      verifyState: "未声明",
      handoffFile: "docs/T-001/handoff.md",
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
      contextBudget: "32.0k",
      fine: true,
    }
    for (const name of promptTemplateNames().filter((item) => item !== "_partials")) {
      expect(renderTemplate(name, ctx)).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("分阶段分解模板 decompose-<phase>", () => {
  const six = ["a", "d", "m", "t", "v", "k"] as const

  test("六份齐备: 均含检查项协议、粒度准则段与阶段准则句", () => {
    usePromptLibrary(undefined)
    for (const letter of six) {
      const text = renderTemplate(`decompose-${letter}`, {
        taskId: "T-001",
        taskBlock: "# T-001\n\n正文",
        phaseName: "阶段名",
        contextBudget: "32.0k",
        fine: false,
      })
      expect(text).toContain("- [ ]")
      expect(text).toContain("只做任务分解,不写实现代码")
      expect(text).toContain("当前处于阶段 阶段名")
      expect(text).toContain("分解粒度准则")
      expect(text).toContain("以任务描述为基准")
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })

  test("fine 两态: 细粒度段按开关出现/消失(片段内条件段与模板同级求值)", () => {
    usePromptLibrary(undefined)
    const ctx = { taskId: "T-001", taskBlock: "# T-001\n\n正文", phaseName: "分析", contextBudget: "32.0k" }
    for (const letter of six) {
      const on = renderTemplate(`decompose-${letter}`, { ...ctx, fine: true })
      expect(on).toContain("细粒度模式")
      expect(on).toContain("宁细勿粗")
      expect(on).toContain("约 32.0k tokens 量级")
      expect(on).not.toMatch(/\{\{|\}\}/)
      const off = renderTemplate(`decompose-${letter}`, { ...ctx, fine: false })
      expect(off).not.toContain("细粒度模式")
      expect(off).not.toContain("宁细勿粗")
      expect(off).not.toMatch(/\{\{|\}\}/)
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
      // phase-handover 覆盖缺四个必备小节标题 → 同样报错;修复后再测 understand
      writeFileSync(join(overlay, "phase-handover.md"), "自定义交接提示词,丢了小节协议")
      expect(() => usePromptLibrary(dir)).toThrow(/phase-handover\.md 缺少关键协议内容/)
      expect(() => usePromptLibrary(dir)).toThrow(/## 关键决策/)
      writeFileSync(
        join(overlay, "phase-handover.md"),
        "自定义交接提示词,保留协议: ## 关键决策 ## 约束与坑 ## 下一阶段必读清单 ## 产物索引 写入 {{handover}}",
      )
      // understand 覆盖丢 context.md 摘要文件协议 → 同样报错
      writeFileSync(join(overlay, "understand.md"), "自定义理解提示词,丢了摘要文件协议")
      expect(() => usePromptLibrary(dir)).toThrow(/understand\.md 缺少关键协议内容/)
      expect(() => usePromptLibrary(dir)).toThrow(/context\.md/)
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

describe("动态注册(registerTemplate)", () => {
  test("注册附加模板: 即时可渲染(含条件语法)并进入模板名清单", () => {
    registerTemplate("shell-extra", "外壳附加提示词: {{topic}}{{#if strict}}(严格){{/if}}")
    expect(renderTemplate("shell-extra", { topic: "参数推断", strict: true })).toBe("外壳附加提示词: 参数推断(严格)")
    expect(renderTemplate("shell-extra", { topic: "参数推断" })).toBe("外壳附加提示词: 参数推断")
    expect(promptTemplateNames()).toContain("shell-extra")
  })

  test("注册跨 usePromptLibrary 重载保留;与内置同名时注册内容生效,目标目录覆盖仍最高优先", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerTemplate("shell-extra", "注册版: {{topic}}")
      registerTemplate("dryrun", "外壳替换后的权限预检提示词")
      usePromptLibrary(dir)
      expect(renderTemplate("shell-extra", { topic: "甲" })).toBe("注册版: 甲")
      expect(renderTemplate("dryrun", {})).toBe("外壳替换后的权限预检提示词")
      // 目标目录同名覆盖 > 注册 > 内置(同目录二次装载须先重置,装载幂等短路)
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "dryrun.md"), "用户覆盖版预检提示词")
      usePromptLibrary(undefined)
      usePromptLibrary(dir)
      expect(renderTemplate("dryrun", {})).toBe("用户覆盖版预检提示词")
      expect(renderTemplate("shell-extra", { topic: "乙" })).toBe("注册版: 乙")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      // 注册表面是模块级全局: 恢复内置 dryrun 文案,防跨测试文件污染(renderDryrun 等)
      registerTemplate("dryrun", readFileSync(tplDryrun, "utf8"))
    }
  })

  test("带 markers 注册: 目标目录覆盖缺失协议行时报错", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerTemplate("shell-protocol", "外壳协议模板", ["结论: 通过"])
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "shell-protocol.md"), "覆盖版丢了协议行")
      expect(() => usePromptLibrary(dir)).toThrow(/shell-protocol\.md 缺少关键协议内容/)
      expect(() => usePromptLibrary(dir)).toThrow(/结论: 通过/)
      writeFileSync(join(overlay, "shell-protocol.md"), "覆盖版保留协议行: 结论: 通过")
      usePromptLibrary(dir)
      expect(renderTemplate("shell-protocol", {})).toBe("覆盖版保留协议行: 结论: 通过")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("空模板名 / 空内容 / _partials 注册拒绝", () => {
    expect(() => registerTemplate("", "内容")).toThrow("模板名不能为空")
    expect(() => registerTemplate("shell-empty", "   ")).toThrow("内容不能为空")
    expect(() => registerTemplate("_partials", "## x\n内容")).toThrow("不接受注册")
  })
})
