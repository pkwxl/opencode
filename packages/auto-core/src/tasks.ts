// Task store (M3.4, plans/0047 §3–§4; root plan D14): the tasks of one phase,
// read from task units. PLAN.md is retired; its three jobs are split:
//   - order and membership: the phase's task index <phase dir>/tasks.md, one
//     `- [ ] T-014 <title>` line per task (U3; the tick is a redundant view,
//     the driver ticks it when the task completes);
//   - content: docs/T-NNN/todo.md — the title line `# T-014: <title>`, the
//     field block (`Phase: R-01.P03`, optional `Depends:` / `Touches:`) and
//     the body sections `## Goal` / `## Scope` / `## Acceptance` (U1);
//   - progress: todo.md → done.md, renamed by the driver inside the task's
//     closing commit (U2).
// Runtime state is not a document (U4, ruling R1): in_progress, blocked,
// attempts and the fork base live in .auto/units.json (driverState, never
// committed); the reason for a block is in the run log.
//
// The subtask checklist lives only in docs/T-NNN/subtasks.md (the decompose
// session's index). Its ticks follow the subtask state files the same way
// (files win once the state protocol is active, document/state.ts); the
// driver ticks the line when a subtask closes out.
//
// Dependencies (M3.5, plans/0047 §7): tasks select by nextReady over their
// `Depends:` fields (absent = the previous task in the index, today's order;
// a task may also name a completed task of another phase), and so do
// subtasks (document/state.ts). The graph is checked on load — a bad graph
// makes the index invalid — and in the planning and decompose collects.
//
// A `Plan` is the current phase's plan of work: the loaded index with its
// tasks. The name survives from PLAN.md because the concept did.
import { mkdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { EOF_MARK } from "./doccheck"
import { resolveTaskDoc } from "./docpaths"
import { checkArtifactSpecs, taskTodoSpec } from "./document/spec"
import { effectiveDone, scanSubtaskStates, subtaskId } from "./document/state"
import {
  isUnitId,
  nextReady,
  parseIndex,
  parseUnitDoc,
  renameUnitDone,
  scanUnitStates,
  unitProblems,
  unitStatePaths,
  UNIT_COMPLETE,
  UNIT_PENDING,
  type UnitDecl,
  type UnitRef,
} from "./document/unit"

export const STATUSES = ["pending", "in_progress", "blocked", "done"] as const
export type Status = (typeof STATUSES)[number]

// A subtask checklist item; depends / touches come from the field block at the
// top of its S<nn>/todo.md (done.md once complete), absent without one.
export type ChecklistItem = { text: string; done: boolean; depends?: string[] | "none"; touches?: string[] }

export type Task = {
  id: string
  title: string
  status: Status
  attempts: number
  // Fork base session of the fork-decompose pipeline (plans/0003 §4.2):
  // session mode = the decompose session id; digest mode = the base
  // confirmation session id with a `digest:` prefix. Driver-written runtime
  // state (.auto/units.json), persistent across runs.
  forkBase?: string
  // The task's own content: todo.md (done.md once complete) without its title
  // line, field block and terminator.
  body: string
  // Back-reference to the phase that planned the task (`Phase:` field, U5).
  phase?: string
  // Declared dependencies (`Depends:` field; absent = the previous task in
  // the index, "none" = no prerequisite) and touched paths (`Touches:`;
  // absent = everything).
  depends?: string[] | "none"
  touches?: string[]
  // The subtask checklist from subtasks.md with effective done flags (state
  // files win over ticks once the protocol is active); empty before decompose.
  // Absent on the pseudo tasks of bypass sessions (planning, handover, …).
  checklist?: ChecklistItem[]
}

// The phase a plan belongs to: its qualified id and directory.
export type PlanPhase = { round: string; id: string; dir: string }

export type Plan = {
  dir: string
  // Qualified phase id, e.g. R-01.P03.
  phase: string
  // Repository-relative path of the phase's task index.
  index: string
  tasks: Task[]
}

export const TASK_INDEX_NAME = "tasks.md"

export const taskIndexPath = (phase: PlanPhase): string => join(phase.dir, TASK_INDEX_NAME)

export const qualifiedPhase = (phase: PlanPhase): string => `${phase.round}.${phase.id}`

const taskRef = (id: string): UnitRef => ({ level: "task", id })

// Repository-relative todo.md / done.md of a task.
export const taskStatePaths = (id: string) => unitStatePaths(taskRef(id))

// —— Checklists (subtasks.md) ——

// "- [ ]" / "- [x]" checklist items of a text (subtasks.md, or any checklist).
export function subtasks(text: string): ChecklistItem[] {
  return text.split("\n").flatMap((line) => {
    const match = /^\s*- \[( |x|X)\]\s*(.*)$/.exec(line)
    return match ? [{ text: match[2]!.trim(), done: match[1]!.toLowerCase() === "x" }] : []
  })
}

export function countSubtasks(items: readonly ChecklistItem[] = []): { done: number; total: number } {
  return { done: items.filter((item) => item.done).length, total: items.length }
}

// A task's checklist with effective done flags (files win once active) and
// each subtask's declared dependencies.
export async function readChecklist(dir: string, id: string): Promise<ChecklistItem[]> {
  const text = await Bun.file(join(dir, await resolveTaskDoc(dir, id, "subtasks"))).text().catch(() => "")
  const items = subtasks(text)
  if (!items.length) return items
  const done = effectiveDone(await scanSubtaskStates(dir, id, items.length), items)
  const out: ChecklistItem[] = []
  for (const [i, item] of items.entries()) {
    const paths = unitStatePaths({ level: "subtask", id: subtaskId(i + 1), task: id })
    const doc =
      (await Bun.file(join(dir, paths.pending)).text().catch(() => undefined)) ?? (await Bun.file(join(dir, paths.complete)).text().catch(() => ""))
    const unit = parseUnitDoc(doc)
    out.push({
      text: item.text,
      done: done[i] ?? item.done,
      ...(unit.depends !== undefined ? { depends: unit.depends } : {}),
      ...(unit.touches !== undefined ? { touches: unit.touches } : {}),
    })
  }
  return out
}

// Ticks the index-th (1-based) checklist item of subtasks.md (driver-side, at
// subtask close-out, inside its commit). Idempotent; a missing file or item is
// left alone — the state files are the progress fact, the tick only a view.
export async function tickSubtask(dir: string, id: string, index: number): Promise<void> {
  const file = join(dir, await resolveTaskDoc(dir, id, "subtasks"))
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text === undefined) return
  let at = 0
  let changed = false
  const out = text
    .split("\n")
    .map((line) => {
      if (!/^\s*- \[( |x|X)\]/.test(line)) return line
      if (++at !== index || !/^\s*- \[ \]/.test(line)) return line
      changed = true
      return line.replace("- [ ]", "- [x]")
    })
    .join("\n")
  if (changed) await Bun.write(file, out)
}

