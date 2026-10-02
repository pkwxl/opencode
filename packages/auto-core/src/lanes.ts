// The lane scheduler (plans/0068 §6.2, stage S1): the pure, inert readiness
// layer of the lanes design — the scheduler functions with no caller outside
// tests, reading the registry fields src/tasks.ts now carries (0051 D3's
// `worktree` field, built at last). Delivered alone it changes no behavior:
// the task loop still selects through next(), --max-sessions still refuses
// every value above 1 at preflight, and the lane loop that will drive this
// module is S3's.
//
// select.ts is the style precedent: a pure core over injected facts. Every
// function here is a function of its arguments — the loaded plan, the merged
// unit states, the runtime registry view, the parent's in-flight lanes —
// never of module state, services or the clock:
//   - readyUnits (D5): the readiness predicate — nextReady plus two clauses,
//     declared-Touches disjointness and a free slot;
//   - laneEligible (D15): the nested-repo exclusion;
//   - syncIndexTicks (D7 step ③): the landing-side write that re-derives the
//     phase index ticks from the merged unit states — the load-time scan's
//     inverse, a driver-exclusive write (D6);
//   - parseLaneReport / laneOutcome (D8, §6.2): the lane report's contract
//     and the failure matrix mapping a lane exit to the parent's action.
//
// The admission rule is deliberately level-independent (D5): `Touches` stays
// advisory — a wrong declaration surfaces as a landing conflict (D7), never
// as corruption — and the `parallel` level's merge-relevant meaning lives in
// the landing-conflict response (D21), never here.
//
// Stage S2 adds the effectful halves this module's callers drive (§6.5): the
// protocol paths (branch, park, report), the dispatch choreography (attempts
// bookkeeping, worktree creation or reuse, the scaffolding copy, the spawn
// through the profile's launcher) and the landing choreography (D7's five
// steps over the git seam). Pure and effectful sit beside each other on
// purpose — one domain, one file; the loop that sequences them (the serial
// isolation loop of src/loop-task.ts) stays above, and nothing here imports a
// loop or a session-driving module (the import-direction rule).
import { cp, mkdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { parseIndex, resolveDepends, scanUnitStates, type UnitDecl } from "./document/unit"
import { deleteBranch, mergeBaseSha, repoRoots, unitViolations, type GitOps } from "./git"
import { log } from "./log"
import { statsLaneUsage } from "./stats"
import { defaultLaneLauncher, shellProfile, type LaneWorker } from "./shell"
import { begin, clearLane, laneRecords, setLane, taskIndexPath, type Plan, type PlanPhase, type Task } from "./tasks"

// —— The readiness predicate (D5) ——

// The runtime registry view of one unit (.auto/units.json's scheduling
// fields, sanitized by the reader): `status` — in_progress marks a unit
// executing somewhere — and the lane fields D14's orphan scan reads.
export type LaneRuntime = { status?: "in_progress" | "blocked"; worktree?: string; pid?: number }

// One live lane of the parent's in-flight set, keyed by the unit id: the
// unit's declared `Touches` set, the one fact the disjointness clause reads.
export type InFlightLane = { touches?: string[] }

// Path segments of a repository-relative path: separators normalized,
// empty and "." parts dropped, so `src/dma/`, `src\dma` and `./src/dma`
// read the same.
const segments = (path: string): string[] => path.split(/[\\/]+/).filter((part) => part !== "" && part !== ".")

// Whether two repository-relative paths overlap: the shorter one's segments
// are a prefix of the other's (a directory contains every path inside it;
// equal paths overlap; an empty path is everything). This is the module's
// only path relationship — disjointness is the admission rule, containment
// the nested-root test.
function pathsOverlap(a: string, b: string): boolean {
  const sa = segments(a)
  const sb = segments(b)
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) if (sa[i] !== sb[i]) return false
  return true
}

// D5's disjointness clause: two units run side by side only when their
// declared `Touches` sets are path-disjoint. A missing (or empty) declaration
// touches everything (G3) and overlaps every set — including another such
// unit's — so it is never parallel.
function touchesDisjoint(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || a.length === 0 || b === undefined || b.length === 0) return false
  return !a.some((path) => b.some((other) => pathsOverlap(path, other)))
}

const disjointFromAll = (touches: string[] | undefined, others: readonly (string[] | undefined)[]): boolean =>
  others.every((other) => touchesDisjoint(touches, other))

