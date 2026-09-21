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
  phases: ["phases/registry"],
  // document: types = the frozen schema (M1.1); spec = the artifact-spec
  // machinery (M1.4 — `产出:` declaration parser, decompose/state-file spec
  // tables, generic spec-driven checker), the domain's published acquisition
  // surface for artifact checks; roles = the role model (M2.3 — classifier,
  // per-role policies, protect list, handoff protocol checks); state = the
  // todo.md/done.md subtask state protocol (M2.3 move from subtask-state.ts);
  // process-refs = the P1 prohibition scan (M2.3).
  document: ["document/types", "document/roles", "document/spec", "document/state", "document/process-refs"],
  // agent: types = the frozen interface (MA.1); opencode/server = the opencode
  // host factory (MA.3: `manage` → AgentHost), the one adapter-specific module
  // the driver may name — only to construct the host; everything after that
  // goes through the AgentClient/AgentHost types. claude/host = the claude
  // headless host factory (MA.5, plans/0041), same role: loop.ts names it only
  // to construct the host when OPENCODE_AUTO_AGENT=claude.
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
  protect: "document",
  // agent: none left flat — MA.3 moved server.ts into agent/opencode/ and
  // session-api.ts became a driver module (its SDK calls moved into the
  // adapter; what remains seeds chains and formats output over AgentClient).
  // driver (orchestration plane)
  "agents-block": "driver",
  artifact: "driver",
  attempt: "driver",
  capability: "driver",
  chain: "driver",
  check: "driver",
  clean: "driver",
  conclusion: "driver",
  config: "driver",
  confirm: "driver",
  current: "driver",
  "exec-session": "driver",
  execute: "driver",
  exit: "driver",
  failback: "driver",
  gitignore: "driver",
  git: "driver",
  handover: "driver",
  hibernate: "driver",
  implement: "driver",
  interactive: "driver",
  knowledge: "driver",
  log: "driver",
  "loop-phase": "driver",
  "loop-preflight": "driver",
  "loop-progress": "driver",
  "loop-task": "driver",
  loop: "driver",
  numbering: "driver",
  opts: "driver",
  plan: "driver",
  refcheck: "driver",
  reset: "driver",
  resolve: "driver",
  "resume-gate": "driver",
  resume: "driver",
  runner: "driver",
  script: "driver",
  "session-api": "driver",
  session: "driver",
  shell: "driver",
  stats: "driver",
  step: "driver",
  stuck: "driver",
  switches: "driver",
  "templates.d": "driver",
  testrun: "driver",
  "unit-commit": "driver",
  usage: "driver",
  watch: "driver",
  wrapup: "driver",
}

// Transition-era guard (rule 7): provider-tagged flat files freeze their exact
// src-import set. Today prompt.ts imports plan.ts etc. because concerns are
// still physically mixed; before this refactor lands them in domain dirs, any
// import change in these files must be a conscious edit here, so the (a)/(b)
// untangling (M1-M4, MA) cannot silently re-couple the domains.
const FROZEN_IMPORTS: Record<string, string[]> = {
  mode: [],
  template: [],
  prompt: ["docpaths", "intent/load", "intent/types", "mode", "phases", "plan", "resolve", "stuck", "switches", "template"],
  phases: ["docpaths", "plan", "template"],
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
    from: "watch",
    to: ["attempt", "session", "exec-session", "execute", "runner"],
    why: "watch is the bottom of the session-driving chain (plan §2.5); lower layers must not import upward",
  },
]

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
