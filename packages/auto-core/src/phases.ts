// Phase state machine (--phases flow) over the phase directory layout (M3.3,
// plans/0047 §3–§4; design lineage plans/0006-phases-design.md). A round
// docs/R-NN/ holds a phase index phases.md (order and membership only, one line
// `- [ ] P01 analysis` per phase) and one directory per phase, P<nn>-<type>/,
// whose todo.md → done.md rename is the phase's completion (U2). Phase state is
// derived: the current phase is the first index entry not done whose
// prerequisites are done (nextReady; serial by default). There is no hidden
// state, so an interrupted run simply re-evaluates. The index replaces the old
// ledger and its `- [done] <letter> …` line protocol, which is retired.
//
// Phase *types* (name, duties, standard artifacts, gate) live in the registry
// src/phases/registry.ts. Until custom types arrive (M3.6) every phase is a
// builtin type with a preset letter, and the letter stays the runtime key of
// model routing, stats buckets and step resume points — so a type occurs at
// most once per round for now.
//
// Rounds: one docs/R-NN/ per round, created at round start (establishRound);
// everything written inside is permanent. Until task units land (M3.4) the root
// PLAN.md is still a symlink to the round's PLAN.md, and a phase handover keeps
// a PLAN.md snapshot in the phase directory as the phase's task record.
import { lstat, mkdir, readdir, rm, stat, symlink } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PHASE_ACCEPTANCE_NAME, roundDir, roundDirName } from "./docpaths"
import { nextReady, parseIndex, parsePhaseDir, renameUnitDone, scanUnitStates, UNIT_PENDING, unitDir, type UnitRef } from "./document/unit"
import type { Plan } from "./plan"
import { renderText } from "./template"
import {
  BUILTIN_PHASE_TYPES,
  PHASE_LETTERS,
  expandPhases,
  phaseType,
  phaseTypeOfLetter,
  unitArtifactSpecs,
  type PhaseLetter,
  type PhaseTypeEntry,
} from "./phases/registry"
import templateScaffold from "../templates/PLAN.scaffold.md" with { type: "file" }

export type Phase = PhaseLetter

// The only legal preset order (registry letter order); validation and derivation share it.
export const PHASE_ORDER = PHASE_LETTERS.join("")

export function phaseText(phase: Phase): string {
  return phaseTypeOfLetter(phase).name
}

// Validate a phases value by registry preset expansion (expandPhases):
// non-empty, preset letters only, strictly increasing in preset order, and
// containing implement (m). null = invalid (the CLI turns it into exit 1).
export function parsePhases(raw: string): Phase[] | null {
  return expandPhases(raw)?.map((entry) => entry.letter!) ?? null
}

// —— Phase units ——

// One phase of a round: its unit identity (round + local id + type → the
// directory docs/R-NN/P<nn>-<type>) plus the preset letter of its type.
export type PhaseUnit = {
  round: string
  id: string
  type: string
  letter: Phase
  dir: string
}

export function phaseRef(unit: PhaseUnit): UnitRef {
  return { level: "phase", id: unit.id, round: unit.round, type: unit.type }
}

// Display label and directory name: P02-design.
export function phaseLabel(unit: PhaseUnit): string {
  return `${unit.id}-${unit.type}`
}

function makeUnit(round: string, id: string, entry: PhaseTypeEntry): PhaseUnit {
  const unit = { round, id, type: entry.type, letter: entry.letter!, dir: "" }
  unit.dir = unitDir(phaseRef(unit))
  return unit
}

const phaseId = (position: number) => `P${String(position).padStart(2, "0")}`

// Paths inside a phase directory (repository-relative, permanent once written).
export const phaseHandoverDoc = (unit: PhaseUnit): string => join(unit.dir, "handover.md")
// The human's acceptance record (phaseAcceptance role, M2.3); no reader until
// the acceptance gate (0036 D8), which also owns the marker literal.
export const phaseAcceptanceDoc = (unit: PhaseUnit): string => join(unit.dir, PHASE_ACCEPTANCE_NAME)
// Snapshot of the phase's PLAN.md, written at handover. Interim: PLAN.md is
// still the task carrier until M3.4 replaces it with the phase's tasks.md.
export const phaseArchivedPlan = (unit: PhaseUnit): string => join(unit.dir, "PLAN.md")
// The phase type's standard artifacts resolved into this phase's directory.
export const phaseArtifacts = (unit: PhaseUnit) => unitArtifactSpecs(phaseTypeOfLetter(unit.letter).phaseArtifacts, unit.dir)

