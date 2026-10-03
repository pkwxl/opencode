// OPENCODE_AUTO_* experiment-switch registry — the environment-variable layer (fork-family
// switch design plans/0003-fork-decompose-design.md §4.6, the step switch
// plans/0012-step-mode-design.md): during the experiment period every switch is injected
// via an OPENCODE_AUTO_* env var, parsed once inside the core (memo), consistent across
// the whole pipeline, zero CLI-shell changes (naming follows the OPENCODE_AUTO_SERVER
// precedent, src/server.ts). Never persisted to disk: experiment semantics = this run
// only, unlike a constitutional key's init-time fixation, and within one run the switches
// are constant; promoting a constitutional key (once the experiment settles) is a
// separate matter. The empty string counts as unset; an invalid value throws an error
// message (naming the variable and its expected domain), raised at the runner entry
// (runTask) and turned into exit code 1 on the CLI side — same philosophy as the
// config's "bad file fails strictly".
import { log, vlog } from "./log"
import { PHASE_LETTERS, type PhaseLetter } from "./phases/registry"

// Env-var names of the switches (parsing, startup log and tests reference one source).
export const SWITCH_ENV = {
  fork: "OPENCODE_AUTO_FORK",
  forkBase: "OPENCODE_AUTO_FORK_BASE",
  fine: "OPENCODE_AUTO_DECOMPOSE_FINE",
  steer: "OPENCODE_AUTO_STEER",
  step: "OPENCODE_AUTO_STEP",
  stuck: "OPENCODE_AUTO_STUCK",
  taskContext: "OPENCODE_AUTO_TASK_CONTEXT",
  ask: "OPENCODE_AUTO_ASK",
  model: "OPENCODE_AUTO_MODEL",
  modelFallback: "OPENCODE_AUTO_MODEL_FALLBACK",
  modelFailbackScope: "OPENCODE_AUTO_MODEL_FAILBACK_SCOPE",
  retryWaits: "OPENCODE_AUTO_RETRY_WAITS",
  recoveryWait: "OPENCODE_AUTO_RECOVERY_WAIT",
  strictResume: "OPENCODE_AUTO_STRICT_RESUME",
  hibernate: "OPENCODE_AUTO_HIBERNATE",
  agent: "OPENCODE_AUTO_AGENT",
  // Lane isolation (plans/0068 D10/S2): force lane-per-task execution at one
  // session — the full isolation machinery (per-unit worktree, child worker,
  // the landing protocol) with zero concurrency. The rollout/testing answer to
  // 0036 D13's "plan for parallelism, execute serially" trap.
  laneIsolation: "OPENCODE_AUTO_LANE_ISOLATION",
  // The operator layer of the model registry (src/models.ts): a file path, not
  // a switch. Env-only and empty = unset, like the switches, but parseSwitches
  // does not read it and the switch lines do not list it: the registry's own
  // startup lines name the layers it loaded.
  // AUTO-DECISION: OPENCODE_AUTO_MODELS is registered here but kept out of Switches, nonDefaultSwitches and formatSwitches (every entry of those lines is a parsed switch with a default; a path has neither, and leaving it out keeps the full switch line byte-identical for runs without a registry)
  models: "OPENCODE_AUTO_MODELS",
  // The external opencode server URL (--server's env form): a URL, not a
  // parsed switch, kept out of Switches like models above. Unlike models it
  // has no startup lines of its own, so the non-default startup line names it
  // when set (parseSwitches never reads it; the reads live in
  // src/agent-pool.ts and the opencode adapter, which restates the name the
  // way src/agent/env.ts restates the prefix, being unable to import this
  // registry).
  server: "OPENCODE_AUTO_SERVER",
} as const

// The retired-switch registry: OPENCODE_AUTO_* variables whose mechanism was
// removed. A set variable (the empty string counts as unset, like every
// switch) prints one notice line at run start and changes nothing — a
// notice, never a usage error: switches are per-run experiments read from
// the environment, and a stale shell profile should not cost an unattended
// run. Entries are never removed again; the notice is the contract.
export const RETIRED_SWITCHES: Readonly<Record<string, string>> = {
  // refcheck's master switch: the reference checker (the pre-commit
  // reference auto-correct and the check subcommand's reference scan) was
  // removed, so the variable no longer has anything to gate.
  OPENCODE_AUTO_REF_CHECK: "the reference check was removed",
  // In-chain session reuse: every prompt within a task opens a fresh session
  // by design (the fresh-session-plus-handover pipeline); only interruption
  // recovery's takeover of the recorded session remains, and it never read
  // this switch. The default behavior (no reuse) is unchanged.
  OPENCODE_AUTO_REUSE_SESSION: "in-chain session reuse was removed; every prompt opens a fresh session",
  // Concurrent test handover: the tests always run after the handover
  // close-out now, facing exactly the tree of the handover-confirmation
  // commit instead of the frozen snapshot. The default (sequential) behavior
  // is unchanged.
  OPENCODE_AUTO_HANDOVER_CONCURRENT: "concurrent test handover was removed; the tests run after the handover close-out",
}

