// The lane scheduler (plans/0068 §6.2): the readiness layer of the lanes
// design — the scheduler functions over the registry fields src/tasks.ts
// carries (0051 D3's `worktree` field, built at last). At stage S1 the module
// was pure and inert; S2 added the dispatch and landing choreography (§6.5)
// and S3 the activation rule (D10), the conflict-repair policy (D21) and the
// orphan-recovery inputs (D14: the liveness probe, the dispatch cap). S4
// added the observability surfaces of D13: the prefix relay every dispatch
// attaches (the parent re-emits each lane worker's output through its own
// log with a `[<task-id>]` prefix), the usage detail the lane report carries
// for the stats roll-up, and the parent-level lane events shaped for the
// 0067 bus (§6.7). S6 added §10's risk hardening on the dispatch side: the
// park path-length guard (Windows' MAX_PATH) that blocks a dispatch before
// anything is created; the teardown retry half lives in src/git.ts's
// removeWorktree, and the lane-log retention choice — the worktree's own
// `.auto/logs/` is discarded at teardown, the parent's relayed audit log
// keeps the run story (§11 item 6, the recommendation taken) — is the
// contract the relay implements. The loops that drive it live above, in
// src/loop-task.ts — the serial isolation loop of the rollout switch and,
// since S3, the readiness scheduler's concurrent lane loop; nothing here
// imports a loop or a session-driving module (the import-direction rule).
//
// select.ts is the style precedent: a pure core over injected facts. The
// readiness half is a function of its arguments — the loaded plan, the merged
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
// the landing-conflict response (D21), never in the admission.
import { cp, mkdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { parseIndex, resolveDepends, scanUnitStates, type UnitDecl } from "./document/unit"
import { checklistPrerequisites, subtaskId } from "./document/state"
import { deleteBranch, mergeBaseSha, repoRoots, unitViolations, type GitOps, type UnitBaseline } from "./git"
import type { ParallelLevel } from "./intent/types"
import { log } from "./log"
import { emitStatus } from "./run-status"
import { statsLaneUsage, type LaneUsageDetail } from "./stats"
import { splitTaken } from "./split"
import { taskDoc } from "./docpaths"
import { defaultLaneLauncher, shellProfile, type LaneMergeInstruction, type LaneWorker } from "./shell"
import { begin, checklistTitle, clearLane, laneRecords, setLane, setSplit, syncChecklistTicks, taskIndexPath, UNITS_FILE, type Plan, type PlanPhase, type Task } from "./tasks"

// —— Activation and policy (D10, D21) ——

// D10's activation rule: the readiness scheduler runs the routed phase's units
// concurrently iff --max-sessions is at least 2 and the project configured a
// parallel level (config `parallel`; absent and `none` both mean none). At
// maxSessions = 1 (the default) the scheduler is off for any project whatever
// the level — the byte-identical floor: same loops, same prompts, same
// goldens. A maxSessions above 1 with no level never reaches this function as
// "active": preflight refuses it as a usage error first ("plan for
// parallelism first").
export function schedulerActive(maxSessions: number | undefined, parallel: ParallelLevel | undefined): boolean {
  return (maxSessions ?? 1) >= 2 && parallel !== undefined
}

// D21's level-derived landing-conflict response: `low` blocks immediately
// (zero session repairs — a conflict at low is a plan defect, and low's
// posture spends no tokens on merge repair); `medium`/`high` allow one
// repair re-dispatch (D7's merge instruction) before blocking. No level
// (none) never conflicts-with-repair: without it the scheduler is off and
// the serial path has no landings — the answer reads false all the same.
export function conflictRepair(level: ParallelLevel | undefined): boolean {
  return level === "medium" || level === "high"
}

// The dispatch attempts cap of D14's orphan recovery: a crashed lane is
// re-dispatched automatically only while its unit's attempts stay below this
// (begin books every dispatch); at the cap the scene blocks naming the park
// path — the deterministic automatic escalation this house style permits
// (D21's own words). Attempts survive runs, so the cap also bounds recovery
// across re-runs, never only inside one pass.
export const LANE_DISPATCH_CAP = 3

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
// `Result: PASS|FAIL` semantics verbatim. `split` is S5's field, typed at
// last (§6.8): a lead's taken split — the stream count and the split point
// (per-repo SHAs, recorded in the lead worktree's own coordinates and
// re-rooted by the parent at landing); absent on a lead that took no split
// and on every stream's own report.
export type LaneSplit = { items: number; baseline: { root: string; sha: string }[] }

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
  split?: LaneSplit
  // The usage detail of the S4 roll-up (D13): the lane's own task bucket's
  // usage breakdown and per-model/per-tier sections, so the parent's stats
  // keep their per-model and per-tier lines working under the scheduler
  // without reading the worktree's discarded document. A new protocol field
  // beside D8's registered names (the §8 registration list's own grammar,
  // appended there with this stage); absent on a report an older shape wrote.
  detail?: LaneUsageDetail
}