// —— Phase index (docs/R-NN/phases.md) ——

export const PHASE_INDEX_NAME = "phases.md"

export function phaseIndexPath(round: number): string {
  return join(roundDir(round), PHASE_INDEX_NAME)
}

const INDEX_NOTE =
  "Phase index (opencode-auto): order and membership only. A phase is complete when its directory holds done.md; the driver ticks the line when it renames todo.md."

export function renderPhaseIndex(round: string, units: readonly PhaseUnit[], done: ReadonlySet<string> = new Set()): string {
  const lines = units.map((unit) => `- [${done.has(unit.id) ? "x" : " "}] ${unit.id} ${unit.type}`)
  return [`# Phases (${round})`, "", INDEX_NOTE, "", ...lines, ""].join("\n")
}

// A phase's todo.md as written at round start: the qualified id and display
// name as the title, the field block (Type), the eof terminator.
export function renderPhaseTodo(unit: PhaseUnit): string {
  return [`# ${unit.round}.${unit.id}: ${phaseText(unit.letter)}`, "", `Type: ${unit.type}`, "", "<!-- auto: eof -->", ""].join("\n")
}

export type PhaseState = {
  round: number
  index: string
  phases: PhaseUnit[]
  // Ids whose done.md exists.
  done: Set<string>
}

// Read a round's phase index and the state files of its phases (round defaults
// to the current round). undefined = no index (the round was never
// established). Throws with fix-it guidance when the index is unusable: a
// problem line, an unknown type, a type listed twice, or a phase directory with
// both or neither of todo.md / done.md.
export async function readPhases(dir: string, round?: number): Promise<PhaseState | undefined> {
  const n = round ?? (await currentRound(dir))
  const index = phaseIndexPath(n)
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return undefined
  const parsed = parseIndex(text, "phase")
  const problems = [...parsed.problems]
  const phases: PhaseUnit[] = []
  const seen = new Set<string>()
  for (const entry of parsed.entries) {
    const type = entry.title.split(/\s+/)[0] ?? ""
    const found = phaseType(type)
    if (!found?.letter) {
      problems.push(`${entry.id}: unknown phase type "${type}" (known: ${BUILTIN_PHASE_TYPES.map((item) => item.type).join(", ")})`)
      continue
    }
    if (seen.has(type)) {
      problems.push(`${entry.id}: phase type ${type} is listed twice (a repeated type needs custom phase types, not supported yet)`)
      continue
    }
    seen.add(type)
    phases.push(makeUnit(roundDirName(n), entry.id, found))
  }
  if (!phases.length && !problems.length) problems.push("no phases listed")
  const scan = await scanUnitStates(dir, phases.map(phaseRef))
  for (const bad of scan.illegal) {
    const unit = phases.find((item) => item.id === bad.id)!
    problems.push(`${unit.dir}/ has ${bad.kind === "both" ? "both todo.md and done.md" : "neither todo.md nor done.md"}`)
  }
  if (problems.length) {
    throw new Error(
      `phase index ${index} is invalid: ${problems.join("; ")}. ` +
        "Index lines are `- [ ] P<nn> <type>`, each with a directory P<nn>-<type>/ holding exactly one of todo.md / done.md; fix it manually and re-run",
    )
  }
  return { round: n, index, phases, done: scan.done }
}

// The phase to work on: the first ready one (nextReady over the index with its
// default serial dependencies). undefined = every phase is done.
export function currentPhase(state: Pick<PhaseState, "phases" | "done">): PhaseUnit | undefined {
  const id = nextReady(state.phases.map((unit) => ({ id: unit.id })), state.done)
  return state.phases.find((unit) => unit.id === id)
}