// —— Task documents ——

// The body of a task document: everything after the title line and the field
// block, minus the terminator.
export function taskBody(text: string): string {
  const lines = text.split("\n")
  let i = 0
  if (/^#\s/.test(lines[0]?.trim() ?? "")) {
    i = 1
    while (i < lines.length && lines[i]!.trim() === "") i++
  }
  while (i < lines.length && /^[A-Za-z][A-Za-z-]*:/.test(lines[i]!.trim())) i++
  return lines
    .slice(i)
    .filter((line) => line.trim() !== EOF_MARK)
    .join("\n")
    .trim()
}

// The task document todo.md as a planning session is asked to write it; the
// driver itself uses it only for tests and fixtures.
export function renderTaskTodo(input: {
  id: string
  title: string
  phase?: string
  depends?: string
  touches?: string
  goal?: string
  scope?: string
  acceptance?: string
}): string {
  return [
    `# ${input.id}: ${input.title}`,
    ...(input.phase ? [`Phase: ${input.phase}`] : []),
    ...(input.depends !== undefined ? [`Depends: ${input.depends}`] : []),
    ...(input.touches !== undefined ? [`Touches: ${input.touches}`] : []),
    "",
    "## Goal",
    "",
    input.goal ?? "",
    "",
    "## Scope",
    "",
    input.scope ?? "",
    "",
    "## Acceptance",
    "",
    input.acceptance ?? "",
    "",
    EOF_MARK,
    "",
  ].join("\n")
}

export function renderTaskIndex(phase: string, tasks: readonly { id: string; title: string; done?: boolean }[]): string {
  const lines = tasks.map((task) => `- [${task.done ? "x" : " "}] ${task.id} ${task.title}`)
  return [`# Tasks (${phase})`, "", ...lines, ""].join("\n")
}

// —— Runtime state (.auto/units.json) ——

export const UNITS_FILE = join(".auto", "units.json")

