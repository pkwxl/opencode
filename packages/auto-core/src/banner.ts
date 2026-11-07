// The run banner and its phase line — the one emitter family every shell and
// the status view render through (plans/0193 D1, the shell-mirror remediation:
// the shells' hand-maintained copies drifted by lockstep misses — the worker's
// banner lacking 0142's testByDriver clause, both shells' missing-index remedy
// teaching `plan` where the core's own status view taught `transfer` for
// phased projects). The lines return as data; the sinks (a shell's log call,
// status's printer) stay at the callers — the core renders, the shells print.
import { formatProjectConfig, legacyModeFallback, loadProjectConfig, type ProjectConfig } from "./config"
import { currentRound, formatPhases, phaseIndexPath, readPhases } from "./phases"
import { surfaceOf } from "./shell"

// The run banner of `run`, `plan` and the hidden `_lane` (and the worker
// entry of a service shell — byte-identical lines so a tailing client cannot
// tell the shells apart, the posture the worker's own header states): the
// legacy-mode note, the driver-run tests line (0142 D3's full clause — the
// channel serves code-work phases; a session elsewhere runs such a check
// itself, never through tmp/test.sh), the config summary and, when phased,
// the phase progress line. The legacy note names the CLI's `fix` command in
// both shells' today shape (the service shell's config-fix routes are its
// operations; the note's wording is the standing posture both shells print).
export async function runBannerLines(dir: string, config: ProjectConfig): Promise<string[]> {
  const lines: string[] = []
  if (await legacyModeFallback(dir)) lines.push(`ℹ mode taken from the legacy persisted value in .auto/config.json; run opencode-auto fix ${dir} to write the full config`)
  if (config.testByDriver) {
    lines.push(
      `⚙ tests run by the driver: sessions put scripts in test/ and write the script path to tmp/test.sh to request execution; the driver merges stdout/stderr into tmp/test.<n>.out and feeds it back to the session; the channel serves code-work phases (elsewhere a session runs such a check itself, never through tmp/test.sh)` +
        (config.handoverTest ? "; on test failure with context at its cap, a handover document switches to a fresh session" : ""),
    )
  }
  lines.push(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  if (config.phases !== "m") lines.push(await phasesLine(dir, config.phases))
  return lines
}

// The phase progress line (shared by the banner and the status view; ✓ = done,
// ▶ = current, the rest = not started), carrying a round annotation when rounds
// continue (the greatest docs/R-NN round number > 1). A missing or invalid
// phase index only warns here — runAll's phase routing exits 1 as an
// environment error. The missing-index remedy is phased-aware (plans/0101 D4,
// the rule status.ts already carried): a phased project's round is established
// by transfer (plan cannot establish a phased round), m mode's by plan — the
// command named through the shell's served surface, the profile's bin under
// the default CLI shape (plans/0193 D3). `phasesValue` is the caller's loaded
// config's value; absent (the status view's early-return path), the line loads
// the config itself and an unloadable config teaches transfer — the
// conservative side of the split, exactly the previous status behavior.
export async function phasesLine(dir: string, phasesValue?: string): Promise<string> {
  const round = await currentRound(dir)
  try {
    const state = await readPhases(dir)
    if (!state) {
      const phased = phasesValue !== undefined ? phasesValue !== "m" : (await loadProjectConfig(dir).catch(() => undefined))?.phases !== "m"
      const surface = surfaceOf()
      return `⚠ phase index (${phaseIndexPath(round)}) is missing; run ${phased ? surface.transfer() : surface.plan()} to establish the round`
    }
    return `phases${round > 1 ? ` (round ${round})` : ""}: ${formatPhases(state)}`
  } catch (error) {
    return `⚠ phase index (${phaseIndexPath(round)}) is invalid: ${error instanceof Error ? error.message : String(error)}`
  }
}
