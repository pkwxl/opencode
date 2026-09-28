// Capability degradation (MA.4, design plans/0040): what the driver does when
// the agent behind the run lacks one of the AgentCapabilities flags. Every
// degradation lands on a path that already exists — most of them are simply
// the "off" side of an experiment switch, so the run start forces that switch
// off (with one log line each) and nothing downstream needs to know why:
//
// | flag off          | degradation                                                           |
//|-------------------|-----------------------------------------------------------------------|
// | resume            | OPENCODE_AUTO_FORK off; sessionAlive answers false, so recovery and  |
// |                   | base reuse start fresh (session-api); --subtask auto's lead gets no  |
// |                   | split clause (as fork "none")                                        |
// | fork "none"       | OPENCODE_AUTO_FORK off; every other fork (retry, failover, shape-check |
// |                   | re-prompt, handover pin) falls back to a new session (forkSession);  |
// |                   | --subtask auto's lead gets no split clause: its streams are forks of |
// |                   | the lead (plans/0059 D7, leadSplit — auto runs as ondemand does)      |
// | fork "session"    | the handover pin fork copies the whole session (anchor dropped)       |
// | steer             | OPENCODE_AUTO_STEER and OPENCODE_AUTO_STUCK off; no length resume;    |
// |                   | --interactive discards typed lines; --test-by-driver has no fallback |
// |                   | (the results go back into the live session) → startup error; with    |
// |                   | the steer off auto's lead gets no split clause either (its criterion |
// |                   | (c) is a usage notice, plans/0059 D7), so the steer note covers it   |
// | question          | OPENCODE_AUTO_ASK off (the ask=off tier: decide and label AUTO-RESOLVE)|
// | permission        | --permission becomes a PermissionPreset fixed at host start           |
// | history           | a session's usage cannot be rebuilt → unknown (session-api)           |
// | abort             | nothing: every abort is already best-effort                           |
//
// The usage tier is MA.2's matrix (src/usage.ts), not repeated here.
//
// Under a model registry several agents serve one run (plans/0055 §8.5), and
// degradeFleet runs once at run start over the intersection of the
// capabilities of every agent that has a candidate in a list after the agent
// filter: each note names the agent that forced it. The intersection is
// simpler and more conservative than per-session degradation (which would
// thread capabilities through every consumer), and choosing a fleet without
// the weak agent is how an operator gets the other behavior back.
import type { AgentCapabilities, PermissionPreset } from "./agent/types"
import type { PermissionMode, SubtaskMode } from "./opts"
import { SWITCH_ENV, type Switches } from "./switches"

// The switches a missing capability can force off.
export type DegradedSwitches = Partial<Pick<Switches, "fork" | "steer" | "stuck" | "ask">>

export type Degradation = {
  // Switch values in force for this run instead of the configured ones.
  switches: DegradedSwitches
  // One line per degradation, logged at run start.
  notes: string[]
  // A configuration with no fallback under this agent: the run does not start
  // (environment error, exit 1).
  error?: string
  // false = the fleet cannot fork a session, so --subtask auto's lead runs
  // without its split clause (plans/0059 D7): the streams of a split are forks
  // of the lead. Absent = the clause may be offered. Not a switch: the pipeline's
  // OPENCODE_AUTO_FORK governs `true` alone (D1), so the run start hands this
  // fact to the task pipeline (Opts.leadSplit) instead of clamping a switch.
  leadSplit?: false
}

// The run-start options degradation reads.
export type DegradeOpts = { permission?: PermissionMode; testByDriver?: boolean; interactive?: boolean; dryrun?: boolean; subtask?: SubtaskMode }

// Whether an agent can fork a session: a copy must exist (fork not "none")
// and the session it copies must still be resumable.
export function forksSessions(caps: AgentCapabilities): boolean {
  return caps.fork !== "none" && caps.resume
}

// --permission for an agent that settles permission requests itself: the
// outcome each mode reaches when no human answers in time (opts.ts
// PermissionMode) — without permission events no human can be asked. The
// dryrun preflight denies and records, as it does with events.
export function permissionPreset(mode: PermissionMode | undefined, dryrun = false): PermissionPreset {
  if (dryrun) return "deny"
  switch (mode ?? "ask-deny") {
    case "auto-allow":
    case "ask-allow":
      return "allow"
    case "ask-deny":
      return "deny"
    case "ask-fail":
      return "block"
  }
}

export function degrade(caps: AgentCapabilities, switches: Switches, opts: DegradeOpts): Degradation {
  // One agent, no labels: today's wording and switches, untouched (a run
  // without a registry never calls degradeAgents with more).
  return degradeAgents([{ caps, label: "" }], switches, opts, false)
}