type Runtime = { status?: "in_progress" | "blocked"; attempts?: number; forkBase?: string }
type Units = { tasks: Record<string, Runtime> }

async function readUnits(dir: string): Promise<Units> {
  const text = await Bun.file(join(dir, UNITS_FILE)).text().catch(() => undefined)
  if (text === undefined) return { tasks: {} }
  try {
    const parsed = JSON.parse(text) as Partial<Units>
    return { tasks: parsed && typeof parsed.tasks === "object" && parsed.tasks ? parsed.tasks : {} }
  } catch {
    // Unreadable runtime state is not fatal: it only carries counters and
    // flags, and every one of them has a safe default.
    return { tasks: {} }
  }
}

// Serialized read-modify-write with an atomic replace.
let queue: Promise<unknown> = Promise.resolve()
function updateUnits(dir: string, change: (units: Units) => void): Promise<void> {
  const run = queue.then(async () => {
    const units = await readUnits(dir)
    change(units)
    const file = join(dir, UNITS_FILE)
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await Bun.write(tmp, JSON.stringify(units, null, 2) + "\n")
    await rename(tmp, file)
  })
  queue = run.catch(() => {})
  return run
}

function updateTask(dir: string, id: string, change: (entry: Runtime) => Runtime | undefined): Promise<void> {
  return updateUnits(dir, (units) => {
    const next = change({ ...units.tasks[id] })
    if (next && Object.values(next).some((value) => value !== undefined)) units.tasks[id] = next
    else delete units.tasks[id]
  })
}

// —— Loading ——

// Load a phase's plan: the index, each task's document and state file, the
// runtime state. A missing index is an empty plan (the planning route). Throws
// with fix-it guidance on an index problem line, a task directory with both or
// neither of todo.md / done.md, or a dependency problem (unitProblems; a task
// may name a task of this index or a completed task of any phase).
export async function loadPlan(dir: string, phase: PlanPhase): Promise<Plan> {
  const index = taskIndexPath(phase)
  const plan: Plan = { dir, phase: qualifiedPhase(phase), index, tasks: [] }
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return plan
  const parsed = parseIndex(text, "task")
  const problems = [...parsed.problems]
  const scan = await scanUnitStates(dir, parsed.entries.map((entry) => taskRef(entry.id)))
  for (const bad of scan.illegal) {
    problems.push(`docs/${bad.id}/ has ${bad.kind === "both" ? `both ${UNIT_PENDING} and ${UNIT_COMPLETE}` : `neither ${UNIT_PENDING} nor ${UNIT_COMPLETE}`}`)
  }
  if (problems.length) {
    throw new Error(
      `task index ${index} is invalid: ${problems.join("; ")}. ` +
        `Index lines are \`- [ ] T-NNN <title>\`, each with a directory docs/T-NNN/ holding exactly one of ${UNIT_PENDING} / ${UNIT_COMPLETE}; fix it manually and re-run`,
    )
  }
  const units = await readUnits(dir)
  const docs = new Map<string, string>()
  for (const entry of parsed.entries) {
    const paths = taskStatePaths(entry.id)
    docs.set(entry.id, await Bun.file(join(dir, scan.done.has(entry.id) ? paths.complete : paths.pending)).text().catch(() => ""))
  }
  const decls = parsed.entries.map((entry) => taskDecl(entry.id, docs.get(entry.id)!))
  const graph = unitProblems("task", decls, { external: await doneTaskIds(dir) })
  if (graph.length) {
    throw new Error(
      `task index ${index} has dependency problems: ${graph.join("; ")}. ` +
        "`Depends:` in docs/T-NNN/todo.md names tasks of this index or completed tasks (`Depends: none` for no prerequisite); fix it manually and re-run",
    )
  }
  for (const entry of parsed.entries) {
    const done = scan.done.has(entry.id)
    const doc = docs.get(entry.id)!
    const unit = parseUnitDoc(doc)
    const runtime = units.tasks[entry.id] ?? {}
    plan.tasks.push({
      id: entry.id,
      title: unit.title || entry.title,
      status: done ? "done" : (runtime.status ?? "pending"),
      attempts: runtime.attempts ?? 0,
      ...(runtime.forkBase ? { forkBase: runtime.forkBase } : {}),
      body: taskBody(doc),
      ...(unit.fields.phase ? { phase: unit.fields.phase } : {}),
      ...(unit.depends !== undefined ? { depends: unit.depends } : {}),
      ...(unit.touches !== undefined ? { touches: unit.touches } : {}),
      checklist: await readChecklist(dir, entry.id),
    })
  }
  return plan
}

