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
//   6. domain entries   — a provider-domain module, placed in src/<domain>/
//                         or still flat, never imports driver, and crosses
//                         into other domains only via their entry (interface)
//                         modules (the flat files joined the rule when E3
//                         retired the FROZEN_IMPORTS transition guard)
//   7. hygiene          — shells are never imported; relative imports either stay
//                         inside src/ or embed assets via `with { type: "file" }`
//   8. sub-domains      — driver modules carry a sub-domain (R10); the value
//                         edges between sub-domains stay inside SUBDOMAIN_EDGES,
//                         a seed that may only shrink, with contract a leaf over
//                         types and no engine → pipeline edge
//   9. no HTTP          — the core imports no HTTP module and calls no HTTP
//                         server API (0067 §三.1: the core never imports HTTP;
//                         serving belongs to a shell)
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
  // model (M3.1 — refs, state scan, index parser and its tick, dependency
  // checks), first consumed by the phase directory layout (M3.3). E3 added
  // the domain's flat published files once the flat provider files joined the
  // entry rule: docpaths = the single path-construction point (plans/0010),
  // round-brief = the round brief stub and section readers (M4.2) — both
  // always were document surface other domains build on.
  document: ["document/types", "document/roles", "document/spec", "document/state", "document/process-refs", "document/unit", "docpaths", "round-brief"],
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
  // adapter; what remains seeds chains and reads usage/liveness over
  // AgentClient — the pure formatters moved on to the format leaf, 0069 D10).
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
  // The run-events journal (plans/0061 R4/F1): the append-only writer of
  // `.auto/run-events.jsonl` — the input log at the engine's I/O seam (turn
  // inputs, fx results, clock readings) and the decision events (the
  // executed effects). The spine and the production fx append; the loop
  // rotates the file at the run start. Types-only reach into the contract.
  "engine/events": "driver",
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
    // The turn's result mapping (plans/0061 §4.3/§4.6): shaping the spine's
    // settle and the final view over the slices into the Watch result each
    // exit of the pre-engine watch body returned — the facade's second
    // half, extracted so watch stays the entry that builds the context and
    // runs the spine. Reaches the contract's types, the chain's result
    // types and the recovery concern's reset fields; watch is its only
    // caller.
    "engine/result": "driver",
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
    // loop hint), questions (the question and permission rows), failure
    // (the error accumulator with its limit-statement helpers), recovery
    // (the failure-message classifier's turn: the consult, the pattern
    // verdicts, the raised settle, the final classification and the reset
    // fields), liveness (the probe verdicts, the announced silence, the
    // truncation continuation and the interrupted close-out), usage (the
    // measurement point: the wall, the notice bands, the hard wall), stepUp
    // (the context steps' live half: the step-up, the late step-up, the
    // cache-claim observation) and test (the idle test-protocol with the
    // kernel effects: the freeze pin, the pending-script resolution, the
    // run-and-feedback and the handover verification). Each owns one slice
    // of the turn state and reaches only the contract's types plus the
    // unranked leaves below the session layer (format's describePart,
    // isApproval and formatTokens — the runtime leaf since 0069 D10 — the
    // stuck-hint and step-up template
    // renders and the detector's constants, unit-commit's autoAnswer,
    // resolve's sameIssue/compactText, chain's statedInWording and
    // agentGaveUp, classify's ask and merge policies, the router's answer
    // type and cache-claim service, log's formatDuration, testrun's steer
    // helpers, usage's tier rules, model-step's pure step walk); watch
    // installs them — every slice owned by its own concern.
    "engine/concerns/guard": "driver",
    "engine/concerns/windows": "driver",
    "engine/concerns/transcript": "driver",
    "engine/concerns/stuck": "driver",
    "engine/concerns/questions": "driver",
    "engine/concerns/failure": "driver",
    "engine/concerns/recovery": "driver",
    "engine/concerns/liveness": "driver",
    "engine/concerns/usage": "driver",
    "engine/concerns/step-up": "driver",
    "engine/concerns/test": "driver",
    "exec-session": "driver",
  execute: "driver",
  exit: "driver",
  failback: "driver",
  // The pure formatters over the agent plane's values (0069 §2.2 D10's
  // split, T-125): describePart, formatTokens, formatClientError and
  // isApproval, moved out of session-api.ts so the policies modules that
  // need them (model-step, classify, the turn concerns) reach a runtime
  // leaf instead of binding the engine's session-driving layer — the move
  // that killed the permanent `policies → engine` edge (the SUBDOMAIN_EDGES
  // entry removed with it).
  format: "driver",
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
  // Branch-isolation landing (plans/0074 §2.3, U-L2): landUnit — the `land`
  // command's orchestration half over git's landing primitives — plus the
  // preflight leftover report; pipeline beside close, the person-invoked
  // command core it mirrors.
  land: "driver",
  interactive: "driver",
  // Key rings of the model registry (plans/0055 §4.3): per-provider rings,
  // the ring position and the spawn config content, in memory only; sits
  // below the session layer, above the agent domain (§12).
  keyring: "driver",
  knowledge: "driver",
  // The lane scheduler (plans/0068 §6.2): the pure readiness core over the
  // loaded plan and the runtime registry — the ready set, lane eligibility,
  // the landing-side tick re-derivation, the lane report's parse and the
  // failure-matrix mapping. Production callers since S3 landed (0068,
  // T-099–T-104): the lane dispatch path in loop-task.ts (the activation
  // check plus the lane and isolation loops that dispatch, land and
  // re-dispatch lanes), the scheduler's preflight step in loop-preflight.ts
  // (orphan recovery over the lane registry) and the lane worker's own
  // report write in loop.ts — beside the tests. AUTO-DECISION: the two
  // sibling lanes comments below (the SUBDOMAIN row, the one-way rule)
  // carried the same pre-S3 future tense and were corrected in the same
  // pass, so the file states one truth (plans/0069 §4.2 A13 corrected the
  // stale claim).
  lanes: "driver",
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
  // The registry's schema half (0061 E4, R14): the types of a loaded
  // registry and the tables that declare what a file may say; the loader
  // (models) validates against it, and the type-only importers read it
  // without binding the loader.
  "models-schema": "driver",
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
  // The render facts' composition helper (plans/0061 E2): the one PromptFacts
  // value builder the render callers share — the prompt globals, the library
  // handle, the switch-derived ask tier and the implement-entry fallback.
  // runtime: it composes the run's process-level inputs (switches, the pack
  // loader, the template registry) for every sub-domain that renders.
  "prompt-facts": "driver",
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
  // The session-role registry (U-R5, plans/0060 §5.6 / 0069 §2.3 R5): the
  // workflow-shape descriptors beside the phase registry — each work kind
  // (decompose, whole, subtask, wrapup, planning, handover, knowledge)
  // declaring its templates, tier route, usage source, collect policy and
  // verdict policy as data; src/tier.ts's role table and the driving call
  // sites' usage-policy reads resolve through it.
  "roles/registry": "driver",
  // The round-close gate (M4.2, plans/0049 G8): whole-tree P1 scan, build, close listing.
  "round-close": "driver",
  // The run-status event table (the headless direction's P2a, plans/0067
  // and its review): the frozen, additive-only vocabulary the P2 emitter
  // will publish — types and declaration tables only, importing nothing;
  // the emitter and the SSE / question-queue consumers read it without
  // binding behavior.
  "run-status-schema": "driver",
  // The driver-status emitter (the headless direction's P2b): emission of
  // the P2a vocabulary at the driver's narrative points, through the log.ts
  // setter-injection family (module-level sinks) and its own `.auto/`
  // journal — deliberately NOT a services-holder member, so it never joins
  // SERVICE_ENTRIES (the allowlist may only shrink); reaches the schema
  // module's types only.
  "run-status": "driver",
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
  // The standalone work order and its adopt step (plans/0076, T-137): the
  // guest-model halves behind plan's prelude rows 12–13 (the export's render
  // composition and the adopt's validation/test-handover/commit body).
  "work-order": "driver",
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

