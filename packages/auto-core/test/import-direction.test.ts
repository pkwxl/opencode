// Import-direction enforcement (plan M0.7 / F11; D8 one-way domain deps).
// Verbal conventions decay; this suite makes them assertions. It scans src/ at
// runtime and checks, in order of increasing abstraction:
//   1. classification   — every src module is consciously placed in a D8 domain
//   2. acyclicity       — the runtime (value) import graph stays a DAG, and
//                         so does the full graph with type-only edges counted
//                         (`import type`, an `import { type … }` whose every
//                         specifier is type-marked, and `import("./x")` type
//                         expressions)
//   3. chain layering   — the session-driving chain stays strictly layered (0024 §D.2)
//   4. one-way rules    — documented one-way invariants (0024 §D.2)
//   5. runner fan-in    — runner stays the top of the task pipeline
//   6. domain entries   — once a provider domain physically exists under
//                         src/<domain>/, nobody crosses its boundary except via
//                         its entry (interface) module, and it never imports driver
//   7. frozen baselines — provider-tagged flat files keep their exact import set
//                         until they physically move (transition-era guard)
//   8. hygiene          — shells are never imported; relative imports either stay
//                         inside src/ or embed assets via `with { type: "file" }`
// Any violation lists the offending edges; a legitimate new dependency means a
// conscious, reviewed edit to the tables below — never a silent one.
// Type-only edges count for every direction rule. For cycles they are checked
// twice: the runtime check ignores them (TS erases them, so they cannot loop
// at run time), and a second check counts them — a cycle closed by type edges
// couples the modules all the same, and the control-modules cycle such edges
// closed is what the src/control-types.ts leaf removed.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const SRC = resolve(import.meta.dir, "..", "src")

type Domain = "intent" | "phases" | "document" | "agent" | "driver"

// ---------------------------------------------------------------------------
// Configuration — edit consciously; every edit is a reviewed architecture event
// ---------------------------------------------------------------------------

// D8 provider-domain directories under src/ (dir name = domain name). Files
// inside are auto-classified; flat src/*.ts files must appear in CLASSIFIED.
const DOMAIN_DIRS: ReadonlySet<string> = new Set(["intent", "phases", "document", "agent"])

// The only modules of a provider domain that other domains (incl. driver) may
// import — the "only via interfaces" rule (D8). Extend deliberately as a domain
// grows a published surface. Paths are src-relative keys without extension.
const DOMAIN_ENTRIES: Record<Exclude<Domain, "driver">, string[]> = {
  // intent: types = the frozen schema (M1.1); load = the pack-acquisition
  // surface (built-in registry + project overlay). Published together so the
  // driver never reaches past them into the domain.
  intent: ["intent/types", "intent/load"],
  // phases: registry = the type registry and phases-value resolution; custom =
  // the project type loader (M3.6, .opencode/auto/phases/<type>.md), which the
  // driver calls where it validates config and preflights a run.
  phases: ["phases/registry", "phases/custom"],
  // document: types = the frozen schema (M1.1); spec = the artifact-spec
  // machinery (M1.4 — the `Artifacts:` declaration parser, decompose/state-file spec
  // tables, generic spec-driven checker), the domain's published acquisition
  // surface for artifact checks; roles = the role model (M2.3 — classifier,
  // per-role policies, protect list, handoff protocol checks); state = the
  // todo.md/done.md subtask state protocol (M2.3 move from subtask-state.ts);
  // process-refs = the P1 prohibition scan (M2.3); unit = the unified unit
  // model (M3.1 — refs, state scan, index parser, dependency checks), first
  // consumed by the phase directory layout (M3.3).
  document: ["document/types", "document/roles", "document/spec", "document/state", "document/process-refs", "document/unit"],
  // agent: types = the frozen interface (MA.1); opencode/server = the opencode
  // host factory (MA.3: `manage` → AgentHost), the one adapter-specific module
  // the driver may name — only to construct the host; everything after that
  // goes through the AgentClient/AgentHost types. claude/host = the claude
  // headless host factory (MA.5, plans/0041), same role: src/agent-choice.ts names it only
  // to construct the host when the project (or OPENCODE_AUTO_AGENT) picks claude.
  agent: ["agent/types", "agent/opencode/server", "agent/claude/host"],
}