// Letters of the completed phases in index order (the shells' continue
// precheck and prefix guard compare it against letter presets).
export function doneLetters(state: Pick<PhaseState, "phases" | "done">): string {
  return state.phases
    .filter((unit) => state.done.has(unit.id))
    .map((unit) => unit.letter)
    .join("")
}

// Write or update a round's phase index from a phases preset: the index plus a
// directory with todo.md per phase. Idempotent. On an existing index the
// matching prefix (same position, same type) is kept; the rest is replaced,
// which is allowed only for phases that are not done and whose directory holds
// nothing but todo.md — anything else throws before a file is touched.
export async function syncPhaseIndex(dir: string, round: number, phases: string): Promise<PhaseUnit[]> {
  const desired = expandPhases(phases)
  if (!desired) throw new Error(`invalid phases value "${phases}"`)
  const name = roundDirName(round)
  const units = desired.map((entry, i) => makeUnit(name, phaseId(i + 1), entry))
  const existing = await readPhases(dir, round)
  let keep = 0
  if (existing) {
    while (keep < existing.phases.length && keep < units.length && existing.phases[keep]!.dir === units[keep]!.dir) keep++
    for (const stale of existing.phases.slice(keep)) {
      if (existing.done.has(stale.id)) throw new Error(`phases "${phases}" would drop the completed phase ${stale.dir}/ from ${existing.index}`)
      const held = (await readdir(join(dir, stale.dir)).catch(() => [] as string[])).filter((file) => file !== UNIT_PENDING)
      if (held.length) {
        throw new Error(`phases "${phases}" would drop ${stale.dir}/ from ${existing.index}, but it already holds work (${held.join(", ")}); move it away manually first`)
      }
    }
    if (keep === existing.phases.length && keep === units.length) return existing.phases
    for (const stale of existing.phases.slice(keep)) await rm(join(dir, stale.dir), { recursive: true, force: true })
  }
  for (const unit of units.slice(keep)) {
    await mkdir(join(dir, unit.dir), { recursive: true })
    const todo = join(dir, unit.dir, UNIT_PENDING)
    if (!(await Bun.file(todo).exists())) await Bun.write(todo, renderPhaseTodo(unit))
  }
  await Bun.write(join(dir, phaseIndexPath(round)), renderPhaseIndex(name, units, existing?.done))
  return units
}

// Record a phase as complete: rename its todo.md to done.md and tick its index
// line (U2/U3). This is the single choke point for phase completion — the
// handover path and its interruption recovery both go through it — so a future
// precondition (the 0036 D8 acceptance gate) belongs inside it, where neither
// path can bypass it. Idempotent.
export async function completePhase(dir: string, unit: PhaseUnit): Promise<void> {
  await renameUnitDone(dir, phaseRef(unit))
  const index = join(dir, "docs", unit.round, PHASE_INDEX_NAME)
  const text = await Bun.file(index).text().catch(() => undefined)
  if (text === undefined) return
  const line = new RegExp(`^([-*] \\[) (\\]\\s+${unit.id}(?::|\\s|$))`, "m")
  if (line.test(text)) await Bun.write(index, text.replace(line, "$1x$2"))
}

// Phase routing (D.2): blocked = an environment error such as an invalid or
// missing index (the CLI turns it into exit 1 with fix-it guidance).
export type PhaseRoute =
  | { type: "complete" } // every phase done
  | { type: "plan"; phase: PhaseUnit } // PLAN.md empty (scaffold / reset) → planning session
  | { type: "execute"; phase: PhaseUnit } // tasks left to run
  | { type: "handover"; phase: PhaseUnit } // all of this phase's tasks done → handover
  | { type: "blocked"; reason: string }

export async function routePhase(dir: string, plan: Plan): Promise<PhaseRoute> {
  let state: PhaseState | undefined
  try {
    state = await readPhases(dir)
  } catch (error) {
    return { type: "blocked", reason: error instanceof Error ? error.message : String(error) }
  }
  if (!state) {
    return {
      type: "blocked",
      reason: `phase index ${phaseIndexPath(await currentRound(dir))} is missing; establish the round with opencode-auto init (or continue) first`,
    }
  }
  const phase = currentPhase(state)
  if (!phase) return { type: "complete" }
  if (plan.tasks.some((task) => task.status !== "done")) return { type: "execute", phase }
  if (plan.tasks.length) return { type: "handover", phase }
  return { type: "plan", phase }
}

