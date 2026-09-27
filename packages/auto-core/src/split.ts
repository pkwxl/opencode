// The lead's split (plans/0059 D3–D4): under `--subtask auto` the lead session
// works the whole task, and may end instead by writing docs/T-NNN/subtasks.md,
// one checklist line per remaining stream:
//   - [ ] <title>: <what, where, how to verify> Depends: S01 Artifacts: <paths>
// Item n is S<nn> (the positional ids of document/state.ts). This module is
// the pure half of the driver's side: it parses the lines, checks them against
// the mechanical guard, and renders the S<nn>/todo.md scope file the driver
// writes from each accepted line — the lead writes the plan once, as the
// checklist, and never a todo.md. The usage half of the guard (the lead's
// final figure against the wall, src/usage.ts splitUsageReached) and the
// accept / reject flow live in execute.ts executeWhole.
//
// The guard, all of which must hold for a split to be taken:
//   - 2 to 5 items: one stream is no split, more than five is finer than a
//     split ever pays for (0059 §2: every item re-establishes context);
//   - every line parses: a description before its fields and at least one
//     `Artifacts:` path (the disjointness check below needs them);
//   - the dependency graph is valid (checklistProblems: known S<nn> ids, no
//     self-dependency, no cycle, relative paths only);
//   - no path is declared by two items unless one of them (transitively)
//     depends on the other — streams that share a file must run in order.
//     An absent `Depends:` means the previous item (G3), as it does for every
//     checklist, so a split without the field is serial and may share paths.
// AUTO-DECISION: the split has a module of its own instead of living in tasks.ts beside renderTaskTodo (the parser, the guard and the scope file are one concern that only execute and the runner use; tasks.ts is the store every module loads)
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { EOF_MARK } from "./doccheck"
import { subtaskDoc } from "./docpaths"
import { declaredArtifacts, SUBTASK_TODO_SECTIONS } from "./document/spec"
import { checklistProblems, scanSubtaskStates, subtaskId } from "./document/state"
import { resolveDepends } from "./document/unit"
import { subtasks } from "./tasks"

export const SPLIT_MIN = 2
export const SPLIT_MAX = 5

// One line of the lead's split.
export type SplitItem = {
  // 1-based position: item n is S<nn>.
  index: number
  // The checklist item's text as written (the subtask session receives it
  // whole, and its shape check reads `Artifacts:` from it).
  text: string
  // The text before the first field: the stream's title and description.
  description: string
  // `Depends:` as the unit grammar reads it: absent = the previous item,
  // "none" = no prerequisite, [] = an empty value (a problem).
  depends?: string[] | "none"
  // The paths `Artifacts:` declares (document/spec.ts declaredArtifacts).
  artifacts: string[]
}

// Field markers inside a line: the protocol strings `Depends:` and
// `Artifacts:`, read case-insensitively (plans/0035 D2), in either order.
const FIELD = /(?:^|\s)(depends|artifacts)\s*[:：]/gi

export function splitItem(text: string, index: number): SplitItem {
  const marks = [...text.matchAll(FIELD)].map((m) => ({ name: m[1]!.toLowerCase(), start: m.index!, end: m.index! + m[0].length }))
  const value = (name: string): string | undefined => {
    const at = marks.findIndex((mark) => mark.name === name)
    if (at === -1) return undefined
    return text.slice(marks[at]!.end, marks[at + 1]?.start ?? text.length).trim()
  }
  const depends = value("depends")
  const artifacts = value("artifacts")
  return {
    index,
    text,
    description: (marks.length ? text.slice(0, marks[0]!.start) : text).trim(),
    ...(depends !== undefined ? { depends: dependsValue(depends) } : {}),
    artifacts: artifacts !== undefined ? declaredArtifacts(`Artifacts: ${artifacts}`).map((spec) => spec.path) : [],
  }
}

// `none` declares a root; otherwise the ids, with backticks and a trailing
// full stop shed (a line often ends in one).
function dependsValue(value: string): string[] | "none" {
  if (/^none\.?$/i.test(value)) return "none"
  return value
    .split(/[\s,，、;；]+/)
    .map((token) => token.replace(/^`+|`+$/g, "").replace(/\.+$/, ""))
    .filter(Boolean)
}

// The split a subtasks.md text declares: its checklist lines, in order.
export function parseSplit(text: string): SplitItem[] {
  return subtasks(text).map((item, i) => splitItem(item.text, i + 1))
}

