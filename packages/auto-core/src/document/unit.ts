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
// Beside them sits the plan-recorded execution mode (plans/0075), a task-level
// grammar: `Decompose: split | whole | pipeline` in a task's field block. The
// field-block reading here is shared by all levels (only a task document's
// value is ever consumed); the value set is validated by unitProblems.
import { rename } from "node:fs/promises"
import { join } from "node:path"

type UnitLevel = "phase" | "task" | "subtask"

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

type UnitFileState = "todo" | "done" | "both" | "neither"

type UnitStateScan = {
  states: { id: string; state: UnitFileState }[]
  // Both files (ambiguous) or neither (drift): surfaced for human attention.
  illegal: { id: string; kind: "both" | "neither" }[]
  // Ids that count as done: done.md present (files win, so `both` is done —
  // the same degradation as effectiveDone).
  done: Set<string>
  // Closed units (plans/0053 D16): done ids whose `done.md` field block
  // carries `Closed: <reason>` → the reason. Closed is done for scheduling but
  // not delivered. Only done.md counts — a `Closed:` line in todo.md, or one
  // below the field block, means nothing. The key's presence marks the unit
  // closed, so a hand-written empty value gives the reason "".
  closed: Map<string, string>
}

export async function scanUnitStates(dir: string, refs: readonly UnitRef[]): Promise<UnitStateScan> {
  const states: UnitStateScan["states"] = []
  const illegal: UnitStateScan["illegal"] = []
  const done = new Set<string>()
  const closed = new Map<string, string>()
  for (const ref of refs) {
    const paths = unitStatePaths(ref)
    const todo = await Bun.file(join(dir, paths.pending)).exists()
    const complete = await Bun.file(join(dir, paths.complete)).exists()
    const state: UnitFileState = todo && complete ? "both" : complete ? "done" : todo ? "todo" : "neither"
    states.push({ id: ref.id, state })
    if (state === "both" || state === "neither") illegal.push({ id: ref.id, kind: state })
    if (!complete) continue
    done.add(ref.id)
    const { fields } = parseUnitDoc(await Bun.file(join(dir, paths.complete)).text())
    if ("closed" in fields) closed.set(ref.id, fields.closed!)
  }
  return { states, illegal, done, closed }
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

// The rename's reverse (plans/0170 D2): restore a unit's pending state when
// the done.md sitting in the tree is not the driver's close — a session made
// the rename. Renames done.md back to todo.md (the content survives; only
// the transition reverts), skipped when todo.md already exists (that shape is
// the illegal both-present state, the state scans' own finding, never
// silently resolved here) or done.md is absent. Returns whether it restored,
// so the callers surface their detection lines.
export async function restoreUnitPending(dir: string, ref: UnitRef): Promise<boolean> {
  const paths = unitStatePaths(ref)
  const todo = join(dir, paths.pending)
  const done = join(dir, paths.complete)
  if (await Bun.file(todo).exists()) return false
  if (!(await Bun.file(done).exists())) return false
  await rename(done, todo)
  return true
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

// Tick the index line of a unit id (phases.md / tasks.md), the write-side
// counterpart of parseIndex. Idempotent; a missing file or line is left alone
// (the state file is the fact). Moved here from the task store (0061 E3): the
// phase index is ticked by the phases domain, which no longer imports the
// driver's task store.
// Concurrent ticks (plans/0099 D8, doc lanes): two pipelines closing units
// side by side tick different lines of one index file, and the plain
// read-modify-write loses the first tick to the second's stale text (both
// reads resolve before either write lands). The serialized queue — the
// updateUnits precedent (src/tasks.ts) — makes every tick see the previous
// one's write; the mutations commute (different lines), so ordering is all
// the safety there is to buy. Pass-through at concurrency 1: the serial
// floor's behavior is unchanged.
let tickQueue: Promise<unknown> = Promise.resolve()
export function tickIndexLine(file: string, id: string): Promise<void> {
  const run = tickQueue.then(async () => {
    const text = await Bun.file(file).text().catch(() => undefined)
    if (text === undefined) return
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const line = new RegExp(`^([-*] \\[) (\\]\\s+${escaped}(?::|\\s|$))`, "m")
    if (line.test(text)) await Bun.write(file, text.replace(line, "$1x$2"))
  })
  tickQueue = run.catch(() => {})
  return run
}

// —— Unit documents: title line + field block ——

// A unit's dependency declaration. `depends`: undefined = field absent (G3
// default: the previous sibling), "none" = explicit root, [] = empty value (a
// problem). `touches`: undefined = touches everything, [] = empty value (a
// problem). `decompose`: the raw `Decompose:` value when the field line exists
// (plans/0075 — a task-level grammar; validated by unitProblems, so the raw
// string rides the decl the same way an unparsed `Depends:` list cannot).
export type UnitDecl = {
  id: string
  depends?: string[] | "none"
  touches?: string[]
  decompose?: string
}

// The plan-recorded execution modes (plans/0075, ruled 2026-10-04): `split` =
// auto's lead + its split streams; `whole` = one whole-task session to
// completion; `pipeline` = the planned decompose pipeline. The value set is
// grammar — anything else is a load failure.
export const DECOMPOSE_MODES = ["split", "whole", "pipeline"] as const
export type DecomposeMode = (typeof DECOMPOSE_MODES)[number]

// A `Decompose:` field value normalized: the value comparison is
// case-insensitive like every other field reading (`Depends: none`), the
// returned word is the lowercase grammar token. undefined = absent or unknown
// (the caller's validation reports the unknown case).
export function parseDecompose(value: string): DecomposeMode | undefined {
  const word = value.trim().toLowerCase()
  return DECOMPOSE_MODES.includes(word as DecomposeMode) ? (word as DecomposeMode) : undefined
}

type UnitDoc = {
  title?: string
  // Field block, keys lower-cased; values raw (trimmed).
  fields: Record<string, string>
  depends?: string[] | "none"
  touches?: string[]
  // The raw `Decompose:` value (trimmed, unnormalized — unitProblems judges
  // it; parseDecompose normalizes for consumers).
  decompose?: string
}

const listValue = (value: string): string[] =>
  value
    .split(/[\s,]+/)
    .map((token) => token.replace(/^`+|`+$/g, ""))
    .filter(Boolean)

// The field-line shape, one grammar shared by every reader of the block's
// boundary (ruling 0228 D2): `Key: value`, the key a single English word of
// letters/hyphens, the colon half- or fullwidth — the `：` tolerance every
// other driver protocol line already has (plans/0035; the field block was the
// last reader without it, 0165-152). parseUnitDoc's walk, taskBody's skip and
// the near-miss scan below all read the same shape, so a `Key：` line is a
// field to all of them or none.
export const UNIT_FIELD_LINE = /^([A-Za-z][A-Za-z-]*)[:：](.*)$/

// One walk over the document's head: the title line (if line 0 is one), blank
// lines between it and the first field, then the contiguous run of
// field-shaped lines — [start, end) is that run's extent, the one boundary
// every field-block question is answered from.
type FieldBlockWalk = { title?: string; start: number; end: number; fields: Record<string, string> }

function walkFieldBlock(text: string): FieldBlockWalk {
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
  const start = i
  for (; i < lines.length; i++) {
    const m = UNIT_FIELD_LINE.exec(lines[i]!.trim())
    if (!m) break
    fields[m[1]!.toLowerCase()] = m[2]!.trim()
  }
  return { ...(title !== undefined ? { title } : {}), start, end: i, fields }
}

// The field block is the run of `Key: value` lines right after the title line
// (blank lines between the title and the first field allowed); the first
// other line ends it, so body text like `Owner: …` under a section is never a
// field. Without a title line the block starts at the top.
export function parseUnitDoc(text: string): UnitDoc {
  const { title, fields } = walkFieldBlock(text)
  const doc: UnitDoc = { fields }
  if (title !== undefined) doc.title = title
  if ("depends" in fields) doc.depends = /^none$/i.test(fields.depends!) ? "none" : listValue(fields.depends!)
  if ("touches" in fields) doc.touches = listValue(fields.touches!)
  if ("decompose" in fields) doc.decompose = fields.decompose!
  return doc
}

// The field block's near-miss scan (ruling 0228 D2, enacting 0165-077 and
// 0165-152): the block was the strictest grammar with the weakest near-miss
// discipline — a blank line between fields, a comment, `Key :`, `Key：` or
// `**Key:**` ended the block and dropped the declaration silently (the
// analysis/roadmap grammars got near-miss scans with 0084 and 0158; this one
// had none). The scan names the shapes. Its region is the pre-body document:
// line 0 through the line before the first `## ` heading (body text under a
// section is content, never a field — the block reader's own boundary). Two
// problem kinds, `known` the caller's field vocabulary (P7: the grammar's own
// names, never content judgment):
//   - a line naming a known field in any colon-bearing shape — the exact
//     `Key:` form, spaces before the colon, the fullwidth `：`, emphasis
//     wrapping — that sits outside the contiguous block (the block ended
//     early at a blank line, a comment, or the near-miss form itself);
//   - a repeated known-field key inside the block (the later line silently
//     replaced the earlier one).
// Every problem teaches the remedy. Consumers are the moments the document is
// judged as just-written output (P8): the planning collect, the decompose
// collect, and the phase-type load (which throws); the load-time readers keep
// the byte-identical floor (P10) — see the ruling's D2 item 4.
export function fieldBlockProblems(text: string, known: readonly string[]): string[] {
  const lines = text.split("\n")
  const { start, end } = walkFieldBlock(text)
  const problems: string[] = []
  // The region ends at the first `## ` heading — the body's own start.
  let regionEnd = lines.length
  for (let k = 0; k < lines.length; k++) {
    if (/^##\s/.test(lines[k]!.trim())) {
      regionEnd = k
      break
    }
  }
  // A known field's name in any of the shapes a hand writes it: emphasis-
  // wrapped (`**Key:**`), the exact form, spaces around the colon, fullwidth.
  // Line-anchored, so prose that merely mentions a field name is never one.
  const matchers = known.map((name) => ({ name, re: new RegExp(`^(?:\\*{1,2}|__)?\\s*${name}\\s*(?:\\*{1,2}|__)?\\s*[:：]`, "i") }))
  const inBlock = (k: number): boolean => k >= start && k < end
  for (let k = 0; k < regionEnd; k++) {
    if (inBlock(k)) continue
    const line = lines[k]!.trim()
    const hit = matchers.find(({ re }) => re.test(line))
    if (hit) {
      problems.push(
        `line ${k + 1} names the field \`${hit.name}:\` outside the field block (a blank line, a comment or a near-miss colon form ended the block early) — keep the field lines contiguous right after the title line`,
      )
    }
  }
  const seen = new Map<string, number>()
  for (let k = start; k < end; k++) {
    const key = UNIT_FIELD_LINE.exec(lines[k]!.trim())?.[1]?.toLowerCase()
    if (key === undefined || !known.some((name) => name.toLowerCase() === key)) continue
    const first = seen.get(key)
    if (first !== undefined) {
      problems.push(`line ${first + 1}'s \`${key}:\` is repeated at line ${k + 1} — the later line silently replaced the earlier; declare each field once`)
    } else {
      seen.set(key, k)
    }
  }
  return problems
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

// The declared-path escape rules (the unit grammar's own, one home — 0238
// D6d): a declaration's paths are target-directory-relative. `Touches`
// rejects the escapes for concurrency scoping (P17: a scope outside the
// project bounds no lane), and since 0238 the artifact declarations reject
// them through the same predicates (spec.ts's checker consumes
// pathEscapesRoot) — an `Artifacts:` existence test run at join(dir, path)
// would otherwise be satisfiable by a file outside the root.
export const isAbsolutePath = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
export const pathHasDotDot = (path: string): boolean => path.split(/[\\/]/).includes("..")
export const pathEscapesRoot = (path: string): boolean => isAbsolutePath(path) || pathHasDotDot(path)

// All problems of one index's units (G4; takes over 0046 D4). `external`: ids
// that exist outside this index and may be named (e.g. tasks of earlier
// phases). `parked`: the runtime park records (id → blocker, plans/0096 D7)
// validated as part of the graph — a park naming a nonexistent id is a
// collect problem, caught wherever the graph is checked (loadPlan, the
// planning/decompose collects). Overlapping `Touches` is not a problem — it
// only means two units will not run side by side.
export function unitProblems(
  level: UnitLevel,
  units: readonly UnitDecl[],
  opts: { external?: ReadonlySet<string>; parked?: ReadonlyMap<string, string> } = {},
): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const unit of units) {
    if (ids.has(unit.id)) problems.push(`duplicate unit ${unit.id}`)
    ids.add(unit.id)
  }
  const known = (id: string) => ids.has(id) || (opts.external?.has(id) ?? false)
  for (const [unit, blocker] of opts.parked ?? []) {
    if (blocker === unit) problems.push(`${unit} parks on itself`)
    else if (!isUnitId(level, blocker)) problems.push(`${unit} parks on "${blocker}", which is not a ${level} id (${ID_SHAPES[level].label})`)
    else if (!known(blocker)) problems.push(`${unit} parks on unknown ${blocker}`)
  }
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
        if (isAbsolutePath(path)) problems.push(`${unit.id} touches an absolute path: ${path}`)
        else if (pathHasDotDot(path)) problems.push(`${unit.id} touches a path with ..: ${path}`)
      }
    }
    // The plan-recorded execution mode (plans/0075): the value set is grammar,
    // so an unknown (or empty) value is a problem like every other field's —
    // absent is legal and means "no opinion".
    if (unit.decompose !== undefined && parseDecompose(unit.decompose) === undefined) {
      problems.push(
        `${unit.id} has ${unit.decompose === "" ? "an empty" : `an unknown`} Decompose value${unit.decompose === "" ? "" : ` "${unit.decompose}"`} (write ${DECOMPOSE_MODES.join(", ")}, or omit the field)`,
      )
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
