// Planning input (plans/0053 D9): the text a planning step plans against, kept
// as plan-input.md in the phase directory (role planningInput, D10). One file
// per phase holds the latest input; each version is its own driver commit, so
// `git log -- <file>` is the input history. A new input is written and
// committed before the planning unit starts, ahead of its SHA baseline, so
// the close-out check never sees it. The separate commit is what keeps the
// input safe: an interrupted planning session leaves a dirty tree that a
// person must commit or clean before the next run (plans/0053 F1), and a
// `git clean` must not take the input the resume point depends on.
import { basename, join } from "node:path"
import { PLAN_INPUT_NAME } from "./docpaths"
import { beginUnit, commitTree } from "./git"
import type { PlanPhase } from "./tasks"

// The input a command hands a planning step: the text, and for `--file` the
// file it came from (named in the commit subject, never written to the file).
export type PlanInput = { text: string; source?: string }

// docs/R-NN/P<nn>-<type>/plan-input.md
export const planInputPath = (phase: PlanPhase): string => join(phase.dir, PLAN_INPUT_NAME)

// The persisted form: the text verbatim, trailing whitespace trimmed, one final newline.
export function planInputText(text: string): string {
  return `${text.trimEnd()}\n`
}

// The phase's persisted input; undefined when there is none.
export async function readPlanInput(dir: string, phase: PlanPhase): Promise<string | undefined> {
  return Bun.file(join(dir, planInputPath(phase))).text().catch(() => undefined)
}

export type SavedPlanInput =
  // The file already holds this text: nothing written, nothing committed.
  | { type: "same" }
  // A new or different text, written and committed.
  | { type: "saved" }
  // The tree was not clean before the write; a person commits or cleans it.
  | { type: "dirty"; files: string[] }
  // The commit failed; the file is left in the worktree.
  | { type: "failed"; question: string }

// Persist an input and commit it on its own (`Auto-Task: PLAN`,
// `Auto-Stage: plan-input`). The tree must be clean first: preflight
// guaranteed it and numbering may have committed since, so the gate is a unit
// start's (beginUnit: driver-state leftovers self-heal, anything else is
// dirty). title names the phase in the commit subject.
export async function savePlanInput(dir: string, phase: PlanPhase, input: PlanInput, title: string): Promise<SavedPlanInput> {
  if (!input.text.trim()) throw new Error("the planning input must not be empty")
  const text = planInputText(input.text)
  if ((await readPlanInput(dir, phase)) === text) return { type: "same" }
  const task = { id: "PLAN", title: `planning input (${title})` }
  const gate = await beginUnit(dir, {}, task)
  if (gate.type === "dirty") return gate
  await Bun.write(join(dir, planInputPath(phase)), text)
  const subject = `PLAN plan-input ${title}${input.source ? ` (from ${basename(input.source)})` : ""}`
  const committed = await commitTree(dir, task, { stage: "plan-input", subject })
  if (!committed.ok) {
    const failures = committed.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")
    return { type: "failed", question: `planning input commit failed: ${failures}. The file is left in the worktree; please handle git manually and re-run.` }
  }
  return { type: "saved" }
}
