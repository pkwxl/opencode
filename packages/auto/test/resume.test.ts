import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { forgetSession, recallSession, rememberSession, RESUME_WINDOW_MS } from "../src/resume"

describe("会话记忆", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resume-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("remember → recall 往返;forget 后不可 recall", async () => {
    await rememberSession(dir, "T-001", "ses_abc")
    expect(await recallSession(dir, "T-001")).toEqual({ task: "T-001", session: "ses_abc", at: expect.any(Number) })
    await forgetSession(dir)
    expect(await recallSession(dir, "T-001")).toBeUndefined()
  })

  test("recall 不校验时间窗(超窗记忆仍返回,窗口判定在 runner)", async () => {
    await Bun.write(join(dir, ".auto", "session.json"), JSON.stringify({ task: "T-001", session: "ses_old", at: Date.now() - RESUME_WINDOW_MS - 1 }))
    expect(await recallSession(dir, "T-001")).toEqual({ task: "T-001", session: "ses_old", at: expect.any(Number) })
  })

  test("任务不符、文件缺失或损坏返回 undefined", async () => {
    await rememberSession(dir, "T-001", "ses_abc")
    expect(await recallSession(dir, "T-002")).toBeUndefined()
    await forgetSession(dir)
    expect(await recallSession(dir, "T-001")).toBeUndefined()
    await Bun.write(join(dir, ".auto", "session.json"), "{not json")
    expect(await recallSession(dir, "T-001")).toBeUndefined()
  })

  test("forget 对缺失文件无害", async () => {
    await forgetSession(dir)
  })
})
