// Manual clocks for tests: the run services' clock faked so time steering
// never waits on wall time. `manualClock` advances its instant when the code
// under test sleeps; `clockAt`/`fixedClock` pin the instant (a test that
// moves it re-reads through the getter). Timers never fire on a faked clock
// — the probe tests drive the real one — and a fake sleepUnlessExit answers
// true only when /exit was already requested, mirroring the real entry
// check (the fake cannot be woken mid-sleep; tests request the exit before
// the wait starts).
import type { Clock } from "../../src/services"
import { exitRequested } from "../../src/exit"

export type ManualClock = {
  clock: Clock
  // The current instant: tests read and move it directly.
  at: number
  advance(ms: number): void
}

export function manualClock(at: number = Date.now()): ManualClock {
  const mc: ManualClock = {
    at,
    advance: (ms) => {
      mc.at += ms
    },
    clock: {
      now: () => mc.at,
      sleep: async (ms) => {
        mc.at += ms
      },
      sleepUnlessExit: async (ms) => {
        if (exitRequested()) return true
        mc.at += ms
        return false
      },
      timer: () => () => {},
    },
  }
  return mc
}

// A clock pinned to a fixed instant, or reading through a getter when the
// test moves a local variable; sleeping resolves without advancing (tests
// that need the advance use manualClock).
export function fixedClock(read: () => number): Clock {
  return {
    now: read,
    sleep: async () => {},
    sleepUnlessExit: async () => (exitRequested() ? true : false),
    timer: () => () => {},
  }
}

export const clockAt = (at: number): Clock => fixedClock(() => at)
