// The run-driving capture wrapper (the 0102 stage C extraction): one home
// for the scrub/capture/reset ritual every suite that drives a run through
// runAll (or a transfer/loop entry that starts the fleet) must wrap it in.
// The whole suite shares one bun process, so each ingredient below is
// process hygiene, not local tidiness:
//   - the ambient OPENCODE_AUTO_* layer is saved and scrubbed around the run
//     (a run parses the environment it is handed — ambient switches from an
//     unrelated shell would make it non-deterministic), restored afterwards
//     (the lane-log seam excepted: an output redirect rather than a switch,
//     it rides the scrub — see LANE_LOG_SEAM below);
//   - `plant` overlays explicit values on the scrubbed layer for this run
//     alone (a switch a case turns on or off itself, whatever the ambient
//     layer holds — e.g. loop-isolation's OPENCODE_AUTO_LANE_ISOLATION);
//   - the switch memo is reset before the run (autoSwitches parses once per
//     process; an earlier suite's stale or frozen parse must not be what
//     this run sees) and re-parsed after the environment is restored — a
//     run through runAll freezes the snapshot at its fleet start (the run's
//     own invariant), and a later clamp in this process throws on a frozen
//     memo (the run-status suite's documented reset);
//   - console.log is captured (the run's printed lines are assertable) and
//     restored no matter how the run ends.
// fixtures/loop.ts keeps its own reset-free variant on purpose: its runs
// drive the phase loop alone and never freeze the snapshot.

import { spyOn } from "bun:test"
import { autoSwitches, setSwitchModelRegistry } from "../../src/switches"

const OPENCODE_AUTO = /^OPENCODE_AUTO_/

// The lane-log seam (plans/0151 D1) rides the scrub instead of being
// scrubbed: it is an output redirect, not a switch — it cannot steer a run,
// while losing it would send every lane the run launches to the machine-
// shared default /tmp/opencode (the test preload points the seam at a
// per-global scratch dir exactly so parallel workers never share it).
const LANE_LOG_SEAM = "OPENCODE_AUTO_LANE_LOG_DIR"

export type CaptureOptions = {
  // Values planted over the scrubbed layer for this run alone; deleted
  // again in the finally beside the ambient restore.
  plant?: Record<string, string>
}

// Scrub the ambient OPENCODE_AUTO_* layer (optionally planting values),
// capture console.log, await the run, and restore everything — the switch
// memo reset on both sides included.
export async function captureRun(run: () => Promise<number>, opts: CaptureOptions = {}): Promise<{ code: number; lines: string[] }> {
  const saved = Object.entries(process.env).filter(([key]) => OPENCODE_AUTO.test(key) && key !== LANE_LOG_SEAM)
  for (const [key] of saved) delete process.env[key]
  const planted = Object.entries(opts.plant ?? {})
  for (const [key, value] of planted) process.env[key] = value
  setSwitchModelRegistry(undefined)
  const lines: string[] = []
  const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "))
  })
  try {
    return { code: await run(), lines }
  } finally {
    printed.mockRestore()
    for (const [key] of planted) delete process.env[key]
    for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
    // A run through the fleet freezes the switch snapshot at its start (the
    // run's own invariant): re-parse the restored environment back to an
    // unfrozen snapshot, or every later clamp in this process throws.
    setSwitchModelRegistry(undefined)
    autoSwitches()
  }
}
