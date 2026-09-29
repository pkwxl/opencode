// The turn spine (plans/0061 §4.4): the single input queue, the arbitration
// dispatch, the fx audit and the finalize procedure of one turn of watch().
// Every input — external, pulled from the agent's event stream, or synthetic,
// emitted by the engine's own sources (the probe timer, the classifier
// answer) — flows through one queue and the arbitration table to the
// concerns; the spine owns no turn state, it only drives the concerns'
// slices and audits their fx calls.
//
// Queue discipline, as enforced here:
// 1. External inputs run to completion. One external input's table row is
//    fully awaited — every fx call included — before the next is taken: the
//    loop below does not pull while its body awaits, the same backpressure a
//    plain for-await gives.
// 2. Synthetic inputs are handled as they arrive, even while an fx call is
//    in flight. An emission runs the row's `concurrent` cells on its own
//    promise chain — serialized among emissions, never queued behind the
//    external input — where the handler may write its own slice and log,
//    nothing else (the audit rejects every other fx call). A settle such a
//    handler returns is held: it wins at the next boundary, before any
//    queued external input. That is the conservative reading of today's
//    race between the stream pull and the preemption trip: a held settle
//    trips the wrapper, so the loop ends without handling another event,
//    and when a queued event had already won the pull it is consumed and
//    discarded (the loop-top check below, today's `raised` check).
// 3. The stream wrapper is the moved-verbatim race of the event iterator
//    against the trip. Cleanup skips `inner.return()` exactly when the turn
//    settled by half-open or by a raised class — a held settle from a
//    synthetic input is precisely that (a probe verdict judging half-open, a
//    classifier answer raising the class): the inner iterator holds a
//    suspended next() over a connection that will never resolve there, and
//    return() would queue behind it forever. Once the wrapper finishes, no
//    emission is handled anymore (today's probeActive/consuming pair) and
//    the sources' timers are cancelled through the attach cleanup.
//
// The idle quiet point (the audit's window for the steer/kernel rules) is
// the handling window of one idle input: the tracking resets with every
// external input, and the rules are enforced only while an idle event is
// being handled. Today's body never trips on that reading — at idle, the
// test protocol's kernel calls (the freeze commit, the pending-script
// resolution, the test execution) all precede their path's single steer,
// the backfill and truncation paths steer once and return, and the one
// place a single input steers twice (a usage notice and a step-up in one
// breath) is a message input, not an idle one.
//
// The finalize procedure runs after the turn settled: each distinct
// finalize function runs once, in table order (the order of a concern's
// first cell in the table's row order). The remainder install shares one
// handle and one finalize function across its roster entries — sharing the
// function is what makes them run once — and hands the whole close-out its
// single execution; as concerns are extracted, their own functions take
// their table positions. Then the caller maps the settle and the view into
// the turn's result.
//
// The spine is drivable with injected concerns, table and fx and no real
// stream: everything a turn needs arrives as arguments.
import type { AgentEvent } from "../agent/types"
import type { Advice, Arbitration, ArbitrationRow, Concern, Settle, SliceKey, TurnContext, TurnFx, TurnInput, TurnState, TurnView } from "./contract"

// One concern per slice: a missing owner is a type error. The remainder
// install delegates every entry to the one concern that holds the uncut
// body (plans/0061 §4.11); extraction units swap entries for real concerns
// one slice at a time, and the removal check asks which slices still
// delegate to it (slicesDelegatedTo below).
export type ConcernRoster = { readonly [K in SliceKey]: Concern<K> }

// The turn's slices, in table-stable order.
export const SLICE_KEYS = ["guard", "transcript", "windows", "stuck", "questions", "failure", "recovery", "liveness", "usage", "stepUp", "test"] as const satisfies readonly SliceKey[]

