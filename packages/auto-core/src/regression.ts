// The regression lane — the two-level pass (plans/0098): where the pack's
// lane table declares a regression-cost row (the project's full-gate suite),
// the wrap-up's preliminary tier (cheap lanes, the anchor, the verify
// session) closes tasks and releases dependents, while the complete tier —
// this module — keeps the full regression green at the tree level:
//
//   - coverage (D3): a regression lane is covered at the current tree iff
//     its newest round-scoped green receipt's recorded HEADs..HEAD diff
//     misses the lane's surfaces — 0096's carry-forward rule moved from
//     "may this task's lane skip its run" to "is the tree's regression
//     obligation discharged";
//   - the background slot (D4): one driver-run lane at a time, launched at
//     unit boundaries into a disposable reflink copy of the clean tree (it
//     never contends with the next unit's session, and it carries nested
//     repositories and warm build directories a git worktree cannot
//     materialize — dm-glm's exact shape), its receipt committed evidence
//     under docs/R-NN/regression/;
//   - the phase-close hold (D5): a covering green receipt is the only way
//     through a phase's handover — in-flight runs awaited, stale ones run
//     at close (the one place the full gate still blocks), a red routed
//     into the 0079 repair append or the gate stop;
//   - strict test-readiness (D7): a `Strict: yes` regression row makes the
//     wrap-up's lane gate wait for the dependencies' complete pass before
//     the unit's own testing runs.
//
// Verdicts stay driver-parsed from log tails (`LANE_RC`), never agent
// self-report; receipts are the durable truth, the runtime record
// (.auto/regression.json) only the liveness pointer. A pack without
// regression-cost rows is the byte-identical floor: nothing here launches,
// gates or writes.
import { existsSync, statSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { basename, join, relative, resolve } from "node:path"
import { latestRegressionSeq, regressionReceiptDoc } from "./docpaths"
import { roleOf } from "./document/roles"
import { changedFiles, pendingChanges, probeReflink, rangeChangedFiles, scriptGuardCheck, scriptGuardSnapshot, taskChangedPaths, type GitOps, type ScriptGuardViolation } from "./git"
import { laneTouches, parseLaneReceipt, parseTestLanes, type TestLane } from "./intent/test-lanes"
import { log } from "./log"
import { codeWork } from "./phases/registry"
import { phaseKey, phaseLabel } from "./phases"
import type { PhaseUnit } from "./phases"
import { shellProfile } from "./shell"
import { promptFacts } from "./prompt-facts"
import { DEFAULT_SCRIPT_IDLE_MS, DEFAULT_SCRIPT_POLL_MS, LANE_EVIDENCE_LINES, LANE_LOG_DIR, readLaneVerdict, writeLaneReceipt, type LaneRun } from "./script"
import { autoSwitches } from "./switches"

// What the boundary and the hold need from the run's opts — the lane gate's
// own reads (testByDriver, the watchdog timings, dryrun) plus promptFacts's
// pack inputs; RunAllOpts satisfies it structurally, so the loop contexts
// pass their opts as-is.
export type RegressionOpts = { dir?: string; intent?: string; dryrun?: boolean; testByDriver?: boolean; idleMs?: number; maxMs?: number }

// The round number of a phase unit's round name ("R-01" → 1) — the boundary
// sites hold the PhaseUnit; the receipt constructors take the number.
export function roundNumberOf(unit: { round: string }): number {
  return Number(/^R-(\d+)$/.exec(unit.round)?.[1] ?? 0)
}

// One green receipt's machine facts: its target-relative path, the tree HEADs
// its verdict vouches for, and its End time (the newest-green ordering key).
export type GreenReceipt = { path: string; heads: { root: string; sha: string }[]; end: string }

// The lane's newest green receipt, round-scoped (docs/R-NN/regression/).
// Unparsable, headless and red receipts are not carry basis — the laneCarry
// discipline verbatim; a red receipt still matters to the hold as evidence,
// which reads the same scan through regressionStatus below.
export async function newestGreenReceipt(dir: string, round: number, lane: string): Promise<GreenReceipt | undefined> {
  let best: GreenReceipt | undefined
  const stem = `R-${String(round).padStart(2, "0")}`
  for await (const file of new Bun.Glob(join("docs", stem, "regression", `*-${lane}.md`)).scan({ cwd: dir, onlyFiles: true })) {
    const receipt = parseLaneReceipt(await Bun.file(join(dir, file)).text().catch(() => ""))
    if (!receipt || receipt.verdict !== "green" || !receipt.heads.length) continue
    if (!best || (receipt.end ?? "") > best.end) best = { path: file, heads: receipt.heads, end: receipt.end ?? "" }
  }
  return best
}

// The complete-pass predicate (D3): covered = the newest green receipt's
// recorded HEADs..HEAD diff misses the lane's surfaces. changed carries that
// diff (the attribution basis) even when covered is false; undefined = no
// usable receipt or an unreadable range — the fail-safe direction, the lane
// re-runs.
export type RegressionCoverage = { covered: boolean; receipt?: GreenReceipt; changed?: string[] }

export async function regressionCovered(dir: string, round: number, lane: TestLane): Promise<RegressionCoverage> {
  const receipt = await newestGreenReceipt(dir, round, lane.name)
  if (!receipt) return { covered: false }
  const changed = await rangeChangedFiles(dir, receipt.heads)
  if (changed === undefined) return { covered: false, receipt }
  const covered = changed.length === 0 || !laneTouches(lane.surfaces, changed)
  return { covered, receipt, ...(covered ? {} : { changed }) }
}

// The table's regression rows — undefined when the pack declares none (the
// floor: no launches, no hold, no strict wait).
export function regressionLanes(lanes: readonly TestLane[] | undefined): TestLane[] | undefined {
  const rows = lanes?.filter((lane) => lane.cost === "regression")
  return rows?.length ? rows : undefined
}

// —— The background slot (plans/0098 D4) ——

// Where the disposable tree copy lives: .auto/regression-copy/ — inside the
// target (the one location guaranteed to sit on the target's own filesystem,
// which reflink requires) and inside .auto/ (gitignored driver state). The
// copy excludes .auto/ wholesale (its own home, and runtime state a lane
// never needs); everything else materializes — dotfiles included, so .git
// and dm-glm-shaped nested repositories and warm build directories ride
// along, exactly what a git worktree cannot provide.
export const REGRESSION_COPY = join(".auto", "regression-copy")

// The crash-detection marker: which background run is in flight. The receipt
// facts are always re-derived from the committed receipts on disk; this file
// is only the liveness pointer the next run's preflight orphans.
const RECORD = join(".auto", "regression.json")
type RegressionRecord = { inflight?: { lane: string; seq: number; heads: { root: string; sha: string }[]; log: string; started: string } }

async function readRecord(dir: string): Promise<RegressionRecord | undefined> {
  const text = await Bun.file(join(dir, RECORD)).text().catch(() => "")
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as RegressionRecord | undefined
  } catch {
    return undefined
  }
}

