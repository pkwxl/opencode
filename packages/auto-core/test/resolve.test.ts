import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  collectAgentResolves,
  decisionsOf,
  parseResolveLine,
  recordDecisions,
  recordResolves,
  resolveHighlight,
  resolvesOf,
  sameIssue,
  setResolveClock,
  type ResolveDoc,
  type ResolveItem,
} from "../src/resolve"

// T-004 coverage: all of src/resolve.ts (marker parsing / ledger persistence / session
// close-out scan / read-back / highlight block). Cases for the driver-side collection
// wiring (H1..H4) are added in T-005's test/runner.test.ts.

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

function driverItem(question: string, over: Partial<ResolveItem> = {}): ResolveItem {
  return { at: 1, task: "T-001", phase: "m", round: 1, source: "driver", question, ...over }
}

function agentItem(question: string, over: Partial<ResolveItem> = {}): ResolveItem {
  return { at: 1, task: "T-001", phase: "m", round: 1, source: "agent", question, ...over }
}

describe("parseResolveLine", () => {
  test("full three-part line: question / chosen option / reason", () => {
    expect(parseResolveLine("AUTO-RESOLVE: fold in the third formatTokens copy too -> fold it in (same layer)")).toEqual({
      question: "fold in the third formatTokens copy too",
      option: "fold it in",
      reason: "same layer",
    })
  })

  test("three arrow spellings are equivalent, and full-width Chinese parentheses parse the same", () => {
    const arrows = ["->", "→", "=>"]
    for (const arrow of arrows) {
      expect(parseResolveLine(`AUTO-RESOLVE: question ${arrow} option（reason）`)).toEqual({
        question: "question",
        option: "option",
        reason: "reason",
      })
    }
  })

  test("inline prefixes (code comment / markdown list item / backtick-wrapped) are equally valid", () => {
    expect(parseResolveLine("// AUTO-RESOLVE: question -> option (reason)")?.question).toBe("question")
    expect(parseResolveLine("- **AUTO-RESOLVE**: question -> option (reason)")?.question).toBe("question")
    expect(parseResolveLine("`AUTO-RESOLVE: question -> option (reason)`")).toEqual({
      question: "question",
      option: "option",
      reason: "reason",
    })
  })

  test("no arrow: the whole line becomes the question and it is flagged malformed (still counted)", () => {
    expect(parseResolveLine("AUTO-RESOLVE: does the acceptance basis cover concurrency")).toEqual({
      question: "does the acceptance basis cover concurrency",
      malformed: true,
    })
  })

  test("no reason part: the chosen option is kept and it is flagged malformed", () => {
    expect(parseResolveLine("AUTO-RESOLVE: question -> option")).toEqual({
      question: "question",
      option: "option",
      reason: undefined,
      malformed: true,
    })
  })

  test("no marker / empty body / pure placeholder sample line return undefined", () => {
    expect(parseResolveLine("AUTO-DECISION: call the new field matched or paired (no visible behavior change)")).toBeUndefined()
    expect(parseResolveLine("this line has no marker")).toBeUndefined()
    expect(parseResolveLine("AUTO-RESOLVE:")).toBeUndefined()
    expect(parseResolveLine("AUTO-RESOLVE: <question> -> <option> (<reason>)")).toBeUndefined()
  })
})

describe("sameIssue", () => {
  test("equal after normalization, or either a substring of the other, counts as the same question", () => {
    expect(sameIssue("fold  it in?", "fold it in?")).toBe(true)
    expect(sameIssue("fold it in", "please fold it in for the third formatTokens copy")).toBe(true)
    expect(sameIssue("is depreciation clamped", "does the acceptance basis include concurrency")).toBe(false)
  })
})

