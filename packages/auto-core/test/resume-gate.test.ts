// src/resume-gate.ts 的单测: 恢复点单元归属门禁(unitReruns/phaseText)与中断恢复说明(resumeNote)。
// 拆分自 test/runner.test.ts(plans/0024-module-split-plan.md S18,纯搬运)。

import { describe, expect, test } from "bun:test"
import type { Phase } from "../src/resume"
import { phaseText, resumeNote, unitReruns, type UnitRerunCtx } from "../src/resume-gate"

describe("unitReruns(恢复点的单元归属门禁: 仅当所属单元将重跑才允许复用)", () => {
  const ctx = (over: Partial<UnitRerunCtx> = {}): UnitRerunCtx => ({
    mode: "auto",
    fork: true,
    items: [{ text: "第一项", done: true }, { text: "第二项", done: false }, { text: "第三项", done: false }],
    subtasksFileItems: 0,
    wrapup: true,
    ...over,
  })

  test("subtasks: 归属序号恰为首个未勾选项才可复用;已勾选(间歇期中断)/缺序号(老记录)/越界均否", () => {
    expect(unitReruns({ kind: "subtasks", index: 2 }, ctx())).toBe(true)
    expect(unitReruns({ kind: "subtasks", index: 1 }, ctx())).toBe(false) // 中断于子任务 1 收口后的间歇
    expect(unitReruns({ kind: "subtasks", index: 3 }, ctx())).toBe(false)
    expect(unitReruns({ kind: "subtasks" }, ctx())).toBe(false) // 老版本无序号记录: 无法判定归属
    expect(unitReruns({ kind: "subtasks", index: 9 }, ctx())).toBe(false)
  })

  test("subtasks (M3.5): ownership follows the dependency order, not the first unticked item", () => {
    const items = [
      { text: "one", done: true },
      { text: "two", done: false, depends: ["S03"] },
      { text: "three", done: false, depends: "none" as const },
    ]
    expect(unitReruns({ kind: "subtasks", index: 3 }, ctx({ items }))).toBe(true)
    expect(unitReruns({ kind: "subtasks", index: 2 }, ctx({ items }))).toBe(false)
  })

  test("decompose(合并理解与分解单元,M1.0): 检查项已注入或 subtasks.md 已有检查项使单元幂等跳过 → 不复用", () => {
    // 检查项未注入且 subtasks.md 无检查项 → 合并单元将重跑,允许复用(fork 开关无关)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [] }))).toBe(true)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], fork: false }))).toBe(true)
    // subtasks.md 已有检查项 → 直注路径,合并会话不重跑
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], subtasksFileItems: 3 }))).toBe(false)
    // 已有检查项 / 非 auto 模式 → 单元不跑
    expect(unitReruns({ kind: "decompose" }, ctx())).toBe(false)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], mode: "off" }))).toBe(false)
  })

  test("whole/wrapup: 模式或配置使单元不跑 → 不复用;wrapup 要求检查项已全部勾完", () => {
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "off" }))).toBe(true)
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "ondemand" }))).toBe(true)
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "auto" }))).toBe(false)
    const done = ctx({ items: [{ text: "唯一项", done: true }] })
    expect(unitReruns({ kind: "wrapup" }, done)).toBe(true)
    expect(unitReruns({ kind: "wrapup" }, ctx())).toBe(false) // 尚有未勾项,下一个单元是子任务
    expect(unitReruns({ kind: "wrapup" }, ctx({ items: [], wrapup: false }))).toBe(false)
  })

  test("closeout: 结论行检查与完成标记由 driver 承担,没有可复用的会话", () => {
    expect(unitReruns({ kind: "closeout" }, ctx({ items: [{ text: "唯一项", done: true }] }))).toBe(false)
  })

  test("无阶段(旧版 session.json)无法判定归属 → 不复用;step 记录不归本门禁", () => {
    expect(unitReruns(undefined, ctx())).toBe(false)
    expect(unitReruns({ kind: "step", step: "phase-plan", unit: "R-01.P01" }, ctx())).toBe(true)
  })

  test("phaseText 的 subtasks 文案带归属序号", () => {
    expect(phaseText({ kind: "subtasks", index: 2 })).toBe("逐子任务执行阶段(中断于子任务 2,从首个未勾选项继续)")
    expect(phaseText({ kind: "subtasks" })).toBe("逐子任务执行阶段(从首个未勾选项继续)")
  })
})

// ---- 恢复保真(plans/0022-session-recovery-fidelity-design.md 3.2/3.1/3.3)----

describe("resumeNote(中断恢复说明)", () => {
  const subtasks: Phase = { kind: "subtasks", index: 2 }
  const planStep: Phase = { kind: "step", step: "phase-plan", unit: "R-01.P01" }
  const ONE_LINE =
    "[DRIVER] 会话曾中断,请继续当前工作直至本单元完成。中断前落盘的修改若已不在工作区,即已由 DRIVER 统一提交进 Git——以 git log 核实,不要重做。"

  test("严格恢复门禁在位 + 复用原会话 → 收敛为一句 continue(3.2),附带提交语义澄清", () => {
    expect(resumeNote(subtasks, true, true)).toBe(ONE_LINE)
    expect(resumeNote(planStep, true, true)).toBe(ONE_LINE)
    expect(resumeNote(undefined, true, true)).toBe(ONE_LINE)
  })

  test("门禁不在位(缺省 off / dryrun)→ 复用路径维持既有按阶段指引", () => {
    const note = resumeNote(subtasks, true, false)
    expect(note).not.toBe(ONE_LINE)
    expect(note).toContain("你正在原来中断的会话中继续")
    expect(note).toContain("首个未完成项")
  })

  test("非复用路径(总结态续跑)恒给按阶段指引,不受严格恢复影响", () => {
    const note = resumeNote(subtasks, false, true)
    expect(note).toContain("部分工作可能已完成")
    expect(note).toContain("首个未完成项")
    const step = resumeNote({ kind: "step", step: "phase-handover", unit: "R-01.P01" }, false, true)
    expect(step).toContain("本阶段步骤")
    expect(step).toContain("四个必备小节")
  })

  test("提交语义澄清: 非一句 continue 的路径都说明「陌生提交/干净工作区 ≠ 修改丢失」", () => {
    // 中断恢复时 AI 以 git 核对盘面,driver 统一提交(定版/交接/单元收口)或人工
    // 处置提交会被误读为修改丢失而重做——澄清句必须在场(2026-09-17)。
    for (const note of [
      resumeNote(subtasks, true, false),
      resumeNote(subtasks, false, false),
      resumeNote({ kind: "step", step: "phase-plan", unit: "R-01.P01" }, true, false),
    ]) {
      expect(note).toContain("不代表修改丢失")
      expect(note).toContain("DRIVER 统一提交")
    }
  })
})
