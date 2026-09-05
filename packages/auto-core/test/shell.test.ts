import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setLogFile, vlog } from "../src/log"
import { setShellProfile, shellProfile, type ShellProfile } from "../src/shell"

// 缺省 = 通用壳(auto)现状: 核心报文在不设置画像时与历史行为逐字节一致。
const GENERIC: ShellProfile = {
  program: "opencode-auto run",
  bin: "opencode-auto",
  agentRecovery: "init",
  auditLog: false,
}

describe("shell 画像", () => {
  afterEach(() => {
    setShellProfile(GENERIC)
  })

  test("缺省画像 = 通用壳现状", () => {
    expect(shellProfile()).toEqual(GENERIC)
  })

  test("部分覆盖在前值上合并;重复调用幂等", () => {
    setShellProfile({ program: "opencode-auto", agentRecovery: "startup", auditLog: true })
    expect(shellProfile()).toEqual({ ...GENERIC, program: "opencode-auto", agentRecovery: "startup", auditLog: true })
    setShellProfile({ program: "opencode-auto" })
    expect(shellProfile()).toEqual({ ...GENERIC, program: "opencode-auto", agentRecovery: "startup", auditLog: true })
  })

  test("auditLog 联动 log 层: 简易壳画像下非 verbose 的 vlog 仍写入日志文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-shell-"))
    try {
      setShellProfile({ program: "opencode-auto", agentRecovery: "startup", auditLog: true })
      const path = setLogFile(dir)
      vlog("审计明细")
      expect(await Bun.file(path).text()).toMatch(/\] 审计明细\n/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
