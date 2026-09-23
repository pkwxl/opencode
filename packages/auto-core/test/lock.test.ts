// The run lock .auto/run.lock (plans/0053 D1–D3): atomic creation, re-entry,
// stale and foreign-host holders, an unparsable file, the exit handler, and
// runAll taking the lock before preflight.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { acquireRunLock, liveRunLock, lockLines, lockStatusLine, RUN_LOCK_FILE, type LockHolder } from "../src/lock"

const dirs: string[] = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "auto-lock-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const lockPath = (dir: string) => join(dir, RUN_LOCK_FILE)
const readHolder = (dir: string): LockHolder => JSON.parse(readFileSync(lockPath(dir), "utf8"))

function plant(dir: string, holder: Partial<LockHolder> | string) {
  mkdirSync(join(dir, ".auto"), { recursive: true })
  const text = typeof holder === "string" ? holder : JSON.stringify({ pid: 1, host: hostname(), command: "plan", started: "2026-09-23T10:00:00.000Z", ...holder })
  writeFileSync(lockPath(dir), text)
}

// A pid with no process behind it: a child that has already exited.
async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"])
  await child.exited
  return child.pid
}

describe("acquire and release (D1–D2)", () => {
  test("the lock names this process; release deletes it and the .auto/ it created", () => {
    const dir = tempDir()
    const lock = acquireRunLock(dir, "run")
    expect(lock.ok).toBe(true)
    const holder = readHolder(dir)
    expect(holder).toMatchObject({ pid: process.pid, host: hostname(), command: "run" })
    expect(Number.isNaN(Date.parse(holder.started))).toBe(false)
    // The temp file is gone once the lock is in place.
    expect(readdirSync(join(dir, ".auto"))).toEqual(["run.lock"])
    if (lock.ok) lock.release()
    expect(readdirSync(dir)).toEqual([])
  })

  test("an existing .auto/ stays after release", () => {
    const dir = tempDir()
    mkdirSync(join(dir, ".auto"))
    const lock = acquireRunLock(dir, "run")
    if (lock.ok) lock.release()
    expect(readdirSync(join(dir, ".auto"))).toEqual([])
  })

  test("re-entrant: the file stays until the last release and keeps the first command", () => {
    const dir = tempDir()
    const outer = acquireRunLock(dir, "plan")
    const inner = acquireRunLock(dir, "run")
    expect(outer.ok && inner.ok).toBe(true)
    expect(readHolder(dir).command).toBe("plan")
    // Each handle counts once, however often it is called.
    if (inner.ok) {
      inner.release()
      inner.release()
    }
    expect(existsSync(lockPath(dir))).toBe(true)
    expect(liveRunLock(dir)).toMatchObject({ pid: process.pid, command: "plan" })
    if (outer.ok) outer.release()
    expect(existsSync(lockPath(dir))).toBe(false)
  })

  test("a live holder refuses, and the refusal names it", () => {
    const dir = tempDir()
    plant(dir, { pid: process.ppid })
    const lock = acquireRunLock(dir, "run")
    expect(lock.ok).toBe(false)
    if (lock.ok) return
    expect(lock.holder).toMatchObject({ pid: process.ppid, command: "plan" })
    expect(lockLines(dir, lock.holder)).toEqual([
      `⏸ another opencode-auto process holds the run lock of ${dir}: plan, pid ${process.ppid} on ${hostname()}, since 2026-09-23T10:00:00.000Z. ` +
        "Wait for it to finish or stop it; if no such process exists, delete .auto/run.lock.",
    ])
    expect(readHolder(dir).pid).toBe(process.ppid)
  })

  test("a stale holder on this host is removed and replaced", async () => {
    const dir = tempDir()
    plant(dir, { pid: await deadPid() })
    expect(liveRunLock(dir)).toBeUndefined()
    const lock = acquireRunLock(dir, "run")
    expect(lock.ok).toBe(true)
    expect(readHolder(dir)).toMatchObject({ pid: process.pid, command: "run" })
    if (lock.ok) lock.release()
  })

  test("this process's own pid in a lock it does not hold is stale (a reused pid)", () => {
    const dir = tempDir()
    plant(dir, { pid: process.pid })
    expect(liveRunLock(dir)).toBeUndefined()
    const lock = acquireRunLock(dir, "run")
    expect(lock.ok).toBe(true)
    if (lock.ok) lock.release()
    expect(existsSync(lockPath(dir))).toBe(false)
  })

  test("a lock recorded on another host counts as live, whatever its pid", async () => {
    const dir = tempDir()
    plant(dir, { pid: await deadPid(), host: "elsewhere-build-3" })
    expect(liveRunLock(dir)).toMatchObject({ host: "elsewhere-build-3" })
    const lock = acquireRunLock(dir, "run")
    expect(lock.ok).toBe(false)
  })

  test("an unparsable lock counts as live and asks for deletion by hand", () => {
    const dir = tempDir()
    for (const text of ["not json", JSON.stringify({ pid: "12", host: "h", command: "run", started: "x" }), JSON.stringify({ pid: 0, host: hostname(), command: "run", started: "x" })]) {
      plant(dir, text)
      expect(liveRunLock(dir)).toBe("unreadable")
      const lock = acquireRunLock(dir, "run")
      expect(lock).toEqual({ ok: false, holder: "unreadable" })
      expect(lockLines(dir, "unreadable")[0]).toContain("delete .auto/run.lock by hand")
    }
  })

  test("no lock: nothing is live", () => {
    expect(liveRunLock(tempDir())).toBeUndefined()
  })

  test("status line", () => {
    expect(lockStatusLine({ pid: 1234, host: "build-3", command: "plan", started: "2026-09-23T10:00:00.000Z" })).toBe(
      "▶ plan in progress (pid 1234 on build-3, since 2026-09-23T10:00:00.000Z)",
    )
    expect(lockStatusLine("unreadable")).toStartWith("⚠ .auto/run.lock cannot be read")
  })
})