// The driver domain's logical sub-domains (R10, plans/0061 §2.2/§4.10): the
// one column CLASSIFIED's driver rows carry besides their domain. No barrels
// and no physical moves came with it (R9/R10's rejections) — the column is
// the whole mechanism. Every driver-classified module carries exactly one
// sub-domain; provider-domain modules never do. The ratchet over the column
// (SUBDOMAIN_EDGES below) runs on the value graph: a type-only import binds
// no run time, and the contract sub-domain is exactly the shape that stays
// reachable as types ("leaf over types") — the type side stays governed by
// the type-counted acyclicity rule and by RANK, which do count type edges.
//
// Members as §4.10 lists them, with the landing-time facts beside them:
// - `check` (runtime until A4) is gone — A4 retired it.
// - `protect` (runtime in §4.10) is a document-domain flat file since M2.3,
//   not a driver module, so it carries no sub-domain.
// - `models-schema` (policies) landed with E4 beside the loader: the
//   registry's types and schema tables, split out of `models` by R14.
// - AUTO-DECISION: §4.10 lists `lock` in both kernel and runtime; it sits in
//   runtime (its only src imports are log and shell — both runtime — and the
//   run lock is a process-level facility, not task-store or commit state).
// - AUTO-RESOLVE: may `testrun` and `script` sit in §4.10's pipeline when the
//   no-engine→pipeline rule must be green at this unit's seed? -> no, they sit
//   in kernel (with them in pipeline the rule cannot hold: engine/fx
//   value-imports testrun's executeTest/resolveTestScript — §4.2's own "the
//   production TurnFx over … testrun" — and exec-session value-imports both
//   testrun and script, while the plan itself calls these the engine's
//   "kernel fx calls" (§6.3 D8) and kernel is the sub-domain the engine
//   already reaches for its effects (git, handover, stats); keeping them in
//   pipeline would force a permanent exception list onto a rule the plan
//   states as absolute, and E1's touch set allows no src edit that would
//   remove the edges instead).
// - AUTO-DECISION: §4.10 names no home for some driver modules; the omitted
//   get the placement their imports and role give them: `git-ops` (kernel —
//   the git service's home, beside git and unit-commit), `resolve` (kernel —
//   the proxy-answer ledger, run-recorded state beside stats and handover;
//   a pure leaf), `prompt-plan` (pipeline — the planning renderers, beside
//   loop-plan), `round-close` (pipeline — plan's prelude gate), `clean`,
//   `confirm`, `reset` (runtime — the destructive-op guards and the reset
//   command, beside config and shell), `templates.d` (runtime — the ambient
//   asset declarations; it imports nothing, so the placement is nominal).
type Subdomain = "contract" | "kernel" | "engine" | "policies" | "pipeline" | "runtime"