describe("ledger persistence", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-"))
    setResolveClock(() => 1_000)
  })

  afterEach(async () => {
    setResolveClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<ResolveDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "resolves.json")).text()) as ResolveDoc
  }

  test("dir === undefined is all no-op", async () => {
    await recordResolves(undefined, [driverItem("question")])
    expect(await resolvesOf(undefined, "task", "T-001")).toEqual([])
    expect(await collectAgentResolves(undefined, { task: "T-001" })).toEqual({ resolves: 0, decisions: 0 })
  })

  test("round trip: after recording, items read back by task", async () => {
    await recordResolves(dir, [driverItem("fold it in", { session: "ses_1" })])
    const doc = await readDoc()
    expect(doc.v).toBe(1)
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0]).toMatchObject({ task: "T-001", source: "driver", question: "fold it in", session: "ses_1" })
    expect(await resolvesOf(dir, "task", "T-001")).toHaveLength(1)
  })

  test("dedupe: the same question from the same source and task is recorded once; missing fields are filled in", async () => {
    await recordResolves(dir, [agentItem("fold  it  in")])
    await recordResolves(dir, [agentItem("fold it in", { option: "fold it in", reason: "same layer" })])
    const doc = await readDoc()
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0]).toMatchObject({ option: "fold it in", reason: "same layer" })
  })

  test("the same question from driver and agent leaves one item each (different sources are different items)", async () => {
    await recordResolves(dir, [driverItem("fold it in"), agentItem("fold it in")])
    expect((await readDoc()).items).toHaveLength(2)
  })

  test("lenient on a corrupt file: non-JSON / entries with bad fields do not throw, the ledger restarts from now", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await writeFile(join(dir, ".auto", "resolves.json"), "{ this is not JSON")
    await recordResolves(dir, [driverItem("question one")])
    expect((await readDoc()).items).toHaveLength(1)

    await writeFile(
      join(dir, ".auto", "resolves.json"),
      JSON.stringify({ v: 1, items: [null, { question: 42 }, { question: "valid entry", at: "bad", round: "bad" }] }),
    )
    await recordResolves(dir, [driverItem("question two")])
    const items = (await readDoc()).items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ question: "valid entry", at: 0, round: 0, source: "driver" })
  })

  test("cap of 512 items total, FIFO evicts the oldest", async () => {
    await recordResolves(
      dir,
      Array.from({ length: 520 }, (_, i) => driverItem(`question ${i}`)),
    )
    const items = (await readDoc()).items
    expect(items).toHaveLength(512)
    expect(items[0]!.question).toBe("question 8")
    expect(items.at(-1)!.question).toBe("question 519")
  })

  test("concurrent writes: no item lost and no .tmp leftovers", async () => {
    await Promise.all([
      recordResolves(dir, [driverItem("question one")]),
      recordResolves(dir, [driverItem("question two")]),
      recordResolves(dir, [driverItem("question three")]),
    ])
    expect((await readDoc()).items).toHaveLength(3)
    expect((await readdir(join(dir, ".auto"))).filter((name) => name.includes(".tmp"))).toEqual([])
  })

  test("resolvesOf filters by the three scopes; empty id is guarded to empty", async () => {
    await recordResolves(dir, [
      driverItem("question 1", { task: "T-001", phase: "m", round: 1 }),
      driverItem("question 2", { task: "T-002", phase: "t", round: 1 }),
      driverItem("question 3", { task: "T-003", phase: "m", round: 2 }),
    ])
    expect((await resolvesOf(dir, "task", "T-002")).map((item) => item.question)).toEqual(["question 2"])
    expect((await resolvesOf(dir, "phase", "m")).map((item) => item.question)).toEqual(["question 1", "question 3"])
    expect((await resolvesOf(dir, "round", 1)).map((item) => item.question)).toEqual(["question 1", "question 2"])
    expect(await resolvesOf(dir, "phase", "")).toEqual([])
  })
})

