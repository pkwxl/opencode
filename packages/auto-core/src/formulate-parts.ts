// The phased formulation's composition state (plans/0097 D3's gathering,
// split out of src/loop-plan.ts by plans/0235 so that module keeps its
// under-600 promise): the earlier phases' distilled handovers (shared by the
// planning and appending prompts, so both sessions see the same chain), the
// first-planning-session digest block (the booking half, read once), the
// remediable sources re-read before every compose pass
// (readFormulationSources — plans/0208 D2's split of 0156 D4's captured
// set), the floor's block map, and the verify-time preview document.
// Direction: loop-plan/loop-append → formulate-parts → the provider
// domains; never imports the loops.
import { join } from "node:path"
import { analysisText } from "./analysis"
import type { BlockMapEntry } from "./blockage"
import { BRIEF_FILE } from "./brief"
import { ANALYSIS_DOC, roundBriefPath } from "./docpaths"
import { digestIndexEntries, priorKnowledgeDigest, renderDigestIndex } from "./knowledge"
import { formatTokens, log } from "./log"
import type { LoopCtx } from "./loop-task"
import { DEFAULT_CONTEXT_LIMIT } from "./opts"
import { planInputPath } from "./plan-input"
import { phaseHandoverDoc, phaseState, phaseTitle, prevRoundDigest, type PhaseState, type PhaseUnit } from "./phases"
import { roundBriefText } from "./round-brief"
import { statsDigest } from "./stats"
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

// The phased formulation's composition state (the former phasePlanPrompt's
// gathering, plans/0095 D1; split from the render by plans/0097 D3 so the
// synthesis pipeline reads the same parts as the floor): the earlier phases'
// handovers (the joined text for the floor, per document for the synthesis
// source list), the first-planning-session prior-round digest, the round
// brief, the approved analysis (human-gated phases), the final-phase report
// duty and the pipeline-trimming note. The per-source health findings (the
// missing handover documents, the expected-but-absent digest) ride along —
// the crux's "never silence" rule. Two halves (plans/0208 D2): the sources
// readFormulationSources derives (handovers, round, analysis — remediable
// process documents) re-read before every compose pass; the booking half
// (the digest block below) and the driver-exclusive state read once.
export type FormulationParts = {
  state: PhaseState
  handovers: string
  handoverDocs: { path: string; text: string }[]
  missingHandovers: string[]
  prevRound: string | undefined
  prevRoundExpected: boolean
  round: string | undefined
  analysis: string | undefined
  trimmedPhases: boolean
}

