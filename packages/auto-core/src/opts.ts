// Session-level options and outcome types: the pass-through parameters shared
// by runTask/runOnce and the bypass sessions, the unit stop-exit and
// commit-result unions, the context budget constants — and sessionOpts, the
// one builder that assembles a session's options from the loop context. No
// runtime dependencies: every import stays type-only, so the module stays at
// the bottom of the dependency graph — any module can import it without
// pulling in the session-driving graph.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S1, pure move).
import type { Interactive } from "./interactive"
import type { ModeSpec } from "./mode"
import type { AgentClient } from "./agent/types"
import type { PhaseKey } from "./phases/registry"

// The run's agent hosts under one control (plans/0055 §8.1, src/agent-pool.ts):
// the agent pool under a model registry (one host per agent profile, started
// lazily) or a wrapper over the one started host without one. `agent` names
// the agent profile a call applies to — the chain's agent; undefined = the
// run's start profile (the single host without a registry). An AgentHost is
// assignable to this minus client/contextLimits, so a caller-supplied host
// (`managed`) is wrapped once where the run starts (singleHost in
// src/agent-pool.ts).
export type ServerControl = {
  // The client of the profile's host; under a pool the host starts here on
  // the profile's first selection, so a profile nobody selects never spawns.
  client(agent?: string): Promise<AgentClient>
  syncContext(agent?: string): Promise<void>
  restart(reason: string, agent?: string): Promise<boolean>
  // Key-ring rotation (§4.3): replaces the config content the next spawn
  // uses. On the pool this reaches every started host (one ring state, one
  // config content); restart then applies to the chain's host alone.
  setConfig?(config: Readonly<Record<string, unknown>> | undefined): void
  // The context windows of every model the started hosts know (contextLimits
  // merged; a model on a host that has not started is absent — an unknown
  // window never excludes a candidate, §6.2 rule 5).
  contextLimits(): Promise<ReadonlyMap<string, number>>
  close(): void
}

// What the session-driving entry points accept in place of an AgentClient:
// one client (tests, the layer-less run's single agent) or the run's pool
// control. Every driver call that takes a client resolves it from the chain's
// agent (src/agent-pool.ts clientOf); a plain client is returned as is,
// whatever the agent, so a single-client caller is untouched.
export type ClientSource = AgentClient | ServerControl

// Task outcomes. dirty (plans/0021-commit-boundary-design.md) = the dedicated
// exit for a unit-start clean-gate failure: writes no runtime state, makes no
// sweeping commit, the authority over git state stays with the human; the
// caller halts directly with exit 2. blocked may carry `repair` (plans/0079
// §4): the block is a task report's FAIL verdict, the one block a run with a
// --repair budget may trade for a bounded repair round (close the task,
// append rework) instead of stopping for the human. unit-done (plans/0068 S5) = a lane
// worker closed its unit without completing the task — a lead that stopped at
// its taken split (the streams run as lanes of their own) or one stream of a
// split: the unit's work is committed and the lane exits cleanly, and the
// task continues in other lanes; only the lane entry produces it (a serial
// caller never sees it).
export type Outcome =
  | { type: "completed" }
  | { type: "unit-done" }
  | { type: "blocked"; question: string; repair?: { reason?: string } }
  | { type: "incomplete"; reason: string }
  | { type: "dirty"; files: string[] }

// Unit stop exits (blocked = status recorded in .auto/units.json + a sweeping
// commit of the interrupted state; dirty = no write and no sweep, re-run after
// the human handles git). Referenced by the return unions of the execution
// functions, replacing the former `Outcome & {type:"blocked"}`.
export type UnitStop = { type: "blocked"; question: string } | { type: "dirty"; files: string[] }

// Completion-condition gate (plans/0021-commit-boundary-design.md P2): returns
// SessionCommit — unified commit failure, or (when a baseline is given) the
// unit close-out check not passing → failed, and the caller blocks and halts
// on "not counted as done" for the human; no dir / gate off → ok (the old
// behavior). The baseline is passed only at the unit close-out call sites (a
// subtask's final commit / a hidden task's spec.commit).
export type SessionCommit = { type: "ok" } | { type: "failed"; question: string }