const SUBDOMAIN: Record<string, Subdomain> = {
  // contract — types and pure functions only, a leaf over types: engine and
  // policies both depend on it; it takes values from neither (rule 9).
  chain: "contract",
  "control-types": "contract",
  "engine/contract": "contract",
  // kernel — the task store, the git/commit boundary and the run's records:
  // what every session-driving layer stands on and reaches for its effects.
  tasks: "kernel",
  git: "kernel",
  "git-ops": "kernel",
  "unit-commit": "kernel",
  numbering: "kernel",
  stats: "kernel",
  resume: "kernel",
  "resume-gate": "kernel",
  handover: "kernel",
  resolve: "kernel",
  testrun: "kernel",
  script: "kernel",
  // engine — one turn, one dispatch, one ladder: watch and the modules it
  // drives. The concerns are policies and the contract is contract, even
  // where they physically sit under engine/.
  watch: "engine",
  attempt: "engine",
  session: "engine",
  "exec-session": "engine",
  "session-api": "engine",
  "chain-transitions": "engine",
  "engine/dispatch": "engine",
  "engine/events": "engine",
  "engine/fx": "engine",
  "engine/ladder": "engine",
  "engine/result": "engine",
  "engine/spine": "engine",
  "engine/sources": "engine",
  // policies — the run's decision rules: the turn concerns, the router and
  // everything routing, usage, recovery and control decides by.
  "engine/concerns/failure": "policies",
  "engine/concerns/guard": "policies",
  "engine/concerns/liveness": "policies",
  "engine/concerns/questions": "policies",
  "engine/concerns/recovery": "policies",
  "engine/concerns/step-up": "policies",
  "engine/concerns/stuck": "policies",
  "engine/concerns/test": "policies",
  "engine/concerns/transcript": "policies",
  "engine/concerns/usage": "policies",
  "engine/concerns/windows": "policies",
  router: "policies",
  usage: "policies",
  "quota-windows": "policies",
  classify: "policies",
  stuck: "policies",
  "model-step": "policies",
  capability: "policies",
  failback: "policies",
  step: "policies",
  hibernate: "policies",
  exit: "policies",
  interactive: "policies",
  select: "policies",
  routing: "policies",
  "model-route": "policies",
  "model-window": "policies",
  tier: "policies",
  // The session-role registry sits in policies beside the tier table it
  // feeds: pure descriptors plus lookups over the routing words (its only
  // value reach is the switches' MODEL_ROLES vocabulary), consumed by tier
  // (same sub-domain) and by the pipeline's driving call sites.
  "roles/registry": "policies",
  keyring: "policies",
  models: "policies",
  "models-schema": "policies",
  "models-describe": "policies",
  // pipeline — the task pipeline: the loops and plans that decide what runs,
  // runner at the top, down to the bypass and wrap-up halves.
  runner: "pipeline",
  execute: "pipeline",
  split: "pipeline",
  // The lane scheduler (plans/0068 §6.2) — pipeline beside the loops it
  // branches (S3 landed: loop-task.ts's lane and isolation loops): pure
  // functions over the task store's structures and the document domain's
  // unit machinery, reaching no session-driving layer.
  lanes: "pipeline",
  loop: "pipeline",
  "loop-phase": "pipeline",
  "loop-plan": "pipeline",
  "loop-preflight": "pipeline",
  "loop-progress": "pipeline",
  "loop-task": "pipeline",
  // The branch-isolation landing command (plans/0074 U-L2): pipeline beside
  // close — the person-invoked return path of a round's isolation, reaching
  // git's kernel primitives and the runtime config/shell only.
  land: "pipeline",
  plan: "pipeline",
  "plan-input": "pipeline",
  "prompt-plan": "pipeline",
  close: "pipeline",
  "task-add": "pipeline",
  wrapup: "pipeline",
  artifact: "pipeline",
  knowledge: "pipeline",
  conclusion: "pipeline",
  status: "pipeline",
  "round-close": "pipeline",
  // The standalone work order and its adopt step (plans/0076, T-137): the
  // guest-model halves behind plan's rows 12–13 — the export's render
  // composition (constitution preamble + the whole-task prompt under the
  // attended flag) and the adopt's validation / test-handover / commit body.
  // Pipeline beside plan, its only caller.
  "work-order": "pipeline",
  // runtime — the process plane: switches, logging, services, options,
  // config, the agent start, the shell profile and the run lock.
  switches: "runtime",
  log: "runtime",
  services: "runtime",
  opts: "runtime",
  config: "runtime",
  "config-fix": "runtime",
  "agent-choice": "runtime",
  "agent-env": "runtime",
  "agent-pool": "runtime",
  shell: "runtime",
  gitignore: "runtime",
  "agents-block": "runtime",
  clean: "runtime",
  confirm: "runtime",
  reset: "runtime",
  // AUTO-DECISION: prompt-facts (the PromptFacts builder) sits in runtime —
  // it reads only the switches and the provider loaders (pack, template) and
  // is consumed by every sub-domain that renders (pipeline, engine, kernel,
  // policies alike), so no other placement fits its edge set.
  "prompt-facts": "runtime",
  // The formatters leaf (0069 §2.2 D10, T-125): pure rendering over the
  // agent plane's values, no I/O and no state, consumed by policies
  // (model-step, classify, the turn concerns), engine (fx, session-api's
  // own fork lines) and pipeline alike — a runtime leaf is the only
  // placement every consumer's sub-domain reaches without a cross-domain
  // exception (its landing shrank the allowlist: `policies → engine` died).
  format: "runtime",
  "templates.d": "runtime",
  lock: "runtime",
  // AUTO-DECISION: run-status-schema (the run-status event table) sits in
  // runtime — its one consumer is the P2 emitter, which follows log.ts's
  // setter-injection family (the run services holder deliberately excludes
  // log.ts, so the vocabulary's home is the process plane, not a service
  // member); the module imports nothing, so the placement binds no edge.
  "run-status-schema": "runtime",
  // AUTO-DECISION: run-status (the driver-status emitter) sits in runtime —
  // it is the log.ts setter-injection family's own shape (a process-level
  // module beside the log and the stats handles, never a services member),
  // and every emission point below the entry modules (pipeline, kernel,
  // policies alike) reaches it through the seeded cross-sub-domain edges.
  "run-status": "runtime",
}

