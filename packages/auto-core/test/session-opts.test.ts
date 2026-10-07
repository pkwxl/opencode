// The sessionOpts field-set pin: one row per call site of the loop family's
// options builder, holding it to the exact merged field sets — key presence
// included (the "reproduced, not normalized" case). Since the ruled merge
// every site carries idleMs and mode (the one per-site omission it removed
// was handover's mode); any extra, missing or renamed field fails here.
import { describe, expect, test } from "bun:test"
import { createControl } from "../src/exit"
import { noCommitGit } from "../src/git-ops"
import { sessionOpts, type Opts, type ServerControl, type SessionCtx } from "../src/opts"
import { createRouter } from "../src/router"
import type { PhaseKey } from "../src/phases/registry"

// One fixed context fixture. Every field the builder reads carries a
// distinctive value, so a mismatch localizes to the field; repl and routing
// stay unset because they are the keys whose presence-with-undefined behavior
// the pin must hold (a builder that dropped or conditionally set them shows
// here first). The service members are the project's own in-memory
// instances — the builder threads them through untouched, never calling them.
const ctx: SessionCtx = {
  directory: "/work/session-opts-pin",
  agentName: "auto",
  server: {} as ServerControl,
  router: createRouter(),
  control: createControl(),
  git: noCommitGit(),
  opts: {
    verbose: true,
    waitAnswer: 7,
    subtask: "true",
    contextLimit: 12_345,
    permission: "ask-allow",
    idleMs: 654_321,
    maxMs: 9_876_543,
    testByDriver: true,
    handoverTest: true,
    mode: { name: "greenfield", init: "init section", exec: "exec section" },
    intent: "cleanroom",
    newSession: true,
    wrapup: false,
    scanExempt: ["dist/"],
    stopBefore: "execute",
  },
}

// The same context on a fleet that cannot fork: the one field whose key is
// conditional rather than always present.
const degraded: SessionCtx = { ...ctx, leadSplit: false }

// The task site's phase — the caller-computed key the site argument carries;
// a stand-in is enough, the builder threads it through untouched.
const phase = { id: "R-03.P02" } as PhaseKey

// The full execution set: the only site with control and the task-execution
// fields (subtask pipeline, test protocol, wrap-up); idleMs and mode it
// shares with every site since the merge.
const taskSet = (c: SessionCtx): Opts => ({
  agent: c.agentName,
  dir: c.directory,
  verbose: c.opts.verbose,
  waitAnswer: c.opts.waitAnswer,
  subtask: c.opts.subtask,
  contextLimit: c.opts.contextLimit,
  permission: c.opts.permission,
  interactive: c.repl,
  server: c.server,
  idleMs: c.opts.idleMs,
  maxMs: c.opts.maxMs,
  testByDriver: c.opts.testByDriver,
  handoverTest: c.opts.handoverTest,
  mode: c.opts.mode,
  intent: c.opts.intent,
  newSession: c.opts.newSession,
  wrapup: c.opts.wrapup,
  scanExempt: c.opts.scanExempt,
  phase,
  routing: c.routing,
  router: c.router,
  control: c.control,
  git: c.git,
})

// The shared bypass set (numbering restore, planning, appending, handover
// distillation, knowledge extraction): plan's stop condition owns their
// questions; no task-execution fields, no phase, no control. idleMs and mode
// ride on every site per the ruled merge — the probe interval follows the
// configured idleTime (default fallback in src/watch.ts), and mode is inert
// on every bypass renderer but the ones that take one.
const bypassSet = (c: SessionCtx): Opts => ({
  agent: c.agentName,
  dir: c.directory,
  verbose: c.opts.verbose,
  waitAnswer: c.opts.waitAnswer,
  humanQuestions: c.opts.stopBefore === "execute",
  contextLimit: c.opts.contextLimit,
  permission: c.opts.permission,
  interactive: c.repl,
  server: c.server,
  idleMs: c.opts.idleMs,
  routing: c.routing,
  router: c.router,
  git: c.git,
  mode: c.opts.mode,
  intent: c.opts.intent,
})

