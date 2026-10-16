import { access, constants, mkdir } from "node:fs/promises"
import { statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { laneReceiptDoc } from "./docpaths"
import { EOF_MARK } from "./doccheck"
import { rangeChangedFiles, scriptGuardCheck, scriptGuardSnapshot, type ScriptGuardViolation } from "./git"
import { laneTouches, parseLaneReceipt, type TestLane } from "./intent/test-lanes"
import { log } from "./log"

// Driver-run scripts (--test-by-driver) live under the target directory's tmp/
// subdirectory: tmp/test.sh is the request marker, test.<n>.out holds each
// run's output in sequence; the referenced script itself sits in test/. Being
// inside the working directory, sessions can read the files directly, which
// avoids /tmp permission trouble. run/init keep tmp/ and .auto/logs/ in
// .gitignore (see ensureGitignore), so the unified-commit rules are unaffected.
// The serial channel's parallel sibling — the driver-run test lane set
// (plans/0096 D5, runTestLanes below) — keeps its logs outside the tree under
// /tmp/opencode/ instead, the path the lane protocol itself prescribes.
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
  if (violation) logGuardViolation("a driver-run script", violation)
  return { code: timedOut || proc.exitCode === null ? 124 : proc.exitCode, ms: Date.now() - start, timedOut, timeoutReason, out, ...(violation ? { violation } : {}) }
}