// The plan's declarations with `Touches` kept — declOf in the task store
// drops it (the serial selector never reads it; the scheduler does).
const declWithTouches = (task: Task): UnitDecl => ({
  id: task.id,
  ...(task.depends !== undefined ? { depends: task.depends } : {}),
  ...(task.touches !== undefined ? { touches: task.touches } : {}),
})

// The ready set (D5): every unit that may be dispatched now, in index order
// (nextReady's tie-break). A unit is ready when
//   1. it passes nextReady's predicate — not done, its effective
//      prerequisites all done — over the merged `states`, not the plan's own
//      statuses (the scheduler's view may be fresher than a reloaded plan;
//      the state files are the fact). Dependencies outside the index count
//      as done exactly as in next(): loadPlan admits an external id only as
//      a completed task;
//   2. it is executing nowhere — no live lane of its own, and no in_progress
//      entry in the registry (a lane, or D4's serial degrade in the main
//      tree);
//   3. its declared `Touches` are disjoint from every in-flight lane's —
//      a unit that declares nothing touches everything and waits;
//   4. a slot is free: every lane in flight occupies one of the run's
//      `slots` (--max-sessions), and the set stops at the free remainder.
// At one slot with an empty in-flight set (and nothing in_progress) this is
// exactly today's next(): clause 3 is vacuous, clause 4 admits one unit, and
// clauses 1–2 are next()'s own.
// AUTO-DECISION: the disjointness clause is also checked against the units
// the same call has already admitted (the returned set is dispatched
// together, so it must be mutually disjoint, not only disjoint from what
// was in flight before; greedy index order is the order the loop dispatches
// the batch in, so this equals re-deriving the set after every dispatch).
export function readyUnits(
  plan: Plan,
  states: ReadonlySet<string>,
  runtime: ReadonlyMap<string, LaneRuntime>,
  inFlight: ReadonlyMap<string, InFlightLane>,
  slots: number,
): Task[] {
  const own = new Set(plan.tasks.map((task) => task.id))
  const done = new Set(states)
  for (const task of plan.tasks) {
    if (Array.isArray(task.depends)) for (const dep of task.depends) if (!own.has(dep)) done.add(dep)
  }
  const busy = new Set(inFlight.keys())
  for (const [id, entry] of runtime) if (entry.status === "in_progress") busy.add(id)
  const free = Math.max(0, slots - inFlight.size)
  const deps = resolveDepends(plan.tasks.map(declWithTouches))
  const out: Task[] = []
  for (const task of plan.tasks) {
    if (out.length >= free) break
    if (done.has(task.id) || busy.has(task.id)) continue
    if (!(deps.get(task.id) ?? []).every((dep) => done.has(dep))) continue
    if (!disjointFromAll(task.touches, [...[...inFlight.values()].map((lane) => lane.touches), ...out.map((admitted) => admitted.touches)])) continue
    out.push(task)
  }
  return out
}

// D15's exclusion: a lane worktree materializes only the main repository —
// nested repos are copied in, and their commits cannot land through the
// main-repo merge — so a unit whose declared `Touches` reach a nested-repo
// root is not lane-eligible and runs through D4's serial degrade. A unit
// that declares nothing stays eligible: the landing check (nested HEADs
// differ from the lane baseline) is the backstop for undeclared movement.
// AUTO-DECISION: the reach test is overlap, not strict containment — a unit
// declaring the parent of a nested root (`Touches: vendor/` over the root
// `vendor/lib/`) touches the nested repo as surely as one declaring a path
// inside it, and a lane that cannot land is a wasted dispatch either way
// (D15 words the rule as "paths under a root"; the parent covers them).
export function laneEligible(task: Pick<Task, "touches">, nestedRoots: readonly string[]): boolean {
  if (task.touches === undefined) return true
  return !task.touches.some((path) => nestedRoots.some((root) => pathsOverlap(path, root)))
}

// —— The landing-side tick sync (D7 step ③) ——

