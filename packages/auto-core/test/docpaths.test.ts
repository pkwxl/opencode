import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  archivedTestHandoff,
  latestHandoffSeq,
  priorKnowledgeDoc,
  roundDir,
  roundDirName,
  subtaskDir,
  subtaskDoc,
  tempPriorKnowledgeDoc,
  taskDir,
  taskDoc,
} from "../src/docpaths"

function tempDir() {
  return mkdtemp(join(tmpdir(), "auto-docpaths-"))
}

describe("new-layout constructors", () => {
  test("taskDir/taskDoc: docs/T-003 and role file names", () => {
    expect(taskDir("T-003")).toBe(join("docs", "T-003"))
    expect(taskDoc("T-003", "context")).toBe(join("docs", "T-003", "context.md"))
    expect(taskDoc("T-012", "testhandoff")).toBe(join("docs", "T-012", "testhandoff.md"))
  })

  test("subtaskDir/subtaskDoc: two-digit zero padding, three digits carry naturally", () => {
    expect(subtaskDir("T-003", 2)).toBe(join("docs", "T-003", "S02"))
    expect(subtaskDir("T-003", 12)).toBe(join("docs", "T-003", "S12"))
    expect(subtaskDir("T-003", 123)).toBe(join("docs", "T-003", "S123"))
    expect(subtaskDoc("T-003", 4, "index")).toBe(join("docs", "T-003", "S04", "index.md"))
    expect(subtaskDoc("T-003", 2, "testhandoff")).toBe(join("docs", "T-003", "S02", "testhandoff.md"))
  })
})

describe("round-specific directories and in-round knowledge documents (new layout, R-NN two-digit zero padding with natural carry)", () => {
  test("roundDirName/roundDir: docs/R-01, natural carry R-99 → R-100", () => {
    expect(roundDirName(1)).toBe("R-01")
    expect(roundDirName(12)).toBe("R-12")
    expect(roundDirName(100)).toBe("R-100")
    expect(roundDir(3)).toBe(join("docs", "R-03"))
  })

  test("priorKnowledgeDoc: a fixed name within the round (the old timestamped name is gone; the k-phase knowledge document became kb.md inside the phase directory, see phases.test)", () => {
    expect(priorKnowledgeDoc(5)).toBe(join("docs", "R-05", "prior-kb.md"))
  })

  test("tempPriorKnowledgeDoc: the intermediate artifact lives in the same directory as the final one", () => {
    expect(tempPriorKnowledgeDoc(priorKnowledgeDoc(5))).toBe(join("docs", "R-05", "temp-kb.md"))
  })
})

describe("archived copies of test handover documents", () => {
  test("archive name: strip .md, append -<n>.md", () => {
    expect(archivedTestHandoff(subtaskDoc("T-003", 2, "testhandoff"), 1)).toBe(join("docs", "T-003", "S02", "testhandoff-1.md"))
    expect(archivedTestHandoff(taskDoc("T-003", "testhandoff"), 12)).toBe(join("docs", "T-003", "testhandoff-12.md"))
  })

  test("sequence continuation: scan the same directory and take the maximum; an empty directory is 0; the current copy and other files there are not miscounted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-handoff-"))
    try {
      const handoff = subtaskDoc("T-003", 2, "testhandoff")
      expect(await latestHandoffSeq(dir, handoff)).toBe(0)
      await Bun.write(join(dir, handoff), "current copy\n")
      await Bun.write(join(dir, subtaskDoc("T-003", 2, "index")), "artifact\n")
      expect(await latestHandoffSeq(dir, handoff)).toBe(0)
      await Bun.write(join(dir, archivedTestHandoff(handoff, 1)), "first\n")
      await Bun.write(join(dir, archivedTestHandoff(handoff, 2)), "second\n")
      expect(await latestHandoffSeq(dir, handoff)).toBe(2)
      // Natural carry into two digits: the maximum is numeric, not lexicographic.
      await Bun.write(join(dir, archivedTestHandoff(handoff, 10)), "tenth\n")
      expect(await latestHandoffSeq(dir, handoff)).toBe(10)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("sequence continuation honors only its own execution scope: task-level archives do not count at the subtask level", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-handoff-"))
    try {
      await Bun.write(join(dir, archivedTestHandoff(taskDoc("T-003", "testhandoff"), 4)), "task level\n")
      expect(await latestHandoffSeq(dir, taskDoc("T-003", "testhandoff"))).toBe(4)
      expect(await latestHandoffSeq(dir, subtaskDoc("T-003", 2, "testhandoff"))).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
