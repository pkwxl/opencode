import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handoffStatus } from "../src/document/roles"
import {
  closedHandovers,
  forgetHandover,
  handoffComplete,
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

describe("in-flight handover record read/write", () => {
  test("round trip: recalled by task and execution scope", async () => {
    const dir = await fresh()
    try {
      await saveHandover(dir, record)
      expect(await recallHandover(dir, "T-028", "docs/T-028/S03/testhandoff.md")).toEqual(record)
      expect(await peekHandover(dir, "T-028")).toEqual(record)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("closed-out state round trip: the pending script and freeze anchor are voided, the fixed execution result (ran) is kept", async () => {
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

  // The sessions' agent profile (plans/0055 §8.2): the record carries it next
  // to pinSession/nextSession, written under a registry; an absent field is
  // the default agent's, so pre-binding records read unchanged.
  test("agent round-trips with the record (next to pinSession/nextSession); absent field = the default agent", async () => {
    const dir = await fresh()
    try {
      const bound: Handover = { ...record, agent: "claude-b" }
      await saveHandover(dir, bound)
      expect(await recallHandover(dir, "T-028", record.scope)).toEqual(bound)
      expect((await peekHandover(dir, "T-028"))?.agent).toBe("claude-b")
      // Without the field the stored shape is the pre-binding one.
      await saveHandover(dir, record)
      expect(await Bun.file(join(dir, ".auto", "handover.json")).text()).not.toContain("agent")
      expect((await recallHandover(dir, "T-028", record.scope))?.agent).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a mismatched scope is not recalled (the next execution scope must not continue the previous scope's handover)", async () => {
    const dir = await fresh()
    try {
      await saveHandover(dir, record)
      expect(await recallHandover(dir, "T-028", "docs/T-028/S04/testhandoff.md")).toBeUndefined()
      expect(await recallHandover(dir, "T-029", "docs/T-028/S03/testhandoff.md")).toBeUndefined()
      // The task-level peek ignores scope, task only
      expect(await peekHandover(dir, "T-029")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("missing, corrupt, and cleared", async () => {
    const dir = await fresh()
    try {
      expect(await recallHandover(dir, "T-028", record.scope)).toBeUndefined()
      await Bun.write(join(dir, ".auto", "handover.json"), "{ not json")
      expect(await recallHandover(dir, "T-028", record.scope)).toBeUndefined()
      expect(await peekHandover(dir, "T-028")).toBeUndefined()
      await saveHandover(dir, record)
      await forgetHandover(dir)
      expect(await recallHandover(dir, "T-028", record.scope)).toBeUndefined()
      // Clearing is idempotent
      await forgetHandover(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("handover-document completeness criteria (F1/F2)", () => {
  test("status line", () => {
    expect(handoffStatus("body\n\nStatus: continue\n")).toBe("continue")
    expect(handoffStatus("body\n\nStatus：done")).toBe("done")
    expect(handoffStatus("body, no status line")).toBeUndefined()
  })

  test("English status line, case-insensitive; pre-flip Chinese no longer read (M3.7)", () => {
    expect(handoffStatus("body\n\nStatus: continue\n")).toBe("continue")
    expect(handoffStatus("body\nStatus: done")).toBe("done")
    expect(handoffStatus("body\nstatus:  DONE  \n")).toBe("done")
    expect(handoffStatus("body\nStatus: continue running\n")).toBeUndefined()
    expect(handoffStatus("write Status: continue at the end")).toBeUndefined()
    expect(handoffStatus("状态: 继续")).toBeUndefined()
    expect(handoffStatus("状态: 完成")).toBeUndefined()
  })

  test("the status line must be whole-line anchored: the body restating the prompt wording must not match (2026-09-17 review H3)", () => {
    // The wording appears mid-sentence (a common shape of the session restating the prompt's instructions)
    expect(handoffStatus("when finished, write out the Status: continue line")).toBeUndefined()
    // A value with a tail (e.g. "continue with the rest") is not a valid status line
    expect(handoffStatus("body\nStatus: continue with the rest\n")).toBeUndefined()
    // Split across lines does not count (the old criterion's \s could swallow the newline)
    expect(handoffStatus("Status:\ncontinue\n")).toBeUndefined()
    // Surrounding whitespace on the line is allowed
    expect(handoffStatus("body\n  Status:  continue  \n")).toBe("continue")
    // Several matching lines: the last one wins (the protocol puts it last)
    expect(handoffStatus("Status: continue\nStatus: done\n")).toBe("done")
    expect(handoffStatus("## Step 2\nStatus: done\n\nnext steps…\n\nStatus: continue\n")).toBe("continue")
  })

  test("a status line alone means complete; missing the status line but already archived is equally complete; a half-written file is incomplete", () => {
    expect(handoffComplete("body\nStatus: continue", false)).toBe(true)
    // Archived = the file was whole at commit time; the missing line just predates the status-line convention
    expect(handoffComplete("body written before the status-line convention", true)).toBe(true)
    expect(handoffComplete("session interrupted mid-write", false)).toBe(false)
    expect(handoffComplete(undefined, true)).toBe(false)
    expect(handoffComplete("   \n", true)).toBe(false)
  })
})

describe("handoverSeq (observed number vs archive continuation)", () => {
  test("no in-flight record: both the observed number and the continuation fall back to the disk scan (legacy field state)", () => {
    expect(handoverSeq(undefined, 0)).toEqual({ observed: 0, nextBase: 0 })
    expect(handoverSeq(undefined, 3)).toEqual({ observed: 3, nextBase: 3 })
  })

  test("a record on file is authoritative: a higher number from the disk scan is a miswritten file in the naming family, not handover evidence", () => {
    // Field: handover #1 already closed out (testhandoff-1.md archived), and the
    // session also wrote testhandoff-2.md itself — observation still recognizes
    // #1's archived copy, and the stage is judged test rather than "handover #2
    // closed out".
    expect(handoverSeq({ ...record, n: 1 }, 2)).toEqual({ observed: 1, nextBase: 2 })
  })

  test("the continuation takes the max of both sides: neither overwrites the miswritten file on disk nor the archive the record points at", () => {
    // The miswritten file occupies slot 2 → the next real handover archives as -3; the miswritten file stays as is.
    expect(handoverSeq({ ...record, n: 1 }, 2).nextBase).toBe(2)
    // The archived copy deleted (disk scan goes backwards) while the record remains → the continuation follows the record, no going backwards.
    expect(handoverSeq({ ...record, n: 2 }, 0)).toEqual({ observed: 2, nextBase: 2 })
  })
})

describe("handoverStage (file state × commit state)", () => {
  const base = { current: undefined, currentCommitted: false, archived: false, archivedCommitted: false }

  test("H5 no handover traces → none", () => {
    expect(handoverStage({ ...base })).toBe("none")
  })

  test("H1 a freeze record exists, the document is half-written → wrapup (redo the wrap-up from the freeze point)", () => {
    expect(handoverStage({ ...base, record })).toBe("wrapup")
    expect(handoverStage({ ...base, record, current: "half-written" })).toBe("wrapup")
    // An empty file equals not on disk
    expect(handoverStage({ ...base, record, current: "   " })).toBe("wrapup")
  })

  test("H2 document written but not archived → commit", () => {
    expect(handoverStage({ ...base, record, current: "body\nStatus: continue" })).toBe("commit")
    // An archived legacy-format document (no status line) also counts as written
    expect(handoverStage({ ...base, record, current: "legacy-format body", currentCommitted: true })).toBe("commit")
  })

  test("H2 archived but commit #2 not recorded → commit", () => {
    expect(handoverStage({ ...base, record, archived: true })).toBe("commit")
  })

  test("H3 the archived copy is recorded → test (the handover is closed out; only the script run and the continuation remain)", () => {
    expect(handoverStage({ ...base, record, archived: true, archivedCommitted: true })).toBe("test")
    // A missing record does not change the stage (it only affects the "which script to run" fallback)
    expect(handoverStage({ ...base, archived: true, archivedCommitted: true })).toBe("test")
  })

  test("H4 a legacy field state without a record: a document left on disk is treated as handed over, not redone from nothing", () => {
    expect(handoverStage({ ...base, current: "a handover written by the previous driver version", currentCommitted: true })).toBe("commit")
    expect(handoverStage({ ...base, current: "half-written without a status line" })).toBe("commit")
  })
})

describe("closedHandovers (closed-out count at the recovery entry)", () => {
  // The record fixture carries script/pinSession = the not-yet-closed-out shape; closed is the shape after close-out (both voided).
  const closed: Handover = { task: "T-028", scope: "docs/T-028/S03/testhandoff.md", unit: "subtask 3", n: 1 }

  test("an unclosed record's n is the allocated number, not a closed-out count: the base steps back by one, so the recovered close-out lands exactly on record.n", () => {
    // Interrupted mid wrap-up after freeze #1: the archive scan is 0, so the
    // base must be 0, not 1 — otherwise the recovered close-out archives as
    // testhandoff-2.md, skipping a number and mismatching the "freeze #1"
    // commit title.
    expect(closedHandovers({ ...record, n: 1 }, handoverSeq({ ...record, n: 1 }, 0))).toBe(0)
    // Interrupted after handover #2 froze (#1 already closed out and archived): base 1, the recovered close-out lands exactly on #2.
    expect(closedHandovers({ ...record, n: 2 }, handoverSeq({ ...record, n: 2 }, 1))).toBe(1)
  })

  test("a closed-out record and no record keep nextBase's original meaning", () => {
    expect(closedHandovers({ ...closed, n: 1 }, handoverSeq({ ...closed, n: 1 }, 1))).toBe(1)
    expect(closedHandovers(undefined, handoverSeq(undefined, 3))).toBe(3)
  })

  test("a larger miswritten file on disk is not stepped on: the base is still held up by diskMax", () => {
    expect(closedHandovers({ ...record, n: 1 }, handoverSeq({ ...record, n: 1 }, 2))).toBe(2)
  })
})
