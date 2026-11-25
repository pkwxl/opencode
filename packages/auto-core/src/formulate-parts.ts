// The formulation's source assembly (plans/0097 D3's gathering, split out of
// the former loop-plan module by plans/0235; the push compose's booking half
// retired with that module, plans/0314): the remediable sources re-read
// before every derivation (readFormulationSources — plans/0208 D2's split of
// 0156 D4's captured set), the prior-round digest block's pure computation,
// and the floor preview document.
// Direction: the executor steps (src/executor-steps.ts) → formulate-parts →
// the provider domains; never imports a session-driving module.
import { join } from "node:path"
import { analysisText } from "./analysis"
import { digestIndexEntries, priorKnowledgeDigest, renderDigestIndex } from "./knowledge"
import { phaseHandoverDoc, phaseTitle, prevRoundDigest, type PhaseState, type PhaseUnit } from "./phases"
import { roundBriefText } from "./round-brief"
import { renderTaskTodo } from "./tasks"
import { estimateTokens } from "./usage"

// The verify-time preview of the formulation document (plans/0095 D4): the
// exact todo construction writes, with the placeholder id the number
// allocation fills at landing — the charter-judging content is identical.
// The prefix field (plans/0205 D2) renders here too, so the digest covers
// the rows the todo is composed beside and moves when they change; the
// Floor-Digest field deliberately does not (the digest of itself — the field
// records this digest beside the landed todo, construction's other half).
export function previewFormulationDocument(todo: { goal: string; scope: string; acceptance: string }, phaseId: string, prefix?: string[]): string {
  return renderTaskTodo({
    id: "T-NNN",
    title: "Formulate the phase tasks",
    phase: phaseId,
    formulate: phaseId,
    decompose: "whole",
    depends: "none",
    ...(prefix?.length ? { prefix } : {}),
    goal: todo.goal,
    scope: todo.scope,
    acceptance: todo.acceptance,
  })
}

// The earlier phases' distilled handovers (the joined text the prompt
// injects), the round brief and the approved analysis — the side-effect-free
// sources of the formulation's composition (plans/0095 D1's gathering,
// plans/0097 D3's split from the render). The per-source health findings (the
// missing handover documents) ride along — the crux's "never silence" rule.
type FormulationSources = {
  handovers: string
  handoverDocs: { path: string; text: string }[]
  missingHandovers: string[]
  round: string | undefined
  analysis: string | undefined
}

// The side-effect-free sources of the composition state (plans/0208 D2): the
// documents the remediation executor's channel table passes — the handovers,
// the round brief, the analysis — read over the phase state (itself
// driver-exclusive, never remediated, so the captured state serves every
// pass). One derivation home, so a remediated source reaches the next
// derivation, never a stale capture (0156 D4's contract, held for the whole
// remediable set).
export async function readFormulationSources(
  directory: string,
  phase: PhaseUnit,
  state: PhaseState,
): Promise<FormulationSources> {
  // Earlier phases' handovers (injection discipline): only the distilled
  // handovers are injected, never the earlier phases' raw docs/. Each done phase
  // that precedes this one in the phase index is appended in order; the handover
  // is the permanent P<nn>-<type>/handover.md in the phase directory, and a phase
  // without one is listed as "(no handover document)".
  const handovers = await earlierHandovers(directory, phase, state)
  const earlier = state.phases
    .slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
    .filter((unit) => state.done.has(unit.id))
  const handoverDocs: { path: string; text: string }[] = []
  const missingHandovers: string[] = []
  for (const unit of earlier) {
    const path = phaseHandoverDoc(unit)
    const text = await Bun.file(join(directory, path)).text().catch(() => undefined)
    if (text?.trim()) handoverDocs.push({ path, text })
    else missingHandovers.push(path)
  }
  // The round brief docs/R-NN/round.md (plans/0049 G3): every planning session
  // plans against the round's goal and criteria; an untouched stub injects nothing.
  const round = await roundBriefText(directory, state.round)
  // The approved project analysis (plans/0085 A1): the survey phase's
  // formulation — the one that raises decisions — reads the person's
  // settled decisions directly, so what the analysis settles is never
  // re-raised as a fork. Human-gated phases only.
  const analysis = phase.entry.gates.includes("human") ? await analysisText(directory) : undefined
  return { handovers, handoverDocs, missingHandovers, round, analysis }
}

// The prior-round digest block's pure computation (plans/0281's split of the
// 0097 D3 gathering): the digest cap logic above a quarter of the context
// limit (estimated by the same token estimate the usage source uses), the
// index form above it — one derivation home; the push compose loop that
// logged and booked the stats beside it retired with plans/0314, and the
// executor's synthesize derivation (readSynthesisAssembly) reads it
// read-only — a preview writes nothing, P6.
export type PriorRoundBlock = {
  prevRound: string | undefined
  prevRoundExpected: boolean
  capped: boolean
  total: number
  cap: number
}

export async function priorRoundBlock(directory: string, state: PhaseState, contextLimit: number): Promise<PriorRoundBlock> {
  let prevRound: string | undefined
  let prevRoundExpected = false
  let capped = false
  let total = 0
  let prior: string | undefined
  let prev: string | undefined
  const cap = contextLimit / 4
  if (!state.phases.some((unit) => state.done.has(unit.id) && unit.entry.hasTasks)) {
    prior = (await priorKnowledgeDigest(directory))?.trim() || undefined
    prev = (await prevRoundDigest(directory))?.trim() || undefined
    prevRoundExpected = state.round > 1 && prev === undefined
    const segments = [prior, prev].filter((part): part is string => part !== undefined)
    const joined = segments.length ? segments.join("\n\n") : undefined
    total = joined === undefined ? 0 : estimateTokens(joined)
    capped = joined !== undefined && total > cap
    prevRound = capped ? renderDigestIndex(await digestIndexEntries(directory), { total, cap }) : joined
  }
  return { prevRound, prevRoundExpected, capped, total, cap }
}

// The earlier phases' distilled handovers in index order, one block per done
// phase that precedes `phase` (the injection discipline: only distilled
// handovers, never the earlier phases' raw docs/). Read by the source
// assembly above — the push planning and appending prompts that shared it
// are retired (plans/0283, plans/0314).
export async function earlierHandovers(directory: string, phase: PhaseUnit, state: PhaseState): Promise<string> {
  const earlier = state.phases.slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
  return (
    await Promise.all(
      earlier
        .filter((unit) => state.done.has(unit.id))
        .map(async (unit) => {
          const doc = phaseHandoverDoc(unit)
          const text = await Bun.file(join(directory, doc)).text().catch(() => undefined)
          return [`### ${phaseTitle(unit)}(${doc})`, "", text?.trim() || "(no handover document)"].join("\n")
        }),
    )
  ).join("\n\n")
}
