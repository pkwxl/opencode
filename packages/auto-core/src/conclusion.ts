// Conclusion messages of the task loop: startup resume banner, the three
// task/phase/round proxy-answer highlight blocks and conclusion lines
// (plans/0019-stats-timing-design.md §F, plans/0020-auto-resolve-design.md §H).
// Only constructs text, never prints; the loop body owns log(). Pure leaf, no
// dependency on loop.ts.
// Split out of src/loop.ts (plans/0024-module-split-plan.md S13, pure move).
import { formatDuration, formatTokens, formatUsageLine } from "./log"
import { currentRound, phaseKey, phaseLabel, phaseName, type PhaseUnit } from "./phases"
import { decisionsOf, resolveHighlight, resolvesOf } from "./resolve"
import { statsBoot, statsHistory, statsId, statsLaneRollup, statsTotals, type DigestStat, type DigestStats, type LaneRollup, type ModelStat, type TierStat, type StatsResume } from "./stats"

// Startup resume banner (plans/STATS_PLAN.md §4.6): the snapshot is taken after
// depreciation posting and before round rollover; round/phase/task are the
// positions where the previous process stopped; a missing task (previous
// process stopped outside a task segment, or the bucket id is corrupt) omits
// the task segment.
export function resumeBanner(resumed: StatsResume): string {
  const parts = [`round ${resumed.round}`]
  if (resumed.phase) parts.push(`phase ${resumed.phase}`)
  if (resumed.task) {
    parts.push(`${resumed.task} accumulated ${formatDuration(resumed.taskWallMs)} (AI ${formatDuration(resumed.taskAiMs)})`)
  }
  const at = new Date(resumed.lastWriteAt).toTimeString().slice(0, 5)
  return `↻ stats resume: ${parts.join(" / ")}, last process stopped at ${at}`
}

// ===== Proxy-answer highlight blocks (plans/0020-auto-resolve-design.md §H, H5/H6) =====
// The three pinned blocks pair one-to-one with the three conclusion lines
// below: highlight first, conclusion after (§H-② layout order — the user first
// sees "what the system decided on my behalf", then the stats). Construction
// is separated from log for the same reason as conclusion lines: text can be
// unit-tested directly (test/loop-conclusion.test.ts), the loop body only logs.
// All three always return an array (empty = no proxy answers, takes no layout
// space), deliberately different from the conclusion lines' undefined
// semantics: a conclusion line's undefined means "guard failed, readings
// untrustworthy" and the caller falls back to legacy text; highlight blocks
// have no guard-failure state — an unreadable ledger simply means no proxy
// answers.
// Ledger read failures (corrupt/permission) are always swallowed to empty:
// auditing never affects flow or exit codes.

// Task pinned block (H5): printed before the ✓/⏸ conclusion line. The
// AUTO-DECISION count is folded into the last line via decisionsOf (§H-④);
// with no proxy answers the whole block is empty and the count does not reach
// the terminal either (it already went to vlog at session wrap-up).
export async function taskResolveLines(directory: string | undefined, taskID: string): Promise<string[]> {
  const items = await resolvesOf(directory, "task", taskID).catch(() => [])
  if (!items.length) return []
  const decisions = await decisionsOf(directory, taskID).catch(() => 0)
  return resolveHighlight(items, { scope: "task", id: taskID, decisions })
}

// Phase pinned block (H6): printed before the ■ phase-close line, counts only
// (itemized entries were already shown at each task end).
// Records are keyed by the qualified phase id (Opts.phase.id); the text names
// the phase by its label.
export async function phaseResolveLines(directory: string | undefined, phase: PhaseUnit): Promise<string[]> {
  const items = await resolvesOf(directory, "phase", phaseKey(phase).id).catch(() => [])
  return resolveHighlight(items, { scope: "phase", id: phaseLabel(phase) })
}

// Round pinned block (H6): printed before the ■ round-complete line. The round
// number is queried live via currentRound — the posting side (runner's
// collectSessionMarks/recordDriverResolves) uses the same source, and same
// source on both sides prevents bucket mismatch; failure falls back to 0,
// matching the posting side's catch fallback.
export async function roundResolveLines(directory: string | undefined): Promise<string[]> {
  if (!directory) return []
  const round = await currentRound(directory).catch(() => 0)
  const items = await resolvesOf(directory, "round", round).catch(() => [])
  return resolveHighlight(items, { scope: "round", id: round })
}

