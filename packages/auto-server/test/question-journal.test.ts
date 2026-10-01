// The persistent pending-question queue's journal (T-095, P3c): the pure
// module under the daemon's hubs — append/replay/fold/compact over a real
// temp data directory. What these cases pin:
//   - the fold: a run survives a replay iff it was opened and still holds
//     an open question; settled ids drop; re-raises are idempotent by id;
//     the arrival order is kept;
//   - tolerance: a torn tail line (the crash window of an append) and a
//     newer version's record are skipped at replay, never fatal and never
//     misread;
//   - compaction: the journal rewrites down to the pending set (the
//     surviving runs' opened + open raised events), so it stays the size of
//     the pending state, not of history — and re-folding the compacted
//     journal reconstructs exactly the same pending set;
//   - the run-id floor: a restarted daemon never reissues a live run's id;
//   - placement: the journal lives under the daemon's data directory and
//     never inside a registered project's directory — the
//     driver-exclusive-writes constitution of `.auto/` (the acceptance's
//     containment line, asserted here over the path resolver).
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendJournal, compactJournal, foldJournal, journalPath, journalRunFloor, QUESTION_JOURNAL_FILE, readJournal, type JournalEvent } from "../src/question-journal"
import { DaemonStore } from "../src/store"

const opened = (run: string, secret: string, directory: string): JournalEvent => ({
  v: 1,
  at: "2026-10-01T00:00:00.000Z",
  run,
  event: "opened",
  project: "proj",
  directory,
  secret,
  started: "2026-10-01T00:00:00.000Z",
  request: { options: { waitBetween: 1 }, switches: { OPENCODE_AUTO_AGENT: "claude" } },
})

const raised = (run: string, id: string, text: string, minutes?: number): JournalEvent => ({
  v: 1,
  at: "2026-10-01T00:00:01.000Z",
  run,
  event: "raised",
  id,
  text,
  ...(minutes !== undefined ? { minutes } : {}),
})

const settled = (run: string, id: string, how: "answered" | "timeout" | "transport" | "closed"): JournalEvent => ({
  v: 1,
  at: "2026-10-01T00:00:02.000Z",
  run,
  event: "settled",
  id,
  how,
})

