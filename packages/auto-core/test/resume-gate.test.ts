// src/resume-gate.ts 的单测: 恢复点单元归属门禁(unitReruns/phaseText)与中断恢复说明(resumeNote)。
// 拆分自 test/runner.test.ts(docs/module-split-plan.md S18,纯搬运)。

import { describe, expect, test } from "bun:test"
import type { Phase } from "../src/resume"
import { phaseText, resumeNote, unitReruns, type UnitRerunCtx } from "../src/resume-gate"

describe("unitReruns(恢复点的单元归属门禁: 仅当所属单元将重跑才允许复用)", () => {
  const ctx = (over: Partial<UnitRerunCtx> = {}): UnitRerunCtx => ({
    mode: "auto",
    fork: true,
    items: [{ text: "第一项", done: true }, { text: "第二项", done: false }, { text: "第三项", done: false }],
    contextExists: false,
    subtasksFileItems: 0,
    wrapup: true,
    verify: true,
    review: true,
    ...over,
  })

  test("subtasks: 归属序号恰为首个未勾选项才可复用;已勾选(间歇期中断)/缺序号(老记录)/越界均否", () => {
    expect(unitReruns({ kind: "subtasks", index: 2 }, ctx())).toBe(true)
    expect(unitReruns({ kind: "subtasks", index: 1 }, ctx())).toBe(false) // 中断于子任务 1 收口后的间歇
    expect(unitReruns({ kind: "subtasks", index: 3 }, ctx())).toBe(false)
    expect(unitReruns({ kind: "subtasks" }, ctx())).toBe(false) // 老版本无序号记录: 无法判定归属
    expect(unitReruns({ kind: "subtasks", index: 9 }, ctx())).toBe(false)
  })

  test("understand/decompose: 产物已出现(摘要在位/检查项已注入)使单元幂等跳过 → 不复用", () => {
    const noItems = ctx({ items: [] })
    expect(unitReruns({ kind: "understand" }, noItems)).toBe(true)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [] }))).toBe(true)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [], contextExists: true }))).toBe(false)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [], fork: false }))).toBe(false)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [], mode: "off" }))).toBe(false)
    // decompose: 理解单元将先跑(摘要缺失)时,分解会话不是首个消费链的单元
    expect(unitReruns({ kind: "decompose" }, noItems)).toBe(false)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], contextExists: true }))).toBe(true)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], fork: false }))).toBe(true)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], subtasksFileItems: 3, contextExists: true }))).toBe(false)
    // 已有检查项时两个前置单元都不再跑
    expect(unitReruns({ kind: "understand" }, ctx())).toBe(false)
    expect(unitReruns({ kind: "decompose" }, ctx())).toBe(false)
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

  test("verify/review: active 记录只会是链上修复会话;旁路阶段与开关关闭均不复用", () => {
    const fix = { kind: "verify", stage: "fix", round: 1, rechecks: 0, replaced: false } as const
    expect(unitReruns(fix, ctx())).toBe(true)
    expect(unitReruns(fix, ctx({ verify: false }))).toBe(false)
    expect(unitReruns({ kind: "verify", stage: "judge", round: 1, rechecks: 0, replaced: false }, ctx())).toBe(false)
    const fixrun = { kind: "review", round: 1, stage: "fixrun", index: 2 } as const
    expect(unitReruns(fixrun, ctx())).toBe(true)
    expect(unitReruns(fixrun, ctx({ review: false }))).toBe(false)
    expect(unitReruns({ kind: "review", round: 1, stage: "fixrun", index: 1 }, ctx())).toBe(false)
    expect(unitReruns({ kind: "review", round: 1, stage: "fixrun" }, ctx())).toBe(false) // 老记录无序号
    expect(unitReruns({ kind: "review", round: 1, stage: "audit" }, ctx())).toBe(false) // 旁路会话重跑恒新建
  })

  test("无阶段(旧版 session.json)无法判定归属 → 不复用;step 记录不归本门禁", () => {
    expect(unitReruns(undefined, ctx())).toBe(false)
    expect(unitReruns({ kind: "step", step: "phase-plan", letter: "m" }, ctx())).toBe(true)
  })

  test("phaseText 的 subtasks 文案带归属序号", () => {
    expect(phaseText({ kind: "subtasks", index: 2 })).toBe("逐子任务执行阶段(中断于子任务 2,从首个未勾选项继续)")
    expect(phaseText({ kind: "subtasks" })).toBe("逐子任务执行阶段(从首个未勾选项继续)")
  })
})

// ---- 恢复保真(session-recovery-fidelity-design.md 3.2/3.1/3.3)----

describe("resumeNote(中断恢复说明)", () => {
  const subtasks: Phase = { kind: "subtasks", index: 2 }
  const planStep: Phase = { kind: "step", step: "phase-plan", letter: "m" }
  const ONE_LINE = "[driver] 会话曾中断,请继续当前工作直至本单元完成。"

  test("严格恢复门禁在位 + 复用原会话 → 收敛为一句 continue(3.2)", () => {
    expect(resumeNote(subtasks, true, true)).toBe(ONE_LINE)
    expect(resumeNote(planStep, true, true)).toBe(ONE_LINE)
    expect(resumeNote(undefined, true, true)).toBe(ONE_LINE)
  })

  test("门禁不在位(缺省 off / dryrun)→ 复用路径维持既有按阶段指引", () => {
    const note = resumeNote(subtasks, true, false)
    expect(note).not.toBe(ONE_LINE)
    expect(note).toContain("你正在原来中断的会话中继续")
    expect(note).toContain("首个未勾选项")
  })

  test("非复用路径(总结态续跑)恒给按阶段指引,不受严格恢复影响", () => {
    const note = resumeNote(subtasks, false, true)
    expect(note).toContain("部分工作可能已完成")
    expect(note).toContain("首个未勾选项")
    const step = resumeNote({ kind: "step", step: "phase-handover", letter: "t" }, false, true)
    expect(step).toContain("本阶段步骤")
    expect(step).toContain("四个必备小节")
  })
})