// ===== T-006 conclusion lines (plans/STATS_PLAN.md §4.2/4.3/4.4) =====
// The three conclusion lines (task tri-state / phase close / round complete)
// are all constructed here; the loop body only logs. The tokens line shares
// log.ts formatUsageLine with the T-004 ◉ session-end line 2 so the format
// cannot drift.

// Stats segment of the task-end tri-state line (shared by done/blocked/
// incomplete, §4.2): returns the pair
// [`elapsed W (AI A[, this process P]), N sessions`, tokens line]; the caller
// prepends the state prefix (✓ done / ⏸ blocked / ⏸ incomplete). The bucket is
// the task bucket accumulated across interruptions (including pre-interruption).
// Guards on statsId === taskID (same reason as subtaskProgressLine: readings
// are untrustworthy when the bucket identity mismatches); on guard failure
// returns undefined, and the caller falls back to the pre-T-006 legacy text
// (done) or prints nothing (blocked/incomplete never had a stats line).
// AUTO-DECISION: "this process" is the wall-clock delta (wallMs −
// boot.task.wallMs). The draft's Chinese phrase for "this process" sits next to the word AI and
// could read as an AI subset; but the T-002 progress heartbeat line
// (subtaskProgressLine in this file) already established "this process" as the
// wall-clock caliber of the same task bucket, identical wording across message
// lines must mean the same thing, and the subject "elapsed" is itself wall
// clock — the "AI subset" alternative would create same-word-different-meaning
// between heartbeat and conclusion lines, rejected. Compared after formatting;
// when the delta is under 1 second (same rounding) it is not printed (same
// technique as the heartbeat line).
export async function taskEndLines(directory: string | undefined, taskID: string): Promise<string[] | undefined> {
  if (statsId(directory) !== taskID) return undefined
  const totals = await statsTotals(directory, "task")
  const boot = await statsBoot(directory)
  if (!totals || !boot) return undefined
  const wall = formatDuration(totals.wallMs)
  const local = formatDuration(totals.wallMs - boot.task.wallMs)
  const since = local === wall ? "" : `, this process ${local}`
  return [
    `elapsed ${wall} (AI ${formatDuration(totals.aiMs)}${since}), ${totals.sessions} sessions`,
    formatUsageLine(totals.usage),
  ]
}

// Phase-close line (§4.3, at the end of handoverPhase after commitTree):
// [`■ phase t <name> closed: total W (incl. plan/handover/commit; AI A[, human
// wait Z]), T tasks / S sessions`, tokens line]. The phase bucket includes
// bypass sessions such as plan/handover distillation (bypasses post to the
// phase+round buckets, see the wiring comment in stats.ts), matching the
// "incl. plan/handover/commit" wording. Guards on bucket id === the qualified
// phase id (a mismatch means the bucket was already reset by a later phase; do
// not print).
// AUTO-DECISION: the human-wait segment is only emitted when waitMs > 0 (same
// for the round line) — same style as the 0-omission rules for cost/reasoning;
// "human wait 0s" is pure noise. The draft example (waitMs = 3m) did not cover
// 0; handled per the existing omission convention.
export async function phaseCloseLines(directory: string | undefined, phase: PhaseUnit): Promise<string[] | undefined> {
  const totals = await statsTotals(directory, "phase")
  if (!totals || totals.id !== phaseKey(phase).id) return undefined
  const wait = totals.waitMs ? `, human wait ${formatDuration(totals.waitMs)}` : ""
  return [
    `■ phase ${phaseLabel(phase)} ${phaseName(phase)} closed: total ${formatDuration(totals.wallMs)}` +
      ` (incl. plan/handover/commit; AI ${formatDuration(totals.aiMs)}${wait}), ${totals.tasks} tasks / ${totals.sessions} sessions`,
    formatUsageLine(totals.usage),
  ]
}