async function writeRecord(dir: string, record: RegressionRecord): Promise<void> {
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(join(dir, RECORD), `${JSON.stringify(record, null, 2)}\n`)
}

// The in-process slot: one background run per driver process and directory
// (a lane worker's worktree directory is its own key and never hosts a
// launch — only the parent loops call the boundary below).
const slots = new Map<string, Promise<void>>()

// The in-flight background run of this directory, if any — what the
// phase-close hold awaits before deciding to launch its own.
export function regressionInFlight(dir: string): Promise<void> | undefined {
  return slots.get(resolve(dir))
}

// The materialization: one copy pass per top-level entry except .auto,
// dotfiles included (the glob trio */.[!.]*/..?* covers the hidden names; a
// non-matching glob's literal is skipped by the existence test). reflink is
// what makes the copy of an x-GB tree cheap — the launcher gates on the
// probe and defers without it (launchStale below); the flag itself is
// injection for the hermetic tests, whose tmpfs scratch cannot clone.
async function materializeCopy(dir: string, reflink: boolean): Promise<string> {
  const dest = join(dir, REGRESSION_COPY)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  const proc = Bun.spawn(
    [
      "bash",
      "-c",
      `set -- "$0"/* "$0"/.[!.]* "$0"/..?*; for f in "$@"; do [ -e "$f" ] || continue; case "\${f#"$0"/}" in .auto) continue ;; esac; cp -a ${reflink ? "--reflink=always" : ""} -- "$f" "$1"/; done`,
      dir,
      dest,
    ],
    { stdout: "ignore", stderr: "pipe" },
  )
  const err = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) {
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    throw new Error(`the regression tree copy failed to materialize: ${err.trim() || `cp exited ${(await proc.exited)}`}`)
  }
  return dest
}

