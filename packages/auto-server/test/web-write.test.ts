// The Web client's write surface, pure modules (T-097, P4b): the
// vocabularies and builders under web/render.ts that carry the write
// surface's constitution, pinned where they live — no page is scraped, the
// assertions read the same code the browser runs:
//   - the scope matrix: every write surface the UI can build is gated on
//     its scope (control / config / probe), and a token without the scope
//     sees NONE of it — the daemon's needScope is the authority, the client
//     simply never offers what the token cannot do;
//   - the two-step gate flow: confirm and clean-tree are two SEPARATE
//     steps, each answer adds exactly its own request field, and no request
//     the client can build ever bundles both before both gates asked (the
//     CLI's -f bundling is history, not API semantics);
//   - the request builders: each produces exactly the daemon's vocabulary,
//     refusing one hop early the shapes the daemon would 400 — including
//     the frozen-flag boundary (no config key rides a run, no hand-edited
//     key rides the config form);
//   - the probe's two-step admin act: nothing is buildable before scope +
//     arm + confirm, and the words spell what firing means.
import { describe, expect, test } from "bun:test"
import { CONFIG_KEYS, HAND_EDITED_KEYS } from "../src/request"
import {
  answerGate,
  buildCloseRequest,
  buildConfigRequest,
  buildPlanRequest,
  buildProbeRequest,
  buildTaskRequest,
  capabilitiesOf,
  CONFIG_FIELDS,
  gateOf,
  gateText,
  GATE_STEP_WORDS,
  PROBE_WORDS,
  surfaceVisible,
  WRITE_SURFACES,
} from "../web/render"

describe("web write surface: the scope matrix is the UI's own routing table", () => {
  test("every write surface names its scope; the read-only token sees none of them", () => {
    expect(WRITE_SURFACES.map((entry) => [entry.surface, entry.scope])).toEqual([
      ["start-run", "control"],
      ["close-unit", "control"],
      ["task-add", "control"],
      ["plan", "control"],
      ["config-init", "config"],
      ["config-amend", "config"],
      ["config-fix", "config"],
      ["config-reset", "config"],
      ["model-probe", "probe"],
    ])
    const read = capabilitiesOf(["read"])
    for (const entry of WRITE_SURFACES) expect(surfaceVisible(read, entry.surface)).toBe(false)
    // unknown surfaces are never visible
    expect(surfaceVisible(read, "no-such-surface" as never)).toBe(false)
  })

  test("each scope opens exactly its own tier: control the units, config the config ops, probe the probe alone", () => {
    const control = capabilitiesOf(["control"])
    expect(surfaceVisible(control, "close-unit")).toBe(true)
    expect(surfaceVisible(control, "task-add")).toBe(true)
    expect(surfaceVisible(control, "plan")).toBe(true)
    expect(surfaceVisible(control, "config-init")).toBe(false)
    expect(surfaceVisible(control, "model-probe")).toBe(false)
    const config = capabilitiesOf(["config"])
    expect(surfaceVisible(config, "config-init")).toBe(true)
    expect(surfaceVisible(config, "config-fix")).toBe(true)
    expect(surfaceVisible(config, "close-unit")).toBe(false)
    expect(surfaceVisible(config, "model-probe")).toBe(false)
    const probe = capabilitiesOf(["read", "probe"])
    expect(surfaceVisible(probe, "model-probe")).toBe(true)
    expect(surfaceVisible(probe, "close-unit")).toBe(false)
    expect(surfaceVisible(probe, "config-init")).toBe(false)
  })
})

describe("web write surface: confirm and clean-tree are two separate steps", () => {
  test("gateOf reads the daemon's own gate field; anything else is not a gate refusal", () => {
    expect(gateOf({ gate: "cleanTree" })).toBe("cleanTree")
    expect(gateOf({ gate: "confirm" })).toBe("confirm")
    expect(gateOf({ error: "a run is already active" })).toBeNull()
    expect(gateOf({})).toBeNull()
  })

  test("gateText carries the daemon's lines verbatim (the findings / the question), never a re-derivation", () => {
    expect(gateText({ lines: ["line a", "line b"] })).toBe("line a\nline b")
    expect(gateText({ question: "continue? [y/N] " })).toBe("continue? [y/N] ")
    expect(gateText({ error: "bare" })).toBe("bare")
  })

  test("answering a step adds EXACTLY its own field — no request bundles both before both gates asked", () => {
    const base = { config: { phases: "m" } }
    const tree = answerGate(base, "cleanTree")
    expect(tree).toEqual({ config: { phases: "m" }, cleanTree: true })
    expect("confirm" in tree).toBe(false)
    const confirm = answerGate(base, "confirm")
    expect(confirm).toEqual({ config: { phases: "m" }, confirm: true })
    expect("cleanTree" in confirm).toBe(false)
    // both answered (two gates asked, two answers given) is the accumulation
    // of two separate steps, each of which could have been refused:
    expect(answerGate(tree, "confirm")).toEqual({ config: { phases: "m" }, cleanTree: true, confirm: true })
  })

  test("the two steps' words never read as one bundled force", () => {
    for (const words of [GATE_STEP_WORDS.cleanTree, GATE_STEP_WORDS.confirm]) {
      expect(words.action).not.toContain("force")
      expect(words.note).toContain("its own field")
    }
    expect(GATE_STEP_WORDS.cleanTree.note).toContain("confirms nothing")
    expect(GATE_STEP_WORDS.confirm.note).toContain("licenses no dirty tree")
  })
})

