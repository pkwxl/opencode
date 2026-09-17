import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  closedHandovers,
  forgetHandover,
  handoffComplete,
  handoffStatus,
  handoverSeq,
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

  test("已收口态往返: 待跑脚本与定版锚点作废、执行结果固化(ran)保留", async () => {
    const dir = await fresh()
    try {
      const closed: Handover = {
        task: "T-028",
        scope: "docs/T-028/S03/testhandoff.md",
        unit: "subtask 3",
        n: 1,
        ran: { script: "/work/test/t028.sh", seq: 7, code: 0, ms: 1200, timedOut: false, out: "/work/tmp/test.7.out" },
      }
      await saveHandover(dir, closed)
      const got = await recallHandover(dir, "T-028", "docs/T-028/S03/testhandoff.md")
      expect(got).toEqual(closed)
      expect(got?.ran?.code).toBe(0)
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

describe("handoverSeq(观测序号 vs 归档续号)", () => {
  test("无在途记录: 观测与续号都回落盘扫描(存量现场)", () => {
    expect(handoverSeq(undefined, 0)).toEqual({ observed: 0, nextBase: 0 })
    expect(handoverSeq(undefined, 3)).toEqual({ observed: 3, nextBase: 3 })
  })

  test("记录在案即权威: 盘扫描更高号是命名族里的误写件,不作交接证据", () => {
    // 现场: 交接 #1 已收口(testhandoff-1.md 落账),会话又自写 testhandoff-2.md——
    // 观测仍认 #1 的归档份,阶段判为 test 而不是"交接 #2 已收口"。
    expect(handoverSeq({ ...record, n: 1 }, 2)).toEqual({ observed: 1, nextBase: 2 })
  })

  test("续号取两侧最大: 不覆盖盘上误写件,也不覆盖记录所指归档", () => {
    // 误写件占住 2 号位 → 下一次真交接归档为 -3,误写件原样保留。
    expect(handoverSeq({ ...record, n: 1 }, 2).nextBase).toBe(2)
    // 归档份被删(盘扫描倒退)而记录还在 → 续号跟着记录走,不倒退。
    expect(handoverSeq({ ...record, n: 2 }, 0)).toEqual({ observed: 2, nextBase: 2 })
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

describe("closedHandovers(恢复入口的已收口计数)", () => {
  // record 夹具带 script/pinSession = 未收口形态;closed 为收口后形态(两者作废)。
  const closed: Handover = { task: "T-028", scope: "docs/T-028/S03/testhandoff.md", unit: "subtask 3", n: 1 }

  test("未收口记录的 n 是已分配的号而非已收口计数: 基数退一格,恢复收口正落 record.n", () => {
    // 定版 #1 后收尾途中被打断: 归档扫描为 0,基数须为 0 而非 1——否则恢复收口
    // 归档为 testhandoff-2.md,跳空一号且与「#1 定版」提交标题对不上。
    expect(closedHandovers({ ...record, n: 1 }, handoverSeq({ ...record, n: 1 }, 0))).toBe(0)
    // 交接 #2 定版后被打断(#1 已收口归档): 基数 1,恢复收口正落 #2。
    expect(closedHandovers({ ...record, n: 2 }, handoverSeq({ ...record, n: 2 }, 1))).toBe(1)
  })

  test("已收口记录与无记录维持 nextBase 原义", () => {
    expect(closedHandovers({ ...closed, n: 1 }, handoverSeq({ ...closed, n: 1 }, 1))).toBe(1)
    expect(closedHandovers(undefined, handoverSeq(undefined, 3))).toBe(3)
  })

  test("盘上误写件更大时不被踩: 基数仍被 diskMax 托住", () => {
    expect(closedHandovers({ ...record, n: 1 }, handoverSeq({ ...record, n: 1 }, 2))).toBe(2)
  })
})
