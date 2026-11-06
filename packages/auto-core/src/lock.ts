// The run lock .auto/run.lock (plans/0053 D1–D3): one driver process at a time
// works in a directory. `runAll` holds it for the whole run (so every shell's
// `run` is covered); a shell's lifecycle commands hold it around their writes
// and re-enter it through `runAll`. The config commands (init, amend, fix,
// reset) write what a running driver reads, so they refuse while it is live;
// check and status never lock, and status shows a live lock.
//
// The file is driver-internal: .auto/ is ignored by git and untouched by reset,
// and no session reads it. It holds one JSON object naming its holder. A lock
// recorded on another host — or in another pid namespace on this host, which
// shares the hostname but cannot share pid numbers (host-network containers)
// — counts as live: its pid cannot be probed from here. A lock left by a
// killed process (SIGKILL skips every cleanup) is found stale by the identity
// read: the pid probe finds no such process, or the process at that pid
// started at a different time than the holder recorded (a reused pid,
// plans/0183 D4). Two processes that find the same stale lock within
// milliseconds may both remove it and both create one; starting runs by hand
// never gets that close (accepted, D2).
import { linkSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join, resolve } from "node:path"
import { log } from "./log"
import { shellProfile } from "./shell"

export const RUN_LOCK_FILE = join(".auto", "run.lock")

// The identity beside the pid (plans/0183 D4, 0165-090): the pid namespace
// ("pid:[N]", the readlink of /proc/self/ns/pid) and the process start time
// (field 22 of /proc/<pid>/stat, jiffies since boot — unique per boot). Both
// best-effort: a kernel without them (non-Linux) yields undefined, the fields
// stay off the lock, and the liveness reading keeps its hostname+pid form
// (the pre-0183 floor, which every identity-less lock keeps too).
export type LockHolder = { pid: number; host: string; command: string; started: string; ns?: string; start?: string }

function pidNamespace(): string | undefined {
  try {
    return readlinkSync("/proc/self/ns/pid") || undefined
  } catch {
    return undefined
  }
}

function processStart(pid: number): string | undefined {
  try {
    // The comm field can contain spaces and parens; everything after the
    // closing paren starts at field 3 (state), so field 22 is token 19.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    return stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19] || undefined
  } catch {
    return undefined
  }
}

// A lock file that cannot be read or parsed (e.g. hand-edited) counts as live.
export type LockState = LockHolder | "unreadable"

// The locks this process holds, by resolved directory: the re-entry count, and
// whether acquiring created .auto/ (removed again with the lock while empty, so
// a run refused before its first write leaves the directory as it found it).
const held = new Map<string, { count: number; createdDir: boolean }>()
let exitHook = false

type RunLock = { ok: true; release: () => void } | { ok: false; holder: LockState }

// Acquires the lock of dir for command ("run", "plan", "close"). Re-entrant: a
// second acquisition in this process only counts, and the file keeps naming
// the first command. Each release() handle counts once, however often called.
export function acquireRunLock(dir: string, command: string): RunLock {
  const root = resolve(dir)
  const entry = held.get(root)
  if (entry) {
    entry.count++
    return { ok: true, release: releaser(root) }
  }
  const createdDir = mkdirSync(join(root, ".auto"), { recursive: true }) !== undefined
  if (!createLock(root, command)) {
    const holder = readLock(root)
    // undefined: released between the two calls — just retry.
    if (holder !== undefined) {
      if (holder === "unreadable" || !stale(root, holder)) return { ok: false, holder }
      log(`↻ removed a stale run lock of ${root}: ${describe(holder)}; its process is gone`)
      rmSync(join(root, RUN_LOCK_FILE), { force: true })
    }
    if (!createLock(root, command)) return { ok: false, holder: readLock(root) ?? "unreadable" }
  }
  held.set(root, { count: 1, createdDir })
  if (!exitHook) {
    exitHook = true
    // Synchronous, so it also runs on process.exit (the double Ctrl+C exits 130).
    process.on("exit", () => {
      for (const [path, owned] of held) removeLock(path, owned.createdDir)
      held.clear()
    })
  }
  return { ok: true, release: releaser(root) }
}

// The live lock of dir, if any: its holder, "unreadable", or undefined when
// there is no lock or only a stale one. Read-only: a stale lock stays on disk
// until the next acquirer removes it.
export function liveRunLock(dir: string): LockState | undefined {
  const root = resolve(dir)
  const holder = readLock(root)
  if (holder === undefined || holder === "unreadable") return holder
  return stale(root, holder) ? undefined : holder
}

