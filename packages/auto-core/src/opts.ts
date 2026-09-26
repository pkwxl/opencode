// Session-level options and outcome types: the pass-through parameters shared
// by runTask/runOnce and the bypass sessions, the unit stop-exit and
// commit-result unions, plus the context budget constants. Pure types +
// constants, no runtime dependencies, at the bottom of the dependency graph —
// any module can import it without pulling in the session-driving graph.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S1, pure move).
import type { Interactive } from "./interactive"
import type { ModeSpec } from "./mode"
import type { AgentHost } from "./agent/types"
import type { PhaseKey } from "./phases/registry"

// Task outcomes. dirty (plans/0021-commit-boundary-design.md) = the dedicated
// exit for a unit-start clean-gate failure: writes no runtime state, makes no
// sweeping commit, the authority over git state stays with the human; the
// caller halts directly with exit 2.
export type Outcome =
  | { type: "completed" }
  | { type: "blocked"; question: string }
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

// --subtask's three levels: off (one session to completion) / auto (automatic
// decomposition, the default; a subtask session reaching 2x --context-limit
// likewise gets a handover document + continuation in a new session) /
// ondemand (one session executes; at 2x --context-limit a handover document +
// continuation in a new session).
export type SubtaskMode = "off" | "auto" | "ondemand"

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
  // --commit false: turns off the driver's post-session unified commit (on by
  // default; the commit mechanism is src/git.ts).
  commit?: boolean
  subtask?: SubtaskMode
  // dryrun sessions: permission requests are denied automatically without
  // interrupting (so the AI can record the blocked items); questions are
  // always auto-answered.
  dryrun?: boolean
  // The context budget baseline (tokens); default 64k (--context-limit n
  // counts in thousands of tokens): the used-usage threshold for session reuse
  // is half of it, the handover steer threshold 2x (ondemand whole-task
  // sessions and auto subtask sessions).
  contextLimit?: number
  // --permission's four levels: the handling policy for permission requests,
  // default ask-deny (see PermissionMode).
  permission?: PermissionMode
  // --interactive bypass: attached as every session is created/reused, human
  // input is injected into the session through it; the ask-* human wait is now
  // also received through it (semantics unchanged).
  interactive?: Interactive
  // Agent host control (AgentHost minus client/close): syncContext before a new
  // session (opencode restarts its server when AGENTS.md changed), restart on
  // a network-class session error before retrying.
  server?: Pick<AgentHost, "syncContext" | "restart">
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
  // policy (prompt.ts useHumanQuestions).
  humanQuestions?: boolean
  // The run's registry routing facts (plans/0055 §6): the loaded model
  // registry with the agent filter and the default agent, built once at run
  // start. undefined = no registry: every dispatch resolves its model through
  // the env-switch path, exactly as before. Type-only import; opts stays a
  // pure type module.
  routing?: import("./routing").RoutingFacts
}

// The default context budget baseline (tokens); overridden by --context-limit n
// in thousands of tokens. The session-reuse threshold is half of it, the
// handover steer threshold 2x.
export const DEFAULT_CONTEXT_LIMIT = 64_000
