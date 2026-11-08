// The stats document's schema half (plans/0232 D2, finding 0165-063/S01-05
// — the module, 658 lines, had no direct test import; the store's own suite
// exercises the loader and booking paths, the schema's pure laws rode only
// indirectly): the empty-value constructors' shapes, the lenient per-field
// parse (bad = missing, never a throw — the resume.ts parseProgress mirror),
// the optional sections' absent-when-empty rule (a load→write round trip of
// a document without them changes nothing), the pure copy / add / merge
// functions' no-aliasing and summation laws, and the task-usage ledger
// record's assembly. Pure by design — the module's only import is the
// document domain's decompose-mode vocabulary.
import { describe, expect, test } from "bun:test"
import {
  addUsage,
  CLASSIFY_BUCKET,
  copyTotals,
  emptyBucket,
  emptyDoc,
  emptyModelStat,
  emptyTierStat,
  emptyTotals,
  emptyUsage,
  mergeDigestStats,
  mergeModelStats,
  MAX_TICK,
  parseStatsDoc,
  SYNTHESIS_BUCKET,
  taskStintRecord,
} from "../src/stats-schema"

describe("empty-value constructors", () => {
  test("emptyUsage and emptyTotals are zero fields only; emptyDoc the v:1 skeleton", () => {
    expect(emptyUsage()).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 })
    const totals = emptyTotals()
    expect(totals).toEqual({ aiMs: 0, wallMs: 0, waitMs: 0, sessions: 0, tasks: 0, usage: emptyUsage() })
    // The optional sections are absent, never present-empty: a document
    // nothing books into never gains them.
    expect("models" in totals).toBe(false)
    expect("tiers" in totals).toBe(false)
    expect("quotaWaits" in totals).toBe(false)
    expect("digests" in totals).toBe(false)
    expect(emptyBucket("T-001", 1000)).toEqual({ id: "T-001", since: 1000, ...emptyTotals() })
    const doc = emptyDoc(3, 2000)
    expect(doc.v).toBe(1)
    expect(doc.round).toBe(3)
    expect(doc.roundB.id).toBe("3")
    expect(doc.history).toEqual({ rounds: 0, totals: emptyTotals() })
    expect(doc.sessions).toEqual({})
    expect(doc.lanes).toBeUndefined()
    expect(doc.decompose).toBeUndefined()
  })

  test("the model/tier records' zero shapes; MAX_TICK is thirty minutes; the bucket names", () => {
    expect(emptyModelStat()).toEqual({
      usage: emptyUsage(),
      sessions: 0,
      fails: 0,
      stuckHints: 0,
      reprompts: 0,
      probeFails: 0,
      lengthContinuations: 0,
      stepUps: 0,
    })
    expect(emptyTierStat()).toEqual({ usage: emptyUsage(), sessions: 0 })
    expect(MAX_TICK).toBe(30 * 60_000)
    expect(CLASSIFY_BUCKET).toBe("classify")
    expect(SYNTHESIS_BUCKET).toBe("synthesis")
  })
})

