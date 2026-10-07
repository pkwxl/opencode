// Session-role registry (U-R5, plans/0060 §5.6 / 0064 §5 item 4 / 0069 §2.3
// R5): the workflow-shape axis beside the phase-type registry — what a phase
// type is for the phased flow, a session role is for the work a run drives.
// Seven work kinds exist today (decompose, whole, subtask, wrapup, planning,
// handover, knowledge); each declares, as data, the five facts every driving
// call site used to hardwire for itself:
//
//   - template:    which templates/prompts/*.md renders the role (the prompt
//                  layer keeps the render* signatures stable, so the callers
//                  stay unaware of the mechanism; the declaration is pinned
//                  against the live template library by the registry test);
//   - tier route:  the program-default reasoning tier the role routes on
//                  (src/tier.ts reads this table instead of its own — a role
//                  word without a descriptor home fails loudly there);
//   - usage source: which usage-driven mechanisms (src/usage.ts) the role's
//                  sessions participate in — the context-handover protocol
//                  (steer + post-session check), the test handover, the fork
//                  guard, the lead's split guard;
//   - collect:     how the driver collects and validates the session's
//                  document artifacts (the policy vocabulary below);
//   - verdict:     how the role's completion is judged — driver-owned state
//                  (validated artifacts, renames, ticks, commits) versus a
//                  session-written verdict line the driver reads.
//
// Descriptive-first, deliberately: the descriptors are data plus lookups, not
// behavior tables — the pipeline stays in execute/runner/loop-* and the
// engine in session/exec-session; the registry is what a *new* work kind
// fills in instead of surgery on those files (0069 R5: "a new kind of work
// becomes a descriptor, not surgery on execute.ts/runner.ts"). Facts that are
// genuinely per-call (which mode built the steer, which knowledge variant
// runs, the subtask ordinal) stay parameters at the call sites.
//
// Routing words. The registry's key space is the seven work kinds; model
// routing is keyed finer (src/switches.ts MODEL_ROLES, the env grammar's
// role words). Each descriptor claims its routing words in `routing`; every
// live role word is claimed by exactly one descriptor except ROUTING_FALLBACK
// ("bypass" — the word for one-off sessions that are no work kind: confirm
// turns, the dryrun preflight, the classifier, liveness probes). The registry
// test holds the two sides total against each other, so a role word added to
// MODEL_ROLES without a descriptor home fails, and a descriptor naming an
// unknown word fails equally. chain.ts's phaseToRole (the pipeline's
// phase → routing-word mapping) is types-only contract code and cannot read
// this module; the test pins its mapping lands inside the descriptors'
// routing lists instead.
//
// Like the phase registry (phases/registry.ts), the registry is stateless:
// lookups take the descriptor list they search (default: the builtins), so
// nothing depends on a process-wide install step.
import type { Tier } from "../phases/registry"
import { MODEL_ROLES, type ModelRole } from "../switches"

// The seven work kinds (0060 §5.6). Ids follow the codebase's own vocabulary:
// "whole" is the whole-task session (auto's lead is a whole session with its
// split clause — a per-call variant, not a role of its own); "handover" is
// the phase-handover distillation (the context-handover mechanism of whole
// and subtask sessions is the "handoff" family in docpaths/testrun wording,
// never a role).
export const SESSION_ROLES = ["decompose", "whole", "subtask", "wrapup", "planning", "handover", "knowledge"] as const
export type SessionRole = (typeof SESSION_ROLES)[number]

// Which usage-driven mechanisms (src/usage.ts) a role's sessions run. The
// flags name the mechanism families of the usage-source design; the call
// sites read them where they decide whether to build the mechanism at all,
// while the per-call conditions (the mode, a taken split, the switch state)
// stay at the call site.
export type RoleUsagePolicy = {
  // The context-handover protocol (plans/0056): steer notices + the hard-wall
  // hint in turn, and the post-session handover check (usage.ts
  // sessionHandoverDue) reading the handoff document's status line.
  handover: boolean
  // The --handover-test protocol at the test request (usage.ts
  // testHandoverDue; the runExecSession handover loop) — the execution
  // sessions' mechanism.
  testHandover: boolean
  // The fork-base size guard at seeding (usage.ts forkBaseAllowed): the
  // role's first session may fork a base and the guard reads the base's
  // occupancy.
  forkGuard: boolean
  // The lead's split guard (usage.ts splitUsageReached): whether a split the
  // session writes is judged against the usage wall before it is taken.
  splitGuard: boolean
}

