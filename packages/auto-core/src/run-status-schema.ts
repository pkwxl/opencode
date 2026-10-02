// The run-status event table (the headless-service direction, plans/0067,
// its review's §8 item 1): the typed vocabulary the P2 emitter will publish
// — a driver-level event set (RunStatusEvent) covering the run's narrative
// the two existing vocabularies lack: run brackets, unit transitions, task
// and subtask brackets, the question lifecycle, usage roll-ups, failures
// and exit requests. The schema-module precedent is src/models-schema.ts:
// types plus declaration tables, and nothing else — this module reads no
// file, merges nothing and judges nothing, so an importer (type-only or for
// the tables) binds no behavior. No emission, no subscribers and no server
// work live here; the emitter (P2) follows the log.ts setter-injection
// precedent, and the SSE surface (P2) and the pending-question queue (P3c)
// are its consumers.
//
// Derived, not invented (the review's §3a correction — the direction draft's
// "no structured event bus" claim overlooked the journal): the vocabulary is
// anchored to the engine seam's RunEvent (src/engine/events.ts, the
// `.auto/run-events.jsonl` journal — the input log and the executed effects,
// one run per truncation), the agent layer's AgentEvent (src/agent/types.ts)
// and the driver's own on-disk state (`.auto/units.json`, `.auto/stats.json`,
// the unit documents). Three streams, disjoint by design:
//   - RunEvent owns the turn engine's facts: turn-start / input / fx /
//     fx-result / fx-reject / settle;
//   - AgentEvent owns the agent stream's facts: part / message / question /
//     permission / error / retry / limit / idle;
//   - RunStatusEvent owns the driver narrative around them: which run opened
//     and closed with what exit code, which units moved, which task and
//     subtask ran with what outcome, which question is open and how it
//     settled, what usage accumulated, what failed at the driver's own
//     level, and where a graceful exit was requested.
// The three vocabularies' event-type names stay pairwise disjoint (the
// failure event is `failure`, not `error`, precisely so an AgentEvent
// `error` and a driver failure never share a name), and a consumer joins
// the streams on the shared identifiers: `run` (the run's start epoch ms —
// the audit log's `run-<ISO-to-seconds>.log` name and the run lock's
// `started` both key the same run by instants inside it), `session` (the
// agent session id of AgentEvent and of the journal's turn-start), `unit` /
// `task` / `subtask` (the qualified ids of the unit model,
// src/document/unit.ts — the keys of the status read model).
//
// THE RULE every later consumer of this vocabulary carries (the direction
// draft §五's no-scraping constraint): SSE payloads are these typed events
// only — never log prose. The log's lines are for humans; a machine consumer
// that wants the narrative subscribes to this vocabulary, and one that wants
// the engine seam tails the journal; nothing between the two is ever parsed
// back out of prose.
//
// Self-contained on purpose (the src/agent/types.ts precedent: a frozen
// interface restates structurally the shapes its homes also declare): the
// module imports nothing, so any module — the emitter beside log.ts, a
// shell's SSE surface, tests — may read it without binding anything. Each
// restated shape names its home, and test/run-status-schema.test.ts pins
// the joins so the restatements cannot drift.

// The shipped event-type set — the table proper. Frozen additive-only: the
// list may grow (a new event type extends this table and the ratchet's
// shipped list in test/run-status-schema.test.ts in one conscious change),
// a name never renames or removes — the ratchet there is the enforcement,
// the write-ratchet family (test/chain-writes.test.ts) the pattern.
export const RUN_STATUS_EVENT_TYPES = [
  "run-start",
  "run-end",
  "unit-transition",
  "task-start",
  "task-end",
  "subtask-start",
  "subtask-end",
  "question-raised",
  "question-answered",
  "usage-rollup",
  "failure",
  "exit-request",
  "lane-dispatch",
  "lane-exit",
  "lane-landing",
  "lane-block",
] as const

export type RunStatusEventType = (typeof RUN_STATUS_EVENT_TYPES)[number]

// The run's exit vocabulary (src/loop.ts' exit-code comment and its
// ExitRequested catch): 0 = all tasks done; 1 = usage/setup error; 2 =
// blocked, waiting for a human outside the session and re-run; 3 = the
// graceful /exit pause (progress persisted, re-run resumes precisely); 130 =
// force-killed by double Ctrl+C.
export const RUN_EXIT_CODES = [0, 1, 2, 3, 130] as const

export type RunExitCode = (typeof RUN_EXIT_CODES)[number]

// The unit levels of the unit model (UnitLevel, src/document/unit.ts).
export const UNIT_LEVELS = ["phase", "task", "subtask"] as const

export type StatusUnitLevel = (typeof UNIT_LEVELS)[number]

// The unit statuses the driver moves a unit through (STATUSES,
// src/tasks.ts — `.auto/units.json` records in_progress/blocked, the
// done.md rename records done, the default is pending). A transition may
// also revert to pending.
export const UNIT_STATUSES = ["pending", "in_progress", "blocked", "done"] as const

