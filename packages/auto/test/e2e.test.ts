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

describe("CLI 解析: -m/--mode 与 --final-review", () => {
  test("-m/--mode 未注册名为用法错误(退出码 1),报文列出支持的模式", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const run = await runCli(["run", dir, "-m", "optimize"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("--mode 取值须为已注册的模式")
      expect(run.err).toContain("migrate")
      const init = await runCli(["init", dir, "--mode", "nope"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("--mode 取值须为已注册的模式")
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

  test("--final-review 与 --review/--early-review 组合不误报用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const combos = [
        ["--review", "3"],
        ["--early-review", "2"],
        ["--review", "3", "--early"],
      ]
      for (const extra of combos) {
        const run = await runCli(["run", dir, "--final-review", "2", ...extra])
        // 组合合法: 解析全部通过后进入 runAll,因空目录缺少 PLAN.md 退出 1
        // (driver 报文走 stdout,与用法错误的 stderr 区分)。
        expect(run.code).toBe(1)
        expect(run.out).toContain("未找到计划文件")
        expect(run.err).toBe("")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--verify 为布尔选项,合法组合不误报用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const combos = [["--verify"], ["--verify", "true"], ["--verify=false", "--review", "2"], ["--verify", "--early-review", "2"]]
      for (const extra of combos) {
        const run = await runCli(["run", dir, ...extra])
        // 组合合法: 解析全部通过后进入 runAll,因空目录缺少 PLAN.md 退出 1。
        expect(run.code).toBe(1)
        expect(run.out).toContain("未找到计划文件")
        expect(run.err).toBe("")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