// The cross-sub-domain value edges measured at E1's commit (0061 §4.10): the
// seed of the ratchet. The list may only shrink — an edge not listed here
// fails the suite, and a listed edge the graph no longer produces is stale
// and must be removed. Two pairs are forbidden outright, in src/ and in this
// table alike: `contract → any other sub-domain` and `engine → pipeline`.
// Shrunk once already: `policies → engine` (0069 §2.2 D10, T-125) died when
// session-api's pure formatters moved into the runtime leaf src/format.ts —
// the seven edges the pair covered were all formatter imports, so the
// removal itself proved the pair stale. A future `policies → engine` edge
// must re-earn its place as a reviewed architecture event.
const SUBDOMAIN_EDGES: Array<[Subdomain, Subdomain]> = [
  ["engine", "contract"],
  ["engine", "kernel"],
  ["engine", "policies"],
  ["engine", "runtime"],
  ["kernel", "pipeline"],
  ["kernel", "policies"],
  ["kernel", "runtime"],
  ["pipeline", "engine"],
  ["pipeline", "kernel"],
  ["pipeline", "policies"],
  ["pipeline", "runtime"],
  ["policies", "contract"],
  ["policies", "kernel"],
  ["policies", "runtime"],
  ["runtime", "kernel"],
  ["runtime", "policies"],
]

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
    // The run-events journal (plans/0061 R4/F1), below the two modules that
    // append to it (the spine's inputs and settles, the fx's calls and
    // answers): it reaches the contract module's types only.
    "engine/events": 4,
    // The turn spine (plans/0061 §4.4), directly under its executor: it
    // reaches the contract module's types and the journal.
    "engine/spine": 5,
    // The production TurnFx (plans/0061 §4.2/§4.3): beside the spine, under
    // watch — it reaches the contract's types, the journal and the unranked
    // leaves below the session layer (log, session-api, format, testrun, git,
    // handover, stats).
    "engine/fx": 6,
    // The turn's synthetic-input sources (plans/0061 §4.2/§4.4), taking the
    // slot beside the spine: they reach the contract and spine types, the
    // router's answer type and session-api's probeSession.
    "engine/sources": 7,
    // The extracted turn concerns (plans/0061 §4.5/§4.6), in their extraction
    // order, filling the slots up to watch: each reaches the contract's types
    // and the unranked leaves below the session layer; watch installs them —
    // the remainder layer that held the not-yet-extracted cells during the
    // extraction units is deleted, every slice owned by its own concern.
    "engine/concerns/guard": 8,
    "engine/concerns/transcript": 9,
    "engine/concerns/windows": 10,
    "engine/concerns/stuck": 11,
    "engine/concerns/questions": 12,
    "engine/concerns/failure": 13,
    "engine/concerns/recovery": 14,
    "engine/concerns/liveness": 15,
    "engine/concerns/usage": 16,
    "engine/concerns/step-up": 17,
    "engine/concerns/test": 18,
    // The turn's result mapping (plans/0061 §4.6), directly under the
    // concern it reads (recovery's reset fields) and its caller watch.
    "engine/result": 19,
    watch: 20,
    attempt: 21,
    session: 22,
    artifact: 23,
    "exec-session": 23,
    execute: 24,
    runner: 25,
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
  // AUTO-DECISION: lanes gets a one-way rule besides its classification row (plans/0068 §6.2: the scheduler is pure readiness over the loaded plan and the registry; the lane loops that drive it since S3 landed live in loop-task.ts, above it — so nothing in it may reach a loop or the session-driving layer)
  {
    from: "lanes",
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
    ],
    why: "the lane scheduler decides readiness from the plan, the merged unit states and the registry (plans/0068 §6.2, D5) — pure over injected facts in select.ts's shape — so it must not import the loops or the session-driving layer; the lane loop that consumes it (S3's runLaneLoop in loop-task.ts, landed) drives it from above",
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