// Per-model and per-tier lines of the round-complete block (plans/0055 §7.1
// "Stats", §10 item 12): the round bucket carries each
// model's usage, sessions and protocol-drift counters, and each tier's usage
// and sessions — so the savings of tier routing and each model's protocol
// drift can be read off the run's conclusion. The model keys are internal
// names, raw `provider/model` override values, and the classifier's
// `classify` bucket. Names sort alphabetically (booking order is runtime
// detail); a counter only prints when non-zero (the 0-omission convention of
// the cost/reasoning items). No model data returns nothing.
// AUTO-DECISION: the per-model lines cover this round only; the cross-round
// history keeps its two existing cumulative lines. The plan asks for
// per-model lines on the conclusion without naming a scope, and this round's
// models are what the just-finished routing decided; a cumulative per-model
// block would double the tail of an already long conclusion for numbers the
// stats document still keeps (history rolls the model sections up).
function modelBlockLines(models: Record<string, ModelStat> | undefined, tiers: Record<string, TierStat> | undefined): string[] {
  const names = Object.keys(models ?? {}).sort()
  const tierNames = Object.keys(tiers ?? {}).sort()
  if (!names.length && !tierNames.length) return []
  const lines: string[] = []
  for (const name of names) {
    const stat = models![name]!
    const counters = [
      stat.fails ? `${stat.fails} FAIL verdict${stat.fails === 1 ? "" : "s"}` : "",
      stat.stuckHints ? `${stat.stuckHints} stuck hint${stat.stuckHints === 1 ? "" : "s"}` : "",
      stat.reprompts ? `${stat.reprompts} shape re-prompt${stat.reprompts === 1 ? "" : "s"}` : "",
    ].filter(Boolean)
    lines.push(`  model ${name}: ${stat.sessions} sessions, ${formatUsageLine(stat.usage)}${counters.length ? `, ${counters.join(", ")}` : ""}`)
  }
  if (tierNames.length) {
    lines.push(`  tiers: ${tierNames.map((name) => `${name} ${tiers![name]!.sessions} sessions, ${formatUsageLine(tiers![name]!.usage)}`).join("; ")}`)
  }
  return lines
}

// The time the round's wait-and-probe loops slept for quota windows, per
// model (plans/0057 §11 item 7): one indented line after the per-model block,
// names alphabetical like it. Its figures are the planned sleeps, so a
// five-hour window reads as the hours it cost where the round line's wait
// segment clamps every wait. No such wait — every run that met no limit —
// adds nothing, and the conclusion keeps its shape.
function quotaWaitLine(waits: Record<string, number> | undefined): string[] {
  const names = Object.keys(waits ?? {}).sort()
  if (!names.length) return []
  return [`  time lost to quota windows: ${names.map((name) => `${name} ${formatDuration(waits![name]!)}`).join("; ")}`]
}

// Knowledge-digest counters of the round (plans/0061 R3/A7): how many
// planning sessions got each digest and their cumulative estimated size, how
// often the cap replaced the full text with the index form, and how many
// knowledge phases distilled. A line only when a counter is non-zero — no
// digest data (every round without prior conclusions or a knowledge phase)
// adds nothing, and the conclusion keeps its shape.
function digestLine(digests: DigestStats | undefined): string[] {
  if (!digests) return []
  const parts: string[] = []
  const item = (label: string, stat: DigestStat) => `${label} ${stat.sessions} session${stat.sessions === 1 ? "" : "s"} / ${formatTokens(stat.tokens)} tokens`
  if (digests.priorKnowledge) parts.push(item("prior knowledge", digests.priorKnowledge))
  if (digests.prevRound) parts.push(item("previous round", digests.prevRound))
  if (digests.capped) parts.push(`${digests.capped} capped`)
  if (digests.knowledgePhases) parts.push(`${digests.knowledgePhases} knowledge phase${digests.knowledgePhases === 1 ? "" : "s"}`)
  if (!parts.length) return []
  return [`  digests: ${parts.join(", ")}`]
}