// The notice lines the retired switches produce for an environment (pure;
// autoSwitches logs them at the run's first parse, beside the switch lines).
export function retiredSwitchNotes(env: Record<string, string | undefined>): string[] {
  return Object.entries(RETIRED_SWITCHES)
    .filter(([name]) => env[name] !== undefined && env[name] !== "")
    .map(([name, reason]) => `⚠ ${name} is retired (${reason}); the variable is ignored`)
}

// Step mode (OPENCODE_AUTO_STEP) value domain: off never pauses; phase/task/subtask are
// inclusive granularities — the chosen value and every coarser boundary all pause
// (see src/step.ts).
export type StepMode = "off" | "phase" | "task" | "subtask"

// Failback granularity (OPENCODE_AUTO_MODEL_FAILBACK_SCOPE) value domain: after failing
// over to a candidate model, at which boundary to return to the preferred model —
// inclusive granularity, the chosen value and every coarser boundary all reset (same RANK
// idea as step, see src/failback.ts): phase only at phase boundaries (sticky across
// tasks); task (default) = the status quo, the chain's per-task teardown zeroes it
// naturally; subtask adds subtask boundaries; session retries the preferred model at
// every new session start (a migration session forked out by failover does not trigger
// it, to prevent flapping).
export type FailbackScope = "phase" | "task" | "subtask" | "session"

// Digest line-count tier (OPENCODE_AUTO_TASK_CONTEXT) value domain: off is the status quo
// (suggest within 200 lines); small/medium/large loosen per tier (300/400/500 lines, see
// TASK_CONTEXT_LINES in src/prompt.ts) — only the "suggested line count" wording in the
// prompt changes, no code-side truncation or validation (context.md never had a hard
// line limit anyway; exceeding the suggested count is not rejected).
export type TaskContextMode = "off" | "small" | "medium" | "large"

// Session role vocabulary (staged model routing, see plans/0017-model-routing-design.md
// C.1): fixed for the experiment period, no free naming; one-to-one with the B.5
// execution-chain roles, `bypass` as the fallback for bypass sessions given no explicit
// role. Exported as the shared source of truth, for the later P2 (resolveModel / roleOf)
// and the bypass rework to reuse. Since M1.0 the understand/decompose sessions are one
// (plans/0030 D12): the vocabulary no longer contains understand — the merged session
// routes under the decompose role, an understand= key in old config fails strictly as an
// invalid key; verify-*/review-*/final-plan left the table with the three mechanisms'
// retirement (plans/0044 D1), equally strict failures.
export const MODEL_ROLES = [
  "decompose",
  "whole",
  "subtask",
  "wrapup",
  "phase-plan",
  "phase-handover",
  "knowledge",
  "prior-knowledge",
  "implement-scan",
  "number-recovery",
  "bypass",
] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

// Phase letter keys (the OPENCODE_AUTO_MODEL entry list's letter-key domain = the
// phase-type registry's preset letters, see runner's opts.phase).
const MODEL_LETTERS = PHASE_LETTERS
export type ModelLetter = PhaseLetter

// Shape of a phase-type key (the phase directory grammar's type part).
const TYPE_KEY = /^[a-z][a-z0-9-]*$/

// Shape of a registry model's internal name (plans/0055 §4.2): no "/", so a
// bare OPENCODE_AUTO_MODEL value of that shape can only be an internal name.
// Restated here because the registry loader (src/models.ts) imports this
// module, not the other way round.
const INTERNAL_NAME = /^[a-z][a-z0-9.-]*$/

// What parseSwitches needs to know about a loaded model registry (plans/0055
// §9 R7): the internal names a bare OPENCODE_AUTO_MODEL value may take, and
// the tier lists as text for the OPENCODE_AUTO_MODEL_FALLBACK refusal that
// names them. undefined = no layer-backed registry: the switches keep the
// env grammar (values are provider/model, OPENCODE_AUTO_MODEL_FALLBACK
// parses) — exactly the source the implicit registry of a layer-less run
// synthesizes from, so the run start feeds this only when layers exist.
export type SwitchModelRegistry = { names: ReadonlySet<string>; tiers: string }

// Role words of retired sessions (plans/0044 D1): still a strict parse failure,
// not read as phase type ids. Custom type ids may not take them either.
export const RETIRED_MODEL_ROLES = ["verify-judge", "verify-fix", "review-audit", "review-fixrun", "final-plan"] as const

// Custom (project) phase type ids that are role words (live or retired; the
// builtin knowledge type shares its id with the knowledge role by design): as an
// OPENCODE_AUTO_MODEL key such an id reads as the role, so the type could never
// be routed by id. The driver checks this where it loads project types (config
// load, run preflight); [] = none.
export function phaseTypeRoleProblems(types: readonly string[]): string[] {
  const words: readonly string[] = [...MODEL_ROLES, ...RETIRED_MODEL_ROLES]
  return types
    .filter((type) => words.includes(type))
    .map((type) => `phase type "${type}" is a model-routing role word (${SWITCH_ENV.model} keys); rename .opencode/auto/phases/${type}.md`)
}

// Phase-type keys of a model policy that name no known type (run preflight,
// after the project's custom types are loaded); [] = all known.
export function modelTypeProblems(policy: ModelPolicy, types: readonly string[]): string[] {
  return Object.keys(policy.byType)
    .filter((key) => !types.includes(key))
    .map((key) => `env ${SWITCH_ENV.model} key "${key}" names no phase type (known: ${types.join(", ")})`)
}