// Phase progress line (run banner and status): ✓ = done, ▶ = current.
export function formatPhases(state: Pick<PhaseState, "phases" | "done">): string {
  const current = currentPhase(state)
  return state.phases
    .map((unit) => `${phaseLabel(unit)}${state.done.has(unit.id) ? "✓" : unit === current ? "▶" : ""}`)
    .join(" ")
}

// Empty phase template (PLAN.scaffold.md): PLAN.md's initial and post-handover
// state under the phased flow — no tasks, so routePhase derives the plan route
// (D.2). init also uses it as the PLAN.md template when phases ≠ "m" (B.1).
export function renderPlanScaffold(): string {
  return renderText(readFileSync(templateScaffold, "utf8"), {})
}

// —— Rounds (plans/0006-phases-design.md §M; round-directory plan) ——

// Pre-round-directory archive name (docs/phases/round-<N>/), still counted for
// round numbering until the legacy removal (M3.7).
const LEGACY_ROUND_RE = /^round-(\d+)$/

// Round directory name docs/R-NN/: two-digit zero padding, natural carry;
// created at round start.
const ROUND_DIR_RE = /^R-(\d+)$/

// Current round (derived, no persisted state): round directories are created
// at round start, so with any R-NN present the current round is the highest
// (no +1); without one, the legacy count (docs/phases/round-<N> max + 1)
// applies — a brand-new project is round 1.
export async function currentRound(dir: string): Promise<number> {
  const entries = await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])
  let modern = 0
  for (const entry of entries) {
    const round = ROUND_DIR_RE.exec(entry.name)
    if (round) modern = Math.max(modern, Number(round[1]))
  }
  if (modern > 0) return modern
  const legacy = await readdir(join(dir, "docs", "phases"), { withFileTypes: true }).catch(() => [])
  let max = 0
  for (const entry of legacy) {
    const round = LEGACY_ROUND_RE.exec(entry.name)
    if (round) max = Math.max(max, Number(round[1]))
  }
  return max + 1
}

// Number of a new round (for round start): the current round + 1 when it is
// taken (its R-NN directory exists, or a legacy root ledger is present),
// otherwise the current derived value (a new project = 1).
export async function nextRound(dir: string): Promise<number> {
  const round = await currentRound(dir)
  if (await roundRoot(dir, round)) return round + 1
  const occupied = await Bun.file(join(dir, "docs", "phases.md")).exists()
  return occupied ? round + 1 : round
}

// A round's directory (repository-relative) when it exists.
export async function roundRoot(dir: string, round: number): Promise<string | undefined> {
  const root = roundDir(round)
  return (await stat(join(dir, root)).then((s) => s.isDirectory(), () => false)) ? root : undefined
}

