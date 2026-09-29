// The turn-trace oracle harness (the consolidation program's D0, plans/0061
// §3.3): records what one watch() turn does — every AgentClient call in
// order with its arguments, every log/vlog line with the [HH:MM:SS] prefix
// stripped, and the returned Watch (durationMs dropped, pendingReset awaited
// and inlined) — as one JSON golden per scenario under test/golden/turn/.
// Every engine unit of stage D is gated on these traces staying green.
//
// FREEZE: the traces are recorded from the pre-engine watch() once, before
// stage D starts rewriting it, and are NEVER regenerated during stage D
// (plans/0061 §3.3 and §4.11's hold list): recording is a conscious act
// (UPDATE_TURN_TRACE=1 bun test test/turn-trace.test.ts), never part of a
// normal run, and a mismatch the recorder would paper over is a drift to
// rule on first, not a snapshot to refresh.
//
// Determinism premises every scenario stands on:
// - the scenario clock starts at a fixed instant (TURN_EPOCH) and moves only
//   when the scenario advances it or fires a queued timer, so every
//   timestamp embedded in a captured line (the ISO instants of the retry
//   and probe lines) is a pure function of the script;
// - the stream is a finite scripted async generator whose hold steps the
//   scenario releases: post-steer events never arrive through the fake's
//   own next-tick publish (no turn/steer scripts are handed to the fake),
//   so the stream's next() is pending exactly as long as the scenario
//   holds it;
// - probes fire only when the scenario fires the queued timer; the probe's
//   verdict rides the fake's get (never a real 30 s timeout), and its
//   reschedule lands a few microtasks later — fireProbe() covers both.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, spyOn } from "bun:test"
import type { AgentClient, AgentEvent } from "../../src/agent/types"
import type { Watch } from "../../src/chain"
import type { Interactive } from "../../src/control-types"
import { noCommitGit } from "../../src/git-ops"
import { setVerbose } from "../../src/log"
import type { Opts, ServerControl } from "../../src/opts"
import type { ModelEntry, ModelRegistry } from "../../src/models"
import type { RoutingFacts } from "../../src/routing"
import { createServices, installServices, services, uninstallServices, type Clock } from "../../src/services"
import { autoSwitches } from "../../src/switches"
import { fakeAgent, type FakeAgent, type FakeAgentOptions } from "./agent"

// —— The race-dependent interleavings (the oracle's termination criterion) ——
// Two spots in today's watch() depend on real async timing: the Promise.race
// at the event boundary (the `raced` wrapper) and the probe timer's callback
// running beside the loop body (the classifier answer's `onAnswer` link is
// race 1's settle source, not a third spot — it only feeds trip). A trace is
// a valid oracle only when its scenario forces the outcome deterministically
// or stays away from the race entirely, so every scenario's relationship to
// both races is stated: in its `pins`/`excludes` metadata when it touches
// one (the runner rejects a scenario that declares the same race both ways),
// and otherwise in its family comment in test/turn-trace.test.ts — why
// neither race can materialize there (no settle source, no fired probe
// timer).
//
// 1. held-settle-vs-external — a settle that preempts the event wait
//    (`trip()`: a classifier answer raising the class of a turn that is
//    still retrying, or the probe judging the connection half-open) racing
//    a queued or resolvable external input inside `inner.next()` (the
//    Promise.race of watch's stream wrapper). When both arms are already
//    settled the race resolves by attachment order (the external input
//    wins); the true hazard is both resolving while in flight.
//    Pinned by construction when the scenario's gates leave exactly one
//    arm resolvable: the stream's next event stays behind a hold (so
//    inner.next() is pending and trip is the only arm that can settle), or,
//    inversely, the settle source (the gated classifier client) stays held
//    while the event is consumed. A scenario that would let both resolve in
//    flight is excluded from the oracle, with the reason recorded.
// 2. probe-during-fx — a probe timer firing while the loop body awaits an
//    fx call (a steer dispatch, a human answer, a test run). The probe
//    callback mutates its own counters and logs beside the awaited call and
//    cannot move the loop; only its side effects (a failure line, the
//    half-open trip) matter, and the half-open trip is race 1 again.
//    Pinned by construction when the scenario fires the queued timer at a
//    chosen await point — the fire happens while a gate it controls holds
//    the loop inside the fx call, so no other interleaving exists. A
//    scenario that never fires a probe while an fx call is in flight is
//    unaffected by this race and declares nothing for it.
//
// The freeze census — the enumeration above is the complete one. Read
// against today's watch(): the loop body awaits every fx call inline, so the
// only actors that can run beside it are the probe timer's callback and the
// classifier answer's link, and both meet external inputs only at the
// boundary race; nothing else in the function holds two in-flight promises
// whose resolution order is observable. Of the 58 recorded scenarios, 7 are
// pinned by construction (six on race 1 — the answer row's five and the
// half-open trip; one on race 2 — the probe fired inside the awaited human
// answer) and none is excluded: every race the landed set touches could be
// pinned honestly. A stage-D trace mismatch terminates against this list:
// either the engine reproduces the pinned outcome, or the scenario's pin is
// ruled wrong — never "the race went the other way".
export type RaceKind = "held-settle-vs-external" | "probe-during-fx"
// "how" names the construction that forces the order (which gate holds
// which arm), so a later scenario reuses the pin instead of guessing.
export type RacePin = { race: RaceKind; how: string }
export type RaceExclusion = { race: RaceKind; reason: string }

