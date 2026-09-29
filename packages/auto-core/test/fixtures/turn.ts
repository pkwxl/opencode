// Shared doubles for the concern suites (plans/0061 §4.6: a concern suite
// over a fake TurnFx): a TurnFx double that records what a test asserts (the
// call names in order, the log/vlog lines, the steer texts, the model and
// limit observations), a TurnContext stub over the native fake agent with the
// pieces a concern reads injectable, and a view builder for the slices a
// driven concern reads through the spine's read-only reach. Everything a
// concern needs arrives as arguments to its handle — no turn, stream or spine
// is involved.
import type { AgentClient } from "../../src/agent/types"
import type { LimitEvent, TurnContext, TurnFx, TurnState, TurnView } from "../../src/engine/contract"
import { createServices, type RunServices } from "../../src/services"
import { parseSwitches, type Switches } from "../../src/switches"
import type { StuckTracker } from "../../src/stuck"
import { usageSource } from "../../src/usage"
import { fakeAgent } from "./agent"

// A TurnFx double: every member records and resolves trivially. `steerOk`
// steers the steer answer, so a suite can pin the failure-ignored paths.
export const fakeTurnFx = (over: { steerOk?: boolean } = {}): TurnFx & {
  calls: string[]
  lines: string[]
  vlogs: string[]
  steers: string[]
  models: string[]
  limits: LimitEvent[]
} => {
  const calls: string[] = []
  const lines: string[] = []
  const vlogs: string[] = []
  const steers: string[] = []
  const models: string[] = []
  const limits: LimitEvent[] = []
  const rec = (name: string): void => {
    calls.push(name)
  }
  return {
    calls,
    lines,
    vlogs,
    steers,
    models,
    limits,
    steer: async (text) => {
      rec("steer")
      steers.push(text)
      return over.steerOk ?? true
    },
    replyQuestion: async () => rec("replyQuestion"),
    rejectQuestion: async () => rec("rejectQuestion"),
    replyPermission: async () => rec("replyPermission"),
    abort: async () => rec("abort"),
    askHuman: async () => (rec("askHuman"), undefined),
    contextLimits: async () => (rec("contextLimits"), new Map<string, number>()),
    readText: async () => (rec("readText"), ""),
    exists: async () => (rec("exists"), false),
    commitFreeze: async () => (rec("commitFreeze"), { type: "ok" as const }),
    runTest: async () => (rec("runTest"), { script: "t", code: 0, ms: 0, timedOut: false, out: "", seq: 1 }),
    resolveTest: async () => (rec("resolveTest"), undefined),
    saveHandover: async () => rec("saveHandover"),
    statsModelEvent: async () => rec("statsModelEvent"),
    onModel: (model) => {
      rec("onModel")
      models.push(model)
    },
    onLimit: (event) => {
      rec("onLimit")
      limits.push(event)
    },
    log: (line) => {
      rec("log")
      lines.push(line)
    },
    vlog: (line) => {
      rec("vlog")
      vlogs.push(line)
    },
    now: () => 0,
  }
}

// A TurnContext stub: the barest type-legal context over the native fake
// agent, with the pieces a concern may read (the stuck tracker, the switches,
// the services — the windows concern reads the run's router) injectable.
export const turnContext = (over: { client?: AgentClient; switches?: Switches; services?: RunServices; stuck?: StuckTracker } = {}): TurnContext => ({
  client: over.client ?? fakeAgent().client,
  sessionID: "ses_1",
  opts: {},
  switches: over.switches ?? parseSwitches({}),
  policy: { backoffCapMs: 60_000, silenceBudgetMs: 60_000, honorsRetryAfter: false, waitsOutLimit: false },
  classify: () => "unknown",
  source: usageSource("events"),
  services: over.services ?? createServices(),
  startTime: 0,
  ...(over.stuck !== undefined ? { stuck: over.stuck } : {}),
})

// A view carrying only the slices a driven concern reads (a suite drives one
// concern at a time; the cast stands in for the spine's full state).
export const viewOver = (slices: Partial<TurnState>): TurnView => slices as TurnView