async function withDataDir(fn: (dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-journal-"))
  try {
    await fn(dataDir)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
}

describe("the question journal (append, replay, fold, compact)", () => {
  test("the fold reconstructs exactly the runs with open questions, in arrival order; settled ids and finished runs drop", async () => {
    await withDataDir(async (dataDir) => {
      appendJournal(dataDir, opened("run-000001", "oar_a", "/tmp/one"))
      appendJournal(dataDir, raised("run-000001", "q1", "first ask"))
      appendJournal(dataDir, raised("run-000001", "q2", "second ask", 1))
      appendJournal(dataDir, opened("run-000002", "oar_b", "/tmp/two"))
      appendJournal(dataDir, raised("run-000002", "q1", "the only ask of two"))
      appendJournal(dataDir, settled("run-000002", "q1", "answered"))
      appendJournal(dataDir, opened("run-000003", "oar_c", "/tmp/three"))
      const { events, skipped } = readJournal(dataDir)
      expect(skipped).toBe(0)
      expect(events).toHaveLength(7)
      const restored = foldJournal(events)
      // run-000002 settled its only question and run-000003 never asked:
      // history does not survive — only the pending set does.
      expect([...restored.keys()]).toEqual(["run-000001"])
      const run = restored.get("run-000001")!
      expect(run.secret).toBe("oar_a")
      expect(run.directory).toBe("/tmp/one")
      expect(run.request.switches).toEqual({ OPENCODE_AUTO_AGENT: "claude" })
      expect(run.questions.map((question) => question.id)).toEqual(["q1", "q2"])
      expect(run.questions[0]).toMatchObject({ id: "q1", text: "first ask" })
      expect(run.questions[1]).toMatchObject({ id: "q2", text: "second ask", minutes: 1 })
      expect(journalRunFloor(events)).toBe(3)
    })
  })

  test("a re-raise of the same id is idempotent in the fold (the last state wins, no duplicate delivery)", async () => {
    await withDataDir(async (dataDir) => {
      appendJournal(dataDir, opened("run-000001", "oar_a", "/tmp/one"))
      appendJournal(dataDir, raised("run-000001", "q1", "the ask"))
      // A bridge blip: the worker degrades nothing, reconnects and re-raises.
      appendJournal(dataDir, settled("run-000001", "q1", "transport"))
      appendJournal(dataDir, raised("run-000001", "q1", "the ask"))
      const restored = foldJournal(readJournal(dataDir).events)
      expect(restored.get("run-000001")!.questions.map((question) => question.id)).toEqual(["q1"])
    })
  })

  test("a torn tail line and a newer version's records are skipped, never fatal", async () => {
    await withDataDir(async (dataDir) => {
      appendJournal(dataDir, opened("run-000001", "oar_a", "/tmp/one"))
      appendJournal(dataDir, raised("run-000001", "q1", "the ask"))
      // The crash window of an append: a half-written line (its own line —
      // a later append that merged onto it would make the pair one
      // unparseable line, skipped the same way).
      await writeFile(journalPath(dataDir), '{"v":1,"at":"2026-10-01T00:00:03.000Z","run":"run-00000\n', { flag: "a" })
      await writeFile(journalPath(dataDir), `${JSON.stringify({ v: 2, at: "x", run: "run-000009", event: "raised", id: "z", text: "from the future" })}\n`, { flag: "a" })
      await writeFile(journalPath(dataDir), `${JSON.stringify({ v: 1, at: "x", run: "run-000001", event: "teleported", id: "q1" })}\n`, { flag: "a" })
      const { events, skipped } = readJournal(dataDir)
      expect(skipped).toBe(3)
      expect(events).toHaveLength(2)
      expect(foldJournal(events).get("run-000001")!.questions.map((question) => question.id)).toEqual(["q1"])
    })
  })

  test("compaction rewrites the journal down to the pending set, and the compacted journal re-folds identically", async () => {
    await withDataDir(async (dataDir) => {
      appendJournal(dataDir, opened("run-000001", "oar_a", "/tmp/one"))
      appendJournal(dataDir, raised("run-000001", "q1", "kept ask"))
      appendJournal(dataDir, raised("run-000001", "q2", "answered ask"))
      appendJournal(dataDir, settled("run-000001", "q2", "answered"))
      appendJournal(dataDir, opened("run-000002", "oar_b", "/tmp/two"))
      appendJournal(dataDir, raised("run-000002", "q1", "degraded ask"))
      appendJournal(dataDir, settled("run-000002", "q1", "timeout"))
      appendJournal(dataDir, opened("run-000003", "oar_c", "/tmp/three"))
      const events = readJournal(dataDir).events
      const restored = foldJournal(events)
      expect([...restored.keys()]).toEqual(["run-000001"])
      compactJournal(dataDir, events, restored)
      const after = readJournal(dataDir)
      expect(after.skipped).toBe(0)
      // Only the surviving run's opened + open raised events remain.
      expect(after.events).toHaveLength(2)
      expect(after.events.map((event) => event.event)).toEqual(["opened", "raised"])
      const refolded = foldJournal(after.events)
      expect([...refolded.keys()]).toEqual(["run-000001"])
      expect(refolded.get("run-000001")!.questions.map((question) => question.id)).toEqual(["q1"])
      // The compacted file carries no secret of a finished run.
      const text = await Bun.file(journalPath(dataDir)).text()
      expect(text).toContain("oar_a")
      expect(text).not.toContain("oar_b")
      expect(text).not.toContain("oar_c")
    })
  })

  test("the journal resolves under the daemon's data directory and never inside a registered project", async () => {
    await withDataDir(async (dataDir) => {
      const store = new DaemonStore(dataDir)
      const project = await mkdtemp(join(tmpdir(), "auto-server-journal-proj-"))
      try {
        store.register(project)
        const path = journalPath(dataDir)
        expect(path).toBe(join(dataDir, QUESTION_JOURNAL_FILE))
        expect(path.startsWith(dataDir)).toBe(true)
        // The containment rule both directions: the journal is not inside
        // any registered project, and no registered project is inside the
        // data directory — daemon-owned state lives in the daemon's own
        // place, never under a target's `.auto/`.
        for (const registered of store.listProjects()) {
          expect(path.startsWith(join(registered.directory, ".auto"))).toBe(false)
          expect(path.startsWith(registered.directory)).toBe(false)
        }
        expect(dataDir.startsWith(project)).toBe(false)
        await mkdir(join(dataDir, "nested"), { recursive: true })
        expect(journalPath(join(dataDir, "nested")).startsWith(project)).toBe(false)
      } finally {
        await rm(project, { recursive: true, force: true })
      }
    })
  })
})
