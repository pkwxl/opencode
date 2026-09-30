// Unit tests for src/exec-session.ts: seedPinFork frozen-point forking.
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { describe, expect, test } from "bun:test"
import type { SessionChain } from "../src/chain"
import { seedPinFork } from "../src/exec-session"
import { implicitFacts } from "../src/router"
import { fakeClient } from "./fixtures/runner"

// Frozen-point fork (interruption recovery F5): the server's fork semantics are
// "copy the messages **before** target", so the anchor is the message after
// the last one observed at the freeze.
describe("seedPinFork (forking from the session state at the freeze moment)", () => {
  const record = { task: "T-028", scope: "docs/T-028/S03/testhandoff.md", unit: "subtask 3", n: 1 }
  const makeChain = (): SessionChain => ({ pct: 10, used: 100, at: Date.now(), id: "ses_prev", note: "recovery note" })
  const messages = () => ({ data: [{ info: { id: "msg_1" } }, { info: { id: "msg_2" } }, { info: { id: "msg_3" } }] })

  test("anchor = the message after the freeze's last message; the chain switches to consuming the forked session, the recovery note cleared", async () => {
    const { client, calls } = fakeClient({ messages })
    const chain = makeChain()
    await expect(seedPinFork(client, chain, { ...record, pinSession: "ses_pin", pinMessage: "msg_2" }, "T-028 wrap-up", implicitFacts(undefined))).resolves.toBe(true)
    expect(calls.forks).toEqual(["ses_pin"])
    expect(calls.forkAnchors).toEqual(["msg_3"])
    expect(chain).toMatchObject({ id: undefined, pending: "ses_fork_1", pct: 100, used: 0, at: 0, note: undefined })
  })

  test("the frozen message is the last one (the wrap-up round dropped nothing): fork the whole history", async () => {
    const { client, calls } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin", pinMessage: "msg_3" }, "x", implicitFacts(undefined))).resolves.toBe(true)
    expect(calls.forkAnchors).toEqual([undefined])
  })

  test("the anchor is no longer in the session (message cleaned up) or the record has no anchor: fork the whole history", async () => {
    const { client, calls } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin", pinMessage: "msg_gone" }, "x", implicitFacts(undefined))).resolves.toBe(true)
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin" }, "x", implicitFacts(undefined))).resolves.toBe(true)
    expect(calls.forkAnchors).toEqual([undefined, undefined])
  })

  test("no frozen session, session expired, fork failure: false in every case; the caller cold-starts", async () => {
    const { client } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), record, "x", implicitFacts(undefined))).resolves.toBe(false)
    const dead = fakeClient({ get: () => ({ error: { name: "NotFoundError" } }) })
    await expect(seedPinFork(dead.client, makeChain(), { ...record, pinSession: "ses_pin" }, "x", implicitFacts(undefined))).resolves.toBe(false)
    expect(dead.calls.forks).toEqual([])
    const broken = fakeClient({ messages, fork: () => ({ error: { name: "NotFoundError" } }) })
    await expect(seedPinFork(broken.client, makeChain(), { ...record, pinSession: "ses_pin" }, "x", implicitFacts(undefined))).resolves.toBe(false)
  })
})