// Classification of flat src/ files (allowlist). Per plan §3 the provider
// domains' current landing spots are tagged with their future domain; the
// orchestration plane is driver. A file that moves into a domain directory must
// have its entry removed here (dir classification takes over; keeping both fails).
const CLASSIFIED: Record<string, Domain> = {
  // intent (plan §3: mode.ts / template.ts / prompt.ts)
  mode: "intent",
  template: "intent",
  prompt: "intent",
  // phases (plan §3: phases.ts)
  phases: "phases",
  // document (plan §3: docpaths.ts / doccheck.ts / protect.ts; the M1.0
  // subtask state protocol moved into document/state.ts in M2.3)
  docpaths: "document",
  doccheck: "document",
  // The round brief docs/R-NN/round.md: stub and section readers (M4.2, plans/0049 G2).
  "round-brief": "document",
  // The project brief .opencode/auto/brief.md: stub and reader (plans/0052 D9).
  brief: "document",
  protect: "document",
  // agent: none left flat — MA.3 moved server.ts into agent/opencode/ and
  // session-api.ts became a driver module (its SDK calls moved into the
  // adapter; what remains seeds chains and formats output over AgentClient).
  // driver (orchestration plane)
  "agent-choice": "driver",
  // The agent pool (plans/0055 §8.1, §12): one lazily started host per agent
  // profile, the capability intersection's run start, preflight's bin check
  // and the models command's probe. Sits below the session layer, above the
  // agent domain: it names the host factories, never a session module.
  "agent-pool": "driver",
  // Agent environments (plans/0055 §4.2, §8.10): an agent profile's env
  // resolved into the overlay a host starts with, and the loopback proxy
  // warning of preflight.
  "agent-env": "driver",
  "agents-block": "driver",
  artifact: "driver",
  attempt: "driver",
  capability: "driver",
  chain: "driver",
  // The named SessionChain transitions (plans/0061 §4.8): the one home for
  // the chain's pure computations (forkSources, modelOfChain) and, as the
  // consolidation proceeds, its mutations — the write ratchet of
  // test/chain-writes.test.ts empties every other writer. Ranked below
  // watch: every session-driving layer (and the commit boundary's resume
  // checks) may call it, and it reaches only the chain type, the switches
  // and the model routing table (the sticky/override holders arrive as
  // call arguments, data not module state).
  "chain-transitions": "driver",
  // The failure-message classifier (plans/0055 §7.1): when to ask, the
  // redaction, the run's cache and call limit, the reply's parser and the
  // one-shot tool-less session; watch asks it beside the event stream.
  classify: "driver",
  clean: "driver",
  // Closing units: closeUnit, the mechanical handover, the close commit
  // (plans/0053 D17–D21).
  close: "driver",
  conclusion: "driver",
  config: "driver",
  // Config fix: the rule table behind `fix` (plans/0052 D10).
  "config-fix": "driver",
  confirm: "driver",
  // The control modules' shared vocabulary (the Boundary and Interactive
  // types), a types-only leaf (LEAVES): step, interactive, exit and failback
  // all depend on it instead of on each other, which is what broke the
  // control-modules type cycle.
  "control-types": "driver",
  // The turn engine's contract (plans/0061 §4.3): the input union of the
  // spine's single queue, the per-concern state slices and the read-only
  // view, the immutable per-turn facts, the audited fx surface, and the
  // concern / advice / arbitration types. Types only — no runtime import,
  // so any layer may depend on it without closing a cycle.
  "engine/contract": "driver",
  // The pure dispatch plan of one prompt (plans/0061 §4.7): what a dispatch
  // decides before anything is created — the takeover, the registry pick or
  // its blocked outcome, the cross-agent move, the failback-scope flag.
  // attempt is its executor; the module reaches only the selection core and
  // the types below the session layer.
  "engine/dispatch": "driver",
   // The production TurnFx (plans/0061 §4.2/§4.3): the one I/O path of a
   // turn — the AgentClient calls, the testrun kernel, the git service's
   // freeze commit, the handover record, the stats counter and the human
   // question — built once per turn from the turn's context and driven
   // through the spine's audit. watch is its only caller.
   "engine/fx": "driver",
    // The pure ladder decision of one session prompt (plans/0061 §4.7): what
   // the session-driving loop does with a dispatch's outcome — return,
   // window wait, recovery, the key→model escalation, the after-ladder
   // failover or the retry. session.ts is its executor; the module reaches
   // only the chain types and the first-line helper below the session
   // layer.
   "engine/ladder": "driver",
    // The turn spine (plans/0061 §4.4): the single input queue of one watch
    // turn, the arbitration dispatch over the concerns' slices, the fx audit
    // (the queue discipline's runtime invariants) and the finalize
    // procedure. Types-only reach: the contract module beside it; watch is
    // its executor, so it sits directly under watch.
    "engine/spine": "driver",
    // The turn's synthetic-input sources (plans/0061 §4.2/§4.4): the probe
    // timer and the classifier-answer feed that emit the spine queue's
    // synthetic inputs. Reaches the contract and spine types, the router's
    // answer type and session-api's probeSession; watch is its only caller.
    "engine/sources": "driver",
    // The extracted turn concerns (plans/0061 §4.5/§4.6), one file per
    // concern under engine/concerns/: guard (the twin-idle dedup), windows
    // (the limit row), transcript (terminal echo and billing), stuck (the
    // loop hint), questions (the question and permission rows), failure (the
    // error accumulator with its limit-statement helpers) and recovery (the
    // failure-message classifier's turn: the consult, the pattern verdicts,
    // the raised settle, the final classification and the reset fields). Each
    // owns one slice of the turn state and reaches only the contract's types
    // plus the unranked leaves below the session layer (session-api's
    // describePart and isApproval, the stuck-hint template render and the
    // detector's constants, unit-commit's autoAnswer, resolve's
    // sameIssue/compactText, chain's statedInWording and agentGaveUp,
    // classify's ask and merge policies, the router's answer type);
    // watch installs them beside the remainder.
    "engine/concerns/guard": "driver",
    "engine/concerns/windows": "driver",
    "engine/concerns/transcript": "driver",
    "engine/concerns/stuck": "driver",
    "engine/concerns/questions": "driver",
    "engine/concerns/failure": "driver",
    "engine/concerns/recovery": "driver",
    "exec-session": "driver",
  execute: "driver",
  exit: "driver",
  failback: "driver",
  gitignore: "driver",
  git: "driver",
  // The git service's home (the run services' commit-side seam): the moved
  // session close-out afterSession with its marker collection, plus the
  // seam's two instances — the production delegation and the no-commit
  // double tests install. Deliberately opts-free (structural parameter
  // slices): the services holder imports it to build the default member,
  // and an opts import here would close opts → interactive → services →
  // git-ops → opts in the type-counted graph.
  "git-ops": "driver",
  handover: "driver",
  hibernate: "driver",
  interactive: "driver",
  // Key rings of the model registry (plans/0055 §4.3): per-provider rings,
  // the ring position and the spawn config content, in memory only; sits
  // below the session layer, above the agent domain (§12).
  keyring: "driver",
  knowledge: "driver",
  // The run lock .auto/run.lock (plans/0053 D1–D3).
  lock: "driver",
  log: "driver",
  "loop-phase": "driver",
  // Phase planning, moved out of loop-phase (plans/0053 A2).
  "loop-plan": "driver",
  "loop-preflight": "driver",
  "loop-progress": "driver",
  "loop-task": "driver",
  loop: "driver",
  // Candidate lists of the model registry (plans/0055 §6.1): route, tier and
  // the ordered names of a session, pure over a loaded registry.
  "model-route": "driver",
  // Model windows of the model registry (plans/0055 §4.4): a leaf (LEAVES).
  "model-window": "driver",
  // The model registry (plans/0055 §4.1–§4.3): layers, merge, strict
  // validation and the reference check; a loader below every session module.
  models: "driver",
  // The models command's data (plans/0055 §9): checkModels, describeModels
  // and formatModels; starts no agent and writes nothing.
  "models-describe": "driver",
  // Context steps of a model registry entry (plans/0055 §4.5): the step-up
  // point, the step walk over the live windows and the startup validation
  // lines, pure over the limits (the cache-claim check's run state lives in
  // the router service). Watch (the live half), attempt and the loop build
  // on it.
  "model-step": "driver",
  numbering: "driver",
  opts: "driver",
  // plan's prelude and stop lines (plans/0053 D4–D8); never imports the loop.
  plan: "driver",
  // The planning input plan-input.md: read, persist, commit (plans/0053 D9).
  "plan-input": "driver",
  // The planning renderers, moved out of prompt.ts (plans/0053 A2).
  "prompt-plan": "driver",
  // Learned quota windows persisted across runs (plans/0057 §8): read by the
  // recovery wait's sleep only; below attempt and session.
  "quota-windows": "driver",
  reset: "driver",
  // The router service (the consolidation's services stage, first tranche):
  // the run-wide decision state of routing and recovery — the failback
  // holders, the down marks, the logged usage windows, the model-step
  // cache-claim checks — one instance per run inside the run's services
  // holder. The entries read it through the installed services; everything
  // below receives it as data (the routing facts, the session options, a
  // leading parameter).
  router: "driver",
  // The run's registry routing facts (plans/0055 §6): the agent filter, the
  // default agent and the selection-context injection around the pure
  // selection core, plus the run-start routing block and the tier-coverage
  // refusal. Sits with select below the session layer.
  routing: "driver",
  resolve: "driver",
  "resume-gate": "driver",
  resume: "driver",
  // The round-close gate (M4.2, plans/0049 G8): whole-tree P1 scan, build, close listing.
  "round-close": "driver",
  runner: "driver",
  script: "driver",
  // Selection (plans/0055 §6): the candidate list, the pick and the
  // nothing-usable decision of a dispatch under a registry; pure, with the
  // clock and the run state injected. Sits below the session layer, above the
  // agent domain (§12).
  select: "driver",
  // The run's service holder (the consolidation's services stage): the
  // installed ambient instance the composition root builds (the clock today;
  // the router, control and git services join with the changes that move
  // their state in). The ambient accessor is allowed only in the modules
  // SERVICE_ENTRIES lists, an allowlist that may only shrink.
  services: "driver",
  "session-api": "driver",
  session: "driver",
  shell: "driver",
  // The lead's split (plans/0059 D3–D4): the checklist-line parser, the
  // structural guard, the driver-written S<nn>/todo.md and the taken-split
  // check; pure over the documents, below execute and runner.
  split: "driver",
  stats: "driver",
  status: "driver",
  step: "driver",
  stuck: "driver",
  switches: "driver",
  // The task store (M3.4): task units + runtime state; replaced plan.ts.
  tasks: "driver",
  // Adding one task by hand (--new-task): the mechanical, no-session half
  // of append planning (plans/0058); called from plan's prelude.
  "task-add": "driver",
  "templates.d": "driver",
  testrun: "driver",
  // Default reasoning tiers of sessions (plans/0055 §5): the role table over
  // the phase types' execute tiers; selection builds on it.
  tier: "driver",
  "unit-commit": "driver",
  usage: "driver",
  watch: "driver",
  wrapup: "driver",
}