// --subtask's four levels (plans/0059 D1): off (one session to completion —
// the default since 2026-10-04, flipping 0059 D1's `auto`) /
// auto (adaptive decomposition: one lead session works the whole
// task under ondemand's protocol and splits the rest off only when the
// driver's guard finds that it pays, plans/0059 D2–D4) / true (the planned
// pipeline: a decompose session, one session per subtask, a wrap-up — what
// auto meant before 0059) / ondemand (one session executes, managing its own
// context: usage notices and a self-decided handover document continue the
// task in fresh sessions, plans/0056).
export const SUBTASK_MODES = ["off", "auto", "true", "ondemand"] as const
export type SubtaskMode = (typeof SUBTASK_MODES)[number]

// --permission's four levels: the handling policy for permission requests
// (permission.asked), default ask-deny. auto-allow grants immediately and
// automatically (always lets it through, no waiting); ask-* first waits for
// the human (--wait-answer minutes; unset = no waiting, counted as timeout at
// once; answers like allow/yes/y count as granted, an explicit refusal denies
// that permission but the session continues), and on timeout each falls back:
// ask-allow grants automatically / ask-deny denies automatically but the
// session continues (the AI works around the missing grant) / ask-fail denies
// and exits the run (blocks and halts).
export type PermissionMode = "auto-allow" | "ask-allow" | "ask-deny" | "ask-fail"

// The agent contract every session runs under: `.opencode/agent/auto.md`,
// written by init. Its name is fixed since M6.1 (`--agent` now picks the coding
// agent, see ProjectConfig.agent); opencode takes it as the session's agent,
// the claude adapter appends its body to the system prompt.
export const CONTRACT_AGENT = "auto"

