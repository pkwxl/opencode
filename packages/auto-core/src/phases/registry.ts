// Phase-type registry (M3.2, plans/0047 §5): the phases domain's entry module.
// A phase *type* is a registry entry, not a hard-coded letter. The six builtin
// types keep their admtvk letters only as `--phases` presets: `adm` expands to
// analysis, design, implement. Everything that used to be a per-letter literal
// table (names, decompose template, plan duties, the k-phase special case)
// reads from here.
//
// Custom types (M3.6) come from the project's .opencode/auto/phases/<type>.md
// (src/phases/custom.ts, loadPhaseTypes). The registry itself stays stateless:
// every lookup takes the type list it searches, and a phase unit carries its
// resolved entry, so nothing depends on a process-wide install step. The
// runtime keys a phase by its qualified id (R-NN.P<nn>) and its type, never by
// the preset letter, so a type may occur more than once in a round.
import type { ArtifactSpec } from "../document/types"

// The preset letters in canonical order. The order is semantic: a preset
// string must be a subsequence of it (see expandPhases).
export const PHASE_LETTERS = ["a", "d", "m", "t", "v", "k"] as const
export type PhaseLetter = (typeof PHASE_LETTERS)[number]

// Completion gates a phase type may carry (M4.2, plans/0049 G7), checked
// before the phase is marked done (phases.ts completePhase):
// - verdict: the phase directory's verdict.md result line; `Result: FAIL` blocks;
// - acceptance: the phase directory's acceptance.md must carry the human's
//   `Accepted: yes`. Builtin types get it from config `acceptanceGate`;
// - human (plans/0081 D14.3): the phase directory's survey.md — zero `Fork:`
//   lines (or the person's `Clarified: yes`) completes the phase, at least
//   one open fork holds it open for the person. Shipped on the re-work
//   bundles' survey type; builtin types carry none.
export const PHASE_GATES = ["verdict", "acceptance", "human"] as const
export type PhaseGate = (typeof PHASE_GATES)[number]

// Reasoning tiers (plans/0055 §3, §5): how much reasoning a session's work
// needs. A tier is a property of the work, so the program declares it for its
// builtin types and a project for its custom types; the operator's model
// registry (src/models.ts) only lists which models serve each tier.
// AUTO-DECISION: the tier vocabulary is declared here and re-exported by src/models.ts (the phases domain may not import the driver, and a phase type's execute tier, a custom type's `Reasoning:` value and the registry's tier lists must share one list of words)
export const TIERS = ["deep", "simple"] as const
export type Tier = (typeof TIERS)[number]

export type PhaseTypeEntry = {
  // Type id: the `<type>` of a phase directory `P<nn>-<type>` (M3.3).
  type: string
  // Preset letter for `--phases` (builtin types only; custom types have none).
  letter?: PhaseLetter
  // Human-readable name: logs, commit subjects, the `phaseName` prompt var.
  // Builtins are Chinese until the M3.8 translation batch; a custom type's is
  // its file's title line.
  name: string
  // Key of this type's duty text: the `### <key>` subsection under an intent
  // pack's `## phase duties` (decompose), and the `plan-duties-<key>` shared
  // partial (phase-plan). Builtins use their letter, so existing packs and
  // overlays keep resolving; a custom type uses its type id.
  dutiesRef: string
  // Duty text carried by a custom type's own file (`## plan duties` /
  // `## decompose duties`). When present it replaces the dutiesRef lookup
  // for that session; builtins carry none.
  planDuties?: string
  decomposeDuties?: string
  // Prompt template of this type's decompose session.
  decomposeTemplate: string
  // Standard artifacts, paths relative to the unit directory (the phase dir
  // resp. the task dir); resolve with unitArtifactSpecs.
  phaseArtifacts: ArtifactSpec[]
  taskArtifacts: ArtifactSpec[]
  // false = the phase runs one direct driver session instead of planning and
  // executing tasks (knowledge).
  hasTasks: boolean
  // The type's own completion gates (PHASE_GATES); empty = none.
  gates: PhaseGate[]
  // Execute tier: the tier of this type's task sessions (`whole`, `subtask`);
  // src/tier.ts defaultTier derives every session's default tier from it and
  // the session's role. A custom type's is its `Reasoning:` field.
  reasoning: Tier
  // The type produces code work (plans/0083 D9): builtin `implement` and
  // `test` carry it, a custom type declares it with `Code-work: yes` beside
  // `Reasoning:`. The --test-by-driver channel's active condition derives
  // from it — `testByDriver && codeWork(phase)` — so the protocol runs only
  // in code-producing phases; absent = not code work (the channel is off for
  // the type). Derivation, not configuration: the config keys keep their
  // constitutional on/off meaning.
  codeWork?: boolean
  // Where the entry comes from; a project file is `.opencode/auto/phases/<type>.md`.
  origin: "builtin" | "project"
}

