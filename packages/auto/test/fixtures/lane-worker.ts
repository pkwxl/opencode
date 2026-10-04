// A lane worker with no shell (auto-core plans/0068 §6.4, the S2 e2e): a
// tiny bootstrap that imports the core and runs one unit — the proof the
// core exports everything a lane worker needs (runLaneWorker wraps runAll
// with the lane option and writes the `.auto/lane.json` report the parent
// reads). Spawned by a test's laneLauncher override (setShellProfile),
// never from a CLI; `bun test` never collects this file directly.
import { loadProjectConfig } from "@opencode-ai/auto-core/config"
import { runLaneWorker } from "@opencode-ai/auto-core/loop"

const args = process.argv.slice(2)
const at = args.indexOf("--unit")
const unit = at >= 0 ? args[at + 1] : undefined
if (!args[0] || !unit) {
  console.error("usage: lane-worker <dir> --unit <task id>")
  process.exit(1)
}
// The config keys a worker's sessions read ride the shell's option threading
// (the CLI `_lane` entry does the same): subtask decides the unit's pipeline
// shape, and this fixture is the shell stand-in.
const config = await loadProjectConfig(args[0]).catch(() => undefined)
process.exit(await runLaneWorker(args[0], { lane: { unit }, ...(config ? { subtask: config.subtask } : {}) }))
