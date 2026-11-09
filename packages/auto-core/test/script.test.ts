import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_KILL_GRACE_MS, DEFAULT_SCRIPT_IDLE_MS, DEFAULT_SCRIPT_POLL_MS, laneLogDir, runScript, scriptTmpDir, writeLaneReceipt, type LaneRun } from "../src/script"
import { EOF_MARK } from "../src/doccheck"

describe("scriptTmpDir", () => {
  test("the path is the tmp/ subdirectory under the target directory", () => {
    const dir = "/some/target/auto"
    expect(scriptTmpDir(dir)).toBe(join(dir, "tmp"))
    // A trailing separator is normalized away
    expect(scriptTmpDir(`${dir}/`)).toBe(join(dir, "tmp"))
  })
})

describe("laneLogDir (plans/0151 D1, the environment seam)", () => {
  test("the default is the lane protocol's prescribed path", () => {
    expect(laneLogDir({})).toBe("/tmp/opencode")
  })

  test("OPENCODE_AUTO_LANE_LOG_DIR redirects the lane and regression logs; the empty string counts as unset", () => {
    expect(laneLogDir({ OPENCODE_AUTO_LANE_LOG_DIR: "/ws/proj/tmp/sbx/lane-logs" })).toBe("/ws/proj/tmp/sbx/lane-logs")
    expect(laneLogDir({ OPENCODE_AUTO_LANE_LOG_DIR: "" })).toBe("/tmp/opencode")
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

  test("runs the script: the exit code and the merged output (single file) land on disk", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho stdout-content\necho stderr-content >&2\nexit 7\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.code).toBe(7)
    expect(run.timedOut).toBe(false)
    expect(run.ms).toBeGreaterThanOrEqual(0)
    // stdout/stderr merged into a single file, line order interleaves with
    // the buffers: the two lines are each present in the file on disk (the
    // result's dead whole-file field is gone, plans/0175 D3 — sessions read
    // the file)
    const written = await Bun.file(outOf()).text()
    expect(written).toContain("stdout-content")
    expect(written).toContain("stderr-content")
  })

  test("cwd is the target directory", async () => {
    const script = join(dir, "pwd.sh")
    await Bun.write(script, "#!/usr/bin/env bash\npwd\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf() })
    // pwd reports the physical working directory (getcwd resolves symlinks,
    // e.g. macOS $TMPDIR → /private/var/…), so compare against the resolved
    // target directory — the same directory either way.
    expect((await Bun.file(outOf()).text()).trim()).toBe(await realpath(dir))
  })

  test("truncates before running, no previous output survives", async () => {
    await Bun.write(outOf(), "leftover long output from last time")
    const script = join(dir, "short.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nexit 0\n")
    await chmod(script, 0o755)
    await runScript(dir, script, { out: outOf() })
    expect(await Bun.file(outOf()).text()).toBe("")
  })

  test("without the executable bit it falls back to bash", async () => {
    const script = join(dir, "noexec.sh")
    await Bun.write(script, "echo from-bash\nexit 3\n")
    const run = await runScript(dir, script, { out: outOf() })
    expect(run.code).toBe(3)
    expect(await Bun.file(outOf()).text()).toBe("from-bash\n")
  })

  test("the timeout kill lands on the real script: a script without the executable bit must not keep writing output once killed (2026-09-17 review H1)", async () => {
    // Without exec, the old implementation's kill only killed the outer
    // bash; the script itself became an orphan and kept running — this
    // asserts the killed script's later echo never lands on disk. Millisecond
    // watchdog values: the kill lands well inside the script's sleep 0.25
    // window, and the read afterwards waits past the point where an orphan
    // would have echoed.
    const script = join(dir, "orphan.sh")
    await Bun.write(script, "echo first\nsleep 0.25\necho second\n")
    const run = await runScript(dir, script, { out: outOf(), idleMs: 120, pollMs: 15 })
    expect(run.code).toBe(124)
    expect(await Bun.file(outOf()).text()).toContain("first")
    // Read the file past the script's sleep 0.25 point: had the script become
    // an orphan still running, second would have been appended
    await Bun.sleep(300)
    expect(await Bun.file(outOf()).text()).not.toContain("second")
  }, 5_000)

  test("output lands at the opts.out path (--test-by-driver's ordered archiving)", async () => {
    const script = join(dir, "check.sh")
    await Bun.write(script, "#!/usr/bin/env bash\necho t-out\necho t-err >&2\nexit 5\n")
    await chmod(script, 0o755)
    const out = join(scriptTmpDir(dir), "test.1.out")
    const run = await runScript(dir, script, { out })
    expect(run.code).toBe(5)
    const written = await Bun.file(out).text()
    expect(written).toContain("t-out")
    expect(written).toContain("t-err")
  })

  test("persistent silence times out and the watchdog kills it (idle), code recorded as 124", async () => {
    // Millisecond watchdog values; the assertions hold even on a host whose
    // process spawn outlasts the idle window (the kill then lands while the
    // interpreter is still starting, which is still an idle kill).
    const script = join(dir, "sleep.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nsleep 10\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf(), idleMs: 120, pollMs: 20 })
    expect(run.timedOut).toBe(true)
    expect(run.timeoutReason).toBe("idle")
    expect(run.code).toBe(124)
    expect(run.ms).toBeLessThan(5_000)
  })

  test("continuously growing output counts as progress, not killed for the total duration", async () => {
    // No executable bit: the script runs as bash data, so a slow first-exec
    // host (macOS assesses each first-exec'd script path) pays no per-path
    // penalty before the first tick — the idle window (120ms) only has to
    // cover the plain bash spawn. 12 ticks of 30ms ≈ 360ms total, 3× the
    // idle window, with the 30ms print gap 4× under it.
    const script = join(dir, "slow.sh")
    await Bun.write(script, "for i in $(seq 1 12); do echo tick-$i; sleep 0.03; done\nexit 0\n")
    const run = await runScript(dir, script, { out: outOf(), idleMs: 120, pollMs: 25 })
    expect(run.timedOut).toBe(false)
    expect(run.code).toBe(0)
    expect(await Bun.file(outOf()).text()).toContain("tick-12")
  })

  test("the absolute duration cap (max) triggers the kill independently of progress signals", async () => {
    const script = join(dir, "spin.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nwhile true; do echo spin; sleep 0.05; done\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf(), idleMs: 60_000, maxMs: 120, pollMs: 20 })
    expect(run.timedOut).toBe(true)
    expect(run.timeoutReason).toBe("max")
    expect(run.code).toBe(124)
  })

  test("the default no-progress window is 10 minutes", () => {
    expect(DEFAULT_SCRIPT_IDLE_MS).toBe(10 * 60 * 1000)
  })

  test("the default watchdog poll interval is 5 seconds", () => {
    expect(DEFAULT_SCRIPT_POLL_MS).toBe(5_000)
  })

  test("the default kill grace is 10 seconds", () => {
    expect(DEFAULT_KILL_GRACE_MS).toBe(10_000)
  })

  test("a child that ignores SIGTERM is escalated to SIGKILL after the grace (plans/0156 D7): bounded, one line logged", async () => {
    // The wrapper execs the script, so the child IS the script; one that
    // traps TERM and sleeps would pin the old watchdog's await forever (the
    // run hanging until double-Ctrl+C). Millisecond grace: the whole scene
    // resolves in well under a second.
    const script = join(dir, "trap.sh")
    await Bun.write(script, "trap '' TERM\necho trapped\nsleep 30\n")
    await chmod(script, 0o755)
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    let run: Awaited<ReturnType<typeof runScript>>
    try {
      run = await runScript(dir, script, { out: outOf(), idleMs: 100, pollMs: 20, killGraceMs: 150 })
    } finally {
      printed.mockRestore()
    }
    expect(run.timedOut).toBe(true)
    expect(run.code).toBe(124)
    // Bounded: the SIGKILL landed, not the 30s sleep.
    expect(run.ms).toBeLessThan(5_000)
    expect(lines.some((line) => line.includes("ignored SIGTERM for 150ms; escalating to SIGKILL"))).toBe(true)
  }, 8_000)

  test("a child that honors SIGTERM is byte-identical: no escalation line, the grace never fires", async () => {
    const script = join(dir, "term.sh")
    await Bun.write(script, "#!/usr/bin/env bash\nsleep 10\n")
    await chmod(script, 0o755)
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    let run: Awaited<ReturnType<typeof runScript>>
    try {
      run = await runScript(dir, script, { out: outOf(), idleMs: 100, pollMs: 20, killGraceMs: 5_000 })
    } finally {
      printed.mockRestore()
    }
    expect(run.timedOut).toBe(true)
    expect(run.code).toBe(124)
    expect(run.ms).toBeLessThan(5_000)
    expect(lines.some((line) => line.includes("escalating to SIGKILL"))).toBe(false)
  }, 8_000)

  test("a timeout kill reaches the script's backgrounded grandchild: no late write into the tree (plans/0175 D1, 0165-020)", async () => {
    // The script backgrounds a subshell that writes past the kill point —
    // the direct-child kill left exactly this orphan writing (0025 H1's
    // recorded limitation); the group-directed kill takes the whole tree.
    const script = join(dir, "bg.sh")
    await Bun.write(script, "( sleep 0.4; echo late > late.txt ) &\necho started\nsleep 5\n")
    await chmod(script, 0o755)
    const run = await runScript(dir, script, { out: outOf(), idleMs: 150, pollMs: 25, killGraceMs: 300 })
    expect(run.code).toBe(124)
    // Past the grandchild's 0.4s write point: an orphan would have written.
    await Bun.sleep(600)
    expect(await Bun.file(join(dir, "late.txt")).text().catch(() => "")).toBe("")
  }, 8_000)
})

// plans/0239 D4 (finding 0165-210): the lane receipt's Log field is stated
// once — in the common field array, where every receipt's reader looks — and
// the red branch never duplicates it. The exact field sequences are pinned:
// a future single-field consumer must never have to choose between two
// identical lines.
describe("writeLaneReceipt: the Log field stated once (plans/0239 D4)", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-script-receipt-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const run = (over: Partial<LaneRun>): LaneRun => ({
    lane: "verify-full",
    verdict: "red",
    code: 1,
    ms: 10,
    log: "/tmp/driver-side.log",
    receipt: join("docs", "T-001", "testhands", "verify-full.md"),
    start: "2026-11-09T10:00:00Z",
    end: "2026-11-09T10:01:00Z",
    ...over,
  })
  const heads = [{ root: ".", sha: "abc123" }]
  const read = async () => await Bun.file(join(dir, "docs", "T-001", "testhands", "verify-full.md")).text()

  test("a red receipt: one Log line, the exact field sequence", async () => {
    await writeLaneReceipt(dir, run({ evidence: ["FAILED src/a.ts", "1 test failed"] }), heads)
    const text = await read()
    expect(text).toBe(
      [
        "# Lane verify-full",
        "",
        "Lane: verify-full",
        "Heads: .=abc123",
        "Start: 2026-11-09T10:00:00Z",
        "End: 2026-11-09T10:01:00Z",
        "Verdict: red",
        "Log: /tmp/driver-side.log",
        "",
        "```",
        "FAILED src/a.ts",
        "1 test failed",
        "```",
        "",
        EOF_MARK,
        "",
      ].join("\n"),
    )
    expect(text.match(/^Log: /gm)?.length).toBe(1)
  })

  test("a timed-out red receipt: the kill line with its blank, still one Log", async () => {
    await writeLaneReceipt(dir, run({ timedOut: true, timeoutReason: "idle", evidence: [] }), heads)
    const text = await read()
    expect(text).toContain("The lane was killed by the watchdog (no output for too long); the log tail follows.\n\n```\n(the log is empty)")
    expect(text.match(/^Log: /gm)?.length).toBe(1)
  })

  test("a green receipt keeps the common fields (Log in place, no red block)", async () => {
    await writeLaneReceipt(dir, run({ verdict: "green", code: 0 }), heads)
    const text = await read()
    expect(text).toContain("Verdict: green\nLog: /tmp/driver-side.log\n")
    expect(text).not.toContain("```")
    expect(text.match(/^Log: /gm)?.length).toBe(1)
  })

  test("a carried receipt states Carried, never Log", async () => {
    await writeLaneReceipt(dir, run({ verdict: "green", code: 0, carried: "docs/T-000/testhands/verify-full.md", log: "/tmp/old.log" }), heads)
    const text = await read()
    expect(text).toContain("Carried: docs/T-000/testhands/verify-full.md")
    expect(text).not.toContain("Log:")
  })
})