// The normalized model-routing policy. Defaults wildcard=undefined /
// byLetter={} / byRole={} / fallback=[] mean "unset" — with both env vars
// unset a run dispatches on the agent's default model (the implicit
// registry's entry without a model). Under a layer-backed registry the
// policy is the OPENCODE_AUTO_MODEL override that replaces candidate lists
// (resolveModel, src/chain.ts); under no layers it is the source the
// implicit registry synthesizes from (src/models.ts).
export type ModelPolicy = {
  wildcard?: string
  byLetter: Partial<Record<ModelLetter, string>>
  // Phase-type keys (M3.6): builtin type ids and project custom types. A key
  // is accepted here by shape; the run preflight rejects keys that name no
  // known type (modelTypeProblems), since custom types load per project.
  byType: Record<string, string>
  byRole: Partial<Record<ModelRole, string>>
  fallback: string[]
}

export type Switches = {
  // Master switch of the fork three-segment pipeline: off = the status-quo pipeline (no
  // understand session, no fork), zero behavior change. fork, forkBase and fine
  // govern the planned pipeline alone — the true subtask mode (plans/0059 D1).
  fork: boolean
  // Fork base mode (only meaningful with fork=on): session = the understand session's
  // tail; digest = a fresh base session taking the context.md digest as input (thin
  // prefix, persistently reused across runs once established, deterministically
  // rebuildable from disk when invalidated).
  forkBase: "session" | "digest"
  // Fine-grained decompose: the decompose-<phase> template injects the fine-grained
  // criteria section (still bound by the lower-bound guard). Default off
  // (plans/0059 D9): its premise — a fork pipeline has no fixed cost of
  // re-understanding between subtasks — holds for the session fork base only,
  // not for the digest default, where every subtask re-reads its sources.
  fine: boolean
  // Ondemand context management (default on, plans/0056): the driver steers
  // milestone usage notices into a live ondemand whole-task session, auto's
  // lead (plans/0059 D2) or a stream of its split (D5) at 50%/85% of the
  // effective wall, and the session
  // itself decides when to hand over at a
  // natural boundary (a fresh handoff.md is honored whatever the figure); the
  // hard-wall hint (at the effective wall: 2×cap, raised to a quarter of a
  // large window and clamped to 80% of it, testrun.ts steerWall) stays as the
  // last resort.
  // off disables the whole mechanism — no notices, no hard-wall hint, and a
  // handoff document no longer demanded (a natural finish just wraps up;
  // --handover-test's test handover is an independent mechanism, unaffected).
  steer: boolean
  // Step mode: phase/task/subtask hard-pause at the matching (and coarser) boundaries,
  // waiting for Enter to proceed.
  step: StepMode
  // Stuck-loop detection (default on, see src/stuck.ts): when a session repeats the same
  // action with unchanged results, the driver proactively injects a hint via steer (at
  // most three per session, never aborts the session); off = no detection, no injection.
  // A dryrun preflight session probes permissions by being refused over and over and is
  // never detected (independent of this switch).
  stuck: boolean
  // Digest line-count tier (default off, zero change from the status quo): the
  // small/medium/large tiers loosen context.md's suggested line ceiling (see
  // TASK_CONTEXT_LINES in src/prompt.ts), for enlarging the budget to verify when the
  // digest is suspected over-compressed by the "suggest 200 lines" wording and losing
  // information.
  taskContext: TaskContextMode
  // Question policy (default off, zero change from the status quo; design
  // plans/0020-auto-resolve-design.md §E): off = suppress — never call the question tool
  // for non-permission questions, decide autonomously; every divergence point that
  // should have been asked about but was not is forcibly marked AUTO-RESOLVE, pure
  // engineering trade-offs are marked AUTO-DECISION; on = allow — proactively ask via
  // the question tool at divergence points whose decision belongs to the user, decide
  // pure implementation means autonomously with no markers required (a question is an
  // event flowing through the driver; observing it there makes the proxy-answer record
  // complete). Question policy and marking duty advance and retreat together, toggled
  // by this one switch, not split into two independent booleans.
  ask: boolean
  // Staged model routing + quota failover candidates (default unset = zero change from
  // the status quo): OPENCODE_AUTO_MODEL is normalized into wildcard/byLetter/byRole,
  // OPENCODE_AUTO_MODEL_FALLBACK's ordered candidates fold into fallback. The actual
  // evaluation and the failover action land in P2/P4; this layer only parses, validates
  // and logs them.
  model: ModelPolicy
  // Failback granularity (default task = zero change from the status quo): at which
  // boundary to reset back to the preferred model after failover, see FailbackScope and
  // src/failback.ts; the /failback command's runtime override does not pass through this
  // layer (run state in the router service).
  modelFailbackScope: FailbackScope
  // Retry ladder for transient session errors (OPENCODE_AUTO_RETRY_WAITS, comma-separated
  // minutes): each element is "the wait before that retry", the element count is the
  // retry cap. Default 0,1,2,4,8 = five retries, the first immediate, then 1/2/4/8
  // minutes. off = no retries (the first failure goes straight into the wait-and-probe
  // loop).
  retryWaits: number[]
  // Wait-and-probe loop interval in minutes (OPENCODE_AUTO_RECOVERY_WAIT): session
  // failures (the non-retryable quota class, the transient class with its ladder
  // exhausted, failover candidates used up) are never a blocked exit anymore; instead
  // they wait indefinitely at this interval, each round dispatching a minimal probe
  // prompt in a fresh temporary session; once a probe succeeds (service recovered) the
  // interrupted session is forked to continue. During the wait two consecutive Ctrl+C
  // force-quit (130) via the process-level SIGINT handler.
  recoveryWait: number
  // Strict resume (plans/0022-session-recovery-fidelity-design.md; default on since
  // 2026-10 — promoted by ruling P-1 of plans/0070 after the gray rollout: 20-test
  // coverage, 17+ days gray, no field incidents; the env override
  // OPENCODE_AUTO_STRICT_RESUME=off stays as the emergency-off, retiring the knob
  // entirely is a later, separately ruled unit): on adds the unit baseline and the
  // effective model to the progress
  // record and verifies them at recovery (a foreign commit mixed in goes dirty; model
  // mismatch / dead session / --new-session rolls back to the unit baseline and reruns),
  // converges the reused session's recovery note to a single continue sentence, and
  // rolls back on the first invalid handover document. With the gates off (--commit
  // false/dryrun) the runner side idles it entirely (the record carries no new fields).
  strictResume: boolean
  // Hibernation window (avoiding LLM high-tariff hours, plans/0027-hibernate-design.md,
  // default undefined = no hibernation, zero change from the status quo):
  // OPENCODE_AUTO_HIBERNATE="HH:MM+H" (a daily UTC window, H hours may be fractional).
  // "Am I inside the window now" is checked only at the three existing safe boundaries
  // (phase/task/subtask, same hook points as step.ts) and at startup — inside the window
  // it sleeps to the window end + a fixed random 0~600 seconds before continuing; a
  // unit mid-execution stops only at the boundary it reaches, naturally "gracefully
  // waiting for the current task/subtask to reach a safe exit point before pausing". It
  // does not predict the next unit and persists nothing.
  hibernate: HibernateWindow | undefined
  // Override of the project's coding agent (MA.5 plans/0041; M6.1): opencode
  // or claude (the headless adapter, src/agent/claude/). undefined = unset —
  // the project config's `agent` key decides (absent = opencode). A shell
  // whose profile names an agent (setShellProfile `agent`) overrides both.
  agent: AgentChoice | undefined
  // Lane isolation (OPENCODE_AUTO_LANE_ISOLATION, plans/0068 D10/S2, default
  // off = zero change from the status quo): on routes the task loop through
  // one-lane-at-a-time — every task of the routed phase runs in its own
  // worktree through its own worker process and lands through the merge
  // protocol, still strictly serially. The isolation rollout stage of the
  // lanes design: full machinery, zero concurrency, per-run only.
  laneIsolation: boolean
}

