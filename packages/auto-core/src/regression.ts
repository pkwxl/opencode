// The regression lane — the two-level pass (plans/0098): where the pack's
// lane table declares a regression-cost row (the project's full-gate suite),
// the wrap-up's preliminary tier (cheap lanes, the anchor, the verify
// session) closes tasks and releases dependents, while the complete tier —
// this module — keeps the full regression green at the tree level:
//
//   - coverage (D3): a regression lane is covered at the current tree iff
//     its newest round-scoped green receipt's recorded HEADs..HEAD diff
//     misses the lane's surfaces — 0096's carry-forward rule moved from
//     "may this task's lane skip its run" to "is the tree's regression
//     obligation discharged";
//   - the background slot (D4): one driver-run lane at a time, launched at
//     unit boundaries into a disposable reflink copy of the clean tree (it
//     never contends with the next unit's session, and it carries nested
//     repositories and warm build directories a git worktree cannot
//     materialize — dm-glm's exact shape), its receipt committed evidence
//     under docs/R-NN/regression/;
//   - the phase-close hold (D5): a covering green receipt is the only way
//     through a phase's handover — in-flight runs awaited, stale ones run
//     at close (the one place the full gate still blocks), a red routed
//     into the 0079 repair append or the gate stop;
//   - strict test-readiness (D7): a `Strict: yes` regression row makes the
//     wrap-up's lane gate wait for the dependencies' complete pass before
//     the unit's own testing runs.
//
// Verdicts stay driver-parsed from log tails (`LANE_RC`), never agent
// self-report; receipts are the durable truth, the runtime record
// (.auto/regression.json) only the liveness pointer. A pack without
// regression-cost rows is the byte-identical floor: nothing here launches,
// gates or writes.
import { join } from "node:path"
import { regressionReceiptDoc } from "./docpaths"
import { rangeChangedFiles } from "./git"
import { laneTouches, parseLaneReceipt, type TestLane } from "./intent/test-lanes"

// The round number of a phase unit's round name ("R-01" → 1) — the boundary
// sites hold the PhaseUnit; the receipt constructors take the number.
export function roundNumberOf(unit: { round: string }): number {
  return Number(/^R-(\d+)$/.exec(unit.round)?.[1] ?? 0)
}

// One green receipt's machine facts: its target-relative path, the tree HEADs
// its verdict vouches for, and its End time (the newest-green ordering key).
export type GreenReceipt = { path: string; heads: { root: string; sha: string }[]; end: string }

// The lane's newest green receipt, round-scoped (docs/R-NN/regression/).
// Unparsable, headless and red receipts are not carry basis — the laneCarry
// discipline verbatim; a red receipt still matters to the hold as evidence,
// which reads the same scan through regressionStatus below.
export async function newestGreenReceipt(dir: string, round: number, lane: string): Promise<GreenReceipt | undefined> {
  let best: GreenReceipt | undefined
  const stem = `R-${String(round).padStart(2, "0")}`
  for await (const file of new Bun.Glob(join("docs", stem, "regression", `*-${lane}.md`)).scan({ cwd: dir, onlyFiles: true })) {
    const receipt = parseLaneReceipt(await Bun.file(join(dir, file)).text().catch(() => ""))
    if (!receipt || receipt.verdict !== "green" || !receipt.heads.length) continue
    if (!best || (receipt.end ?? "") > best.end) best = { path: file, heads: receipt.heads, end: receipt.end ?? "" }
  }
  return best
}

// The complete-pass predicate (D3): covered = the newest green receipt's
// recorded HEADs..HEAD diff misses the lane's surfaces. changed carries that
// diff (the attribution basis) even when covered is false; undefined = no
// usable receipt or an unreadable range — the fail-safe direction, the lane
// re-runs.
export type RegressionCoverage = { covered: boolean; receipt?: GreenReceipt; changed?: string[] }

export async function regressionCovered(dir: string, round: number, lane: TestLane): Promise<RegressionCoverage> {
  const receipt = await newestGreenReceipt(dir, round, lane.name)
  if (!receipt) return { covered: false }
  const changed = await rangeChangedFiles(dir, receipt.heads)
  if (changed === undefined) return { covered: false, receipt }
  const covered = changed.length === 0 || !laneTouches(lane.surfaces, changed)
  return { covered, receipt, ...(covered ? {} : { changed }) }
}

// The table's regression rows — undefined when the pack declares none (the
// floor: no launches, no hold, no strict wait).
export function regressionLanes(lanes: readonly TestLane[] | undefined): TestLane[] | undefined {
  const rows = lanes?.filter((lane) => lane.cost === "regression")
  return rows?.length ? rows : undefined
}
