// Task-unit fixtures (M3.4): tests describe a phase's tasks in a compact
// notation — `## T-001: title [status]`, optional `  - key: value` runtime
// lines (attempts, fork-base), a body, and `- [ ]` / `- [x]` checklist lines —
// and get either an in-memory Plan (planOf) or the same tasks written to disk
// as task units of the implicit phase R-01/P01-implement (seedUnits). The
// notation is test-only; the driver reads nothing but the unit files.
// Lives under fixtures/ — bun test only collects *.test.ts.
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { syncPhaseIndex } from "../../src/phases"
import { loadPlan, renderTaskIndex, subtasks, UNITS_FILE, type Plan, type PlanPhase, type Status, type Task } from "../../src/tasks"

type Parsed = Task & { rawBody: string }

const HEADING = /^## (T-[\w-]+): (.+?)\s*\[(pending|in_progress|blocked|done)\]\s*$/
const FIELD = /^\s+- ([\w-]+): (.*)$/

function parseNotation(text: string): Parsed[] {
  const lines = text.split("\n")
  const out: Parsed[] = []
  let i = 0
  while (i < lines.length) {
    const m = HEADING.exec(lines[i]!)
    if (!m) {
      i++
      continue
    }
    const fields = new Map<string, string>()
    let j = i + 1
    for (; j < lines.length; j++) {
      const f = FIELD.exec(lines[j]!)
      if (!f) break
      fields.set(f[1]!, f[2]!.trim())
    }
    const body: string[] = []
    while (j < lines.length && !lines[j]!.startsWith("## ")) body.push(lines[j++]!)
    const raw = body.join("\n").trim()
    out.push({
      id: m[1]!,
      title: m[2]!.trim(),
      status: m[3] as Status,
      attempts: Number(fields.get("attempts") ?? 0),
      ...(fields.get("fork-base") ? { forkBase: fields.get("fork-base") } : {}),
      body: raw
        .split("\n")
        .filter((line) => !/^\s*- \[( |x|X)\]/.test(line))
        .join("\n")
        .trim(),
      checklist: subtasks(raw),
      rawBody: raw,
    })
    i = j
  }
  return out
}

const strip = ({ rawBody: _, ...task }: Parsed): Task => task

// The implicit phase seedUnits writes to.
export const IMPLICIT_PHASE: PlanPhase = { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" }

// Reload the seeded phase from disk.
export const reloadUnits = (dir: string) => loadPlan(dir, IMPLICIT_PHASE)

// The raw runtime state file (empty when absent).
export const unitsText = (dir: string) => Bun.file(join(dir, UNITS_FILE)).text().catch(() => "")

// An in-memory plan of the implicit phase (no filesystem).
export function planOf(text: string, dir = "."): Plan {
  return { dir, phase: "R-01.P01", index: "docs/R-01/P01-implement/tasks.md", tasks: parseNotation(text).map(strip) }
}

// Write the tasks as units of R-01/P01-implement under dir (phase index and
// directory included) and return the loaded plan. Done tasks get done.md,
// others todo.md; a checklist goes to docs/T-NNN/subtasks.md; status /
// attempts / fork-base go to .auto/units.json.
export async function seedUnits(dir: string, text: string): Promise<Plan> {
  const [phase] = await syncPhaseIndex(dir, 1, "m")
  const tasks = parseNotation(text)
  await Bun.write(join(dir, phase!.dir, "tasks.md"), renderTaskIndex("R-01.P01", tasks.map((t) => ({ id: t.id, title: t.title, done: t.status === "done" }))))
  const units: Record<string, Record<string, unknown>> = {}
  for (const t of tasks) {
    await mkdir(join(dir, "docs", t.id), { recursive: true })
    const doc = [`# ${t.id}: ${t.title}`, "Phase: R-01.P01", "", t.body, "", "<!-- auto: eof -->", ""].join("\n")
    await Bun.write(join(dir, "docs", t.id, t.status === "done" ? "done.md" : "todo.md"), doc)
    const items = (t.checklist ?? []).map((item) => `- [${item.done ? "x" : " "}] ${item.text}`)
    if (items.length) await Bun.write(join(dir, "docs", t.id, "subtasks.md"), items.join("\n") + "\n")
    const entry: Record<string, unknown> = {}
    if (t.status === "in_progress" || t.status === "blocked") entry.status = t.status
    if (t.attempts) entry.attempts = t.attempts
    if (t.forkBase) entry.forkBase = t.forkBase
    if (Object.keys(entry).length) units[t.id] = entry
  }
  if (Object.keys(units).length) await Bun.write(join(dir, ".auto", "units.json"), JSON.stringify({ tasks: units }, null, 2) + "\n")
  return loadPlan(dir, phase!)
}