export type AgentChoice = "opencode" | "claude"

// Hibernate window (OPENCODE_AUTO_HIBERNATE's normalized shape): startMin = the UTC
// window start (minutes into the day, ∈ [0,1440)); durationMin = the length (minutes,
// ∈ (0,1440), fractions allowed). Crossing midnight (e.g. 22:00+8) is handled by the
// consumer with modulo. Parsing lives in parseSwitches's hibernate section.
export type HibernateWindow = { startMin: number; durationMin: number }

const SWITCH_DEFAULTS: Switches = {
  fork: true,
  forkBase: "digest",
  fine: false,
  steer: true,
  step: "off",
  stuck: true,
  taskContext: "off",
  ask: false,
  model: { byLetter: {}, byType: {}, byRole: {}, fallback: [] },
  modelFailbackScope: "task",
  retryWaits: [0, 1, 2, 4, 8],
  recoveryWait: 30,
  strictResume: true,
  hibernate: undefined,
  agent: undefined,
  laneIsolation: false,
}

// Normalize OPENCODE_AUTO_MODEL / _FALLBACK into a ModelPolicy (pure function, for unit
// tests). Two shapes: a bare value prov/model is equivalent to a full override
// (*=prov/model); an entry list `key=prov/model` comma-separated, keys ∈ {* ∪ phase
// letters ∪ the role vocabulary}, the in-entry separator being = not : (a model id may
// contain a colon). Values must contain /; the empty string counts as unset. Bad values
// fail strictly: throws an error message (naming the variable, an example, the offending
// key/value).
// Under a layer-backed registry (registry info given, plans/0055 §9 R7) a
// value is additionally allowed to be a bare internal model name: it must
// match the internal-name shape and be one of the registry's names, and an
// unknown bare name is refused listing the known ones. Without the registry
// info the bare name keeps its refusal — the env values are provider/model,
// which is what the implicit registry of a layer-less run synthesizes its
// entries from.
// AUTO-DECISION: the registry acceptance lives in the parse itself, not in a post-parse check (a value that parses differently depending on the registry cannot first parse "provisionally" and be validated later; the run start loads the registry before the switches are first parsed and feeds this flag through setSwitchModelRegistry)
function parseModelPolicy(
  rawModel: string | undefined,
  rawFallback: string | undefined,
  registry: SwitchModelRegistry | undefined,
): ModelPolicy {
  const policy: ModelPolicy = { byLetter: {}, byType: {}, byRole: {}, fallback: [] }
  const modelExample = "*=kimi/k2,m=anthropic/c-4,wrapup=kimi/k2-lite"
  // A value without "/": an internal name under a registry, a refusal without one.
  const valueProblem = (value: string, key?: string): string | undefined => {
    if (value.includes("/")) return undefined
    if (registry === undefined)
      return `env ${SWITCH_ENV.model} invalid value: "${value}" (${key !== undefined ? `model for key "${key}"` : "bare value"} must be provider/model with a slash${key === undefined ? ", or use entry-list key=prov/model" : ""}; example ${modelExample})`
    if (INTERNAL_NAME.test(value) && registry.names.has(value)) return undefined
    const known = [...registry.names].join(", ")
    return `env ${SWITCH_ENV.model} invalid value: "${value}" (under a model registry a value is an internal model name or provider/model with a slash${known ? `; known internal names: ${known}` : "; the registry declares no models"})`
  }
  const modelRaw = rawModel === undefined || rawModel === "" ? undefined : rawModel
  if (modelRaw !== undefined) {
    if (modelRaw.includes("=")) {
      // Entry-list shape: key=value per item.
      for (const entry of modelRaw.split(",")) {
        const idx = entry.indexOf("=")
        if (idx < 0) {
          throw new Error(
            `env ${SWITCH_ENV.model} invalid entry: "${entry}" (entry-list form requires key=prov/model per item; example ${modelExample})`,
          )
        }
        const key = entry.slice(0, idx)
        const value = entry.slice(idx + 1)
        const problem = valueProblem(value, key)
        if (problem !== undefined) throw new Error(problem)
        if (key === "*") policy.wildcard = value
        else if ((MODEL_LETTERS as readonly string[]).includes(key)) policy.byLetter[key as ModelLetter] = value
        else if ((MODEL_ROLES as readonly string[]).includes(key)) policy.byRole[key as ModelRole] = value
        else if (TYPE_KEY.test(key) && !(RETIRED_MODEL_ROLES as readonly string[]).includes(key)) policy.byType[key] = value
        else {
          throw new Error(
            `env ${SWITCH_ENV.model} invalid key: "${key}" (expected *, a phase letter ${MODEL_LETTERS.join("|")}, a role word ${MODEL_ROLES.join("|")}, or a phase type id; example ${modelExample})`,
          )
        }
      }
    } else {
      // Bare-value shape: full override.
      const problem = valueProblem(modelRaw)
      if (problem !== undefined) throw new Error(problem)
      policy.wildcard = modelRaw
    }
  }
  const fallbackRaw = rawFallback === undefined || rawFallback === "" ? undefined : rawFallback
  if (fallbackRaw !== undefined) {
    // Under a registry the tier lists are the failover order (plans/0055 §9):
    // the global ring is a usage error naming them.
    if (registry !== undefined) {
      throw new Error(
        `env ${SWITCH_ENV.modelFallback} is not used under a model registry: the tier lists are the failover order (${registry.tiers})`,
      )
    }
    // Ordered candidate list prov/a,prov/b; empty/unset = no failover (empty array).
    for (const item of fallbackRaw.split(",")) {
      if (!item.includes("/")) {
        throw new Error(
          `env ${SWITCH_ENV.modelFallback} invalid value: "${item}" (candidates must be provider/model, a comma-separated ordered list; example prov/a,prov/b)`,
        )
      }
      policy.fallback.push(item)
    }
  }
  return policy
}

