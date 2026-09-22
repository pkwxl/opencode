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

  test("save → recall 往返;forget 后不可 recall", async () => {
    const progress: Progress = { task: "T-001", session: "ses_abc", at: Date.now(), active: true, phase: { kind: "subtasks" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
    await forgetProgress(dir)
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
  })

  test("recall 不校验存活与时龄(任意久远的记录仍返回,存活判定在 runner)", async () => {
    await saveProgress(dir, {
      task: "T-001",
      session: "ses_old",
      at: 0,
      active: true,
      phase: { kind: "wrapup" },
    })
    expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_old")
  })

  test("旧版 understand 阶段记录(M1.0 前)读取时映射为合并的 decompose 阶段(plans/0030 D2)", async () => {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(
      join(dir, ".auto", "progress.json"),
      JSON.stringify({ task: "T-001", session: "ses_understand", at: 7, active: true, phase: { kind: "understand" } }),
    )
    expect(await recallProgress(dir, "T-001")).toEqual({ task: "T-001", session: "ses_understand", at: 7, active: true, phase: { kind: "decompose" } })
  })

  test("subtasks 阶段记录的归属子任务序号 index 随记录往返", async () => {
    const progress: Progress = { task: "T-001", session: "ses_s2", at: Date.now(), active: true, phase: { kind: "subtasks", index: 2 } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
  })

  test("已退役的 verify/review 阶段记录(plans/0044 D5)读取时映射为 closeout: 收尾已完成,只剩结论行检查与完成", async () => {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(join(dir, ".auto"), { recursive: true })
    for (const phase of [
      { kind: "verify", stage: "fix", round: 2, rechecks: 0, replaced: false, gap: "构建失败" },
      { kind: "review", round: 1, stage: "fixrun", index: 2 },
    ]) {
      await Bun.write(join(dir, ".auto", "progress.json"), JSON.stringify({ task: "T-001", session: "ses_fix", at: 7, active: true, phase }))
      expect(await recallProgress(dir, "T-001")).toEqual({ task: "T-001", session: "ses_fix", at: 7, active: true, phase: { kind: "closeout" } })
    }
  })

  test("严格恢复字段(baseline/model)随记录往返;缺字段的旧记录两字段为 undefined", async () => {
    const progress: Progress = {
      task: "T-001",
      session: "ses_strict",
      at: 7,
      active: true,
      phase: { kind: "subtasks", index: 3 },
      baseline: [
        { root: "/tmp/target", sha: "abc1234" },
        { root: "/tmp/target/pkg", sha: "def5678" },
      ],
      model: "kimi/k2",
    }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
    // 严格恢复启用前写入的旧记录: 两字段缺失 → undefined(runner 据此判不可复用)
    await saveProgress(dir, { task: "T-002", session: "ses_old", at: 8, active: true, phase: { kind: "whole" } })
    const legacy = await recallProgress(dir, "T-002")
    expect(legacy?.baseline).toBeUndefined()
    expect(legacy?.model).toBeUndefined()
  })

  test("baseline/model 坏值容错: 非数组 → undefined,数组内缺 root/sha 的项被过滤,model 非字符串 → undefined", async () => {
    await Bun.write(
      join(dir, ".auto", "progress.json"),
      JSON.stringify({ task: "T-003", at: 1, active: true, baseline: "abc1234", model: 42 }),
    )
    const bad = await recallProgress(dir, "T-003")
    expect(bad?.baseline).toBeUndefined()
    expect(bad?.model).toBeUndefined()
    await Bun.write(
      join(dir, ".auto", "progress.json"),
      JSON.stringify({
        task: "T-003",
        at: 1,
        active: true,
        baseline: [{ root: "/tmp/a", sha: "abc1234" }, { root: "/tmp/b" }, { sha: "def5678" }, null],
      }),
    )
    expect((await recallProgress(dir, "T-003"))?.baseline).toEqual([{ root: "/tmp/a", sha: "abc1234" }])
  })

  test("任务不符、文件缺失或损坏返回 undefined", async () => {
    await saveProgress(dir, { task: "T-001", at: Date.now(), active: false })
    expect(await recallProgress(dir, "T-002")).toBeUndefined()
    await forgetProgress(dir)
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
    await Bun.write(join(dir, ".auto", "progress.json"), "{not json")
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
  })

  test("旧版 .auto/session.json 不再读取(M3.7 退役)", async () => {
    await Bun.write(join(dir, ".auto", "session.json"), JSON.stringify({ task: "T-001", session: "ses_old", at: 123 }))
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
    expect(await peekProgress(dir)).toBeUndefined()
  })

  test("peek 不分任务返回当前记录;缺失时为 undefined", async () => {
    expect(await peekProgress(dir)).toBeUndefined()
    await saveProgress(dir, { task: "T-003", at: Date.now(), active: false, phase: { kind: "closeout" } })
    expect(await peekProgress(dir)).toEqual({ task: "T-003", session: undefined, at: expect.any(Number), active: false, phase: { kind: "closeout" } })
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
    const progress: Progress = { task: "PLAN", session: "ses_plan", at: 5, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "PLAN")).toEqual(progress)
    expect(await openStep(dir)).toEqual({ step: "phase-plan", unit: "R-01.P01", session: "ses_plan" })
  })

  test("openStep: 已收口(active=false)、非 step 记录、无记录均返回 undefined", async () => {
    await saveProgress(dir, { task: "PLAN", session: "s", at: 1, active: false, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
    expect(await openStep(dir)).toBeUndefined()
    await saveProgress(dir, { task: "T-001", session: "s", at: 1, active: true, phase: { kind: "subtasks" } })
    expect(await openStep(dir)).toBeUndefined()
    await forgetProgress(dir)
    expect(await openStep(dir)).toBeUndefined()
  })

  test("closeStep: 步骤/阶段单元匹配才删除;不匹配则保留", async () => {
    await saveProgress(dir, { task: "PLAN", session: "s", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
    await closeStep(dir, "phase-handover", "R-01.P01")
    expect(await openStep(dir)).toBeDefined()
    // Same type in another phase or round is another unit (M3.6: types may repeat)
    await closeStep(dir, "phase-plan", "R-01.P03")
    await closeStep(dir, "phase-plan", "R-02.P01")
    expect(await openStep(dir)).toBeDefined()
    await closeStep(dir, "phase-plan", "R-01.P01")
    expect(await openStep(dir)).toBeUndefined()
    expect(await peekProgress(dir)).toBeUndefined()
  })

  test("closeStep: 当前是任务记录(非本步骤)时不误删", async () => {
    await saveProgress(dir, { task: "T-009", session: "s", at: 1, active: true, phase: { kind: "subtasks" } })
    await closeStep(dir, "phase-plan", "m")
    expect((await peekProgress(dir))?.task).toBe("T-009")
  })
})