// statSync rather than async stat: avoids racing the next tick inside the
// watchdog poll (the runScript note). A missing log counts as 0.
function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

// One regression lane's run (the runner both sites share): isolate = the
// background copy (no guard — the copy is disposable, the receipt records
// the MAIN tree's HEADs the clean-tree copy materialized); isolate = false =
// the driver-exclusive windows (the phase-close hold, the strict wait), the
// stash guard armed like the lane gate's. The receipt lands through the
// shared writeLaneReceipt at the round-scoped path whatever the mode; the
// verdict is readLaneVerdict's LANE_RC rule, the same protocol the wrap-up
// set and the sessions' own lanes speak.
export type RegressionRun = LaneRun & { violation?: ScriptGuardViolation }

export async function runRegressionLane(
  dir: string,
  round: number,
  lane: TestLane,
  opts: { isolate: boolean; reflink?: boolean; idleMs?: number; maxMs?: number; pollMs?: number; logDir?: string },
): Promise<RegressionRun> {
  const idleMs = opts.idleMs ?? DEFAULT_SCRIPT_IDLE_MS
  const maxMs = opts.maxMs ?? 0
  const pollMs = opts.pollMs ?? DEFAULT_SCRIPT_POLL_MS
  const logDir = opts.logDir ?? LANE_LOG_DIR
  await mkdir(logDir, { recursive: true })
  const seq = (await latestRegressionSeq(dir, round)) + 1
  // The light snapshot doubles as the heads (runTestLanes's own move) and,
  // in-tree, the guard.
  const guard = await scriptGuardSnapshot(dir)
  const heads = guard.map((shot) => ({ root: relative(dir, shot.root) || ".", sha: shot.head }))
  const copy = opts.isolate ? await materializeCopy(dir, opts.reflink ?? true) : undefined
  const logPath = join(logDir, `regression-${seq}-${lane.name}-${Date.now()}.log`)
  const started = new Date()
  if (opts.isolate) await writeRecord(dir, { inflight: { lane: lane.name, seq, heads, log: logPath, started: started.toISOString() } })
  log(`◈ regression lane ${lane.name} ${opts.isolate ? `runs in the background copy (tree ${heads.map((head) => `${head.root}=${head.sha}`).join(", ")})` : "runs in the tree (the driver-exclusive window)"}, log ${logPath}`)
  const proc = Bun.spawn({
    cmd: ["bash", "-c", '( eval "$1" ) > "$2" 2>&1; echo LANE_RC=$? >> "$2"', lane.name, lane.command, logPath],
    cwd: copy ?? dir,
    stdout: "ignore",
    stderr: "ignore",
  })
  let timedOut = false
  let timeoutReason: "idle" | "max" | undefined
  let outSize = 0
  let lastProgress = Date.now()
  const timer = setInterval(() => {
    const size = sizeOf(logPath)
    if (size > outSize) {
      outSize = size
      lastProgress = Date.now()
    }
    if (timedOut) return
    const now = Date.now()
    if (maxMs > 0 && now - started.getTime() >= maxMs) {
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
  const text = await Bun.file(logPath).text().catch(() => "")
  const { code, verdict } = readLaneVerdict(text, timedOut)
  const violation = opts.isolate ? undefined : await scriptGuardCheck(dir, guard)
  const end = new Date()
  const run: RegressionRun = {
    lane: lane.name,
    verdict,
    code,
    ms: end.getTime() - started.getTime(),
    log: logPath,
    receipt: regressionReceiptDoc(round, seq, lane.name),
    start: started.toISOString(),
    end: end.toISOString(),
    ...(timedOut ? { timedOut: true, ...(timeoutReason ? { timeoutReason } : {}) } : {}),
    ...(verdict === "red" ? { evidence: text.trimEnd().split("\n").slice(-LANE_EVIDENCE_LINES) } : {}),
    ...(violation ? { violation } : {}),
  }
  await writeLaneReceipt(dir, run, heads)
  if (opts.isolate) {
    await rm(join(dir, RECORD), { force: true }).catch(() => {})
    if (copy !== undefined) await rm(copy, { recursive: true, force: true }).catch(() => {})
  }
  log(
    `  ${verdict === "green" ? "✓" : "⚠"} regression lane ${lane.name} ${verdict}${timedOut ? ` (timed out: ${timeoutReason === "max" ? "absolute duration cap exceeded" : "no output for too long"})` : ` (LANE_RC=${code})`}, took ${run.ms}ms, receipt ${run.receipt}, log: ${logPath}`,
  )
  return run
}

// The preflight orphan (plans/0098 D4): a record or a copy the previous
// process left behind — its run died with it, no receipt landed (fail-safe:
// the lane stays stale and re-runs at the next boundary). The copy is
// removed and the marker cleared with a loud line; nothing else is state.
export async function recoverRegression(dir: string): Promise<void> {
  const record = await readRecord(dir)
  const copy = join(dir, REGRESSION_COPY)
  if (!record?.inflight && !existsSync(copy)) return
  const which = record?.inflight ? ` of ${record.inflight.lane} (started ${record.inflight.started})` : ""
  await rm(copy, { recursive: true, force: true }).catch(() => {})
  await rm(join(dir, RECORD), { force: true }).catch(() => {})
  log(`⚠ an interrupted background regression run${which} is discarded — no receipt landed, the lane re-runs at the next boundary (plans/0098 D4)`)
}

// The boundary's receipt commit (plans/0098 D4): a receipt the background
// run wrote while a session worked rides that session's unified commit; one
// still uncommitted at the following boundary (the run finished between the
// last close-out and now) would dirty the next unit's start gate, so it gets
// its own driver commit — but only when it is the ONLY change (foreign dirt
// keeps its owner: the clean gate's block, not a sweep into our commit).
async function commitPendingReceipts(dir: string, round: number, git: Pick<GitOps, "commitTree">): Promise<void> {
  const changed = await changedFiles(dir)
  const receipts = changed.filter((path) => roleOf(path) === "regression")
  if (!receipts.length) return
  const foreign = changed.filter((path) => roleOf(path) !== "regression")
  const label = `R-${String(round).padStart(2, "0")}`
  const names = receipts.map((path) => basename(path)).join(", ")
  if (foreign.length) {
    log(`⚠ the regression receipt(s) ${names} share the dirty tree with other changes (${foreign.join(", ")}); they ride the next unified commit instead of a dedicated one`)
    return
  }
  const settled = await git.commitTree(dir, { id: "PLAN", title: `regression receipts (${label})` }, { stage: "regression", subject: `PLAN regression ${label} ${names}` })
  if (!settled.ok) log(`⚠ the regression receipt commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")} — the next unit's clean gate will name them`)
  else log(`✓ regression receipt${receipts.length === 1 ? "" : "s"} committed: ${names}`)
}

// The no-reflink degrade, logged once per directory and run: the boundary
// keeps evaluating (a later boundary after a filesystem change would launch),
// but each stale lane reports its deferral one time, not per boundary.
const deferred = new Set<string>()

// The stale-lane launch: one lane per boundary (the serial resource is the
// norm — dm-glm's one QEMU display), only when the slot is idle and the tree
// clean (the copy materializes the working tree; only a clean tree equals
// the committed state the receipt's heads will vouch for). Fire-and-forget:
// the completion writes its own receipt and cleans up after itself, and the
// hold awaits the slot through regressionInFlight when it must.
async function launchStale(dir: string, opts: RegressionOpts, round: number, rows: readonly TestLane[]): Promise<void> {
  const key = resolve(dir)
  if (slots.has(key)) return
  if (await pendingChanges(dir)) return
  for (const lane of rows) {
    if ((await regressionCovered(dir, round, lane)).covered) continue
    if (!(await probeReflink(dir))) {
      if (!deferred.has(key)) {
        deferred.add(key)
        log(`ℹ the regression lane ${lane.name} is stale but this filesystem cannot reflink the tree copy — the run defers to the phase-close window (plans/0098 D4)`)
      }
      return
    }
    const done: Promise<void> = runRegressionLane(dir, round, lane, { isolate: true, idleMs: opts.idleMs, maxMs: opts.maxMs }).then(
      () => undefined,
      (error) => {
        log(`⚠ the background regression run of ${lane.name} failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
    slots.set(key, done.finally(() => slots.delete(key)))
    return
  }
}

// The unit boundary's regression hook (plans/0098 D4) — the parent loops'
// call after a unit's close-out (serial) or a lane's landing (the worktree
// loops), before the next unit's start gate. Two halves with different
// gates: the pending-receipt commit is janitorial — a receipt the machinery
// wrote must never dirty the next unit's start gate, so it runs for every
// non-dryrun parent boundary whatever the switch or the channel say (the
// switch removes the machinery going forward, not the cleanup of what it
// wrote); the launch is the machinery proper, gated on the lane gate's own
// derived conditions (the switch, dryrun, testByDriver && codeWork, a table
// with regression rows) — a pack without the rows or a switched-off run
// launches nothing.
export async function regressionBoundary(ctx: { directory: string; git: Pick<GitOps, "commitTree"> }, opts: RegressionOpts, phase: PhaseUnit): Promise<void> {
  const round = roundNumberOf(phase)
  if (!opts.dryrun) await commitPendingReceipts(ctx.directory, round, ctx.git)
  if (!autoSwitches().regression || opts.dryrun || !(opts.testByDriver && codeWork(phase.entry))) return
  const rows = regressionLanes(parseTestLanes(promptFacts(opts).pack))
  if (!rows) return
  await launchStale(ctx.directory, opts, round, rows)
}

// —— The phase-close hold (plans/0098 D5) ——

// One held lane's facts: the red run's receipt, its log, the bounded
// evidence and the D6 suspects — everything the repair input and the gate
// stop name.
export type HeldLane = { lane: string; receipt: string; log: string; evidence: string[]; suspects: { id: string; title: string }[] }

// The D6 attribution, deliberately advisory: the paths changed since the
// lane's last green receipt (everything when none exists — the whole phase
// then sits on unregressed ground) intersected with the lane's surfaces give
// the failing surface set; the tasks whose own commits (the Auto-Task
// trailer scan) intersect that set are the named units. Attribution steers
// the person's rework, never a gate — the receipt decides.
export async function regressionSuspects(dir: string, round: number, lane: TestLane, tasks: readonly { id: string; title: string }[]): Promise<{ id: string; title: string }[]> {
  const coverage = await regressionCovered(dir, round, lane)
  const failing = coverage.changed === undefined ? undefined : coverage.changed.filter((path) => laneTouches(lane.surfaces, [path]))
  const suspects: { id: string; title: string }[] = []
  for (const task of tasks) {
    const paths = await taskChangedPaths(dir, task.id)
    if (!paths.length) continue
    if (failing === undefined ? laneTouches(lane.surfaces, paths) : laneTouches(failing, paths)) suspects.push(task)
  }
  return suspects
}

// The hold's verdict: ok = every regression lane covered at the phase's
// final tree (the receipts the boundary runs and the close-time runs below
// wrote); held = at least one lane red, its facts carried for the repair
// append or the gate stop; corrupted = a close-time run moved HEAD, the
// corrupted-baseline family — no phase completes over it.
export type RegressionHold = { kind: "ok" } | { kind: "held"; lanes: HeldLane[] } | { kind: "corrupted"; moved: string[] }

// The hold itself, run at the phase's handover between the distillation
// commit and the completion rename — the one window the full gate may still
// block, dm-glm's "final regression verification" task as a driver
// invariant: covered lanes pass through; an in-flight background run is
// awaited; a stale lane runs NOW in the tree (the driver owns it
// exclusively here, the stash guard armed like the lane gate's); a red
// holds the phase. The runs' receipts land through the janitorial commit
// before any outcome returns — a receipt must never dirty the append or the
// next unit that follows a held phase.
export async function ensureRegressionGreen(
  ctx: { directory: string; git: Pick<GitOps, "commitTree"> },
  opts: RegressionOpts,
  phase: PhaseUnit,
  tasks: readonly { id: string; title: string }[],
): Promise<RegressionHold> {
  if (!autoSwitches().regression || opts.dryrun || !(opts.testByDriver && codeWork(phase.entry))) return { kind: "ok" }
  const rows = regressionLanes(parseTestLanes(promptFacts(opts).pack))
  if (!rows) return { kind: "ok" }
  const round = roundNumberOf(phase)
  const held: HeldLane[] = []
  for (const lane of rows) {
    if ((await regressionCovered(ctx.directory, round, lane)).covered) continue
    const inFlight = regressionInFlight(ctx.directory)
    if (inFlight) {
      log(`↻ the phase close waits for the in-flight background regression run of ${lane.name}`)
      await inFlight
      if ((await regressionCovered(ctx.directory, round, lane)).covered) continue
    }
    const run = await runRegressionLane(ctx.directory, round, lane, { isolate: false, idleMs: opts.idleMs, maxMs: opts.maxMs })
    if (run.violation?.kind === "head") {
      await commitPendingReceipts(ctx.directory, round, ctx.git)
      return { kind: "corrupted", moved: run.violation.moved.map((move) => `${move.root}: ${move.from} → ${move.to}`) }
    }
    if (run.verdict === "green") continue
    held.push({ lane: lane.name, receipt: run.receipt, log: run.log, evidence: run.evidence ?? [], suspects: await regressionSuspects(ctx.directory, round, lane, tasks) })
  }
  await commitPendingReceipts(ctx.directory, round, ctx.git)
  return held.length ? { kind: "held", lanes: held } : { kind: "ok" }
}

// The remediation-wave input (D5, the 0079 §4 held-verdict shape): the
// append session reads the receipts' bounded evidence and the suspects, and
// writes the tasks that re-green the lane — dm-glm's T-100 pattern, the
// parked wave's remediation hop, as planned work.
export function regressionRepairInput(phase: PhaseUnit, lanes: readonly HeldLane[]): string {
  const facts = lanes
    .map((held) => {
      const suspects = held.suspects.length ? held.suspects.map((task) => `${task.id} ${task.title}`).join("; ") : "no task of this phase touched the lane's surfaces (an earlier phase or the person did)"
      const evidence = held.evidence.length ? held.evidence.join("\n") : "(the log is empty)"
      return [
        `- Lane \`${held.lane}\` red at the phase's final tree. Receipt \`${held.receipt}\` (log ${held.log}).`,
        `  Suspects (own commits touching the lane's surfaces since its last green receipt): ${suspects}.`,
        "  The receipt's bounded evidence:",
        "",
        "  ```",
        ...evidence.split("\n").map((line) => `  ${line}`),
        "  ```",
      ].join("\n")
    })
    .join("\n")
  return [
    `Repair round: the phase is held by its regression gate — the declared full-regression lane(s) ran red at the phase's final tree. ${facts}`,
    "",
    "Append repair tasks that fix what the receipts found and re-run the lanes so they green at the new tree; the phase is distilled again after the tasks run.",
  ].join("\n")
}

// The gate-stop lines (the logGateStop posture): the held phase, the
// receipts, the suspects, and the person's ways on.
export function regressionHoldLines(directory: string, phase: PhaseUnit, lanes: readonly HeldLane[]): string[] {
  const bin = shellProfile().bin
  const lines = [`⏸ phase ${phaseLabel(phase)} is held by its regression gate:`]
  for (const held of lanes) {
    lines.push(`  the lane \`${held.lane}\` is red at the phase's final tree — receipt ${held.receipt}, log ${held.log}`)
    lines.push(`  suspects: ${held.suspects.length ? held.suspects.map((task) => `${task.id} (${task.title})`).join(", ") : "no task of this phase touched the lane's surfaces"}`)
  }
  lines.push(`  to rework: append fix tasks with ${bin} plan ${directory} --append -p <text> (the phase distills again after they run and the gate re-checks)`)
  lines.push(`  to close the phase without its gate: ${bin} close ${phaseKey(phase).id} ${directory} --reason <text>`)
  return lines
}

// —— The strict test-readiness (plans/0098 D7) ——

// The round of a qualified phase id ("R-01.P03" → 1); the no-phase mode's
// implicit round 1 when absent.
export function roundOfPhaseId(id: string | undefined): number {
  return Number(/^R-(\d+)\./.exec(id ?? "")?.[1] ?? 1)
}

// Whether one dependency's committed state is exactly what a green run
// vouched for (D7's honest per-edge rule): the paths changed since the
// newest green receipt, MINUS the current unit's own commits (its building
// atop the dependency is what its own testing assesses — without the
// exclusion every dependent would re-block the full gate on its own work),
// must miss the dependency's own changed paths. No green receipt at all, or
// an unreadable range, reads incomplete — the phase's ground is unvouched.
async function dependencyComplete(dir: string, round: number, lane: TestLane, dep: string, ownPaths: readonly string[]): Promise<boolean> {
  const receipt = await newestGreenReceipt(dir, round, lane.name)
  if (!receipt) return false
  const changed = await rangeChangedFiles(dir, receipt.heads)
  if (changed === undefined) return false
  const depPaths = await taskChangedPaths(dir, dep)
  if (!depPaths.length) return true
  return !changed.some((path) => laneTouches(depPaths, [path]) && !laneTouches(ownPaths, [path]))
}

// The strict wait's verdict: undefined = proceed (every dependency complete
// — or nothing strict declared, or no dependencies at all); blocked = a
// strict lane ran red at the state the wait produced, the run's facts
// carried for the anchor-red path; corrupted = the moved-HEAD family.
export type StrictWait = { lane: string; deps: string[]; run: RegressionRun } | { corrupted: string[] } | undefined

// The strict wait itself, run at the top of the wrap-up's lane gate (D7):
// for every strict row, each of the task's effective dependencies must be
// complete per the rule above — an incomplete one first awaits any
// in-flight background run, then (still incomplete) triggers one run in the
// tree: the wrap-up moment is a driver-exclusive window like the hold's,
// the stash guard armed. A green receipt at the current HEAD completes
// every dependency at once; a red rides the anchor-red path (the fix loop
// owns the dependency's defect through this unit's rounds).
export async function strictRegressionWait(dir: string, round: number, rows: readonly TestLane[], deps: readonly string[], ownTask: string, opts: RegressionOpts): Promise<StrictWait> {
  const strict = rows.filter((lane) => lane.strict)
  if (!strict.length || !deps.length) return undefined
  const ownPaths = await taskChangedPaths(dir, ownTask)
  for (const lane of strict) {
    const incomplete: string[] = []
    for (const dep of deps) {
      if (!(await dependencyComplete(dir, round, lane, dep, ownPaths))) incomplete.push(dep)
    }
    if (!incomplete.length) continue
    log(`◈ the strict regression lane ${lane.name} waits: ${incomplete.join(", ")} changed since its last green receipt`)
    const inFlight = regressionInFlight(dir)
    if (inFlight) {
      log(`↻ the strict wait joins the in-flight background regression run of ${lane.name}`)
      await inFlight
    }
    const awaitedStill: string[] = []
    for (const dep of incomplete) {
      if (!(await dependencyComplete(dir, round, lane, dep, ownPaths))) awaitedStill.push(dep)
    }
    if (!awaitedStill.length) continue
    const run = await runRegressionLane(dir, round, lane, { isolate: false, idleMs: opts.idleMs, maxMs: opts.maxMs })
    if (run.violation?.kind === "head") {
      return { corrupted: run.violation.moved.map((move) => `${move.root}: ${move.from} → ${move.to}`) }
    }
    if (run.verdict === "green") continue
    return { lane: lane.name, deps: awaitedStill, run }
  }
  return undefined
}
