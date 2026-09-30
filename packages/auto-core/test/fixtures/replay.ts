// The replay fixture (plans/0061 R4/F1): the proof that the run-events
// journal — the input log at the engine's I/O seam — is a sufficient basis
// for replay. `recordReplayCase` runs one scenario twice over the same
// fake agent, scenario clock and options:
//
// 1. the recorded run — a real `watch()` turn with the journal live
//    (startRunEvents over a temporary directory): the production spine
//    appends the turn's inputs and settle, the production fx appends every
//    call and answer, and the file is read back parsed (the JSONL itself is
//    the replay basis, not an in-memory capture);
// 2. the replay — the same concern install `watch()` builds, driven through
//    `runTurn` with a replay fx whose every answer is served from the
//    journal, the recorded external inputs delivered to the stream at their
//    recorded positions, and the recorded synthetic inputs emitted at
//    theirs. The journal's line order is the spine's own dispatch order, so
//    a synthetic entry between an fx call and its answer was dispatched
//    while that call was in flight — the replay reproduces exactly that.
//
// The replay reproduces the recorded effects exactly when its fx-call
// sequence (member and arguments, in order — the executed effects, log and
// vlog lines included), its settle, and its final Watch equal the recorded
// ones. The replay attaches no sources (the probe timer and the classifier
// ask are the recording's producers; their verdicts arrive as journal
// entries), and its context is the mirror of watch()'s own construction —
// if watch's wiring ever changes in a way the journal cannot serve, the
// comparison fails rather than silently passing.
//
// Determinism premises, the oracle harness's (test/fixtures/turn-trace.ts):
// the scenario clock moves only when the scenario moves it, the stream is
// finite and gated, and everything the replay awaits resolves in
// microtasks — the driver below pumps them through `until` and never waits
// on real time.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentClient, AgentEvent } from "../../src/agent/types"
import { classifySessionError, retryPolicyOf, type Watch } from "../../src/chain"
import { classifierFor } from "../../src/classify"
import { noCommitGit } from "../../src/git-ops"
import { makeLivenessConcern } from "../../src/engine/concerns/liveness"
import { makeRecoveryConcern } from "../../src/engine/concerns/recovery"
import { makeStepUpConcern } from "../../src/engine/concerns/step-up"
import { makeTestConcern } from "../../src/engine/concerns/test"
import type { Settle, PendingTest, TurnContext, TurnFx, TurnInput, TurnState } from "../../src/engine/contract"
import {
  decodeRunValue,
  encodeRunValue,
  FX_SINK_MEMBERS,
  RUN_EVENTS_FILE,
  startRunEvents,
  stopRunEvents,
  type RunEvent,
  type RunFxMember,
} from "../../src/engine/events"
import { settleToWatch } from "../../src/engine/result"
import { runTurn } from "../../src/engine/spine"
import type { SteerContext } from "../../src/model-step"
import type { Opts } from "../../src/opts"
import { createServices, installServices, uninstallServices, type Clock } from "../../src/services"
import { parseSwitches, type Switches } from "../../src/switches"
import type { StuckTracker } from "../../src/stuck"
import type { Steer, TestRun } from "../../src/testrun"
import { usageSource } from "../../src/usage"
import { turnConcerns } from "../../src/watch"
import { fakeAgent, type FakeAgentOptions } from "./agent"
import {
  classifierWiring,
  flush,
  gatedInteractive,
  gate,
  scenarioClock,
  script,
  serializeWatch,
  until,
  type ScenarioHand,
  type SerializedWatch,
} from "./turn-trace"

// One executed effect of the journal: an fx call with its arguments, in the
// order the engine made them.
export type FxEffect = { member: RunFxMember; args: unknown[] }

// One journal fx call with the answer (or rejection) its result entry
// carried; sink members hold none (they answer void and decide nothing).
type RecordedCall = { member: RunFxMember; args: unknown[]; answer?: { kind: "value"; value: unknown } | { kind: "reject"; error: string } }