// The lanes roll-up line of the round-complete block (plans/0068 D13, S4,
// §10): how many lanes landed, their summed sessions and tokens, and the
// summed lane wall — with the wall-clock honesty the design asks for, noted
// here: lanes overlap, so their walls sum to effort, never to duration, and
// the time lines of this block mean parent-wall (the parent process's own
// clock, which the landing booking never inflates). The usage claim names
// where the lane figures sit: with every report carrying the usage detail
// they are booked into the totals above (the per-model lines included when
// the report carried model data), and without it (a report an older shape
// wrote) they stay lane-local figures.
// AUTO-DECISION (the roll-up line lives in the round block only): the lanes
// section of the stats document is run-scoped — it carries no phase
// attribution, so a phase-close lanes line cannot be derived without a new
// per-phase record; the round conclusion is the roll-up the design names,
// and the phase block's times are the same parent-wall caliber by
// construction.
function laneRollupLines(rollup: LaneRollup | undefined): string[] {
  if (!rollup) return []
  const booked = rollup.booked ? " (booked into the totals above)" : ""
  return [
    `  lanes: ${rollup.lanes} landed / ${rollup.sessions} session${rollup.sessions === 1 ? "" : "s"} / ${formatTokens(rollup.tokens)} tokens${booked}; ` +
      `lane wall ${formatDuration(rollup.wallMs)} summed — lanes overlap, the time lines mean parent-wall`,
  ]
}

// Round-complete line (§4.4): this round [`■ round N complete: total W (AI
// A[, human wait Z]), [P phases / ] T tasks / S sessions`, tokens line];
// phaseCount is only provided on the phased path (the phase index done count =
// phases handed over this round); the non-phased path omits the phase segment (it is
// the single pseudo-phase "m" throughout, a count carries no information).
// Per-model lines and the per-tier summary follow the
// tokens line (plans/0055 §10 item 12); with no model data they are absent.
// The quota-window line follows them (plans/0057 §11 item 7),
// only when a wait was booked; the digest line follows that (plans/0061
// R3/A7), only when a digest counter is non-zero.
// When history.rounds > 0, two cross-round cumulative lines are appended
// (indented two spaces, "cumulative" prefix distinguishes them from the
// this-round line). The round number comes from roundB.id (loadStats snapshots
// it from currentRound and resets it on round rollover); on corruption or
// absence falls back to a live currentRound query.
// AUTO-DECISION: the cross-round cumulative stands alone as two lines, not
// merged into this round's numbers — the plan only says "tokens line includes
// history cumulative, rounds=0 omits the history part", giving no merged
// format; merging would blend hit rate/cost into cross-round weighted values
// and break the main line's "this round" semantics. The "merge into main line
// with (cumulative…)" alternative was rejected.
export async function roundCompleteLines(
  directory: string | undefined,
  opts?: { phaseCount?: number },
): Promise<string[] | undefined> {
  const totals = await statsTotals(directory, "round")
  if (!totals) return undefined
  // Non-empty totals implies directory is defined (statsTotals no-ops to
  // undefined on undefined).
  const round = Number(totals.id) || (await currentRound(directory as string).catch(() => 1))
  const wait = totals.waitMs ? `, human wait ${formatDuration(totals.waitMs)}` : ""
  const phasesPart = opts?.phaseCount !== undefined ? `${opts.phaseCount} phases / ` : ""
  const lines = [
    `■ round ${round} complete: total ${formatDuration(totals.wallMs)} (AI ${formatDuration(totals.aiMs)}${wait}), ` +
      `${phasesPart}${totals.tasks} tasks / ${totals.sessions} sessions`,
    formatUsageLine(totals.usage),
  ]
  // The lanes roll-up follows the tokens line (plans/0068 D13, S4): it
  // qualifies the numbers above it — where the lane usage sits and what the
  // time lines mean — so it reads before the per-model detail.
  lines.push(...laneRollupLines(await statsLaneRollup(directory)))
  lines.push(...modelBlockLines(totals.models, totals.tiers))
  lines.push(...quotaWaitLine(totals.quotaWaits))
  lines.push(...digestLine(totals.digests))
  const history = await statsHistory(directory)
  if (history && history.rounds > 0) {
    const h = history.totals
    const hwait = h.waitMs ? `, human wait ${formatDuration(h.waitMs)}` : ""
    lines.push(
      `  cumulative (${history.rounds} rounds): total ${formatDuration(h.wallMs)} (AI ${formatDuration(h.aiMs)}${hwait}), ` +
        `${h.tasks} tasks / ${h.sessions} sessions`,
      `  cumulative ${formatUsageLine(h.usage)}`,
    )
  }
  return lines
}