// Re-derive the phase index's ticks from the merged unit states: the inverse
// of the load-time scan — the state files are the fact, and every member
// line's tick is set to exactly that (a landed unit's line gains its tick; a
// tick without its done.md loses it). Driver-exclusive (D6: the parent
// re-derives the ticks at landing); a missing index is a no-op, index
// problems are the loader's to report, and lines that are not member lines
// stay untouched. Returns the ids whose marks changed.
export async function syncIndexTicks(dir: string, phase: PlanPhase): Promise<string[]> {
  const file = join(dir, taskIndexPath(phase))
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text === undefined) return []
  const parsed = parseIndex(text, "task")
  if (!parsed.entries.length) return []
  const scan = await scanUnitStates(dir, parsed.entries.map((entry) => ({ level: "task" as const, id: entry.id })))
  const lines = text.split("\n")
  const changed: string[] = []
  for (const entry of parsed.entries) {
    const mark = scan.done.has(entry.id) ? "x" : " "
    const raw = lines[entry.line - 1]!
    const next = raw.replace(/^([-*] \[)[ xX](\])/, `$1${mark}$2`)
    if (next !== raw) {
      lines[entry.line - 1] = next
      changed.push(entry.id)
    }
  }
  if (changed.length) await Bun.write(file, lines.join("\n"))
  return changed
}

// —— The lane report (D8) ——

// The structured outcome a lane entry writes to `.auto/lane.json` in its
// worktree at every exit it controls; the parent reads it after process
// exit, and its absence (crash, kill) is the orphan signal (D14). Field
// names are protocol strings (plans/0068 §8); `result` reuses the
// `Result: PASS|FAIL` semantics verbatim. `split` is S5's field — carried
// opaquely until that stage types it.
export type LaneReport = {
  unit: string
  phase: string
  ok: boolean
  result?: "PASS" | "FAIL"
  blocked?: string
  usage: { tokens: number; wallMs: number }
  sessions: number
  commits: string[]
  agent: string
  models: string[]
  split?: Record<string, unknown>
}

const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const finiteCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
const integerCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string")

// Parse and sanitize a lane report's JSON text; undefined when it is not a
// report — unparseable, not an object, or missing/mistyping any field of the
// D8 contract (a wrong `result` value or a non-object `split` included). The
// registry parsers' rule, applied at a protocol boundary: a record that does
// not carry the contract is not a record, and the caller treats it as the
// orphan signal (laneOutcome below folds that in).
export function parseLaneReport(json: string): LaneReport | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!plainObject(raw) || !plainObject(raw.usage)) return undefined
  if (typeof raw.unit !== "string" || raw.unit === "") return undefined
  if (typeof raw.phase !== "string" || typeof raw.ok !== "boolean" || typeof raw.agent !== "string") return undefined
  const usage = raw.usage
  if (!finiteCount(usage.tokens) || !finiteCount(usage.wallMs)) return undefined
  if (!integerCount(raw.sessions)) return undefined
  if (!stringList(raw.commits) || !stringList(raw.models)) return undefined
  if (raw.result !== undefined && raw.result !== "PASS" && raw.result !== "FAIL") return undefined
  if (raw.blocked !== undefined && typeof raw.blocked !== "string") return undefined
  if (raw.split !== undefined && !plainObject(raw.split)) return undefined
  return {
    unit: raw.unit,
    phase: raw.phase,
    ok: raw.ok,
    usage: { tokens: usage.tokens, wallMs: usage.wallMs },
    sessions: raw.sessions,
    commits: raw.commits,
    agent: raw.agent,
    models: raw.models,
    ...(raw.result !== undefined ? { result: raw.result } : {}),
    ...(raw.blocked !== undefined ? { blocked: raw.blocked } : {}),
    ...(raw.split !== undefined ? { split: raw.split } : {}),
  }
}

// The parent's action for one lane exit (§6.2's failure matrix). The land /
// blocked / environment outcomes carry the report (the exit-2 message names
// the unit and it; the exit-1 relay comes from the captured output, D13).
// The orphan outcome carries nothing: D14's protocol decides await /
// re-dispatch / block from the registry (worktree, pid) and the pid's
// liveness, never from the exit.
export type LaneOutcome =
  | { kind: "land"; report: LaneReport }
  | { kind: "blocked"; report: LaneReport }
  | { kind: "environment"; report: LaneReport }
  | { kind: "orphan" }