// Derive the OPENCODE_AUTO_MODEL env value back from the policy (for the startup log):
// renders the entry list in the fixed stable order wildcard → letters → roles; with all
// three empty it returns the empty string (counts as unset).
function renderModelEnv(policy: ModelPolicy): string {
  const parts: string[] = []
  if (policy.wildcard !== undefined) parts.push(`*=${policy.wildcard}`)
  for (const letter of MODEL_LETTERS) {
    const value = policy.byLetter[letter]
    if (value !== undefined) parts.push(`${letter}=${value}`)
  }
  for (const [type, value] of Object.entries(policy.byType)) parts.push(`${type}=${value}`)
  for (const role of MODEL_ROLES) {
    const value = policy.byRole[role]
    if (value !== undefined) parts.push(`${role}=${value}`)
  }
  return parts.join(",")
}

// Canonical spelling of a hibernate window (startup log and unit tests share one
// source): HH:MM+H (HH zero-padded to two digits, H is the hours, fractions render
// as-is); undefined (unset) returns the empty string (counts as unset).
export function formatHibernate(window: HibernateWindow | undefined): string {
  if (window === undefined) return ""
  const hh = String(Math.floor(window.startMin / 60)).padStart(2, "0")
  const mm = String(window.startMin % 60).padStart(2, "0")
  return `${hh}:${mm}+${window.durationMin / 60}`
}