describe("parseStatsDoc (lenient: per-field typeof check, bad = missing, never a throw)", () => {
  test("a minimal document parses with defaults; bad JSON is undefined", () => {
    const doc = parseStatsDoc(`{"round": 2, "phase": "R-01.P01"}`)
    expect(doc).toBeDefined()
    expect(doc!.round).toBe(2)
    expect(doc!.phase).toBe("R-01.P01")
    expect(doc!.taskB).toEqual({ id: "", since: 0, ...emptyTotals() })
    expect(doc!.sessions).toEqual({})
    expect(doc!.history).toEqual({ rounds: 0, totals: expect.objectContaining({ aiMs: 0 }) })
    expect(parseStatsDoc("not json")).toBeUndefined()
    expect(parseStatsDoc('"a string"')).toBeUndefined()
  })

  test("bad fields read as missing, never a throw; the open segment only with a positive at", () => {
    const doc = parseStatsDoc(`{
      "round": "two", "phase": 7, "lastWriteAt": NaN_placeholder_removed,
      "open": { "at": 0, "ai": true },
      "taskB": { "id": 42, "since": "soon", "usage": { "input": "big", "cost": 1.5 } },
      "sessions": { "s1": { "task": "T-001", "aiMs": 10, "rounds": "two", "usage": null } },
      "history": { "rounds": true, "totals": [] }
    }`.replace("NaN_placeholder_removed", "0"))
    expect(doc).toBeDefined()
    expect(doc!.round).toBe(0)
    expect(doc!.phase).toBe("")
    expect(doc!.open).toBeUndefined() // at 0 is no open segment
    expect(doc!.taskB.id).toBe("") // a non-string id falls back
    expect(doc!.taskB.since).toBe(0)
    expect(doc!.taskB.usage).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 1.5, steps: 0 })
    expect(doc!.sessions.s1).toEqual({ task: "T-001", aiMs: 10, wallMs: 0, rounds: 0, usage: emptyUsage(), at: 0 })
    expect(doc!.history.rounds).toBe(0)
    // An open segment with a positive at survives, ai only when true.
    const withOpen = parseStatsDoc(`{"open": {"at": 5, "ai": "yes"}}`)
    expect(withOpen!.open).toEqual({ at: 5, ai: false })
    const withAi = parseStatsDoc(`{"open": {"at": 5, "ai": true}}`)
    expect(withAi!.open).toEqual({ at: 5, ai: true })
  })

  test("the optional sections stay absent when empty, carried when populated — the round-trip law", () => {
    const absent = parseStatsDoc(`{"taskB": {"models": {}, "tiers": {}, "quotaWaits": {}, "digests": {}}}`)
    expect(absent!.taskB.models).toBeUndefined()
    expect(absent!.taskB.tiers).toBeUndefined()
    expect(absent!.taskB.quotaWaits).toBeUndefined()
    expect(absent!.taskB.digests).toBeUndefined()
    expect(absent!.lanes).toBeUndefined()
    expect(absent!.decompose).toBeUndefined()
    const populated = parseStatsDoc(`{
      "taskB": {
        "models": { "glm-4.7": { "usage": {"input": 10}, "sessions": 2, "fails": 1 } },
        "tiers": { "simple": { "usage": {"output": 5}, "sessions": 1 } },
        "quotaWaits": { "glm-4.7": 60000, "dead": 0 },
        "digests": { "priorKnowledge": { "sessions": 1, "tokens": 800 }, "capped": 2, "knowledgePhases": 1 }
      },
      "lanes": { "T-001.S01": { "tokens": 100, "wallMs": 50, "sessions": 1, "booked": true }, "T-002": { "tokens": 1, "wallMs": 1, "sessions": 1, "booked": false } },
      "decompose": { "task": "T-001", "mode": "ondemand", "from": "field", "field": "split", "downgraded": true }
    }`)
    const bucket = populated!.taskB
    expect(bucket.models).toEqual({ "glm-4.7": { usage: expect.objectContaining({ input: 10 }), sessions: 2, fails: 1, stuckHints: 0, reprompts: 0, probeFails: 0, lengthContinuations: 0, stepUps: 0 } })
    expect(bucket.tiers).toEqual({ simple: { usage: expect.objectContaining({ output: 5 }), sessions: 1 } })
    expect(bucket.quotaWaits).toEqual({ "glm-4.7": 60000 }) // a zero wait is dropped
    expect(bucket.digests).toEqual({ priorKnowledge: { sessions: 1, tokens: 800 }, capped: 2, knowledgePhases: 1 })
    expect(populated!.lanes!["T-001.S01"]).toEqual({ tokens: 100, wallMs: 50, sessions: 1, booked: true })
    expect(populated!.lanes!["T-002"]).toEqual({ tokens: 1, wallMs: 1, sessions: 1 })
    // booked survives a round trip only when true (the S4 marker of a
    // detail-bearing report).
    expect("booked" in populated!.lanes!["T-002"]).toBe(false)
    expect(populated!.decompose).toEqual({ task: "T-001", mode: "ondemand", from: "field", field: "split", downgraded: true })
    // The load→write round trip: parse(serialize(parse(doc))) is the same
    // document — the absent-when-empty rule keeps the persisted shape
    // byte-stable.
    const again = parseStatsDoc(JSON.stringify(populated))
    expect(again).toEqual(populated)
  })

  test("a bad decompose record reads as missing (the enum fields survive only with a legal value)", () => {
    for (const bad of [
      `{ "task": "", "mode": "off", "from": "field" }`, // no task
      `{ "task": "T-001", "mode": "sometimes", "from": "field" }`, // not a mode word
      `{ "task": "T-001", "mode": "off", "from": "nowhere" }`, // not a source
    ]) {
      expect(parseStatsDoc(`{"decompose": ${bad}}`)!.decompose).toBeUndefined()
    }
    // field survives only with a legal decompose mode; downgraded only when true.
    const field = parseStatsDoc(`{"decompose": {"task": "T-001", "mode": "auto", "from": "fallback", "field": "not-a-mode", "downgraded": 1}}`)!.decompose
    expect(field).toEqual({ task: "T-001", mode: "auto", from: "fallback" })
    expect("field" in field!).toBe(false)
    expect("downgraded" in field!).toBe(false)
  })

  test("the stint-identity stamp: carried when present, absent stays absent; phaseB/roundB may carry it too", () => {
    const stamped = parseStatsDoc(`{"taskB": {"id": "T-001", "phase": "R-01.P02", "round": 3}, "roundB": {"id": "3", "round": 3}}`)
    expect(stamped!.taskB.phase).toBe("R-01.P02")
    expect(stamped!.taskB.round).toBe(3)
    expect(stamped!.roundB.round).toBe(3)
    const plain = parseStatsDoc(`{"taskB": {"id": "T-001"}}`)!
    expect("phase" in plain.taskB).toBe(false)
    expect("round" in plain.taskB).toBe(false)
  })
})

