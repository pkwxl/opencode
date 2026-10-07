import { access, constants, mkdir } from "node:fs/promises"
import { statSync } from "node:fs"
import { join, resolve } from "node:path"
import { scriptGuardCheck, scriptGuardSnapshot, type ScriptGuardViolation } from "./git"
import { log } from "./log"

// Driver-run scripts (--test-by-driver) live under the target directory's tmp/
// subdirectory: tmp/test.sh is the request marker, test.<n>.out holds each
// run's output in sequence; the referenced script itself sits in test/. Being
// inside the working directory, sessions can read the files directly, which
// avoids /tmp permission trouble. run/init keep tmp/ and .auto/logs/ in
// .gitignore (see ensureGitignore), so the unified-commit rules are unaffected.
export function scriptTmpDir(dir: string): string {
  return join(resolve(dir), "tmp")
}

// Default no-progress window: the script is killed only after its output file
// has not grown for this long (config idleTime overrides it). As long as the
// script keeps printing, its run time is unbounded.
export const DEFAULT_SCRIPT_IDLE_MS = 10 * 60 * 1000

// Default watchdog poll interval. All watchdog timings (idleMs, maxMs, pollMs)
// are options so tests run the watchdog on millisecond values over short
// scripts instead of waiting on wall time.
// AUTO-RESOLVE: the consolidation plan's seam list for this module named two
// intervals to make options, "(poll, kill grace)" — the code has the poll
// interval already seamed (pollMs, now with its default named here, value
// unchanged) and no kill grace to seam (nothing runs between the timeout kill
// and awaiting the child's exit), so no grace option was added: a
// SIGTERM→SIGKILL escalation would change behaviour at the default option
// values, which the unit rules out of scope, and no test needs it.
export const DEFAULT_SCRIPT_POLL_MS = 5_000

export type ScriptRunResult = {
  code: number
  ms: number
  timedOut: boolean
  // Timeout reason: idle = killed after producing no output for too long;
  // max = killed after exceeding the absolute run-time cap.
  timeoutReason?: "idle" | "max"
  // Whole content of the merged stdout+stderr output file (see runScript).
  // Kept for logs and debugging; sessions read the file on disk.
  out: string
  // The side-effect guard's finding (plans/0083 D11): tracked = the script
  // modified or deleted tracked files and the driver restored them from the
  // pre-run snapshot; head = the script moved a repository's HEAD and no
  // auto-undo ran (the caller hard-blocks). Undefined = the script left
  // git-managed content alone. Outside git (no repository roots) the guard
  // idles and this stays undefined.
  violation?: ScriptGuardViolation
}

// Runs a driver-managed script in the target directory. stdout and stderr are
// merged by shell redirection into one output file (`> out 2>&1`; cleaner than
// tee when non-interactive, and no pipe is left behind after a kill — with the
// output going straight to a file, a grandchild holding the fd after a timeout
// kill cannot hang the read). The file is truncated first. A non-zero exit code
// is not judged here: the session reading the result decides. The timeout is a
// progress watchdog, not a fixed duration: every pollMs the output size is
// polled, growth counts as progress and resets the idle clock, and only idleMs
// without growth kills the script (idle). maxMs > 0 adds an absolute cap (max).
// Only the direct child is killed; the grandchild tree is not guaranteed to be
// cleaned up (known limitation).
export async function runScript(
  dir: string,
  script: string,
  opts: { out: string; idleMs?: number; maxMs?: number; pollMs?: number },
): Promise<ScriptRunResult> {
  const idleMs = opts.idleMs ?? DEFAULT_SCRIPT_IDLE_MS
  const maxMs = opts.maxMs ?? 0
  const pollMs = opts.pollMs ?? DEFAULT_SCRIPT_POLL_MS
  await mkdir(scriptTmpDir(dir), { recursive: true })
  const outPath = opts.out
  await Bun.write(outPath, "")
  const start = Date.now()
  // The side-effect guard's pre-run snapshot (plans/0083 D11): taken before
  // the child exists, checked after it exited — the delta between the two
  // reads is causally the script's (it ran alone between them). Inert
  // outside git and under the no-commit double (no repository roots → no
  // snapshot → no check).
  const guard = await scriptGuardSnapshot(dir)
  // bash -c receives the script and output paths as positional parameters, so
  // no shell quoting is needed; the inner redirection merges the script's own
  // stdout/stderr into the output file and the outer bash prints nothing. Both
  // branches exec over the outer bash (an executable script runs directly,
  // anything else via exec bash): a timeout kill only reaches the direct child,
  // and without exec only the outer bash would die while the script kept
  // running as an orphan, still writing the output file.
  const exec = await isExecutable(script)
  const proc = Bun.spawn({
    cmd: ["bash", "-c", `${exec ? 'exec "$0"' : 'exec bash "$0"'} > "$1" 2>&1`, script, outPath],
    cwd: dir,
    stdout: "ignore",
    stderr: "ignore",
  })
  let timedOut = false
  let timeoutReason: "idle" | "max" | undefined
  let outSize = 0
  let lastProgress = start
  const timer = setInterval(() => {
    const out = sizeOf(outPath)
    if (out > outSize) {
      outSize = out
      lastProgress = Date.now()
    }
    if (timedOut) return
    const now = Date.now()
    if (maxMs > 0 && now - start >= maxMs) {
      timedOut = true
      timeoutReason = "max"
      proc.kill()
      return
    }
    if (now - lastProgress >= idleMs) {
      timedOut = true
      timeoutReason = "idle"
      proc.kill()
    }
  }, pollMs)
  await proc.exited
  clearInterval(timer)
  const out = await Bun.file(outPath).text()
  const violation = await scriptGuardCheck(dir, guard)
  if (violation) {
    // The restore already ran inside the check (tracked mutations are back to
    // pre-run content); the steered-back result names the violation and the
    // drift counter books it at the steer sites (engine concern / exec
    // session).
    if (violation.kind === "head") {
      log(`  ⚠ a driver-run script moved HEAD (${violation.moved.map((m) => `${m.root}: ${m.from} → ${m.to}`).join("; ")}); no auto-undo — blocking for the human`)
    } else {
      log(`  ⚠ a driver-run script changed tracked files; restored from the pre-run snapshot: ${violation.restored.join(", ")}${violation.unrestorable.length ? `; unrestorable: ${violation.unrestorable.map((u) => `${u.path} (${u.error})`).join(", ")}` : ""}`)
    }
  }
  return { code: timedOut || proc.exitCode === null ? 124 : proc.exitCode, ms: Date.now() - start, timedOut, timeoutReason, out, ...(violation ? { violation } : {}) }
}

// statSync rather than async stat: avoids racing the next tick inside the poll
// callback. A missing file counts as 0 (not created yet).
function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  )
}
