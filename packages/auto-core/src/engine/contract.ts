// The turn engine's contract (plans/0061 §4.3): the types every engine piece
// shares. One turn of watch() is a single queue of inputs — external ones
// from the agent's event stream, synthetic ones from the engine's own
// sources — dispatched through the arbitration table to the concerns, top to
// bottom. A concern owns exactly one slice of the turn state: its own slice
// mutable, every other slice read-only through the view, so a second writer
// is a type error (the runtime half of the confinement is the spine's audit).
// All I/O goes through the TurnFx, which the spine wraps to enforce the
// queue discipline's invariants: no kernel call after a steer in the same
// idle quiet point, no second steer there, and nothing but log/vlog from a
// synthetic input.
//
// Types only — a leaf over type imports with no runtime edge, so any layer
// may depend on it without closing a cycle.
import type { AgentClient, AgentEvent, AgentRetryPolicy } from "../agent/types"
import type { ErrorClass, ErrorInfo } from "../chain"
import type { Classifier } from "../classify"
import type { Handover } from "../handover"
import type { SteerContext } from "../model-step"
import type { Opts, SessionCommit } from "../opts"
import type { TestRunInfo } from "../prompt"
import type { ResolveEvent } from "../resolve"
import type { ClassifierAnswer } from "../router"
import type { RunServices } from "../services"
import type { Usage } from "../stats"
import type { StuckTracker } from "../stuck"
import type { Switches } from "../switches"
import type { Steer, TestRun } from "../testrun"
import type { UsageSource } from "../usage"

// Inputs, in one queue. External inputs come from the agent's stream; synthetic
// ones from the engine's own sources. Nothing else reaches a concern.
export type TurnInput =
  | { kind: "event"; event: AgentEvent } // external
  | { kind: "stream-end" } // external: exhausted without an idle
  | { kind: "probe"; ok: boolean; at: number } // synthetic: liveness probe verdict
  | { kind: "answer"; answer: ClassifierAnswer | undefined } // synthetic: the classifier's reply

// The arbitration table's row keys (plans/0061 §4.5): an `event` input
// dispatches on the event's own type (limit/part/message/question/permission/
// error/retry/idle), the other inputs on their kind.
export type InputKind = AgentEvent["type"] | Exclude<TurnInput["kind"], "event">

// One slice per concern; the slice key is the concern's name. A concern gets
// its own slice mutable and every other slice read-only (TurnView), so a
// second writer is a type error.
export type TurnState = {
  // The twin-idle dedup: one turn end settles only once; any other session
  // event re-arms acceptance.
  guard: { idleHandled: boolean }
  // Terminal echo and billing: the final text part, the last message id (the
  // freeze pin's anchor), the seen part/message ids (re-sent updates echo
  // once), the billed step-finish ids, the accumulated token usage and the
  // once-per-watch model report. `fresh` is reserved for the part row.
  transcript: { lastText: string; lastMessage?: string; seen: Set<string>; billed: Set<string>; usage: Usage; modelReported: boolean; fresh?: string }
  // Deliberately empty: the account's usage windows are the router's run
  // state (the logged windows); the slice exists so the concern owns a key.
  windows: Record<string, never>
  // Deliberately empty: the tracker lives in TurnContext (dispatch lifetime).
  stuck: Record<string, never>
  // autoAnswered: questions already auto-answered (a repeat still blocks).
  // resolves: this turn's proxy-answer observations (fallback auto answers
  // only — a human reply is a real person's decision).
  questions: { autoAnswered: string[]; resolves: ResolveEvent[] }
  // The failure accumulator: the merged error text, the pessimistic
  // retryable (once false, never retracted), the structured info feeding
  // classification, and retrying — true from a retry signal until the model
  // produces output again, so a late classifier answer never aborts a turn
  // that recovered.
  failure: { error: string; retryable?: boolean; info?: ErrorInfo; retrying: boolean }
  // The failure-message classifier's per-turn state: the latest answer, the
  // ask still on its way, the class an answer raised while the turn was
  // retrying, and the final classification at close-out.
  recovery: { answer?: ClassifierAnswer; asked?: Promise<ClassifierAnswer | undefined>; raised?: ErrorClass; final?: { cls: ErrorClass; classified: boolean } }
  // The liveness probe's counters and the truncation-continuation criterion:
  // consecutive probe failures, the half-open judgment, the announced
  // silence's end (no failure counted before it), the last step-finish
  // reason and the consecutive-truncation count.
  liveness: { probeFailures: number; halfOpen: boolean; quietUntil?: number; lastFinish?: string; lengthContinued: number }
  // The measurement-point figures: context percentage, used tokens and the
  // model's window; the effective wall of the last measurement, the spent
  // handover hint and the spent usage-notice bands.
  usage: { pct: number; used: number; limit?: number; wall?: number; hinted: boolean; notes: Set<number> }
  // The context steps: the model id every steer names (the reached step's
  // id, so a late steer cannot drop the session back), the current step and
  // the reached record the snapshot carries to the chain.
  stepUp: { model?: string; step: number; reached?: { step: number; model: string } }
  // The test execution protocol at idle: the handover document finished,
  // the wrap-up request out, the one backfill retry spent.
  test: { handover: boolean; asked: boolean; retried: boolean }
}
export type SliceKey = keyof TurnState
export type TurnView = { readonly [K in SliceKey]: Readonly<TurnState[K]> }

