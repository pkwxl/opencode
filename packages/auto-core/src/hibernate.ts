// Hibernation window (OPENCODE_AUTO_HIBERNATE, design plans/0027-hibernate-design.md):
// a daily UTC window that avoids LLM high-tariff hours ("HH:MM+H", e.g. 04:00+6 =
// hibernate 6 hours from UTC 04:00). Trigger semantics: "am I inside the window now"
// is checked only at the three existing safe boundaries (phase/task/subtask, same hook
// points as step.ts) and at run startup — inside the window it sleeps to the window
// end, then continues after a fixed random delay of 0~600 seconds; a unit mid-execution
// that crosses the window's start is naturally cut off at the boundary where it ends,
// i.e. "gracefully wait for the current task/subtask to reach a safe exit point before
// pausing". It does not predict the next unit and persists nothing; during sleep a
// double Ctrl+C force-quits (130) via the process-level SIGINT handler, and the wait
// duration is deducted from time stats via statsWaitBegin/End.
import { log } from "./log"
import { statsWaitBegin, statsWaitEnd } from "./stats"
import { autoSwitches, formatHibernate, type HibernateWindow } from "./switches"

// Cap of the fixed random delay after the window ends (D3): 0~600 seconds, spreading
// out multiple instances waking at the same moment. The model-window wait of 0055 §6.3
// reuses the same delay: multiple instances sharing one account are not all dispatched
// at the same instant.
export const HIBERNATE_JITTER_MS = 600_000

// The shared sleep body of planned waits (the hibernate window and the model-window
// wait share it): the wait interval is deducted from time stats and recorded separately
// as waitMs via statsWaitBegin/End (kind is the wait kind, see the kind list in
// stats.ts); the exceptional path pairs the segment close via finally. During the wait
// a double Ctrl+C force-quits (130) via runAll's process-level SIGINT handler, same as
// every long wait — that is the only way out. sleep is injected for unit tests (to be
// advanced with a fake clock).
export async function bookedSleep(
  kind: string,
  ms: number,
  opts: { dir?: string; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  await statsWaitBegin(opts.dir, kind)
  try {
    await (opts.sleep ?? Bun.sleep)(ms)
  } finally {
    await statsWaitEnd(opts.dir)
  }
}

const DAY_MS = 86_400_000

// Hibernation duration calculation (pure function, for unit tests): now (epoch ms)
// inside today's UTC window [startMin, startMin+durationMin) (modulo 1440 minutes,
// midnight crossing handled by the modulo) → returns "milliseconds to the window end +
// random() × HIBERNATE_JITTER_MS"; outside the window → 0. Exactly at the window
// start counts as inside (sleeps the full length); exactly at the window end counts as
// outside (the window is over).
export function hibernateSleepMs(window: HibernateWindow, now: number, random: () => number = Math.random): number {
  const start = window.startMin * 60_000
  const end = start + window.durationMin * 60_000
  const t = ((now % DAY_MS) + DAY_MS) % DAY_MS
  let remaining: number
  if (t >= start) {
    // After the start: inside as long as the window has not ended past midnight (end
    // may exceed DAY_MS, harmless for the comparison).
    if (t >= end) return 0
    remaining = end - t
  } else {
    // Before the start: inside only when the window crosses midnight and its tail
    // covers this time of day.
    if (end <= DAY_MS || t >= end - DAY_MS) return 0
    remaining = end - DAY_MS - t
  }
  return remaining + random() * HIBERNATE_JITTER_MS
}

// Boundary/startup hook point: with the switch unset (default) it is zero-behavior
// and returns immediately (stats untouched); inside the window it sleeps until
// wake-up. When dir passes the target directory, the wait interval is deducted via
// statsWaitBegin/End and recorded separately as waitMs (same treatment as stepPause);
// now/random/sleep/window are injected for unit tests. After waking it does not
// re-check the window — oversleeping caused by a system suspend only resumes later;
// the semantics still satisfies "continue after the hibernation window has passed".
export async function hibernatePause(
  label: string,
  opts: {
    dir?: string
    now?: number
    random?: () => number
    sleep?: (ms: number) => Promise<void>
    window?: HibernateWindow
  } = {},
): Promise<void> {
  const window = opts.window ?? autoSwitches().hibernate
  if (window === undefined) return
  const now = opts.now ?? Date.now()
  const sleepMs = hibernateSleepMs(window, now, opts.random)
  if (sleepMs <= 0) return
  const wakeAt = new Date(now + sleepMs)
  log(
    `⏸ hibernating: ${label} is inside the hibernate window (UTC ${formatHibernate(window)}),` +
      ` resuming around ${wakeAt.toISOString()} (local ${wakeAt.toLocaleString()}, includes random delay); press Ctrl+C twice to force-quit`,
  )
  // Human/planned wait deduction (same treatment as STATS_PLAN §3): with the segment
  // closed neither aiMs nor wallMs grows, waitMs is recorded separately; the
  // exceptional path pairs waitEnd via bookedSleep's finally, leaving no dangling
  // closed segment.
  await bookedSleep("hibernate", sleepMs, { dir: opts.dir, sleep: opts.sleep })
  log(`→ hibernate over: continuing after ${label}`)
}
