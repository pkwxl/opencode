// Round-close gate (M4.2, plans/0049 G8; root plan D12 ③, 0036 D12, open
// question 15-⑦ ruled "middle form"): whether a round whose phases are all
// done may be closed, i.e. whether the next round may start. Three checks,
// all read-only — two hold the gate, one rides as the ledger:
//   1. the destination scan — the containment ledger over what the project
//      wrote into the destination repositories: git's own modified set, the
//      run of driver commits back from HEAD plus the uncommitted and
//      untracked state, in every nested repository alone (plans/0108 keeps
//      the destination scoping; plans/0119 re-derives the content set from
//      git after the cleanroom OOM — 0108's whole-tree form read every line
//      of a pristine kernel-sized checkout the migration had never touched,
//      and died of it; the maintainer ruled: "We should not check the full
//      tree, instead, check those that has been modified which can be shown
//      via git" — a destination's pre-existing content was never the
//      migration's to answer for). It answers the recorded containment
//      count alone — never a problem (plans/0103 D2 read whole, its second
//      addendum: every finding family, the process-document references
//      included, defers to `release`; the blocking form of "the destination
//      must not reference process documents" is release-time truth), so
//      this is the one moment the scan's price buys the running ledger the
//      person reads;
//   2. the target's own build (config `build`), when one is configured;
//   3. the restatement listing: round.md's `## Close` section must say which
//      decisions were restated into the target's own documentation and which
//      were accepted as lost. The gate checks presence, not content — no
//      mechanical criterion tells which rationale had to survive.
// The round user report is no longer among them (plans/0109 D1: the report
// retired to optional — the person-proxy brief renders the live account the
// report used to freeze; a report a person commissions is never read here).
// Two anchors: the complete route reports it on every run (loop-phase.ts), and
// the next round's start blocks on it: plan's prelude (plan.ts, exit 2,
// plans/0053 D4). No state is written, so routing stays a pure function of
// the files.
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { scrubDriverEnv } from "./agent/opencode/server"
import { roundBriefPath } from "./docpaths"
import { processReferenceScan } from "./document/process-refs"
import { nestedRepoPrefixes, repoRoots, unitAddedLines, driverBaseline, type UnitBaseline } from "./git"
import { closeSection, ROUND_CLOSE_HEADING } from "./round-brief"
import { DEFAULT_SCRIPT_POLL_MS, readLogTail, scriptTmpDir, watchProcess } from "./script"

// The build's wall-clock cap: generous for a real target build, but a hung
// build must not hang the round start forever.
const BUILD_TIMEOUT_MS = 30 * 60 * 1000

// Lines of build output kept in a failure message.
const BUILD_TAIL_LINES = 20

export type RoundClose = {
  // Blocking: plan refuses to open the next round while any is listed.
  problems: string[]
  // Advisory: the recorded containment count, a skipped build.
  warnings: string[]
  // A build is configured but this caller runs none (plans/0209 D4, the
  // read-only briefs): the close gate runs it on the next advance. Never
  // rendered as "no build command configured" — the caller says what it
  // skipped instead of borrowing the build-less project's warning.
  buildSkipped?: boolean
}