// A task's dependency declaration from its document text.
function taskDecl(id: string, doc: string): UnitDecl {
  const unit = parseUnitDoc(doc)
  return { id, ...(unit.depends !== undefined ? { depends: unit.depends } : {}), ...(unit.touches !== undefined ? { touches: unit.touches } : {}) }
}

const declOf = (task: Task): UnitDecl => ({ id: task.id, ...(task.depends !== undefined ? { depends: task.depends } : {}) })

// The next task to run: the first one in index order that is not done and
// whose prerequisites are done (nextReady). A prerequisite outside this index
// passed loadPlan's check only as a completed task, so it counts as done.
// Blocked tasks are candidates like pending ones (resumed directly).
export function next(plan: Plan): Task | undefined {
  const own = new Set(plan.tasks.map((task) => task.id))
  const done = new Set(plan.tasks.filter((task) => task.status === "done").map((task) => task.id))
  for (const task of plan.tasks) {
    if (Array.isArray(task.depends)) for (const dep of task.depends) if (!own.has(dep)) done.add(dep)
  }
  const id = nextReady(plan.tasks.map(declOf), done)
  return plan.tasks.find((task) => task.id === id)
}

export function requireTask(plan: Plan, id: string): Task {
  const task = plan.tasks.find((task) => task.id === id)
  if (!task) throw new Error(`${plan.index}: task ${id} not found`)
  return task
}

// Reload one task of a plan (after a driver write or a session).
export async function reloadTask(plan: Plan, id: string): Promise<Task> {
  const [round, phaseId] = plan.phase.split(".")
  const fresh = await loadPlan(plan.dir, { round: round!, id: phaseId!, dir: dirname(plan.index) })
  return requireTask(fresh, id)
}

// —— Driver writes ——

export async function begin(dir: string, id: string): Promise<void> {
  await updateTask(dir, id, (entry) => ({ ...entry, status: "in_progress", attempts: (entry.attempts ?? 0) + 1 }))
}

// Crash recovery at run start: an interrupted run (kill, crash) leaves tasks
// in_progress although no session runs. Reset them to pending; the loop
// resumes them through next() either way, attempts survive.
export async function resetInProgress(dir: string): Promise<string[]> {
  const stale: string[] = []
  await updateUnits(dir, (units) => {
    for (const [id, entry] of Object.entries(units.tasks)) {
      if (entry.status !== "in_progress") continue
      stale.push(id)
      delete entry.status
    }
  })
  return stale
}

// A block only records the status; its reason is in the run log.
export async function block(dir: string, id: string): Promise<void> {
  await updateTask(dir, id, (entry) => ({ ...entry, status: "blocked" }))
}

export async function setForkBase(dir: string, id: string, sessionID: string): Promise<void> {
  await updateTask(dir, id, (entry) => ({ ...entry, forkBase: sessionID }))
}

// Task completion: rename todo.md → done.md and tick the index line (the task
// commit that follows lands both), then drop the runtime entry. Idempotent.
export async function markDone(plan: Pick<Plan, "dir" | "index">, id: string): Promise<void> {
  await renameUnitDone(plan.dir, taskRef(id))
  await tickIndexLine(join(plan.dir, plan.index), id)
  await updateTask(plan.dir, id, () => undefined)
}

// Tick the index line of a unit id (phases.md / tasks.md). Idempotent; a
// missing file or line is left alone (the state file is the fact).
export async function tickIndexLine(file: string, id: string): Promise<void> {
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text === undefined) return
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const line = new RegExp(`^([-*] \\[) (\\]\\s+${escaped}(?::|\\s|$))`, "m")
  if (line.test(text)) await Bun.write(file, text.replace(line, "$1x$2"))
}