// Session-level options: the pass-through parameters shared by runTask/runOnce
// and the bypass sessions.
export type Opts = {
  // The contract name (CONTRACT_AGENT) — not the coding agent choice.
  agent?: string
  // The target directory; used when a dispatch fails to detect a missing agent
  // contract file and give a recovery hint.
  dir?: string
  verbose?: boolean
  waitAnswer?: number
  subtask?: SubtaskMode
  // dryrun sessions: permission requests are denied automatically without
  // interrupting (so the AI can record the blocked items); questions are
  // always auto-answered.
  dryrun?: boolean
  // The context budget baseline (tokens); default 64k (--context-limit n
  // counts in thousands of tokens): the used-usage threshold for session reuse
  // is half of it, the ondemand session-handover wall 2x of it, raised to a
  // quarter of a large model window and clamped to 80% of the window (plans/
  // 0056, plans/0059 D6; testrun.ts steerWall).
  contextLimit?: number
  // --permission's four levels: the handling policy for permission requests,
  // default ask-deny (see PermissionMode).
  permission?: PermissionMode
  // --interactive bypass: attached as every session is created/reused, human
  // input is injected into the session through it; the ask-* human wait is now
  // also received through it (semantics unchanged).
  interactive?: Interactive
  // The run's agent hosts under one control (plans/0055 §8.1): the agent pool
  // under a model registry — one host per agent profile, each started lazily
  // on the profile's first selection — or a wrapper over the one started host
  // without one. Every method takes the agent profile the call applies to
  // (the chain's agent; undefined = the run's start profile / the single
  // host), syncContext before a new session (opencode restarts its server
  // when AGENTS.md changed), restart on a network-class session error before
  // retry, setConfig (opencode) before a key-ring rotation restart re-spawns
  // with the next key's config reference (§4.3; absent on hosts that spawn
  // without driver-supplied config — the pool fans it out to every started
  // host, whose spawn config is one global ring state).
  server?: ServerControl
  // Watchdog of the driver-managed scripts: the sustained-no-output judgment
  // window (default 10 minutes) and the absolute duration cap (default unset;
  // config's idleTime / idleMax are set in minutes).
  idleMs?: number
  maxMs?: number
  // --test-by-driver: the execution protocol for test/compile/build commands
  // (persisted as config.testByDriver, injected by run) — execution sessions
  // (subtask/whole-task) do not run such commands directly inside the session;
  // the command is written as a script into the test/ directory and the script
  // path into tmp/test.sh for the driver to execute (its existence is the
  // pending-execution request); the driver merges stdout/stderr into one
  // tmp/test.<n>.out, and steers the exit code and output file path back into
  // the original session for the AI to read and judge directly.
  testByDriver?: boolean
  // --handover-test (needs --test-by-driver, persisted in config): when a test
  // fails (nonzero exit or watchdog timeout) and the session context has used
  // up to contextLimit, the AI is required to write a handover document
  // docs/<id>/testhandoff.md (a subtask session puts it at
  // docs/<id>/S<two-digit seq>/testhandoff.md, whole-task/rework rounds name it
  // at task level; it is cleared as soon as the subtask completes, so the next
  // subtask does not misread a leftover handover) and end the session; the
  // driver opens a new session to continue from it, preventing repeated trial
  // and error inside a huge context.
  handoverTest?: boolean
  // -m/--mode scenario mode (default migrate): passed through to the execution
  // and init prompt renders.
  mode?: ModeSpec
  // The active intent pack's name (plans/0079 §2): config `intent` rides the
  // session options so the render facts select the pack the preflight
  // validated — absent = the built-in default pack. Name only; the pack
  // itself loads per render call from the target directory's overlay.
  intent?: string
  // --new-session: skips session reuse in interruption recovery (a new session
  // opens even when the interrupted session is still alive); exact phase
  // re-entry is unaffected — only the old session context is abandoned, the
  // progress record's phase still guides the resume as usual.
  newSession?: boolean
  // Current phase (loop passes it; undefined = a bare run outside the phase
  // loop): the qualified id keys resolve records, the type entry drives model
  // routing and the decompose template and duties (M3.6).
  phase?: PhaseKey
  // --no-wrapup (persisted as config.wrapup, default true): once off, each
  // task skips the wrap-up session after its subtask/whole-task execution
  // completes (renderWrapup).
  wrapup?: boolean
  // plan's sessions (injected by the loop when RunAllOpts.stopBefore ===
  // "execute"): non-permission questions are the human's to decide — plan
  // exists precisely for human review before execution, so the driver waits
  // for the human's answer with no timeout and never proxy-answers (no
  // AUTO-RESOLVE); it blocks only when the input channel is unreachable (stdin
  // closed). The planning templates' question-rule branch follows the same
  // policy (the render facts' humanQuestions flag, src/prompt-facts.ts).
  humanQuestions?: boolean
  // The run's registry routing facts (plans/0055 §6): the registry with the
  // agent filter and the default agent, built once at run start and carried by
  // every dispatch — always defined for a run (a layer-less run carries the
  // implicit registry the env switches synthesize). undefined stays a legal
  // value only for a bare literal that never knew routing (a test literal
  // below the loop); the engine resolves such a literal onto the implicit
  // registry at its boundary. Type-only import; opts stays a pure type
  // module.
  routing?: import("./routing").RoutingFacts
  // The run's router service (the routing decision state: the failback
  // holders, the down marks), carried beside `routing` for the readers below
  // the services' entry modules — the strict-resume checks of the commit
  // boundary and the failback boundary hooks of the task pipeline. The loop
  // fills it from the installed services when it builds a session's options;
  // undefined = a run object that never knew routing state (a minimal test
  // literal), whose holders read as unset. Type-only import; opts stays a
  // pure type module.
  router?: import("./router").Router
  // The run's control service (the /exit request and its sleepers), carried
  // beside `router` for the readers below the services' entry modules — the
  // subtask boundary's /exit checkpoint of the task pipeline. The loop fills
  // it from the installed services when it builds a session's options;
  // undefined = a run object that never knew the request (a minimal test
  // literal), whose boundary skips the checkpoint. Type-only import; opts
  // stays a pure type module.
  control?: import("./exit").Control
  // The run's git service (the commit-side seam: the production delegation
  // over the free commit functions, or a test's no-commit double), carried
  // beside `router` and `control` for the readers below the services' entry
  // modules — the commit boundary's checks and the loop family's commit
  // calls. The loop fills it from the installed services when it builds a
  // session's options; undefined = a run object that never knew the seam
  // (a minimal test literal), whose holderless fallback is the production
  // instance — committing on, exactly what such a literal did before the
  // seam. Type-only import; opts stays a pure type module.
  git?: import("./git").GitOps
  // false = the run's agents cannot fork a session (capability.ts
  // Degradation.leadSplit, fixed at run start over the whole fleet): auto's
  // lead runs without its split clause, since the streams of a split are
  // forks of the lead (plans/0059 D7). Absent = the clause may be offered.
  leadSplit?: boolean
  // config.scanExempt (plans/0059 X2): globs of deliverable paths the
  // subtask close-out's P1 scan and terminator scan skip.
  scanExempt?: string[]
  // The parallel level in effect for this execution surface (plans/0068
  // D18/S5): set only where execution width is real — a concurrent run
  // (maxSessions ≥ 2 under a level) or a lane worker of one — so the
  // decompose family and the whole-task split clause carry the
  // `## parallelism` guidance of the configured level, and a lane worker
  // stops at a taken split whose streams run as lanes. Absent at one
  // session in the main process whatever the level (D10's byte-identical
  // floor). Type-only import; opts stays a pure type module.
  parallel?: import("./intent/types").ParallelLevel
  // The lane worker's scope (plans/0068 §6.3, RunAllOpts.lane re-stated for
  // the task pipeline): present only inside a spawned lane worker. The
  // pipeline reads it for the lead's split stop (S5) — never set by a
  // person's CLI. Type-only import; opts stays a pure type module.
  lane?: { unit: string; merge?: string }
  // The lane unit is one stream of a split (plans/0068 S5, `T-NNN.S<nn>`):
  // the task pipeline runs exactly that checklist item — the single-subtask
  // path with the cold-start delta (D19) — and, when the stream is the
  // last, the wrap-up and close-out in the same lane. Set only by the lane
  // entry from the unit id; never by a person's CLI.
  stream?: number
}