describe("web write surface: the request builders speak the daemon's vocabulary", () => {
  test("close: the explicit ref and the one-line reason are the confirmation — no gate field exists", () => {
    expect(buildCloseRequest({ ref: "T-001", reason: "superseded by the rewrite", cascade: false, changes: "" })).toEqual({ ref: "T-001", reason: "superseded by the rewrite" })
    expect(buildCloseRequest({ ref: "R-01.P02", reason: "shipped", cascade: true, changes: "stash" })).toEqual({ ref: "R-01.P02", reason: "shipped", cascade: true, changes: "stash" })
    for (const raw of [
      { ref: "T-1", reason: "x", cascade: false, changes: "" },
      { ref: "phase one", reason: "x", cascade: false, changes: "" },
      { ref: "", reason: "x", cascade: false, changes: "" },
    ]) {
      expect(() => buildCloseRequest(raw)).toThrow("not a unit reference")
    }
    expect(() => buildCloseRequest({ ref: "T-001", reason: "", cascade: false, changes: "" })).toThrow("non-empty")
    expect(() => buildCloseRequest({ ref: "T-001", reason: "two\nlines", cascade: false, changes: "" })).toThrow("one line")
    expect(() => buildCloseRequest({ ref: "T-001", reason: "x", cascade: false, changes: "rebase" })).toThrow('"commit"|"stash"')
  })

  test("task-add: one line, non-empty", () => {
    expect(buildTaskRequest(" the second widget ")).toEqual({ title: "the second widget" })
    expect(() => buildTaskRequest(" ")).toThrow("one-line task title")
    expect(() => buildTaskRequest("two\nlines")).toThrow("one line")
  })

  test("plan: empty is the no-agent route; append rides an input (the CLI's own usage rule)", () => {
    expect(buildPlanRequest("", false)).toEqual({})
    expect(buildPlanRequest("plan the widget migration", false)).toEqual({ input: "plan the widget migration" })
    expect(buildPlanRequest("more tasks", true)).toEqual({ input: "more tasks", append: true })
    expect(() => buildPlanRequest("", true)).toThrow("append")
  })

  test("the config form's keys are the constitutional vocabulary — the hand-edited pair has no field", () => {
    const keys = CONFIG_FIELDS.map((field) => field.key)
    for (const key of keys) expect(Object.keys(CONFIG_KEYS)).toContain(key)
    for (const key of HAND_EDITED_KEYS) expect(keys).not.toContain(key)
    expect([...keys].sort()).toEqual(["agent", "autoNumber", "contextLimit", "handoverTest", "idleMax", "idleTime", "mode", "parallel", "phases", "scanExempt", "subtask", "testByDriver", "wrapup"])
  })

  test("the config builder: absent means absent, values validate like the daemon's parse", () => {
    expect(buildConfigRequest({})).toEqual({ config: {} })
    expect(buildConfigRequest({ mode: "migrate", contextLimit: "32", testByDriver: "true", parallel: "none", agent: "claude" })).toEqual({ config: { mode: "migrate", contextLimit: 32, testByDriver: true, parallel: "none", agent: "claude" } })
    expect(buildConfigRequest({ scanExempt: "build/, dist/" })).toEqual({ config: { scanExempt: ["build/", "dist/"] } })
    // a lone dash is the explicit empty list (the key dropper)
    expect(buildConfigRequest({ scanExempt: "-" })).toEqual({ config: {} })
    expect(() => buildConfigRequest({ contextLimit: "0" })).toThrow("positive integer")
    expect(() => buildConfigRequest({ idleTime: "999" })).toThrow("1..120")
    expect(() => buildConfigRequest({ idleMax: "x" })).toThrow("integer")
    expect(() => buildConfigRequest({ subtask: "sometimes" })).toThrow("off|auto|true|ondemand")
    expect(() => buildConfigRequest({ agent: "cursor" })).toThrow("opencode|claude")
  })
})

describe("web write surface: the probe is a two-step admin act, not a checkbox", () => {
  test("nothing is buildable before scope + arm + confirm — each alone is not enough", () => {
    expect(buildProbeRequest({ scope: false, armed: true, confirmed: true })).toBeNull()
    expect(buildProbeRequest({ scope: true, armed: false, confirmed: true })).toBeNull()
    expect(buildProbeRequest({ scope: true, armed: true, confirmed: false })).toBeNull()
    expect(buildProbeRequest({ scope: false, armed: false, confirmed: false })).toBeNull()
    expect(buildProbeRequest({ scope: true, armed: true, confirmed: true })).toEqual({ probe: true, confirm: true })
  })

  test("the probe's own scope gates it and its words spell the cost", () => {
    expect(surfaceVisible(capabilitiesOf(["read", "control", "config", "answer"]), "model-probe")).toBe(false)
    expect(surfaceVisible(capabilitiesOf(["probe"]), "model-probe")).toBe(true)
    expect(PROBE_WORDS.intro).toContain("spends real tokens")
    expect(PROBE_WORDS.intro).toContain("rate-limited")
    expect(PROBE_WORDS.confirm).toContain("spends tokens")
    expect(PROBE_WORDS.arm).toContain("step 1 of 2")
    expect(PROBE_WORDS.confirm).toContain("step 2 of 2")
  })
})
