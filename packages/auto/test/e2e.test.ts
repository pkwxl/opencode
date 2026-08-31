import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "../src/plan"
import { runAll } from "../src/loop"

// Opt-in end-to-end test: requires `opencode` on PATH (or
// OPENCODE_AUTO_SERVER pointing at a running serve) plus provider credentials.
//   OPENCODE_AUTO_E2E=1 bun test test/e2e.test.ts
const E2E = process.env.OPENCODE_AUTO_E2E === "1"

const PLAN = `## T-001: 创建 hello.txt [pending]
  - verify: command: test -f hello.txt && grep -q hello hello.txt
在当前目录创建 hello.txt,内容为 "hello"。

## T-002: 请求写权限并写入 greeting.txt [pending]
  - verify: command: test -f greeting.txt
这个任务需要先获得用户授权。调用 question 工具询问用户:
"是否允许在 opencode.json 中放行 greeting.txt 的写权限?"
拿到肯定答复后把问候语 "hello" 写入 greeting.txt。

## T-003: 汇总 [pending]
  - verify: command: test -f SUMMARY.md
创建 SUMMARY.md,列出生成的文件。
`

test.skipIf(!E2E)(
  "端到端: 三任务计划,含一次阻塞与人工介入续跑",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), PLAN)
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(new URL("../templates/opencode.json", import.meta.url)).text(),
      )

      // 第一轮: T-001 完成,T-002 触发 question → 阻塞停机
      expect(await runAll(dir, {})).toBe(2)
      const blocked = await load(join(dir, "PLAN.md"))
      expect(blocked.tasks[0]!.status).toBe("done")
      expect(blocked.tasks[1]!.status).toBe("blocked")
      expect(blocked.tasks[1]!.question).toBeTruthy()

      // 模拟人工介入: 阻塞的问题是会话外事务,无需填写 answer,直接重启续跑
      // 第二轮: T-002 携带"问题已在会话外解决,不要重问"的提示续跑,T-003 完成,全部 done
      expect(await runAll(dir, {})).toBe(0)
      const done = await load(join(dir, "PLAN.md"))
      expect(done.tasks.every((t) => t.status === "done")).toBe(true)
      expect(await Bun.file(join(dir, "SUMMARY.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// CLI 解析用例不需要 opencode 与 provider 凭证,始终运行: 以子进程运行源码入口,
// 用法错误经 stderr 报文与退出码 1 断言;合法组合以空目录"未找到计划文件"退出
// (解析全部通过、在 spawn server 之前),证明未误报组合用法错误。
async function runCli(args: string[]) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out, err }
}

describe("CLI 解析: run 侧选项与配置", () => {
  test("run 拒绝已固化选项(退出码 1 + 修订指引)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fixed = [
        ["-m", "migrate"],
        ["--mode", "migrate"],
        ["--agent", "auto"],
        ["--context-limit", "64"],
        ["--subtask", "auto"],
        ["--verify"],
        ["--verify=false"],
        ["--verify-idle", "10"],
        ["--verify-max", "0"],
        ["--commit", "true"],
      ]
      for (const extra of fixed) {
        const run = await runCli(["run", dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).toContain("已在 init 固化")
        expect(run.err).toContain(".opencode/auto/config.json")
        expect(run.err).toContain("opencode-auto init <dir>")
      }
      // -m/--mode 报文同型(短选项形式给出修订指引)
      expect((await runCli(["run", dir, "-m", "migrate"])).err).toContain("-m/--mode 已在 init 固化")
      // --commit-subtask 移除报文保留
      const removed = await runCli(["run", dir, "--commit-subtask"])
      expect(removed.code).toBe(1)
      expect(removed.err).toContain("--commit-subtask 已移除")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run 合法选项组合照旧,不误报用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const combos = [
        ["--final-review", "2", "--review", "3"],
        ["--final-review", "2", "--early-review", "2"],
        ["--final-review", "2", "--review", "3", "--early"],
        ["--permission", "ask-allow", "--wait-answer", "5", "--wait-between", "2"],
        ["--dryrun"],
      ]
      for (const extra of combos) {
        const run = await runCli(["run", dir, ...extra])
        // 组合合法: 配置取缺省、解析全部通过后进入 runAll,因空目录缺少
        // PLAN.md 退出 1(driver 报文走 stdout,与用法错误的 stderr 区分)。
        expect(run.code).toBe(1)
        expect(run.out).toContain("未找到计划文件")
        expect(run.err).toBe("")
        expect(run.out).toContain("⚙ 项目配置(.opencode/auto/config.json)")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--final-review 显式值须为 1..5 整数,否则用法错误(退出码 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const value of ["0", "6", "x"]) {
        const run = await runCli(["run", dir, "--final-review", value])
        expect(run.code).toBe(1)
        expect(run.err).toContain("--final-review 取值范围为 1..5")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("旧项目回落: 仅 .auto/config.json 有 mode 时 run 提示沿用旧位置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".auto/config.json"), JSON.stringify({ mode: "migrate" }))
      const run = await runCli(["run", dir])
      expect(run.out).toContain("模式沿用旧位置 .auto/config.json 的持久化值,重跑 init 可固化完整配置")
      expect(run.out).toContain("未找到计划文件")
      expect(run.err).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("配置文件坏值 → run 退出码 1,报错含键名与期望", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ verifyIdle: 999 }))
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(run.err).toContain("verifyIdle")
      expect(run.err).toContain("1..120")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --mode 未注册名为用法错误(退出码 1),报文列出支持的模式", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--mode", "nope"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("--mode 取值须为已注册的模式")
      expect(init.err).toContain("migrate")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: init 固化项目配置", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("init 写出完整 config(全键缺省)并打印摘要", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain("⚙ 项目配置(.opencode/auto/config.json)")
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
        agent: "auto",
        contextLimit: 64,
        subtask: "auto",
        verify: false,
        verifyIdle: 10,
        verifyMax: 0,
        commit: true,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init amend 仅改写显式给出的键,重复 init 无参数不重置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["init", dir, "--verify", "--context-limit", "128", "--commit", "false"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
        agent: "auto",
        contextLimit: 128,
        subtask: "auto",
        verify: true,
        verifyIdle: 10,
        verifyMax: 0,
        commit: false,
      })
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await readConfig(dir)).commit).toBe(false)
      expect((await readConfig(dir)).verify).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 显式键取值非法为用法错误(退出码 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const bad = [
        ["--subtask", "fast"],
        ["--context-limit", "0"],
        ["--verify-idle", "999"],
        ["--verify-max", "0.5"],
        ["--commit", "maybe"],
      ]
      for (const extra of bad) {
        const init = await runCli(["init", dir, ...extra])
        expect(init.code).toBe(1)
        expect(init.err).not.toBe("")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status 先打印配置摘要再列任务清单;配置非法不阻塞清单", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚙ 项目配置(.opencode/auto/config.json): 模式 migrate · agent auto")
      expect(status.out).toContain("[pending] T-001")
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ subtask: "fast" }))
      const broken = await runCli(["status", dir])
      expect(broken.code).toBe(0)
      expect(broken.out).toContain("⚠ 项目配置(.opencode/auto/config.json) 非法")
      expect(broken.out).toContain("subtask")
      expect(broken.out).toContain("[pending] T-001")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