// The collect-policy vocabulary: how the driver collects and validates the
// session's document artifacts. Ids are declared data (like the phase
// registry's PHASE_GATES); the behavior itself stays in the driving modules
// named per id below, so adding an id is a registry entry plus its checker,
// never a scattered edit.
export const COLLECT_POLICIES = [
  // The four artifact groups as a spec table (document/spec.ts
  // decomposeArtifactSpecs) through the generic checker, plus checklist
  // parseability — execute.ts decomposeArtifactProblems.
  "spec-table",
  // The subtask's own `Artifacts:` declarations through the declared-policy
  // checker, the whole-unit eof scan, the P1 prohibition scan and the
  // zero-write check — execute.ts subtaskArtifactProblems.
  "declared-artifacts",
  // The handoff document's status line (document/roles.ts handoffStatus),
  // plus the split checklist judgment for the lead — execute.ts.
  "handoff-status",
  // The fixed-path report's existence + non-trivial + terminator gate —
  // wrapup.ts reportProblems.
  "report-shape",
  // The task index lines and each task document validated against the unit
  // grammar — loop-plan.ts plannedTaskProblems / appendProblems.
  "index-docs",
  // The four mandatory handover sections (document/roles.ts validHandover)
  // and the acceptance-draft rules — loop-phase.ts.
  "handover-sections",
  // A non-empty document, or the session-written closing mark the driver
  // confirms (document/roles.ts PRIOR_KB_DONE) — knowledge.ts.
  "document-marker",
] as const
export type CollectPolicy = (typeof COLLECT_POLICIES)[number]

// The verdict-policy vocabulary: how the role's completion is judged. The
// axis of P-ruled doctrine is driver-owned state versus a session-written
// verdict line — completion is never agent self-report.
export const VERDICT_POLICIES = [
  // Driver-owned state: artifacts the driver validated plus the rename,
  // tick, numbering advance or step close-out it performs (the todo.md →
  // done.md family). No session narrative decides.
  "driver-tick",
  // The session writes a verdict line the driver reads: the task report's
  // `Result:` line (document/roles.ts parseResult) — FAIL stops the run.
  "report-result",
  // The handoff document's `Status:` line decides continue versus done (the
  // one session-written completion signal of the execution stage's loop).
  "handoff-status",
  // The phase's own completion gates (phases/registry.ts PHASE_GATES) read
  // after the distillation: the verdict.md result line and the acceptance
  // sign-off.
  "phase-gates",
  // A session-written closing mark the driver confirms before promoting the
  // document (prior-knowledge's DONE; the k-phase kb.md is validated
  // non-empty the same way).
  "document-marker",
] as const
export type VerdictPolicy = (typeof VERDICT_POLICIES)[number]

export type SessionRoleEntry = {
  // Work-kind id (SESSION_ROLES).
  role: SessionRole
  // Human-readable name (the `kind` wording of the role's sessions).
  name: string
  // Model-routing words (MODEL_ROLES) this work kind routes under. Exactly
  // one descriptor claims each word; ROUTING_FALLBACK is claimed by none.
  routing: readonly ModelRole[]
  // Templates that render this role. The decompose family's per-phase
  // variant comes from the phase registry (PhaseTypeEntry.decomposeTemplate,
  // with the family base as the fallback); every other name is the whole
  // template for the role's session (a fanout/a phase-append/
  // an implement-plan is a variant prompt of its role, not a role of its
  // own).
  templates: readonly string[]
  // The program-default tier of the role's sessions: a fixed tier, or
  // "execute" = the current phase type's execute tier (src/tier.ts
  // defaultTier). Every routing word of the role shares the descriptor's
  // tier.
  tier: Tier | "execute"
  // Which usage-driven mechanisms the role's sessions run.
  usage: RoleUsagePolicy
  // How the driver collects and validates the session's artifacts.
  collect: CollectPolicy
  // How the role's completion is judged.
  verdict: VerdictPolicy
}

// The one routing word no descriptor claims: the fallback of chain.roleOf for
// one-off sessions that are no work kind (confirm turns, the dryrun
// preflight, the classifier, liveness probes). Its default tier is the
// registry's too (src/tier.ts), so the word stays total without a descriptor
// pretending a work kind around it.
export const ROUTING_FALLBACK: ModelRole = "bypass"
export const ROUTING_FALLBACK_TIER: Tier = "simple"

