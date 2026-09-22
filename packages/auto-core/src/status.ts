// Read-only overview (plans/0047 L1, ruling R2): the round → phase → task →
// subtask tree of the current round with states and declared dependencies,
// rendered from the unit files and the runtime state. It replaces reading
// PLAN.md by eye; nothing is written, and no summary file exists (one source
// of truth). Shells print it from their `status` subcommand.
import { currentPhase, currentRound, phaseIndexPath, phaseLabel, readPhases } from "./phases"
import { loadPlan, type Task } from "./tasks"

const TASK_MARK: Record<Task["status"], string> = { pending: " ", in_progress: "▶", blocked: "⏸", done: "✓" }

function depends(task: Task): string {
  if (task.depends === undefined) return ""
  return task.depends === "none" ? " (depends: none)" : ` (depends: ${task.depends.join(", ") || "∅"})`
}

// Lines of the tree; problems (missing or invalid indexes) become ⚠ lines so
// the view never fails.
export async function renderStatus(dir: string): Promise<string[]> {
  const round = await currentRound(dir)
  const lines: string[] = []
  let state
  try {
    state = await readPhases(dir)
  } catch (error) {
    return [`⚠ ${error instanceof Error ? error.message : String(error)}`]
  }
  if (!state) return [`⚠ phase index ${phaseIndexPath(round)} is missing; run opencode-auto init to establish the round`]
  const current = currentPhase(state)
  lines.push(`R-${String(round).padStart(2, "0")} (${state.done.size}/${state.phases.length} phases done)`)
  for (const phase of state.phases) {
    const mark = state.done.has(phase.id) ? "✓" : phase === current ? "▶" : " "
    lines.push(`  [${mark}] ${phaseLabel(phase)}`)
    let tasks: Task[]
    try {
      tasks = (await loadPlan(dir, phase)).tasks
    } catch (error) {
      lines.push(`      ⚠ ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const task of tasks) {
      const checklist = task.checklist ?? []
      const count = checklist.length ? ` [subtasks ${checklist.filter((item) => item.done).length}/${checklist.length}]` : ""
      const attempts = task.attempts && task.status !== "done" ? ` (attempts: ${task.attempts})` : ""
      lines.push(`      [${TASK_MARK[task.status]}] ${task.id} ${task.title}${depends(task)}${count}${attempts}`)
      if (task.status === "done") continue
      checklist.forEach((item, i) => {
        lines.push(`          [${item.done ? "✓" : " "}] S${String(i + 1).padStart(2, "0")} ${item.text}`)
      })
    }
  }
  return lines
}
