// src/exec-session.ts 的单测: seedPinFork 定版点分叉。
// 拆分自 test/runner.test.ts(plans/0024-module-split-plan.md S18,纯搬运)。

import { describe, expect, test } from "bun:test"
import type { SessionChain } from "../src/chain"
import { seedPinFork } from "../src/exec-session"
import { fakeClient } from "./fixtures/runner"

// 定版点分叉(中断恢复 F5): server 的 fork 语义是"复制 target **之前**的消息",
// 故锚点取定版时观测到的末条消息的后一条。
describe("seedPinFork(从定版那一刻的会话状态分叉)", () => {
  const record = { task: "T-028", scope: "docs/T-028/S03/testhandoff.md", unit: "subtask 3", n: 1 }
  const makeChain = (): SessionChain => ({ pct: 10, used: 100, at: Date.now(), id: "ses_prev", note: "恢复说明" })
  const messages = () => ({ data: [{ info: { id: "msg_1" } }, { info: { id: "msg_2" } }, { info: { id: "msg_3" } }] })

  test("锚点 = 定版末条消息的后一条;链改为消费分叉会话,恢复说明清掉", async () => {
    const { client, calls } = fakeClient({ messages })
    const chain = makeChain()
    await expect(seedPinFork(client, chain, { ...record, pinSession: "ses_pin", pinMessage: "msg_2" }, "T-028 收尾")).resolves.toBe(true)
    expect(calls.forks).toEqual(["ses_pin"])
    expect(calls.forkAnchors).toEqual(["msg_3"])
    expect(chain).toMatchObject({ id: undefined, pending: "ses_fork_1", pct: 100, used: 0, at: 0, note: undefined })
  })

  test("定版消息就是末条(收尾回合一条都没落下): 整份分叉", async () => {
    const { client, calls } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin", pinMessage: "msg_3" }, "x")).resolves.toBe(true)
    expect(calls.forkAnchors).toEqual([undefined])
  })

  test("锚点已不在会话里(消息被清理)或记录没记锚点: 整份分叉", async () => {
    const { client, calls } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin", pinMessage: "msg_没了" }, "x")).resolves.toBe(true)
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin" }, "x")).resolves.toBe(true)
    expect(calls.forkAnchors).toEqual([undefined, undefined])
  })

  test("没有定版会话、会话已失效、fork 失败: 一律 false,调用方冷启动", async () => {
    const { client } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), record, "x")).resolves.toBe(false)
    const dead = fakeClient({ get: () => ({ error: { name: "NotFoundError" } }) })
    await expect(seedPinFork(dead.client, makeChain(), { ...record, pinSession: "ses_pin" }, "x")).resolves.toBe(false)
    expect(dead.calls.forks).toEqual([])
    const broken = fakeClient({ messages, fork: () => ({ error: { name: "NotFoundError" } }) })
    await expect(seedPinFork(broken.client, makeChain(), { ...record, pinSession: "ses_pin" }, "x")).resolves.toBe(false)
  })
})
