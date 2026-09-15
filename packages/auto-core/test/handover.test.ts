import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  forgetHandover,
  handoffComplete,
  handoffStatus,
  handoverStage,
  peekHandover,
  recallHandover,
  saveHandover,
  type Handover,
} from "../src/handover"

const record: Handover = {
  task: "T-028",
  scope: "docs/T-028/S03/testhandoff.md",
  unit: "subtask 3",
  n: 1,
  script: "/work/test/t028.sh",
  seq: 129,
  pinSession: "ses_pin",
  pinMessage: "msg_9",
}

async function fresh() {
  return await mkdtemp(join(tmpdir(), "auto-handover-"))
}

describe("在途交接记录的读写", () => {
  test("往返: 按任务与执行范围取回", async () => {
    const dir = await fresh()
    try {
      await saveHandover(dir, record)
      expect(await recallHandover(dir, "T-028", "docs/T-028/S03/testhandoff.md")).toEqual(record)
      expect(await peekHandover(dir, "T-028")).toEqual(record)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("范围不符不取回(下一执行范围不得续上一范围的交接)", async () => {
    const dir = await fresh()
    try {
      await saveHandover(dir, record)
      expect(await recallHandover(dir, "T-028", "docs/T-028/S04/testhandoff.md")).toBeUndefined()
      expect(await recallHandover(dir, "T-029", "docs/T-028/S03/testhandoff.md")).toBeUndefined()
      // 任务级窥视不看范围,只看任务
      expect(await peekHandover(dir, "T-029")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("缺失、损坏与清除", async () => {
    const dir = await fresh()
    try {
      expect(await recallHandover(dir, "T-028", record.scope)).toBeUndefined()
      await Bun.write(join(dir, ".auto", "handover.json"), "{ 不是 json")
      expect(await recallHandover(dir, "T-028", record.scope)).toBeUndefined()
      expect(await peekHandover(dir, "T-028")).toBeUndefined()
      await saveHandover(dir, record)
      await forgetHandover(dir)
      expect(await recallHandover(dir, "T-028", record.scope)).toBeUndefined()
      // 清除幂等
      await forgetHandover(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("交接文档的完整判据(F1/F2)", () => {
  test("状态行", () => {
    expect(handoffStatus("正文\n\n状态: 继续\n")).toBe("继续")
    expect(handoffStatus("正文\n\n状态：完成")).toBe("完成")
    expect(handoffStatus("正文,没有状态行")).toBeUndefined()
  })

  test("有状态行即完整;缺状态行但已落账同样完整;半截文件不完整", () => {
    expect(handoffComplete("正文\n状态: 继续", false)).toBe(true)
    // 已落账 = 提交那一刻文件是整的,缺行只是写于状态行约定之前
    expect(handoffComplete("状态行约定之前写的正文", true)).toBe(true)
    expect(handoffComplete("会话写到一半被打断", false)).toBe(false)
    expect(handoffComplete(undefined, true)).toBe(false)
    expect(handoffComplete("   \n", true)).toBe(false)
  })
})

describe("handoverStage(文件状态 × 提交状态)", () => {
  const base = { current: undefined, currentCommitted: false, archived: false, archivedCommitted: false }

  test("H5 无交接痕迹 → none", () => {
    expect(handoverStage({ ...base })).toBe("none")
  })

  test("H1 有定版记录、文档半截 → wrapup(从定版点重做收尾)", () => {
    expect(handoverStage({ ...base, record })).toBe("wrapup")
    expect(handoverStage({ ...base, record, current: "写到一半" })).toBe("wrapup")
    // 空文件与不在盘等价
    expect(handoverStage({ ...base, record, current: "   " })).toBe("wrapup")
  })

  test("H2 文档写完但未归档 → commit", () => {
    expect(handoverStage({ ...base, record, current: "正文\n状态: 继续" })).toBe("commit")
    // 已落账的历史格式文档(无状态行)同样算写完
    expect(handoverStage({ ...base, record, current: "老格式正文", currentCommitted: true })).toBe("commit")
  })

  test("H2 已归档但提交 #2 没落账 → commit", () => {
    expect(handoverStage({ ...base, record, archived: true })).toBe("commit")
  })

  test("H3 归档份已落账 → test(交接已收口,只差跑脚本与续跑)", () => {
    expect(handoverStage({ ...base, record, archived: true, archivedCommitted: true })).toBe("test")
    // 记录缺失不改变阶段(只影响"跑哪个脚本"的回落)
    expect(handoverStage({ ...base, archived: true, archivedCommitted: true })).toBe("test")
  })

  test("H4 无记录的存量现场: 留着一份文档就按已交接处理,不凭空重做", () => {
    expect(handoverStage({ ...base, current: "上一版 driver 写下的交接", currentCommitted: true })).toBe("commit")
    expect(handoverStage({ ...base, current: "没有状态行的半截" })).toBe("commit")
  })
})
