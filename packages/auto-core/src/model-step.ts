// Context steps (plans/0055 §4.5): one model sold under several ids that
// share a prompt cache and differ only in context window and price form one
// registry entry — `model` is the base step and each `wider` id is the next
// step up. This module holds the pure half of the mechanism: the step-up
// point, the step walk over the live context windows, the step a session's
// context size puts it on, and the startup validation that disables steps
// whose window is unknown or not larger than the one below. The live half
// (reading `contextUsed`, steering the same session onto the next id) is
// watch.ts; the run state of the cache-claim check (`wider` asserts the
// step ids share the base id's prompt cache — the first step-finish on a
// wider id judges it) is the router service's (src/router.ts), so a watch
// instance that ends before the first step-finish does not lose the check.
// Nothing here starts an agent or reads a clock.
//
// Everything takes the windows as a map (the agent's contextLimits() data),
// never reading the agent behind the caller's back, and the planner calls in
// for every pick: `wider` exists only on layered entries — the implicit
// registry's carry none, so their step walk stays at the base and nothing
// observable changes.
// AUTO-DECISION: the module is model-step.ts, in the model-window / model-route family, not steps.ts (src/step.ts is the graceful-exit boundary module of plans/0014; a steps/steps pair would read as one mechanism split in two)
import type { ModelEntry, ModelRegistry } from "./models-schema"
import { formatTokens } from "./session-api"

// The reserve a step keeps between its step-up point and its window (§4.5):
// max(48k, window/5) tokens. The point must come before the agent's own
// auto-compaction threshold (window minus the output reserve), and stepping
// up early is the cheaper mistake — it only costs the price difference for
// the rest of the session.
export const STEP_UP_RESERVE_MIN = 48_000

// What watch needs to know about a registry-driven session's steps and the
// model its steers name (§4.5), passed in by attempt from the chain's pick:
// `name` is the entry's internal name (log lines, the cache-claim key),
// `entry` the registry entry — present only when the pick is one, so a raw
// override value has steps and no cache claim — `step` the step the session
// starts this watch at (0 = base), `model` the id every steer names (the
// reached step's id, the entry's base id, or a raw override value; undefined
// = an entry without `model`, whose steers carry no model key), and `label`
// the task id of the step-up log line.
export type SteerContext = {
  name: string
  entry?: ModelEntry
  step?: number
  model?: string
  label: string
}

// The context size at which a session on a `window`-token step steps up to
// the next one: 204.8k for a 256k step.
export function stepUpPoint(window: number): number {
  return window - Math.max(STEP_UP_RESERVE_MIN, Math.floor(window / 5))
}

// All step ids of an entry, base first; [] when the entry has no model.
export function stepIds(entry: ModelEntry): string[] {
  return entry.model === undefined ? [] : [entry.model, ...(entry.wider ?? [])]
}

// The id of step `step` (0 = base); undefined when the entry has no model.
export function stepId(entry: ModelEntry, step: number): string | undefined {
  return stepIds(entry)[step]
}

// How many of the entry's steps are enabled: each step's window must be
// known and strictly larger than the one below (§4.5 validation). The first
// step that fails disables itself and every step above it, so the session
// stays on the last good id. 1 = the base alone (also the answer for entries
// without steps, and without a model — there is nothing to step).
export function enabledSteps(entry: ModelEntry, limits: ReadonlyMap<string, number>): number {
  const ids = stepIds(entry)
  if (ids.length <= 1) return 1
  let prev = limits.get(ids[0]!)
  let enabled = 1
  for (let step = 1; step < ids.length; step++) {
    const window = limits.get(ids[step]!)
    if (window === undefined || prev === undefined || window <= prev) break
    enabled = step + 1
    prev = window
  }
  return enabled
}

// The step a session with `used` tokens of context is on: the first step
// whose step-up point is not yet reached, within the enabled steps (§4.5's
// resume rule — the step is recomputed from the context size in the
// session's history, never persisted).
export function stepForUsed(entry: ModelEntry, limits: ReadonlyMap<string, number>, used: number): number {
  let step = 0
  while (step + 1 < enabledSteps(entry, limits)) {
    const window = limits.get(stepId(entry, step)!)
    if (window === undefined || used < stepUpPoint(window)) break
    step += 1
  }
  return step
}

// The startup validation of one registry (§4.5, §10 item 13), over the live
// windows of the run's agent: a model id the agent's model list does not
// name is a warning, never an error (some providers load models late), and
// a step whose window is unknown or not larger than the one below disables
// the steps from it upward. `agent` narrows the validation to one profile's
// entries — the agent pool runs it per host, against that host's own model
// list, once the host has started (§8.1); absent = every opencode entry,
// against the one list the single-agent era passed.
// AUTO-RESOLVE: does the missing-id warning fire for every registry model id, including entries on other adapters? -> no, only opencode-adapter entries (the windows come from this run's opencode server; a claude entry's models would always be missing from it, and the validation exists for the steps this run's own agent serves)
// AUTO-RESOLVE: under the agent pool, which host's model list validates a shared entry? -> the profile's own host, and only entries of the host's profile (a second opencode profile runs another server whose list knows nothing of the first's models; validating a foreign profile's entries against it would warn about every one of them)
// AUTO-DECISION: the missing-id warning covers every step id and the base id alike (the design states one rule, "a registry model id missing from contextLimits() is a warning"; a step id is a model id, and naming which id is unknown is what the line is for)
export function stepValidationLines(registry: ModelRegistry, limits: ReadonlyMap<string, number>, agent?: string): string[] {
  const lines: string[] = []
  for (const entry of registry.models.values()) {
    if (registry.agents.get(entry.agent)?.adapter !== "opencode") continue
    if (agent !== undefined && entry.agent !== agent) continue
    const ids = stepIds(entry)
    for (const id of ids) {
      if (!limits.has(id))
        lines.push(
          `⚠ model registry: ${entry.name}: model id ${id} has no known context window (the agent's model list does not name it); its window is unknown for this run`,
        )
    }
    if (ids.length > 1) {
      let prev = limits.get(ids[0]!)
      for (let step = 1; step < ids.length; step++) {
        const window = limits.get(ids[step]!)
        if (window !== undefined && prev !== undefined && window > prev) {
          prev = window
          continue
        }
        const why =
          window === undefined
            ? "has no known context window"
            : prev === undefined
              ? "cannot be compared with the unknown window of the step below"
              : `window ${formatTokens(window)} is not larger than ${formatTokens(prev)} below`
        lines.push(
          `⚠ model registry: ${entry.name}: step ${ids[step]} ${why}; the steps from it upward are disabled, a session of this entry stays on ${ids[step - 1]}`,
        )
        break
      }
    }
  }
  return lines
}