// What the recorded side answers with: the journal lines of the turn in
// file order, the effects they hold, the settle, and the Watch the recorded
// watch() returned (durationMs dropped, pendingReset resolved — the oracle
// harness's serialization).
export type RecordedTurn = {
  events: RunEvent[]
  effects: FxEffect[]
  settle: Settle
  watch: SerializedWatch
}

// What the replay answers with: the same three figures off the replayed
// turn, so a test compares like with like.
export type ReplayedTurn = { settle: Settle; watch: SerializedWatch; effects: FxEffect[] }

// The replay's own fx answers: a recorded value served back, or a recorded
// rejection re-raised.
type Release = { kind: "value"; value: unknown } | { kind: "reject"; error: string }

// One recorded-and-replayed case: the fake agent's options, the base opts,
// and the scenario body driving `watch()` over a scripted stream (the oracle
// harness's hand; pass `h.switches` as watch's switches argument so the
// replay's context mirror is the same object).
export type ReplayCase = {
  agent?: FakeAgentOptions
  opts?: Opts
  run: (h: ScenarioHand & { switches: Switches }) => Promise<Watch>
}

export type ReplayCaseResult = { recorded: RecordedTurn; replayed: ReplayedTurn }

// Pairs the journal's fx-result / fx-reject entries with their calls: at
// most one answered call is ever in flight (the spine awaits every fx call
// of an external input before the next, and synthetic handlers may not call
// one), so a result entry belongs to the latest answered call still open —
// sink members between never take one.
function callsOf(events: readonly RunEvent[]): RecordedCall[] {
  const calls: RecordedCall[] = []
  for (const entry of events) {
    if (entry.type === "fx") calls.push({ member: entry.member, args: entry.args })
    else if (entry.type === "fx-result" || entry.type === "fx-reject") {
      const answer = entry.type === "fx-result" ? { kind: "value" as const, value: entry.value } : { kind: "reject" as const, error: entry.error }
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i]!.answer !== undefined || FX_SINK_MEMBERS.includes(calls[i]!.member)) continue
        calls[i]!.answer = answer
        break
      }
    }
  }
  return calls
}

// The effects a journal holds: every fx call with its arguments (already in
// their encoded journal form), in order.
function effectsOf(events: readonly RunEvent[]): FxEffect[] {
  return callsOf(events).map(({ member, args }) => ({ member, args }))
}

// The turn's own journal slice: from the turn-start entry on (one watch()
// turn per case; the spine's turn-start entry is the boundary a multi-turn
// reader would split on).
function turnEvents(events: readonly RunEvent[]): RunEvent[] {
  const start = events.findIndex((entry) => entry.type === "turn-start")
  if (start < 0) throw new Error("replay fixture: the journal holds no turn")
  return events.slice(start)
}

// The one settle entry of the turn (the spine records it exactly once).
function settleOf(events: readonly RunEvent[]): Settle {
  const entry = events.find((e) => e.type === "settle")
  if (entry === undefined) throw new Error("replay fixture: the journal holds no settle")
  return entry.settle
}

// Reads the journal file of a recorded run: one JSON entry per line.
export function readRunEvents(dir: string): RunEvent[] {
  const lines = readFileSync(join(dir, RUN_EVENTS_FILE), "utf8").split("\n").filter(Boolean)
  return lines.map((line) => JSON.parse(line) as RunEvent)
}

