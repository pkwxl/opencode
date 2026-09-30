// The replay proof (plans/0061 R4/F1, the F1 unit's done-when): one
// incident scenario from the field-incident library the incident suite
// distills (plans/AUTO_NEXT_REFACTOR_PLAN.md F7) is recorded as a real
// watch() turn with the run-events journal live, then replayed through the
// spine with every fx answer served from the log — and the replay must
// reproduce the recorded effects exactly: the same fx calls in the same
// order with the same arguments, the same settle, and the same final
// Watch. The scenarios are the turn-engine seam of the incidents the
// driver-level suite covers end to end:
//   I2 truncated-output resume (kernel-spi-nor T-030 S13) — a length finish
//      is not a natural finish: the continuation steer keeps the session;
//   I1 half-open connection hang (kernel-dm T-068) — two consecutive probe
//      failures settle the turn interrupted, with the probes arriving as
//      synthetic inputs beside a held stream (the input log's synthetic
//      half, clock readings stamped in the inputs).
//
// Lane: unit — in-memory over the fake agent and the scenario clock, the
// journal the only file written (a temporary directory).
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RUN_EVENTS_FILE } from "../src/engine/events"
import { watch } from "../src/watch"
import { ev } from "./fixtures/agent"
import { recordReplayCase, type ReplayCase, type ReplayCaseResult } from "./fixtures/replay"
import { fireProbe, flush, until } from "./fixtures/turn-trace"

// Both sides of one case must agree on every figure the journal carries:
// the executed effects (every fx call, member and arguments, in order —
// the log and vlog lines included), the settle that ended the turn, and
// the final Watch the recorded run answered with.
function expectReplayed({ recorded, replayed }: ReplayCaseResult): void {
  expect(replayed.effects).toEqual(recorded.effects)
  expect(replayed.settle).toEqual(recorded.settle)
  expect(replayed.watch).toEqual(recorded.watch)
}

// I2's scenario (the incident suite's "a length finish is not a natural
// finish"): a truncated reply, the continuation steer at idle, and the
// finished continuation's natural settle. The post-steer events sit behind
// a gate the scenario releases only after the steer went out, so the
// recorded input order is deterministic.
const truncationCase: ReplayCase = {
  run: async (h) => {
    const afterSteer = h.gate()
    const done = watch(
      h.agent.client,
      "s",
      h.script([
        ev.message("s", "m1", 1000),
        ev.text("s", "t1", "first chunk cut off"),
        ev.step("s", "stp1", "length"),
        ev.idle("s"),
        { hold: afterSteer.promise },
        ev.text("s", "t2", "done after the continuation"),
        ev.step("s", "stp2"),
        ev.idle("s"),
      ]),
      h.opts,
      undefined,
      undefined,
      undefined,
      h.switches,
    )
    await until(() => h.agent.argsOf("promptAsync").length >= 1, "the length-continuation steer")
    afterSteer.release()
    return done
  },
}

// I1's scenario (the incident suite's half-open hang): the stream held
// mid-turn, the probe fired twice against a refusing connection — both
// verdicts synthetic inputs dispatched while the loop waits on the held
// stream — and the second judges half-open: a held settle that preempts
// the stream wait, the interrupted close-out aborting the orphan turn, and
// the classification of the extended failure record.
const halfOpenCase: ReplayCase = {
  agent: { fail: { get: new Error("connection refused") } },
  run: async (h) => {
    const held = h.gate()
    const done = watch(
      h.agent.client,
      "s",
      h.script([ev.message("s", "m1", 1000), ev.text("s", "t1", "work in flight"), { hold: held.promise }, ev.idle("s")]),
      h.opts,
      undefined,
      undefined,
      undefined,
      h.switches,
    )
    await until(() => h.agent.argsOf("contextLimits").length >= 1, "the first measurement")
    await flush()
    await fireProbe(h.clock) // get refuses: ⚠ … failure 1/2, rescheduled
    await fireProbe(h.clock) // failure 2/2: half-open — the held settle preempts the held stream wait
    const result = await done
    held.release()
    return result
  },
}

describe("run-events replay (0061 R4/F1)", () => {
  test("I2 truncated-output resume: the journal exists and the replay reproduces the recorded effects exactly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-i2-"))
    try {
      const result = await recordReplayCase(dir, truncationCase)
      // The drift row's own figure: the journal file exists under .auto/.
      expect(existsSync(join(dir, RUN_EVENTS_FILE))).toBe(true)
      expectReplayed(result)
      // The recorded incident's own shape: the turn settled naturally after
      // the continuation steer, and the steer is among the recorded effects.
      expect(result.recorded.settle).toEqual({ kind: "natural" })
      expect(result.recorded.effects.map((fx) => fx.member)).toContain("steer")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("I1 half-open connection hang: synthetic probe inputs replay from the log and reproduce the interrupted close-out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-i1-"))
    try {
      const result = await recordReplayCase(dir, halfOpenCase)
      expectReplayed(result)
      // The recorded incident's own shape: the half-open judgment settled
      // the turn interrupted, the close-out aborted the orphan turn, and
      // the probes reached the journal as synthetic inputs with their
      // clock stamps.
      expect(result.recorded.settle).toEqual({ kind: "interrupted" })
      expect(result.recorded.effects.map((fx) => fx.member)).toContain("abort")
      const probes = result.recorded.events.filter((entry) => entry.type === "input" && entry.input.kind === "probe")
      expect(probes.map((entry) => (entry.type === "input" && entry.input.kind === "probe" ? entry.input.ok : undefined))).toEqual([false, false])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