export type UnitStatus = (typeof UNIT_STATUSES)[number]

// The task outcomes (Outcome, src/opts.ts): the pipeline's own close-out
// words, carried by the task and subtask brackets. `unit-done` since
// plans/0068 S5: a stream lane or a lead that stopped at its taken split
// closed its lane unit without completing the task (the bracket's task goes
// on in other lanes).
export const TASK_OUTCOMES = ["completed", "unit-done", "blocked", "incomplete", "dirty"] as const

export type TaskOutcome = (typeof TASK_OUTCOMES)[number]

// The session error classification words (ErrorClass, src/chain.ts — the
// glossary's error classification). A failure event carries one only when
// the failure went through the driver's session-error classifier.
export const STATUS_ERROR_CLASSES = ["overflow", "quota", "auth", "rate", "transient", "unknown"] as const

export type StatusErrorClass = (typeof STATUS_ERROR_CLASSES)[number]

// The scopes a usage roll-up covers: the stats module's buckets (session /
// task / phase / round, src/stats.ts) plus the run itself (the figures the
// run-end bracket can close with; stats books no run bucket, the emitter
// totals one).
export const USAGE_SCOPES = ["session", "task", "phase", "round", "run"] as const

export type UsageScope = (typeof USAGE_SCOPES)[number]

// Where a question came from: an agent's question event (answered through
// the driver's question policy) or a driver prompt of its own (askHuman —
// a permission wait, a plan session's human question).
export const QUESTION_ORIGINS = ["agent", "driver"] as const

export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number]

// How a raised question settled: the human answered, the driver answered or
// fell back by policy (the AUTO-RESOLVE path), or no answer arrived inside
// the wait and the policy's timeout fallback took over.
export const QUESTION_SETTLEMENTS = ["human", "driver", "timeout"] as const

export type QuestionSettlement = (typeof QUESTION_SETTLEMENTS)[number]

// The safe boundaries a graceful exit can take effect at (ExitRequested's
// boundary — Boundary | "wait", src/exit.ts and src/control-types.ts: the
// three step-mode boundaries plus the wait-and-probe loop's sleep).
export const EXIT_BOUNDARIES = ["phase", "task", "subtask", "wait"] as const

export type ExitBoundary = (typeof EXIT_BOUNDARIES)[number]

// The outcomes of a lane's landing (plans/0068 D7): the merge landed (with
// the landing-sync tick commit), conflicted (the merge aborted, the main tree
// clean again, the lane's scene kept), or the landing itself blocked
// (verification or the merge failed; the scene kept).
export const LANE_LANDING_OUTCOMES = ["landed", "conflict", "blocked"] as const

export type LaneLandingOutcome = (typeof LANE_LANDING_OUTCOMES)[number]

// The verdict a lane report's `result` field carries (plans/0068 D8): the
// `Result: PASS|FAIL` semantics verbatim — no new verdict vocabulary.
export const LANE_RESULTS = ["PASS", "FAIL"] as const

export type LaneResult = (typeof LANE_RESULTS)[number]

// The usage figures a roll-up carries: the stats Usage shape (src/stats.ts)
// restated structurally — same field names, so a stats Usage value is
// assignable to it unchanged (the keying test pins that join).
export type UsageFigures = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  steps: number
}