// The core never imports HTTP (plans/0067 §三.1, the headless-service
// constitution): no HTTP module import and no HTTP server API anywhere in
// src/. Serving is a shell's duty — the service shell (packages/auto-server)
// owns Bun.serve, and the core it drives stays transport-free. The one network
// adjacency the core keeps is the opencode adapter's SDK client over the
// agent's own loopback server (agent/opencode/server.ts, the SDK's fetch
// injection point): a client, never a listener, and it imports no HTTP module
// of its own. Held verbally through the P2/P3 core changes (the emitter, the
// io/Interactive seam — both transport-blind by design), this suite makes the
// line an assertion: a planted `node:http` import or Bun.serve call fails it.
const HTTP_MODULES = ["http", "https", "http2", "node:http", "node:https", "node:http2"]
const HTTP_SERVER_APIS = [/Bun\.serve/, /Bun\.listen/, /Bun\.websocket/]

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
// Driver modules carry their sub-domain beside the domain; every other
// module (provider domain, unclassified) has none.
const subdomainOf = (key: string): Subdomain | undefined => (domainOf(key) === "driver" ? SUBDOMAIN[key] : undefined)

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
      if (dFrom !== "driver") {
        // provider-domain module — placed in a domain directory or still flat
        // (the flat files joined with E3, when FROZEN_IMPORTS was retired):
        // never imports driver; crosses domains only via the other domain's
        // entry module
        if (dTo === "driver") problems.push(`domain violation: src/${from}.ts (${dFrom}) imports driver module src/${e.to}.ts — provider domains must not depend on the driver domain (D8)`)
        else if (dTo !== dFrom && !entriesOf(dTo).includes(e.to)) problems.push(`domain violation: src/${from}.ts (${dFrom}) imports src/${e.to}.ts (${dTo}) outside its entry list [${entriesOf(dTo).join(", ")}] — depend on a domain only via its interface module (D8)`)
      }
      if (dFrom === "driver" && inDomainDir(e.to) && !entriesOf(dTo).includes(e.to)) problems.push(`domain violation: src/${from}.ts (driver) imports src/${e.to}.ts (${dTo}) outside its entry list [${entriesOf(dTo).join(", ")}] — depend on a domain only via its interface module (D8)`)
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

