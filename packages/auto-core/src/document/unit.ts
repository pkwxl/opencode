// Document domain — the unified unit model (M3.1, plans/0047 §3/§7; root plan
// D14). Phases, tasks and subtasks share one shape: a directory, a `todo.md`
// holding the unit's content (title line, field block, body sections), and
// progress as the file name — the DRIVER renames `todo.md` to `done.md` inside
// the unit's closing commit (U2). A parent holds an index of its children
// (round `phases.md`, phase `tasks.md`, task `subtasks.md`) carrying order and
// membership only; ticks are a redundant view and the files win (U3).
//
// Everything here is pure or a thin filesystem read: callers (the loops, the
// planning/decompose collects, the CLI `status` view) wire it in M3.3–M3.5.
// Runtime state (in_progress, blocked, attempts, fork-base) is deliberately
// absent — it is not a document (U4).
//
// Dependency grammar (G1–G6), shared by all levels, in the field block right
// after the title line:
//   # T-014: DMA ring buffer
//   Depends: T-011, T-012
//   Touches: src/dma/, include/dma.h
// `Depends` names same-level ids; a missing `Depends` means the previous
// sibling in the index (today's serial order) and `Depends: none` declares a
// root; a missing `Touches` means "touches everything". Field names are
// driver-parsed English protocol strings (plans/0035 §3), read
// case-insensitively.
import { rename } from "node:fs/promises"
import { join } from "node:path"

export type UnitLevel = "phase" | "task" | "subtask"

// A unit by its local id plus what locates it: a phase lives in a round and
// its directory carries its type; a task is global; a subtask lives in a task.
export type UnitRef =
  | { level: "phase"; id: string; round: string; type: string }
  | { level: "task"; id: string }
  | { level: "subtask"; id: string; task: string }

// Local id shapes per level (G1 scope: `Depends` may only name these).
const ID_SHAPES: Record<UnitLevel, { re: RegExp; label: string }> = {
  phase: { re: /^P\d{2,}$/, label: "P<nn>" },
  task: { re: /^T-\d{3,}$/, label: "T-NNN" },
  subtask: { re: /^S\d{2,}$/, label: "S<nn>" },
}

export const isUnitId = (level: UnitLevel, id: string): boolean => ID_SHAPES[level].re.test(id)

// Qualified id for logs and document fields: R-01.P02 / T-014 / T-014.S03.
// Task ids are unchanged (the `Auto-Task:` trailer shape, plans/0035).
export function qualifiedId(ref: UnitRef): string {
  if (ref.level === "phase") return `${ref.round}.${ref.id}`
  if (ref.level === "subtask") return `${ref.task}.${ref.id}`
  return ref.id
}

// Repository-relative unit directory. Tasks stay flat and permanent under
// docs/ — never nested in a round or phase (0036 §7.1, U5).
export function unitDir(ref: UnitRef): string {
  if (ref.level === "phase") return join("docs", ref.round, `${ref.id}-${ref.type}`)
  if (ref.level === "subtask") return join("docs", ref.task, ref.id)
  return join("docs", ref.id)
}

export const UNIT_PENDING = "todo.md"
export const UNIT_COMPLETE = "done.md"

export function unitStatePaths(ref: UnitRef): { pending: string; complete: string } {
  const base = unitDir(ref)
  return { pending: join(base, UNIT_PENDING), complete: join(base, UNIT_COMPLETE) }
}

// Phase directory name `P<nn>-<type>` → its parts; anything else → undefined.
export function parsePhaseDir(name: string): { id: string; type: string } | undefined {
  const m = /^(P\d{2,})-([a-z][a-z0-9-]*)$/.exec(name)
  return m ? { id: m[1]!, type: m[2]! } : undefined
}

// —— State scan (U2; generalizes the subtask scan in document/state.ts) ——

export type UnitFileState = "todo" | "done" | "both" | "neither"

export type UnitStateScan = {
  states: { id: string; state: UnitFileState }[]
  // Both files (ambiguous) or neither (drift): surfaced for human attention.
  illegal: { id: string; kind: "both" | "neither" }[]
  // Ids that count as done: done.md present (files win, so `both` is done —
  // the same degradation as effectiveDone).
  done: Set<string>
}