describe("collectAgentResolves", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-scan-"))
    setResolveClock(() => 2_000)
  })

  afterEach(async () => {
    setResolveClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readItems(): Promise<ResolveItem[]> {
    const raw = await Bun.file(join(dir, ".auto", "resolves.json")).text().catch(() => undefined)
    return raw ? (JSON.parse(raw) as ResolveDoc).items : []
  }

  test("non-git directory: no-op without error and nothing recorded", async () => {
    await writeFile(join(dir, "note.md"), "AUTO-RESOLVE: question -> option (reason)\n")
    expect(await collectAgentResolves(dir, { task: "T-001", phase: "m", round: 1 })).toEqual({
      resolves: 0,
      decisions: 0,
    })
    expect(await readItems()).toEqual([])
  })

  test("AUTO-RESOLVE is recorded with path:line; AUTO-DECISION only counts, never recorded", async () => {
    await git(dir, "init", "-q")
    await writeFile(
      join(dir, "note.md"),
      ["# report", "", "- AUTO-RESOLVE: should we fold it in -> fold it in (same layer)", "- AUTO-DECISION: name the field matched (consistent with the schema)", ""].join("\n"),
    )
    await writeFile(join(dir, "code.ts"), "// AUTO-DECISION: scan line by line with a regex (same order of cost as refcheck)\n")
    const counts = await collectAgentResolves(dir, { task: "T-001", phase: "m", round: 1 })
    expect(counts).toEqual({ resolves: 1, decisions: 2 })
    const items = await readItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: "agent",
      task: "T-001",
      phase: "m",
      round: 1,
      question: "should we fold it in",
      option: "fold it in",
      reason: "same layer",
      file: "note.md:3",
    })
  })

  test("binary files and files over 2MB are skipped", async () => {
    await git(dir, "init", "-q")
    await Bun.write(join(dir, "blob.bin"), new Uint8Array([65, 0, 66, 67]))
    await writeFile(join(dir, "huge.md"), `AUTO-RESOLVE: question in a huge file -> option (reason)\n${"x".repeat(2 * 1024 * 1024)}`)
    expect(await collectAgentResolves(dir, { task: "T-001", round: 1 })).toEqual({ resolves: 0, decisions: 0 })
    expect(await readItems()).toEqual([])
  })

  test("changes in a nested repository are collected too", async () => {
    await git(dir, "init", "-q")
    await mkdir(join(dir, "pkg"), { recursive: true })
    await git(join(dir, "pkg"), "init", "-q")
    await writeFile(join(dir, "pkg", "inner.md"), "AUTO-RESOLVE: question inside the nested repo -> option (reason)\n")
    const counts = await collectAgentResolves(dir, { task: "T-001", round: 1 })
    expect(counts.resolves).toBe(1)
    expect((await readItems())[0]).toMatchObject({ question: "question inside the nested repo", file: join("pkg", "inner.md") + ":1" })
  })

  test("driver items pair up via sameIssue and get matched; unpaired ones stay unmarked", async () => {
    await git(dir, "init", "-q")
    await recordResolves(dir, [
      driverItem("fold the third formatTokens copy in too?"),
      driverItem("does the acceptance basis cover concurrency?"),
    ])
    await writeFile(join(dir, "report.md"), "AUTO-RESOLVE: fold the third formatTokens copy in too -> fold it in (same layer)\n")
    await collectAgentResolves(dir, { task: "T-001", phase: "m", round: 1 })
    const items = await readItems()
    const driver = items.filter((item) => item.source === "driver")
    expect(driver.find((item) => item.question.includes("formatTokens"))!.matched).toBe(true)
    expect(driver.find((item) => item.question.includes("concurrency"))!.matched).toBeUndefined()
  })
})

describe("resolveHighlight", () => {
  test("empty list returns empty (no proxy answers, no space taken)", () => {
    expect(resolveHighlight([])).toEqual([])
    expect(resolveHighlight([driverItem("question", { matched: true })])).toEqual([])
  })

  test("task block: pinned title + per-item option and reason + marker location + report pointer", () => {
    const lines = resolveHighlight([
      agentItem("fold in the third formatTokens copy too", {
        option: "fold it in",
        reason: "same layer, no reverse import",
        file: "src/prompt.ts:501",
      }),
    ])
    expect(lines[0]).toBe("⚑ this task auto-answered 1 questions that should have been confirmed by you; please review:")
    expect(lines[1]).toBe("  1. fold in the third formatTokens copy too → fold it in(same layer, no reverse import)")
    expect(lines[2]).toBe("     src/prompt.ts:501")
    expect(lines[3]).toBe(`  full record in the "Proxy-answered questions" section of ${join("docs", "T-001", "report.md")}`)
  })

  test("unpaired driver items and malformed agent items each carry a ⚠", () => {
    const lines = resolveHighlight([
      driverItem("does the acceptance basis cover concurrency"),
      agentItem("is depreciation clamped the same way", { malformed: true }),
    ])
    expect(lines[1]).toContain("⚠ session did not write the AUTO-RESOLVE marker as required")
    expect(lines[2]).toContain("⚠ malformed marker")
  })

  test("over 8 items lists only the first 8; the last line gives the remainder count and report path", () => {
    const items = Array.from({ length: 11 }, (_, i) => agentItem(`question ${i}`, { option: "option", reason: "reason" }))
    const lines = resolveHighlight(items)
    expect(lines[0]).toContain("11 questions")
    expect(lines).toHaveLength(1 + 8 + 1)
    expect(lines.at(-1)).toBe(`  …and 3 more, all in ${join("docs", "T-001", "report.md")}`)
  })

  test("the AUTO-DECISION count folds into the last line; an over-long question is flattened to one line with an ellipsis", () => {
    const long = "q".repeat(120)
    const lines = resolveHighlight([agentItem(`${long}\nnewlines flatten too`, { option: "option", reason: "reason" })], {
      decisions: 5,
    })
    expect(lines[1]).toContain("…")
    expect(lines[1]).not.toContain("\n")
    expect(lines.at(-1)).toBe("  plus 5 AUTO-DECISION entries (folded, see task report)")
  })

  test("phase/round summaries give one count line; unmarked items are called out", () => {
    const items = [
      agentItem("question 1", { option: "option", reason: "reason" }),
      driverItem("question 2"),
      agentItem("question 3", { option: "option", reason: "reason" }),
    ]
    expect(resolveHighlight(items, { scope: "phase", id: "m" })).toEqual([
      "⚑ phase m: 3 questions awaiting confirmation were auto-answered (1 not marked as required); see task reports for details",
    ])
    expect(resolveHighlight([agentItem("question 1", { option: "option", reason: "reason" })], { scope: "round", id: 2 })).toEqual([
      "⚑ round 2: 1 questions awaiting confirmation were auto-answered; see task reports for details",
    ])
  })
})

