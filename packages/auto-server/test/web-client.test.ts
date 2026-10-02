// The Web client's pure modules (T-096, P4a): the vocabularies and helpers
// under web/ that carry the client's honesty rules, pinned where they live —
// no page is scraped, the assertions read the same code the browser runs.
//   - the run-state vocabulary: the exit-code mapping spelled for a human
//     ("paused" IS the resumable state, "blocked" the needs-a-human one);
//   - the frozen-flag boundary is UI-enforced: the start form's fields are
//     exactly the per-run RunAllOpts keys — checked against the daemon's own
//     CONFIG_KEYS (src/request.ts), the vocabulary the daemon refuses;
//   - the completion display: done marks come from the read model's commit
//     verdicts only, and the Closed: distinction renders without collapsing
//     (closed = done for scheduling, not delivered);
//   - the SSE grammar: the wire format's own parser (the streams' content is
//     delivered verbatim — the parser must never need to understand it).
import { describe, expect, test } from "bun:test"
import { CONFIG_KEYS, HAND_EDITED_KEYS } from "../src/request"
import { buildStartOptions, buildSwitches, capabilitiesOf, closedNote, isLiveState, isTerminalState, START_OPTION_FIELDS, stateLabel, verdictBanner, verdictRows } from "../web/render"
import { parseSseBlock, splitSseBlocks } from "../web/sse"

describe("web client: the run-state vocabulary", () => {
  test("terminal states spell the exit-code vocabulary; paused is the resumable state, blocked the needs-a-human one", () => {
    expect(stateLabel("completed")).toBe("completed")
    expect(stateLabel("failed")).toBe("failed")
    expect(stateLabel("blocked")).toContain("needs a human")
    expect(stateLabel("paused")).toContain("resumable")
    expect(stateLabel("killed")).toBe("killed")
    expect(stateLabel("restored")).toContain("daemon restart")
    expect(isTerminalState("paused")).toBe(true)
    expect(isTerminalState("restored")).toBe(false)
    expect(isLiveState("starting")).toBe(true)
    expect(isLiveState("running")).toBe(true)
    expect(isLiveState("paused")).toBe(false)
  })
})

describe("web client: the frozen-flag boundary is UI-enforced", () => {
  test("the start form offers exactly the per-run RunAllOpts keys — never a config key", () => {
    const keys = START_OPTION_FIELDS.map((field) => field.key)
    expect([...keys].sort()).toEqual(["dryrun", "maxSessions", "newSession", "permission", "server", "verbose", "waitAnswer", "waitBetween"])
    // The daemon's frozen vocabulary — every constitutional config key, both
    // spellings, and the hand-edited-only pair — has no field on the form.
    for (const key of Object.keys(CONFIG_KEYS)) expect(keys).not.toContain(key)
    for (const key of HAND_EDITED_KEYS) expect(keys).not.toContain(key)
  })

  test("the options builder validates like the request it builds", () => {
    expect(buildStartOptions({})).toEqual({})
    expect(buildStartOptions({ verbose: "true", waitBetween: "2", permission: "ask-allow", server: "http://localhost:1" })).toEqual({ verbose: true, waitBetween: 2, permission: "ask-allow", server: "http://localhost:1" })
    expect(() => buildStartOptions({ waitBetween: "61" })).toThrow("0..60")
    expect(() => buildStartOptions({ permission: "yolo" })).toThrow("ask-allow")
    expect(() => buildStartOptions({ verbose: "yes" })).toThrow("true|false")
    expect(() => buildStartOptions({ maxSessions: "0" })).toThrow("positive integer")
  })

  test("the switch layer takes OPENCODE_AUTO_* names only — a config key cannot even be spelled", () => {
    expect(buildSwitches([{ name: "OPENCODE_AUTO_AGENT", value: "claude" }, { name: "", value: "ignored" }])).toEqual({ OPENCODE_AUTO_AGENT: "claude" })
    // A constitutional config key offered as a "switch" is refused by the
    // client before the daemon ever sees it (the daemon's registry check is
    // the second gate; the prefix rule is the first).
    expect(() => buildSwitches([{ name: "mode", value: "m" }])).toThrow("frozen by init")
    expect(buildSwitches([{ name: "OPENCODE_AUTO_AGENT", value: "" }])).toEqual({ OPENCODE_AUTO_AGENT: "" })
  })
})

describe("web client: scope-awareness is typed, not parsed", () => {
  test("capabilitiesOf gates the UI tiers", () => {
    expect(capabilitiesOf(["read"])).toEqual({ read: true, control: false, answer: false, config: false, probe: false })
    expect(capabilitiesOf(["read", "control", "answer"])).toMatchObject({ read: true, control: true, answer: true })
    expect(capabilitiesOf([])).toMatchObject({ read: false })
  })
})

