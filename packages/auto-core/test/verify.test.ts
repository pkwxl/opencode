import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse, type Task } from "../src/plan"
import { DEFAULT_VERIFY_IDLE_MS, resolveVerifyScript, runVerifyScript, verifyTmpDir } from "../src/verify"

const task = (verify?: string): Task =>
  parse("PLAN.md", `## T-001: t [pending]\n${verify ? `  - verify: ${verify}\n` : ""}正文。\n`).tasks[0]!

describe("verifyTmpDir", () => {
  test("路径为目标目录下的 tmp/ 子目录", () => {
    const dir = "/some/target/auto"
    expect(verifyTmpDir(dir)).toBe(join(dir, "tmp"))
    // 尾部分隔符被规整
    expect(verifyTmpDir(`${dir}/`)).toBe(join(dir, "tmp"))
  })
})

describe("resolveVerifyScript", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-verify-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("existing:相对路径单 token 且可执行,直接使用该文件", async () => {
    const script = join(dir, "scripts", "e2e.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nexit 0\n")
    await chmod(script, 0o755)
    await expect(resolveVerifyScript(task("command: ./scripts/e2e.sh"), dir)).resolves.toEqual({
      kind: "existing",
      script,
    })
  })

  test("existing:绝对路径同样命中", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nexit 0\n")
    await chmod(script, 0o755)
    await expect(resolveVerifyScript(task(`command: ${script}`), dir)).resolves.toEqual({
      kind: "existing",
      script,
    })
  })

  test("existing:单 token 文件存在但无可执行位,回退 wrapped", async () => {
    const script = join(dir, "plain.sh")
    await Bun.write(script, "echo plain\n")
    const resolved = await resolveVerifyScript(task("command: ./plain.sh"), dir)
    expect(resolved.kind).toBe("wrapped")
  })

  test("wrapped:普通命令行包装为 verify.sh,原文透传且无额外语义", async () => {
    const resolved = await resolveVerifyScript(task("command: bun test --reporter junit"), dir)
    expect(resolved).toEqual({ kind: "wrapped", script: join(verifyTmpDir(dir), "verify.sh") })
    const content = await Bun.file((resolved as { script: string }).script).text()
    expect(content).toBe("#!/usr/bin/env bash\nbun test --reporter junit\n")
    expect(content).not.toContain("set -e")
    expect((await stat((resolved as { script: string }).script)).mode & 0o777).toBe(0o755)
  })

  test("wrapped:幂等覆盖,verify 字段变更后重新生成", async () => {
    await resolveVerifyScript(task("command: bun x"), dir)
    const second = await resolveVerifyScript(task("command: bun y"), dir)
    expect(await Bun.file((second as { script: string }).script).text()).toBe("#!/usr/bin/env bash\nbun y\n")
  })

  test("generate:自然语言或缺失 verify 交生成会话", async () => {
    await expect(resolveVerifyScript(task("所有测试应通过"), dir)).resolves.toEqual({ kind: "generate" })
    await expect(resolveVerifyScript(task(), dir)).resolves.toEqual({ kind: "generate" })
  })
})

describe("runVerifyScript", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-verify-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("执行脚本,退出码与合并输出(单文件)落盘且整写返回", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho stdout-内容\necho stderr-内容 >&2\nexit 7\n")
    await chmod(script, 0o755)
    const run = await runVerifyScript(dir, script)
    expect(run.code).toBe(7)
    expect(run.timedOut).toBe(false)
    expect(run.ms).toBeGreaterThanOrEqual(0)
    // stdout/stderr 合并为单文件,行序随缓冲交错,分别断言两行均在
    expect(run.out).toContain("stdout-内容")
    expect(run.out).toContain("stderr-内容")
    const written = await Bun.file(join(verifyTmpDir(dir), "verify.out")).text()
    expect(written).toContain("stdout-内容")
    expect(written).toContain("stderr-内容")
  })

  test("cwd 为目标目录", async () => {
    const script = join(dir, "pwd.sh")
    await Bun.write(script, "#!/usr/bin/env bash\npwd\n")
    await chmod(script, 0o755)
    const run = await runVerifyScript(dir, script)
    expect(run.out.trim()).toBe(dir)
  })

  test("执行前 truncate,不残留上次输出", async () => {
    await Bun.write(join(verifyTmpDir(dir), "verify.out"), "上次的长输出残留")
    const script = join(dir, "short.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nexit 0\n")
    await chmod(script, 0o755)
    const run = await runVerifyScript(dir, script)
    expect(run.out).toBe("")
    expect(await Bun.file(join(verifyTmpDir(dir), "verify.out")).text()).toBe("")
  })

  test("无可执行位时回退 bash 执行", async () => {
    const script = join(dir, "noexec.sh")
    await Bun.write(script, "echo from-bash\nexit 3\n")
    const run = await runVerifyScript(dir, script)
    expect(run.code).toBe(3)
    expect(run.out).toBe("from-bash\n")
  })

  test("opts.out 指定输出路径(--test-by-driver 的按序归档共用)", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho t-out\necho t-err >&2\nexit 5\n")
    await chmod(script, 0o755)
    const out = join(verifyTmpDir(dir), "test.1.out")
    const run = await runVerifyScript(dir, script, { out })
    expect(run.code).toBe(5)
    expect(run.out).toContain("t-out")
    expect(run.out).toContain("t-err")
    const written = await Bun.file(out).text()
    expect(written).toContain("t-out")
    expect(written).toContain("t-err")
    // 缺省路径不受影响(不写 verify.out)
    expect(await Bun.file(join(verifyTmpDir(dir), "verify.out")).exists()).toBe(false)
  })

  test("持续无输出超时被看门狗 kill(idle),code 记 124", async () => {
    const script = join(dir, "sleep.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nsleep 30\n")
    await chmod(script, 0o755)
    const run = await runVerifyScript(dir, script, { idleMs: 400, pollMs: 100 })
    expect(run.timedOut).toBe(true)
    expect(run.timeoutReason).toBe("idle")
    expect(run.code).toBe(124)
    expect(run.ms).toBeLessThan(10_000)
  })

  test("输出持续增长即视为有进度,不因总时长被 kill", async () => {
    const script = join(dir, "slow.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nfor i in $(seq 1 12); do echo tick-$i; sleep 0.2; done\nexit 0\n")
    await chmod(script, 0o755)
    // 总时长 ~2.4s 远超 idleMs 700ms,但每 200ms 有输出 → 存活并正常完成。
    const run = await runVerifyScript(dir, script, { idleMs: 700, pollMs: 100 })
    expect(run.timedOut).toBe(false)
    expect(run.code).toBe(0)
    expect(run.out).toContain("tick-12")
  })

  test("绝对时长上限(max)独立于进度信号触发 kill", async () => {
    const script = join(dir, "spin.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nwhile true; do echo spin; sleep 0.1; done\n")
    await chmod(script, 0o755)
    const run = await runVerifyScript(dir, script, { idleMs: 60_000, maxMs: 800, pollMs: 100 })
    expect(run.timedOut).toBe(true)
    expect(run.timeoutReason).toBe("max")
    expect(run.code).toBe(124)
  })

  test("缺省无进度窗口为 10 分钟", () => {
    expect(DEFAULT_VERIFY_IDLE_MS).toBe(10 * 60 * 1000)
  })
})
