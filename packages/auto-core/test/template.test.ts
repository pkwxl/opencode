import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePartials, promptTemplateNames, registerPartial, registerTemplate, renderText, renderTemplate, usePromptLibrary } from "../src/template"
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
    expect(renderText("{{> state-rule}}", {})).toContain("are maintained by the DRIVER alone")
    expect(renderText("{{> state-rule}}", {})).toContain("Git commits are made by the DRIVER in one pass after the session ends")
  })

  test("片段独占一行时行首缩进应用到每一行;行内引用仅应用到第二行起(片段体自带缩进叠加)", () => {
    usePromptLibrary(undefined)
    const standalone = renderText("前:\n   {{> state-rule}}\n后", {})
    expect(standalone.split("\n")[1]).toBe("   PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.")
    expect(standalone.split("\n")[2]).toBe("   Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.")
    const inline = renderText("前:\n   {{> state-rule}};尾", {})
    expect(inline.split("\n").at(-1)).toBe("   Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.;尾")
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
    expect(text).toContain("Document placement rules")
    expect(text).toContain("docs/T-NNN/")
    expect(text).toContain("S<two-digit index>/index.md")
    expect(text).toContain("these paths are permanent")
    expect(text).toContain("do not create flat task files at the top level of docs/")
    // 不含模板变量: phase-plan 等无 taskId 的模板同样可引用
    expect(text).not.toMatch(/\{\{|\}\}/)
    // 引用渲染: decompose(任务文档写者)与 phase-plan(无 taskId 的规划者)都带该段
    expect(renderTemplate("decompose", { taskId: "T-001", taskBlock: "x" })).toContain("Document placement rules")
    expect(renderTemplate("phase-plan", { phase: "a", phaseName: "分析" })).toContain("Document placement rules")
  })
})

