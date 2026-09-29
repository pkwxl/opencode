// The sessionOpts equivalence pin: one row per call site of the loop family's
// options builder, holding it to the exact field sets of the seven hand-built
// Opts literals it replaces — key presence included (the "reproduced, not
// normalized" case). When the ruled merge lands (every site then also carries
// idleMs and mode), the expected sets change in the same diff; until then any
// extra, missing or renamed field fails here.
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

// The full execution set (today's task-loop literal): the only site that
// carries idleMs and mode today, and the only one with control and the
// task-execution fields.
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
  newSession: c.opts.newSession,
  wrapup: c.opts.wrapup,
  scanExempt: c.opts.scanExempt,
  phase,
  routing: c.routing,
  router: c.router,
  control: c.control,
  git: c.git,
})

// The shared bypass set (the four planning-family literals and the knowledge
// literal): plan's stop condition owns their questions; no task-execution
// fields, no phase, no control.
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
  routing: c.routing,
  router: c.router,
  git: c.git,
  mode: c.opts.mode,
})

// The handover-distillation set: the one bypass literal without mode (the
// handover renderer takes none).
const handoverSet = (c: SessionCtx): Opts => ({
  agent: c.agentName,
  dir: c.directory,
  verbose: c.opts.verbose,
  waitAnswer: c.opts.waitAnswer,
  humanQuestions: c.opts.stopBefore === "execute",
  contextLimit: c.opts.contextLimit,
  permission: c.opts.permission,
  interactive: c.repl,
  server: c.server,
  routing: c.routing,
  router: c.router,
  git: c.git,
})

describe("sessionOpts (the seven-site equivalence pin)", () => {
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

  test("handover site: the one bypass set without mode", () => {
    const built = sessionOpts(ctx, { site: "handover" })
    expect("mode" in built).toBe(false)
    expect(built).toStrictEqual(handoverSet(ctx))
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
    // fields no bypass literal carries today stay absent
    expect("idleMs" in bypass).toBe(false)
    expect("phase" in bypass).toBe(false)
    expect("control" in bypass).toBe(false)
    expect("humanQuestions" in sessionOpts(ctx, { site: "task", phase })).toBe(false)
    expect("leadSplit" in sessionOpts(ctx, { site: "task", phase })).toBe(false)
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