// Transition-era guard (rule 7): provider-tagged flat files freeze their exact
// src-import set. Today prompt.ts imports tasks.ts etc. because concerns are
// still physically mixed; before this refactor lands them in domain dirs, any
// import change in these files must be a conscious edit here, so the (a)/(b)
// untangling (M1-M4, MA) cannot silently re-couple the domains.
const FROZEN_IMPORTS: Record<string, string[]> = {
  mode: [],
  template: [],
  // M3.6: the phase view is a PhaseKey / type entry (phases/registry), no
  // longer the phases.ts letter helpers.
  prompt: ["docpaths", "intent/load", "intent/types", "mode", "phases/registry", "resolve", "stuck", "switches", "tasks", "template"],
  // M3.4: routing loads the current phase's tasks (tasks) and no longer
  // renders the retired PLAN.md scaffold (template).
  // M3.6: phase types load per project (phases/custom).
  // M4.2: completePhase checks the phase gates (document/roles: result line,
  // acceptance mark); establishRound writes the round brief stub (round-brief).
  // P3c (0053 D35): the blocked pointer names `plan` with the profile's bin
  // (shell) — the phases-domain text needs the shell-agnostic program name,
  // the same seam the driver-plane modules already use.
  phases: ["docpaths", "document/roles", "document/unit", "phases/custom", "phases/registry", "round-brief", "shell", "tasks"],
  docpaths: [],
  doccheck: [],
  protect: ["document/roles"],
}

  // Session-driving chain, bottom → top (0024 §D.2): imports between ranked
  // modules must go strictly downward in rank.
  const RANK: Record<string, number> = {
    // chain-transitions (plans/0061 §4.2) sits below every session-driving
    // entry: watch and attempt, session and the commit boundary's resume
    // checks all reach the chain's transitions, and it reaches none of them.
    "chain-transitions": 0,
    // The pure engine decisions (plans/0061 §4.7), one slot below watch:
    // attempt executes the dispatch plan and session the ladder decision,
    // and the engine modules the turn consolidation adds (engine/*) need
    // the slots under watch beside them.
    "engine/dispatch": 1,
    "engine/ladder": 2,
    // The turn engine's contract (plans/0061 §4.3): types only; the spine,
    // fx and sources the turn consolidation adds take the slots between it
    // and watch as they land.
    "engine/contract": 3,
    // The turn spine (plans/0061 §4.4), directly under its executor: it
    // reaches the contract module's types only.
    "engine/spine": 4,
    // The production TurnFx (plans/0061 §4.2/§4.3): beside the spine, under
    // watch — it reaches the contract's types and the unranked leaves below
    // the session layer (log, session-api, testrun, git, handover, stats).
    "engine/fx": 5,
    // The turn's synthetic-input sources (plans/0061 §4.2/§4.4), taking the
    // slot beside the spine: they reach the contract and spine types, the
    // router's answer type and session-api's probeSession.
    "engine/sources": 6,
    // The extracted turn concerns (plans/0061 §4.5/§4.6), in their extraction
    // order, filling the slots up to watch: each reaches the contract's types
    // and the unranked leaves below the session layer; watch is their
    // installer, beside the remainder that still holds the not-yet-extracted
    // cells.
    "engine/concerns/guard": 7,
    "engine/concerns/transcript": 8,
    "engine/concerns/windows": 9,
    "engine/concerns/stuck": 10,
    "engine/concerns/questions": 11,
    "engine/concerns/failure": 12,
    "engine/concerns/recovery": 13,
    watch: 14,
    attempt: 15,
    session: 16,
    artifact: 17,
    "exec-session": 17,
    execute: 18,
    runner: 19,
  }