// The arbitration table (plans/0061 §4.5), declared with its final cell
// skeleton: one ordered row per input kind (an `event` dispatches on its own
// type), the cells naming the slice that owns the step, in today's statement
// order. While the remainder layer lives, every cell resolves to the one
// remainder concern through the roster — its handler answers consumed or a
// settle for the whole uncut body at the first cell, so the later cells
// stand ready for the extraction units, which swap roster entries for real
// concerns without reshaping the table. The `concurrent` flag marks the
// cells that may handle a synthetic input while an fx call is in flight.
// The two terminal rows are the spine's own: a stream that exhausts without
// an idle settles interrupted, an idle whose row runs out without a stop
// settles naturally (see spineSettle).
export const TURN_ARBITRATION: Arbitration = {
  limit: [{ concern: "windows" }],
  part: [
    { concern: "guard" },
    { concern: "failure" },
    { concern: "liveness" },
    { concern: "stepUp" },
    { concern: "transcript" },
    { concern: "stuck" },
  ],
  message: [
    { concern: "guard" },
    { concern: "transcript" },
    { concern: "usage" },
    { concern: "stepUp" },
  ],
  question: [{ concern: "questions" }],
  permission: [{ concern: "questions" }],
  error: [
    { concern: "guard" },
    { concern: "failure" },
    { concern: "stepUp" },
  ],
  retry: [
    { concern: "guard" },
    { concern: "failure" },
    { concern: "recovery" },
    { concern: "stepUp" },
    { concern: "liveness" },
    { concern: "transcript" },
  ],
  idle: [
    { concern: "guard" },
    { concern: "test" },
    { concern: "liveness" },
  ],
  "stream-end": [],
  probe: [{ concern: "liveness", concurrent: true }],
  answer: [{ concern: "recovery", concurrent: true }],
}

// The slices a roster still delegates to one shared concern handle — the
// remainder layer's owned set (plans/0061 §4.11): every key whose entry
// handles through the same function. The arbitration test asserts this is
// exactly the not-yet-extracted set: all eleven at the install, none at the
// layer's removal.
export function slicesDelegatedTo(concerns: ConcernRoster, handle: Concern<SliceKey>["handle"]): SliceKey[] {
  return SLICE_KEYS.filter((key) => (concerns[key] as Concern<SliceKey>).handle === handle)
}

// The turn's sources, attached at the turn's start: the hook receives the
// spine's emission point for synthetic inputs and returns the cleanup the
// wrapper's finally runs (the probe timer's cancellation). The probe timer
// starts before the first event is pulled, exactly where the moved body
// scheduled it.
export type TurnSources = (emit: (input: TurnInput) => void) => (() => void) | undefined | void

// What the spine answers with: the settle that ended the turn and the final
// view over the slices. The caller (watch) maps them into its result
// shapes; the spine itself knows nothing about them.
export type TurnOutcome = { settle: Settle; view: TurnView }