// Records and replays one case over a temporary directory, and answers both
// sides. `dir` is the journal root (its `.auto/` is created by the journal
// itself; nothing else is written there).
export async function recordReplayCase(dir: string, testCase: ReplayCase): Promise<ReplayCaseResult> {
  // —— The recorded run: a real watch() turn with the journal live ——
  const agent = fakeAgent(testCase.agent)
  const clock = scenarioClock()
  const opts: Opts = { ...(testCase.opts ?? {}) }
  const switches = parseSwitches({})
  const { watch } = await import("../../src/watch")
  installServices(createServices({ clock: clock.clock, git: noCommitGit() }))
  startRunEvents(dir)
  let result: Watch
  try {
    result = await testCase.run({ agent, clock, opts, gate, script, interactive: gatedInteractive, classifier: classifierWiring, switches })
    // Trailing microtasks (a fired probe's reschedule) land while the
    // journal is still live, exactly as the oracle harness lets them.
    await flush()
  } finally {
    stopRunEvents()
    uninstallServices()
  }
  const events = turnEvents(readRunEvents(dir))
  const recorded: RecordedTurn = {
    events,
    effects: effectsOf(events),
    settle: settleOf(events),
    watch: await serializeWatch(result),
  }

  // —— The replay: runTurn over the mirrored install, answers from the log ——
  const replayed = await replayTurn(events, {
    client: agent.client,
    opts,
    switches,
    clock: clock.clock,
  })
  return { recorded, replayed }
}

// The replay side's parameters: everything watch() received besides the
// stream (the scenario's own observation callbacks are not engine inputs —
// the journal's onModel/onLimit entries are the effects, not feeds).
type ReplayArgs = {
  client: AgentClient
  opts: Opts
  switches: Switches
  clock: Clock
  steer?: Steer
  test?: TestRun
  stuck?: StuckTracker
  steerContext?: SteerContext
}

// The gated stream: `pulls` counts next() calls (the driver's signal that
// the spine finished the previous dispatch and waits for the next input —
// the for-await's own pull); the driver releases one recorded external
// input into it at a time.
function gatedStream(): { pulls: () => number; stream: AsyncIterable<AgentEvent, unknown>; release(event: AgentEvent): void; end(): void } {
  let pending: ((result: IteratorResult<AgentEvent>) => void) | undefined
  let pulls = 0
  const iterator: AsyncIterator<AgentEvent> = {
    next: (): Promise<IteratorResult<AgentEvent>> => {
      pulls += 1
      return new Promise((resolve) => {
        pending = resolve
      })
    },
    // The wrapper's cleanup calls return() when the turn settles without a
    // held settle; answer done — the replay stream holds nothing open.
    return: async (): Promise<IteratorResult<AgentEvent>> => ({ done: true, value: undefined }),
  }
  const stream: AsyncIterable<AgentEvent, unknown> = { [Symbol.asyncIterator]: () => iterator }
  return {
    pulls: () => pulls,
    stream,
    release: (event) => {
      const resolve = pending
      pending = undefined
      resolve?.({ done: false, value: event })
    },
    end: () => {
      const resolve = pending
      pending = undefined
      resolve?.({ done: true, value: undefined })
    },
  }
}