// Documented one-way invariants (0024 §D.2 and the plan §2.5 layering). Kept
// explicit (some are implied by RANK) so the failure message carries the rationale.
const FORBIDDEN: Array<{ from: string; to: string[]; why: string }> = [
  {
    from: "testrun",
    to: ["session", "attempt", "watch", "exec-session", "execute", "runner"],
    why: "testrun is test execution + handoff file ops, a leaf; letting it reach the session-driving layer re-forms the watch↔runExecSession cycle the 0024 split resolved",
  },
  {
    from: "unit-commit",
    to: ["session", "attempt", "watch", "exec-session", "execute", "runner"],
    why: "the commit boundary sits below watch; it must not depend on the session-driving layer (0024 §D.2)",
  },
  {
    from: "session",
    to: ["artifact"],
    why: "artifact → session is the sanctioned direction (requireArtifact calls runSession); nothing in session may call back into artifact",
  },
  {
    from: "close",
    to: ["loop", "loop-phase", "loop-plan", "loop-task", "loop-preflight", "runner", "artifact", "session"],
    why: "close is a deterministic driver command that starts no session (plans/0053 D17–D21); it must not import the loop or the session-driving layer",
  },
  {
    from: "plan",
    to: ["loop", "loop-phase", "loop-plan", "loop-task", "loop-preflight", "runner", "artifact", "session"],
    why: "plan's prelude decides the routes that need no AI before any agent starts (plans/0053 D4); the loop imports plan for its stop lines, never the reverse",
  },
  // AUTO-DECISION: models gets a one-way rule besides its classification row (selection and preflight will import it from below the session layer, so an upward import would form a cycle; the rule states that before the first consumer lands)
  {
    from: "models",
    to: ["loop", "loop-phase", "loop-plan", "loop-task", "loop-preflight", "runner", "artifact", "session", "attempt", "watch", "agent-choice"],
    why: "the model registry is read-only data loaded at run start (plans/0055 §4.1); selection, preflight and the models command build on it, so it must not import the loop, the session-driving layer or the agent start",
  },
  // AUTO-DECISION: tier gets a one-way rule besides its classification row (like models, it will be imported by selection below the session layer, so an upward import would form a cycle; the rule states that before the first consumer lands)
  {
    from: "tier",
    to: ["loop", "loop-phase", "loop-plan", "loop-task", "loop-preflight", "runner", "artifact", "session", "attempt", "watch", "agent-choice", "models"],
    why: "a session's default tier is a pure function of its role and the phase type (plans/0055 §5); it must not import the loop, the session-driving layer, the agent start or the operator's model registry, which never decides a tier (§3)",
  },
  // AUTO-DECISION: model-route gets a one-way rule besides its classification row (selection will import it from below the session layer, as it does models and tier, so an upward import would form a cycle)
  {
    from: "model-route",
    to: ["loop", "loop-phase", "loop-plan", "loop-task", "loop-preflight", "runner", "artifact", "session", "attempt", "watch", "agent-choice", "models-describe"],
    why: "a session's candidate list is a pure function of the loaded registry, its role and the phase type (plans/0055 §6.1); selection and the models command build on it, so it must not import the loop, the session-driving layer, the agent start or the models command's data",
  },
  // AUTO-DECISION: models-describe gets a one-way rule besides its classification row (the models command must start no agent and write nothing, plans/0055 §9; forbidding the agent start and the session-driving layer states that in the table)
  {
    from: "models-describe",
    to: ["loop", "loop-phase", "loop-plan", "loop-task", "loop-preflight", "runner", "artifact", "session", "attempt", "watch", "agent-choice", "agent/opencode/server", "agent/claude/host"],
    why: "the models command prints the registry without starting any agent (plans/0055 §9); preflight imports its shared refusal, so it must not import the loop, the session-driving layer, the agent start or an agent host",
  },
  // AUTO-DECISION: agent-env gets a one-way rule besides its classification row (the agent start and preflight import it, and the agent pool will, so an upward import would form a cycle; it may read the registry's types but never start an agent)
  {
    from: "agent-env",
    to: ["loop", "loop-phase", "loop-plan", "loop-task", "loop-preflight", "runner", "artifact", "session", "attempt", "watch", "agent-choice", "agent/opencode/server", "agent/claude/host"],
    why: "a profile's env is resolved for the host the agent start builds, and preflight reads the proxy warning (plans/0055 §4.2, §8.10); it must not import the loop, the session-driving layer, the agent start or an agent host",
  },
  // AUTO-DECISION: select gets a one-way rule besides its classification row (it is the resolver behind every dispatch under a registry — attempt, session, unit-commit and the failback override — so an upward import would form a cycle; §12 places it below the session layer and above the agent domain)
  {
    from: "select",
    to: [
      "loop",
      "loop-phase",
      "loop-plan",
      "loop-task",
      "loop-preflight",
      "runner",
      "artifact",
      "session",
      "attempt",
      "watch",
      "agent-choice",
      "agent/opencode/server",
      "agent/claude/host",
      "models-describe",
    ],
    why: "selection is the pure resolver behind every dispatch under a registry (plans/0055 §6, §12): attempt, session, unit-commit and the failback override call it, so it must not import the loop, the session-driving layer, the agent start, an agent host or the models command's data",
  },
  // AUTO-DECISION: routing gets a one-way rule besides its classification row (it injects the run state around selection and is imported by the dispatch resolvers and the loop, so an upward import would form a cycle)
  {
    from: "routing",
    to: [
      "loop",
      "loop-phase",
      "loop-plan",
      "loop-task",
      "loop-preflight",
      "runner",
      "artifact",
      "session",
      "attempt",
      "watch",
      "exec-session",
      "execute",
      "unit-commit",
      "interactive",
      "agent-choice",
      "agent/opencode/server",
      "agent/claude/host",
      "models-describe",
    ],
    why: "the run's routing facts wrap selection for every dispatch under a registry (plans/0055 §6): attempt, session, unit-commit, the loop and preflight call it, so it must not import the loop, the session-driving layer, the commit boundary, the interactive sideband, the agent start, an agent host or the models command's data",
  },
  // AUTO-DECISION: keyring gets a one-way rule besides its classification row (selection's context, the routing block, the agent start and the session escalation all read it from below the session layer, so an upward import would form a cycle; §12 places it below session, above the agent domain)
  {
    from: "keyring",
    to: [
      "loop",
      "loop-phase",
      "loop-plan",
      "loop-task",
      "loop-preflight",
      "runner",
      "artifact",
      "session",
      "attempt",
      "watch",
      "exec-session",
      "execute",
      "unit-commit",
      "interactive",
      "routing",
      "select",
      "agent-choice",
      "agent/opencode/server",
      "agent/claude/host",
      "models-describe",
    ],
    why: "key rings are run state over the loaded registry (plans/0055 §4.3): selection's ring predicate, the run-start routing block, the agent start (activation and spawn config) and the session escalation read them, so the module must not import the loop, the session-driving layer, selection or its context wrapper, the agent start or an agent host — it only holds references and never logs",
  },
  // AUTO-DECISION: classify gets a one-way rule besides its classification row (watch asks it from the bottom of the session-driving chain, so an upward import would form a cycle; §12 places it beside watch's retry branch, reading the registry, the marks and the rings below it)
  {
    from: "classify",
    to: [
      "loop",
      "loop-phase",
      "loop-plan",
      "loop-task",
      "loop-preflight",
      "runner",
      "artifact",
      "session",
      "attempt",
      "watch",
      "exec-session",
      "execute",
      "unit-commit",
      "interactive",
      "agent-choice",
      "agent/opencode/server",
      "agent/claude/host",
      "models-describe",
    ],
    why: "the classifier answers watch's retry branch from below it (plans/0055 §7.1): it reads the registry, the down marks and the rings and runs one tool-less session on the client it is handed, so it must not import the loop, the session-driving layer, the commit boundary, the interactive sideband, the agent start, an agent host or the models command's data",
  },
  // AUTO-DECISION: router gets a one-way rule besides its classification row (every dispatch-side module reads the routing decision state — the entries through the installed services, the rest through the routing facts, the session options or a leading parameter — so an upward import would form a cycle; the later tranches that give it the key rings and the routing fence keep the same shape)
  {
    from: "router",
    to: [
      "loop",
      "loop-phase",
      "loop-plan",
      "loop-task",
      "loop-preflight",
      "runner",
      "artifact",
      "session",
      "attempt",
      "watch",
      "exec-session",
      "execute",
      "unit-commit",
      "interactive",
      "agent-choice",
      "agent/opencode/server",
      "agent/claude/host",
      "models-describe",
    ],
    why: "the router service holds the run's routing decision state (the failback holders, the down marks, the logged windows, the step claims): the entries read it through the installed services and everything below receives it as data, so the module must not import the loop, the session-driving layer, the commit boundary, the interactive sideband, the agent start, an agent host or the models command's data — it only holds state and logs the /failback line",
  },
  // AUTO-DECISION: agent-pool gets a one-way rule besides its classification row (§12 places it below the session layer and above the agent domain; every session-driving module resolves clients and host control through it, so an upward import would form a cycle — and the pool starting a session-driving module's machinery would invert who serves whom)
  {
    from: "agent-pool",
    to: [
      "loop",
      "loop-phase",
      "loop-plan",
      "loop-task",
      "loop-preflight",
      "runner",
      "artifact",
      "session",
      "attempt",
      "watch",
      "exec-session",
      "execute",
      "unit-commit",
      "interactive",
      "classify",
      "models-describe",
    ],
    why: "the agent pool holds the run's agent hosts (plans/0055 §8.1, §12): the loop starts it, the session layer resolves every client through it and preflight checks its bins, so it must not import the loop, the session-driving layer, the commit boundary, the interactive sideband, the classifier or the models command's data",
  },
  {
    from: "watch",
    to: ["attempt", "session", "exec-session", "execute", "runner"],
    why: "watch is the bottom of the session-driving chain (plan §2.5); lower layers must not import upward",
  },
]