// §6.2's failure matrix:
//   0 + ok           → land (D7), mark done, continue scheduling;
//   2 + blocked/FAIL → stop scheduling new lanes, drain, land the blocked
//                      lane's committed work, exit 2 naming unit and report;
//   1                → environment error is global: stop scheduling, drain,
//                      exit 1 with the relayed lines;
//   crash / no report → orphan protocol (D14).
// AUTO-DECISION: the two shapes the table does not name map conservatively —
// a report that is absent (or fails parseLaneReport's contract) is the
// orphan outcome for every exit code (D8: every controlled exit writes the
// report, so its absence means the lane did not control its exit, whatever
// code the corpse left), and a code/report contradiction (0 with a failing
// report, 2 with a clean one) is the blocked outcome, never land — a
// contract violation the parent cannot interpret stops scheduling rather
// than merging on trust.
export function laneOutcome(code: number, report: LaneReport | undefined): LaneOutcome {
  if (report === undefined) return { kind: "orphan" }
  if (code === 1) return { kind: "environment", report }
  if (code === 0 && report.ok && report.result !== "FAIL" && report.blocked === undefined) return { kind: "land", report }
  return { kind: "blocked", report }
}

// —— The protocol paths (§8: all new English literals, registered) ——

// The lane branch grammar: `auto-lane/<task-id>`, stable across a task's
// retries (D16 — a re-dispatched lane resumes on the same branch).
export const laneBranch = (unit: string): string => `auto-lane/${unit}`

// The park path of a unit's lane, relative to the target directory: the
// worktree lives under `.auto/worktrees/` (D16), gitignored with the rest of
// `.auto/` and skipped by repoRoots' walk (F6).
export const lanePark = (unit: string): string => join(".auto", "worktrees", unit)

// The lane report file inside a lane's worktree (D8): written by the lane
// entry at every exit it controls, read by the parent after process exit.
export const laneReportFile = (): string => join(".auto", "lane.json")

// Write the lane report (the lane entry's close-out; D8). Directory-safe:
// the worktree's `.auto/` may not exist yet when a lane exits early.
export async function writeLaneReport(dir: string, report: LaneReport): Promise<void> {
  const file = join(dir, laneReportFile())
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(file, `${JSON.stringify(report, null, 2)}\n`)
}

// Read and sanitize the lane report of a lane's worktree; undefined when the
// file is absent (the orphan signal, D14) or fails the contract.
export async function readLaneReport(dir: string): Promise<LaneReport | undefined> {
  const text = await Bun.file(join(dir, laneReportFile())).text().catch(() => undefined)
  return text === undefined ? undefined : parseLaneReport(text)
}

// —— Dispatch (§6.5, parent side) ——

// The outcome of one dispatch: the spawned worker beside its worktree, or the
// failure that stopped scheduling (the caller blocks naming the error).
// `fresh` distinguishes a created worktree from a re-dispatch's reuse of the
// recorded one (the kill-resume property: same worktree, own progress).
export type LaneDispatch =
  | { type: "spawned"; worktree: string; worker: LaneWorker; fresh: boolean }
  | { type: "failed"; error: string }

// The scaffolding a fresh git worktree lacks (F7): the untracked, gitignored
// local-only state a lane's preflight and sessions need. `.gitignore` rides
// along although F7's list does not name it: init ignores the file itself
// (gitignore.ts INIT_ENTRIES), so a fresh worktree does not carry it, and
// without it the worktree's own `.auto/` and `tmp/` would surface as
// untracked dirt at every clean gate.
// AUTO-DECISION (`.gitignore` in the copy set): without the copy the lane's
// first beginUnit sees `.auto/` as untracked and blocks — the copy is the
// one-line fix and costs nothing (the file is local-only state by design).
const SCAFFOLD_FILES = [".gitignore", ".opencode", "opencode.json", "AGENTS.md"]