// The input kinds a scenario's script fires (the arbitration-table rows the
// trace roster reads: every kind must appear in at least one recorded
// trace, and the full cell → scenario map completes when the engine lands).
export type InputKind =
  | "limit"
  | "part"
  | "message"
  | "question"
  | "permission"
  | "error"
  | "retry"
  | "idle"
  | "stream-end"
  | "probe"
  | "answer"

// ---------------------------------------------------------------------------
// The scenario clock: manual time plus a working timer queue
// ---------------------------------------------------------------------------

// The fixed start instant of every trace: log lines embed ISO instants
// derived from the clock, so a fixed epoch keeps them scripted values.
export const TURN_EPOCH = Date.UTC(2026, 8, 29, 0, 0, 0)

export type ScenarioClock = {
  clock: Clock
  // The current virtual instant (epoch ms); scenarios read and move it.
  at: number
  // Advance virtual time without firing any timer.
  advance(ms: number): void
  // Fire every queued timer now, earliest deadline first, moving `at` past
  // each deadline so reads stay monotonic. A fired probe callback is async:
  // its verdict and reschedule land a few microtasks later (fireProbe).
  fire(): void
  // Timers queued and not cancelled.
  queued(): number
}

export function scenarioClock(at: number = TURN_EPOCH): ScenarioClock {
  type Entry = { at: number; fn: () => void; cancelled: boolean }
  const queue: Entry[] = []
  const sc: ScenarioClock = {
    at,
    advance: (ms) => {
      sc.at += ms
    },
    fire: () => {
      const due = queue.splice(0).sort((a, b) => a.at - b.at)
      for (const entry of due) {
        if (entry.cancelled) continue
        if (entry.at > sc.at) sc.at = entry.at
        entry.fn()
      }
    },
    queued: () => queue.filter((entry) => !entry.cancelled).length,
    clock: {
      now: () => sc.at,
      sleep: async (ms) => {
        sc.at += ms
      },
      sleepUnlessExit: async (ms) => {
        sc.at += ms
        return false
      },
      timer: (ms, fn) => {
        const entry: Entry = { at: sc.at + ms, fn, cancelled: false }
        queue.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    },
  }
  return sc
}

// Drain the microtask queue: enough rounds for a fired probe's await chain
// (the fake's get, the count update, the reschedule) to complete. Never
// advances real time — only microtasks run here.
export async function flush(rounds = 16): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

// Fire the queued probe timers and let the probe's async work land (the
// verdict, its log line, the reschedule). The deterministic replacement of
// "waiting for the probe interval".
export async function fireProbe(clock: ScenarioClock): Promise<void> {
  clock.fire()
  await flush()
}

// Pump microtasks until the condition holds: the deterministic stand-in for
// "wait until the turn reached this point" — the condition reads the fake's
// call record (or any other trace-observable state), which only the turn
// itself advances, and everything an in-memory scenario awaits resolves in
// microtasks (no real timers anywhere). Throws rather than hanging when the
// turn never gets there.
export async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    if (cond()) return
    await Promise.resolve()
  }
  throw new Error(`until: ${what} never happened`)
}