// Leaf modules import no src module at all (type-only imports included), so
// any layer may depend on them without forming a cycle or reaching upward.
const LEAVES: Record<string, string> = {
  "model-window": "the window grammar and wall-clock arithmetic of the model registry are pure (injected clock); the registry loader, the models command and selection all build on them",
  "control-types": "the control modules' shared vocabulary (the Boundary and Interactive types) is types only; step, interactive, exit and failback all depend on it, so it must not depend on anything",
}

// runner is the top of the task pipeline; exactly these modules may import it.
const RUNNER_IMPORTERS = new Set(["loop", "loop-task"])

// The core does not know shells (shell-contract): never import shell packages,
// and never import this package by name instead of relatively.
const DENIED_PACKAGES = ["@opencode-ai/auto", "@opencode-ai/auto-migrate", "@opencode-ai/auto-core"]

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

type Edge = { to: string; typeOnly: boolean }

const modules: string[] = []
const edges = new Map<string, Edge[]>()
const externalImports = new Map<string, Set<string>>()

function walk(dir: string): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(name)) modules.push(relative(SRC, p).replaceAll("\\", "/").replace(/\.tsx?$/, ""))
  }
}
walk(SRC)
modules.sort()

for (const key of modules) {
  const abs = join(SRC, key + ".ts")
  const text = readFileSync(abs, "utf8")
  const list: Edge[] = []
  const record = (spec: string, typeOnly: boolean): void => {
    if (!spec.startsWith(".")) {
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
      if (!externalImports.has(key)) externalImports.set(key, new Set())
      externalImports.get(key)!.add(pkg)
      return
    }
    const target = relative(SRC, resolve(dirname(abs), spec)).replaceAll("\\", "/")
    if (!target.startsWith("..")) list.push({ to: target.replace(/\.tsx?$/, ""), typeOnly })
  }
  // `... from "spec"` — find the statement head to tell value imports from
  // `import type` / `export type` re-exports. Statements start at column 0.
  for (const m of text.matchAll(/from\s*["']([^"']+)["']/g)) {
    const start = Math.max(text.lastIndexOf("\nimport ", m.index), text.lastIndexOf("\nexport ", m.index))
    const head = start < 0 ? text.slice(0, m.index) : text.slice(start + 1, m.index)
    const typeOnly = /^import\s+type\b/.test(head) || /^export\s+type\b/.test(head) || allTypeSpecifiers(head)
    record(m[1]!, typeOnly)
  }
  // bare `import "spec"` (side-effect imports)
  for (const m of text.matchAll(/^import\s*["']([^"']+)["']/gm)) record(m[1]!, false)
  // `import("./spec")` in type position (`type X = import("./x").Y`, a
  // field's `x?: import("./x").T`): a type edge like `import type`. A dynamic
  // value import (`await import("./x")`) is excluded by the lookbehind — it
  // loads the module at run time and belongs to the value graph.
  for (const m of text.matchAll(/(?<!await\s*)import\(\s*["']([^"']+)["']\s*\)/g)) record(m[1]!, true)
  edges.set(key, list)
}