const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const finiteCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
const integerCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string")

// S5's split field (§6.8): a positive item count and the split point as the
// unit baseline's own `{ root, sha }` grammar.
const parseLaneSplit = (raw: unknown): LaneSplit | undefined => {
  if (!plainObject(raw)) return undefined
  if (!integerCount(raw.items) || raw.items < 1) return undefined
  if (!Array.isArray(raw.baseline)) return undefined
  const baseline: { root: string; sha: string }[] = []
  for (const entry of raw.baseline) {
    if (!plainObject(entry) || typeof entry.root !== "string" || typeof entry.sha !== "string") return undefined
    baseline.push({ root: entry.root, sha: entry.sha })
  }
  return { items: raw.items, baseline }
}

// One usage figure of the detail, leniently (the registry parsers' rule: a
// field that is not a finite number reads as 0, never a throw).
const usageFigure = (raw: Record<string, unknown>, key: string): number => (typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : 0)

const parseUsageDetail = (raw: unknown): LaneUsageDetail | undefined => {
  if (!plainObject(raw)) return undefined
  const usage = plainObject(raw.usage) ? raw.usage : undefined
  if (usage === undefined) return undefined
  const detail: LaneUsageDetail = {
    usage: {
      input: usageFigure(usage, "input"),
      output: usageFigure(usage, "output"),
      reasoning: usageFigure(usage, "reasoning"),
      cacheRead: usageFigure(usage, "cacheRead"),
      cacheWrite: usageFigure(usage, "cacheWrite"),
      cost: usageFigure(usage, "cost"),
      steps: usageFigure(usage, "steps"),
    },
  }
  // Per-model and per-tier records, the stats module's own shapes restated:
  // a bad entry is skipped, an empty result stays absent.
  if (plainObject(raw.models)) {
    const models: NonNullable<LaneUsageDetail["models"]> = {}
    for (const [name, value] of Object.entries(raw.models)) {
      if (!plainObject(value) || !plainObject(value.usage)) continue
      const u = value.usage
      models[name] = {
        usage: {
          input: usageFigure(u, "input"),
          output: usageFigure(u, "output"),
          reasoning: usageFigure(u, "reasoning"),
          cacheRead: usageFigure(u, "cacheRead"),
          cacheWrite: usageFigure(u, "cacheWrite"),
          cost: usageFigure(u, "cost"),
          steps: usageFigure(u, "steps"),
        },
        sessions: usageFigure(value, "sessions"),
        fails: usageFigure(value, "fails"),
        stuckHints: usageFigure(value, "stuckHints"),
        reprompts: usageFigure(value, "reprompts"),
      }
    }
    if (Object.keys(models).length) detail.models = models
  }
  if (plainObject(raw.tiers)) {
    const tiers: NonNullable<LaneUsageDetail["tiers"]> = {}
    for (const [name, value] of Object.entries(raw.tiers)) {
      if (!plainObject(value) || !plainObject(value.usage)) continue
      const u = value.usage
      tiers[name] = {
        usage: {
          input: usageFigure(u, "input"),
          output: usageFigure(u, "output"),
          reasoning: usageFigure(u, "reasoning"),
          cacheRead: usageFigure(u, "cacheRead"),
          cacheWrite: usageFigure(u, "cacheWrite"),
          cost: usageFigure(u, "cost"),
          steps: usageFigure(u, "steps"),
        },
        sessions: usageFigure(value, "sessions"),
      }
    }
    if (Object.keys(tiers).length) detail.tiers = tiers
  }
  return detail
}

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
  // A split that is present but malformed rejects the report (the registry
  // parsers' strictness at a protocol boundary the parent acts on), rather
  // than dropping the field and landing a lead whose streams no one schedules.
  const split = parseLaneSplit(raw.split)
  if (raw.split !== undefined && split === undefined) return undefined
  const detail = parseUsageDetail(raw.detail)
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
    ...(split !== undefined ? { split } : {}),
    ...(detail !== undefined ? { detail } : {}),
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

