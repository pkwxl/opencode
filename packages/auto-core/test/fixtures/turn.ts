// Shared doubles for the concern suites (plans/0061 §4.6: a concern suite
// over a fake TurnFx): a TurnFx double that records what a test asserts (the
// call names in order, the log/vlog lines, the steer texts, the model and
// limit observations), a TurnContext stub over the native fake agent with the
// pieces a concern reads injectable, and a view builder for the slices a
// driven concern reads through the spine's read-only reach. Everything a
// concern needs arrives as arguments to its handle — no turn, stream or spine
// is involved.
import type { AgentClient, AgentRetryPolicy } from "../../src/agent/types"
import type { ErrorClass, ErrorInfo } from "../../src/chain"
import type { Classifier } from "../../src/classify"
import type { Handover } from "../../src/handover"
import type { LimitEvent, PendingTest, TurnContext, TurnFx, TurnState, TurnView } from "../../src/engine/contract"
import type { SessionCommit } from "../../src/opts"
import type { SteerContext } from "../../src/model-step"
import type { Opts } from "../../src/opts"
import type { TestRunInfo } from "../../src/prompt"
import { createServices, type RunServices } from "../../src/services"
import { parseSwitches, type Switches } from "../../src/switches"
import type { StuckTracker } from "../../src/stuck"
import type { Steer, TestRun } from "../../src/testrun"
import { usageSource, type UsageSource } from "../../src/usage"
import { fakeAgent } from "./agent"

// A TurnFx double: every member records and resolves trivially. `steerOk`
// steers the steer answer, `human` the askHuman answer (undefined = the
// timeout / closed-channel resolution) and `limits` the contextLimits map
// (the measurement points read the model windows off it), so a suite can
// pin the failure-ignored paths, the human-vs-fallback decisions and the
// window-dependent figures. The test protocol's members take their answers
// the same way — `exists`/`readText` default to nothing-there (a suite
// driving the marker or handover-document checks overrides them, typically
// with the real Bun.file reads over a temporary repository), `commitFreeze`
// the freeze verdict, `runTest` the executed run's record and `resolveTest`
// the pinned pending script — and the kernel calls' arguments are recorded
// (`freezes`, `runs` is implied by `calls`, `handovers`).
export const fakeTurnFx = (
  over: {
    steerOk?: boolean
    human?: string
    limits?: ReadonlyMap<string, number>
    exists?: (path: string) => Promise<boolean>
    readText?: (path: string) => Promise<string>
    commitFreeze?: SessionCommit
    runTest?: TestRunInfo
    resolveTest?: PendingTest | undefined
  } = {},
): TurnFx & {
  calls: string[]
  lines: string[]
  vlogs: string[]
  steers: string[]
  steerModels: (string | undefined)[]
  models: string[]
  limits: LimitEvent[]
  humanAsks: { timeoutMin: number | undefined; hint: string }[]
  questionReplies: { request: string; answers: string[][] }[]
  questionRejects: string[]
  permissionReplies: { request: string; reply: "always" | "reject" }[]
  freezes: number[]
  handovers: Handover[]
} => {
  const calls: string[] = []
  const lines: string[] = []
  const vlogs: string[] = []
  const steers: string[] = []
  const steerModels: (string | undefined)[] = []
  const models: string[] = []
  const limits: LimitEvent[] = []
  const humanAsks: { timeoutMin: number | undefined; hint: string }[] = []
  const questionReplies: { request: string; answers: string[][] }[] = []
  const questionRejects: string[] = []
  const permissionReplies: { request: string; reply: "always" | "reject" }[] = []
  const freezes: number[] = []
  const handovers: Handover[] = []
  const rec = (name: string): void => {
    calls.push(name)
  }
  return {
    calls,
    lines,
    vlogs,
    steers,
    steerModels,
    models,
    limits,
    humanAsks,
    questionReplies,
    questionRejects,
    permissionReplies,
    freezes,
    handovers,
    steer: async (text, model) => {
      rec("steer")
      steers.push(text)
      steerModels.push(model)
      return over.steerOk ?? true
    },
    replyQuestion: async (request, answers) => {
      rec("replyQuestion")
      questionReplies.push({ request, answers })
    },
    rejectQuestion: async (request) => {
      rec("rejectQuestion")
      questionRejects.push(request)
    },
    replyPermission: async (request, reply) => {
      rec("replyPermission")
      permissionReplies.push({ request, reply })
    },
    abort: async () => rec("abort"),
    askHuman: async (timeoutMin, hint) => {
      rec("askHuman")
      humanAsks.push({ timeoutMin, hint })
      return over.human
    },
    contextLimits: async () => (rec("contextLimits"), over.limits ?? new Map<string, number>()),
    readText: async (path) => (rec("readText"), over.readText ? over.readText(path) : ""),
    exists: async (path) => (rec("exists"), over.exists ? over.exists(path) : false),
    commitFreeze: async (n) => (rec("commitFreeze"), freezes.push(n), over.commitFreeze ?? { type: "ok" as const }),
    runTest: async () => (rec("runTest"), over.runTest ?? { script: "t", code: 0, ms: 0, timedOut: false, out: "", seq: 1 }),
    resolveTest: async () => (rec("resolveTest"), over.resolveTest ?? undefined),
    saveHandover: async (record) => {
      rec("saveHandover")
      handovers.push(record)
    },
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
// agent, with the pieces a concern may read (the run options, the retry
// policy, the stuck tracker, the switches, the services — the windows concern
// reads the run's router; the pattern classifier, the failure-message
// classifier's handle and the steer context — the recovery concern's reads;
// the ondemand handover steer and the usage source — the usage concern's
// reads; the test protocol's run record — the test concern's reads)
// injectable.
export const turnContext = (
  over: {
    client?: AgentClient
    opts?: Opts
    policy?: AgentRetryPolicy
    switches?: Switches
    services?: RunServices
    stuck?: StuckTracker
    classify?: (info: ErrorInfo) => ErrorClass
    classifier?: Classifier
    steerContext?: SteerContext
    steer?: Steer
    source?: UsageSource
    test?: TestRun
  } = {},
): TurnContext => ({
  client: over.client ?? fakeAgent().client,
  sessionID: "ses_1",
  opts: over.opts ?? {},
  switches: over.switches ?? parseSwitches({}),
  policy: over.policy ?? { backoffCapMs: 60_000, silenceBudgetMs: 60_000, honorsRetryAfter: false, waitsOutLimit: false },
  classify: over.classify ?? (() => "unknown"),
  source: over.source ?? usageSource("events"),
  services: over.services ?? createServices(),
  startTime: 0,
  ...(over.stuck !== undefined ? { stuck: over.stuck } : {}),
  ...(over.classifier !== undefined ? { classifier: over.classifier } : {}),
  ...(over.steerContext !== undefined ? { steerContext: over.steerContext } : {}),
  ...(over.steer !== undefined ? { steer: over.steer } : {}),
  ...(over.test !== undefined ? { test: over.test } : {}),
})

// A view carrying only the slices a driven concern reads (a suite drives one
// concern at a time; the cast stands in for the spine's full state).
export const viewOver = (slices: Partial<TurnState>): TurnView => slices as TurnView