// Round start (docs/R-NN, created at round start; everything inside is
// permanent — never renamed, moved or deleted):
// ① create the round directory (existing = idempotent resume, contents kept);
// ② the phase index and phase directories from `phases` (syncPhaseIndex);
// ③ the round's PLAN.md initial value = opts.plan ?? the root PLAN.md's content
//    (a regular file — the m → phased switch copies it) ?? the empty scaffold;
// ④ the root PLAN.md re-created as a relative symlink to the round's PLAN.md
//    (one source of truth; sessions and protect keep addressing "PLAN.md"; a
//    failed symlink falls back to a copy, reported as linked = false);
// ⑤ a snapshot of the root AGENTS.md as AGENTS.md.bak (the suffix keeps it from
//    loading as instructions; written once).
// Not called for phases = "m" (no rounds; the root PLAN.md stays a regular file).
// The round defaults to currentRound (init / first run); a new round passes nextRound.
export async function establishRound(
  dir: string,
  opts: { phases: string; round?: number; plan?: string },
): Promise<{ round: number; root: string; linked: boolean }> {
  const round = opts.round ?? (await currentRound(dir))
  const root = roundDir(round)
  await mkdir(join(dir, root), { recursive: true })
  await syncPhaseIndex(dir, round, opts.phases)
  const planFile = join(root, "PLAN.md")
  if (!(await Bun.file(join(dir, planFile)).exists())) {
    const rootPlan = join(dir, "PLAN.md")
    // A root PLAN.md that is a symlink into some round is that round's plan, not an initial value.
    const isLink = await lstat(rootPlan).then((s) => s.isSymbolicLink(), () => false)
    const existing = isLink ? undefined : await Bun.file(rootPlan).text().catch(() => undefined)
    await Bun.write(join(dir, planFile), opts.plan ?? existing ?? renderPlanScaffold())
  }
  // Re-create the root link; the target content is the round's PLAN.md (idempotent).
  const content = await Bun.file(join(dir, planFile)).text()
  await rm(join(dir, "PLAN.md"), { force: true })
  let linked = true
  try {
    await symlink(planFile, join(dir, "PLAN.md"))
  } catch {
    linked = false
    await Bun.write(join(dir, "PLAN.md"), content)
  }
  const agentsFile = join(root, "AGENTS.md.bak")
  if (!(await Bun.file(join(dir, agentsFile)).exists())) {
    const agents = await Bun.file(join(dir, "AGENTS.md")).text().catch(() => undefined)
    if (agents !== undefined) await Bun.write(join(dir, agentsFile), agents)
  }
  return { round, root, linked }
}

// Knowledge documents of a round: the standard artifacts of its knowledge
// phase directories (P<nn>-knowledge/kb.md), repository-relative.
export async function roundKnowledgeDocs(dir: string, round: number): Promise<string[]> {
  const root = roundDir(round)
  const knowledge = phaseType("knowledge")!
  const names = (await readdir(join(dir, root), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && parsePhaseDir(entry.name)?.type === knowledge.type)
    .map((entry) => entry.name)
    .sort()
  return names.flatMap((name) => unitArtifactSpecs(knowledge.phaseArtifacts, join(root, name)).map((spec) => spec.path))
}

// Previous round's conclusions (injected into the new round's first phase
// planning session): ① an index of its phase directories; ② the full handover
// of its last completed phase; ③ its knowledge documents in full. Only
// distilled documents are injected; the session can open anything else from
// the index. No previous round directory, or nothing in it → undefined.
// Lenient: an unusable index only drops ②, since a digest is prompt input and
// strict failure belongs to the loop's own readPhases.
export async function prevRoundDigest(dir: string): Promise<string | undefined> {
  const prev = (await currentRound(dir)) - 1
  if (prev < 1) return undefined
  const root = await roundRoot(dir, prev)
  if (!root) return undefined
  const dirs = (await readdir(join(dir, root), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && parsePhaseDir(entry.name))
    .map((entry) => entry.name)
    .sort()
  const state = await readPhases(dir, prev).catch(() => undefined)
  const last = state?.phases.filter((unit) => state.done.has(unit.id)).at(-1)
  const handover = last ? phaseHandoverDoc(last) : undefined
  const handoverText = handover ? await Bun.file(join(dir, handover)).text().catch(() => undefined) : undefined
  const knowledge: Array<{ file: string; text: string }> = []
  for (const file of await roundKnowledgeDocs(dir, prev)) {
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    if (text.trim()) knowledge.push({ file, text })
  }
  if (!dirs.length && !handoverText?.trim() && !knowledge.length) return undefined
  const parts = [`### 上一轮(第 ${prev} 轮)阶段目录索引(${root}/)\n`]
  parts.push(dirs.map((name) => `- ${root}/${name}/`).join("\n"))
  if (handover && handoverText?.trim()) {
    parts.push(`\n### 上一轮最终交接(${handover})\n`)
    parts.push(handoverText.trim())
  }
  for (const doc of knowledge) {
    parts.push(`\n### 上一轮迁移知识(${doc.file})\n`)
    parts.push(doc.text.trim())
  }
  return parts.join("\n")
}