// One dispatch (§6.5 ①–⑤): attempts bookkeeping through begin, the worktree —
// created at the parent's current HEAD on the lane branch, or reused when the
// registry records one for the unit (a crashed lane's scene: the re-dispatch
// resumes in the same worktree, D14) — the scaffolding copy into a fresh
// worktree, and the spawn through the profile's launcher.
// AUTO-DECISION (spawn before the runtime-field write): §6.5 orders ④ the
// fields before ⑤ the spawn, but the pid half of the record exists only once
// the worker process does; writing worktree and pid together after the spawn
// keeps the registry entry atomic (a record naming a pid that was never
// spawned would read as a dead orphan).
export async function dispatchLane(gitOps: GitOps, dir: string, task: Pick<Task, "id" | "title">): Promise<LaneDispatch> {
  const record = (await laneRecords(dir)).find((entry) => entry.unit === task.id)
  const park = join(dir, lanePark(task.id))
  const branch = laneBranch(task.id)
  await begin(dir, task.id)
  let fresh = false
  if (record === undefined) {
    if (await stat(park).then(() => true, () => false)) {
      return { type: "failed", error: `a worktree already exists at ${lanePark(task.id)} with no lane record for ${task.id}; remove it manually (git worktree remove ${park}) and re-run` }
    }
    const added = await gitOps.addWorktree(dir, park, branch)
    if (!added.ok) return { type: "failed", error: `creating the lane worktree failed: ${added.error}` }
    fresh = true
  } else {
    const reuse = join(dir, record.worktree)
    if (!(await stat(reuse).then(() => true, () => false))) {
      return { type: "failed", error: `the lane record of ${task.id} names ${record.worktree}, which no longer exists; remove the record (.auto/units.json) or restore the worktree and re-run` }
    }
    log(`↻ ${task.id} re-dispatching its lane in the existing worktree ${record.worktree} (the lane resumes from its own progress record)`)
  }
  if (fresh) {
    const copied = await copyScaffolding(dir, park)
    if (copied !== undefined) {
      // The worktree is empty of everything but the checkout; tearing it back
      // down keeps the park clean for the retry.
      await gitOps.removeWorktree(dir, park)
      await deleteBranch(dir, branch)
      return { type: "failed", error: copied }
    }
  }
  const launch = shellProfile().laneLauncher ?? defaultLaneLauncher
  let worker: LaneWorker
  try {
    worker = launch(fresh ? park : join(dir, record!.worktree), task.id)
  } catch (error) {
    if (fresh) {
      await gitOps.removeWorktree(dir, park)
      await deleteBranch(dir, branch)
    }
    return { type: "failed", error: `spawning the lane worker failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  const worktree = fresh ? park : join(dir, record!.worktree)
  await setLane(dir, task.id, { worktree: relative(dir, worktree), ...(worker.pid !== undefined ? { pid: worker.pid } : {}) })
  return { type: "spawned", worktree, worker, fresh }
}

// Copy the scaffolding into a fresh lane worktree (§6.5 ③). The F7 set is
// required (a missing file simply does not exist in this project); a copy
// failure of it fails the dispatch. Best-effort beside it (D12/D15): the
// parent's learned quota windows, and every nested repository's content —
// copied whole so builds and tests work inside the lane (their commits live
// in the copy and cannot land through the main-repo merge, D15's rule).
// Returns the error that failed the dispatch, or undefined.
async function copyScaffolding(dir: string, worktree: string): Promise<string | undefined> {
  for (const rel of SCAFFOLD_FILES) {
    const src = join(dir, rel)
    if (!(await stat(src).then(() => true, () => false))) continue
    try {
      await cp(src, join(worktree, rel), { recursive: true })
    } catch (error) {
      return `copying ${rel.replaceAll("\\", "/")} into the lane worktree failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  // The parent's learned quota windows (D12): a lane's quota waits start
  // informed; lane-learned windows are discarded at teardown either way.
  const windows = join(dir, ".auto", "windows.json")
  if (await stat(windows).then(() => true, () => false)) {
    await cp(windows, join(worktree, ".auto", "windows.json")).catch(() => log(`⚠ copying .auto/windows.json into the lane worktree failed; the lane starts without the learned quota windows`))
  }
  for (const root of (await repoRoots(dir)).filter((root) => root !== dir)) {
    const rel = relative(dir, root)
    await cp(root, join(worktree, rel), { recursive: true }).catch(() => log(`⚠ copying the nested repository ${rel.replaceAll("\\", "/")} into the lane worktree failed; the lane runs without it`))
  }
  return undefined
}

// The lane worker's exit: drain the piped output (a full pipe would deadlock
// the child long before it finishes) and read its code. A signal kill
// resolves Bun's exit promise to null; every such code is the crash
// vocabulary's, and laneOutcome decides by the report's absence anyway.
export async function laneExit(worker: LaneWorker): Promise<{ code: number; output: string }> {
  const read = (stream: ReadableStream<Uint8Array> | null | undefined) => (stream ? new Response(stream).text().catch(() => "") : "")
  const [out, err, code] = await Promise.all([read(worker.stdout), read(worker.stderr), worker.exited])
  return { code: typeof code === "number" ? code : 137, output: `${out}${err}` }
}

// —— Landing (D7, parent side) ——

// The outcome of one landing: landed (with whether the teardown fully
// succeeded — a failed cleanup of an already-merged branch is a warning, the
// park entry is cleared either way), conflict (the merge aborted, the main
// tree clean again, the lane's scene kept for the conflict protocol), or
// blocked (the landing refused — verification, the merge itself, or the
// landing-sync commit; the caller stops scheduling and exits 2).
export type Landing = { type: "landed"; teardown: boolean } | { type: "conflict"; detail: string } | { type: "blocked"; error: string }

// D7's five steps, serialized in this one caller (the serial loop's await is
// the mutex): ① verify the lane branch — unitViolations over the merge-base
// baseline (only Auto-Stage commits inside the lane, the worktree clean);
// ② the `--no-ff` merge carrying `Auto-Stage: landing`; ③ re-derive the phase
// index ticks from the merged unit states, committed as `Auto-Stage:
// landing-sync`; ④ clear the lane runtime fields and book the report's
// usage; ⑤ tear down the worktree and delete the branch.
// The conflict path aborts the merge and keeps the lane's scene (worktree,
// branch and registry record) for D21's level-derived response — S2 blocks
// immediately (the `low` posture); the repair budget is S3's.
export async function landLane(
  gitOps: GitOps,
  dir: string,
  phase: PlanPhase,
  task: Pick<Task, "id" | "title">,
  report: LaneReport,
): Promise<Landing> {
  const worktree = join(dir, lanePark(task.id))
  const branch = laneBranch(task.id)
  // ① verify the lane branch.
  const base = await mergeBaseSha(dir, "HEAD", branch)
  if (base === undefined) return { type: "blocked", error: `deriving the lane baseline of ${task.id} failed (merge-base of HEAD and ${branch}); the lane scene is kept at ${lanePark(task.id)}` }
  const violations = await unitViolations(worktree, [{ root: worktree, sha: base }])
  if (violations.length) {
    return { type: "blocked", error: `the lane branch of ${task.id} failed the close-out check (${violations.join("; ")}); the lane scene is kept at ${lanePark(task.id)} for inspection` }
  }
  // ② the landing merge.
  const landed = await gitOps.landBranch(dir, branch, task)
  if (landed.type === "conflict") return { type: "conflict", detail: landed.detail }
  if (landed.type === "failed") return { type: "blocked", error: `landing ${branch} failed: ${landed.error}` }
  // ③ the tick re-derivation, committed as landing-sync.
  await syncIndexTicks(dir, phase)
  const settled = await gitOps.commitTree(dir, task, { stage: "landing-sync", subject: `${task.id} landing-sync ${task.title}` })
  if (!settled.ok) {
    // The merge itself is in and the unit's files are the fact; the ticks are
    // cosmetic (D7 step ③'s own note). Finish the landing (④⑤ below keep the
    // park clean) and hand the uncommitted sync to the human.
    await clearLane(dir, task.id)
    await statsLaneUsage(dir, task.id, { tokens: report.usage.tokens, wallMs: report.usage.wallMs, sessions: report.sessions })
    await teardownLane(gitOps, dir, task.id)
    return { type: "blocked", error: `the landing-sync commit of ${task.id} failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. The merge landed; commit the index ticks manually and re-run` }
  }
  // ④ the runtime fields and the report's usage.
  await clearLane(dir, task.id)
  await statsLaneUsage(dir, task.id, { tokens: report.usage.tokens, wallMs: report.usage.wallMs, sessions: report.sessions })
  // ⑤ teardown.
  const teardown = await teardownLane(gitOps, dir, task.id)
  return { type: "landed", teardown }
}

// D7's step ⑤: remove the worktree, delete the merged branch. Best-effort
// with a warning — after a landed merge the leftovers are inert (the record
// is cleared, the branch merged), and a blocked exit over them would strand
// a park nothing references. Returns whether both fully succeeded.
async function teardownLane(gitOps: GitOps, dir: string, unit: string): Promise<boolean> {
  const worktree = join(dir, lanePark(unit))
  const branch = laneBranch(unit)
  const removed = await gitOps.removeWorktree(dir, worktree)
  if (!removed.ok) log(`⚠ removing the lane worktree ${lanePark(unit)} failed: ${removed.error} (the lane landed; clean up manually)`)
  const deleted = await deleteBranch(dir, branch)
  if (!deleted.ok) log(`⚠ deleting the lane branch ${branch} failed: ${deleted.error} (the lane landed; clean up manually)`)
  return removed.ok && deleted.ok
}