// Parse OPENCODE_AUTO_HIBERNATE (pure function): "HH:MM+H" — a daily UTC window, H being
// the hours (fractions allowed, e.g. 6.5). Empty/unset = undefined (no hibernation); bad
// values fail strictly: throws an error message (naming the variable, the expected
// domain and an example).
function parseHibernate(raw: string | undefined): HibernateWindow | undefined {
  if (raw === undefined || raw === "") return undefined
  const match = /^(\d{1,2}):(\d{2})\+(\d+(?:\.\d+)?)$/.exec(raw)
  if (!match) {
    throw new Error(
      `env ${SWITCH_ENV.hibernate} invalid value: "${raw}" (expected HH:MM+H — UTC start + hibernate hours, e.g. 04:00+6, 22:00+8.5; empty string = unset, default no hibernation)`,
    )
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  const hours = Number(match[3])
  if (hour > 23 || minute > 59 || !(hours > 0) || hours >= 24) {
    throw new Error(
      `env ${SWITCH_ENV.hibernate} invalid value: "${raw}" (HH ∈ 00..23, MM ∈ 00..59, H ∈ (0,24) hours; example 04:00+6)`,
    )
  }
  return { startMin: hour * 60 + minute, durationMin: hours * 60 }
}

// Parse (pure function, for unit tests): env is process.env or a test-built record; an
// empty-string value counts as unset (default taken), an invalid value throws an error
// message. registry is the loaded model registry's switch-facing facts (undefined =
// none): they widen OPENCODE_AUTO_MODEL's value grammar to internal names and refuse
// OPENCODE_AUTO_MODEL_FALLBACK (plans/0055 §9 R7).
export function parseSwitches(env: Record<string, string | undefined>, registry?: SwitchModelRegistry): Switches {
  const onOff = (name: string, raw: string | undefined, fallback: boolean): boolean => {
    const value = raw === undefined || raw === "" ? (fallback ? "on" : "off") : raw
    if (value !== "on" && value !== "off") {
      throw new Error(`env ${name} invalid value: "${raw}" (expected on|off; empty string = unset, default ${fallback ? "on" : "off"})`)
    }
    return value === "on"
  }
  // Minute ladder: off = empty list (no retries); otherwise comma-separated non-negative
  // minutes (fractions allowed, so unit tests can take sub-minute values). The empty
  // string counts as unset.
  const waitList = (name: string, raw: string | undefined, fallback: number[]): number[] => {
    if (raw === undefined || raw === "") return fallback
    if (raw === "off") return []
    const parts = raw.split(",").map((part) => part.trim())
    return parts.map((part) => {
      const value = Number(part)
      if (part === "" || !Number.isFinite(value) || value < 0) {
        throw new Error(`env ${name} invalid value: "${raw}" (expected off or comma-separated non-negative minutes, e.g. 0,1,2,4,8; empty string = unset)`)
      }
      return value
    })
  }
  const minutes = (name: string, raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw === "") return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`env ${name} invalid value: "${raw}" (expected non-negative minutes, 0 = no wait; empty string = unset, default ${fallback})`)
    }
    return value
  }
  const forkBaseRaw = env[SWITCH_ENV.forkBase]
  const forkBase = forkBaseRaw === undefined || forkBaseRaw === "" ? SWITCH_DEFAULTS.forkBase : forkBaseRaw
  if (forkBase !== "session" && forkBase !== "digest") {
    throw new Error(`env ${SWITCH_ENV.forkBase} invalid value: "${forkBaseRaw}" (expected session|digest; empty string = unset, default digest)`)
  }
  const stepRaw = env[SWITCH_ENV.step]
  const step = stepRaw === undefined || stepRaw === "" ? SWITCH_DEFAULTS.step : stepRaw
  if (step !== "off" && step !== "phase" && step !== "task" && step !== "subtask") {
    throw new Error(
      `env ${SWITCH_ENV.step} invalid value: "${stepRaw}" (expected off|phase|task|subtask; empty string = unset, default off)`,
    )
  }
  const taskContextRaw = env[SWITCH_ENV.taskContext]
  const taskContext = taskContextRaw === undefined || taskContextRaw === "" ? SWITCH_DEFAULTS.taskContext : taskContextRaw
  if (taskContext !== "off" && taskContext !== "small" && taskContext !== "medium" && taskContext !== "large") {
    throw new Error(
      `env ${SWITCH_ENV.taskContext} invalid value: "${taskContextRaw}" (expected off|small|medium|large; empty string = unset, default off)`,
    )
  }
  const failbackScopeRaw = env[SWITCH_ENV.modelFailbackScope]
  const modelFailbackScope =
    failbackScopeRaw === undefined || failbackScopeRaw === "" ? SWITCH_DEFAULTS.modelFailbackScope : failbackScopeRaw
  if (
    modelFailbackScope !== "phase" &&
    modelFailbackScope !== "task" &&
    modelFailbackScope !== "subtask" &&
    modelFailbackScope !== "session"
  ) {
    throw new Error(
      `env ${SWITCH_ENV.modelFailbackScope} invalid value: "${failbackScopeRaw}" (expected phase|task|subtask|session; empty string = unset, default task)`,
    )
  }
  const agentRaw = env[SWITCH_ENV.agent]
  const agent = agentRaw === undefined || agentRaw === "" ? SWITCH_DEFAULTS.agent : agentRaw
  if (agent !== undefined && agent !== "opencode" && agent !== "claude") {
    throw new Error(`env ${SWITCH_ENV.agent} invalid value: "${agentRaw}" (expected opencode|claude; empty string = unset, the project config decides)`)
  }
  return {
    fork: onOff(SWITCH_ENV.fork, env[SWITCH_ENV.fork], SWITCH_DEFAULTS.fork),
    forkBase: forkBase as Switches["forkBase"],
    fine: onOff(SWITCH_ENV.fine, env[SWITCH_ENV.fine], SWITCH_DEFAULTS.fine),
    steer: onOff(SWITCH_ENV.steer, env[SWITCH_ENV.steer], SWITCH_DEFAULTS.steer),
    step: step as StepMode,
    stuck: onOff(SWITCH_ENV.stuck, env[SWITCH_ENV.stuck], SWITCH_DEFAULTS.stuck),
    taskContext: taskContext as TaskContextMode,
    ask: onOff(SWITCH_ENV.ask, env[SWITCH_ENV.ask], SWITCH_DEFAULTS.ask),
    model: parseModelPolicy(env[SWITCH_ENV.model], env[SWITCH_ENV.modelFallback], registry),
    modelFailbackScope: modelFailbackScope as FailbackScope,
    retryWaits: waitList(SWITCH_ENV.retryWaits, env[SWITCH_ENV.retryWaits], SWITCH_DEFAULTS.retryWaits),
    recoveryWait: minutes(SWITCH_ENV.recoveryWait, env[SWITCH_ENV.recoveryWait], SWITCH_DEFAULTS.recoveryWait),
    strictResume: onOff(SWITCH_ENV.strictResume, env[SWITCH_ENV.strictResume], SWITCH_DEFAULTS.strictResume),
    hibernate: parseHibernate(env[SWITCH_ENV.hibernate]),
    agent,
    laneIsolation: onOff(SWITCH_ENV.laneIsolation, env[SWITCH_ENV.laneIsolation], SWITCH_DEFAULTS.laneIsolation),
  }
}