describe("sessionOpts (the eight-site field-set pin)", () => {
  test("task site: the full execution set, leadSplit absent while the fleet can fork", () => {
    expect(sessionOpts(ctx, { site: "task", phase })).toStrictEqual(taskSet(ctx))
  })

  test("task site: leadSplit false when the fleet cannot fork — the only conditional key", () => {
    expect(sessionOpts(degraded, { site: "task", phase })).toStrictEqual({ ...taskSet(degraded), leadSplit: false })
  })

  test("plan-numbering site (the planning step's numbering restore)", () => {
    expect(sessionOpts(ctx, { site: "plan-numbering" })).toStrictEqual(bypassSet(ctx))
  })

  test("phase-plan site (the planning session)", () => {
    expect(sessionOpts(ctx, { site: "phase-plan" })).toStrictEqual(bypassSet(ctx))
  })

  test("append-numbering site (the appending step's numbering restore)", () => {
    expect(sessionOpts(ctx, { site: "append-numbering" })).toStrictEqual(bypassSet(ctx))
  })

  test("phase-append site (the appending session)", () => {
    expect(sessionOpts(ctx, { site: "phase-append" })).toStrictEqual(bypassSet(ctx))
  })

  test("handover site: carries mode since the ruled merge (the one omission it removed)", () => {
    const built = sessionOpts(ctx, { site: "handover" })
    expect("mode" in built).toBe(true)
    expect(built).toStrictEqual(bypassSet(ctx))
  })

  test("diagnosis site (the blockage diagnosis session, 0082 §4 D4)", () => {
    expect(sessionOpts(ctx, { site: "diagnosis" })).toStrictEqual(bypassSet(ctx))
  })

  test("knowledge site (the k-phase extraction session)", () => {
    expect(sessionOpts(ctx, { site: "knowledge" })).toStrictEqual(bypassSet(ctx))
  })

  test("key presence is reproduced, not normalized", () => {
    const bypass = sessionOpts(ctx, { site: "handover" })
    // always-set keys keep their presence with an undefined value
    expect("interactive" in bypass).toBe(true)
    expect(bypass.interactive).toBeUndefined()
    expect("routing" in bypass).toBe(true)
    expect(bypass.routing).toBeUndefined()
    // fields no bypass set carries stay absent
    expect("phase" in bypass).toBe(false)
    expect("control" in bypass).toBe(false)
    expect("humanQuestions" in sessionOpts(ctx, { site: "task", phase })).toBe(false)
    expect("leadSplit" in sessionOpts(ctx, { site: "task", phase })).toBe(false)
  })

  test("idleMs and mode stay present when the run sets neither", () => {
    // the merge made both keys unconditional: an unset run leaves them
    // present with undefined (the probe then falls back to the 10-minute
    // default), never absent — on the handover site too, whose former
    // mode omission the merge removed
    const bare: SessionCtx = { ...ctx, opts: {} }
    const bypass = sessionOpts(bare, { site: "handover" })
    expect("idleMs" in bypass).toBe(true)
    expect(bypass.idleMs).toBeUndefined()
    expect("mode" in bypass).toBe(true)
    expect(bypass.mode).toBeUndefined()
    const task = sessionOpts(bare, { site: "task", phase })
    expect("idleMs" in task).toBe(true)
    expect("mode" in task).toBe(true)
  })

  test("service references thread from the context untouched", () => {
    const task = sessionOpts(ctx, { site: "task", phase })
    expect(task.server).toBe(ctx.server)
    expect(task.router).toBe(ctx.router)
    expect(task.control).toBe(ctx.control)
    expect(task.git).toBe(ctx.git)
    expect(task.phase).toBe(phase)
    const bypass = sessionOpts(ctx, { site: "phase-plan" })
    expect(bypass.server).toBe(ctx.server)
    expect(bypass.router).toBe(ctx.router)
    expect(bypass.git).toBe(ctx.git)
  })
})

// The S5 width keys (plans/0068 D10/D18/§6.8): parallel rides the task
// options only where execution width is real — a concurrent run
// (maxSessions ≥ 2 under a level) or a lane worker — and lane/stream mark
// the lane worker's scope. At one session in the main process every key
// stays absent whatever the level (the byte-identical floor).
describe("sessionOpts width keys (plans/0068 S5)", () => {
  const lane = { unit: "T-001.S02" }

  test("a concurrent run carries the level; the lane scope and stream ordinal ride along", () => {
    const wide: SessionCtx = { ...ctx, opts: { ...ctx.opts, parallel: "medium", maxSessions: 2 } }
    const task = sessionOpts(wide, { site: "task", phase })
    expect(task.parallel).toBe("medium")
    expect("lane" in task).toBe(false)
    expect("stream" in task).toBe(false)
    // A lane worker: the level rides even without maxSessions (the flag
    // never reaches the worker — its opts.lane is the width fact), and the
    // stream ordinal scopes the pipeline to one checklist item.
    const worker: SessionCtx = { ...ctx, opts: { ...ctx.opts, parallel: "medium", lane } }
    const streamTask = sessionOpts(worker, { site: "task", phase, stream: 2 })
    expect(streamTask.parallel).toBe("medium")
    expect(streamTask.lane).toBe(lane)
    expect(streamTask.stream).toBe(2)
    expect(sessionOpts(worker, { site: "task", phase }).stream).toBeUndefined()
  })

  test("one session in the main process injects nothing whatever the level (the floor)", () => {
    const serial: SessionCtx = { ...ctx, opts: { ...ctx.opts, parallel: "high" } }
    const task = sessionOpts(serial, { site: "task", phase })
    expect("parallel" in task).toBe(false)
    expect("lane" in task).toBe(false)
    // A lane without a level (the isolation switch's world) carries the
    // scope but not the guidance.
    const bare: SessionCtx = { ...ctx, opts: { ...ctx.opts, lane: { unit: "T-001" } } }
    const isolation = sessionOpts(bare, { site: "task", phase })
    expect("parallel" in isolation).toBe(false)
    expect(isolation.lane).toEqual({ unit: "T-001" })
  })
})
