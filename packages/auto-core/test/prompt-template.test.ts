// src/prompt.ts 与模板机制的单测: question-rule 片段、digest-rule 片段、模式注入、init 产物模板、agent 契约模板、渲染完整性。
// 拆分自 test/prompt.test.ts(plans/0024-module-split-plan.md S19,纯搬运)。

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderAgentContract } from "../src/loop-preflight"
import {
  DECISION_FORMAT,
  modeCtx,
  promptCtx,
  RESOLVE_FORMAT,
  renderDecompose,
  renderDryrun,
  renderHandoffSteer,
  renderInferSource,
  renderKnowledge,
  renderPriorKnowledge,
  renderSubtask,
  renderTestContinue,
  renderTestResult,
  renderTestWrapup,
  renderWhole,
  renderWrapup,
} from "../src/prompt"
import { autoSwitches } from "../src/switches"
import { renderTemplate, renderText, usePromptLibrary } from "../src/template"
import agentTemplate from "../templates/.opencode/agent/auto.md" with { type: "file" }
import planTemplate from "../templates/PLAN.md" with { type: "file" }
import { listPlan, listTask, migrate, plan, resolveItem, task } from "./fixtures/prompt"

describe("question-rule 片段与提问策略接线(OPENCODE_AUTO_ASK,plans/0020-auto-resolve-design.md §E)", () => {
  const prompts = join(import.meta.dir, "..", "templates", "prompts")
  const consumers = readdirSync(prompts)
    .filter((name) => name.endsWith(".md") && name !== "_partials.md")
    .filter((name) => readFileSync(join(prompts, name), "utf8").includes("{{> question-rule}}"))
    .sort()

  test("引用该片段的模板恰为 16 份(勘测结论 §J-3,M1.0 合并 understand 后 -1,M2.2 退役六份 -6;新增引用需同步设计文档)", () => {
    expect(consumers.length).toBe(16)
    expect(consumers).toContain("decompose-m.md")
    expect(consumers).toContain("whole.md")
    expect(consumers).toContain("subtask.md")
    // wrapup 不引用该片段(收尾会话不提问);T-007 的 "Proxy-answered questions" 节是独立条件段
    expect(consumers).not.toContain("wrapup.md")
  })

  // Rendered through the exit's context completion (M2.1): the ownership catalog
  // and recording discipline come from the built-in pack's `## governance`.
  const fragment = (ask: boolean) => renderText("{{> question-rule}}", promptCtx({ ask }))

  // 历史标记读取方模板: 它们要求会话汇总既有文档里 AUTO-DECISION 标记的决策,
  // 与"本次是否留痕"无关(历史标记在 git 里恒存),故 on 档下照常出现该字样。
  const historyReaders = ["knowledge.md", "prior-knowledge.md", "phase-handover.md"]

  test("off 档(缺省): 保留现状的不提问口径,并按归属判据要求两类标注", () => {
    const off = fragment(false)
    expect(off).toContain("do not call the question tool")
    expect(off).toContain("must leave a record of how it was made")
    expect(off).toContain("AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)")
    expect(off).toContain("AUTO-DECISION: <decision> (<reason>)")
    // 判别硬判据与正反例(设计文档 §C): 拿不准倒向 AUTO-RESOLVE
    expect(off).toContain("The call should have been the user's")
    expect(off).toContain("The call was always yours")
    expect(off).toContain("when unsure use AUTO-RESOLVE")
    expect(off).toContain("matched or paired")
  })

  test("on 档: 归属于用户的分歧点主动发问,且全片段不出现 AUTO-DECISION 字样", () => {
    const on = fragment(true)
    expect(on).toContain("instead of deciding in the user's place")
    expect(on).toContain("The call should have been the user's")
    expect(on).toContain("decide it yourself, no record required")
    expect(on).toContain("when unsure, ask")
    // 不提标注 = 不给会话出于惯性继续留痕的由头(设计文档 §K-4)
    expect(on).not.toContain("AUTO-DECISION")
    expect(on).not.toContain("AUTO-RESOLVE")
    expect(on).not.toContain("do not call the question tool")
  })

  // M2.1 zero-intent baseline: with no `## governance` catalog, the partial's
  // core fallback still carries the tool protocol and — off only — the two
  // driver-scanned marker formats (tier-1), which must equal the formats the
  // pack text receives as variables, so there is one wording of each.
  test("zero-intent fallback (M2.1): governance hook absent keeps protocol + marker formats", () => {
    const off = renderText("{{> question-rule}}", { ask: false })
    expect(off).toContain("do not call the question tool")
    expect(off).toContain(RESOLVE_FORMAT)
    expect(off).toContain(DECISION_FORMAT)
    expect(off).not.toContain("The call should have been the user's")
    const on = renderText("{{> question-rule}}", { ask: true })
    expect(on).toContain("ask with the question tool when the call should have been the user's")
    expect(on).not.toContain("AUTO-")
    expect(fragment(false)).toContain(RESOLVE_FORMAT)
    expect(fragment(false)).toContain(DECISION_FORMAT)
  })

  test("两档结构不变式: 各自恰好一条编号 2 的约束项,首尾不引入空行", () => {
    for (const ask of [false, true]) {
      const text = fragment(ask)
      expect(text.startsWith("2. ")).toBe(true)
      expect(text.endsWith("\n")).toBe(false)
      // 片段落在各模板的 "1." 与 "3." 之间,顶格编号行必须只有这一条
      expect(text.split("\n").filter((line) => /^\d+\. /.test(line))).toHaveLength(1)
      expect(text).not.toContain("\n\n")
    }
  })

  test("23 份消费模板在两档下均渲染通过(片段改动波及全部引用方)", () => {
    for (const ask of [false, true]) {
      for (const name of consumers) {
        const rendered = renderTemplate(name.replace(/\.md$/, ""), { ask })
        expect(rendered).toContain("question tool")
      }
    }
  })

  test("on 档下执行类模板整体不含 AUTO-DECISION(历史标记读取方除外)", () => {
    for (const name of consumers.filter((item) => !historyReaders.includes(item))) {
      expect(renderTemplate(name.replace(/\.md$/, ""), { ask: true })).not.toContain("AUTO-DECISION")
    }
    // off 档下 whole/subtask 的 docs/ 修改条款仍点名 AUTO-DECISION(逐字保留现状口径)
    expect(renderTemplate("whole", { ask: false })).toContain("annotate it as AUTO-DECISION and record it in the relevant document")
    expect(renderTemplate("subtask", { ask: false })).toContain("annotate it as AUTO-DECISION and record it in the relevant document")
    expect(renderTemplate("whole", { ask: true })).toContain("if a modification is unavoidable, record it in the relevant document")
  })

  test("渲染出口注入 ask: 覆盖片段后按开关取值渲染条件段(缺省 off 走 off 分支)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-ask-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(
        join(overlay, "_partials.md"),
        "# 覆盖\n\n## question-rule\nquestion tool AUTO-RESOLVE AUTO-DECISION {{#if ask}}ASK-ON-BRANCH{{/if}}{{^ask}}ASK-OFF-BRANCH{{/if}}\n",
      )
      usePromptLibrary(dir)
      // 测试进程未设 OPENCODE_AUTO_ASK,autoSwitches().ask === false —— 出口注入
      // 的是开关值而非 undefined,故走 off 分支而不是两个分支都消失。
      expect(autoSwitches().ask).toBe(false)
      const text = renderWhole(plan, task)
      expect(text).toContain("ASK-OFF-BRANCH")
      expect(text).not.toContain("ASK-ON-BRANCH")
      // 调用点显式给出的 ask 优先于开关(单测直驱两档的口径)
      expect(renderText("{{#if ask}}ON{{/if}}{{^ask}}OFF{{/if}}", { ask: true })).toBe("ON")
    } finally {
      usePromptLibrary(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("digest-rule 片段与跨任务引用纪律(L2,plans/0026-session-boundary-hardening-design.md §4.2)", () => {
  const prompts = join(import.meta.dir, "..", "templates", "prompts")
  const consumers = readdirSync(prompts)
    .filter((name) => name.endsWith(".md") && name !== "_partials.md")
    .filter((name) => readFileSync(join(prompts, name), "utf8").includes("{{> digest-rule}}"))
    .sort()

  test("引用该片段的模板恰为 decompose 基础+六阶段变体共 7 份(M1.0 合并)", () => {
    expect(consumers).toEqual([
      "decompose-a.md",
      "decompose-d.md",
      "decompose-k.md",
      "decompose-m.md",
      "decompose-t.md",
      "decompose-v.md",
      "decompose.md",
    ])
    // 执行类模板不引用:subtask/whole 会话不写 digest,防误读由 L1 ground-state 接地覆盖
    expect(consumers).not.toContain("subtask.md")
    expect(consumers).not.toContain("whole.md")
  })

  test("片段三条纪律: 跨任务引用只指阶段级单源 / 收尾产物仅作格式模板定性 / 摘录优先不整文回源", () => {
    const text = renderText("{{> digest-rule}}", {})
    expect(text).toContain("Point cross-task references only at phase-level single sources (rulings/contracts/ledger)")
    expect(text).toContain("artifact of another, already completed task — format template only")
    expect(text).toContain("Excerpt the points you need instead of sending the reader back to a whole document")
    // 定性义务点名前序任务级收尾产物族(report/批记录/testhandoff)
    expect(text).toContain("report/batch record/testhandoff")
    // 背景行写明误读后果:前序完成叙事流入会被下游会话误读为本任务已完成
    expect(text).toContain("misreads it as a sign that this task is already done")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })

  test("7 份消费模板渲染含纪律段且不残留模板标签(片段改动波及全部引用方)", () => {
    for (const name of consumers) {
      const rendered = renderTemplate(name.replace(/\.md$/, ""), {})
      expect(rendered).toContain("Cross-task reference discipline")
      expect(rendered).toContain("format template only")
      expect(rendered).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("eof-rule 片段与文档终止符纪律(D4/D5,plans/0026-session-boundary-hardening-design.md §4.3/§4.5)", () => {
  const prompts = join(import.meta.dir, "..", "templates", "prompts")
  const consumers = readdirSync(prompts)
    .filter((name) => name.endsWith(".md") && name !== "_partials.md")
    .filter((name) => readFileSync(join(prompts, name), "utf8").includes("{{> eof-rule}}"))
    .sort()

  test("引用该片段的模板恰为 subtask + decompose 基础+六阶段变体 + wrapup 共 9 份(S3/S3b,M1.0 合并)", () => {
    expect(consumers).toEqual([
      "decompose-a.md",
      "decompose-d.md",
      "decompose-k.md",
      "decompose-m.md",
      "decompose-t.md",
      "decompose-v.md",
      "decompose.md",
      "subtask.md",
      "wrapup.md",
    ])
  })

  test("片段内容: 终止符形态与独占末行要求,存量文档不回补", () => {
    const text = renderText("{{> eof-rule}}", {})
    expect(text).toContain("<!-- auto: eof -->")
    expect(text).toContain("as its last line of body text")
    expect(text).toContain("documents that already existed beforehand need no retrofit")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })

  test("消费模板渲染含终止符纪律段(subtask/decompose/wrapup 三类自动会话,M1.0 合并)", () => {
    for (const rendered of [
      renderSubtask(plan, task, "编写迁移脚本的 schema 部分"),
      renderDecompose(plan, task),
      renderWrapup(plan, task),
    ]) {
      expect(rendered).toContain("Document terminator discipline")
      expect(rendered).toContain("<!-- auto: eof -->")
      expect(rendered).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("模式注入(-m/--mode)", () => {
  test("执行类模板注入 exec 段;不传模式时不注入", () => {
    for (const text of [
      renderDecompose(plan, task, { mode: migrate }),
      renderSubtask(plan, task, "编写迁移脚本的 schema 部分", { mode: migrate }),
      renderWrapup(plan, task, { mode: migrate }),
      renderWhole(plan, task, { mode: migrate }),
    ]) {
      expect(text).toContain("(migrate):")
      expect(text).toContain("behaviourally equivalent")
      expect(text).toContain("AUTO-DECISION")
    }
    expect(renderDecompose(plan, task)).not.toContain("Scenario mode notes")
    expect(renderSubtask(plan, task, "编写迁移脚本的 schema 部分")).not.toContain("Scenario mode notes")
    expect(renderWrapup(plan, task)).not.toContain("场景模式注意事项")
    expect(renderWhole(plan, task)).not.toContain("场景模式注意事项")
  })

  test("modeCtx: 共享模式变量组装(壳层自写 render* 的扩展点)与缺省形态", () => {
    const ctx = modeCtx(migrate)
    expect(ctx.modeName).toBe("migrate")
    expect(ctx.modeInit).toContain("baseline confirmation")
    expect(ctx.modeInit).not.toContain("verify field")
    expect(ctx.modeExec).toContain("behaviourally equivalent")
    expect(modeCtx()).toEqual({ modeName: undefined, modeInit: undefined, modeExec: undefined })
  })
})

describe("init 产物模板(PLAN.md / agent 契约)", () => {
  test("PLAN.md 不含 verify 字段示例与验证原则描述(verify 已退役)", async () => {
    const text = renderText(await Bun.file(planTemplate).text(), {})
    expect(text).toContain("## T-001: <任务标题> [pending]")
    expect(text).toContain("<任务描述:目标、范围、关键约束。")
    expect(text).toContain("不要手工编写子任务")
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验证")
    expect(text).not.toContain("opencode-auto check")
  })

  test("agent 契约不含验收/验证描述,标记块列举相应收窄(testByDriver 关闭)", async () => {
    const raw = await Bun.file(agentTemplate).text()
    const off = renderText(raw, { testByDriver: false })
    expect(off).toContain("AGENTS.md 不在只读之列")
    expect(off).toContain("不得删除或改写 opencode-auto")
    expect(off).toContain("标记块(指针/提交/摘要/维护规则/引用规范")
    expect(off).toContain("<!-- opencode-auto:start -->")
    expect(off).toContain("<!-- opencode-auto:end -->")
    expect(off).toContain("遵守块内的 AGENTS.md 维护规则")
    expect(off).not.toContain("verify")
    expect(off).not.toContain("验证")
  })
})

describe("agent 契约模板(templates/.opencode/agent/auto.md)", () => {
  test("一致性比对口径 = 写入口径:两态渲染文本与原始模板互不相等(含条件块),两态渲染与 renderText 直渲一致", async () => {
    const raw = await Bun.file(agentTemplate).text()
    expect(raw).toContain("{{#if testByDriver}}")
    expect(raw).not.toContain("{{#if verify}}")
    for (const testByDriver of [true, false]) {
      const rendered = await renderAgentContract(testByDriver)
      expect(rendered).toBe(renderText(raw, { testByDriver }))
      expect(rendered).not.toBe(raw)
    }
  })
  test("AGENTS.md 条款覆盖 opencode-auto 单一标记块并引用维护规则(防漂移,testByDriver 启用)", async () => {
    const raw = await Bun.file(agentTemplate).text()
    const text = renderText(raw, { testByDriver: true })
    expect(text).toContain("AGENTS.md 不在只读之列")
    // 不得删除或改写 opencode-auto 标记块(指针/测试/提交/摘要/维护规则/引用规范),
    // 合并为单一 start/end 块,而非旧版按名各自独立的多个标记块
    expect(text).toContain("不得删除或改写 opencode-auto")
    expect(text).toContain("标记块(指针/测试/提交/摘要/维护规则/引用规范")
    expect(text).toContain("<!-- opencode-auto:start -->")
    expect(text).toContain("<!-- opencode-auto:end -->")
    expect(text).not.toContain("<!-- opencode-auto:*:start -->")
    expect(text).not.toContain("不得删除 opencode-auto 指针块")
    // 更新其余内容时遵守块内的维护规则(精简/路由/更新不追加/只沉淀持久知识)
    expect(text).toContain("遵守块内的 AGENTS.md 维护规则")
    expect(text).toContain("docs/agents/")
    expect(text).toContain("保持精简")
    expect(text).toContain("更新不追加")
    expect(text).toContain("只沉淀持久工作流知识")
  })
})

describe("模板渲染完整性", () => {
  test("全部 render* 在代表性参数组合下渲染后不残留模板标签", () => {
    const solo = plan.tasks[0]!
    const texts = [
      renderDecompose(plan, task),
      renderDecompose(plan, task, { mode: migrate }),
      renderSubtask(plan, task, "子任务甲"),
      renderSubtask(plan, task, "子任务甲", { mode: migrate }),
      renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2, warm: true, mode: migrate }),
      renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2, continuation: true }),
      renderWrapup(plan, task),
      renderWrapup(plan, task, { solo: true, mode: migrate }),
      renderWrapup(plan, task, { resolves: [resolveItem("是否把第三份实现一并收口?")] }),
      renderWhole(plan, task, { ondemand: true, continuation: true, mode: migrate }),
      renderHandoffSteer(task),
      renderTestResult({ script: "/s", code: 0, ms: 9, timedOut: false, out: "/o", seq: 1 }),
      renderTestWrapup({ handoffFile: "/h" }),
      renderTestContinue({ handoffFile: "docs/T-002/testhandoff.md", run: { script: "/s", code: 1, ms: 9, timedOut: false, out: "/o", seq: 2 }, stuck: 11 }),
      renderKnowledge({ file: "docs/R-01/P03-knowledge/kb.md", mode: migrate }),
      renderPriorKnowledge({ file: "docs/prior-kb/prior-x.md", brief: "意图", mode: migrate }),
      renderPriorKnowledge({ file: "docs/prior-kb/prior-x.md" }),
      renderPriorKnowledge({ file: "docs/prior-kb/prior-x.md", distilled: ["docs/R-01/P02-implement/handover.md"] }),
      renderInferSource({ file: ".auto/infer.json", brief: "意图", priorKb: "- docs/prior-kb/prior-x.md", known: "- 迁移目标目录: target" }),
      renderInferSource({ file: ".auto/infer.json" }),
      renderDryrun(),
      renderDecompose(plan, solo),
      renderHandoffSteer(solo),
    ]
    for (const text of texts) expect(text).not.toMatch(/\{\{|\}\}/)
  })

  test("init 产物模板按 testByDriver 两态渲染后不残留模板标签", async () => {
    for (const raw of [await Bun.file(planTemplate).text(), await Bun.file(agentTemplate).text()]) {
      for (const testByDriver of [true, false]) {
        expect(renderText(raw, { testByDriver })).not.toMatch(/\{\{|\}\}/)
      }
    }
  })
})