// —— The session-options builder (the loop family's one Opts factory) ——

// The structural context slice sessionOpts reads. A real loop context
// (LoopCtx in src/loop-task.ts) assigns unchanged; the fields are declared
// here instead of importing that type because a type edge opts → loop-task
// would close a counted import cycle (loop-task reaches the task pipeline,
// which reaches opts). `server` is ServerControl for the same structural
// reason: the loop's AgentPool is assignable to it, exactly as the hand-built
// literals this builder replaces already relied on.
export type SessionCtx = {
  directory: string
  agentName: string
  repl?: Interactive
  server: ServerControl
  routing?: import("./routing").RoutingFacts
  router: import("./router").Router
  control: import("./exit").Control
  git: import("./git").GitOps
  // false = the run's agents cannot fork, so auto's lead runs without its
  // split clause (only the task site reads it).
  leadSplit?: false
  // The run-level options the builder reads: a structural subset of the
  // preflight's run options, every field optional, so the full type assigns
  // unchanged.
  opts: {
    verbose?: boolean
    waitAnswer?: number
    subtask?: SubtaskMode
    contextLimit?: number
    permission?: PermissionMode
    idleMs?: number
    maxMs?: number
    testByDriver?: boolean
    handoverTest?: boolean
    mode?: ModeSpec
    intent?: string
    newSession?: boolean
    wrapup?: boolean
    scanExempt?: string[]
    stopBefore?: "execute"
    // The width facts of plans/0068 (D10/D18/S5): the level and the slot
    // count decide whether the decompose-side guidance rides the execution
    // options, and the lane scope marks a lane worker (the lead's split
    // stop). Optional like every field of the slice.
    parallel?: import("./intent/types").ParallelLevel
    maxSessions?: number
    lane?: { unit: string; merge?: string }
  }
}

// Which loop session is asking for its options: one id per call site the
// builder serves (phase-plan / phase-append are those sessions' resume-point
// step names; plan-numbering / append-numbering are the numbering-record
// restore sessions planning and appending open). The task variant carries its
// phase as the caller-computed PhaseKey — computing it here would need the
// phases value graph, which opts must not pull under every importer — and,
// since plans/0068 S5, the stream ordinal of a stream lane unit (the task
// pipeline runs exactly that checklist item).
export type SessionSite =
  | { site: "task"; phase: PhaseKey; stream?: number }
  | { site: "plan-numbering" }
  | { site: "phase-plan" }
  | { site: "append-numbering" }
  | { site: "phase-append" }
  | { site: "handover" }
  | { site: "knowledge" }