// The replay's fx: every member records the call (the effect) and checks it
// against the journal's call at the same position — a divergent member is a
// replay failure on the spot. Answered members wait for the driver to serve
// the recorded answer (the driver reaches the matching fx-result entry at
// the recorded position, after any inputs the journal shows in between);
// the one sync answered member (now) serves its recorded reading directly —
// it cannot wait; sink members record and answer void.
function replayFx(calls: readonly RecordedCall[]): { fx: TurnFx; effects: FxEffect[]; waiters: Array<(r: Release) => void> } {
  const effects: FxEffect[] = []
  let seen = 0
  const waiters: Array<(r: Release) => void> = []
  // Records the call and pairs it with its journal entry by position.
  const note = (member: RunFxMember, args: unknown[]): RecordedCall["answer"] => {
    const idx = seen++
    effects.push({ member, args })
    const recorded = calls[idx]
    if (recorded === undefined || recorded.member !== member) {
      throw new Error(`replay divergence: fx call #${idx + 1} is ${member}, the journal recorded ${recorded?.member ?? "nothing"}`)
    }
    return recorded.answer
  }
  const serve = async (member: RunFxMember, args: unknown[]): Promise<unknown> => {
    const answer = note(member, args)
    const release = await new Promise<Release>((resolve) => {
      waiters.push(resolve)
    })
    if (release.kind === "reject") throw new Error(release.error)
    return decodeRunValue(release.value)
  }
  const fx: TurnFx = {
    steer: async (text, model) => (await serve("steer", [text, model])) as boolean,
    replyQuestion: async (request, answers) => void (await serve("replyQuestion", [request, answers])),
    rejectQuestion: async (request) => void (await serve("rejectQuestion", [request])),
    replyPermission: async (request, reply) => void (await serve("replyPermission", [request, reply])),
    abort: async () => void (await serve("abort", [])),
    askHuman: async (timeoutMin, hint) => (await serve("askHuman", [timeoutMin, hint])) as string | undefined,
    contextLimits: async () => (await serve("contextLimits", [])) as ReadonlyMap<string, number>,
    readText: async (path) => (await serve("readText", [path])) as string,
    exists: async (path) => (await serve("exists", [path])) as boolean,
    commitFreeze: async (n) => (await serve("commitFreeze", [n])) as Awaited<ReturnType<TurnFx["commitFreeze"]>>,
    runTest: async () => (await serve("runTest", [])) as Awaited<ReturnType<TurnFx["runTest"]>>,
    resolveTest: async () => (await serve("resolveTest", [])) as PendingTest | undefined,
    saveHandover: async (record) => void (await serve("saveHandover", [record])),
    statsModelEvent: async (kind) => void (await serve("statsModelEvent", [kind])),
    onModel: (model) => void note("onModel", [model]),
    onLimit: (event) => void note("onLimit", [event]),
    log: (line) => void note("log", [line]),
    vlog: (line) => void note("vlog", [line]),
    now: () => {
      const answer = note("now", [])
      if (answer === undefined || answer.kind !== "value") throw new Error("replay divergence: fx.now has no recorded reading")
      return decodeRunValue(answer.value) as number
    },
  }
  return { fx, effects, waiters }
}

