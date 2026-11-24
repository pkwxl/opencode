// Shared task-handoff decisions for executor grants and session-driven execution.
import { join } from "node:path"
import { checkArtifactSpecs, taskArtifactSpecs } from "./document/spec"
import { taskChangedPaths } from "./git"
import { pathsOverlap } from "./lanes"
import { renderParkRelease, type PromptFacts, type TaskDocs } from "./prompt"
import { taskStatePaths, type Plan, type Task } from "./tasks"

// The steer chain's bounds (plans/0168 D1, finding 0165-018): past the
// advisory count of one scope's continuations the next session's prompt
// carries the chain's length and an honest-assessment teaching (the 0023
// TEST_HANDOVER_ADVISORY shape, same number); past the bound the verdict
// blocks for the person (P2's terminal — the chain is an automatic
// escalation). Both provisional, the 0130 D5 handover journal the named
// re-measurement basis; constants like their 0023 sibling, no switch (P21).
export const STEER_CHAIN_ADVISORY = 10
export const STEER_CHAIN_BOUND = 20

// The park's validity over one fresh `Status: park <blocker id>` directive:
// the blocker must be a live member of this phase's index, and every
// `Artifacts:` entry the task declares must be on disk (the spec-driven
// check; a task declaring nothing parks on the prose gate — the session's
// own claim, inspected at wrap-up as any claim is). An id outside the index
// splits on the state-file probe (plans/0237 D2): a task of this target
// directory (a state file exists — a cross-phase task) is the foreign
// verdict, a planning failure the person reorders; an id that exists
// nowhere is the session's own invention — a collect problem (0096 D7's
// deadlock letter) that joins the invalid arm's one relaunch with feedback,
// never a thrown exit 1 after a session already spent work.
type ParkCheck = { type: "ok" } | { type: "invalid"; problems: string[] } | { type: "foreign" }

export async function parkCheck(planDir: string, plan: Plan, task: Task, blocker: string): Promise<ParkCheck> {
  const target = plan.tasks.find((entry) => entry.id === blocker)
  if (target === undefined) {
    const paths = taskStatePaths(blocker)
    const known = (await Bun.file(join(planDir, paths.pending)).exists()) || (await Bun.file(join(planDir, paths.complete)).exists())
    if (!known) {
      return {
        type: "invalid",
        problems: [
          `${blocker} is not a task of this target directory — no ${paths.pending} or ${paths.complete} exists; the id was invented or mistyped. Park on a real blocker of this phase's index, or end with the honest status lines`,
        ],
      }
    }
    return { type: "foreign" }
  }
  const problems: string[] = []
  if (blocker === task.id) problems.push("a task cannot park on itself")
  if (target.status === "done") problems.push(`${blocker} is already closed — do not park on it; continue this task or surface the gap`)
  const specs = taskArtifactSpecs(await Bun.file(join(planDir, taskStatePaths(task.id).pending)).text().catch(() => ""))
  if (specs.length) {
    const checked = await checkArtifactSpecs(specs, { dir: planDir, policy: "declared" })
    problems.push(...checked.problems)
  }
  return problems.length ? { type: "invalid", problems } : { type: "ok" }
}

// The release note (D7): the resumed task's first dispatch carries the
// blocker's id, how it ended (a `Closed:` record names its reason;
// anything else completed), and
// the re-merge surface — the blocker's changed paths ∩ this task's
// `Touches:` (everything it changed when the task declares nothing): the
// files the successor must re-read first, since they moved under a task
// planned before the blocker existed. The successor judges whether the
// consumable it waited for exists; it may park again or surface gaps.
export async function parkReleaseNote(facts: PromptFacts, dir: string, plan: Plan, task: Task, docs: TaskDocs): Promise<string> {
  const blocker = task.parked!
  const closed = plan.closed.get(blocker)
  const changed = await taskChangedPaths(dir, blocker)
  const surface = (task.touches?.length ? changed.filter((path) => task.touches!.some((touch) => pathsOverlap(touch, path))) : changed).slice(0, 15)
  return renderParkRelease(facts, {
    blocker,
    ended: closed !== undefined ? `closed without completing (${closed})` : "completed",
    files: surface,
    handoffFile: docs.handoff,
    more: Math.max(0, changed.length - surface.length),
  })
}