// Build one session's options from the loop context. Every site carries
// idleMs and mode (key always set, value possibly undefined): the session's
// probe interval then follows the run's configured idleTime (falling back to
// the 10-minute default in src/watch.ts when unset), and mode reaches only
// the renderers that take one — the handover renderer does not, so it is
// inert on that path. Other keys like interactive / routing are likewise
// always set, while leadSplit is set only when the fleet cannot fork. The
// builder takes no per-site exceptions: the task and bypass branches differ
// by data (the task site's phase and execution fields vs the bypass set),
// never by field omissions; every field set is pinned by
// test/session-opts.test.ts.
// AUTO-DECISION: the builder reads a structural ctx slice declared in this
// module rather than the loop context type (a type edge back up to the loop
// would close a counted import cycle; the slice keeps opts at the dependency
// bottom while a real loop context still assigns unchanged).
export function sessionOpts(ctx: SessionCtx, site: SessionSite): Opts {
  if (site.site === "task") {
    // D18/D10 (plans/0068 S5): the decompose-side parallelism guidance rides
    // the execution options only where execution width is real — a
    // concurrent run (maxSessions ≥ 2 under a level) or a lane worker of
    // one (opts.lane is set only by a launcher the scheduler or the
    // isolation switch drove; the guidance arranges splits whose streams
    // then run side by side). The rule is inlined (two comparisons) rather
    // than imported from src/lanes.ts — opts sits at the dependency bottom
    // and may not reach the scheduler. At one session in the main process
    // nothing is injected for any project whatever the level (the
    // byte-identical floor).
    const width = (ctx.opts.maxSessions ?? 1) >= 2 || ctx.opts.lane !== undefined
    return {
      agent: ctx.agentName,
      dir: ctx.directory,
      verbose: ctx.opts.verbose,
      waitAnswer: ctx.opts.waitAnswer,
      subtask: ctx.opts.subtask,
      contextLimit: ctx.opts.contextLimit,
      permission: ctx.opts.permission,
      interactive: ctx.repl,
      server: ctx.server,
      idleMs: ctx.opts.idleMs,
      maxMs: ctx.opts.maxMs,
      testByDriver: ctx.opts.testByDriver,
      handoverTest: ctx.opts.handoverTest,
      mode: ctx.opts.mode,
      intent: ctx.opts.intent,
      newSession: ctx.opts.newSession,
      wrapup: ctx.opts.wrapup,
      scanExempt: ctx.opts.scanExempt,
      phase: site.phase,
      routing: ctx.routing,
      router: ctx.router,
      control: ctx.control,
      git: ctx.git,
      // present only when the fleet cannot fork
      ...(ctx.leadSplit === false ? { leadSplit: false } : {}),
      // present only under real width (the level beside it)
      ...(width && ctx.opts.parallel !== undefined ? { parallel: ctx.opts.parallel } : {}),
      // present only inside a lane worker
      ...(ctx.opts.lane !== undefined ? { lane: ctx.opts.lane } : {}),
      // present only for a stream lane unit (the single-subtask path)
      ...(site.stream !== undefined ? { stream: site.stream } : {}),
    }
  }
  // the bypass sessions (numbering restore, planning, appending, handover
  // distillation, knowledge extraction) share one set: plan's stop condition
  // makes their questions the human's, and they carry no task-execution
  // fields — the sessions they feed take no test protocol, no wrap-up, no
  // subtask pipeline. idleMs and mode ride on every site per the ruled
  // merge (the probe interval follows the configured idleTime; mode reaches
  // only the renderers that take one, and the handover renderer takes
  // none).
  const bypass: Opts = {
    agent: ctx.agentName,
    dir: ctx.directory,
    verbose: ctx.opts.verbose,
    waitAnswer: ctx.opts.waitAnswer,
    humanQuestions: ctx.opts.stopBefore === "execute",
    contextLimit: ctx.opts.contextLimit,
    permission: ctx.opts.permission,
    interactive: ctx.repl,
    server: ctx.server,
    idleMs: ctx.opts.idleMs,
    routing: ctx.routing,
    router: ctx.router,
    git: ctx.git,
    mode: ctx.opts.mode,
    intent: ctx.opts.intent,
  }
  return bypass
}

// The default context budget baseline (tokens); overridden by --context-limit n
// in thousands of tokens. The session-reuse threshold is half of it, the
// ondemand session-handover wall 2x of it (raised to a quarter of a large
// model window and clamped to 80% of the window, plans/0056, plans/0059 D6).
export const DEFAULT_CONTEXT_LIMIT = 64_000