// The refusal of a command that found the lock live.
export function lockLines(dir: string, holder: LockState): string[] {
  const { bin } = shellProfile()
  if (holder === "unreadable") {
    return [
      `⏸ the run lock of ${dir} (${RUN_LOCK_FILE}) cannot be read, so another ${bin} process may be working there. ` +
        `If no such process exists, delete ${RUN_LOCK_FILE} by hand.`,
    ]
  }
  // A lock from another pid namespace (plans/0183 D4): its pid is not this
  // namespace's pid — the probe here would either find an unrelated local
  // process or nothing, and neither fact says anything about the holder. The
  // line names the namespace and the hand delete.
  const ours = pidNamespace()
  if (holder.ns !== undefined && ours !== undefined && holder.ns !== ours) {
    return [
      `⏸ another ${bin} process holds the run lock of ${dir}: ${describe(holder)}. ` +
        `Its process runs in another pid namespace (pid numbers do not cross namespaces, so it cannot be probed from here — the shape host-network containers produce); ` +
        `wait for it to finish or stop it in its own namespace; if no such process exists, delete ${RUN_LOCK_FILE} by hand.`,
    ]
  }
  return [
    `⏸ another ${bin} process holds the run lock of ${dir}: ${describe(holder)}. ` +
      `Wait for it to finish or stop it; if no such process exists, delete ${RUN_LOCK_FILE}.`,
  ]
}

// status's first line for a live lock.
export function lockStatusLine(holder: LockState): string {
  if (holder === "unreadable") return `⚠ ${RUN_LOCK_FILE} cannot be read: a run may be in progress (if none is, delete the file)`
  const ns = holder.ns !== undefined ? `, namespace ${holder.ns}` : ""
  return `▶ ${holder.command} in progress (pid ${holder.pid} on ${holder.host}${ns}, since ${holder.started})`
}

function describe(holder: LockHolder): string {
  const ns = holder.ns !== undefined ? `, pid namespace ${holder.ns}` : ""
  return `${holder.command}, pid ${holder.pid} on ${holder.host}${ns}, since ${holder.started}`
}

// Atomic creation: the JSON goes to a temp file first, then link() puts it in
// place; link fails with EEXIST when a lock exists, so no reader ever sees a
// half-written lock. Any other failure is an environment error and propagates.
function createLock(root: string, command: string): boolean {
  const tmp = join(root, `${RUN_LOCK_FILE}.${process.pid}.tmp`)
  const holder: LockHolder = { pid: process.pid, host: hostname(), command, started: new Date().toISOString(), ns: pidNamespace(), start: processStart(process.pid) }
  writeFileSync(tmp, JSON.stringify(holder) + "\n")
  try {
    linkSync(tmp, join(root, RUN_LOCK_FILE))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    throw error
  } finally {
    rmSync(tmp, { force: true })
  }
}

function readLock(root: string): LockState | undefined {
  let text: string
  try {
    text = readFileSync(join(root, RUN_LOCK_FILE), "utf8")
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "unreadable"
  }
  try {
    const value = JSON.parse(text)
    const valid =
      Number.isInteger(value?.pid) &&
      value.pid > 0 &&
      typeof value.host === "string" &&
      typeof value.command === "string" &&
      typeof value.started === "string" &&
      (value.ns === undefined || typeof value.ns === "string") &&
      (value.start === undefined || typeof value.start === "string")
    return valid ? { pid: value.pid, host: value.host, command: value.command, started: value.started, ns: value.ns, start: value.start } : "unreadable"
  } catch {
    return "unreadable"
  }
}

// Stale: recorded on this host and in this process's own pid namespace (a
// lock from another namespace counts as live, like another host), and its
// process is gone — the pid probe finds no such process, or the process at
// that pid started at a different time than the holder recorded (a reused
// pid; a coincidentally equal start figure across reboots resolves toward
// live, P12). The own-pid shortcut keeps its meaning inside this namespace: a
// lock naming this pid while this process holds no lock here is a dead
// predecessor whose pid was reused — unless its recorded start time is
// literally this process's own (then it is this process's leftover, still
// removable). EPERM means alive, though a readable start figure that differs
// still names a reused pid. A lock without identity fields (pre-0183, or a
// kernel without /proc) keeps the hostname+pid reading unchanged.
function stale(root: string, holder: LockHolder): boolean {
  if (holder.host !== hostname()) return false
  const ours = pidNamespace()
  if (holder.ns !== undefined && ours !== undefined && holder.ns !== ours) return false
  if (holder.pid === process.pid) {
    const start = processStart(process.pid)
    if (holder.start !== undefined && start !== undefined && holder.start !== start) return true
    return !held.has(root)
  }
  try {
    process.kill(holder.pid, 0)
    if (holder.start !== undefined) {
      const start = processStart(holder.pid)
      if (start !== undefined && start !== holder.start) return true
    }
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
  }
}

function releaser(root: string): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    const entry = held.get(root)
    if (!entry || --entry.count > 0) return
    held.delete(root)
    removeLock(root, entry.createdDir)
  }
}

// Deletes the lock only while it still names this process: a lock deleted by
// hand and re-created by another process is not ours to remove.
function removeLock(root: string, createdDir: boolean): void {
  const holder = readLock(root)
  if (holder !== undefined && holder !== "unreadable" && holder.pid === process.pid && holder.host === hostname()) {
    rmSync(join(root, RUN_LOCK_FILE), { force: true })
  }
  if (!createdDir) return
  try {
    rmdirSync(join(root, ".auto"))
  } catch {
    // Not empty: the run wrote its state there, which stays.
  }
}
