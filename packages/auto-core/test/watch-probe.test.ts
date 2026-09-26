// The in-flight liveness probe (plans/0026-session-boundary-hardening-design.md
// D3/§4.4, S4): while watching, session liveness is probed every idleTime over
// an independent short-timeout connection — two consecutive failures declare
// it half-open → abort + a retryable session error (transient, taking the
// existing retry ladder and failover ring); a recovered probe resets the
// count and watching continues; the timer is cleaned up on every exit. The
// half-open shape is reproduced with an event stream that never yields an
// event (no FIN/RST, so the client never sees an end signal); the probe
// period is shrunk to milliseconds via opts.idleMs.

import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { attempt } from "../src/attempt"
import { runSession } from "../src/session"
import { probeSession } from "../src/session-api"
import { parseSwitches } from "../src/switches"
import { task, fakeClient } from "./fixtures/runner"

describe("in-flight liveness probe (S4/D3)", () => {
  test("two consecutive failures: declared half-open, the session aborted and a retryable session error returned (errorClass=transient)", async () => {
    let gets = 0
    const { client, calls } = fakeClient({
      get: () => {
        gets++
        return { error: { name: "UnknownError", data: {} } }
      },
      // Half-open shape: the event stream never yields an event (no end
      // signal, no disconnect error).
      events: () =>
        (async function* () {
          await new Promise(() => {})
        })(),
    })
    const result = await attempt(client, task, "prompt", { idleMs: 20 }, { pct: 100, used: 0, at: 0 }, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; retryable?: boolean; errorClass?: string }
    expect(blocked.question).toContain("session error: ")
    expect(blocked.question).toContain("half-open")
    // Retryable (retryable not false) + transient classification
    // (transport-layer failure, no model switch).
    expect(blocked.retryable).not.toBe(false)
    expect(blocked.errorClass).toBe("transient")
    expect(gets).toBeGreaterThanOrEqual(2)
    // Close-out must abort (no orphaned server turns or retry forks
    // concurrently editing files).
    expect(calls.aborts).toContain("ses_new_1")
  })

  test("recovery after one failure: the count resets without declaring half-open; the session settles via idle as usual, no abort", async () => {
    let gets = 0
    const { client, calls } = fakeClient({
      // The first probe fails, all later ones succeed — the two-consecutive-
      // failures threshold must not be reached by a single blip.
      get: () => (gets++ === 0 ? { error: { name: "UnknownError", data: {} } } : { data: { id: "ses_x" } }),
      events: (sid) =>
        (async function* () {
          // No events for three probe periods (the probe's working
          // interval), then a normal idle settle.
          await new Promise((resolve) => setTimeout(resolve, 75))
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const result = await runSession(client, task, "prompt", { idleMs: 20 }, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("idle")
    expect(gets).toBeGreaterThanOrEqual(2)
    expect(calls.aborts).toEqual([])
  })

  test("timer cleanup: no further probes after the session settles (no leak)", async () => {
    let gets = 0
    const { client } = fakeClient({
      get: () => {
        gets++
        return { data: { id: "ses_x" } }
      },
    })
    const result = await runSession(client, task, "prompt", { idleMs: 20 }, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("idle")
    const atSettle = gets
    // Wait more than three probe periods; the probe count must not grow
    // again (settling tears the chain down; late callbacks re-arm nothing).
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(gets).toBe(atSettle)
  })

  test("H7: when the POST hangs on a half-open connection, the probe's verdict aborts the POST in concert and settles as a session error (without waiting for TURN_TIMEOUT)", async () => {
    const { client, calls } = fakeClient({
      get: () => {
        return { error: { name: "UnknownError", data: {} } }
      },
      // The H7 field shape: the synchronous POST and the SSE both hang on
      // the half-open connection; neither side ever resolves.
      prompt: () => new Promise(() => {}),
      events: () =>
        (async function* () {
          await new Promise(() => {})
        })(),
    })
    // If the code still bet on the POST until TURN_TIMEOUT, this case would
    // hang to the test timeout; returning on the probe scale (~2×idleMs)
    // proves the linkage works.
    const result = await attempt(client, task, "prompt", { idleMs: 20 }, { pct: 100, used: 0, at: 0 }, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; retryable?: boolean; errorClass?: string }
    // Settles as watch's half-open session error, and must not be reported
    // as a "task dispatch failed" (an abort echo).
    expect(blocked.question).toContain("session error: ")
    expect(blocked.question).toContain("half-open")
    expect(blocked.question).not.toContain("task dispatch failed")
    expect(blocked.retryable).not.toBe(false)
    expect(blocked.errorClass).toBe("transient")
    // The POST carries the abort signal and is aborted along with the
    // half-open verdict (on a real link this cancels the underlying fetch).
    expect(calls.promptSignals[0]?.aborted).toBe(true)
    expect(calls.aborts).toContain("ses_new_1")
  })

  test("probeSession probe body: a timeout without response and a request throw both count as failed; a normal response counts as live", async () => {
    const hanging = opencodeAgent({ session: { get: () => new Promise(() => {}) } } as unknown as OpencodeClient)
    expect(await probeSession(hanging, "ses_x", 20)).toBe(false)
    const throwing = opencodeAgent({ session: { get: () => Promise.reject(new Error("boom")) } } as unknown as OpencodeClient)
    expect(await probeSession(throwing, "ses_x", 20)).toBe(false)
    const failing = opencodeAgent({ session: { get: async () => ({ error: { name: "UnknownError" } }) } } as unknown as OpencodeClient)
    expect(await probeSession(failing, "ses_x", 20)).toBe(false)
    const ok = opencodeAgent({ session: { get: async () => ({ data: { id: "ses_x" } }) } } as unknown as OpencodeClient)
    expect(await probeSession(ok, "ses_x", 20)).toBe(true)
  })
})
