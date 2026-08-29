import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { parse, type Task } from "../src/plan"
import { resolveVerifyScript, runVerifyScript, VERIFY_TIMEOUT_MS, verifyTmpDir } from "../src/verify"

const task = (verify?: string): Task =>
  parse("PLAN.md", `## T-001: t [pending]\n${verify ? `  - verify: ${verify}\n` : ""}正文。\n`).tasks[0]!

describe("verifyTmpDir", () => {
  test("路径为 tmpdir 下按目标目录基名命名", () => {
    const dir = "/some/target/auto"
    expect(verifyTmpDir(dir)).toBe(join(tmpdir(), "auto"))
    // 尾部分隔符被规整,不产生空基名
    expect(verifyTmpDir(`${dir}/`)).toBe(join(tmpdir(), "auto"))
  })
})

describe("resolveVerifyScript", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-verify-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(verifyTmpDir(dir), { recursive: true, force: true })
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
    await rm(verifyTmpDir(dir), { recursive: true, force: true })
  })

  test("执行脚本,退出码与 out/err 落盘且整写返回", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho stdout-内容\necho stderr-内容 >&2\nexit 7\n")
    await chmod(script, 0o755)
    const run = await runVerifyScript(dir, script)
    expect(run.code).toBe(7)
    expect(run.timedOut).toBe(false)
    expect(run.ms).toBeGreaterThanOrEqual(0)
    expect(run.out).toBe("stdout-内容\n")
    expect(run.err).toBe("stderr-内容\n")
    expect(await Bun.file(join(verifyTmpDir(dir), "verify.out")).text()).toBe("stdout-内容\n")
    expect(await Bun.file(join(verifyTmpDir(dir), "verify.err")).text()).toBe("stderr-内容\n")
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

  test("超时 kill,code 记 124", async () => {
    const script = join(dir, "sleep.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nsleep 30\n")
    await chmod(script, 0o755)
    const run = await runVerifyScript(dir, script, 200)
    expect(run.timedOut).toBe(true)
    expect(run.code).toBe(124)
    expect(run.ms).toBeLessThan(10_000)
  })

  test("缺省超时为 10 分钟", () => {
    expect(VERIFY_TIMEOUT_MS).toBe(10 * 60 * 1000)
  })
})