describe("addUsage / copyTotals (pure aggregation over the shapes)", () => {
  test("addUsage sums per field, a bad delta field adding zero", () => {
    const target = emptyUsage()
    addUsage(target, { input: 10, output: 5, reasoning: 1, cacheRead: 2, cacheWrite: 3, cost: 0.5, steps: 2 })
    addUsage(target, { input: 1, output: Number.NaN, cacheRead: "no" } as unknown as Parameters<typeof addUsage>[1])
    expect(target).toEqual({ input: 11, output: 5, reasoning: 1, cacheRead: 2, cacheWrite: 3, cost: 0.5, steps: 2 })
  })

  test("copyTotals deep-copies every interior — mutating the copy never touches the original", () => {
    const totals: Parameters<typeof copyTotals>[0] = {
      ...emptyTotals(),
      aiMs: 100,
      models: { m: { ...emptyModelStat(), sessions: 2 } },
      tiers: { t: { ...emptyTierStat(), sessions: 1 } },
      quotaWaits: { m: 5 },
      digests: { prevRound: { sessions: 1, tokens: 10 }, capped: 1 },
    }
    const copy = copyTotals(totals)
    expect(copy).toEqual(totals)
    copy.usage.input = 999
    copy.models!.m.sessions = 999
    copy.models!.m.usage.input = 999
    copy.tiers!.t.sessions = 999
    copy.quotaWaits!.m = 999
    copy.digests!.prevRound!.sessions = 999
    copy.digests!.capped = 999
    expect(totals.usage.input).toBe(0)
    expect(totals.models!.m.sessions).toBe(2)
    expect(totals.models!.m.usage.input).toBe(0)
    expect(totals.tiers!.t.sessions).toBe(1)
    expect(totals.quotaWaits!.m).toBe(5)
    expect(totals.digests!.prevRound!.sessions).toBe(1)
    expect(totals.digests!.capped).toBe(1)
  })
})