export async function scanUnitStates(dir: string, refs: readonly UnitRef[]): Promise<UnitStateScan> {
  const states: UnitStateScan["states"] = []
  const illegal: UnitStateScan["illegal"] = []
  const done = new Set<string>()
  for (const ref of refs) {
    const paths = unitStatePaths(ref)
    const todo = await Bun.file(join(dir, paths.pending)).exists()
    const complete = await Bun.file(join(dir, paths.complete)).exists()
    const state: UnitFileState = todo && complete ? "both" : complete ? "done" : todo ? "todo" : "neither"
    states.push({ id: ref.id, state })
    if (state === "both" || state === "neither") illegal.push({ id: ref.id, kind: state })
    if (complete) done.add(ref.id)
  }
  return { states, illegal, done }
}

// DRIVER close-out rename (idempotent): skipped when todo.md is absent or
// done.md already exists (interruption between rename and commit).
export async function renameUnitDone(dir: string, ref: UnitRef): Promise<void> {
  const paths = unitStatePaths(ref)
  const todo = join(dir, paths.pending)
  const done = join(dir, paths.complete)
  if (!(await Bun.file(todo).exists()) || (await Bun.file(done).exists())) return
  await rename(todo, done)
}

// —— Index files (U3) ——

export type IndexEntry = { id: string; title: string; ticked: boolean; line: number }

// Members are top-level checklist lines `- [ ] <id> <title>` (`*` bullets and
// `[x]`/`[X]` accepted, a colon after the id tolerated); indented checklist
// lines and prose are not members. A top-level checklist line whose first
// token is not an id of the index's level, and a repeated id, are problems.
export function parseIndex(text: string, level: UnitLevel): { entries: IndexEntry[]; problems: string[] } {
  const entries: IndexEntry[] = []
  const problems: string[] = []
  const seen = new Map<string, number>()
  text.split("\n").forEach((raw, i) => {
    const m = /^[-*] \[([ xX])\]\s+(\S+)\s*(.*)$/.exec(raw.trimEnd())
    if (!m) return
    const line = i + 1
    const id = m[2]!.replace(/:$/, "")
    if (!isUnitId(level, id)) {
      problems.push(`line ${line}: "${id}" is not a ${level} id (${ID_SHAPES[level].label})`)
      return
    }
    const first = seen.get(id)
    if (first !== undefined) {
      problems.push(`line ${line}: duplicate ${id} (first at line ${first})`)
      return
    }
    seen.set(id, line)
    entries.push({ id, title: m[3]!.trim(), ticked: m[1] !== " ", line })
  })
  return { entries, problems }
}

// —— Unit documents: title line + field block ——

// A unit's dependency declaration. `depends`: undefined = field absent (G3
// default: the previous sibling), "none" = explicit root, [] = empty value (a
// problem). `touches`: undefined = touches everything, [] = empty value (a
// problem).
export type UnitDecl = {
  id: string
  depends?: string[] | "none"
  touches?: string[]
}

export type UnitDoc = {
  title?: string
  // Field block, keys lower-cased; values raw (trimmed).
  fields: Record<string, string>
  depends?: string[] | "none"
  touches?: string[]
}

const listValue = (value: string): string[] =>
  value
    .split(/[\s,]+/)
    .map((token) => token.replace(/^`+|`+$/g, ""))
    .filter(Boolean)

// The field block is the run of `Key: value` lines right after the title line
// (blank lines between the title and the first field allowed); the first
// other line ends it, so body text like `Owner: …` under a section is never a
// field. Without a title line the block starts at the top.
export function parseUnitDoc(text: string): UnitDoc {
  const lines = text.split("\n")
  let i = 0
  let title: string | undefined
  const heading = /^#\s+(.*)$/.exec(lines[0]?.trim() ?? "")
  if (heading) {
    // `# T-014: DMA ring buffer` → the text after the id; a bare title is kept whole.
    title = heading[1]!.replace(/^\S+:\s*/, "").trim()
    i = 1
    while (i < lines.length && lines[i]!.trim() === "") i++
  }
  const fields: Record<string, string> = {}
  for (; i < lines.length; i++) {
    const m = /^([A-Za-z][A-Za-z-]*):(.*)$/.exec(lines[i]!.trim())
    if (!m) break
    fields[m[1]!.toLowerCase()] = m[2]!.trim()
  }
  const doc: UnitDoc = { fields }
  if (title !== undefined) doc.title = title
  if ("depends" in fields) doc.depends = /^none$/i.test(fields.depends!) ? "none" : listValue(fields.depends!)
  if ("touches" in fields) doc.touches = listValue(fields.touches!)
  return doc
}