// The side-effect guard's log lines (plans/0083 D11), shared by the serial
// channel (runScript) and the lane set (runTestLanes): the restore already ran
// inside the check; the result names the violation and the caller hard-blocks
// on a moved HEAD / steers the finding back at its own sites.
function logGuardViolation(subject: string, violation: ScriptGuardViolation): void {
  if (violation.kind === "head") {
    log(`  ⚠ ${subject} moved HEAD (${violation.moved.map((m) => `${m.root}: ${m.from} → ${m.to}`).join("; ")}); no auto-undo — blocking for the human`)
  } else {
    log(`  ⚠ ${subject} changed tracked files; restored from the pre-run snapshot: ${violation.restored.join(", ")}${violation.unrestorable.length ? `; unrestorable: ${violation.unrestorable.map((u) => `${u.path} (${u.error})`).join(", ")}` : ""}`)
  }
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

// —— Driver-run test lanes (plans/0096 D5) ——
//
// The --test-by-driver channel's parallel half: after a task's execution
// sessions ended and their shares committed (the tree frozen at a known
// state), the project's declared lane table runs as the driver's own
// background processes — the cheap lanes concurrently, an anchor only once
// they green (an anchor started beside a red cheap lane is a doomed long
// run), a lane declared exclusive alone in the tree. Each lane writes its log
// under /tmp/opencode/ with the exit code appended (`LANE_RC=$?`, the line
// the session-side protocol reads too) and is watched by the same
// idle-progress watchdog runScript uses. The stash guard extends to the whole
// set: one snapshot before the first launch, one check after every lane has
// exited (per-lane checks would race under concurrency). Receipts land in
// docs/T-NNN/testhands/<lane id>.md — the partial's prescribed format, parsed
// back by parseLaneReceipt — and are committed evidence: they ride the next
// session close-out commit (the wrap-up or fix round's own stage), never a
// new commit of their own.

// Where lane logs live (the lane protocol's prescribed path, D1: logs under
// /tmp/opencode/). Tests inject a private directory through the opts.
export const LANE_LOG_DIR = "/tmp/opencode"

// How many log lines a red receipt's bounded evidence carries (the ends of
// the failure region, D1).
export const LANE_EVIDENCE_LINES = 30

// One lane's outcome in a set run. carried names the receipt (target-relative
// path) a green verdict carried forward from — the lane never launched.
// evidence is a red run's bounded log tail, what the synthesized gap list
// cites. receipt is the driver-written receipt's target-relative path;
// start/end are the run's wall-clock bounds (a carried run's both equal the
// carry judgment's moment), the receipt's two time lines.
export type LaneRun = {
  lane: string
  verdict: "green" | "red"
  code: number
  ms: number
  log: string
  receipt: string
  start: string
  end: string
  timedOut?: boolean
  timeoutReason?: "idle" | "max"
  carried?: string
  evidence?: string[]
}

// The whole set's outcome: every row's run (launched or carried) plus the
// set-level guard's finding — kind "head" hard-blocks at the caller (the
// corrupted-baseline family), kind "tracked" was already restored.
export type LaneSetResult = {
  runs: LaneRun[]
  violation?: ScriptGuardViolation
}

// The exclusivity serialization (D5): one concurrent batch of the
// non-exclusive lanes, then each exclusive lane alone in the tree, in table
// order — batches run strictly in sequence, so an exclusive lane never
// overlaps a peer. Pure (tested directly); the runner executes the schedule.
export function laneBatches(lanes: readonly TestLane[]): TestLane[][] {
  const shared = lanes.filter((lane) => !lane.exclusive)
  const exclusive = lanes.filter((lane) => lane.exclusive)
  return [...(shared.length ? [shared] : []), ...exclusive.map((lane) => [lane])]
}

// Runs the table's lane set over the frozen tree. Every row of the table runs
// (cheap first, anchors once the cheap tier greened), each subject to the
// carry-forward rule: a lane whose last green receipt's recorded HEADs..HEAD
// diff misses its surfaces is not launched at all — incremental execution
// over the test graph, a phase of ten tasks with localized diffs running its
// full gate on the intersecting minority, not ten times. Regression-cost
// rows are not this set's to run (plans/0098 D1): the two-level pass keeps
// them off the per-task critical path entirely — the driver's background
// slot owns them (src/regression.ts), so they are filtered out here and
// never read as anchors (anchorLaneOf skips them the same way).
export async function runTestLanes(
  dir: string,
  taskId: string,
  lanes: readonly TestLane[],
  opts: { idleMs?: number; maxMs?: number; pollMs?: number; logDir?: string } = {},
): Promise<LaneSetResult> {
  const idleMs = opts.idleMs ?? DEFAULT_SCRIPT_IDLE_MS
  const maxMs = opts.maxMs ?? 0
  const pollMs = opts.pollMs ?? DEFAULT_SCRIPT_POLL_MS
  const logDir = opts.logDir ?? LANE_LOG_DIR
  await mkdir(logDir, { recursive: true })
  // The set-level guard's one snapshot (taken before anything launches; the
  // check runs after every lane exited) doubles as the receipts' recorded
  // tree HEADs — the tree every verdict of this set vouches for.
  const guard = await scriptGuardSnapshot(dir)
  const heads = guard.map((shot) => ({ root: relative(dir, shot.root) || ".", sha: shot.head }))
  const timing = { idleMs, maxMs, pollMs, logDir }
  const rows = lanes.filter((lane) => lane.cost !== "regression")
  const runs: LaneRun[] = []
  const pending: TestLane[] = []
  for (const lane of rows) {
    const carried = await laneCarry(dir, lane)
    if (carried) {
      const now = new Date().toISOString()
      runs.push({ lane: lane.name, verdict: "green", code: 0, ms: 0, log: "", receipt: laneReceiptDoc(taskId, lane.name), start: now, end: now, carried })
      log(`  ↻ ${taskId} lane ${lane.name} carries its green receipt ${carried}; its surfaces are untouched since`)
    } else pending.push(lane)
  }
  const cheap = pending.filter((lane) => lane.cost === "cheap")
  const anchors = pending.filter((lane) => lane.cost === "anchor")
  for (const batch of laneBatches(cheap)) runs.push(...(await runLaneBatch(dir, taskId, batch, timing)))
  if (runs.every((run) => run.verdict === "green")) {
    for (const batch of laneBatches(anchors)) runs.push(...(await runLaneBatch(dir, taskId, batch, timing)))
  } else if (anchors.length) {
    log(`  ⚠ ${taskId} anchor lane${anchors.length === 1 ? ` ${anchors[0]!.name}` : `s (${anchors.map((lane) => lane.name).join(", ")})`} withheld: the cheap tier ran red`)
  }
  const violation = await scriptGuardCheck(dir, guard)
  if (violation) logGuardViolation("a driver-run test lane", violation)
  // Receipts after the guard check, so the driver's own writes never meet it.
  for (const run of runs) await writeLaneReceipt(dir, run, heads)
  return { runs, ...(violation ? { violation } : {}) }
}

// The carry-forward rule's decision (D5): the lane's last green receipt —
// searched across the worktree's testhands directories, this task's own and
// previous tasks' alike (committed receipts are the phase's durable evidence;
// the recorded-HEADs diff is what makes the cross-task carry sound) — carries
// when the changed paths since that receipt's tree miss the lane's surfaces.
// Returns the receipt's path, or undefined = the lane must run.
async function laneCarry(dir: string, lane: TestLane): Promise<string | undefined> {
  let best: { path: string; heads: { root: string; sha: string }[]; end: string } | undefined
  for await (const file of new Bun.Glob(join("docs", "*", "testhands", `${lane.name}.md`)).scan({ cwd: dir, onlyFiles: true })) {
    const receipt = parseLaneReceipt(await Bun.file(join(dir, file)).text().catch(() => ""))
    // Unparsable or headless receipts and red ones are not carry basis; the
    // newest green receipt by its End time wins.
    if (!receipt || receipt.verdict !== "green" || !receipt.heads.length) continue
    if (!best || (receipt.end ?? "") > best.end) best = { path: file, heads: receipt.heads, end: receipt.end ?? "" }
  }
  if (!best) return undefined
  const changed = await rangeChangedFiles(dir, best.heads)
  if (changed === undefined || (changed.length > 0 && laneTouches(lane.surfaces, changed))) return undefined
  return best.path
}

// One batch's processes: every lane of the batch launches as its own
// background process writing its log (the command's merged output plus the
// appended `LANE_RC=$?` line — the tail the verdict is read from), the shared
// watchdog polling each log's growth exactly as runScript's does. The batch
// resolves only when every process exited — the dispatch order the wrap-up
// gate needs ("the driver awaits its own pids").
async function runLaneBatch(
  dir: string,
  taskId: string,
  batch: readonly TestLane[],
  opts: { idleMs: number; maxMs: number; pollMs: number; logDir: string },
): Promise<LaneRun[]> {
  type Live = {
    run: { lane: TestLane; log: string; start: number; outSize: number; lastProgress: number; timedOut: boolean; timeoutReason?: "idle" | "max" }
    proc: ReturnType<typeof Bun.spawn>
  }
  const live: Live[] = []
  const timer = setInterval(() => {
    for (const { run, proc } of live) {
      const size = sizeOf(run.log)
      if (size > run.outSize) {
        run.outSize = size
        run.lastProgress = Date.now()
      }
      if (run.timedOut) continue
      const now = Date.now()
      if (opts.maxMs > 0 && now - run.start >= opts.maxMs) {
        run.timedOut = true
        run.timeoutReason = "max"
        proc.kill()
        continue
      }
      if (now - run.lastProgress >= opts.idleMs) {
        run.timedOut = true
        run.timeoutReason = "idle"
        proc.kill()
      }
    }
  }, opts.pollMs)
  try {
    await Promise.all(
      batch.map(async (lane) => {
        const logPath = join(opts.logDir, `${taskId}-${lane.name}-${Date.now()}.log`)
        // bash -c receives the command and log path as positional parameters,
        // so no shell quoting of the table's command is needed; the command
        // runs in a subshell (its own `exit` must not kill the wrapper before
        // the exit code lands), the inner redirection merges its stdout/stderr
        // into the log and the trailing echo appends the exit code — the lane
        // protocol's own line, the same one the session-side lanes write.
        const proc = Bun.spawn({
          cmd: ["bash", "-c", '( eval "$1" ) > "$2" 2>&1; echo LANE_RC=$? >> "$2"', lane.name, lane.command, logPath],
          cwd: dir,
          stdout: "ignore",
          stderr: "ignore",
        })
        const run = { lane, log: logPath, start: Date.now(), outSize: 0, lastProgress: Date.now(), timedOut: false }
        live.push({ run, proc })
        await proc.exited
      }),
    )
  } finally {
    clearInterval(timer)
  }
  return Promise.all(live.map(({ run }) => laneOutcome(taskId, run)))
}

// The verdict read mechanically from the log tail (D1): the last LANE_RC line
// is the lane's exit code; a watchdog kill leaves none (the kill lands on the
// bash before its echo), and mirrors runScript's 124.
async function laneOutcome(taskId: string, run: { lane: TestLane; log: string; start: number; timedOut: boolean; timeoutReason?: "idle" | "max" }): Promise<LaneRun> {
  const text = await Bun.file(run.log).text().catch(() => "")
  const codes = [...text.matchAll(/^LANE_RC=(\d+)$/gm)]
  const code = run.timedOut || !codes.length ? 124 : Number(codes.at(-1)![1])
  const verdict: LaneRun["verdict"] = !run.timedOut && codes.length && code === 0 ? "green" : "red"
  const end = Date.now()
  const ms = end - run.start
  log(
    `  ${verdict === "green" ? "✓" : "⚠"} ${taskId} lane ${run.lane.name} ${verdict}${run.timedOut ? ` (timed out: ${run.timeoutReason === "max" ? "absolute duration cap exceeded" : "no output for too long"})` : ` (LANE_RC=${code})`}, took ${ms}ms, log: ${run.log}`,
  )
  const evidence = verdict === "red" ? text.trimEnd().split("\n").slice(-LANE_EVIDENCE_LINES) : undefined
  return {
    lane: run.lane.name,
    verdict,
    code,
    ms,
    log: run.log,
    receipt: laneReceiptDoc(taskId, run.lane.name),
    start: new Date(run.start).toISOString(),
    end: new Date(end).toISOString(),
    ...(run.timedOut ? { timedOut: true, ...(run.timeoutReason ? { timeoutReason: run.timeoutReason } : {}) } : {}),
    ...(evidence ? { evidence } : {}),
  }
}

// The receipt the driver writes — the partial's prescribed format, the same
// fields parseLaneReceipt reads back. A carried run records no Log of its own
// (the Carried line names the receipt that has one); a red run carries the
// bounded evidence block. heads are the set's recorded tree HEADs — the tree
// every verdict of the set vouches for.
async function writeLaneReceipt(dir: string, run: LaneRun, heads: { root: string; sha: string }[]): Promise<void> {
  const lines = [
    `# Lane ${run.lane}`,
    "",
    `Lane: ${run.lane}`,
    `Heads: ${heads.map((head) => `${head.root}=${head.sha}`).join("; ")}`,
    `Start: ${run.start}`,
    `End: ${run.end}`,
    `Verdict: ${run.verdict}`,
    ...(run.carried ? [`Carried: ${run.carried}`] : run.log ? [`Log: ${run.log}`] : []),
    "",
  ]
  if (run.verdict === "red") {
    lines.push(
      ...(run.timedOut ? [`The lane was killed by the watchdog (${run.timeoutReason === "max" ? "the absolute duration cap" : "no output for too long"}); the log tail follows.`] : []),
      ...(run.log ? [`Log: ${run.log}`, ""] : []),
      "```",
      ...(run.evidence?.length ? run.evidence : ["(the log is empty)"]),
      "```",
      "",
    )
  }
  lines.push(EOF_MARK, "")
  await mkdir(dirname(join(dir, run.receipt)), { recursive: true })
  await Bun.write(join(dir, run.receipt), lines.join("\n"))
}
