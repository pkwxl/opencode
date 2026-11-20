// The worker entry's pins (plans/0282: the executor coordinator is the one
// carriage — the plain/plan/transfer/lane payloads are tombstoned, the spec's
// tombstone section the record). The full executor lifecycle over the wire
// lives in executor-e2e.test.ts; this suite pins the entry's own grammar:
// the narrowed key set, the tombstone teachings, and the credential posture.
import { expect, test } from "bun:test"

const USAGE = "the worker takes exactly one argument"

function runWorker(argv: string[]): { code: number; out: string; err: string } {
  const proc = Bun.spawnSync([process.execPath, "src/index.ts", "worker", ...argv], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}

test("the worker takes exactly one JSON document", () => {
  const none = runWorker([])
  expect(none.code).toBe(1)
  expect(none.err).toContain(USAGE)
  const two = runWorker(["{}", "{}"])
  expect(two.code).toBe(1)
  expect(two.err).toContain(USAGE)
})

test("malformed documents are usage errors on stderr, exit 1", () => {
  const notJson = runWorker(["{not json"])
  expect(notJson.code).toBe(1)
  expect(notJson.err).toContain("not valid JSON")
  const notObject = runWorker(["[1]"])
  expect(notObject.code).toBe(1)
  expect(notObject.err).toContain("must be a JSON object")
})

test("the key set is exactly directory, executor and transport; every push payload is taught as retired", () => {
  for (const [payload, needle] of [
    ['{"directory": "/tmp", "options": {}}', "the run/plan/transfer/lane payloads are retired"],
    ['{"directory": "/tmp", "plan": {}}', "retired"],
    ['{"directory": "/tmp", "transfer": {}}', "retired"],
    ['{"directory": "/tmp", "lane": {}}', "retired"],
    ['{"directory": "/tmp", "switches": {}}', "retired"],
    ['{"directory": "/tmp", "unknown": 1}', 'unknown request field "unknown"'],
  ] as const) {
    const result = runWorker([payload])
    expect(result.code, payload).toBe(1)
    expect(result.err, payload).toContain(needle)
  }
})

test("the executor field is required: the coordinator is the one shape", () => {
  const result = runWorker(['{"directory": "/tmp", "transport": {"run": "run-000001", "url": "ws://127.0.0.1:1/x"}}'])
  expect(result.code).toBe(1)
  expect(result.err).toContain("executor coordinators only")
  expect(result.err).toContain("never spawned (plans/0282)")
})
