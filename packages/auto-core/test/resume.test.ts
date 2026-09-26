import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeStep, forgetProgress, openStep, peekProgress, recallProgress, saveProgress, type Progress } from "../src/resume"

describe("progress record", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resume-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("save → recall round trip; not recallable after forget", async () => {
    const progress: Progress = { task: "T-001", session: "ses_abc", at: Date.now(), active: true, phase: { kind: "subtasks" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
    await forgetProgress(dir)
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
  })

  test("recall checks neither liveness nor age (an arbitrarily old record is still returned; the liveness decision lives in runner)", async () => {
    await saveProgress(dir, {
      task: "T-001",
      session: "ses_old",
      at: 0,
      active: true,
      phase: { kind: "wrapup" },
    })
    expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_old")
  })

  test("a legacy understand-phase record (pre-M1.0) maps on read to the merged decompose phase (plans/0030 D2)", async () => {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(
      join(dir, ".auto", "progress.json"),
      JSON.stringify({ task: "T-001", session: "ses_understand", at: 7, active: true, phase: { kind: "understand" } }),
    )
    expect(await recallProgress(dir, "T-001")).toEqual({ task: "T-001", session: "ses_understand", at: 7, active: true, phase: { kind: "decompose" } })
  })

  test("a subtasks-phase record's owning-subtask index round-trips with the record", async () => {
    const progress: Progress = { task: "T-001", session: "ses_s2", at: Date.now(), active: true, phase: { kind: "subtasks", index: 2 } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-001")).toEqual(progress)
  })

  test("retired verify/review phase records (plans/0044 D5) map on read to closeout: the wrap-up is done, only the verdict-line check and completion remain", async () => {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(join(dir, ".auto"), { recursive: true })
    for (const phase of [
      { kind: "verify", stage: "fix", round: 2, rechecks: 0, replaced: false, gap: "build failed" },
      { kind: "review", round: 1, stage: "fixrun", index: 2 },
    ]) {
      await Bun.write(join(dir, ".auto", "progress.json"), JSON.stringify({ task: "T-001", session: "ses_fix", at: 7, active: true, phase }))
      expect(await recallProgress(dir, "T-001")).toEqual({ task: "T-001", session: "ses_fix", at: 7, active: true, phase: { kind: "closeout" } })
    }
  })

  test("strict-resume fields (baseline/model) round-trip with the record; an old record missing them has both undefined", async () => {
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
    // An old record written before strict resume was enabled: both fields missing → undefined (runner judges it non-reusable on that basis)
    await saveProgress(dir, { task: "T-002", session: "ses_old", at: 8, active: true, phase: { kind: "whole" } })
    const legacy = await recallProgress(dir, "T-002")
    expect(legacy?.baseline).toBeUndefined()
    expect(legacy?.model).toBeUndefined()
  })

  // The session's agent profile (plans/0055 §8.2): written under a registry,
  // and an absent field is the default agent's — the reader (runner/artifact,
  // recordedAgentOk) resolves absent against the run's agent, so a pre-binding
  // record reads as the default agent's without a stored value.
  test("the session's agent profile round-trips with the record; an absent field (pre-binding old record) and a bad value are both undefined (= the default agent)", async () => {
    const progress: Progress = {
      task: "T-004",
      session: "ses_bound",
      at: 7,
      active: true,
      phase: { kind: "whole" },
      agent: "claude-b",
    }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "T-004")).toEqual(progress)
    expect((await recallProgress(dir, "T-004"))?.agent).toBe("claude-b")
    await saveProgress(dir, { task: "T-005", session: "ses_old", at: 8, active: true, phase: { kind: "whole" } })
    expect((await recallProgress(dir, "T-005"))?.agent).toBeUndefined()
    // Without the field the file stays byte-identical to the pre-binding
    // shape: the key is absent from the JSON, not stored as null.
    expect(await Bun.file(join(dir, ".auto", "progress.json")).text()).not.toContain("agent")
    await Bun.write(
      join(dir, ".auto", "progress.json"),
      JSON.stringify({ task: "T-006", session: "ses_bad", at: 1, active: true, agent: 42 }),
    )
    expect((await recallProgress(dir, "T-006"))?.agent).toBeUndefined()
  })

  test("baseline/model bad-value tolerance: non-array → undefined, entries in the array missing root/sha are filtered, non-string model → undefined", async () => {
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

  test("task mismatch, missing file, or corrupt file returns undefined", async () => {
    await saveProgress(dir, { task: "T-001", at: Date.now(), active: false })
    expect(await recallProgress(dir, "T-002")).toBeUndefined()
    await forgetProgress(dir)
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
    await Bun.write(join(dir, ".auto", "progress.json"), "{not json")
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
  })

  test("the legacy .auto/session.json is no longer read (retired M3.7)", async () => {
    await Bun.write(join(dir, ".auto", "session.json"), JSON.stringify({ task: "T-001", session: "ses_old", at: 123 }))
    expect(await recallProgress(dir, "T-001")).toBeUndefined()
    expect(await peekProgress(dir)).toBeUndefined()
  })

  test("peek returns the current record regardless of task; undefined when absent", async () => {
    expect(await peekProgress(dir)).toBeUndefined()
    await saveProgress(dir, { task: "T-003", at: Date.now(), active: false, phase: { kind: "closeout" } })
    expect(await peekProgress(dir)).toEqual({ task: "T-003", session: undefined, at: expect.any(Number), active: false, phase: { kind: "closeout" } })
  })

  test("forget is harmless on a missing file", async () => {
    await forgetProgress(dir)
  })
})

describe("phase-step recovery points (openStep/closeStep)", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-step-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("step record round trip; openStep returns the open step's identity and session", async () => {
    const progress: Progress = { task: "PLAN", session: "ses_plan", at: 5, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "PLAN")).toEqual(progress)
    expect(await openStep(dir)).toEqual({ step: "phase-plan", unit: "R-01.P01", session: "ses_plan" })
  })

  test("a phase-append step record (0053 D23) round-trips too; openStep returns its identity, parseProgress accepts it as is", async () => {
    const progress: Progress = { task: "PLAN", session: "ses_append", at: 5, active: true, phase: { kind: "step", step: "phase-append", unit: "R-01.P02" } }
    await saveProgress(dir, progress)
    expect(await recallProgress(dir, "PLAN")).toEqual(progress)
    expect(await openStep(dir)).toEqual({ step: "phase-append", unit: "R-01.P02", session: "ses_append" })
    // closeStep deletes by matching the step identity (same as phase-plan)
    await closeStep(dir, "phase-plan", "R-01.P02")
    expect(await openStep(dir)).toBeDefined()
    await closeStep(dir, "phase-append", "R-01.P02")
    expect(await openStep(dir)).toBeUndefined()
  })

  test("openStep: closed out (active=false), a non-step record, and no record all return undefined", async () => {
    await saveProgress(dir, { task: "PLAN", session: "s", at: 1, active: false, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
    expect(await openStep(dir)).toBeUndefined()
    await saveProgress(dir, { task: "T-001", session: "s", at: 1, active: true, phase: { kind: "subtasks" } })
    expect(await openStep(dir)).toBeUndefined()
    await forgetProgress(dir)
    expect(await openStep(dir)).toBeUndefined()
  })

  test("closeStep: deletes only when the step/phase unit matches; otherwise kept", async () => {
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

  test("closeStep: no mistaken deletion when the current record is a task record (not this step)", async () => {
    await saveProgress(dir, { task: "T-009", session: "s", at: 1, active: true, phase: { kind: "subtasks" } })
    await closeStep(dir, "phase-plan", "m")
    expect((await peekProgress(dir))?.task).toBe("T-009")
  })
})
