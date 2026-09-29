// The lane manifest: every test file of this package, assigned to exactly one
// of two lanes (the completeness and shape rules live in test/lanes.test.ts,
// the runner in script/test-lane.ts):
// - `repo`: the file creates a git repository or spawns a process. In
//   practice it imports test/fixtures/runner.ts's repository helpers (directly
//   or through test/fixtures/loop.ts), calls Bun.spawn itself, or drives a
//   src-side spawn (runScript's bash, the agent pool's bin/server spawns).
// - `unit`: everything else — pure and in-memory, fast enough to serve as the
//   dev-loop gate on every machine. No `unit`-lane test may wait on a real
//   timer longer than 50 ms.
// AUTO-DECISION: borderline files are classified by what they actually do at
// runtime, not by import graph alone — e.g. test/execute-handover.test.ts
// drives executeWhole but installs the no-commit git double over a plain
// temp directory (no git repository, no spawn → unit), while
// test/script.test.ts spawns only through runScript (→ repo).
import { readdirSync } from "node:fs"

export type Lane = "unit" | "repo"

// Files that create a repository or spawn a process.
export const REPO_LANE: readonly string[] = [
  "test/agent-claude.test.ts",
  "test/agent-env.test.ts",
  "test/agent-fake.test.ts",
  "test/agent-pool.test.ts",
  "test/agent-server.test.ts",
  "test/append-loop.test.ts",
  "test/artifact.test.ts",
  "test/auto-doc-shape.test.ts",
  "test/capability.test.ts",
  "test/close.test.ts",
  "test/config-fix.test.ts",
  "test/document-roles.test.ts",
  "test/exec-session.test.ts",
  "test/git.test.ts",
  "test/gitignore.test.ts",
  "test/incident-regression.test.ts",
  "test/knowledge.test.ts",
  "test/lock.test.ts",
  "test/loop-preflight.test.ts",
  "test/models-describe.test.ts",
  "test/plan-input.test.ts",
  "test/plan-loop.test.ts",
  "test/plan.test.ts",
  "test/reset.test.ts",
  "test/resolve.test.ts",
  "test/round-gates.test.ts",
  "test/script.test.ts",
  "test/session-api.test.ts",
  "test/session.test.ts",
  "test/subtask-shape.test.ts",
  "test/task-add.test.ts",
  "test/testrun.test.ts",
  "test/turn-trace.test.ts",
  "test/unit-commit.test.ts",
  "test/watch-probe.test.ts",
  "test/watch.test.ts",
]

// Pure, in-memory files.
export const UNIT_LANE: readonly string[] = [
  "test/agent-choice.test.ts",
  "test/agent-client.test.ts",
  "test/agent-events.test.ts",
  "test/append.test.ts",
  "test/chain.test.ts",
  "test/chain-writes.test.ts",
  "test/classify.test.ts",
  "test/config.test.ts",
  "test/confirm.test.ts",
  "test/dispatch.test.ts",
  "test/docpaths.test.ts",
  "test/document-spec.test.ts",
  "test/document-state.test.ts",
  "test/document-unit.test.ts",
  "test/execute-handover.test.ts",
  "test/exit.test.ts",
  "test/failback.test.ts",
  "test/golden.test.ts",
  "test/handover.test.ts",
  "test/hibernate.test.ts",
  "test/import-direction.test.ts",
  "test/intent.test.ts",
  "test/interactive.test.ts",
  "test/keyring.test.ts",
  "test/ladder.test.ts",
  "test/lanes.test.ts",
  "test/log.test.ts",
  "test/loop-conclusion.test.ts",
  "test/loop-progress.test.ts",
  "test/model-step.test.ts",
  "test/model-window.test.ts",
  "test/mode.test.ts",
  "test/models.test.ts",
  "test/numbering.test.ts",
  "test/parallel.test.ts",
  "test/phases-custom.test.ts",
  "test/phases-registry.test.ts",
  "test/phases.test.ts",
  "test/prompt-exec.test.ts",
  "test/prompt-phase.test.ts",
  "test/prompt-template.test.ts",
  "test/protect.test.ts",
  "test/quota-windows.test.ts",
  "test/resume-gate.test.ts",
  "test/resume.test.ts",
  "test/routing.test.ts",
  "test/select.test.ts",
  "test/services.test.ts",
  "test/session-opts.test.ts",
  "test/shell.test.ts",
  "test/split.test.ts",
  "test/stats.test.ts",
  "test/step.test.ts",
  "test/stuck.test.ts",
  "test/switches.test.ts",
  "test/tasks.test.ts",
  "test/template.test.ts",
  "test/tier.test.ts",
  "test/turn-arbitration.test.ts",
  "test/turn-failure.test.ts",
  "test/turn-guard.test.ts",
  "test/turn-questions.test.ts",
  "test/turn-recovery.test.ts",
  "test/turn-stuck.test.ts",
  "test/turn-transcript.test.ts",
  "test/turn-windows.test.ts",
  "test/usage.test.ts",
  "test/wrapup-result.test.ts",
]

// The dev-loop budget on every machine: the whole `unit` lane under 5 s.
export const UNIT_BUDGET_MS = 5_000

// The gate budget is relative, not absolute: baseline × 1.25, where the
// baseline is this package's full-suite wall time (the `gate` lane runs both
// lanes in one `bun test` pass) on the host that runs the unit gates. The
// figure below was recorded when the lanes landed (measured across repeated
// runs on a shared container host — take a representative figure, not a
// fastest one) and is re-measured at the program's final pass and by any
// changed gate host; the absolute 30 s figure stays the original gate-machine
// reference only, not the rule.
export const GATE_BASELINE_MS = 28_000

// The `gate` lane's fail line: baseline × 1.25.
export const gateBudgetMs = (): number => Math.round(GATE_BASELINE_MS * 1.25)

// Every *.test.ts file under test/ (the manifest's completeness check runs
// against this).
export const testFilesOnDisk = (): string[] =>
  readdirSync(import.meta.dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.test\.ts$/.test(entry.name))
    .map((entry) => `test/${entry.name}`)
    .sort()