// The guard's structural checks (everything but the usage figure); empty =
// the split may be taken. Each line names what failed, for the log and for
// the lead's rejection note.
// AUTO-RESOLVE: what does the guard's "every line parses" require of a split line? -> a description before its fields and at least one `Artifacts:` path (the shared-path check has nothing to compare for a line without paths, so a stream declaring no files could never be shown to change its own; the line format the clause gives carries both)
export function splitProblems(items: readonly SplitItem[]): string[] {
  const problems: string[] = []
  if (items.length < SPLIT_MIN || items.length > SPLIT_MAX) {
    problems.push(`${items.length} item${items.length === 1 ? "" : "s"}, where a split takes ${SPLIT_MIN} to ${SPLIT_MAX} streams`)
  }
  for (const item of items) {
    const id = subtaskId(item.index)
    if (!item.description) problems.push(`${id} has no description before its fields`)
    if (!item.artifacts.length) problems.push(`${id} declares no \`Artifacts:\` paths`)
  }
  problems.push(
    ...checklistProblems(
      items.map((item) => ({
        done: false,
        ...(item.depends !== undefined ? { depends: item.depends } : {}),
        ...(item.artifacts.length ? { touches: item.artifacts } : {}),
      })),
    ),
  )
  problems.push(...sharedPaths(items))
  return problems
}

// Paths two items both declare where neither (transitively) depends on the
// other: the two streams could run side by side and edit the same file.
function sharedPaths(items: readonly SplitItem[]): string[] {
  const deps = resolveDepends(
    items.map((item) => ({ id: subtaskId(item.index), ...(item.depends !== undefined ? { depends: item.depends } : {}) })),
  )
  // Every unit an id waits for, directly or not (a cycle is reported by
  // checklistProblems; the walk only has to terminate on one).
  const before = (id: string): Set<string> => {
    const seen = new Set<string>()
    const walk = (at: string) => {
      for (const dep of deps.get(at) ?? []) {
        if (seen.has(dep)) continue
        seen.add(dep)
        walk(dep)
      }
    }
    walk(id)
    return seen
  }
  const out: string[] = []
  items.forEach((a, i) => {
    for (const b of items.slice(i + 1)) {
      const shared = a.artifacts.filter((path) => b.artifacts.some((other) => overlaps(path, other)))
      if (!shared.length) continue
      const idA = subtaskId(a.index)
      const idB = subtaskId(b.index)
      if (before(idB).has(idA) || before(idA).has(idB)) continue
      out.push(`${idA} and ${idB} both declare ${shared.join(", ")} but neither depends on the other`)
    }
  })
  return out
}

// Two declared paths name the same file, or one is a directory holding the
// other.
// AUTO-DECISION: a directory path covers the files under it in the shared-path check (the guard's rule names equal paths; a stream declaring `src/dma/` and another declaring `src/dma/ring.ts` would still edit the same file side by side, which is exactly what the rule is there to stop)
function overlaps(a: string, b: string): boolean {
  const x = normal(a)
  const y = normal(b)
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

const normal = (path: string): string => path.replace(/^\.\//, "").replace(/\/+$/, "")

// The scope file the driver writes for an accepted line: the field block
// (`Depends:` as declared, `Touches:` from the declared paths), then the two
// protocol sections, closed with the terminator.
// AUTO-DECISION: `Touches:` carries the line's `Artifacts:` paths (the unit grammar's field for what a unit changes, read by the dependency checks and, later, by a parallel scheduler; the design names the field block's source as `Depends:`/`Artifacts:` and the grammar has no `Artifacts` field)
export function renderSplitTodo(item: SplitItem): string {
  const [scope, artifacts] = SUBTASK_TODO_SECTIONS
  return [
    ...(item.depends !== undefined ? [`Depends: ${item.depends === "none" ? "none" : item.depends.join(", ")}`] : []),
    `Touches: ${item.artifacts.join(", ")}`,
    "",
    scope,
    "",
    item.description,
    "",
    artifacts,
    "",
    ...item.artifacts.map((path) => `- ${path}`),
    "",
    EOF_MARK,
    "",
  ].join("\n")
}

// Writes every accepted line's S<nn>/todo.md (a copy the lead wrote against
// the rule is overwritten: the driver's file is the scope statement).
export async function writeSplitTodos(dir: string, taskId: string, items: readonly SplitItem[]): Promise<void> {
  for (const item of items) {
    const file = join(dir, subtaskDoc(taskId, item.index, "todo"))
    await mkdir(dirname(file), { recursive: true })
    await Bun.write(file, renderSplitTodo(item))
  }
}

// Whether a split was taken for the task: its checklist has items and their
// state files exist. Under auto the driver writes those files only when it
// accepts the lead's split, so the lead's stage is over and the checklist is
// what remains (a checklist left by the planned pipeline, which writes the
// same files, reads the same way).
export async function splitTaken(dir: string, taskId: string, items: number): Promise<boolean> {
  return items > 0 && (await scanSubtaskStates(dir, taskId, items)).active
}
