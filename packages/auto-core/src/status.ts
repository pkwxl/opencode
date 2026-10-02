// Read-only overview (plans/0047 L1, ruling R2): the round → phase → task →
// subtask tree of the current round with states and declared dependencies,
// rendered from the unit files and the runtime state. It replaces reading
// PLAN.md by eye; nothing is written, and no summary file exists (one source
// of truth). Shells print it from their `status` subcommand. Marks: ✓ done,
// ⊘ closed (plans/0053 D16: done for scheduling, not delivered), ▶ current /
// in progress, ⏸ blocked.
// Since plans/0068 S4 (D13) the tree opens with an in-flight lanes section:
// the live lanes read from `.auto/units.json`'s runtime fields (the registry
// D14's orphan scan reads), each with its park worktree and worker pid — the
// one read-model section the lanes design adds, present exactly while a
// parent run holds lanes (a killed parent's leftovers show here too, which
// is the recovery story's first line).
import { currentPhase, currentRound, phaseIndexPath, phaseLabel, readPhases } from "./phases"
import { shellProfile } from "./shell"
import { laneRecords, loadPlan, type Task } from "./tasks"

const TASK_MARK: Record<Task["status"], string> = { pending: " ", in_progress: "▶", blocked: "⏸", done: "✓" }

// A closed task stays done; ⊘ overrides its ✓.
const taskMark = (task: Task) => (task.closed !== undefined ? "⊘" : TASK_MARK[task.status])

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
  // plan owns the rounds (plans/0053 D31): the pointer names it, with the bin
  // from the shell profile.
  if (!state) return [`⚠ phase index ${phaseIndexPath(round)} is missing; run ${shellProfile().bin} plan to establish the round`]
  // The in-flight lanes section (plans/0068 D13, S4): first, like the shell's
  // live-lock line — the fact a watcher polls for. Registry order, each lane
  // with its worktree (the park path, repository-relative) and the worker's
  // pid; an entry without a pid degrades to the worktree alone.
  const lanes = await laneRecords(dir)
  if (lanes.length) {
    lines.push(`lanes in flight (${lanes.length}):`)
    for (const lane of lanes) {
      lines.push(`  [▶] ${lane.unit} (worktree ${lane.worktree.replaceAll("\\", "/")}${lane.pid !== undefined ? `, pid ${lane.pid}` : ""})`)
    }
  }
  const current = currentPhase(state)
  lines.push(`R-${String(round).padStart(2, "0")} (${state.done.size}/${state.phases.length} phases done)`)
  for (const phase of state.phases) {
    // Closed before done, as in formatPhases: the two views agree.
    const mark = state.closed.has(phase.id) ? "⊘" : state.done.has(phase.id) ? "✓" : phase === current ? "▶" : " "
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
      lines.push(`      [${taskMark(task)}] ${task.id} ${task.title}${depends(task)}${count}${attempts}`)
      if (task.status === "done") continue
      checklist.forEach((item, i) => {
        lines.push(`          [${item.done ? "✓" : " "}] S${String(i + 1).padStart(2, "0")} ${item.text}`)
      })
    }
  }
  return lines
}
