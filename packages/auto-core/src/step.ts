// Step mode (OPENCODE_AUTO_STEP, design plans/0012-step-mode-design.md): three
// inclusive granularities phase/task/subtask, hard-pausing at the matching (and
// coarser) pipeline boundaries — after the phase handover completes, after the task's
// final-state commit, after the subtask tick commit; any input line (including an
// empty Enter) releases it, no timeout auto-continue (unlike --wait-between's pause
// with timeout). While paused and waiting, ^C is forwarded to the process-level
// handler; two consecutive Ctrl+C force-quit 130 (same as askHuman/
// waitBetweenTasks).
import { createInterface } from "node:readline/promises"
import type { Boundary, Interactive } from "./control-types"
import { log } from "./log"
import { statsWaitBegin, statsWaitEnd } from "./stats"
import { autoSwitches, type StepMode } from "./switches"

// Fineness order of boundaries and tiers (off always 0): the finer the value the
// larger its rank; a boundary pauses when boundary rank ≤ tier rank.
const RANK: Record<StepMode | Boundary, number> = { off: 0, phase: 1, task: 2, subtask: 3 }

// Whether a tier covers a boundary (pure function, for unit tests): inclusive —
// subtask covers every boundary, task covers task and phase, phase covers only
// phase, off pauses nowhere.
export function stepApplies(step: StepMode, boundary: Boundary): boolean {
  return RANK[boundary] <= RANK[step]
}

// The step pause at a boundary: with the switch off (default) it is zero-behavior and
// returns immediately; otherwise it hard-waits for one line of human input before
// releasing (the input's content is not interpreted; an empty Enter just continues).
// interactive = --interactive's persistent input line (sparing two readlines from
// fighting over stdin; its close fallback semantics apply equally); step explicitly
// overrides the tier (default takes OPENCODE_AUTO_STEP's parsed value, injected for
// unit tests); io is injected for unit tests. When dir passes the target directory,
// the wait interval is deducted from total/AI time via statsWaitBegin/End and
// recorded separately as waitMs (one of STATS_PLAN §3's three human-wait points);
// with off's zero behavior, stats are equally untouched.
export async function stepPause(
  boundary: Boundary,
  label: string,
  opts: {
    interactive?: Interactive
    step?: StepMode
    io?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }
    dir?: string
  } = {},
): Promise<void> {
  const step = opts.step ?? autoSwitches().step
  if (!stepApplies(step, boundary)) return
  const promptText = `⏸ step pause (step=${step}): ${label} done, press Enter to continue: `
  // Human-wait deduction: the segment closes during the wait (neither aiMs nor wallMs
  // grows), reopening when it ends; the exceptional path likewise pairs waitEnd via
  // finally, leaving no dangling closed segment.
  await statsWaitBegin(opts.dir, `stepPause:${boundary}`)
  try {
    if (opts.interactive) {
      await opts.interactive.question(promptText)
    } else {
      const rl = createInterface({ input: opts.io?.input ?? process.stdin, output: opts.io?.output ?? process.stdout })
      // In raw mode ^C does not raise the process-level SIGINT; readline intercepts
      // it. Forward it to the process-level handler so that two consecutive Ctrl+C
      // during the pause wait can still force-terminate.
      rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
      // stdin closed (pipe ended etc.): falls back to undefined and auto-releases,
      // same as interactive's close semantics.
      const closed = new Promise<undefined>((resolve) => rl.on("close", () => resolve(undefined)))
      try {
        await Promise.race([rl.question(promptText), closed])
      } finally {
        rl.close()
      }
    }
  } finally {
    await statsWaitEnd(opts.dir)
  }
  log(`→ step released: ${label}`)
}