// Canonical spelling of the ladder (logging and default comparison share one source):
// an empty list renders as off.
function formatWaits(waits: number[]): string {
  return waits.length ? waits.join(",") : "off"
}

// Non-default effective items (startup log): a comma list of `name=value` entries; the
// default combination returns undefined (silent). The external server URL is
// not a parsed switch (see SWITCH_ENV.server), so it is read from `env`
// (process.env in the run) and named only when set — unset or empty keeps the
// line byte-identical with a run that does not reuse a server.
export function nonDefaultSwitches(switches: Switches, env: Record<string, string | undefined> = process.env): string | undefined {
  const items = [
    switches.fork === SWITCH_DEFAULTS.fork ? undefined : `${SWITCH_ENV.fork}=${switches.fork ? "on" : "off"}`,
    switches.forkBase === SWITCH_DEFAULTS.forkBase ? undefined : `${SWITCH_ENV.forkBase}=${switches.forkBase}`,
    switches.fine === SWITCH_DEFAULTS.fine ? undefined : `${SWITCH_ENV.fine}=${switches.fine ? "on" : "off"}`,
    switches.steer === SWITCH_DEFAULTS.steer ? undefined : `${SWITCH_ENV.steer}=${switches.steer ? "on" : "off"}`,
    switches.step === SWITCH_DEFAULTS.step ? undefined : `${SWITCH_ENV.step}=${switches.step}`,
    switches.stuck === SWITCH_DEFAULTS.stuck ? undefined : `${SWITCH_ENV.stuck}=${switches.stuck ? "on" : "off"}`,
    switches.taskContext === SWITCH_DEFAULTS.taskContext ? undefined : `${SWITCH_ENV.taskContext}=${switches.taskContext}`,
    switches.ask === SWITCH_DEFAULTS.ask ? undefined : `${SWITCH_ENV.ask}=${switches.ask ? "on" : "off"}`,
    (() => {
      const routing = renderModelEnv(switches.model)
      return routing === "" ? undefined : `${SWITCH_ENV.model}=${routing}`
    })(),
    switches.model.fallback.length ? `${SWITCH_ENV.modelFallback}=${switches.model.fallback.join(",")}` : undefined,
    switches.modelFailbackScope === SWITCH_DEFAULTS.modelFailbackScope
      ? undefined
      : `${SWITCH_ENV.modelFailbackScope}=${switches.modelFailbackScope}`,
    formatWaits(switches.retryWaits) === formatWaits(SWITCH_DEFAULTS.retryWaits) ? undefined : `${SWITCH_ENV.retryWaits}=${formatWaits(switches.retryWaits)}`,
    switches.recoveryWait === SWITCH_DEFAULTS.recoveryWait ? undefined : `${SWITCH_ENV.recoveryWait}=${switches.recoveryWait}`,
    switches.strictResume === SWITCH_DEFAULTS.strictResume ? undefined : `${SWITCH_ENV.strictResume}=${switches.strictResume ? "on" : "off"}`,
    switches.hibernate === undefined ? undefined : `${SWITCH_ENV.hibernate}=${formatHibernate(switches.hibernate)}`,
    switches.agent === undefined ? undefined : `${SWITCH_ENV.agent}=${switches.agent}`,
    switches.laneIsolation === SWITCH_DEFAULTS.laneIsolation ? undefined : `${SWITCH_ENV.laneIsolation}=${switches.laneIsolation ? "on" : "off"}`,
    env[SWITCH_ENV.server] ? `${SWITCH_ENV.server}=${env[SWITCH_ENV.server]}` : undefined,
  ].filter((item): item is string => item !== undefined)
  return items.length ? items.join(", ") : undefined
}

