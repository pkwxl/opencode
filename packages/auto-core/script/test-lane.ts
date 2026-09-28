// Lane runner: runs one test lane of this package (the manifest and budgets
// live in test/lanes.ts) and holds its wall-time budget.
// Usage: bun script/test-lane.ts <unit|repo|gate>
// - unit: the pure, in-memory files — the dev-loop gate, budget 5 s.
// - repo: the files that create a repository or spawn a process — wall time
//   printed, no budget of its own.
// - gate: both lanes in one `bun test` pass (the whole suite) — the unit
//   gate, failing above baseline × 1.25 (the baseline is recorded in
//   test/lanes.ts and re-measured at the program's final pass).
// Exit code: 0 within budget, 1 over budget; a test failure propagates the
// test run's own exit code. As with plain `bun test`, run it with the ambient
// OPENCODE_AUTO_* driver layer unset (it can steer switch-reading tests).
import { join } from "node:path"
import { GATE_BASELINE_MS, REPO_LANE, UNIT_BUDGET_MS, UNIT_LANE, gateBudgetMs } from "../test/lanes"

const lane = process.argv[2]
if (lane !== "unit" && lane !== "repo" && lane !== "gate") {
  console.error("usage: bun script/test-lane.ts <unit|repo|gate>")
  process.exit(1)
}

// The gate pass lists both lanes alphabetically, matching plain `bun test`'s
// discovery order; the single-lane runs keep the manifest order.
const files = lane === "unit" ? [...UNIT_LANE] : lane === "repo" ? [...REPO_LANE] : [...UNIT_LANE, ...REPO_LANE].sort()
const budgetMs = lane === "unit" ? UNIT_BUDGET_MS : lane === "gate" ? gateBudgetMs() : undefined

// Always run from the package root, whatever the invoker's directory.
const root = join(import.meta.dir, "..")
const start = Date.now()
const proc = Bun.spawn([process.execPath, "test", ...files], { cwd: root, stdout: "inherit", stderr: "inherit" })
const code = await proc.exited
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

if (code !== 0) process.exit(code === null ? 1 : code)
const ms = Date.now() - start
if (budgetMs === undefined) {
  console.log(`lane ${lane}: ${files.length} files in ${seconds(ms)} (no budget)`)
  process.exit(0)
}
if (ms > budgetMs) {
  const why = lane === "gate" ? ` (baseline ${seconds(GATE_BASELINE_MS)} x 1.25)` : ""
  console.error(`lane ${lane} over budget: ${seconds(ms)} > ${seconds(budgetMs)}${why}`)
  process.exit(1)
}
console.log(`lane ${lane}: ${files.length} files in ${seconds(ms)} (budget ${seconds(budgetMs)})`)
process.exit(0)
