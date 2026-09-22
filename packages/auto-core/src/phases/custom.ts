// Custom phase types (M3.6, plans/0047 §5; root plan open question 6): a
// project defines a phase type in one Markdown file,
// .opencode/auto/phases/<type>.md, and references it by type id in the phases
// value (`analysis,security-review,implement`). The file carries the whole
// registry entry, so one type lives in one file:
//
//   # Security review                 title = display name
//
//   Tasks: yes                        optional; only yes (task-less types stay builtin)
//   Gate: none                        optional; none | verdict | acceptance | verdict, acceptance
//   Phase-artifacts: threat-model.md  optional; standard artifacts in the phase dir
//   Task-artifacts: review.md         optional; standard artifacts in each task dir
//
//   ## plan duties                    required; the phase-plan duty paragraph
//   ## decompose duties               optional; the decompose duty paragraph
//
// Field names and section headings are protocol strings the driver parses
// (plans/0035 §3). A custom type always has tasks: the direct session of a
// task-less phase is knowledge extraction, a builtin concern (F8: keep the
// external surface thin). The decompose session uses the phase-generic
// template body (decompose-m, the variant that renders phaseName and
// phaseDuties).
//
// Loading is synchronous and stateless, like loadModes: callers pass the
// result to the registry lookups, and a phase unit carries its entry.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { parseUnitDoc } from "../document/unit"
import { BUILTIN_PHASE_TYPES, PHASE_GATES, PRESET_FORM, type PhaseGate, type PhaseTypeEntry } from "./registry"

export const PHASE_TYPE_DIR = join(".opencode", "auto", "phases")

// Same shape as mode and intent pack names (the phase directory grammar
// P<nn>-<type> accepts it).
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

const FIELDS = ["tasks", "gate", "phase-artifacts", "task-artifacts"] as const
const SECTIONS: Record<string, "planDuties" | "decomposeDuties"> = {
  "plan duties": "planDuties",
  "decompose duties": "decomposeDuties",
}
const EOF_LINE = "<!-- auto: eof -->"

// Driver-owned or protocol file names a standard artifact may not take, per
// unit directory (a phase dir resp. a task dir).
const RESERVED_PHASE_FILES = ["todo.md", "done.md", "tasks.md", "handover.md", "acceptance.md"]
const RESERVED_TASK_FILES = ["todo.md", "done.md", "subtasks.md", "context.md", "shared.md", "report.md", "handoff.md", "testhandoff.md"]

// Builtins plus the project's custom types. Invalid files throw, naming the
// file (the CLI turns this into an exit-1 usage error). No dir, or no
// directory on disk → the builtins only.
export function loadPhaseTypes(dir?: string): PhaseTypeEntry[] {
  const types = [...BUILTIN_PHASE_TYPES]
  if (!dir) return types
  let files: string[] = []
  try {
    files = readdirSync(join(dir, PHASE_TYPE_DIR))
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
  }
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue
    types.push(parsePhaseTypeFile(file.slice(0, -3), readFileSync(join(dir, PHASE_TYPE_DIR, file), "utf8")))
  }
  return types
}