describe("process exit (D2)", () => {
  const script = (dir: string, tail: string) => {
    const file = join(dir, "child.ts")
    writeFileSync(
      file,
      `import { acquireRunLock } from ${JSON.stringify(join(import.meta.dir, "../src/lock.ts"))}\n` +
        `const lock = acquireRunLock(process.argv[2], "run")\n` +
        `if (!lock.ok) process.exit(9)\n` +
        tail,
    )
    return file
  }

  test("process.exit deletes the locks the process holds", async () => {
    const dir = tempDir()
    const work = join(dir, "work")
    mkdirSync(work)
    const child = Bun.spawn(["bun", script(dir, "process.exit(130)\n"), work], { stdout: "ignore", stderr: "inherit" })
    expect(await child.exited).toBe(130)
    expect(readdirSync(work)).toEqual([])
  })

  test("SIGKILL leaves the lock behind, and the pid probe finds it stale", async () => {
    const dir = tempDir()
    const work = join(dir, "work")
    mkdirSync(work)
    const child = Bun.spawn(["bun", script(dir, 'console.log("held")\nsetInterval(() => {}, 1000)\n'), work], {
      stdout: "pipe",
      stderr: "inherit",
    })
    try {
      const { value } = await child.stdout.getReader().read()
      expect(new TextDecoder().decode(value)).toContain("held")
      expect(liveRunLock(work)).toMatchObject({ pid: child.pid })
      expect(acquireRunLock(work, "run").ok).toBe(false)
    } finally {
      child.kill("SIGKILL")
      await child.exited
    }
    expect(readHolder(work).pid).toBe(child.pid)
    expect(liveRunLock(work)).toBeUndefined()
    const lock = acquireRunLock(work, "run")
    expect(lock.ok).toBe(true)
    if (lock.ok) lock.release()
  })
})

describe("runAll (D3)", () => {
  test("refuses with exit 1 while another process holds the lock, before preflight", async () => {
    const { runAll } = await import("../src/loop")
    const dir = tempDir()
    // A legacy-layout project would fail preflight; the lock refusal comes first.
    writeFileSync(join(dir, "PLAN.md"), "# plan\n")
    plant(dir, { pid: process.ppid, command: "run" })
    const printed = spyOn(console, "log").mockImplementation(() => {})
    try {
      expect(await runAll(dir, {})).toBe(1)
      expect(printed.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringContaining("another opencode-auto process holds the run lock")])
    } finally {
      printed.mockRestore()
    }
    expect(readHolder(dir).pid).toBe(process.ppid)
  })

  test("re-enters a lock this process holds and leaves it held", async () => {
    const { runAll } = await import("../src/loop")
    const dir = tempDir()
    const lock = acquireRunLock(dir, "plan")
    // maxSessions 2 exits 1 in preflight, after runAll re-entered the lock.
    expect(await runAll(dir, { maxSessions: 2 })).toBe(1)
    expect(readHolder(dir)).toMatchObject({ pid: process.pid, command: "plan" })
    if (lock.ok) lock.release()
    expect(readdirSync(dir)).toEqual([])
  })
})
