// The command that starts a worker of this binary: the derivation every
// self-spawn site needs — the daemon's per-run spawn (src/daemon.ts), the
// entry's `transfer` command (src/index.ts) and the profile's lane launcher
// (src/profile.ts, which runs in the WORKER process: a lane child is a
// worker of this binary carrying a lane payload, so the derivation cannot
// live in the daemon module alone — the worker importing the daemon would
// cycle, and the daemon is not this process).
//   - a source layout (this process runs as `bun src/index.ts`): the same
//     interpreter on this module's neighbor entry src/index.ts, which
//     exists on the real filesystem;
//   - a compiled binary (script/build.ts): the embedded modules live on
//     Bun's virtual $bunfs, where a script path cannot be spawned — but
//     process.execPath already IS the server binary, whose argv goes
//     straight to the command dispatch (`<binary> worker '<json>'`).
// Sync by nature (the existsSync probe): the lane launcher calls it
// mid-run, in-process, where an await would buy nothing.
import { existsSync } from "node:fs"
import { join } from "node:path"

export function workerCommand(): { command: string; prefix: string[] } {
  if (!import.meta.dir.includes("$bunfs")) {
    const entry = join(import.meta.dir, "index.ts")
    if (existsSync(entry)) return { command: process.execPath, prefix: [entry] }
  }
  return { command: process.execPath, prefix: [] }
}