// Pump until the condition holds, yielding to the macrotask queue each
// round: the classifier's own fake delivers its reply through the fake's
// setTimeout(0) publish (its only transport — the harness owns the watched
// stream, not the classifier's one-shot session), so anything awaiting the
// classifier's answer must let real timers run; the microtask-only `until`
// would starve the publish and never see the answer land. The timer is
// 0 ms — no wall time is spent, and the answer's arrival point stays
// governed by the scenario's gates, not by the wait.
export async function untilPublished(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    if (cond()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`untilPublished: ${what} never happened`)
}

// ---------------------------------------------------------------------------
// Gates: releasable one-shot promises every pinning construction uses
// ---------------------------------------------------------------------------

export type Gate<T = void> = { promise: Promise<T>; release(value?: T): void }

export function gate<T = void>(): Gate<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, release: (value) => resolve(value as T) }
}

// ---------------------------------------------------------------------------
// The scripted finite stream
// ---------------------------------------------------------------------------

// One step of a scripted stream: an event to yield, or a hold the stream
// suspends on before yielding the next event (post-steer events and other
// scenario-timed arrivals reach the watch only when released — the fake's
// own next-tick publish is never used).
export type StreamStep = AgentEvent | { hold: Promise<unknown> }

export function script(steps: StreamStep[]): AsyncGenerator<AgentEvent, void, unknown> {
  return (async function* () {
    for (const step of steps) {
      if ("hold" in step) await step.hold
      else yield step
    }
  })()
}

// ---------------------------------------------------------------------------
// The gated human input line
// ---------------------------------------------------------------------------

// A releasable Interactive: question() resolves with the answer the scenario
// hands in through reply() (undefined = the closed-input/timeout shape).
// reply() before question() queues the answer (early replies stand).
export function gatedInteractive(): { interactive: Interactive; reply(text: string | undefined): void } {
  const waiting: Array<(text: string | undefined) => void> = []
  const early: Array<string | undefined> = []
  return {
    interactive: {
      attach: () => {},
      close: () => {},
      question: async () => (early.length > 0 ? early.shift()! : await new Promise((resolve) => waiting.push(resolve))),
    },
    reply: (text) => {
      const resolve = waiting.shift()
      if (resolve) resolve(text)
      else early.push(text)
    },
  }
}

// ---------------------------------------------------------------------------
// The classifier wiring: routing facts with a classifier list + a gated
// classifier client reached through opts.server.client
// ---------------------------------------------------------------------------

export function turnEntry(name: string, model: string, fields: Partial<ModelEntry> = {}): ModelEntry {
  return { name, layer: "operator", agent: "opencode", model, ...fields }
}

export type ClassifierOptions = {
  // The classifier fake's own script: its prompt is the classify call, so
  // its turn script answers it (a final text part with the JSON answer).
  agent?: FakeAgentOptions
  // The registry's models; the default trio mirrors the routing-facts
  // pattern of the agent-fake suite (a, b, free).
  entries?: [string, ModelEntry][]
  // The classifier list; the default runs the "free" entry.
  classifierNames?: string[]
}

export type ClassifierWiring = {
  // Hand to opts.routing.
  routing: RoutingFacts
  // Hand to opts.server (watch reaches the classifier's client through
  // server.client only).
  server: ServerControl
  // The classifier's own fake (its calls are its record; see the trace
  // shape note at TurnTrace).
  agent: FakeAgent
  // Let the classifier's bare prompt through. Until release() the classify
  // call sits in the gate — the pin that fixes the answer's arrival at a
  // scenario-chosen moment. Always release before the scenario ends: a
  // call left hanging keeps its one-shot session (and its real 30 s
  // timeout timer) alive past the test.
  release(): void
}