// Replays the journal through the spine: mirrors watch()'s context and
// concern install, drives the recorded inputs in their recorded order and
// answers the effects' results from the log.
async function replayTurn(events: readonly RunEvent[], args: ReplayArgs): Promise<ReplayedTurn> {
  const calls = callsOf(events)
  const start = events.find((e): e is Extract<RunEvent, { type: "turn-start" }> => e.type === "turn-start")
  if (start === undefined) throw new Error("replay fixture: the journal holds no turn-start")
  const { client, opts, switches, steer, test, stuck, steerContext } = args
  // The context mirror of watch()'s construction: the same derivations over
  // the same parameters (the recording's client is reused — capabilities,
  // error patterns and retry policy are read-only facts of it), the turn's
  // start timestamp served from the journal's turn-start entry.
  const services = createServices({ clock: args.clock, git: noCommitGit() })
  const policy = retryPolicyOf(client.retryPolicy, steerContext?.entry?.retry)
  const ctx: TurnContext = {
    client,
    sessionID: start.session,
    opts,
    ...(steer !== undefined ? { steer } : {}),
    ...(test !== undefined ? { test } : {}),
    ...(stuck !== undefined ? { stuck } : {}),
    switches,
    ...(steerContext !== undefined ? { steerContext } : {}),
    policy,
    classify: (info) => classifySessionError(info, client.errorPatterns, policy),
    classifier: classifierFor(client, opts.routing, steerContext?.label, opts.server ? (agent) => opts.server!.client(agent) : undefined),
    source: usageSource(client.capabilities.usage),
    services,
    startTime: start.start,
  }

  // The install watch() builds, minus the sources (the replay's synthetic
  // inputs arrive from the journal through the driver's emit).
  const stepUpLive: { slice?: TurnState["stepUp"] } = {}
  const extended: Parameters<typeof settleToWatch>[2]["extended"] = {}
  const blockedExtra: Parameters<typeof settleToWatch>[2]["blockedExtra"] = {}
  const concerns = turnConcerns(
    makeRecoveryConcern({
      answerWith: () => {
        throw new Error("replay fixture: a classifier ask is not wired into the replay (its answer arrives as a journal input); replay a case without a registry classifier")
      },
      extended,
    }),
    makeLivenessConcern({ extended }),
    makeStepUpConcern({ live: stepUpLive }),
    makeTestConcern({ blockedExtra }),
  )

  const gated = gatedStream()
  const { fx, effects, waiters } = replayFx(calls)
  let emit: ((input: TurnInput) => void) | undefined
  // A replayed turn that fails (a divergence thrown inside an fx call
  // surfaces here) must fail the driver with the real cause, not a wait
  // timeout — the observed copy below carries the error to the conditions.
  let turnError: { error: unknown } | undefined
  const turn = runTurn({
    ctx,
    stream: gated.stream,
    concerns,
    fx,
    attach: (emitInput) => {
      emit = emitInput
      return () => {}
    },
  })
  turn.catch((error: unknown) => {
    turnError = { error }
  })
  const standing = (cond: () => boolean): boolean => {
    if (turnError !== undefined) throw turnError.error
    return cond()
  }

  // The driver: walks the journal in line order and moves the replay to
  // each entry's position. External inputs wait for the spine's pull (the
  // pull follows the previous dispatch's completion — the spine serializes
  // external dispatches itself); synthetic inputs are emitted right where
  // the journal dispatched them (between an fx call and its answer, when
  // the recording fired them mid-flight); fx calls are awaited as effects,
  // and their recorded answers are served when the walk reaches the
  // answer's entry.
  let seenCalls = 0
  let seenPulls = 0
  for (const entry of events) {
    if (entry.type === "turn-start" || entry.type === "settle") continue
    if (entry.type === "input") {
      const input = entry.input
      if (input.kind === "event") {
        // One step at a time: the spine serializes external dispatches, so
        // each recorded external input maps to exactly one further pull
        // (the for-await's pull after the previous dispatch completed).
        const want = seenPulls + 1
        await until(() => standing(() => gated.pulls() >= want), `the spine pulling for the next external input (${input.event.type})`)
        seenPulls = want
        gated.release(input.event)
      } else if (input.kind === "stream-end") {
        gated.end()
      } else {
        const feed = emit
        if (feed === undefined) throw new Error("replay fixture: a synthetic input before the spine attached the emission hook")
        feed(input)
      }
      continue
    }
    if (entry.type === "fx") {
      // One step at a time: several effects may land between two checks
      // here, and an answered call in between needs its release before the
      // replay can make the next call — counting to exactly this entry's
      // call keeps the walk and the served answers in lockstep.
      const want = seenCalls + 1
      await until(() => standing(() => effects.length >= want), `fx call ${want} (${entry.member})`)
      seenCalls = want
      continue
    }
    const answer: Release = entry.type === "fx-result" ? { kind: "value", value: entry.value } : { kind: "reject", error: entry.error }
    const releaseAnswer = waiters.shift()
    if (releaseAnswer === undefined) throw new Error("replay fixture: a journal answer entry with no fx call waiting for it")
    releaseAnswer(answer)
  }
  const outcome = await turn
  const watch = await serializeWatch(settleToWatch(outcome.settle, outcome.view, { extended, blockedExtra }, ctx))
  // The comparison side normalizes the one JSON round-trip difference: an
  // undefined argument serializes to null in the journal.
  return {
    settle: outcome.settle,
    watch,
    effects: effects.map(({ member, args }) => ({ member, args: args.map((arg) => encodeRunValue(arg === undefined ? null : arg)) })),
  }
}