// Ids of every task directory under docs/ (T-NNN with a state file or not).
export async function taskDirs(dir: string): Promise<string[]> {
  const out: string[] = []
  for await (const path of new Bun.Glob(join("docs", "T-*", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    const id = path.split(/[\\/]/)[1]!
    if (/^T-\d+$/.test(id) && !out.includes(id)) out.push(id)
  }
  return out.sort()
}

// —— Planning output check (plans/0047 L3) ——

// Problems of what a planning session wrote for a phase (empty = accepted): a
// task index with at least one task; per task a new id (not a task directory
// that existed before the session, and not below the numbering record's start)
// and a todo.md that passes the mandatory spec check (non-trivial, eof, the
// Goal / Scope / Acceptance anchors) and carries `Phase: <this phase>`, with no
// done.md; then the dependency graph of the listed tasks (unitProblems; the
// completed tasks of earlier phases may be named). Problem lines name concrete
// paths and feed the retry feedback.
export async function plannedTaskProblems(
  dir: string,
  phase: PlanPhase,
  opts: { before: ReadonlySet<string>; numberStart?: number },
): Promise<{ problems: string[]; ids: string[] }> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return { problems: [`${index} is missing`], ids: [] }
  const parsed = parseIndex(text, "task")
  const problems = parsed.problems.map((problem) => `${index} ${problem}`)
  const ids = parsed.entries.map((entry) => entry.id)
  if (!ids.length) problems.push(`${index} lists no task (lines \`- [ ] T-NNN <title>\`)`)
  const qualified = qualifiedPhase(phase)
  const decls: UnitDecl[] = []
  for (const id of ids) {
    if (opts.before.has(id)) {
      problems.push(`${id} is already used by an earlier task (docs/${id}/ existed before this planning session); pick an unused number`)
      continue
    }
    const n = /^T-(\d+)$/.exec(id)
    if (opts.numberStart !== undefined && n && Number(n[1]) < opts.numberStart) {
      problems.push(`${id} is below the numbering start T-${String(opts.numberStart).padStart(3, "0")}; earlier numbers are taken`)
      continue
    }
    const paths = taskStatePaths(id)
    if (await Bun.file(join(dir, paths.complete)).exists()) problems.push(`${paths.complete} must not exist for a newly planned task`)
    const checked = await checkArtifactSpecs([taskTodoSpec(id)], { dir, policy: "mandatory" })
    problems.push(...checked.problems)
    if (checked.problems.length) continue
    const doc = await Bun.file(join(dir, paths.pending)).text()
    const phaseField = parseUnitDoc(doc).fields.phase
    if (phaseField !== qualified) problems.push(`${paths.pending} must carry the field line \`Phase: ${qualified}\` right after its title line`)
    decls.push(taskDecl(id, doc))
  }
  if (decls.length === ids.length) {
    problems.push(...unitProblems("task", decls, { external: await doneTaskIds(dir) }).map((problem) => `${index}: ${problem}`))
  }
  return { problems, ids: ids.filter((id) => isUnitId("task", id)) }
}

// Task ids already taken when a phase is planned: those listed in any other
// phase's task index (every round) and those whose done.md exists. What the
// current phase's own index lists is not taken — an interrupted or retried
// planning session writes the same numbers again.
export async function takenTaskIds(dir: string, phase: PlanPhase): Promise<Set<string>> {
  const taken = new Set<string>()
  const own = taskIndexPath(phase).replaceAll("\\", "/")
  for await (const file of new Bun.Glob(join("docs", "R-*", "P*", TASK_INDEX_NAME)).scan({ cwd: dir, onlyFiles: true })) {
    if (file.replaceAll("\\", "/") === own) continue
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    for (const entry of parseIndex(text, "task").entries) taken.add(entry.id)
  }
  for (const id of await doneTaskIds(dir)) taken.add(id)
  return taken
}

// Ids of the tasks whose done.md exists (any phase, any round).
export async function doneTaskIds(dir: string): Promise<Set<string>> {
  const done = new Set<string>()
  for await (const file of new Bun.Glob(join("docs", "T-*", UNIT_COMPLETE)).scan({ cwd: dir, onlyFiles: true })) {
    done.add(file.split(/[\\/]/)[1]!)
  }
  return done
}

// Clear a planning session's output before it (re)runs: the task directories
// the phase's index lists that are neither taken nor done, then the index
// itself. Only a planning session writes an index that the plan route sees
// as empty, so nothing here predates it.
export async function resetPlanning(dir: string, phase: PlanPhase): Promise<void> {
  const index = join(dir, taskIndexPath(phase))
  const text = await Bun.file(index).text().catch(() => undefined)
  if (text === undefined) return
  const taken = await takenTaskIds(dir, phase)
  for (const entry of parseIndex(text, "task").entries) {
    if (taken.has(entry.id)) continue
    await rm(join(dir, "docs", entry.id), { recursive: true, force: true })
  }
  await rm(index, { force: true })
}