// Runs one turn: builds the slices from the roster's initials, attaches the
// sources, drives the wrapper's queue to a settle, runs the finalize
// procedure and answers with the outcome.
export async function runTurn(args: {
  ctx: TurnContext
  stream: AsyncIterable<AgentEvent>
  concerns: ConcernRoster
  fx: TurnFx
  table?: Arbitration
  attach?: TurnSources
  // Test builds freeze the other slices of every dispatched view: a write
  // through the view throws on the spot. Production relies on the type —
  // the view is read-only for everyone but the handler's own slice — and
  // skips the per-dispatch copies.
  freezeViews?: boolean
}): Promise<TurnOutcome> {
  const { ctx, stream, concerns, fx } = args
  const table = args.table ?? TURN_ARBITRATION
  const state: TurnState = {
    guard: concerns.guard.initial(ctx),
    transcript: concerns.transcript.initial(ctx),
    windows: concerns.windows.initial(ctx),
    stuck: concerns.stuck.initial(ctx),
    questions: concerns.questions.initial(ctx),
    failure: concerns.failure.initial(ctx),
    recovery: concerns.recovery.initial(ctx),
    liveness: concerns.liveness.initial(ctx),
    usage: concerns.usage.initial(ctx),
    stepUp: concerns.stepUp.initial(ctx),
    test: concerns.test.initial(ctx),
  }
  const liveView: TurnView = state
  const frozenView = (own: SliceKey): TurnView => {
    // Shallow copies of the other slices, frozen; the own slice stays the
    // live one (shared with `own`, so the handler's writes through either
    // reach the state). Frozen slices are dispatch-start snapshots — a
    // tripwire for cross-slice writes, not a synchronization mechanism.
    const copy = { ...state }
    const boxed = copy as { [K in SliceKey]: object }
    for (const key of SLICE_KEYS) if (key !== own) boxed[key] = Object.freeze({ ...boxed[key] })
    return copy
  }
  const viewFor = (own: SliceKey): TurnView => (args.freezeViews === true ? frozenView(own) : liveView)

  // The fx audit (plans/0061 §4.4 rule 4). One wrapper per dispatch: the
  // origin and the quiet-point flags belong to exactly one input's
  // handling, and a handler suspended at an fx await keeps its own wrapper
  // while a synthetic emission runs beside it. The invariants, which throw
  // as programming errors:
  // (a) a kernel fx call after any steer in the same idle quiet point;
  // (b) a second steer in the same idle quiet point;
  // (c) any fx call other than log/vlog from a synthetic input (a synthetic
  //     handler that needs the clock reads it through ctx.services, as the
  //     moved probe callback always did);
  // (d) a write outside the handler's own slice — impossible by type, and
  //     thrown in test builds through the frozen views.
  const auditedFx = (origin: "external" | "synthetic" | "finalize", quiet: boolean): TurnFx => {
    let steered = false
    const check = (member: string): void => {
      if (origin === "synthetic" && member !== "log" && member !== "vlog") {
        throw new Error(`turn engine audit: fx.${member} called while handling a synthetic input (only log/vlog are allowed there)`)
      }
      if (!quiet) return
      if (member === "steer") {
        if (steered) throw new Error("turn engine audit: a second steer in the same idle quiet point")
        steered = true
      } else if (member === "commitFreeze" || member === "runTest" || member === "resolveTest") {
        if (steered) throw new Error(`turn engine audit: kernel fx.${member} after a steer in the same idle quiet point`)
      }
    }
    const wrapped: TurnFx = {
      steer: (text, model) => {
        check("steer")
        return fx.steer(text, model)
      },
      replyQuestion: (request, answers) => {
        check("replyQuestion")
        return fx.replyQuestion(request, answers)
      },
      rejectQuestion: (request) => {
        check("rejectQuestion")
        return fx.rejectQuestion(request)
      },
      replyPermission: (request, reply) => {
        check("replyPermission")
        return fx.replyPermission(request, reply)
      },
      abort: () => {
        check("abort")
        return fx.abort()
      },
      askHuman: (timeoutMin, hint) => {
        check("askHuman")
        return fx.askHuman(timeoutMin, hint)
      },
      contextLimits: () => {
        check("contextLimits")
        return fx.contextLimits()
      },
      readText: (path) => {
        check("readText")
        return fx.readText(path)
      },
      exists: (path) => {
        check("exists")
        return fx.exists(path)
      },
      commitFreeze: (n) => {
        check("commitFreeze")
        return fx.commitFreeze(n)
      },
      runTest: () => {
        check("runTest")
        return fx.runTest()
      },
      resolveTest: () => {
        check("resolveTest")
        return fx.resolveTest()
      },
      saveHandover: (record) => {
        check("saveHandover")
        return fx.saveHandover(record)
      },
      statsModelEvent: (kind) => {
        check("statsModelEvent")
        return fx.statsModelEvent(kind)
      },
      onModel: (model) => {
        check("onModel")
        fx.onModel(model)
      },
      onLimit: (event) => {
        check("onLimit")
        fx.onLimit(event)
      },
      log: (line) => fx.log(line),
      vlog: (line) => fx.vlog(line),
      now: () => {
        check("now")
        return fx.now()
      },
    }
    return wrapped
  }

  // The row an input dispatches through: an event keys on its own type, the
  // other inputs on their kind.
  const rowOf = (input: TurnInput): readonly ArbitrationRow[] => (input.kind === "event" ? table[input.event.type] : table[input.kind])

  // Runs one row. The first consumed or settle advice ends the input; a
  // synthetic input reaches only the cells declared concurrent. The roster
  // pairs each concern with its own slice by construction — the dispatch
  // reads that pairing back through the key union, which the compiler
  // cannot see, hence the one cast.
  const runRow = async (input: TurnInput, origin: "external" | "synthetic"): Promise<Settle | undefined> => {
    const quiet = origin === "external" && input.kind === "event" && input.event.type === "idle"
    for (const cell of rowOf(input)) {
      if (origin === "synthetic" && cell.concurrent !== true) continue
      const concern = concerns[cell.concern] as Concern<SliceKey>
      const advice: Advice = await concern.handle(input, state[cell.concern], viewFor(cell.concern), auditedFx(origin, quiet), ctx)
      if (advice === "consumed") return undefined
      if (advice !== "pass") return advice.settle
    }
    return undefined
  }

  // The spine's own terminal settles (plans/0061 §4.5): an idle whose row
  // runs out without a stop settles the turn naturally, and a stream that
  // exhausts without an idle settles interrupted — no concern owns either.
  const spineSettle = (input: TurnInput): Settle | undefined => {
    if (input.kind === "event" && input.event.type === "idle") return { kind: "natural" }
    if (input.kind === "stream-end") return { kind: "interrupted" }
    return undefined
  }
  const runExternal = async (input: TurnInput): Promise<Settle | undefined> => (await runRow(input, "external")) ?? spineSettle(input)

  // The held settle of a synthetic input, and the trip that preempts the
  // wrapper's wait. Emissions past the wrapper's finish are dropped —
  // today's consuming/probeActive guards.
  let held: Settle | undefined
  let finished = false
  let trip!: () => void
  const tripped = new Promise<void>((resolve) => (trip = resolve))
  let emissions: Promise<unknown> = Promise.resolve()
  const emit = (input: TurnInput): void => {
    if (finished) return
    // Serialized among emissions, never queued behind the external input.
    // An audit throw here rejects the chain — an unhandled rejection, as
    // loud as the programming error it is.
    emissions = emissions.then(async () => {
      const settle = await runRow(input, "synthetic")
      if (settle !== undefined && held === undefined) {
        held = settle
        trip()
      }
    })
  }
  let detach: (() => void) | undefined
  if (args.attach !== undefined) detach = args.attach(emit) ?? undefined

  // The stream wrapper, moved verbatim: the event iterator raced against
  // the trip.
  const raced = (async function* () {
    const inner = stream[Symbol.asyncIterator]()
    try {
      for (;;) {
        const step = await Promise.race([inner.next(), tripped.then((): IteratorResult<AgentEvent> => ({ done: true, value: undefined }))])
        if (step.done) return
        yield step.value
      }
    } finally {
      // The wrapper finished: no emission is handled anymore, and the
      // sources' timers stop. Cleanup skips inner.return() exactly when the
      // turn settled by half-open or by a raised class — the held settle of
      // a synthetic input (a probe verdict judging half-open, a classifier
      // answer raising the class); at every other exit return() drives the
      // inner finally, releasing the reader lock, matching a bare
      // for-await.
      finished = true
      if (detach !== undefined) detach()
      if (held === undefined) await inner.return?.().catch(() => {})
    }
  })()

  let outcome: Settle | undefined
  for await (const event of raced) {
    // A held settle is pending: stop here, as the preemption would have —
    // even when the raced pull had already won against it (the event is
    // consumed and discarded, today's `raised` check at the loop top).
    if (held !== undefined) break
    if (event.session !== ctx.sessionID) continue
    ctx.source.observe(event)
    const settle = await runExternal({ kind: "event", event })
    if (settle !== undefined) {
      outcome = settle
      break
    }
  }
  // Which settle stands. An early settle from an external input's handling
  // (blocked, or the error of a pattern verdict) is fixed the moment its
  // handler returns it — today's inline snapshot exits, which no late raise
  // can overtake. Every other exit defers to a held settle first: a raise
  // or half-open judgment that landed before the boundary wins over the
  // natural finish the body chose (today's tail checks the raised class
  // before the settled flag). A loop that neither settled nor was
  // preempted ended because the stream exhausted: the stream-end input
  // settles it interrupted.
  const settledBy = (): Settle | undefined => {
    if (outcome !== undefined && (outcome.kind === "blocked" || outcome.kind === "error")) return outcome
    return held ?? outcome
  }
  let settle = settledBy()
  if (settle === undefined) {
    // Neither settled nor preempted: the stream exhausted without an idle.
    // The stream-end input settles it (no concern owns that row's terminal;
    // interrupted is the spine's own settle).
    settle = (await runExternal({ kind: "stream-end" })) ?? { kind: "interrupted" }
  }

  // The finalize procedure (plans/0061 §4.4 rule 5): each distinct finalize
  // function once, in table order — the order of its concern's first cell
  // in the table's row order. It runs after the wrapper's cleanup: effects
  // that must precede the cleanup (today's inline aborts of the early
  // error settles) belong in the handler, which returns the settle after
  // making them.
  const finalized = new Set<Concern<SliceKey>["finalize"]>()
  for (const row of Object.values(table)) {
    for (const cell of row) {
      const concern = concerns[cell.concern] as Concern<SliceKey>
      if (concern.finalize === undefined || finalized.has(concern.finalize)) continue
      finalized.add(concern.finalize)
      await concern.finalize(state[cell.concern], viewFor(cell.concern), auditedFx("finalize", false), ctx)
    }
  }
  return { settle, view: liveView }
}
