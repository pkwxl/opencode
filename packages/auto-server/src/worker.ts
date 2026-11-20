// The worker entry of the headless service shell (P1b, auto-core
// plans/0067 §二/§四; narrowed to the executor carriage by plans/0282): one
// child process per coordinator. The daemon (P1c) spawns one worker per
// project's executor route demand; the worker runs exactly one executor
// coordinator in one target directory — the protocol does nothing via push,
// ever again, so the plain-run/plan/transfer/lane payloads are tombstoned
// (the spec's tombstone section is the compatibility record). One
// coordinator per process keeps the process topology the core assumes: the
// run lock's process-exit hook owns the whole process (src/lock.ts), and
// the OPENCODE_AUTO_* env-switch layer parses process.env once and
// memoizes (src/switches.ts). This module is therefore a process entry,
// never an in-process library; it must never be imported and driven.
//
// The credential (plans/0222 D1, the 0165-054 finding): /proc/<pid>/cmdline
// is world-readable, so the bridge secret rides the spawn environment
// (OPENCODE_AUTO_BRIDGE_TOKEN — the X1 prefix scrub keeps it out of every
// agent child) and the payload's transport names the URL alone.
import { runExecutorWorker } from "./executor-worker"

function refuse(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

// The worker request (the payload the daemon sends; the transport — here one
// argv token holding the JSON document — is the daemon's choice):
//   directory  the target directory of the coordinator (required);
//   executor   true, always — the coordinator worker is the one shape;
//   transport  the bridge URL payload { run, url } (required — the worker's
//              socket back to the daemon's executor routes).
export async function runWorker(argv: string[]): Promise<void> {
  if (argv.length !== 1 || !argv[0]) {
    refuse(`the worker takes exactly one argument: the coordinator request as a JSON document (usage: opencode-auto-server worker '<json>' — { "directory": "<dir>", "executor": true, "transport": { … } })`)
  }
  let document: unknown
  try {
    document = JSON.parse(argv[0]!)
  } catch (error) {
    refuse(`the coordinator request is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    refuse(`the coordinator request must be a JSON object: { "directory": "<dir>", "executor": true, "transport": { … } }`)
  }
  const request = document as Record<string, unknown>
  for (const key of Object.keys(request)) {
    if (key === "directory" || key === "executor" || key === "transport") continue
    refuse(`unknown request field "${key}" (the coordinator request takes directory, executor and transport — the run/plan/transfer/lane payloads are retired: the protocol does nothing via push, plans/0282)`)
  }
  if (request.executor !== true) {
    refuse(`the worker serves executor coordinators only ({"executor": true}): plain runs, planning sessions, transfers and lanes are pull-only work on the executor protocol, never spawned (plans/0282)`)
  }
  try {
    await runExecutorWorker(request)
    process.exit(0)
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error))
  }
}