// Full switch description (verbose log; same `name=value` shape as the non-default
// list).
export function formatSwitches(switches: Switches): string {
  return [
    `${SWITCH_ENV.fork}=${switches.fork ? "on" : "off"}`,
    `${SWITCH_ENV.forkBase}=${switches.forkBase}`,
    `${SWITCH_ENV.fine}=${switches.fine ? "on" : "off"}`,
    `${SWITCH_ENV.steer}=${switches.steer ? "on" : "off"}`,
    `${SWITCH_ENV.step}=${switches.step}`,
    `${SWITCH_ENV.stuck}=${switches.stuck ? "on" : "off"}`,
    `${SWITCH_ENV.taskContext}=${switches.taskContext}`,
    `${SWITCH_ENV.ask}=${switches.ask ? "on" : "off"}`,
    `${SWITCH_ENV.model}=${renderModelEnv(switches.model)}`,
    `${SWITCH_ENV.modelFallback}=${switches.model.fallback.join(",")}`,
    `${SWITCH_ENV.modelFailbackScope}=${switches.modelFailbackScope}`,
    `${SWITCH_ENV.retryWaits}=${formatWaits(switches.retryWaits)}`,
    `${SWITCH_ENV.recoveryWait}=${switches.recoveryWait}`,
    `${SWITCH_ENV.strictResume}=${switches.strictResume ? "on" : "off"}`,
    `${SWITCH_ENV.hibernate}=${formatHibernate(switches.hibernate)}`,
    `${SWITCH_ENV.agent}=${switches.agent ?? ""}`,
    `${SWITCH_ENV.laneIsolation}=${switches.laneIsolation ? "on" : "off"}`,
  ].join(", ")
}

let memo: Switches | undefined

// The registry facts the run start hands the switches (plans/0055 §9 R7):
// set once by preflight after the model registry loads and before the
// switches are first parsed, so a run under a registry accepts internal
// names in OPENCODE_AUTO_MODEL and refuses OPENCODE_AUTO_MODEL_FALLBACK.
// undefined (or a run that loads no registry layer) keeps the env grammar —
// the implicit registry of a layer-less run is synthesized FROM the switches,
// so it must never feed them. Commands that never load a registry never call
// this, and their parse stays exactly as before.
let modelRegistry: SwitchModelRegistry | undefined

// Resets the memo so the next autoSwitches() re-parses with the declared
// facts. Every declaration resets: each run start parses its own snapshot
// (a process that runs twice — tests — must never carry one run's frozen
// snapshot into the next run's degradation clamp), and the fresh registry
// info each preflight builds makes the reset the rule, not the guard it
// once was (a facts-change check would let an unchanged undefined keep a
// previous run's memo alive).
export function setSwitchModelRegistry(registry: SwitchModelRegistry | undefined): void {
  modelRegistry = registry
  memo = undefined
}

// Runtime switch access (memoized once, consistent across the whole pipeline): the
// first call parses process.env — an invalid value throws there, and the outermost
// caller (the CLI) turns it into exit code 1; it also lists the non-default effective
// items in the startup log (default combination silent, verbose shows the full set)
// and the notices of any set retired variables (never an error, see
// RETIRED_SWITCHES). Afterwards it always returns the same object.
export function autoSwitches(): Switches {
  if (memo) return memo
  memo = parseSwitches(process.env, modelRegistry)
  const changed = nonDefaultSwitches(memo)
  if (changed) log(`⚙ experimental switches (OPENCODE_AUTO_* env vars, this run only): ${changed}`)
  vlog(`⚙ experimental switches (full): ${formatSwitches(memo)}`)
  for (const note of retiredSwitchNotes(process.env)) log(note)
  return memo
}

// Capability degradation (MA.4, src/capability.ts): the run start forces off
// the switches whose "on" side the agent cannot serve. Mutates the memoized
// object in place, so every holder of autoSwitches() sees the values in force;
// like the switches themselves, nothing is persisted. The run start clamps
// exactly once, at the agent fleet's start; the snapshot freezes right after
// (freezeSwitches below), and a clamp on a frozen snapshot throws — a
// programming error, never a silent no-op.
export function clampSwitches(patch: Partial<Switches>): void {
  Object.assign(autoSwitches(), patch)
}

// Freezes the memoized snapshot after the run start's degradation clamp:
// from here the run's switches are read-only (a shallow freeze — the clamp
// patches top-level fields, the nested values are shared read-only data).
// A later clamp attempt throws (strict-mode assignment to a frozen object);
// a caller that genuinely needs different switches declares them —
// setSwitchModelRegistry resets the memo, and the next autoSwitches() parse
// builds a fresh, unfrozen snapshot.
export function freezeSwitches(): void {
  Object.freeze(autoSwitches())
}