// Whether a `from`-statement's braces hold only `type`-prefixed specifiers
// (`import { type A } from …`, `import { type A as B } from …`): TypeScript
// erases such a statement entirely, so it is a type edge, not a value import —
// a mixed statement (`import { x, type A }`) keeps its value edge.
function allTypeSpecifiers(head: string): boolean {
  if (!/^(import|export)\s*\{/.test(head)) return false
  const braces = /\{([^}]*)\}/.exec(head)
  const specifiers = (braces?.[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean)
  return specifiers.length > 0 && specifiers.every((part) => /^type[\s"']/.test(part))
}

function domainOf(key: string): Domain | "unclassified" {
  if (inDomainDir(key)) return key.split("/")[0] as Domain
  return CLASSIFIED[key] ?? "unclassified"
}
// a flat src/phases.ts must not be mistaken for a file inside a phases/ directory
const inDomainDir = (key: string): boolean => key.includes("/") && DOMAIN_DIRS.has(key.split("/")[0])
const entriesOf = (d: Domain): string[] => (d === "driver" ? [] : DOMAIN_ENTRIES[d])

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function checkClassification(): string[] {
  const problems: string[] = []
  const known = new Set(modules)
  for (const key of modules) {
    if (!inDomainDir(key) && !(key in CLASSIFIED)) problems.push(`unclassified module: src/${key}.ts — add it to CLASSIFIED (or move it into a D8 domain directory)`)
  }
  for (const key of Object.keys(CLASSIFIED)) {
    if (!known.has(key)) problems.push(`CLASSIFIED lists src/${key}.ts which does not exist — remove the stale entry`)
    else if (inDomainDir(key)) problems.push(`src/${key}.ts lives in a domain directory but is also in CLASSIFIED — remove the table entry (dir classification takes over)`)
  }
  for (const key of Object.keys(FROZEN_IMPORTS)) {
    if (CLASSIFIED[key] === undefined) problems.push(`FROZEN_IMPORTS lists src/${key}.ts which is not classified as a provider domain`)
    else if (CLASSIFIED[key] === "driver") problems.push(`FROZEN_IMPORTS lists src/${key}.ts which is classified as driver — only provider-domain files freeze imports`)
  }
  return problems
}

// Depth-first cycle search over an adjacency map; returns one cycle as a
// closed node list (a → b → a), or null when the graph is acyclic.
function findCycle(adj: Map<string, string[]>): string[] | null {
  const NO_COLOR = 0
  const ACTIVE = 1
  const DONE = 2
  const color = new Map<string, number>()
  const stack: string[] = []
  const visit = (node: string): string[] | null => {
    color.set(node, ACTIVE)
    stack.push(node)
    for (const next of adj.get(node) ?? []) {
      const state = color.get(next) ?? NO_COLOR
      if (state === ACTIVE) return [...stack.slice(stack.indexOf(next)), next]
      if (state === NO_COLOR) {
        const found = visit(next)
        if (found) return found
      }
    }
    stack.pop()
    color.set(node, DONE)
    return null
  }
  for (const key of modules) {
    if ((color.get(key) ?? NO_COLOR) === NO_COLOR) {
      const found = visit(key)
      if (found) return found
    }
  }
  return null
}

function checkAcyclicity(): string[] {
  const valueAdj = new Map<string, string[]>()
  for (const [from, list] of edges) valueAdj.set(from, list.filter((e) => !e.typeOnly).map((e) => e.to))
  const cycle = findCycle(valueAdj)
  if (cycle) return [`runtime import cycle: ${cycle.join(" → ")}`]
  return []
}

// The same DAG requirement with type edges counted: TS erases them, so they
// cannot loop at run time, but a cycle through them still couples the modules
// (the control-modules cycle the src/control-types.ts leaf removed was closed
// by exactly such edges), so none may remain.
function checkTypeAcyclicity(): string[] {
  const adj = new Map<string, string[]>()
  for (const [from, list] of edges) adj.set(from, list.map((e) => e.to))
  const cycle = findCycle(adj)
  if (cycle) return [`import cycle (type edges counted): ${cycle.join(" → ")}`]
  return []
}

function checkChainLayering(): string[] {
  const problems: string[] = []
  for (const [from, list] of edges) {
    for (const e of list) {
      const rFrom = RANK[from]
      const rTo = RANK[e.to]
      if (rFrom === undefined || rTo === undefined) continue
      if (rTo >= rFrom) problems.push(`layer violation: src/${from}.ts (rank ${rFrom}) imports src/${e.to}.ts (rank ${rTo}) — the session-driving chain must stay strictly layered, imports point downward only (0024 §D.2)${e.typeOnly ? " [type]" : ""}`)
    }
  }
  return problems
}

function checkOneWayRules(): string[] {
  const problems: string[] = []
  for (const [from, list] of edges) {
    for (const rule of FORBIDDEN) {
      if (from !== rule.from) continue
      for (const e of list) {
        if (rule.to.includes(e.to)) problems.push(`one-way violation: src/${rule.from}.ts imports src/${e.to}.ts — ${rule.why}${e.typeOnly ? " [type]" : ""}`)
      }
    }
  }
  return problems
}

function checkLeaves(): string[] {
  const problems: string[] = []
  for (const [key, why] of Object.entries(LEAVES)) {
    if (!edges.has(key)) problems.push(`LEAVES lists src/${key}.ts which does not exist — remove the stale entry`)
    for (const e of edges.get(key) ?? []) problems.push(`leaf violation: src/${key}.ts imports src/${e.to}.ts — ${why}${e.typeOnly ? " [type]" : ""}`)
  }
  return problems
}

function checkRunnerFanIn(): string[] {
  const problems: string[] = []
  for (const [from, list] of edges) {
    if (from === "runner") continue
    for (const e of list) {
      if (e.to !== "runner") continue
      if (!RUNNER_IMPORTERS.has(from)) problems.push(`runner fan-in: src/${from}.ts imports src/runner.ts — only ${[...RUNNER_IMPORTERS].join(" and ")} may import runner (top of the task pipeline, 0024 §D.2)`)
    }
  }
  return problems
}

function checkDomainEntries(): string[] {
  const problems: string[] = []
  for (const [from, list] of edges) {
    const dFrom = domainOf(from)
    if (dFrom === "unclassified") continue
    for (const e of list) {
      const dTo = domainOf(e.to)
      if (dTo === "unclassified") continue
      if (inDomainDir(from) && dFrom !== "driver") {
        // physically-placed provider domain: never imports driver; crosses
        // domains only via the other domain's entry module
        if (dTo === "driver") problems.push(`domain violation: src/${from}.ts (${dFrom}) imports driver module src/${e.to}.ts — provider domains must not depend on the driver domain (D8)`)
        else if (dTo !== dFrom && !entriesOf(dTo).includes(e.to)) problems.push(`domain violation: src/${from}.ts (${dFrom}) imports src/${e.to}.ts (${dTo}) outside its entry list [${entriesOf(dTo).join(", ")}] — depend on a domain only via its interface module (D8)`)
      }
      if (dFrom === "driver" && inDomainDir(e.to) && !entriesOf(dTo).includes(e.to)) problems.push(`domain violation: src/${from}.ts (driver) imports src/${e.to}.ts (${dTo}) outside its entry list [${entriesOf(dTo).join(", ")}] — depend on a domain only via its interface module (D8)`)
    }
  }
  return problems
}

function checkFrozenBaselines(): string[] {
  const problems: string[] = []
  for (const [key, frozen] of Object.entries(FROZEN_IMPORTS)) {
    const actual = [...new Set((edges.get(key) ?? []).map((e) => e.to))].sort()
    const expected = [...frozen].sort()
    const added = actual.filter((x) => !expected.includes(x))
    const removed = expected.filter((x) => !actual.includes(x))
    if (added.length || removed.length) {
      const parts = [
        added.length ? `new imports: ${added.join(", ")}` : "",
        removed.length ? `removed imports: ${removed.join(", ")}` : "",
      ].filter(Boolean)
      problems.push(`frozen baseline drift in src/${key}.ts (${CLASSIFIED[key]} domain) — ${parts.join("; ")}; this file is a provider-domain landing spot, so any import change must be a conscious edit to FROZEN_IMPORTS (M0.7 transition guard)`)
    }
  }
  return problems
}

function checkHygiene(): string[] {
  const problems: string[] = []
  for (const [key, pkgs] of externalImports) {
    for (const pkg of pkgs) {
      if (DENIED_PACKAGES.includes(pkg)) problems.push(`shell/self import: src/${key}.ts imports "${pkg}" — the core does not know shells and imports itself relatively (shell-contract)`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("import direction (M0.7 / F11)", () => {
  test("every src module is classified into a D8 domain", () => {
    expect(checkClassification().join("\n")).toBe("")
  })

  test("runtime import graph is acyclic", () => {
    expect(checkAcyclicity().join("\n")).toBe("")
  })

  test("import graph is acyclic with type edges counted", () => {
    expect(checkTypeAcyclicity().join("\n")).toBe("")
  })

  test("session-driving chain stays strictly layered (0024 §D.2)", () => {
    expect(checkChainLayering().join("\n")).toBe("")
  })

  test("documented one-way invariants hold (0024 §D.2)", () => {
    expect(checkOneWayRules().join("\n")).toBe("")
  })

  test("leaf modules import no src module", () => {
    expect(checkLeaves().join("\n")).toBe("")
  })

  test("runner has exactly the sanctioned in-package consumers", () => {
    expect(checkRunnerFanIn().join("\n")).toBe("")
  })

  test("domain boundaries are crossed only via entry modules (D8)", () => {
    expect(checkDomainEntries().join("\n")).toBe("")
  })

  test("provider-tagged flat files keep their frozen import sets", () => {
    expect(checkFrozenBaselines().join("\n")).toBe("")
  })

  test("no shell imports (core does not know shells)", () => {
    expect(checkHygiene().join("\n")).toBe("")
  })
})