describe("内置模板注册表", () => {
  test("24 个会话模板与 _partials 齐备(M1.0 起 understand 并入 decompose)", () => {
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
      "handoff-steer",
      "implement-plan",
      "infer-source",
      "knowledge",
      "number-recovery",
      "phase-handover",
      "phase-plan",
      "prior-knowledge",
      "stuck-hint",
      "subtask",
      "test-continue",
      "test-result",
      "test-wrapup",
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
      fromFile: true,
      filePath: "docs/rough-plan.md",
      content: "先做 A,再做 B",
    }
    for (const name of promptTemplateNames().filter((item) => item !== "_partials")) {
      expect(renderTemplate(name, ctx)).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("分阶段分解模板 decompose-<phase>", () => {
  const six = ["a", "d", "m", "t", "v", "k"] as const

  // M1.2 意图外置后,粒度准则与阶段职责段不再由模板自带,而是 prompt.ts 以
  // decomposeRule/phaseDuties 变量注入意图包内容;模板层只留角色边界、格式
  // 协议与注入挂点。内容断言见 test/intent.test.ts 与 test/prompt-exec.test.ts。
  test("六份齐备: 均含检查项协议与意图注入挂点,注入内容落位正确", () => {
    usePromptLibrary(undefined)
    for (const letter of six) {
      const text = renderTemplate(`decompose-${letter}`, {
        taskId: "T-001",
        taskBlock: "# T-001\n\n正文",
        phaseName: "阶段名",
        contextBudget: "32.0k",
        decomposeRule: "RULE-SENTINEL",
        phaseDuties: "DUTIES-SENTINEL",
      })
      expect(text).toContain("- [ ]")
      expect(text).toContain("This session completes the task-background understanding and the subtask decomposition; it writes no implementation code")
      expect(text).toContain("The current phase is 阶段名")
      expect(text).toContain("RULE-SENTINEL")
      expect(text).toContain("DUTIES-SENTINEL")
      // 注入点在检查项协议(5. 把分解结果写入…)之前
      expect(text.indexOf("DUTIES-SENTINEL")).toBeLessThan(text.indexOf("5. Write the decomposition into"))
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })

  test("零意图基线: 注入变量缺省时整段消失,不留空行残渣、不残留标签", () => {
    usePromptLibrary(undefined)
    for (const letter of six) {
      const text = renderTemplate(`decompose-${letter}`, {
        taskId: "T-001",
        taskBlock: "# T-001\n\n正文",
        phaseName: "阶段名",
      })
      expect(text).toContain("- [ ]")
      expect(text).not.toMatch(/\{\{|\}\}/)
      expect(text).not.toMatch(/\n\n\n/)
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
      writeFileSync(join(overlay, "wrapup.md"), "随便写的收尾提示词,没有结论行协议")
      expect(() => usePromptLibrary(dir)).toThrow(/wrapup\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/Result: PASS/)
      rmSync(join(overlay, "wrapup.md"))
      // phase-handover 覆盖缺四个必备小节标题 → 同样报错;修复后再测 decompose
      writeFileSync(join(overlay, "phase-handover.md"), "自定义交接提示词,丢了小节协议")
      expect(() => usePromptLibrary(dir)).toThrow(/phase-handover\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/## 关键决策/)
      writeFileSync(
        join(overlay, "phase-handover.md"),
        "自定义交接提示词,保留协议: ## 关键决策 ## 约束与坑 ## 下一阶段必读清单 ## 产物索引 写入 {{handover}}",
      )
      // decompose 覆盖丢 context.md/todo.md 产物协议(M1.0 合并会话)→ 同样报错
      writeFileSync(join(overlay, "decompose.md"), "自定义分解提示词,丢了产物协议与检查项格式")
      expect(() => usePromptLibrary(dir)).toThrow(/decompose\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/context\.md/)
      expect(() => usePromptLibrary(dir)).toThrow(/todo\.md/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("_partials 覆盖按节名合并,未覆盖节保留内置;被覆盖节须保留 tier-1 协议标记", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      // state-rule 是 tier-1 协议敏感节: 覆盖须保留 PLAN.md / CURRENT.md 锚点
      writeFileSync(join(overlay, "_partials.md"), "## state-rule\n自定义状态规则: PLAN.md 与 CURRENT.md 仍由 DRIVER 独占维护。")
      usePromptLibrary(dir)
      expect(renderText("{{> state-rule}}", {})).toBe("自定义状态规则: PLAN.md 与 CURRENT.md 仍由 DRIVER 独占维护。")
      expect(renderText("{{> question-rule}}", {})).toContain("AUTO-DECISION")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("协议敏感片段节覆盖缺失 tier-1 标记时报错并指明节名(M1.3 双层化)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "_partials.md"), "## state-rule\n自定义状态规则,丢了状态文件锚点。")
      expect(() => usePromptLibrary(dir)).toThrow(/section state-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/PLAN\.md/)
      writeFileSync(join(overlay, "_partials.md"), "## eof-rule\n写完就行,不用终止符。")
      expect(() => usePromptLibrary(dir)).toThrow(/section eof-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/<!-- auto: eof -->/)
      writeFileSync(join(overlay, "_partials.md"), "## question-rule\n随意提问即可。")
      expect(() => usePromptLibrary(dir)).toThrow(/section question-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/AUTO-RESOLVE/)
      // 未列名的节(如 digest-rule)非协议敏感,覆盖免标记
      writeFileSync(join(overlay, "_partials.md"), "## digest-rule\n自定义引用纪律。")
      usePromptLibrary(dir)
      expect(renderText("{{> digest-rule}}", {})).toBe("自定义引用纪律。")
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
      expect(() => usePromptLibrary(dir)).toThrow(/shell-protocol\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/结论: 通过/)
      writeFileSync(join(overlay, "shell-protocol.md"), "覆盖版保留协议行: 结论: 通过")
      usePromptLibrary(dir)
      expect(renderTemplate("shell-protocol", {})).toBe("覆盖版保留协议行: 结论: 通过")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("空模板名 / 空内容 / _partials 整份注册拒绝(按节走 registerPartial)", () => {
    expect(() => registerTemplate("", "内容")).toThrow("template name must not be empty")
    expect(() => registerTemplate("shell-empty", "   ")).toThrow("template shell-empty must not be empty")
    expect(() => registerTemplate("_partials", "## x\n内容")).toThrow(/whole-file registration is not accepted/)
    expect(() => registerTemplate("_partials", "## x\n内容")).toThrow(/registerPartial/)
  })
})

describe("片段按节注册(registerPartial,M1.3)", () => {
  test("注册共享片段节: 即时可渲染并跨 usePromptLibrary 重载保留", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerPartial("shell-note", "外壳注记: {{topic}}")
      expect(renderText("{{> shell-note}}", { topic: "甲" })).toBe("外壳注记: 甲")
      usePromptLibrary(dir)
      expect(renderText("{{> shell-note}}", { topic: "乙" })).toBe("外壳注记: 乙")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      usePromptLibrary(undefined)
      registerPartial("shell-note", "复位")
      usePromptLibrary(undefined)
    }
  })

  test("与内置节同名时注册内容生效,目标目录 _partials.md 覆盖仍最高优先", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const builtin = renderText("{{> digest-rule}}", {})
      registerPartial("digest-rule", "注册版引用纪律")
      expect(renderText("{{> digest-rule}}", {})).toBe("注册版引用纪律")
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "_partials.md"), "## digest-rule\n用户覆盖版引用纪律。")
      usePromptLibrary(dir)
      expect(renderText("{{> digest-rule}}", {})).toBe("用户覆盖版引用纪律。")
      // 复位内置节文案,防跨测试文件污染
      usePromptLibrary(undefined)
      registerPartial("digest-rule", builtin)
      usePromptLibrary(undefined)
      expect(renderText("{{> digest-rule}}", {})).toBe(builtin)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("带 markers 注册: 目标目录覆盖该节缺失标记时报错", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerPartial("shell-rule", "外壳协议片段: KEEP-ME", ["KEEP-ME"])
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "_partials.md"), "## shell-rule\n覆盖版丢了锚点。")
      expect(() => usePromptLibrary(dir)).toThrow(/section shell-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/KEEP-ME/)
      writeFileSync(join(overlay, "_partials.md"), "## shell-rule\n覆盖版保留 KEEP-ME 锚点。")
      usePromptLibrary(dir)
      expect(renderText("{{> shell-rule}}", {})).toBe("覆盖版保留 KEEP-ME 锚点。")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      usePromptLibrary(undefined)
      registerPartial("shell-rule", "复位")
      usePromptLibrary(undefined)
    }
  })

  test("空片段名 / 空内容拒绝", () => {
    expect(() => registerPartial("", "内容")).toThrow("partial name must not be empty")
    expect(() => registerPartial("shell-empty-partial", "   ")).toThrow("partial shell-empty-partial must not be empty")
  })
})
