// Round-close gate (M4.2, plans/0049 G8; root plan D12 ③, 0036 D12, open
// question 15-⑦ ruled "middle form"): whether a round whose phases are all
// done may be closed, i.e. whether the next round may start. Four
// checks, all read-only:
//   1. the whole-tree P1 prohibition scan — the unit close-out scan
//      (document/process-refs.ts) widened from "lines the unit added" to every
//      line of every tracked and untracked file, in every nested repository.
//      This is the one moment the whole-tree price is worth paying;
//   2. the target's own build (config `build`), when one is configured;
//   3. the restatement listing: round.md's `## Close` section must say which
//      decisions were restated into the target's own documentation and which
//      were accepted as lost. The gate checks presence, not content — no
//      mechanical criterion tells which rationale had to survive.
//   4. the round user report (plans/0081 D4): docs/R-NN/report-for-user.md
//      must exist, be non-empty and end with the eof terminator. The check
//      self-heals before it ever blocks — the final task-bearing phase's
//      handover appends exactly one report task when the phase completes
//      without the report (loop-phase.ts, 0079 §4's append pattern, bounded
//      once) — so a problem here means the self-heal was refused or the
//      report task itself failed; the message names the file and the phase
//      that should have planned its task.
// Two anchors: the complete route reports it on every run (loop-phase.ts), and
// the next round's start blocks on it: plan's prelude (plan.ts, exit 2,
// plans/0053 D4). No state is written, so routing stays a pure function of
// the files.
import { join } from "node:path"
import { reportForUserPath, roundBriefPath } from "./docpaths"
import { endsWithEof } from "./doccheck"
import { processReferenceScan } from "./document/process-refs"
import { repoRoots, unitAddedLines } from "./git"
import { readPhases } from "./phases"
import { closeSection, ROUND_CLOSE_HEADING } from "./round-brief"

// The build's wall-clock cap: generous for a real target build, but a hung
// build must not hang the round start forever.
const BUILD_TIMEOUT_MS = 30 * 60 * 1000

// Lines of build output kept in a failure message.
const BUILD_TAIL_LINES = 20

export type RoundClose = {
  // Blocking: plan refuses to open the next round while any is listed.
  problems: string[]
  // Advisory: bare task-id mentions, a skipped build.
  warnings: string[]
}

// scanExempt = config scanExempt (plans/0059 X2): deliverable paths whose
// process-shaped strings are content, skipped by the whole-tree scan too.
export async function roundCloseProblems(dir: string, round: number, opts: { build?: string; scanExempt?: readonly string[] } = {}): Promise<RoundClose> {
  const problems: string[] = []
  const warnings: string[] = []
  // 1. Whole tree: an empty baseline per repository makes every tracked line
  // "added"; untracked files are added whole by unitAddedLines itself.
  const roots = await repoRoots(dir)
  const scan = processReferenceScan(await unitAddedLines(dir, roots.map((root) => ({ root, sha: "" }))), opts.scanExempt)
  problems.push(...scan.problems.map((problem) => `process reference: ${problem}`))
  warnings.push(...scan.warnings)
  // 2. Build.
  if (opts.build) {
    const failure = await runBuild(dir, opts.build)
    if (failure) problems.push(`build: ${failure}`)
  } else {
    warnings.push("build: no build command configured (config `build`); the target build was not checked")
  }
  // 3. Restatement listing.
  const brief = roundBriefPath(round)
  const text = await Bun.file(join(dir, brief)).text().catch(() => undefined)
  const close = text === undefined ? undefined : closeSection(text)
  if (text === undefined) problems.push(`close listing: ${brief} is missing`)
  else if (close === undefined) problems.push(`close listing: ${brief} has no \`${ROUND_CLOSE_HEADING}\` section`)
  else if (!close) {
    problems.push(
      `close listing: ${brief} \`${ROUND_CLOSE_HEADING}\` is empty — list the decisions restated into the target's own documentation and those accepted as lost`,
    )
  }
  // 4. The round user report (plans/0081 D4): a durable, human-facing account
  // of the round. Existence + non-empty + the eof terminator — the driver
  // reads no content. The message names the round's last task-bearing phase
  // (the one whose planner should have carried the wrap-up duty), lenient
  // about an unreadable index.
  const report = reportForUserPath(round)
  const reportText = await Bun.file(join(dir, report)).text().catch(() => undefined)
  if (reportText === undefined || !reportText.trim()) {
    const state = await readPhases(dir, round).catch(() => undefined)
    const planner = state?.phases.filter((unit) => unit.entry.hasTasks).at(-1)
    problems.push(
      `round report: ${report} is ${reportText === undefined ? "missing" : "empty"} — the person's account of the round` +
        `${planner ? ` (${planner.id}-${planner.type} should have planned its wrap-up task)` : ""}; ` +
        `a re-run of run/plan appends one report task automatically, or write it by hand ending with the terminator line`,
    )
  } else if (!endsWithEof(reportText)) {
    problems.push(`round report: ${report} does not end with the terminator line \`<!-- auto: eof -->\` — finish the document and re-run`)
  }
  return { problems, warnings }
}

// Run the build in the target directory; undefined = exit 0, else why not.
async function runBuild(dir: string, command: string): Promise<string | undefined> {
  const proc = Bun.spawn(["sh", "-c", command], { cwd: dir, stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, BUILD_TIMEOUT_MS)
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timer)
  if (code === 0 && !timedOut) return undefined
  const tail = `${out}${err}`.trimEnd().split("\n").slice(-BUILD_TAIL_LINES).join("\n")
  const why = timedOut ? `timed out after ${BUILD_TIMEOUT_MS / 60_000} minutes` : `exited ${code}`
  return `\`${command}\` ${why}${tail ? `; output tail:\n${tail}` : ""}`
}

// Terminal lines for a close result: one ✓ line, or a ⚠ line per item.
export function roundCloseLines(close: RoundClose): string[] {
  if (!close.problems.length) {
    return ["✓ round close checks passed", ...close.warnings.map((warning) => `  ⚠ ${warning}`)]
  }
  return [
    "⚠ round close checks: plan will refuse to open the next round until these are fixed",
    ...close.problems.map((problem) => `  ✗ ${problem}`),
    ...close.warnings.map((warning) => `  ⚠ ${warning}`),
  ]
}