describe("web client: completion renders from commit verdicts only", () => {
  const verdicts = {
    rule: "commit-is-completion",
    worktree: "clean" as const,
    phases: [
      { id: "R-01.P01", label: "P01 implement", done: false, closed: null, current: true },
      { id: "R-01.P02", label: "P02 verify", done: true, closed: "delivered in the release train", current: false },
    ],
    tasks: [
      { id: "T-001", phase: "R-01.P01", title: "the widget", status: "done" as const, done: true, closed: null, attempts: 1, subtasks: [{ text: "alpha", done: true }, { text: "beta", done: false }] },
      { id: "T-002", phase: "R-01.P01", title: "the closed one", status: "done" as const, done: true, closed: "superseded by T-001", attempts: 1, subtasks: [] },
      { id: "T-003", phase: "R-01.P01", title: "the live one", status: "in_progress" as const, done: false, closed: null, attempts: 2, subtasks: [] },
      { id: "T-004", phase: "R-01.P01", title: "the stuck one", status: "blocked" as const, done: false, closed: null, attempts: 1, subtasks: [] },
      { id: "T-005", phase: "R-01.P02", title: "done last phase", status: "done" as const, done: true, closed: null, attempts: 1, subtasks: [] },
    ],
    problems: [],
  }

  test("every done mark carries the verdict; the mark vocabulary is the core's own", () => {
    const rows = verdictRows(verdicts)
    expect(rows).toHaveLength(7)
    const marks = new Map(rows.map((row) => [row.kind === "phase" ? row.id : row.id, row.mark]))
    expect(marks.get("T-001")).toBe("✓")
    expect(marks.get("T-002")).toBe("⊘") // closed overrides ✓ the way the core's tree marks it
    expect(marks.get("T-003")).toBe("▶")
    expect(marks.get("T-004")).toBe("⏸")
    expect(marks.get("R-01.P02")).toBe("⊘") // a closed phase, done for scheduling
    const done = rows.filter((row) => row.kind === "task" && row.done)
    expect(done.map((row) => row.id).sort()).toEqual(["T-001", "T-002", "T-005"])
  })

  test("the Closed: distinction says both facts instead of collapsing them", () => {
    expect(closedNote("superseded by T-001")).toContain("done for scheduling, not delivered")
    expect(closedNote("superseded by T-001")).toContain("superseded by T-001")
    expect(closedNote(null)).toBeNull()
    // A closed unit is done (the verdict) AND closed (the distinction) —
    // the row keeps done: true with the ⊘ mark, exactly the core's rule.
    const closed = verdictRows(verdicts).find((row) => row.id === "T-002")!
    expect(closed.kind === "task" && closed.done).toBe(true)
    expect(closed.mark).toBe("⊘")
  })

  test("a dirty worktree unsettles the banner — git is the record", () => {
    expect(verdictBanner({ ...verdicts, worktree: "dirty" })).toContain("unsettled")
    expect(verdictBanner(verdicts)).toContain("commit")
  })
})

describe("web client: the SSE grammar", () => {
  test("one block: event, multi-line data, id; comments are keep-alives", () => {
    expect(parseSseBlock("event: line\ndata: hello")).toEqual({ event: "line", data: "hello" })
    expect(parseSseBlock("data: a\ndata: b")).toEqual({ event: "message", data: "a\nb" })
    expect(parseSseBlock("event: status-event\nid: 7\ndata: {\"type\":\"run\"}")).toEqual({ event: "status-event", data: '{"type":"run"}', id: 7 })
    expect(parseSseBlock(": keep-alive")).toBeNull()
    expect(parseSseBlock("event: tail")).toBeNull() // no data line: nothing delivered
    // The field colon is optional and one space after it is skipped (the
    // spec's own tolerances; the daemon writes the canonical form).
    expect(parseSseBlock("data:nospace")).toEqual({ event: "message", data: "nospace" })
    expect(parseSseBlock("event: x\r\ndata: y\r\n")).toEqual({ event: "x", data: "y" })
  })

  test("a growing byte stream splits at blank-line boundaries; a torn tail is held", () => {
    expect(splitSseBlocks("data: a\n\ndata: b")).toEqual({ blocks: ["data: a"], rest: "data: b" })
    expect(splitSseBlocks("data: a\n\ndata: b\n\n")).toEqual({ blocks: ["data: a", "data: b"], rest: "" })
    expect(splitSseBlocks("data: mid")).toEqual({ blocks: [], rest: "data: mid" })
    expect(splitSseBlocks("data: a\r\n\r\ndata: b\r\n\r\n")).toEqual({ blocks: ["data: a", "data: b"], rest: "" })
  })
})
