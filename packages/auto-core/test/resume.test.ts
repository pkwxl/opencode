import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeStep, forgetProgress, openStep, peekProgress, recallProgress, saveProgress, type Progress } from "../src/resume"

describe("进度记录", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resume-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("save → recall 往返;forget 后不可 recall,连同旧版文件一起清理", async () => {
    const progress: Progress = { task: "T-001", session: "ses_abc", at: Date.now(), active: true, phase: { kind: "subtasks" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
    await Bun.write(join(dir, ".auto", "session.json"), "{}")
    await forgetProgress(dir)
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
    expect(await Bun.file(join(dir, ".auto", "session.json")).exists()).toBe(false)
  })

  test("recall 不校验存活与时龄(任意久远的记录仍返回,存活判定在 runner)", async () => {
    await saveProgress(dir, {
      task: "T-001",
      session: "ses_old",
      at: 0,
      active: true,
      phase: { kind: "verify", stage: "judge", round: 1, rechecks: 0, replaced: false },
    })
    expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_old")
  })

  test("understand 阶段记录(fork 流水线理解会话)随记录往返", async () => {
    const progress: Progress = { task: "T-001", session: "ses_understand", at: Date.now(), active: true, phase: { kind: "understand" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
  })

  test("verify 修复轮记录(stage=fix)的差距原文 gap 随记录往返", async () => {
    const progress: Progress = {
      task: "T-001",
      session: "ses_fix",
      at: Date.now(),
      active: true,
      phase: { kind: "verify", stage: "fix", round: 2, rechecks: 0, replaced: false, gap: "构建失败: 缺少依赖 x" },
    }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
  })

  test("任务不符、文件缺失或损坏返回 undefined", async () => {
    await saveProgress(dir, { task: "T-001", at: Date.now(), active: false })
    expect(await recallProgress(dir, "T-002")).toBeUndefined()
    await forgetProgress(dir)
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
    await Bun.write(join(dir, ".auto", "progress.json"), "{not json")
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
  })

  test("旧版 .auto/session.json 兼容: 视为半途会话(active,无阶段)", async () => {
    await Bun.write(join(dir, ".auto", "session.json"), JSON.stringify({ task: "T-001", session: "ses_old", at: 123 }))
    expect(await recallProgress(dir, "T-001")).toEqual({ task: "T-001", session: "ses_old", at: 123, active: true, phase: undefined })
    expect(await recallProgress(dir, "T-002")).toBeUndefined()
  })

  test("progress.json 存在时优先于旧版 session.json", async () => {
    await Bun.write(join(dir, ".auto", "session.json"), JSON.stringify({ task: "T-001", session: "ses_old", at: 1 }))
    await saveProgress(dir, { task: "T-002", session: "ses_new", at: 2, active: false, phase: { kind: "wrapup" } })
    expect((await peekProgress(dir))?.task).toBe("T-002")
  })

  test("peek 不分任务返回当前记录;缺失时为 undefined", async () => {
    expect(await peekProgress(dir)).toBeUndefined()
    await saveProgress(dir, { task: "T-003", at: Date.now(), active: false, phase: { kind: "review", round: 2, stage: "planfix" } })
    expect(await peekProgress(dir)).toEqual({ task: "T-003", session: undefined, at: expect.any(Number), active: false, phase: { kind: "review", round: 2, stage: "planfix" } })
  })

  test("forget 对缺失文件无害", async () => {
    await forgetProgress(dir)
  })
})

describe("阶段步骤恢复点(openStep/closeStep)", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-step-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("step 记录往返;openStep 返回未收口步骤的身份与会话", async () => {
    const progress: Progress = { task: "PLAN", session: "ses_plan", at: 5, active: true, phase: { kind: "step", step: "phase-plan", letter: "m" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "PLAN")).toEqual(progress)
    expect(await openStep(dir)).toEqual({ step: "phase-plan", letter: "m", session: "ses_plan" })
  })

  test("openStep: 已收口(active=false)、非 step 记录、无记录均返回 undefined", async () => {
    await saveProgress(dir, { task: "PLAN", session: "s", at: 1, active: false, phase: { kind: "step", step: "phase-plan", letter: "m" } })
    expect(await openStep(dir)).toBeUndefined()
    await saveProgress(dir, { task: "T-001", session: "s", at: 1, active: true, phase: { kind: "subtasks" } })
    expect(await openStep(dir)).toBeUndefined()
    await forgetProgress(dir)
    expect(await openStep(dir)).toBeUndefined()
  })

  test("closeStep: 步骤/字母匹配才删除;不匹配则保留", async () => {
    await saveProgress(dir, { task: "PLAN", session: "s", at: 1, active: true, phase: { kind: "step", step: "phase-plan", letter: "m" } })
    await closeStep(dir, "phase-handover", "m")
    expect(await openStep(dir)).toBeDefined()
    await closeStep(dir, "phase-plan", "d")
    expect(await openStep(dir)).toBeDefined()
    await closeStep(dir, "phase-plan", "m")
    expect(await openStep(dir)).toBeUndefined()
    expect(await peekProgress(dir)).toBeUndefined()
  })

  test("closeStep: 当前是任务记录(非本步骤)时不误删", async () => {
    await saveProgress(dir, { task: "T-009", session: "s", at: 1, active: true, phase: { kind: "subtasks" } })
    await closeStep(dir, "phase-plan", "m")
    expect((await peekProgress(dir))?.task).toBe("T-009")
  })
})
