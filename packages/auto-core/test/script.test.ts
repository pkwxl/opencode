import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_SCRIPT_IDLE_MS, runScript, scriptTmpDir } from "../src/script"

describe("scriptTmpDir", () => {
  test("the path is the tmp/ subdirectory under the target directory", () => {
    const dir = "/some/target/auto"
    expect(scriptTmpDir(dir)).toBe(join(dir, "tmp"))
    // A trailing separator is normalized away
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

  test("runs the script, the exit code and merged output (single file) land on disk and are returned whole", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho stdout-content\necho stderr-content >&2\nexit 7\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.code).toBe(7)
    expect(run.timedOut).toBe(false)
    expect(run.ms).toBeGreaterThanOrEqual(0)
    // stdout/stderr merged into a single file, line order interleaves with
    // the buffers: assert the two lines are each present
    expect(run.out).toContain("stdout-content")
    expect(run.out).toContain("stderr-content")
    const written = await Bun.file(outOf()).text()
    expect(written).toContain("stdout-content")
    expect(written).toContain("stderr-content")
  })

  test("cwd is the target directory", async () => {
    const script = join(dir, "pwd.sh")
    await Bun.write(script, "#!/usr/bin/env bash\npwd\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.out.trim()).toBe(dir)
  })

  test("truncates before running, no previous output survives", async () => {
    await Bun.write(outOf(), "leftover long output from last time")
    const script = join(dir, "short.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nexit 0\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.out).toBe("")
    expect(await Bun.file(outOf()).text()).toBe("")
  })

  test("without the executable bit it falls back to bash", async () => {
    const script = join(dir, "noexec.sh")
    await Bun.write(script, "echo from-bash\nexit 3\n")
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.code).toBe(3)
    expect(run.out).toBe("from-bash\n")
  })

  test("the timeout kill lands on the real script: a script without the executable bit must not keep writing output once killed (2026-09-17 review H1)", async () => {
    // Without exec, the old implementation's kill only killed the outer
    // bash; the script itself became an orphan and kept running — this
    // asserts the killed script's later echo never lands on disk.
    const script = join(dir, "orphan.sh")
    await Bun.write(script, "echo first\nsleep 2\necho second\n")
    const run = await runScript(dir, script, { out: outOf(), idleMs: 300, pollMs: 50 })
    expect(run.code).toBe(124)
    expect(run.out).toContain("first")
    // Read the file past the script's sleep 2 point: had the script become
    // an orphan still running, second would have been appended
    await Bun.sleep(2500)
    expect(await Bun.file(outOf()).text()).not.toContain("second")
  }, 10_000)

  test("output lands at the opts.out path (--test-by-driver's ordered archiving)", async () => {
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

  test("persistent silence times out and the watchdog kills it (idle), code recorded as 124", async () => {
    const script = join(dir, "sleep.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nsleep 30\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf(), idleMs: 400, pollMs: 100 })
    expect(run.timedOut).toBe(true)
    expect(run.timeoutReason).toBe("idle")
    expect(run.code).toBe(124)
    expect(run.ms).toBeLessThan(10_000)
  })

  test("continuously growing output counts as progress, not killed for the total duration", async () => {
    const script = join(dir, "slow.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nfor i in $(seq 1 12); do echo tick-$i; sleep 0.2; done\nexit 0\n")
    await chmod(script, 0o755)
    // The total duration ~2.4s far exceeds the 700ms idleMs, but output every
    // 200ms → it stays alive and finishes normally.
    const run = await runScript(dir, script, { out: outOf(), idleMs: 700, pollMs: 100 })
    expect(run.timedOut).toBe(false)
    expect(run.code).toBe(0)
    expect(run.out).toContain("tick-12")
  })

  test("the absolute duration cap (max) triggers the kill independently of progress signals", async () => {
    const script = join(dir, "spin.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nwhile true; do echo spin; sleep 0.1; done\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf(), idleMs: 60_000, maxMs: 800, pollMs: 100 })
    expect(run.timedOut).toBe(true)
    expect(run.timeoutReason).toBe("max")
    expect(run.code).toBe(124)
  })

  test("the default no-progress window is 10 minutes", () => {
    expect(DEFAULT_SCRIPT_IDLE_MS).toBe(10 * 60 * 1000)
  })
})