// One agent of the fleet degradeAgents intersects over: what it can do, and
// how a note names it (`claude (opus)` — the adapter and the first internal
// name that put the profile in the fleet).
export type FleetAgent = {
  caps: AgentCapabilities
  label: string
}

// The fleet intersection (plans/0055 §8.5): a capability every dispatch agent
// must have, or the run starts with the matching degradation — a session can
// land on the weak agent at any dispatch, so the run-wide switches are forced
// off for the whole run, not per session. The capability flags intersect
// pessimistically (the weakest fork granularity wins); the usage tier does
// not intersect — MA.2's matrix reads it off the client that serves each
// session, never the run. `labelNotes` (a registry run) appends the forcing
// agent to each note; the single-agent path keeps today's wording.
export function degradeAgents(agents: FleetAgent[], switches: Switches, opts: DegradeOpts, labelNotes = true): Degradation {
  const forced = (pick: (caps: AgentCapabilities) => boolean): FleetAgent | undefined =>
    agents.find((agent) => pick(agent.caps))
  const caps: AgentCapabilities = {
    resume: !forced((c) => !c.resume),
    fork: forced((c) => c.fork === "none") ? "none" : forced((c) => c.fork === "session") ? "session" : "message",
    steer: !forced((c) => !c.steer),
    abort: !forced((c) => !c.abort),
    question: !forced((c) => !c.question),
    permission: !forced((c) => !c.permission),
    history: !forced((c) => !c.history),
    usage: "events",
  }
  const by = (found: FleetAgent | undefined): string => (labelNotes && found ? `; ${found.label} has none` : "")
  const patch: DegradedSwitches = {}
  const notes: string[] = []
  const forks = forksSessions(caps)
  if (switches.fork && !forks) {
    patch.fork = false
    notes.push(
      `${SWITCH_ENV.fork}=on needs an agent that can fork sessions; running with fork off (each session starts fresh with the full prompt)${by(forced((c) => !forksSessions(c)))}`,
    )
  }
  // auto's split (plans/0059 D7): whatever the switch — it governs the
  // planned pipeline alone — a fleet that cannot fork gets no split clause.
  // The note is auto's (the default mode); every other mode never offers it.
  // AUTO-DECISION: the fork half of D7 adds one note of its own under auto instead of relying on the OPENCODE_AUTO_FORK note (that note is printed only while the switch is on and speaks of the pipeline's sessions); the steer half extends the steer note under auto, since the clamped steer switch already withholds the clause
  const auto = (opts.subtask ?? "auto") === "auto"
  if (!forks && auto) {
    notes.push(
      `--subtask auto: the lead's split needs an agent that can fork sessions (each stream is a fork of the lead); the lead runs without its split clause, as an ondemand session does${by(forced((c) => !forksSessions(c)))}`,
    )
  }
  if (!caps.steer) {
    const named = by(forced((c) => !c.steer))
    if (switches.steer) {
      patch.steer = false
      notes.push(
        `${SWITCH_ENV.steer}=on needs an agent that takes messages mid-turn; running with steer off (no handover hint, a session over the cap finishes naturally${auto ? "; --subtask auto's lead gets no split clause, whose last criterion is a usage notice" : ""})${named}`,
      )
    }
    if (switches.stuck) {
      patch.stuck = false
      notes.push(`${SWITCH_ENV.stuck}: the repetitive-action hint needs an agent that takes messages mid-turn; detection off${named}`)
    }
    if (opts.interactive)
      notes.push(`--interactive: the agent takes no messages mid-turn; typed lines are discarded (answers, /exit and /failback still work)${named}`)
  }
  if (switches.ask && !caps.question) {
    patch.ask = false
    notes.push(
      `${SWITCH_ENV.ask}=on needs an agent that can ask questions; running with ask=off (decisions are made autonomously and labeled AUTO-RESOLVE)${by(forced((c) => !c.question))}`,
    )
  }
  if (!caps.permission) {
    const mode = opts.permission ?? "ask-deny"
    notes.push(
      `the agent settles permission requests itself: --permission ${mode} → ${permissionPreset(mode, opts.dryrun)} (--wait-answer does not apply to them)${by(forced((c) => !c.permission))}`,
    )
  }
  if (!caps.history)
    notes.push(
      `the agent keeps no readable session history: a persisted fork base starts cold, a recovered session's usage counts as unknown${by(forced((c) => !c.history))}`,
    )
  const weakSteer = forced((c) => !c.steer)
  const error =
    opts.testByDriver && !opts.dryrun && !caps.steer
      ? `--test-by-driver needs an agent that takes messages into a live session (the driver feeds test results back that way); this agent cannot${labelNotes && weakSteer ? ` (${weakSteer.label})` : ""}. Re-init the project without --test-by-driver.`
      : undefined
  return { switches: patch, notes, ...(error ? { error } : {}), ...(forks ? {} : { leadSplit: false as const }) }
}