// T-006 addition: per-task AUTO-DECISION counting (the folded number on the highlight
// block's last line). Line-level detail is never recorded — only one integer per task.
describe("AUTO-DECISION counting", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-count-"))
    setResolveClock(() => 2_000)
  })

  afterEach(async () => {
    setResolveClock()
    await rm(dir, { recursive: true, force: true })
  })

  test("accumulates per task without cross-talk; no-op when dir/task missing or the count is not positive", async () => {
    await recordDecisions(dir, "T-001", 2)
    await recordDecisions(dir, "T-001", 3)
    await recordDecisions(dir, "T-002", 1)
    expect(await decisionsOf(dir, "T-001")).toBe(5)
    expect(await decisionsOf(dir, "T-002")).toBe(1)
    expect(await decisionsOf(dir, "T-003")).toBe(0)
    await recordDecisions(dir, "T-001", 0)
    await recordDecisions(dir, "", 4)
    await recordDecisions(undefined, "T-001", 4)
    expect(await decisionsOf(dir, "T-001")).toBe(5)
    expect(await decisionsOf(undefined, "T-001")).toBe(0)
  })

  test("the scan lands counts and markers in the same write", async () => {
    await git(dir, "init", "-q")
    await writeFile(
      join(dir, "report.md"),
      [
        "AUTO-RESOLVE: narrow the scope -> no (the plan already fixes it)",
        "AUTO-DECISION: name the new field matched (same word as the schema comment)",
        "AUTO-DECISION: scan line by line with a regex (same order of cost as refcheck)",
      ].join("\n"),
    )
    expect(await collectAgentResolves(dir, { task: "T-007", phase: "m", round: 1 })).toEqual({
      resolves: 1,
      decisions: 2,
    })
    expect(await decisionsOf(dir, "T-007")).toBe(2)
    expect((await resolvesOf(dir, "task", "T-007")).map((item) => item.question)).toEqual(["narrow the scope"])
    // A second scan (the same changes still uncommitted) accumulates the counts; the
    // marker side is absorbed by the dedupe key — an inflated count under `--commit false`
    // is an accepted boundary (plans/0020-auto-resolve-design.md §K).
    await collectAgentResolves(dir, { task: "T-007", phase: "m", round: 1 })
    expect(await decisionsOf(dir, "T-007")).toBe(4)
    expect(await resolvesOf(dir, "task", "T-007")).toHaveLength(1)
  })

  test("lenient on corrupt counts: non-object / negative / non-numeric values skip per key, items still read back", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(
      join(dir, ".auto", "resolves.json"),
      JSON.stringify({
        v: 1,
        items: [agentItem("question", { option: "option", reason: "reason" })],
        decisions: { "T-001": -3, "T-002": "five", "T-003": 4.7, "": 9 },
      }),
    )
    expect(await decisionsOf(dir, "T-001")).toBe(0)
    expect(await decisionsOf(dir, "T-002")).toBe(0)
    expect(await decisionsOf(dir, "T-003")).toBe(4)
    expect(await resolvesOf(dir, "task", "T-001")).toHaveLength(1)
  })
})
