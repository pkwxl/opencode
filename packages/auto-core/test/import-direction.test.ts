// Import-direction enforcement (plan M0.7 / F11; D8 one-way domain deps).
// Verbal conventions decay; this suite makes them assertions. It scans src/ at
// runtime and checks, in order of increasing abstraction:
//   1. classification   — every src module is consciously placed in a D8 domain
//   2. acyclicity       — the runtime (value) import graph stays a DAG
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
// Type-only edges count for direction rules but not for cycle detection (TS
// erases them, so they cannot form runtime cycles).
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
  // machinery (M1.4 — `产出:` declaration parser, decompose/state-file spec
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
  // Agent environments (plans/0055 §4.2, §8.10): an agent profile's env
  // resolved into the overlay a host starts with, and the loopback proxy
  // warning of preflight.
  "agent-env": "driver",
  "agents-block": "driver",
  artifact: "driver",
  attempt: "driver",
  capability: "driver",
  chain: "driver",
  check: "driver",
  clean: "driver",
  // Closing units: closeUnit, the mechanical handover, the close commit
  // (plans/0053 D17–D21).
  close: "driver",
  conclusion: "driver",
  config: "driver",
  // Config fix: the rule table behind `fix` (plans/0052 D10).
  "config-fix": "driver",
  confirm: "driver",
  "exec-session": "driver",
  execute: "driver",
  exit: "driver",
  failback: "driver",
  gitignore: "driver",
  git: "driver",
  handover: "driver",
  hibernate: "driver",
  interactive: "driver",
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
  // lines, pure over the limits; the cache-claim check's run state. Watch
  // (the live half), attempt and the loop build on it.
  "model-step": "driver",
  numbering: "driver",
  opts: "driver",
  // plan's prelude and stop lines (plans/0053 D4–D8); never imports the loop.
  plan: "driver",
  // The planning input plan-input.md: read, persist, commit (plans/0053 D9).
  "plan-input": "driver",
  // The planning renderers, moved out of prompt.ts (plans/0053 A2).
  "prompt-plan": "driver",
  refcheck: "driver",
  reset: "driver",
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
  // clock and the run state injected. Sits below the session layer, above
  // the agent domain (§12).
  select: "driver",
  "session-api": "driver",
  session: "driver",
  shell: "driver",
  stats: "driver",
  status: "driver",
  step: "driver",
  stuck: "driver",
  switches: "driver",
  // The task store (M3.4): task units + runtime state; replaced plan.ts.
  tasks: "driver",
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
  watch: 0,
  attempt: 1,
  session: 2,
  artifact: 3,
  "exec-session": 3,
  execute: 4,
  runner: 6,
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
    const typeOnly = /^import\s+type\b/.test(head) || /^export\s+type\b/.test(head)
    record(m[1]!, typeOnly)
  }
  // bare `import "spec"` (side-effect imports)
  for (const m of text.matchAll(/^import\s*["']([^"']+)["']/gm)) record(m[1]!, false)
  edges.set(key, list)
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

function checkAcyclicity(): string[] {
  const valueAdj = new Map<string, string[]>()
  for (const [from, list] of edges) valueAdj.set(from, list.filter((e) => !e.typeOnly).map((e) => e.to))
  const NO_COLOR = 0
  const ACTIVE = 1
  const DONE = 2
  const color = new Map<string, number>()
  const stack: string[] = []
  const cycle: string[] | null = (() => {
    const visit = (node: string): string[] | null => {
      color.set(node, ACTIVE)
      stack.push(node)
      for (const next of valueAdj.get(node) ?? []) {
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
  })()
  if (cycle) return [`runtime import cycle: ${cycle.join(" → ")}`]
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