// —— The stream lane units (S5: D3's stage 2, §6.8) ——

// The stream lane unit grammar: `T-NNN.S<nn>` — the task id and the subtask
// positional id in one scheduling key (§8's registration; it flows into the
// branch and park grammars unchanged).
export const streamUnitId = (task: string, index: number): string => `${task}.${subtaskId(index)}`

// The owning task and the 1-based item of a stream unit id; undefined = a
// plain task unit.
export function streamUnitOf(unit: string): { task: string; index: number } | undefined {
  const match = /^(T-\d+)\.S(\d{2,})$/.exec(unit)
  return match ? { task: match[1]!, index: Number(match[2]!) } : undefined
}

// The stream units of a task whose lead's split was taken (§6.8): one
// T-NNN.S<nn> per checklist item, its done flag from the merged state files,
// `Depends:` the item's sibling ids by their qualified names (G3's
// previous-item default resolved here — the expanded set has no index
// adjacency to derive it from), `Touches:` the S<nn>/todo.md field block
// (the split guard's writer derives it from the line's `Artifacts:`).
// undefined = no taken split on record: the task stays whole — one lane
// running its own streams in-lane, the serial world's shape.
export async function streamUnits(dir: string, task: Pick<Task, "id" | "split" | "checklist">): Promise<Task[] | undefined> {
  const items = task.checklist ?? []
  if (task.split === undefined || !items.length) return undefined
  if (!(await splitTaken(dir, task.id, items.length))) return undefined
  return items.map((item, i) => {
    const deps = checklistPrerequisites(items, i + 1)
    return {
      id: streamUnitId(task.id, i + 1),
      title: checklistTitle(item.text),
      status: item.done ? ("done" as const) : ("pending" as const),
      attempts: 0,
      body: "",
      // A dependent stream names its siblings by their qualified ids; a root
      // stream declares none explicitly (never the G3 default — the expanded
      // set's previous entry is another task's unit).
      ...(deps.length ? { depends: deps.map((dep) => streamUnitId(task.id, Number(dep.slice(1)))) } : { depends: "none" as const }),
      ...(item.touches !== undefined ? { touches: item.touches } : {}),
      checklist: [],
    }
  })
}

// A split baseline's roots are absolute paths of the checkout the record was
// written in (repoRoots of the writer); re-root them onto another checkout
// of the same object store — the parent's main tree at landing, a fresh
// stream worktree at dispatch. Every root sits under `from`, so the mapping
// is each root's path relative to it, joined onto `to`.
export function reRootSplit(baseline: readonly { root: string; sha: string }[], from: string, to: string): { root: string; sha: string }[] {
  return baseline.map(({ root, sha }) => ({ root: join(to, relative(from, root)), sha }))
}

// —— The protocol paths (§8: all new English literals, registered) ——