// A phase as the session layer sees it (Opts.phase): the qualified phase id
// R-NN.P<nn> (resolve records, stats bucket) and the resolved type entry
// (model routing, decompose template and duties).
export type PhaseKey = { id: string; entry: PhaseTypeEntry }

const artifact = (path: string, label: string): ArtifactSpec => ({ path, label, role: "artifact" })

// Execute tiers (plans/0055 §5): analysis and design are reasoning work, and
// the acceptance verdict must not pass wrongly, so they are deep. Implement
// runs small, specified subtasks from a deep decompose; test works against a
// specified behavior and knowledge is extraction, so they are simple.
export const BUILTIN_PHASE_TYPES: readonly PhaseTypeEntry[] = [
  {
    type: "analysis",
    letter: "a",
    name: "Analysis",
    dutiesRef: "a",
    decomposeTemplate: "decompose-a",
    phaseArtifacts: [artifact("findings.md", "analysis findings")],
    taskArtifacts: [artifact("analysis.md", "task analysis")],
    hasTasks: true,
    gates: [],
    reasoning: "deep",
    origin: "builtin",
  },
  {
    type: "design",
    letter: "d",
    name: "Design",
    dutiesRef: "d",
    decomposeTemplate: "decompose-d",
    phaseArtifacts: [artifact("design.md", "phase design"), artifact("decisions.md", "design decisions")],
    taskArtifacts: [artifact("design.md", "task design")],
    hasTasks: true,
    gates: [],
    reasoning: "deep",
    origin: "builtin",
  },
  {
    type: "implement",
    letter: "m",
    name: "Implementation",
    dutiesRef: "m",
    decomposeTemplate: "decompose-m",
    phaseArtifacts: [],
    taskArtifacts: [],
    hasTasks: true,
    gates: [],
    reasoning: "simple",
    // 0083 D9's review ruling: test in — the test type's sessions also route
    // their checks through the driver-run channel.
    codeWork: true,
    origin: "builtin",
  },
  {
    type: "test",
    letter: "t",
    name: "Testing",
    dutiesRef: "t",
    decomposeTemplate: "decompose-t",
    phaseArtifacts: [artifact("test-report.md", "test report")],
    taskArtifacts: [artifact("test-log.md", "test log")],
    hasTasks: true,
    gates: [],
    reasoning: "simple",
    // 0083 D9's review ruling: test in (the type's whole point is code work).
    codeWork: true,
    origin: "builtin",
  },
  {
    type: "acceptance",
    letter: "v",
    name: "Acceptance",
    dutiesRef: "v",
    decomposeTemplate: "decompose-v",
    phaseArtifacts: [artifact("verdict.md", "acceptance verdict")],
    taskArtifacts: [artifact("verification.md", "task verification")],
    hasTasks: true,
    gates: ["verdict"],
    reasoning: "deep",
    origin: "builtin",
  },
  {
    type: "knowledge",
    letter: "k",
    name: "Knowledge distillation",
    dutiesRef: "k",
    decomposeTemplate: "decompose-k",
    phaseArtifacts: [artifact("kb.md", "knowledge base")],
    taskArtifacts: [],
    hasTasks: false,
    gates: [],
    reasoning: "simple",
    origin: "builtin",
  },
]

// The type every phase sequence must contain: a phased flow without
// implementation is meaningless, and "m" alone is the no-phase single run.
export const REQUIRED_TYPE = "implement"

export function isPhaseLetter(value: string): value is PhaseLetter {
  return (PHASE_LETTERS as readonly string[]).includes(value)
}

// Look a type up in a type list (default: the builtins; pass loadPhaseTypes(dir)
// to include the project's custom types).
export function phaseType(type: string, types: readonly PhaseTypeEntry[] = BUILTIN_PHASE_TYPES): PhaseTypeEntry | undefined {
  return types.find((entry) => entry.type === type)
}

export function phaseTypeOfLetter(letter: PhaseLetter): PhaseTypeEntry {
  return BUILTIN_PHASE_TYPES.find((entry) => entry.letter === letter)!
}