// Immutable per-turn facts, built once by watch() from its parameters and the
// derivations its body used to hold in locals: the client and session, the
// steer and test protocol inputs, the bound pattern classifier and the
// failure-message classifier's handle, the steer context, the switches, the
// usage source, the services and the session's start timestamp. Everything a
// handler reads that is not a slice write or an fx call lives here.
export type TurnContext = {
  // The session under watch and its client (the capabilities, retry policy
  // and error patterns are read off the client).
  readonly client: AgentClient
  readonly sessionID: string
  // The run options the turn's policies read (waitAnswer, dryrun,
  // humanQuestions, permission, idleMs, interactive, routing, dir).
  readonly opts: Opts
  // The ondemand session-handover steer (absent = the protocol off).
  readonly steer?: Steer
  // The test-handover protocol's run record (absent = no test protocol).
  readonly test?: TestRun
  // The stuck-loop tracker (dispatch lifetime; its slice is empty).
  readonly stuck?: StuckTracker
  // The strict-resume gate reads this run's switches.
  readonly switches: Switches
  // The registry session's context steps and the model its steers name;
  // absent without a registry, byte-identical to the status quo.
  readonly steerContext?: SteerContext
  // The agent's retry policy with the registry entry's override applied.
  readonly policy: AgentRetryPolicy
  // The pattern classifier bound to the client's error patterns and policy.
  readonly classify: (info: ErrorInfo) => ErrorClass
  // The failure-message classifier's handle; undefined without a registry
  // classifier list, in which case nobody asks and the turn runs as before.
  readonly classifier?: Classifier
  // The usage source of the client's tier, fed every event of this session
  // (the tier itself reads off source.tier).
  readonly source: UsageSource
  // The run's services: clock (every time read and timer), router (the
  // logged windows and the step claims) and git behind the fx.
  readonly services: RunServices
  // Session start timestamp, for the snapshot's durationMs.
  readonly startTime: number
}

// The pending test the freeze pinned down: the consumed request marker's
// script and its sequence number (the shape TestRun.pending holds).
export type PendingTest = NonNullable<TestRun["pending"]>

// A usage-window observation (the `limit` event), passed through to the
// run's recorder.
export type LimitEvent = Extract<AgentEvent, { type: "limit" }>

// The only I/O path of a turn. The spine wraps the production fx to audit it
// (the queue discipline's invariants); the members marked "kernel" commit or
// run the project's own machinery and must never follow a steer within the
// same idle quiet point.
export type TurnFx = {
  // Steer the session (promptAsync — dispatch-only, a failed dispatch logs
  // and answers false). Default model = view.stepUp.model; the text feeds
  // the usage source.
  steer(text: string, model?: string): Promise<boolean>
  replyQuestion(request: string, answers: string[][]): Promise<void>
  rejectQuestion(request: string): Promise<void>
  replyPermission(request: string, reply: "always" | "reject"): Promise<void>
  abort(): Promise<void>
  // Wait for a human answer (undefined timeout = no timeout); undefined on
  // timeout or a closed input channel.
  askHuman(timeoutMin: number | undefined, hint: string): Promise<string | undefined>
  // The agent's context limits, memoized per turn (today's `limits ??=`).
  contextLimits(): Promise<ReadonlyMap<string, number>>
  readText(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  commitFreeze(n: number): Promise<SessionCommit> // kernel
  runTest(): Promise<TestRunInfo> // kernel
  resolveTest(): Promise<PendingTest | undefined> // kernel
  saveHandover(record: Handover): Promise<void>
  statsModelEvent(kind: "stuck"): Promise<void>
  onModel(model: string): void
  onLimit(event: LimitEvent): void
  log(line: string): void
  vlog(line: string): void
  now(): number // the run's clock (the services holder's)
}

// What a concern tells the spine after handling an input.
export type Advice =
  | "pass" // nothing consumed; the next row runs
  | "consumed" // this input is done; later rows do not run (the `continue` of today)
  | { settle: Settle } // the turn ends; for synthetic inputs held to the next boundary
export type Settle =
  | { kind: "natural" }
  | { kind: "blocked"; question: string; invalid?: boolean }
  | { kind: "error"; cls: ErrorClass; classified: boolean } // the early settlements (retry verdict, raised)
  | { kind: "interrupted" } // the stream ended, or half-open

// One concern: a slice's owner. `initial` builds the slice at the turn's
// start; `handle` answers one input with an advice; `finalize` runs the
// concern's steps of the settle procedure, in table order, once the turn has
// settled.
export type Concern<K extends SliceKey> = {
  name: K
  initial(ctx: TurnContext): TurnState[K]
  handle(input: TurnInput, own: TurnState[K], view: TurnView, fx: TurnFx, ctx: TurnContext): Promise<Advice>
  finalize?(own: TurnState[K], view: TurnView, fx: TurnFx, ctx: TurnContext): Promise<void>
}

// One cell of an arbitration row: the concern the input reaches at this
// position. `concurrent` marks the cells that may handle a synthetic input
// even while an fx call is in flight (the queue discipline's rule 2) — there
// the handler is restricted to its own slice's writes and log/vlog, and a
// settle it returns is held to the next boundary.
export type ArbitrationRow = { concern: SliceKey; concurrent?: boolean }

// The arbitration table (plans/0061 §4.5): one ordered row per input kind —
// the Record over InputKind makes a missing row a type error. A row runs top
// to bottom; the first "consumed" or settle advice ends the input.
export type Arbitration = Readonly<Record<InputKind, readonly ArbitrationRow[]>>
