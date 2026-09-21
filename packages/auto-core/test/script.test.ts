import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_SCRIPT_IDLE_MS, runScript, scriptTmpDir } from "../src/script"

describe("scriptTmpDir", () => {
  test("路径为目标目录下的 tmp/ 子目录", () => {
    const dir = "/some/target/auto"
    expect(scriptTmpDir(dir)).toBe(join(dir, "tmp"))
    // 尾部分隔符被规整
    expect(scriptTmpDir(`${dir}/`)).toBe(join(dir, "tmp"))
  })
})

describe("runScript", () => {
  let dir: string
  // Output file of a run (the caller always names it; test runs archive as test.<n>.out).
  const outOf = () => join(scriptTmpDir(dir), "run.out")

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-script-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("执行脚本,退出码与合并输出(单文件)落盘且整写返回", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho stdout-内容\necho stderr-内容 >&2\nexit 7\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.code).toBe(7)
    expect(run.timedOut).toBe(false)
    expect(run.ms).toBeGreaterThanOrEqual(0)
    // stdout/stderr 合并为单文件,行序随缓冲交错,分别断言两行均在
    expect(run.out).toContain("stdout-内容")
    expect(run.out).toContain("stderr-内容")
    const written = await Bun.file(outOf()).text()
    expect(written).toContain("stdout-内容")
    expect(written).toContain("stderr-内容")
  })

  test("cwd 为目标目录", async () => {
    const script = join(dir, "pwd.sh")
    await Bun.write(script, "#!/usr/bin/env bash\npwd\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.out.trim()).toBe(dir)
  })

  test("执行前 truncate,不残留上次输出", async () => {
    await Bun.write(outOf(), "上次的长输出残留")
    const script = join(dir, "short.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nexit 0\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.out).toBe("")
    expect(await Bun.file(outOf()).text()).toBe("")
  })

  test("无可执行位时回退 bash 执行", async () => {
    const script = join(dir, "noexec.sh")
    await Bun.write(script, "echo from-bash\nexit 3\n")
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.code).toBe(3)
    expect(run.out).toBe("from-bash\n")
  })

  test("超时 kill 落在真脚本上: 无可执行位的脚本被杀后不得继续写输出(2026-09-17 审查 H1)", async () => {
    // 不经 exec 时旧实现的 kill 只杀外层 bash,脚本本体成孤儿继续运行——
    // 这里断言被杀脚本后续的回声永不落盘。
    const script = join(dir, "orphan.sh")
    await Bun.write(script, "echo first\nsleep 2\necho second\n")
    const run = await runScript(dir, script, { out: outOf(), idleMs: 300, pollMs: 50 })
    expect(run.code).toBe(124)
    expect(run.out).toContain("first")
    // 越过脚本里 sleep 2 的时点再读盘: 若脚本成孤儿仍在跑,second 会追加上来
    await Bun.sleep(2500)
    expect(await Bun.file(outOf()).text()).not.toContain("second")
  }, 10_000)

  test("输出落 opts.out 指定路径(--test-by-driver 的按序归档)", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho t-out\necho t-err >&2\nexit 5\n")
    await chmod(script, 0o755)
    const out = join(scriptTmpDir(dir), "test.1.out")
    const run = await runScript(dir, script, { out })
    expect(run.code).toBe(5)
    expect(run.out).toContain("t-out")
    expect(run.out).toContain("t-err")
    const written = await Bun.file(out).text()
    expect(written).toContain("t-out")
    expect(written).toContain("t-err")
  })

  test("持续无输出超时被看门狗 kill(idle),code 记 124", async () => {
    const script = join(dir, "sleep.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nsleep 30\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf(), idleMs: 400, pollMs: 100 })
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
    const run = await runScript(dir, script, { out: outOf(), idleMs: 700, pollMs: 100 })
    expect(run.timedOut).toBe(false)
    expect(run.code).toBe(0)
    expect(run.out).toContain("tick-12")
  })

  test("绝对时长上限(max)独立于进度信号触发 kill", async () => {
    const script = join(dir, "spin.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nwhile true; do echo spin; sleep 0.1; done\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf(), idleMs: 60_000, maxMs: 800, pollMs: 100 })
    expect(run.timedOut).toBe(true)
    expect(run.timeoutReason).toBe("max")
    expect(run.code).toBe(124)
  })

  test("缺省无进度窗口为 10 分钟", () => {
    expect(DEFAULT_SCRIPT_IDLE_MS).toBe(10 * 60 * 1000)
  })
})