// Expand a `--phases` preset string into registry entries; null = invalid
// (the CLI turns it into exit 1). Valid = non-empty, every letter a preset,
// strictly increasing in canonical order (which also rules out repeats), and
// containing the required type. This is the pre-registry whitelist rule
// restated over the registry; a test holds the two equivalent.
export function expandPhases(raw: string): PhaseTypeEntry[] | null {
  if (!raw) return null
  const entries: PhaseTypeEntry[] = []
  let prev = -1
  for (const ch of raw) {
    const index = PHASE_LETTERS.indexOf(ch as PhaseLetter)
    if (index === -1 || index <= prev) return null
    prev = index
    entries.push(phaseTypeOfLetter(ch as PhaseLetter))
  }
  return entries.some((entry) => entry.type === REQUIRED_TYPE) ? entries : null
}

// A phases value in preset form: a non-empty run of preset letters. Any other
// value is a comma-separated list of type ids. Custom type ids may not take
// this shape (custom.ts), so the two forms never overlap.
export const PRESET_FORM = /^[admtvk]+$/

// Resolve a phases value (config.json `phases`, CLI `--phases`) into registry
// entries; null = invalid. Two forms:
// - a letter preset (`adm`): expandPhases, the unchanged whitelist rule;
// - a comma-separated list of type ids (`analysis,security-review,implement`):
//   every id known to `types`, in any order, repeats allowed, containing the
//   required type at least once. Spaces around ids are ignored.
// "m" (the no-phase single run) is a preset; the list `implement` is a phased
// flow with a planning session, not the manual mode.
export function resolvePhases(raw: string, types: readonly PhaseTypeEntry[] = BUILTIN_PHASE_TYPES): PhaseTypeEntry[] | null {
  if (PRESET_FORM.test(raw)) return expandPhases(raw)
  const ids = raw.split(",").map((id) => id.trim())
  if (!ids.length || ids.some((id) => !id)) return null
  const entries: PhaseTypeEntry[] = []
  for (const id of ids) {
    const entry = phaseType(id, types)
    if (!entry) return null
    entries.push(entry)
  }
  return entries.some((entry) => entry.type === REQUIRED_TYPE) ? entries : null
}

// Why a phases value is invalid, for usage errors (resolvePhases returned null).
export function phasesProblem(raw: string, types: readonly PhaseTypeEntry[] = BUILTIN_PHASE_TYPES): string {
  const known = types.map((entry) => entry.type).join(", ")
  if (PRESET_FORM.test(raw)) return `a letter preset must be a subsequence of admtvk containing m (e.g. m, amt, admtvk); got "${raw}"`
  const unknown = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id && !phaseType(id, types))
  if (unknown.length) return `unknown phase type(s) ${unknown.join(", ")} (known: ${known})`
  if (raw.split(",").some((id) => !id.trim())) return `a phase type list is comma-separated type ids without empty items; got "${raw}"`
  return `a phase type list must contain ${REQUIRED_TYPE}; got "${raw}"`
}

// Shared-partial section holding this type's phase-plan duty paragraph.
export function planDutiesPartial(entry: PhaseTypeEntry): string {
  return `plan-duties-${entry.dutiesRef}`
}

// The --test-by-driver channel's derived scope (plans/0083 D9): the protocol
// runs only in code-producing phases. An absent entry is the no-phase mode's
// single implement phase by definition ("m" is implement), and the required
// builtin type of every phased flow carries the flag — so the answer stays
// `true` for every phase-less render, exactly the pre-0083 behavior of the
// raw flag. Gates that read it: the test-protocol render (prompt.ts baseCtx),
// runExecSession, the engine's test concern and the capability clamp — all
// derive from this one function, never from the config keys.
export function codeWork(entry: { codeWork?: boolean } | undefined): boolean {
  return (entry ?? phaseType(REQUIRED_TYPE))!.codeWork === true
}

// Whether a phases value includes at least one code-producing type (the
// run-level fact the capability clamp threads, plans/0083 D9): the run start
// knows the phases value, not the per-task phase, and a run without any
// code-producing phase never runs the test channel — so its steer-capability
// error is moot. types is the resolved entry list (resolvePhases's output);
// an unresolvable value (null — a usage error elsewhere) conservatively
// counts as code work so the clamp never goes quiet on a broken config.
export function anyCodeWork(entries: readonly PhaseTypeEntry[] | null): boolean {
  return entries === null || entries.some((entry) => codeWork(entry))
}

// Resolve unit-relative artifact specs against a unit directory (repository-
// relative, e.g. docs/R-01/P02-design or docs/T-014). Returns fresh objects.
export function unitArtifactSpecs(specs: readonly ArtifactSpec[], unitDir: string): ArtifactSpec[] {
  return specs.map((spec) => ({ ...spec, path: `${unitDir}/${spec.path}` }))
}