describe("mergeModelStats / mergeDigestStats (history aggregation at round rollover)", () => {
  test("sections are created lazily and summed; an aggregate with no data stays without them", () => {
    const into = emptyTotals()
    mergeModelStats(into, emptyTotals())
    mergeDigestStats(into, emptyTotals())
    expect("models" in into).toBe(false)
    expect("tiers" in into).toBe(false)
    expect("quotaWaits" in into).toBe(false)
    expect("digests" in into).toBe(false)
    // The merge functions' inputs are fully-shaped records — a parsed
    // bucket or a store-built one (emptyModelStat & co.), never a partial
    // hand-built object: the counters sum with plain +=, leniency being
    // addUsage's own letter (its booking points feed in-memory values).
    const from: Parameters<typeof mergeModelStats>[1] = {
      ...emptyTotals(),
      models: {
        m: { ...emptyModelStat(), usage: { ...emptyUsage(), input: 10 }, sessions: 1, fails: 1, stepUps: 2 },
      },
      tiers: { t: { ...emptyTierStat(), usage: { ...emptyUsage(), output: 4 }, sessions: 1 } },
      quotaWaits: { m: 60000 },
      digests: { priorKnowledge: { sessions: 1, tokens: 500 }, capped: 1 },
    }
    mergeModelStats(into, from)
    mergeDigestStats(into, from)
    mergeModelStats(into, from) // a second round's identical bucket accumulates
    mergeDigestStats(into, from)
    expect(into.models!.m).toEqual({ usage: expect.objectContaining({ input: 20 }), sessions: 2, fails: 2, stuckHints: 0, reprompts: 0, probeFails: 0, lengthContinuations: 0, stepUps: 4 })
    expect(into.tiers!.t).toEqual({ usage: expect.objectContaining({ output: 8 }), sessions: 2 })
    expect(into.quotaWaits).toEqual({ m: 120000 })
    expect(into.digests).toEqual({ priorKnowledge: { sessions: 2, tokens: 1000 }, capped: 2 })
  })
})

describe("taskStintRecord (the task-usage ledger record, plans/0152 / 0212 D5)", () => {
  test("assembled from the closing bucket: the stint's own stamp with the close-moment fallback, the session log ordered by at, no aliasing", () => {
    const doc = emptyDoc(2, 9000)
    doc.phase = "R-02.P05"
    doc.taskB = {
      ...emptyBucket("T-042", 1000),
      aiMs: 500,
      wallMs: 800,
      waitMs: 50,
      sessions: 2,
      tasks: 1,
      phase: "R-01.P04",
      round: 1,
      models: { m: { ...emptyModelStat(), sessions: 2 } },
    }
    doc.sessions = {
      s_late: { task: "T-042", aiMs: 100, wallMs: 200, rounds: 1, usage: { ...emptyUsage(), input: 5 }, at: 8000 },
      s_early: { task: "T-042", aiMs: 400, wallMs: 600, rounds: 3, usage: { ...emptyUsage(), input: 7 }, at: 3000, model: "m", tier: "deep" },
    }
    const record = taskStintRecord(doc, 9000)
    // The stint's own phase/round stamp (0212 D5), not the close-moment doc
    // values (which name the next context after the boundary moved).
    expect(record.phase).toBe("R-01.P04")
    expect(record.round).toBe(1)
    expect(record.task).toBe("T-042")
    expect(record.since).toBe(1000)
    expect(record.at).toBe(9000)
    expect(record.aiMs).toBe(500)
    expect(record.usage.input).toBe(0)
    expect(record.models).toEqual({ m: { usage: emptyUsage(), sessions: 2, fails: 0, stuckHints: 0, reprompts: 0, probeFails: 0, lengthContinuations: 0, stepUps: 0 } })
    expect(record.sessionLog.map((entry) => entry.session)).toEqual(["s_early", "s_late"])
    expect(record.sessionLog[0]).toMatchObject({ model: "m", tier: "deep", task: "T-042" })
    // No aliasing: mutating the record's interiors never touches the doc.
    record.usage.input = 999
    record.models!.m.sessions = 999
    record.sessionLog[0].usage.input = 999
    expect(doc.taskB.usage.input).toBe(0)
    expect(doc.taskB.models!.m.sessions).toBe(2)
    expect(doc.sessions.s_early.usage.input).toBe(7)
  })

  test("an older document without the stamp falls back to the close-moment phase/round", () => {
    const doc = emptyDoc(4, 9000)
    doc.phase = "R-04.P01"
    doc.taskB = emptyBucket("T-001", 1000)
    const record = taskStintRecord(doc, 9000)
    expect(record.phase).toBe("R-04.P01")
    expect(record.round).toBe(4)
    expect(record.models).toBeUndefined()
    expect(record.sessionLog).toEqual([])
  })
})