// The vocabulary proper. Every member names its run (`run`: the run's start
// epoch ms, the instant the run-start event stamped — every later event of
// the run echoes it) and its own instant (`at`, epoch ms). All fields are
// JSON-plain primitives: an event is exactly what an SSE payload carries.
export type RunStatusEvent =
  // The run opened on the target directory (`directory`, absolute). The
  // bracket every other event of the run sits inside; the journal truncates
  // and the audit log rotates at the same boundary.
  | { type: "run-start"; run: number; at: number; directory: string }
  // The run closed with its exit code — the full vocabulary above. The last
  // event of a run that ended inside the process; a kill -9 leaves no
  // run-end (the stale lock and the missing bracket are that story, and the
  // re-run's run-start opens a new one).
  | { type: "run-end"; run: number; at: number; code: RunExitCode }
  // A unit moved between statuses — the narrative of the move `.auto/`
  // records (units.json's runtime entries, the done.md rename; the files
  // stay the durable state, this is the push of the same fact). `unit` is
  // the qualified id (R-01.P02 / T-014 / T-014.S03 — qualifiedId,
  // src/document/unit.ts); `from` → `to` over the statuses above, including
  // the revert to pending.
  | { type: "unit-transition"; run: number; at: number; unit: string; level: StatusUnitLevel; from: UnitStatus; to: UnitStatus }
  // An execution unit began / ended. `task` is the task id (T-NNN, or a
  // bypass session's pseudo task PLAN / AUTO — the resolve ledger's task
  // words, src/runner.ts pseudoTask); `title` when the driver knows it (the
  // banner's). `outcome` is the pipeline's close-out word; `detail` carries
  // the blocked question, the incomplete reason or the dirty summary when
  // there is one.
  | { type: "task-start"; run: number; at: number; task: string; title?: string }
  | { type: "task-end"; run: number; at: number; task: string; outcome: TaskOutcome; detail?: string }
  // A subtask of a task began / ended (`subtask` = S<nn>; the pair with
  // `task` locates it — the subtask's qualified id).
  | { type: "subtask-start"; run: number; at: number; task: string; subtask: string; title?: string }
  | { type: "subtask-end"; run: number; at: number; task: string; subtask: string; outcome: TaskOutcome; detail?: string }
  // The question lifecycle (what the P3c queue replays to reconstruct "a
  // question is pending"). `question-raised` restates only the correlation
  // key and the text — the asking itself is an agent stream fact
  // (AgentEvent `question`) or a driver prompt (askHuman); the lifecycle
  // around it is this vocabulary's. `origin` "agent": `request` is the
  // AgentEvent question's request id (the join) and `session` its session,
  // one event per question text; `origin` "driver": no request, the session
  // and order correlate. `question-answered` settles the nearest open raise
  // of the same request (or session): `by` human / driver / timeout as the
  // settlements table words it; `answer` is the one-line answer when there
  // is one.
  | { type: "question-raised"; run: number; at: number; origin: QuestionOrigin; question: string; request?: string; session?: string; task?: string }
  | { type: "question-answered"; run: number; at: number; by: QuestionSettlement; request?: string; session?: string; task?: string; answer?: string }
  // A usage roll-up: the accumulated figures of one scope, pushed at the
  // driver's narrative points (session end, task/phase/round close-out,
  // run end). The stats module's own records (`.auto/stats.json`) stay the
  // durable numbers; this is the same shapes as a push.
  | { type: "usage-rollup"; run: number; at: number; scope: UsageScope; usage: UsageFigures; task?: string; session?: string }
  // A driver-level failure: a failure the driver itself met or classified —
  // a failed dispatch, a close-out violation, a spawn failure, a session
  // failure the retry ladder gave up on. `message` is the error text the
  // driver states (data, not prose scraped out of the log); `class` when
  // the failure went through the session-error classifier. Named
  // `failure`, never `error`: the agent stream owns that event name, and
  // the three vocabularies' type names stay pairwise disjoint.
  | { type: "failure"; run: number; at: number; message: string; class?: StatusErrorClass; session?: string; task?: string }
  // A graceful exit was requested (/exit — the interactive sideband today,
  // the daemon's pause button once P3 bridges the control service).
  // `boundary` names the safe boundary it took effect at when that is
  // already known (ExitRequested's boundary; the request usually lands
  // before the run reaches it, and the run-end with code 3 closes the
  // story).
  | { type: "exit-request"; run: number; at: number; boundary?: ExitBoundary }
  // The lane lifecycle of a parallel run (plans/0068 §6.7, D13, stage S4):
  // parent-level facts of the isolation machinery — the task-start/task-end
  // brackets above carry the unit narrative; these carry the lane identity,
  // so the future 0067 bus can carry a lane the way it carries a run.
  // `lane` is the unit id (the branch `auto-lane/<id>` and the park
  // `.auto/worktrees/<id>/` derive from it). Nothing here parses lane
  // terminal text (F13's rule): the events carry typed facts only, and the
  // human story rides the prefix relay's log lines.
  //   - lane-dispatch: the parent spawned the lane's worker (`worktree` the
  //     park path relative to the target directory, `pid` the worker's when
  //     it has one, `merge` naming the parent branch a conflict repair's
  //     re-dispatch carries — absent on every ordinary dispatch);
  //   - lane-exit: one worker's process exit — `code` the exit code, and
  //     `report` whether the lane report was found and parsed (false is the
  //     orphan signal, D8/D14); `result` the report's verdict when it has
  //     one;
  //   - lane-landing: the landing protocol's outcome for one lane (D7) —
  //     a landed lane carries the report's usage figures (the numbers the
  //     parent books into its run stats), a conflict or a blocked landing
  //     carries `detail`;
  //   - lane-block: a lane blocked the run (the failure matrix's exit-2
  //     rows: a FAIL/blocked report, a landing conflict that spent its
  //     repair budget, the dispatch attempts cap) — `reason` the one-line
  //     fact, data rather than log prose.
  | { type: "lane-dispatch"; run: number; at: number; lane: string; worktree: string; pid?: number; merge?: string }
  | { type: "lane-exit"; run: number; at: number; lane: string; code: number; report: boolean; result?: LaneResult }
  | { type: "lane-landing"; run: number; at: number; lane: string; outcome: LaneLandingOutcome; detail?: string; tokens?: number; wallMs?: number; sessions?: number }
  | { type: "lane-block"; run: number; at: number; lane: string; reason: string }