export function classifierWiring(options: ClassifierOptions = {}): ClassifierWiring {
  const entries: [string, ModelEntry][] = options.entries ?? [
    ["a", turnEntry("a", "prov/a")],
    ["b", turnEntry("b", "prov/b")],
    ["free", turnEntry("free", "free/model")],
  ]
  const classifierNames = options.classifierNames ?? ["free"]
  const registry: ModelRegistry = {
    layers: [{ name: "operator", path: "/unused/models.json" }],
    tz: "UTC",
    agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
    models: new Map(entries),
    tiers: { deep: { tier: "deep", names: ["a", "b"], layer: "operator" } },
    routes: new Map(),
    unused: [],
    classifier: { names: classifierNames, layer: "operator" },
  }
  const inner = fakeAgent(options.agent)
  const hold = gate()
  const gated: AgentClient = {
    ...inner.client,
    prompt: async (input, signal) => {
      if (input.bare === true) await hold.promise
      return inner.client.prompt(input, signal)
    },
  }
  return {
    agent: inner,
    release: () => hold.release(),
    routing: {
      registry,
      agentFilter: "opencode",
      filterSource: undefined,
      defaultAgent: "opencode",
      runAgent: "opencode",
      // Read at build time from the installed holder, so the wiring shares
      // the scenario's router and clock (call this inside a scenario body).
      router: services().router,
      clock: services().clock,
    },
    server: {
      client: async () => gated,
      syncContext: async () => {},
      restart: async () => true,
      contextLimits: () => inner.client.contextLimits(),
      close: () => {},
    },
  }
}

// ---------------------------------------------------------------------------
// Capture, serialization, the scenario runner, record/compare
// ---------------------------------------------------------------------------

// The [HH:MM:SS] prefix the foreground stamp adds to every output line;
// real wall time, stripped before anything is compared.
const TS_PREFIX = /^\[\d{2}:\d{2}:\d{2}\] /

function captureLines(): { lines: string[]; restore(): void } {
  const lines: string[] = []
  const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(
      args
        .map(String)
        .join(" ")
        .split("\n")
        .map((line) => line.replace(TS_PREFIX, ""))
        .join("\n"),
    )
  })
  return { lines, restore: () => printed.mockRestore() }
}

// The Watch as stored: durationMs dropped (wall-clock noise), pendingReset
// awaited and inlined (null = resolved to no reset). Every other field
// survives as constructed; undefined-valued keys vanish in JSON, the same
// way on both sides of the comparison.
export type SerializedWatch = Omit<Watch, "durationMs" | "pendingReset"> & { pendingReset?: number | null }

export async function serializeWatch(result: Watch): Promise<SerializedWatch> {
  const { durationMs: _dropped, pendingReset, ...rest } = result
  return pendingReset !== undefined ? { ...rest, pendingReset: (await pendingReset) ?? null } : { ...rest }
}

// One recorded turn. `calls` is the watched client's ordered call record
// (the fake's own list); traffic of auxiliary clients (the classifier's
// own fake, reached through the server indirection) stays on those fakes —
// if a later scenario family needs it in the trace, it joins as a separate
// section, never merged into this list (two clients have no shared order).
export type TurnTrace = {
  calls: { name: string; args: unknown[] }[]
  lines: string[]
  watch: SerializedWatch
}

// What a scenario gets: the fake it drives, the scenario clock, the base
// opts literal it tunes, and the builders above as methods.
export type ScenarioHand = {
  agent: FakeAgent
  clock: ScenarioClock
  opts: Opts
  gate: typeof gate
  script: typeof script
  interactive: typeof gatedInteractive
  classifier: typeof classifierWiring
}

export type TurnScenario = {
  // The golden file name (test/golden/turn/<id>.json); kebab-case, named
  // for the behaviour it pins, prefixed by its family.
  id: string
  kinds: readonly InputKind[]
  pins?: readonly RacePin[]
  excludes?: readonly RaceExclusion[]
  agent?: FakeAgentOptions
  opts?: Opts
  // Drives watch() directly over a scripted stream and returns its Watch.
  // Runs inside the installed window: services over the scenario clock and
  // the no-commit git double, verbose on, capture live.
  run: (h: ScenarioHand) => Promise<Watch>
  // Normalization applied to the built trace before it is recorded or
  // compared (both sides see the same bytes): scenarios over a real
  // temporary repository replace environment noise — the repository's
  // mkdtemp path, a script's wall-clock run time — with fixed tokens
  // (scrubTrace). In-memory scenarios need none.
  scrub?: (trace: TurnTrace) => TurnTrace
}