// The no-HTTP constitution (plans/0067 §三.1): no HTTP module import (the
// externalImports scan already collected every bare and node:-prefixed
// specifier) and no Bun HTTP-server API in any module's text.
function checkNoHttp(): string[] {
  const problems: string[] = []
  for (const [key, pkgs] of externalImports) {
    for (const pkg of pkgs) {
      if (HTTP_MODULES.includes(pkg)) {
        problems.push(`HTTP import: src/${key}.ts imports "${pkg}" — the core never imports HTTP (plans/0067 §三.1); serving belongs to a shell`)
      }
    }
  }
  for (const key of modules) {
    const text = readFileSync(join(SRC, key + ".ts"), "utf8")
    for (const pattern of HTTP_SERVER_APIS) {
      if (pattern.test(text)) problems.push(`HTTP server API: src/${key}.ts calls ${pattern.source} — the core never serves; the service shell does`)
    }
  }
  return problems
}

function checkSubdomains(): string[] {
  const problems: string[] = []
  const known = new Set(modules)
  for (const key of modules) {
    if (domainOf(key) === "driver" && !(key in SUBDOMAIN)) problems.push(`sub-domain missing: src/${key}.ts is a driver module without a SUBDOMAIN entry — every driver module carries a sub-domain (R10)`)
  }
  for (const key of Object.keys(SUBDOMAIN)) {
    if (!known.has(key)) problems.push(`SUBDOMAIN lists src/${key}.ts which does not exist — remove the stale entry`)
    else if (domainOf(key) !== "driver") problems.push(`SUBDOMAIN lists src/${key}.ts which is not a driver module (${domainOf(key)}) — sub-domains classify the driver domain only (R10)`)
  }
  return problems
}

