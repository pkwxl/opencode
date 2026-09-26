// Capability degradation (MA.4, design plans/0040): what the driver does when
// the agent behind the run lacks one of the AgentCapabilities flags. Every
// degradation lands on a path that already exists — most of them are simply
// the "off" side of an experiment switch, so the run start forces that switch
// off (with one log line each) and nothing downstream needs to know why:
//
// | flag off          | degradation                                                           |
// |-------------------|-----------------------------------------------------------------------|
// | resume            | OPENCODE_AUTO_REUSE_SESSION and OPENCODE_AUTO_FORK off; sessionAlive  |
// |                   | answers false, so recovery and base reuse start fresh (session-api)   |
// | fork "none"       | OPENCODE_AUTO_FORK off; every other fork (retry, failover, shape-check |
// |                   | re-prompt, handover pin) falls back to a new session (forkSession)    |
// | fork "session"    | the handover pin fork copies the whole session (anchor dropped)       |
// | steer             | OPENCODE_AUTO_STEER and OPENCODE_AUTO_STUCK off; no length resume;    |
// |                   | --interactive discards typed lines; --test-by-driver has no fallback |
// |                   | (the results go back into the live session) → startup error          |
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
import type { PermissionMode } from "./opts"
import { SWITCH_ENV, type Switches } from "./switches"

// The switches a missing capability can force off.
export type DegradedSwitches = Partial<Pick<Switches, "fork" | "reuseSession" | "steer" | "stuck" | "ask">>

export type Degradation = {
  // Switch values in force for this run instead of the configured ones.
  switches: DegradedSwitches
  // One line per degradation, logged at run start.
  notes: string[]
  // A configuration with no fallback under this agent: the run does not start
  // (environment error, exit 1).
  error?: string
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

export function degrade(
  caps: AgentCapabilities,
  switches: Switches,
  opts: { permission?: PermissionMode; testByDriver?: boolean; interactive?: boolean; dryrun?: boolean },
): Degradation {
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
export function degradeAgents(
  agents: FleetAgent[],
  switches: Switches,
  opts: { permission?: PermissionMode; testByDriver?: boolean; interactive?: boolean; dryrun?: boolean },
  labelNotes = true,
): Degradation {
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
  if (switches.fork && (caps.fork === "none" || !caps.resume)) {
    patch.fork = false
    notes.push(
      `${SWITCH_ENV.fork}=on needs an agent that can fork sessions; running with fork off (each session starts fresh with the full prompt)${by(forced((c) => c.fork === "none" || !c.resume))}`,
    )
  }
  if (switches.reuseSession && !caps.resume) {
    patch.reuseSession = false
    notes.push(`${SWITCH_ENV.reuseSession}=on needs resumable sessions; running with reuse off${by(forced((c) => !c.resume))}`)
  }
  if (!caps.steer) {
    const named = by(forced((c) => !c.steer))
    if (switches.steer) {
      patch.steer = false
      notes.push(
        `${SWITCH_ENV.steer}=on needs an agent that takes messages mid-turn; running with steer off (no handover hint, a session over the cap finishes naturally)${named}`,
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
  return { switches: patch, notes, ...(error ? { error } : {}) }
}