// Rewrite strings throughout a trace (calls, lines, watch) by replacement
// pairs — the JSON round-trip keeps the shape and touches only string
// content. A RegExp pair must be global: a first-match-only expression
// would silently leave noise in the recorded golden.
export function scrubTrace(trace: TurnTrace, replacements: [from: string | RegExp, to: string][]): TurnTrace {
  let json = JSON.stringify(trace)
  for (const [from, to] of replacements) json = typeof from === "string" ? json.split(from).join(to) : json.replace(from, to)
  return JSON.parse(json) as TurnTrace
}

// Runs one scenario and builds its trace. Installs the scenario's services
// (its own clock, router and the no-commit git double) over the preload's
// holder, captures log/vlog while the turn runs, then restores everything.
// The git service stays the double everywhere here; the test-protocol
// scenarios that need the real repo seam install their own holder around
// their watch call.
export async function runScenario(scenario: TurnScenario): Promise<TurnTrace> {
  for (const pin of scenario.pins ?? []) {
    if ((scenario.excludes ?? []).some((excluded) => excluded.race === pin.race)) {
      throw new Error(`scenario ${scenario.id}: race ${pin.race} is both pinned and excluded`)
    }
  }
  const agent = fakeAgent(scenario.agent)
  const clock = scenarioClock()
  installServices(createServices({ clock: clock.clock, git: noCommitGit() }))
  // Warm the switch memo outside the capture: watch's `switches` parameter
  // defaults to the process-memoized autoSwitches(), whose first call in a
  // process prints the startup switch listing (a vlog), and the turn's
  // frozen switches — the snapshot the question paths read — carry that
  // memo's values. Parsing once here — with the
  // ambient OPENCODE_AUTO_* layer scrubbed for the call — keeps the startup
  // listing off every trace and pins `ask` at its default, whatever the
  // surrounding shell exported (the suite's standing premise is an unset
  // ambient layer; the scrub makes the traces independent of that premise
  // being broken). The scrub spans only this synchronous warm-up.
  const ambient: [string, string | undefined][] = []
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OPENCODE_AUTO_")) {
      ambient.push([key, process.env[key]])
      delete process.env[key]
    }
  }
  try {
    autoSwitches()
  } finally {
    for (const [key, value] of ambient) process.env[key] = value
  }
  const out = captureLines()
  setVerbose(true)
  try {
    const hand: ScenarioHand = {
      agent,
      clock,
      opts: { ...(scenario.opts ?? {}) },
      gate,
      script,
      interactive: gatedInteractive,
      classifier: classifierWiring,
    }
    const result = await scenario.run(hand)
    // Let trailing microtasks (a fired probe's reschedule, a late answer's
    // bookkeeping) land while the capture is still live, then serialize —
    // pendingReset is awaited here, still inside the capture window.
    await flush()
    const trace: TurnTrace = { calls: agent.calls, lines: out.lines, watch: await serializeWatch(result) }
    return scenario.scrub ? scenario.scrub(trace) : trace
  } finally {
    setVerbose(false)
    out.restore()
    uninstallServices()
  }
}

// Record/compare, the UPDATE pattern of test/golden.test.ts: UPDATE_TURN_TRACE=1
// writes the goldens, anything else compares byte-for-byte. See the FREEZE
// note at the top — recording is a stage-boundary act, never routine.
const UPDATE = process.env.UPDATE_TURN_TRACE === "1"
export const TURN_TRACE_DIR = join(import.meta.dir, "..", "golden", "turn")

export function compareTrace(scenario: TurnScenario, trace: TurnTrace): void {
  const file = join(TURN_TRACE_DIR, `${scenario.id}.json`)
  const actual = `${JSON.stringify(trace, null, 2)}\n`
  if (UPDATE) {
    mkdirSync(TURN_TRACE_DIR, { recursive: true })
    writeFileSync(file, actual)
    return
  }
  if (!existsSync(file)) {
    throw new Error(`turn trace missing: ${file} (record once with UPDATE_TURN_TRACE=1; the traces are frozen from the pre-engine watch and are never regenerated during the engine rewrite)`)
  }
  expect(actual, scenario.id).toBe(readFileSync(file, "utf8"))
}