// Sub-domain edges are measured over value imports only (the column comment
// above states why); the table is the ratchet: no unlisted pair, no stale
// entry, and the two forbidden pairs hold in src/ and in the table alike.
function checkSubdomainEdges(): string[] {
  const problems: string[] = []
  const measured = new Set<string>()
  for (const [from, list] of edges) {
    const a = subdomainOf(from)
    if (a === undefined) continue
    for (const e of list) {
      if (e.typeOnly) continue
      const b = subdomainOf(e.to)
      if (b === undefined || a === b) continue
      measured.add(`${a}→${b}`)
      if (a === "contract") problems.push(`contract not a leaf: src/${from}.ts (contract) value-imports src/${e.to}.ts (${b}) — the contract sub-domain is types and pure functions only; it takes no value from any other sub-domain (R10)`)
      if (a === "engine" && b === "pipeline") problems.push(`engine reaches the pipeline: src/${from}.ts (engine) value-imports src/${e.to}.ts (pipeline) — the turn engine must not know the task pipeline (R10)`)
      if (!SUBDOMAIN_EDGES.some(([x, y]) => x === a && y === b)) problems.push(`new sub-domain edge: ${a} → ${b} (src/${from}.ts → src/${e.to}.ts) is outside SUBDOMAIN_EDGES — the allowlist may only shrink, so a new cross-sub-domain dependency is an architecture event, never a silent edit (R10)`)
    }
  }
  for (const [a, b] of SUBDOMAIN_EDGES) {
    const pair = `${a}→${b}`
    if (a === "contract") problems.push(`SUBDOMAIN_EDGES lists ${pair} — the contract sub-domain holds no edge to another sub-domain, not even an allowlisted one (R10)`)
    else if (a === "engine" && b === "pipeline") problems.push(`SUBDOMAIN_EDGES lists ${pair} — engine → pipeline is forbidden outright and may never be allowlisted (R10)`)
    else if (!measured.has(pair)) problems.push(`stale SUBDOMAIN_EDGES entry: ${pair} no longer occurs among src/'s value imports — remove it (the list may only shrink, and a dead entry hides the shrink)`)
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

  test("no shell imports (core does not know shells)", () => {
    expect(checkHygiene().join("\n")).toBe("")
  })

  test("no HTTP imports or server APIs (0067: the core never imports HTTP)", () => {
    expect(checkNoHttp().join("\n")).toBe("")
  })

  test("every driver module carries a sub-domain (R10)", () => {
    expect(checkSubdomains().join("\n")).toBe("")
  })

  test("sub-domain value edges stay inside the seeded allowlist; contract is a leaf, no engine → pipeline (R10)", () => {
    expect(checkSubdomainEdges().join("\n")).toBe("")
  })
})