// The side-effect-free sources of the composition state (plans/0208 D2): the
// documents the remediation executor's channel table passes — the handovers,
// the round brief, the analysis — read over the phase state (itself
// driver-exclusive, never remediated, so the captured state serves every
// pass). One derivation home: the entry read and every freshen pass compose
// through it, so a remediated source reaches the next compose pass, never a
// stale capture (0156 D4's contract, held for the whole remediable set).
export async function readFormulationSources(
  directory: string,
  phase: PhaseUnit,
  state: PhaseState,
): Promise<Pick<FormulationParts, "handovers" | "handoverDocs" | "missingHandovers" | "round" | "analysis">> {
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

export async function formulationParts(ctx: LoopCtx, phase: PhaseUnit): Promise<FormulationParts> {
  const { directory, opts } = ctx
  const state = await phaseState(directory)
  const sources = await readFormulationSources(directory, phase, state)
  // Extra injection for the round's first planning session: ① prior knowledge
  // (the shell's startup distillation of existing migration results,
  // docs/R-NN/prior-kb.md, see src/knowledge.ts); ② the previous round's
  // conclusions (when a previous round directory exists). Later phases follow
  // the handover chain and get neither again.
  // "First" = no completed phase of this round has tasks (plans/0049 G4): a
  // leading task-less knowledge phase has no planning session and must not
  // swallow the digest.
  // The digest cap: above a quarter of the run's context limit (estimated by
  // the same token estimate the usage source uses), the prompt gets the index
  // form instead of the full texts — the path and size of each knowledge
  // document and handover, the session opening what it needs. The sizes are
  // booked per planning session either way, so the memory-service question
  // has its data.
  let prevRound: string | undefined
  let prevRoundExpected = false
  if (!state.phases.some((unit) => state.done.has(unit.id) && unit.entry.hasTasks)) {
    const prior = (await priorKnowledgeDigest(directory))?.trim() || undefined
    const prev = (await prevRoundDigest(directory))?.trim() || undefined
    prevRoundExpected = state.round > 1 && prev === undefined
    const segments = [prior, prev].filter((part): part is string => part !== undefined)
    const joined = segments.length ? segments.join("\n\n") : undefined
    const cap = (opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT) / 4
    const total = joined === undefined ? 0 : estimateTokens(joined)
    const capped = joined !== undefined && total > cap
    prevRound = capped ? renderDigestIndex(await digestIndexEntries(directory), { total, cap }) : joined
    if (prevRound) {
      log(
        capped
          ? `ℹ prior migration conclusions exceed the digest cap (${formatTokens(total)} tokens > ${formatTokens(cap)}); injecting the index form instead — the session opens what it needs`
          : "ℹ injecting prior migration conclusions (prior knowledge + previous round's archive excerpts)",
      )
    }
    await statsDigest(directory, {
      priorKnowledge: prior === undefined ? undefined : estimateTokens(prior),
      prevRound: prev === undefined ? undefined : estimateTokens(prev),
      capped,
    })
  }
  // The round brief and the analysis ride `sources` (readFormulationSources
  // above — the fresh half); the digest block stays here, the booking half.
  return {
    state,
    ...sources,
    prevRound,
    prevRoundExpected,
    // No analysis/design phase delivered in this round's index → the
    // implement phase's planning gets the pipeline-trimming note. A closed
    // analysis/design phase (plans/0053 D16: done for scheduling, not
    // delivered) counts as absent.
    trimmedPhases: !state.phases.some((unit) => (unit.type === "analysis" || unit.type === "design") && !state.closed.has(unit.id)),
  }
}

// The floor's block map (plans/0082 §2 D1): each block of the assembled todo
// and its source path, from the composition state itself — never a guess
// read back out of the rendered text. The synthesized shape prepends its own
// blocks ahead of these.
export function floorBlocks(phase: PhaseUnit, input: string | undefined, brief: string | undefined, taskIndex: string, parts: FormulationParts | undefined): BlockMapEntry[] {
  const manual = parts === undefined
  return [
    { block: "formulation todo", source: "the deterministic assembly (plans/0095)" },
    ...(manual ? [] : [{ block: "phase duties", source: "the active pack's phase-duties section" }]),
    { block: "brief", source: brief ? BRIEF_FILE : `${BRIEF_FILE} (absent)` },
    ...(manual
      ? []
      : [
          { block: "round brief", source: roundBriefPath(parts!.state.round) },
          ...(parts!.analysis !== undefined ? [{ block: "analysis", source: ANALYSIS_DOC }] : []),
          ...parts!.handoverDocs.map((doc) => ({ block: "handover", source: doc.path })),
          ...(parts!.prevRound !== undefined ? [{ block: "previous round digest", source: "the prior-knowledge and previous-round documents" }] : []),
        ]),
    { block: "planning input", source: input ? planInputPath(phase) : `${planInputPath(phase)} (absent)` },
    { block: "task index", source: taskIndex },
    { block: "mode notes", source: "the active mode file" },
  ]
}

// The earlier phases' distilled handovers in index order, one block per done
// phase that precedes `phase` (the injection discipline: only distilled
// handovers, never the earlier phases' raw docs/). Shared by the planning and
// appending prompts, so both sessions see the same chain.
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
