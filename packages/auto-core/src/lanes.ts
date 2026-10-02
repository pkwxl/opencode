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
import { join } from "node:path"
import { parseIndex, resolveDepends, scanUnitStates, type UnitDecl } from "./document/unit"
import { taskIndexPath, type Plan, type PlanPhase, type Task } from "./tasks"

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