// The lane branch grammar: `auto-lane/<task-id>`, stable across a task's
// retries (D16 — a re-dispatched lane resumes on the same branch).
export const laneBranch = (unit: string): string => `auto-lane/${unit}`

// The park path of a unit's lane, relative to the target directory: the
// worktree lives under `.auto/worktrees/` (D16), gitignored with the rest of
// `.auto/` and skipped by repoRoots' walk (F6).
export const lanePark = (unit: string): string => join(".auto", "worktrees", unit)

// §10's park path-length guard (the S6 hardening row): Windows caps paths at
// 260 characters (MAX_PATH) unless the system opts into longer ones, and a
// lane worktree prefixes every file it holds — the checkout's repo-relative
// tails plus its own untracked state (`.auto/lane.json`, `.auto/logs/…`,
// `tmp/…`) — with `<target>/.auto/worktrees/<unit>`, so a deep target
// directory turns worktree operations into cryptic git failures ("Filename
// too long", a half-created checkout). The guard blocks the dispatch before
// anything is created, naming the park path and its length — block-with-path,
// never a silent loss. The margin reserves room for the worktree's own state
// files and a typical repo-relative tail; other platforms carry no comparable
// bound, so no check runs there.
// AUTO-DECISION (platform-gated): the bound is a Windows fact, so the guard
// reads `process.platform` (injectable only for tests) rather than applying
// one arbitrary limit everywhere — a 220-character park path is unremarkable
// on a system whose limit is 1024+.
// AUTO-DECISION (join, not resolve): the run directory is absolute in
// practice (every shell resolves it before runAll), and a resolve() here
// would fold this host's cwd into a Windows-shaped path the guard is only
// ever measuring — join keeps the check a pure function of its arguments.
export const WINDOWS_MAX_PATH = 260
export const PARK_PATH_MARGIN = 40

