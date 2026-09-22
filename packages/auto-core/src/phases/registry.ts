// Phase-type registry (M3.2, plans/0047 §5): the phases domain's entry module.
// A phase *type* is a registry entry, not a hard-coded letter. The six builtin
// types keep their admtvk letters only as `--phases` presets: `adm` expands to
// analysis, design, implement. Everything that used to be a per-letter literal
// table (names, directory slugs, decompose template, plan duties, the k-phase
// special case) reads from here.
//
// Until the phase-directory layout lands (M3.3) the runtime still identifies a
// phase by its letter: the ledger, archive paths and model-routing keys are
// letter-keyed, so `letter` and `slug` stay load-bearing for now. The artifact
// lists and the gate are declared here but have no reader before M3.3/M3.4.
import type { ArtifactSpec } from "../document/types"

// The preset letters in canonical order. The order is semantic: a preset
// string must be a subsequence of it (see expandPhases).
export const PHASE_LETTERS = ["a", "d", "m", "t", "v", "k"] as const
export type PhaseLetter = (typeof PHASE_LETTERS)[number]

export type PhaseGate = "none" | "verdict"

export type PhaseTypeEntry = {
  // Type id: the `<type>` of a phase directory `P<nn>-<type>` (M3.3).
  type: string
  // Preset letter for `--phases` (builtin types only; custom types, M3.6,
  // have none).
  letter?: PhaseLetter
  // Directory slug of the letter layout (`<letter>-<slug>/`, handovers,
  // phase-docs). Differs from `type` for m (migrate) and t (testing); retired
  // with the letter layout (M3.3/M3.7).
  slug: string
  // Human-readable name: logs, commit subjects, the `phaseName` prompt var.
  // Chinese until the M3.8 translation batch.
  name: string
  // Key of this type's duty text: the `### <key>` subsection under an intent
  // pack's `## phase duties` (decompose), and the `plan-duties-<key>` shared
  // partial (phase-plan). Builtins use their letter, so existing packs and
  // overlays keep resolving.
  dutiesRef: string
  // Prompt template of this type's decompose session.
  decomposeTemplate: string
  // Standard artifacts, paths relative to the unit directory (the phase dir
  // resp. the task dir); resolve with unitArtifactSpecs.
  phaseArtifacts: ArtifactSpec[]
  taskArtifacts: ArtifactSpec[]
  // false = the phase runs one direct driver session instead of planning and
  // executing tasks (knowledge).
  hasTasks: boolean
  // verdict = the phase's verdict.md `Result: FAIL` stops the round (M3.3).
  gate: PhaseGate
}

const artifact = (path: string, label: string): ArtifactSpec => ({ path, label, role: "artifact" })

export const BUILTIN_PHASE_TYPES: readonly PhaseTypeEntry[] = [
  {
    type: "analysis",
    letter: "a",
    slug: "analysis",
    name: "分析",
    dutiesRef: "a",
    decomposeTemplate: "decompose-a",
    phaseArtifacts: [artifact("findings.md", "analysis findings")],
    taskArtifacts: [artifact("analysis.md", "task analysis")],
    hasTasks: true,
    gate: "none",
  },
  {
    type: "design",
    letter: "d",
    slug: "design",
    name: "设计",
    dutiesRef: "d",
    decomposeTemplate: "decompose-d",
    phaseArtifacts: [artifact("design.md", "phase design"), artifact("decisions.md", "design decisions")],
    taskArtifacts: [artifact("design.md", "task design")],
    hasTasks: true,
    gate: "none",
  },
  {
    type: "implement",
    letter: "m",
    slug: "migrate",
    name: "迁移实现",
    dutiesRef: "m",
    decomposeTemplate: "decompose-m",
    phaseArtifacts: [],
    taskArtifacts: [],
    hasTasks: true,
    gate: "none",
  },
  {
    type: "test",
    letter: "t",
    slug: "testing",
    name: "测试",
    dutiesRef: "t",
    decomposeTemplate: "decompose-t",
    phaseArtifacts: [artifact("test-report.md", "test report")],
    taskArtifacts: [artifact("test-log.md", "test log")],
    hasTasks: true,
    gate: "none",
  },
  {
    type: "acceptance",
    letter: "v",
    slug: "acceptance",
    name: "验收",
    dutiesRef: "v",
    decomposeTemplate: "decompose-v",
    phaseArtifacts: [artifact("verdict.md", "acceptance verdict")],
    taskArtifacts: [artifact("verification.md", "task verification")],
    hasTasks: true,
    gate: "verdict",
  },
  {
    type: "knowledge",
    letter: "k",
    slug: "knowledge",
    name: "知识提炼",
    dutiesRef: "k",
    decomposeTemplate: "decompose-k",
    phaseArtifacts: [artifact("kb.md", "knowledge base")],
    taskArtifacts: [],
    hasTasks: false,
    gate: "none",
  },
]

// The type every preset must contain: a phased flow without implementation is
// meaningless, and "m" alone is the no-phase single run.
const REQUIRED_TYPE = "implement"

export function isPhaseLetter(value: string): value is PhaseLetter {
  return (PHASE_LETTERS as readonly string[]).includes(value)
}

export function phaseType(type: string): PhaseTypeEntry | undefined {
  return BUILTIN_PHASE_TYPES.find((entry) => entry.type === type)
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

// Shared-partial section holding this type's phase-plan duty paragraph.
export function planDutiesPartial(entry: PhaseTypeEntry): string {
  return `plan-duties-${entry.dutiesRef}`
}

// Resolve unit-relative artifact specs against a unit directory (repository-
// relative, e.g. docs/R-01/P02-design or docs/T-014). Returns fresh objects.
export function unitArtifactSpecs(specs: readonly ArtifactSpec[], unitDir: string): ArtifactSpec[] {
  return specs.map((spec) => ({ ...spec, path: `${unitDir}/${spec.path}` }))
}