// —— Dependencies (G3–G5) ——

// Effective prerequisites per unit, in index order: absent → the previous
// sibling (none for the first), "none" → no prerequisite, a list → itself.
export function resolveDepends(units: readonly UnitDecl[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  units.forEach((unit, i) => {
    if (unit.depends === undefined) out.set(unit.id, i > 0 ? [units[i - 1]!.id] : [])
    else if (unit.depends === "none") out.set(unit.id, [])
    else out.set(unit.id, [...unit.depends])
  })
  return out
}

// All problems of one index's units (G4; takes over 0046 D4). `external`: ids
// that exist outside this index and may be named (e.g. tasks of earlier
// phases). Overlapping `Touches` is not a problem — it only means two units
// will not run side by side.
export function unitProblems(level: UnitLevel, units: readonly UnitDecl[], opts: { external?: ReadonlySet<string> } = {}): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const unit of units) {
    if (ids.has(unit.id)) problems.push(`duplicate unit ${unit.id}`)
    ids.add(unit.id)
  }
  const known = (id: string) => ids.has(id) || (opts.external?.has(id) ?? false)
  for (const unit of units) {
    if (Array.isArray(unit.depends)) {
      if (unit.depends.length === 0) problems.push(`${unit.id} has an empty Depends value (write \`Depends: none\` for no prerequisite)`)
      for (const dep of unit.depends) {
        if (dep === unit.id) problems.push(`${unit.id} depends on itself`)
        else if (!isUnitId(level, dep)) problems.push(`${unit.id} depends on "${dep}", which is not a ${level} id (${ID_SHAPES[level].label})`)
        else if (!known(dep)) problems.push(`${unit.id} depends on unknown ${dep}`)
      }
    }
    if (unit.touches !== undefined) {
      if (unit.touches.length === 0) problems.push(`${unit.id} has an empty Touches value (omit the field to mean everything)`)
      for (const path of unit.touches) {
        if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) problems.push(`${unit.id} touches an absolute path: ${path}`)
        else if (path.split(/[\\/]/).includes("..")) problems.push(`${unit.id} touches a path with ..: ${path}`)
      }
    }
  }
  problems.push(...cycles(resolveDepends(units)))
  return problems
}

// Each cycle reported once with its path, found by DFS in index order over
// edges to units of this index (self-edges and unknown ids are reported by the
// caller, not here).
function cycles(graph: Map<string, string[]>): string[] {
  const out: string[] = []
  const finished = new Set<string>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const visit = (id: string) => {
    stack.push(id)
    onStack.add(id)
    for (const dep of graph.get(id) ?? []) {
      if (dep === id || !graph.has(dep) || finished.has(dep)) continue
      if (onStack.has(dep)) out.push(`dependency cycle: ${[...stack.slice(stack.indexOf(dep)), dep].join(" -> ")}`)
      else visit(dep)
    }
    stack.pop()
    onStack.delete(id)
    finished.add(id)
  }
  for (const id of graph.keys()) if (!finished.has(id)) visit(id)
  return out
}

// Dependency-ordered selection (G5; takes over 0046 D7): the first unit in
// index order that is not done and whose effective prerequisites are all done
// (`done` may include ids outside this index). Once unitProblems passes, the
// graph is acyclic over known ids, so while any unit is not done some unit is
// ready unless it waits on an external id that is not done. With G3's defaults
// this is exactly today's serial order.
export function nextReady(units: readonly UnitDecl[], done: ReadonlySet<string>): string | undefined {
  const deps = resolveDepends(units)
  return units.find((unit) => !done.has(unit.id) && (deps.get(unit.id) ?? []).every((dep) => done.has(dep)))?.id
}