// scanExempt = config scanExempt (plans/0059 X2): deliverable paths whose
// process-shaped strings are content, skipped by the destination scan too.
// buildSkipped (plans/0209 D4): a build is configured but this caller runs
// none — no build runs, the "no build command configured" warning is
// omitted (false where a build exists), and the result carries the marker.
export async function roundCloseProblems(
  dir: string,
  round: number,
  opts: { build?: string; scanExempt?: readonly string[]; buildSkipped?: boolean } = {},
): Promise<RoundClose> {
  const problems: string[] = []
  const warnings: string[] = []
  let buildSkipped = false
  // 1. The destinations' driver-written content: an empty baseline per
  // repository made every tracked line "added" (0108's whole-tree form); the
  // 0119 ruling narrows the same scan to git's modified set — the driver
  // baseline (the run of Auto-Stage commits back from HEAD, git.ts
  // driverBaseline) with unitAddedLines' worktree diff and untracked walk
  // covering the uncommitted half. The nested repositories alone enter the
  // scan (plans/0108) — the prefixes ride along for the containment rules
  // (plans/0103: the destination answers rules the workspace does not).
  const nestedRoots = (await repoRoots(dir)).filter((root) => root !== dir)
  const baseline: UnitBaseline = []
  for (const root of nestedRoots) baseline.push({ root, sha: await driverBaseline(root) })
  const scan = processReferenceScan((await unitAddedLines(dir, baseline)).lines, opts.scanExempt, { nested: nestedRepoPrefixes(dir, nestedRoots), dir })
  // The scan answers the count alone at round time — never a problem (every
  // family defers to release). Destination containment rides as one
  // aggregate warning (plans/0103 D2 recording, plans/0109 D6 shape): the
  // running count the person reads each round while the treatment stays
  // deliberately delayed — the itemized fix list is the release gate's own
  // output.
  if (scan.deferredCount) {
    warnings.push(`containment: ${scan.deferredCount} reference(s) recorded for release (process-document references, task ids, paths outside a destination's own root) — restate what each anchored in place and remove the pointer when the destination ships, never delete the record it anchored; the release gate lists and enforces them`)
  }
  // 2. Build.
  if (opts.buildSkipped) {
    buildSkipped = true
  } else if (opts.build) {
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
  return { problems, warnings, ...(buildSkipped ? { buildSkipped } : {}) }
}

// Run the build in the target directory; undefined = exit 0, else why not.
// The cap bounds the WAIT, not only the child (plans/0237 D3, 0165-102): the
// wrapper spawns detached as its own process group with its output redirected
// by the shell into a file under the driver workdir (runScript's no-pipe
// trick — a grandchild holding the pipes can never hang a read that waits on
// no pipe), and the 0175 watchdog owns the lifetime: on the cap the whole
// group gets SIGTERM and the grace escalates to SIGKILL, so a multi-command
// build's hung grandchild dies with the cap instead of outliving the round
// close writing into the tree. `timeoutMs` is the same knob shape
// runScript/watchProcess expose, for the regression pin.
export async function runBuild(dir: string, command: string, opts: { timeoutMs?: number } = {}): Promise<string | undefined> {
  const capMs = opts.timeoutMs ?? BUILD_TIMEOUT_MS
  const outDir = scriptTmpDir(dir)
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, "round-close-build.log")
  await Bun.write(outPath, "")
  const start = Date.now()
  const proc = Bun.spawn(["sh", "-c", `exec >"$0" 2>&1\n${command}`, outPath], {
    cwd: dir,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    detached: true,
    // The round-close build runs the project's own tooling: the scrubbed
    // base, like every driver-run child (plans/0180 D3).
    env: scrubDriverEnv(),
  })
  // The watchdog's tick stays finer than the cap it enforces (the default
  // 5 s poll over the default 30 min cap; a shorter cap proportionally
  // shorter, so the kill lands at the cap, not at the first coarse tick).
  const { timedOut } = await watchProcess({
    proc,
    logPath: outPath,
    start,
    maxMs: capMs,
    idleMs: capMs,
    pollMs: Math.min(DEFAULT_SCRIPT_POLL_MS, Math.max(1, Math.floor(capMs / 2))),
  })
  const code = proc.exitCode
  if (code === 0 && !timedOut) return undefined
  const tail = (await readLogTail(outPath)).trimEnd().split("\n").slice(-BUILD_TAIL_LINES).join("\n")
  // The default cap renders exactly as before (plans/0237 D3 keeps the
  // message wording byte-identical); a non-default cap names its own unit.
  const why = timedOut ? `timed out after ${capMs >= 60_000 ? `${capMs / 60_000} minutes` : `${capMs}ms`}` : `exited ${code}`
  return `\`${command}\` ${why}${tail ? `; output tail:\n${tail}` : ""}`
}

// Terminal lines for a close result: one ✓ line, or a ⚠ line per item. In
// the held shape the ✗ problems alone sit under the "until these are fixed"
// header — the ⚠ records render under their own lead naming them records,
// each with its own moment, never work for this stop (plans/0106: the field
// finding — a proxy session read the ledger of ⚠ lines as this stop's work
// list and acted on containment records mid-project). `command` names the
// refuser: transfer in a phased project, plan in m mode (the caller that
// owns the stop names itself).
export function roundCloseLines(close: RoundClose, command: "plan" | "transfer" = "transfer"): string[] {
  if (!close.problems.length) {
    return ["✓ round close checks passed", ...close.warnings.map((warning) => `  ⚠ ${warning}`)]
  }
  return [
    `⚠ round close checks: ${command} will refuse to open the next round until these are fixed`,
    ...close.problems.map((problem) => `  ✗ ${problem}`),
    ...(close.warnings.length
      ? ["  recorded — not this stop's work; each ⚠ names its own moment (containment waits for release):", ...close.warnings.map((warning) => `  ⚠ ${warning}`)]
      : []),
  ]
}