// Parse one type file; throws with the file path and the offending part.
export function parsePhaseTypeFile(type: string, text: string): PhaseTypeEntry {
  const where = `phase type file ${join(PHASE_TYPE_DIR, `${type}.md`)}`
  const nameProblem = typeNameProblem(type)
  if (nameProblem) throw new Error(`${where}: ${nameProblem}`)
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (!/^#\s+\S/.test(lines[0]?.trim() ?? "")) throw new Error(`${where} must start with a title line "# <display name>"`)
  const doc = parseUnitDoc(text)
  const name = lines[0]!.trim().replace(/^#\s+/, "")
  const unknown = Object.keys(doc.fields).filter((key) => !(FIELDS as readonly string[]).includes(key))
  if (unknown.length) {
    throw new Error(`${where} has unknown field(s) ${unknown.join(", ")} (available: Tasks, Gate, Phase-artifacts, Task-artifacts)`)
  }
  const tasks = (doc.fields.tasks ?? "yes").toLowerCase()
  if (tasks === "no") {
    throw new Error(`${where}: Tasks: no is not supported (a custom phase type always plans and runs tasks; task-less phases are builtin only)`)
  }
  if (tasks !== "yes") throw new Error(`${where}: Tasks must be yes; got "${doc.fields.tasks}"`)
  const gates = gateList(where, doc.fields.gate)
  const phaseArtifacts = artifactList(where, "Phase-artifacts", doc.fields["phase-artifacts"], RESERVED_PHASE_FILES)
  const taskArtifacts = artifactList(where, "Task-artifacts", doc.fields["task-artifacts"], RESERVED_TASK_FILES)
  const sections = parseSections(where, lines)
  if (!sections.planDuties) throw new Error(`${where} needs a non-empty "## plan duties" section (the phase planning session's duties)`)
  return {
    type,
    name,
    dutiesRef: type,
    planDuties: sections.planDuties,
    ...(sections.decomposeDuties ? { decomposeDuties: sections.decomposeDuties } : {}),
    decomposeTemplate: "decompose-m",
    phaseArtifacts,
    taskArtifacts,
    hasTasks: true,
    gates,
    origin: "project",
  }
}

// `Gate:` — none, or a comma list of distinct gates (M4.2, plans/0049 G7).
function gateList(where: string, raw: string | undefined): PhaseGate[] {
  const value = (raw ?? "none").trim().toLowerCase()
  if (value === "none") return []
  const items = value.split(",").map((item) => item.trim())
  const bad = items.filter((item) => !(PHASE_GATES as readonly string[]).includes(item))
  if (bad.length || new Set(items).size !== items.length) {
    throw new Error(`${where}: Gate must be none or a comma list of distinct ${PHASE_GATES.join(" / ")}; got "${raw}"`)
  }
  return items as PhaseGate[]
}

// undefined = usable as a custom type id. Model-routing role words are reserved
// too, but that list belongs to the driver (switches.ts phaseTypeRoleProblems,
// checked where the driver loads the types; D8: this domain stays below it).
export function typeNameProblem(type: string): string | undefined {
  if (!NAME_PATTERN.test(type)) return "the file name must be a lowercase letter followed by letters/digits/hyphens"
  if (BUILTIN_PHASE_TYPES.some((entry) => entry.type === type)) return `"${type}" is a builtin phase type and cannot be redefined`
  if (PRESET_FORM.test(type)) return `"${type}" reads as a letter preset (only admtvk letters); pick a name with another letter`
  return undefined
}

function artifactList(where: string, field: string, raw: string | undefined, reserved: string[]) {
  if (raw === undefined) return []
  const paths = raw
    .split(/[\s,]+/)
    .map((token) => token.replace(/^`+|`+$/g, ""))
    .filter(Boolean)
  if (!paths.length) throw new Error(`${where}: ${field} is empty (omit the field for none)`)
  for (const path of paths) {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`${where}: ${field} path "${path}" must be relative to the unit directory, without ..`)
    }
    if (reserved.includes(path)) throw new Error(`${where}: ${field} path "${path}" is a driver-owned file name`)
  }
  return paths.map((path) => ({ path, label: path, role: "artifact" as const }))
}

function parseSections(where: string, lines: string[]): Partial<Record<"planDuties" | "decomposeDuties", string>> {
  const bodies = new Map<"planDuties" | "decomposeDuties", string[]>()
  let current: "planDuties" | "decomposeDuties" | undefined
  for (const line of lines.slice(1)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const key = SECTIONS[heading[1]!.toLowerCase()]
      if (!key) throw new Error(`${where} has unknown section "## ${heading[1]}" (available: ## plan duties, ## decompose duties)`)
      if (bodies.has(key)) throw new Error(`${where} repeats section "## ${heading[1]}"`)
      bodies.set(key, [])
      current = key
      continue
    }
    if (line.trim() === EOF_LINE) continue
    if (current) bodies.get(current)!.push(line)
  }
  const out: Partial<Record<"planDuties" | "decomposeDuties", string>> = {}
  for (const [key, body] of bodies) {
    const text = body.join("\n").trim()
    if (text) out[key] = text
  }
  return out
}