export const SESSION_ROLE_DESCRIPTORS: readonly SessionRoleEntry[] = [
  {
    role: "decompose",
    name: "task understanding + decomposition",
    routing: ["decompose"],
    // The family base; the per-phase variant (decompose-<phase>) is the
    // phase entry's decomposeTemplate.
    templates: ["decompose"],
    tier: "deep",
    usage: { handover: false, testHandover: false, forkGuard: false, splitGuard: false },
    collect: "spec-table",
    // The artifacts are validated by the driver and the checklist becomes
    // its injection input; the session id is recorded as the fork base — no
    // tick of its own.
    verdict: "driver-tick",
  },
  {
    role: "whole",
    name: "whole-task execution",
    routing: ["whole"],
    templates: ["whole"],
    // The task sessions take the phase type's execute tier.
    tier: "execute",
    // The context-handover protocol when the mode builds it (off never does;
    // ondemand and auto's lead do), the test handover of --test-by-driver,
    // and — the lead alone — the split guard over the checklist it may
    // write.
    usage: { handover: true, testHandover: true, forkGuard: false, splitGuard: true },
    collect: "handoff-status",
    verdict: "handoff-status",
  },
  {
    role: "subtask",
    name: "subtask execution",
    routing: ["subtask"],
    // fanout = the stream-of-a-split variant prompt; the fork's delta alone.
    templates: ["subtask", "fanout"],
    tier: "execute",
    // The streams of a taken split run the handover protocol; every subtask
    // session runs under --test-by-driver's test handover and seeds through
    // the fork-base guard.
    usage: { handover: true, testHandover: true, forkGuard: true, splitGuard: false },
    collect: "declared-artifacts",
    // Never agent self-report: the artifact shape check gates the driver's
    // rename and checklist tick.
    verdict: "driver-tick",
  },
  {
    role: "wrapup",
    name: "task wrap-up",
    routing: ["wrapup"],
    templates: ["wrapup"],
    tier: "simple",
    usage: { handover: false, testHandover: false, forkGuard: false, splitGuard: false },
    collect: "report-shape",
    verdict: "report-result",
  },
  {
    role: "planning",
    name: "phase planning",
    // phase-append routes under phase-plan by design (plans/0053 D23/F6: no
    // new role word); implement-scan is the m-mode planning scan.
    routing: ["phase-plan", "implement-scan"],
    // implement-plan = the m-mode variant against the planning input;
    // phase-append = the append variant.
    templates: ["phase-plan", "phase-append", "implement-plan"],
    tier: "deep",
    usage: { handover: false, testHandover: false, forkGuard: false, splitGuard: false },
    collect: "index-docs",
    verdict: "driver-tick",
  },
  {
    role: "handover",
    name: "phase handover distillation",
    routing: ["phase-handover"],
    templates: ["phase-handover"],
    tier: "simple",
    usage: { handover: false, testHandover: false, forkGuard: false, splitGuard: false },
    collect: "handover-sections",
    verdict: "phase-gates",
  },
  {
    role: "knowledge",
    name: "knowledge extraction",
    // One work kind, three one-shot variants: the k-phase extraction, the
    // second-migration prior-knowledge extraction, and the numbering-record
    // recovery (all "read evidence, distill a document" sessions through
    // requireArtifact). Since plans/0082 §4 D4 the blockage diagnosis
    // session rides the same simple side-channel tier: a read-only
    // one-artifact session over the requireArtifact skeleton, its strict
    // parse the backstop.
    routing: ["knowledge", "prior-knowledge", "number-recovery", "diagnose"],
    templates: ["knowledge", "prior-knowledge", "number-recovery", "diagnose"],
    tier: "simple",
    usage: { handover: false, testHandover: false, forkGuard: false, splitGuard: false },
    collect: "document-marker",
    verdict: "document-marker",
  },
]

// Look a work kind up (default: the builtins). Throws naming the id when the
// registry has no such descriptor — a missing descriptor fails loudly, never
// silently degrades to a default.
export function sessionRole(role: string, descriptors: readonly SessionRoleEntry[] = SESSION_ROLE_DESCRIPTORS): SessionRoleEntry {
  const entry = descriptors.find((descriptor) => descriptor.role === role)
  if (!entry) throw new Error(`unknown session role: ${role} (known: ${descriptors.map((descriptor) => descriptor.role).join(", ")})`)
  return entry
}

// The descriptor a routing word belongs to. Throws when the word is claimed
// by no descriptor (or claimed twice, which the registry test also holds
// apart); ROUTING_FALLBACK is deliberately unclaimed and throws like any
// other wordless id — callers route it through its own tier constant.
export function routingRole(word: string, descriptors: readonly SessionRoleEntry[] = SESSION_ROLE_DESCRIPTORS): SessionRoleEntry {
  const claims = descriptors.filter((descriptor) => descriptor.routing.includes(word as ModelRole))
  if (claims.length === 1) return claims[0]!
  if (claims.length > 1) throw new Error(`routing word ${word} is claimed by ${claims.length} session roles (${claims.map((claim) => claim.role).join(", ")}); exactly one descriptor must claim it`)
  throw new Error(`routing word ${word} is claimed by no session role (known words: ${descriptors.flatMap((descriptor) => [...descriptor.routing]).join(", ")})`)
}

// The program-default tier of every routing word (src/tier.ts ROLE_TIERS
// reads this): each descriptor's tier for its words, the fallback's constant
// for ROUTING_FALLBACK. Total over MODEL_ROLES by construction and throws
// through routingRole the moment a role word has no descriptor home — the
// load-time half of the registry's totality, the test the other.
export function roleTiers(descriptors: readonly SessionRoleEntry[] = SESSION_ROLE_DESCRIPTORS): Record<ModelRole, Tier | "execute"> {
  const tiers = {} as Record<ModelRole, Tier | "execute">
  for (const word of MODEL_ROLES) {
    tiers[word] = word === ROUTING_FALLBACK ? ROUTING_FALLBACK_TIER : routingRole(word, descriptors).tier
  }
  return tiers
}