export function laneParkProblem(dir: string, unit: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "win32") return undefined
  const park = join(dir, lanePark(unit))
  if (park.length + PARK_PATH_MARGIN <= WINDOWS_MAX_PATH) return undefined
  return `the lane worktree path ${park} is ${park.length} characters; the worktree's files under it would pass Windows' ${WINDOWS_MAX_PATH}-character path limit. Move the project to a shallower directory, or run serially (--max-sessions 1 / without a parallel level)`
}

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
// `output` is the prefix relay's full-text promise (below): the drain — and
// the live relay — started at dispatch, before the spawn call even returned
// to the loop.
export type LaneDispatch =
  | { type: "spawned"; worktree: string; worker: LaneWorker; fresh: boolean; output: Promise<string> }
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
// worktree, and the spawn through the profile's launcher. The optional
// instruction is D7's merge instruction, carried only by a conflict repair's
// re-dispatch (which is always a re-use dispatch: the repair happens on a lane
// whose scene the conflict kept). The optional seed is S5's: a stream lane's
// fresh worktree starts with the owning task's split record in its own
// .auto/units.json (re-rooted onto the worktree's paths), so the worker reads
// Task.split exactly as the serial world does — a re-dispatch's worktree keeps
// the record its earlier dispatch wrote.
// AUTO-DECISION (spawn before the runtime-field write): §6.5 orders ④ the
// fields before ⑤ the spawn, but the pid half of the record exists only once
// the worker process does; writing worktree and pid together after the spawn
// keeps the registry entry atomic (a record naming a pid that was never
// spawned would read as a dead orphan).
export async function dispatchLane(
  gitOps: GitOps,
  dir: string,
  task: Pick<Task, "id" | "title">,
  instruction?: LaneMergeInstruction,
  seed?: { task: string; split: { root: string; sha: string }[] },
): Promise<LaneDispatch> {
  const record = (await laneRecords(dir)).find((entry) => entry.unit === task.id)
  const park = join(dir, lanePark(task.id))
  const branch = laneBranch(task.id)
  // §10's park path-length guard runs first, before any write: a worktree
  // this host cannot address would fail mid-creation (block-with-path).
  const tooLong = laneParkProblem(dir, task.id)
  if (tooLong !== undefined) return { type: "failed", error: tooLong }
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
    log(
      instruction !== undefined
        ? `↻ ${task.id} re-dispatching its lane in the existing worktree ${record.worktree} with the merge instruction (merge ${instruction.merge} into ${branch}, resolve, exit normally)`
        : `↻ ${task.id} re-dispatching its lane in the existing worktree ${record.worktree} (the lane resumes from its own progress record)`,
    )
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
    // S5: the seed precedes the spawn — the worker reads the record at its
    // own loadPlan, and any later write would race it.
    if (seed !== undefined) {
      await mkdir(join(park, ".auto"), { recursive: true })
      await Bun.write(join(park, UNITS_FILE), `${JSON.stringify({ tasks: { [seed.task]: { split: reRootSplit(seed.split, dir, park) } } }, null, 2)}\n`)
    }
  }
  const launch = shellProfile().laneLauncher ?? defaultLaneLauncher
  let worker: LaneWorker
  try {
    worker = launch(fresh ? park : join(dir, record!.worktree), task.id, instruction)
  } catch (error) {
    if (fresh) {
      await gitOps.removeWorktree(dir, park)
      await deleteBranch(dir, branch)
    }
    return { type: "failed", error: `spawning the lane worker failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  const worktree = fresh ? park : join(dir, record!.worktree)
  await setLane(dir, task.id, { worktree: relative(dir, worktree), ...(worker.pid !== undefined ? { pid: worker.pid } : {}) })
  // D13's prefix relay attaches here, at the spawn: every line the worker
  // prints reaches the parent's terminal and audit log as it arrives
  // (prefixed below), and the same drain keeps the pipe from filling.
  const output = relayLaneOutput(task.id, worker)
  // The 0067 bus's lane identity (§6.7): the dispatch is a parent-level
  // structured event — worktree and pid beside the lane's unit, the repair's
  // merge branch when this is a re-dispatch carrying one.
  emitStatus({
    type: "lane-dispatch",
    lane: task.id,
    worktree: relative(dir, worktree).replaceAll("\\", "/"),
    ...(worker.pid !== undefined ? { pid: worker.pid } : {}),
    ...(instruction !== undefined ? { merge: instruction.merge } : {}),
  })
  return { type: "spawned", worktree, worker, fresh, output }
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

// The lane worker's exit: await the (already running) drain of its piped
// output and read its code. `output` is the relay's full-text promise the
// dispatch returned — passing it keeps one drain per stream (a second reader
// on an already-locked stream would hang); without one (a worker the caller
// spawned outside dispatchLane, a test double) a plain drain starts here. A
// signal kill resolves Bun's exit promise to null; every such code is the
// crash vocabulary's, and laneOutcome decides by the report's absence anyway.
export async function laneExit(worker: LaneWorker, output?: Promise<string>): Promise<{ code: number; output: string }> {
  const [text, code] = await Promise.all([output ?? laneOutput(worker), worker.exited])
  return { code: typeof code === "number" ? code : 137, output: text }
}

// A plain drain of a worker's piped output, no relay (the pre-S4 shape, kept
// for callers that hold a worker dispatchLane never spawned): the full text
// of stdout then stderr.
export function laneOutput(worker: LaneWorker): Promise<string> {
  const read = (stream: ReadableStream<Uint8Array> | null | undefined) => (stream ? new Response(stream).text().catch(() => "") : "")
  return Promise.all([read(worker.stdout), read(worker.stderr)]).then(([out, err]) => `${out}${err}`)
}

// D13's prefix relay: drain one lane worker's piped output line by line and
// re-emit every non-empty line through the parent's own log() with a
// `[<task-id>]` prefix — the human watching the parent sees the lanes' story
// as it happens, and the parent's audit log keeps the run story whole (the
// lane's own log dies with its worktree, discarded by contract; the §11
// recommendation stands). The returned promise resolves to the full raw text
// once both streams end, so the failure matrix's environment-error tail reads
// the same source the terminal saw.
// The relay is the observability half of the drain, not an alternative to
// it: reading incrementally is exactly what keeps a full pipe from
// deadlocking the worker, so every dispatch attaches this and nobody drains
// the same stream twice.
// AUTO-DECISION (empty lines are dropped, not relayed as a bare prefix): the
// child's banner output carries blank lines for a terminal's benefit; a
// relayed `[<id>] ` line carries no fact, and interleaving several lanes'
// blank lines into the parent's own narrative adds pure noise. Every line
// the relay does emit carries the prefix.
export function relayLaneOutput(unit: string, worker: LaneWorker): Promise<string> {
  const relay = (stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> => {
    if (!stream) return Promise.resolve("")
    return (async () => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let text = ""
      let buffer = ""
      const flush = (line: string) => {
        const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line
        if (trimmed.length) log(`[${unit}] ${trimmed}`)
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        text += chunk
        buffer += chunk
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
          flush(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf("\n")
        }
      }
      buffer += decoder.decode()
      flush(buffer)
      return text
    })().catch(() => "")
  }
  return Promise.all([relay(worker.stdout), relay(worker.stderr)]).then(([out, err]) => `${out}${err}`)
}

// D14's liveness probe: whether a recorded lane pid still names a process.
// Signal 0 probes without delivering anything — ESRCH is the dead answer;
// EPERM (a live process this user may not signal) is alive all the same. A
// recorded pid this host never had (a reboot between runs, another machine's
// lock holder) reads dead exactly like an exited worker, which is the
// honest answer the re-dispatch path needs.
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

// —— Landing (D7, parent side) ——

// The outcome of one landing: landed (with whether the teardown fully
// succeeded — a failed cleanup of an already-merged branch is a warning, the
// park entry is cleared either way), conflict (the merge aborted, the main
// tree clean again, the lane's scene kept for the conflict protocol), or
// blocked (the landing refused — verification, the merge itself, or the
// landing-sync commit; the caller stops scheduling and exits 2).
export type Landing = { type: "landed"; teardown: boolean } | { type: "conflict"; detail: string } | { type: "blocked"; error: string }

// D7's five steps, serialized in this one caller (the single-threaded await
// of the loop above is the mutex): ① verify the lane branch — unitViolations
// over the merge-base baseline (only Auto-Stage commits inside the lane, the
// worktree clean); ② the `--no-ff` merge carrying `Auto-Stage: landing`; ③
// re-derive the phase index ticks from the merged unit states, committed as
// `Auto-Stage: landing-sync`; ④ clear the lane runtime fields and book the
// report's usage; ⑤ tear down the worktree and delete the branch.
// The conflict path aborts the merge and keeps the lane's scene (worktree,
// branch and registry record) for D21's level-derived response — the caller
// decides: `low` blocks immediately, `medium`/`high` re-dispatch once with
// D7's merge instruction and block on the second conflict.
export async function landLane(
  gitOps: GitOps,
  dir: string,
  phase: PlanPhase,
  task: Pick<Task, "id" | "title">,
  report: LaneReport,
): Promise<Landing> {
  const worktree = join(dir, lanePark(task.id))
  const branch = laneBranch(task.id)
  // D7's step ④ booking (the report's figures into the parent's run stats,
  // the detail folding into the phase/round buckets — the S4 roll-up) plus
  // the 0067 bus's landing event: one helper, the three call sites below
  // (the settled path, the landing-sync failure, the normal close) share it.
  const book = () =>
    statsLaneUsage(dir, task.id, {
      tokens: report.usage.tokens,
      wallMs: report.usage.wallMs,
      sessions: report.sessions,
      ...(report.detail !== undefined ? { detail: report.detail } : {}),
    })
  const landedEvent = (outcome: "landed" | "conflict" | "blocked", extra: { detail?: string; usage?: boolean }) =>
    emitStatus({
      type: "lane-landing",
      lane: task.id,
      outcome,
      ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
      ...(extra.usage
        ? { tokens: report.usage.tokens, wallMs: report.usage.wallMs, sessions: report.sessions }
        : {}),
    })
  // ① verify the lane branch.
  const base = await mergeBaseSha(dir, "HEAD", branch)
  if (base === undefined) {
    landedEvent("blocked", { detail: "deriving the lane baseline failed" })
    return { type: "blocked", error: `deriving the lane baseline of ${task.id} failed (merge-base of HEAD and ${branch}); the lane scene is kept at ${lanePark(task.id)}` }
  }
  const violations = await unitViolations(worktree, [{ root: worktree, sha: base }])
  if (violations.length) {
    landedEvent("blocked", { detail: violations.join("; ") })
    return { type: "blocked", error: `the lane branch of ${task.id} failed the close-out check (${violations.join("; ")}); the lane scene is kept at ${lanePark(task.id)} for inspection` }
  }
  // ② the landing merge. `own` names the parent-exclusive ticks (D6): the
  // phase index — concurrent lanes tick adjacent index lines, no textual
  // merge survives that — and, since S5, the OWNING task's checklist
  // (subtasks.md; a stream lane's unit id is T-NNN.S<nn>), where concurrent
  // stream lanes tick adjacent stream lines the same way; both resolve onto
  // the main tree's side and step ③ re-derives the true ticks from the
  // merged state files. Any other conflicted path stays the conflict
  // protocol's.
  // AUTO-DECISION (subtasks.md in `own`): sessions never write the checklist
  // (the fanout delta forbids it, the decompose session wrote it once at
  // decomposition), so a conflict over it is tick-shaped by construction —
  // exactly the shape the re-derivation below owns.
  const owner = streamUnitOf(task.id)?.task ?? task.id
  const landed = await gitOps.landBranch(dir, branch, task, [taskIndexPath(phase), taskDoc(owner, "subtasks")])
  if (landed.type === "conflict") {
    landedEvent("conflict", { detail: landed.detail })
    return { type: "conflict", detail: landed.detail }
  }
  if (landed.type === "failed") {
    landedEvent("blocked", { detail: landed.error })
    return { type: "blocked", error: `landing ${branch} failed: ${landed.error}` }
  }
  // ③ the tick re-derivation, committed as landing-sync: the phase index's
  // ticks and (S5) the landed task's checklist ticks, both from the merged
  // state files.
  await syncIndexTicks(dir, phase)
  await syncChecklistTicks(dir, owner)
  const settled = await gitOps.commitTree(dir, task, { stage: "landing-sync", subject: `${task.id} landing-sync ${task.title}` })
  if (!settled.ok) {
    // The merge itself is in and the unit's files are the fact; the ticks are
    // cosmetic (D7 step ③'s own note). Finish the landing (④⑤ below keep the
    // park clean) and hand the uncommitted sync to the human.
    await clearLane(dir, task.id)
    await book()
    await teardownLane(gitOps, dir, task.id)
    landedEvent("blocked", { detail: "the landing-sync commit failed" })
    return { type: "blocked", error: `the landing-sync commit of ${task.id} failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. The merge landed; commit the index ticks manually and re-run` }
  }
  // S5 (§6.8): the lead's split record travels by the report and is
  // parent-persisted at landing — the lane worktree's own .auto/ dies at the
  // teardown below, and the main tree's registry is where the scheduler (the
  // stream-unit expansion), the stream dispatches' seeds and the next run's
  // recovery read the split point (Runtime.split, the field the serial path
  // already writes). The baseline's roots named the lead worktree; the main
  // tree's paths replace them.
  if (report.split !== undefined) {
    await setSplit(dir, task.id, reRootSplit(report.split.baseline, worktree, dir))
  }
  // ④ the runtime fields and the report's usage.
  await clearLane(dir, task.id)
  await book()
  // ⑤ teardown.
  const teardown = await teardownLane(gitOps, dir, task.id)
  landedEvent("landed", { usage: true })
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
