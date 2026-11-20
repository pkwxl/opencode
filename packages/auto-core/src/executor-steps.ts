// Read-only executor previews (0246 D10 slice 1, 0249 D4). The coordinator
// must re-evaluate under its run lock before admitting work.
import { dirname, join } from "node:path"
import { roundDeltaBlock } from "./assurance"
import { projectBriefText } from "./brief"
import { CONFIG_FILE, loadProjectConfig, type ProjectConfig } from "./config"
import { closeAuditFindingsDoc } from "./close-audit"
import { ANALYSIS_DOC, roundBriefPath, taskDocPaths } from "./docpaths"
import { parseUnitDoc } from "./document/unit"
import { handoffStatus, validHandover } from "./document/roles"
import { parkReleaseNote } from "./execute"
import { awaitingFormulation, constructFormulation, formulationAcceptance, formulationNumber } from "./formulate"
import { priorRoundBlock, readFormulationSources } from "./formulate-parts"
import {
  checkSynthesisReply, floorDigest, ledgerOf, protocolFrameText, renderLedger, seededLedgerRows,
  synthesisSources, synthesizePromptText, type LedgerRow, type LedgerSource,
} from "./formulate-synthesis"
import { previewFormulationDocument } from "./formulate-parts"
import { repoRoots, statusEntriesRead, workdirEntry, workTree } from "./git"
import { resolvedVerifyPlan, verifyPlanCharterText, PromptGuaranteeError } from "./intent/guarantees"
import { loadModes, type ModeSpec } from "./mode"
import { DEFAULT_CONTEXT_LIMIT } from "./opts"
import { taskNumber, taskNumberFloor } from "./numbering"
import { currentPhase, phaseGateProblems, phaseGates, phaseHandoverDoc, phaseState, phaseSurveyDoc, phaseTitle, readPhases, type PhaseUnit } from "./phases"
import type { PhaseTypeEntry } from "./phases/registry"
import { planInputPath, readPlanInput } from "./plan-input"
import { existingTaskList, planDutyText, renderFormulationTodo } from "./prompt-plan"
import { renderFix, renderPhaseHandover, renderWhole, renderWrapup, type PromptFacts } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { peekProgress } from "./resume"
import { autoSwitches } from "./switches"
import { loadPlan, next, promptViews, readyTasks, strandedParks, taskIndexPath, taskStatePaths, type Plan } from "./tasks"

type BlockReason = "config" | "subtask" | "unreadable" | "cleanTree" | "mutualPark"
type Blocked = { kind: "blocked"; reason: BlockReason; detail: string }

export type ExecutorPreview =
  | Blocked
  | { kind: "human"; gate: "project-start" | "survey-release"; document: string; detail?: string }
  | { kind: "wait"; reason: "not-ready" | "in-flight"; detail: string }
  | { kind: "execute"; unit: string; title: string; touches?: readonly string[]; prompt: string }
  | { kind: "formulate"; unit: string; title: string; phase: string; index: string; prompt: string }
  | { kind: "synthesize"; unit: string; title: string; phase: string; index: string; prompt: string }
  | { kind: "distill"; unit: string; title: string; handover: string; prompt: string }
  | { kind: "audit"; unit: string; title: string; findings: string; round: number; prompt: string }
  | { kind: "phase-boundary"; phase: string; problems: readonly string[] }
  | { kind: "done" }

export type ExecutorSnapshot = {
  config: Pick<ProjectConfig, "subtask" | "testByDriver" | "handoverTest" | "acceptanceGate">
  tree: "clean" | "dirty" | "unreadable"
  activeProgress: boolean
  continuationUnit?: string
  continuationHandoff?: boolean
  route?: { task: string; scoped?: boolean; followUp?: true }
  round?: {
    complete: boolean
    open: boolean
    current?: {
      phase: PhaseUnit
      plan: Plan
      indexPresent: boolean
      surveyPresent: boolean
      gateProblems: readonly string[]
      facts: PromptFacts
      mode?: ModeSpec
      // 0277 (0256 stage 2's second convergence kind, the transfer advance's
      // session work): the boundary derivation's durable inputs — the phase
      // after the current one (the distillation brief's `next`) and whether
      // the phase's handover document already passes validHandover (the push
      // dispatch's idempotent skip predicate, read once here so the pure
      // derivation below never touches disk).
      following?: PhaseUnit
      handoverValid: boolean
    }
  }
  // 0281 (0279's first convergence beyond the docket's stage-2 kinds): the
  // construction's re-voicing — the synthesize grant's derivation inputs,
  // read once when the current phase's awaiting formulation stands over a
  // floor todo under a resolved charter with the switch not off (undefined
  // otherwise: the formulate step derives unchanged, the byte-identical
  // floor, P10). The settlement re-derives the same assembly from disk
  // (composeSynthesizedTodo below — one derivation, two call sites, P6).
  synthesis?: SynthesisAssembly
}

function configBlock(config: ExecutorSnapshot["config"]): Blocked | undefined {
  if (config.testByDriver || config.handoverTest || config.acceptanceGate?.length) {
    return { kind: "blocked", reason: "config", detail: "Executor mode requires testByDriver, handoverTest, and acceptanceGate to be disabled." }
  }
  if (config.subtask !== "off") {
    return { kind: "blocked", reason: "subtask", detail: "Executor mode requires subtask: off." }
  }
}

function admissionBlock(state: ExecutorSnapshot): Extract<ExecutorPreview, { kind: "blocked" | "human" }> | undefined {
  const refused = configBlock(state.config)
  if (refused) return refused
  if (state.tree === "unreadable") {
    return { kind: "blocked", reason: "unreadable", detail: "Git cannot read the workspace. Inspect the repository before resuming." }
  }
  if (!state.round) return { kind: "human", gate: "project-start", document: ANALYSIS_DOC }

  const current = state.round.current
  if (current?.indexPresent && current.surveyPresent && current.plan.tasks.every((task) => task.status === "done")) {
    const problems = current.gateProblems.filter((problem) => problem.startsWith("clarification:"))
    if (problems.length) {
      return { kind: "human", gate: "survey-release", document: phaseSurveyDoc(current.phase), detail: problems.join("\n") }
    }
  }
}

export function deriveExecutorPreview(state: ExecutorSnapshot): ExecutorPreview {
  const refused = admissionBlock(state)
  if (refused) return refused

  const current = state.round?.current
  if (state.activeProgress) {
    return { kind: "wait", reason: "in-flight", detail: "An active progress record requires continuation or settlement." }
  }
  const task = current && (state.route
    ? readyTasks(current.plan).find(({ id }) => id === state.route?.task)
    : next(current.plan))
  const continuation = task !== undefined && task.id === state.continuationUnit
  // 0277: the boundary's own continuation — a failed, expired or released
  // distill lease routes the phase's qualified id like the execute
  // continuation routes its task, so the retained edit (the partial handover
  // document, the family's own write) rides the next attempt instead of
  // meeting the clean-tree block a fresh reader cannot remedy.
  const boundaryContinuation = state.route?.task === current?.plan.phase && state.continuationUnit === current?.plan.phase
  if (state.tree === "dirty" && !continuation && !boundaryContinuation && !state.route?.scoped) {
    return { kind: "blocked", reason: "cleanTree", detail: "Inspect and resolve uncommitted changes before starting work." }
  }
  if (!current) {
    return state.round?.complete
      ? { kind: "done" }
      : { kind: "wait", reason: "not-ready", detail: "No phase is ready." }
  }

  const { phase, plan } = current
  if (!current.indexPresent) {
    return { kind: "wait", reason: "not-ready", detail: "The phase needs a task plan or formulation dispatch." }
  }
  // 0276 (0256 stage 2's first convergence kind): the phase's formulation
  // unit standing in the index is claimable coordinator work — the planning
  // session that writes every task document rides the protocol beside its
  // push twin, additive (P10 — the push path unchanged). The claimable keys
  // on exactly the predicate the push dispatch keys on (awaitingFormulation:
  // pending or blocked, never in flight — an in_progress unit belongs to a
  // push session or its recovery ladder, conservatively waited, P12), the
  // brief is the same derivation the push session reads (renderWhole over
  // the formulation task, its todo the single input), and the phase's
  // identity rides the grant as data (the qualified id and the index path —
  // the landing fence's per-kind arm and the settlement's collect read
  // them, never a second lookup). A follow-up route — the landed share's
  // verification or fix round — passes the branch: the unit's wrap-up and
  // fix sessions claim it while its todo still stands pending.
  const awaiting = state.route?.followUp ? undefined : awaitingFormulation(plan.tasks, phase)
  if (awaiting) {
    // 0281 (0279's construction-determinized letter): the formulation
    // construction's re-voicing session rides the protocol as the
    // synthesize grant, AHEAD of the formulate session — the identical
    // formulate-synthesize prompt over the same evidential sources the
    // push compose renders, claimed by the construction unit's own id with
    // the phase identity riding the grant (0276's two-field discipline).
    // The claimable keys on the push compose's own predicate family: a
    // pending formulation unit standing over the FLOOR todo (its Scope
    // carries no obligations ledger), a resolved charter, and the switch
    // not off — with any of them absent the formulate step below derives
    // unchanged (the byte-identical floor, P10; the enhancement declined,
    // never forced). The landed share is terminal (no verify follows a
    // synthesis — the push one-shot had no wrap-up session either); the
    // unit continues as formulate work over the synthesized todo.
    if (state.synthesis) {
      return {
        kind: "synthesize",
        unit: awaiting.id,
        title: awaiting.title,
        phase: plan.phase,
        index: plan.index,
        prompt: synthesizePromptText(state.synthesis.facts, {
          charters: state.synthesis.chartersText,
          duties: state.synthesis.duties,
          sources: state.synthesis.sources,
          missing: state.synthesis.missing,
          entry: state.synthesis.entry,
        }),
      }
    }
    const views = promptViews(plan, awaiting)
    return {
      kind: "formulate",
      unit: awaiting.id,
      title: awaiting.title,
      phase: plan.phase,
      index: plan.index,
      prompt: renderWhole(current.facts, views.plan, views.task, taskDocPaths(awaiting.id), {
        phase,
        mode: current.mode,
        continuation: continuation && state.continuationHandoff,
      }),
    }
  }
  if (task) {
    // 0278 (0256 stage 2's third and final convergence kind): the round's
    // standing close-audit unit — the audit session work (the adjudication
    // `run` dispatches through the ordinary pipeline push-side) rides the
    // protocol beside its push twin, additive (P10 — the construction stays
    // the close arms' write at the person's close attempt, so with no unit
    // standing the surface is byte-identical). The claimable keys on the
    // marker field the constructor wrote (the same `Close-audit:` line
    // standingCloseAudit reads), never in progress (an in_progress unit
    // belongs to a push session or its recovery ladder, conservatively
    // waited, P12 — the standing specialized-routing wait's own bytes), and
    // a marker that does not parse falls to the same wait (the honest
    // conservative read). The brief is the same derivation the push-side
    // audit session reads: renderWhole over the unit, its todo the single
    // input (the registered close-audit template's own rendering); the
    // write surface and the round's identity ride the grant as data
    // (findings, closeAuditFindingsDoc's own construction; round, the
    // marker field's own number), read by the fence and the collect, never
    // looked up twice. The follow-up route (the landed share's
    // verification or fix round) bypasses the branch through the standing
    // followUp flag — the wrap-up and fix sessions claim the unit while its
    // todo still stands pending.
    if (task.closeAudit !== undefined && !state.route?.followUp) {
      const round = /^R-(\d+)$/.exec(task.closeAudit)?.[1]
      if (task.status !== "in_progress" && round !== undefined) {
        const views = promptViews(plan, task)
        return {
          kind: "audit",
          unit: task.id,
          title: task.title,
          findings: closeAuditFindingsDoc(task.id),
          round: Number(round),
          prompt: renderWhole(current.facts, views.plan, views.task, taskDocPaths(task.id), {
            phase,
            mode: current.mode,
            continuation: continuation && state.continuationHandoff,
          }),
        }
      }
      return { kind: "wait", reason: "not-ready", detail: `${task.id} requires specialized routing before a whole-task brief can be rendered.` }
    }
    // The follow-up derivation (a landed share's verification or fix round)
    // renders below even over the formulation unit: the bypass is the
    // follow-up route's alone, and an in_progress unit never carries one
    // (a landed executor share leaves its unit pending — the driver, never
    // the session, writes the in_progress state).
    if ((task.status === "in_progress" || task.formulate) && !state.route?.followUp) {
      return { kind: "wait", reason: "not-ready", detail: `${task.id} requires specialized routing before a whole-task brief can be rendered.` }
    }
    const views = promptViews(plan, task)
    const prompt = renderWhole(current.facts, views.plan, views.task, taskDocPaths(task.id), { phase, mode: current.mode, continuation: continuation && state.continuationHandoff })
    return { kind: "execute", unit: task.id, title: task.title, touches: task.touches, prompt }
  }
  // The boundary work's own address (0277): a targeted claim or continuation
  // route naming the current phase's qualified id passes to the boundary
  // derivation below — every other target keeps the standing not-ready wait.
  if (state.route && state.route.task !== plan.phase) return { kind: "wait", reason: "not-ready", detail: `${state.route.task} is not ready.` }
  const parks = strandedParks(plan)
  if (parks.length) {
    return { kind: "blocked", reason: "mutualPark", detail: parks.map((task) => `${task.id} parks on ${task.parked}`).join(", ") }
  }
  if (state.round?.open) {
    return { kind: "wait", reason: "not-ready", detail: "The open round has no pending tasks. Add work or close the round." }
  }
  // 0277 (0256 stage 2's second convergence kind): the transfer advance's
  // distillation session — the one that writes the phase's permanent handover
  // document — rides the protocol beside its push twin, additive (P10 — the
  // person's transfer path unchanged, byte-identical). The claimable keys on
  // exactly the durable records the push dispatch keys on: the handover route
  // (the index present, tasks listed, every one done — routePhase's own
  // statuses) MINUS the push skip condition (validHandover of the handover
  // document — the idempotent skip that goes straight to archiving), held
  // behind the person's human gate (the survey-release arm above, plus the
  // clarification problems the missing-survey shape carries — the same
  // "human gate ahead of any session" discipline the advance itself runs).
  // No protocol step ever *is* the advance: the completion rename, the wall's
  // close, the brief install and the transition commit stay the person's
  // transfer act (the apply), and the landed share composes with the push
  // path's own interrupted-handover shape — the complete document on a
  // committed tree skips the session and ②③ are made up push-side.
  if (current.indexPresent && current.plan.tasks.length > 0 && current.plan.tasks.every((entry) => entry.status === "done") &&
      !current.handoverValid && !current.gateProblems.some((problem) => problem.startsWith("clarification:"))) {
    const handover = phaseHandoverDoc(phase)
    return {
      kind: "distill",
      unit: plan.phase,
      title: phaseTitle(phase),
      handover,
      prompt: renderPhaseHandover(current.facts, {
        phase: phase.entry,
        handover,
        next: current.following ? phaseTitle(current.following) : undefined,
        closedTasks: current.plan.tasks.flatMap((entry) =>
          entry.closed === undefined ? [] : [{ id: entry.id, title: entry.title, reason: entry.closed }]),
      }),
    }
  }
  return { kind: "phase-boundary", phase: plan.phase, problems: current.gateProblems }
}

async function readExecutorTree(dir: string): Promise<ExecutorSnapshot["tree"]> {
  if (!(await workTree(dir)).inside) return "unreadable"
  let dirty = false
  for (const root of await repoRoots(dir)) {
    const entries = await statusEntriesRead(dir, root)
    if (!entries) return "unreadable"
    dirty ||= entries.some(({ rel, status }) => status !== "??" || !workdirEntry(rel))
  }
  return dirty ? "dirty" : "clean"
}

async function readExecutorSnapshot(dir: string, continuationUnit?: string, checkout = dir): Promise<ExecutorSnapshot | Blocked> {
  if (!(await Bun.file(join(dir, CONFIG_FILE)).exists())) {
    return { kind: "blocked", reason: "config", detail: `Initialize the project to create ${CONFIG_FILE}.` }
  }
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(dir)
  } catch (error) {
    return { kind: "blocked", reason: "config", detail: String(error) }
  }
  const refused = configBlock(config)
  if (refused) return refused

  const tree = await readExecutorTree(dir)
  const state: ExecutorSnapshot = { config, tree, activeProgress: false, continuationUnit }
  if (tree === "unreadable") return state

  const round = await readPhases(dir)
  if (!round) return state
  const phase = currentPhase(round)
  if (continuationUnit) {
    const handoff = await Bun.file(join(checkout, taskDocPaths(continuationUnit).handoff)).text().catch(() => "")
    state.continuationHandoff = handoffStatus(handoff) === "continue"
  }
  state.activeProgress = (await peekProgress(dir))?.active === true
  state.round = { complete: round.done.size === round.phases.length, open: round.open }
  if (phase) {
    const plan = await loadPlan(dir, phase)
    const gates = phaseGates(phase)
    const [indexPresent, surveyPresent, gateProblems] = await Promise.all([
      Bun.file(join(dir, taskIndexPath(phase))).exists(),
      Bun.file(join(dir, phaseSurveyDoc(phase))).exists(),
      plan.tasks.every((task) => task.status === "done") ? phaseGateProblems(dir, phase, gates) : [],
    ])
    // 0277: the boundary derivation's inputs read once beside the standing
    // ones — the phase after the current (readPhases' own order) and the
    // handover document's validity (validHandover, the push skip predicate's
    // own function).
    const phases = round.phases
    const following = phases[phases.findIndex((unit) => unit.id === phase.id) + 1]
    const handoverValid = validHandover(await Bun.file(join(dir, phaseHandoverDoc(phase))).text().catch(() => ""))
    const facts = promptFacts({ dir, intent: config.intent })
    state.round.current = {
      phase, plan, indexPresent, surveyPresent, gateProblems,
      facts,
      mode: loadModes(dir)[config.mode],
      ...(following ? { following } : {}),
      handoverValid,
    }
    // 0281: the synthesize grant's derivation inputs, read once when the
    // gate family holds (the assembly's own checks decline fast otherwise —
    // undefined leaves the formulate floor byte-identical, P10).
    state.synthesis = await readSynthesisAssembly(dir, { phase, plan, config, facts })
  }
  return state
}

export async function readExecutorAdmissionBlock(dir: string) {
  const state = await readExecutorSnapshot(dir)
  return "kind" in state ? state : admissionBlock(state)
}

export async function readExecutorPreview(dir: string, continuationUnit?: string, route?: ExecutorSnapshot["route"], checkout?: string): Promise<ExecutorPreview> {
  const state = await readExecutorSnapshot(dir, continuationUnit, checkout)
  if ("kind" in state) return state
  state.route = route
  const step = deriveExecutorPreview(state)
  const current = state.round?.current
  if (step.kind === "execute" && current) {
    const task = current.plan.tasks.find(({ id }) => id === step.unit)
    if (task?.parked !== undefined) {
      step.prompt += await parkReleaseNote(current.facts, dir, current.plan, task, taskDocPaths(task.id))
    }
  }
  return step
}

export async function readExecutorParkPlan(dir: string) {
  const round = await readPhases(dir)
  const phase = round && currentPhase(round)
  return phase ? loadPlan(dir, phase) : undefined
}

// The PlanPhase of a qualified phase id plus its task-index path (0276):
// the two strings carry the phase's whole identity, and the runner's own
// reconstruction (plan.phase split beside dirname(plan.index)) lives here —
// the one home the coordinator's formulation gate and the formulate
// settlement's collect both read.
export function planPhaseOf(phase: string, index: string): { round: string; id: string; dir: string } {
  const [round, id] = phase.split(".")
  return { round: round!, id: id!, dir: dirname(index) }
}

// —— the synthesize grant's derivation and settlement composition (0281) ——
//
// The formulation construction's re-voicing session (0097's constructor
// one-shot) converged onto the protocol: a `synthesize` grant carries the
// IDENTICAL formulate-synthesize prompt over the same evidential sources
// the push compose renders (one assembly, one render — formulate-synthesis
// owns both halves), the holder writes its reply at the formulation unit's
// todo path (the one write surface the fence admits — the reply channel),
// and the settlement validates the reply through the same mechanical
// checks the push loop ran (checkSynthesisReply: the strict delimiters,
// the ledger grammar, the seeded sequence, the quote anchoring), composes
// the synthesized todo through renderFormulationTodo's synthesis shape
// (the guarantee gate's throw a blocked problem — the push's retry cause
// is the holder's remedy here), and lands through the standing
// constructFormulation path under the `phase-synthesize` stage word. The
// fidelity classifier one-shot is not rebuilt (P21, 0279's ruling).

export type SynthesisAssembly = {
  phase: PhaseUnit
  unit: string
  facts: PromptFacts
  entry: PhaseTypeEntry
  // The Acceptance text (formulationAcceptance) and the prompt's charters
  // body (verifyPlanCharterText) — two renderings of the resolved charter.
  charter: string
  chartersText: string
  duties: string
  sources: LedgerSource[]
  missing: string[]
  seeded: LedgerRow[]
  // The standing floor todo's own committed records (plans/0205 D2/D3),
  // carried through the landing unchanged: the floor-assembly digest the
  // digest-keep compares and the prefix ids the todo was constructed
  // beside. Never recomputed here — the floor assembly itself has not
  // moved; only its Scope is being re-voiced.
  floorFields: { digest?: string; prefix?: string[] }
  baseInput: Omit<Parameters<typeof renderFormulationTodo>[1], "synthesis">
}

// One derivation, two call sites (the snapshot's read for the grant's
// brief, the settlement's re-read for the composition — P6: derived from
// disk, never persisted). The pre-derived inputs let the snapshot pass
// what it already read; the settlement passes nothing and the function
// re-reads. Returns undefined whenever the synthesize grant does not
// derive — the byte-identical formulate floor (P10).
export async function readSynthesisAssembly(
  dir: string,
  pre: { phase?: PhaseUnit; plan?: Plan; config?: ProjectConfig; facts?: PromptFacts } = {},
): Promise<SynthesisAssembly | undefined> {
  // The switch (the push compose's own gate): off forces the floor.
  if (!autoSwitches().synthesis) return undefined
  const phase = pre.phase ?? currentPhase(await phaseState(dir))
  if (phase === undefined) return undefined
  const plan = pre.plan ?? await loadPlan(dir, phase).catch(() => undefined)
  if (plan === undefined) return undefined
  const awaiting = awaitingFormulation(plan.tasks, phase)
  if (awaiting === undefined) return undefined
  let config: ProjectConfig
  try {
    config = pre.config ?? await loadProjectConfig(dir)
  } catch {
    return undefined
  }
  const facts = pre.facts ?? promptFacts({ dir, intent: config.intent })
  const entry = phase.entry
  const chartersText = verifyPlanCharterText(resolvedVerifyPlan(facts.pack, entry))
  if (chartersText === undefined) return undefined
  // The floor gate: the standing todo carries no obligations ledger — a
  // synthesized todo's Scope carries one, so a completed synthesis (or a
  // person's hand-written ledger) derives the formulate step instead. (The
  // settlement restores the booked floor before composing — the working
  // todo during a report is the reply channel, never the document.)
  const todoText = await Bun.file(join(dir, taskStatePaths(awaiting.id).pending)).text().catch(() => undefined)
  if (todoText === undefined) return undefined
  if (ledgerOf(todoText) !== undefined) return undefined
  // The sources: the same evidential assembly the push compose builds
  // (formulationParts' gathering, read here without its booking half).
  const state = await phaseState(dir)
  const parts = await readFormulationSources(dir, phase, state)
  const brief = (await projectBriefText(dir)) || undefined
  const input = (await readPlanInput(dir, phase))?.trim() || undefined
  const block = await priorRoundBlock(dir, state, DEFAULT_CONTEXT_LIMIT)
  const assembled = synthesisSources({
    ...(brief ? { brief } : {}),
    roundPath: roundBriefPath(state.round),
    ...(parts.round ? { round: parts.round } : {}),
    ...(parts.analysis !== undefined ? { analysis: parts.analysis } : {}),
    humanGated: entry.gates.includes("human"),
    ...(input ? { planInput: { path: planInputPath(phase), text: input } } : {}),
    handoverDocs: parts.handoverDocs,
    missingHandovers: parts.missingHandovers,
    ...(block.prevRound ? { prevRound: block.prevRound } : block.prevRoundExpected ? { prevRoundExpected: true } : {}),
  })
  // The fixed-prefix and numbering derivation (compose's own arms over the
  // same disk state): a pending formulation renders the review prefix from
  // the index's other rows; a blocked one reads the landed todo's own
  // `Prefix:` field back.
  const fields = parseUnitDoc(todoText).fields
  const review = awaiting.status === "pending"
  const prefixIds = review
    ? plan.tasks.filter((task) => task.id !== awaiting.id).map((task) => task.id)
    : (fields.prefix ?? "").split(/[\s,]+/).filter(Boolean)
  const existingTasks = prefixIds.length
    ? existingTaskList(plan.tasks
        .filter((task) => prefixIds.includes(task.id))
        .map((task) => ({ id: task.id, title: task.title, status: task.status })))
    : undefined
  const numberStart = review
    ? await taskNumberFloor(dir)
    : prefixIds.length
      ? Math.max(taskNumber(awaiting.id) ?? 0, ...prefixIds.map((id) => taskNumber(id) ?? 0)) + 1
      : (await formulationNumber(dir, phase)) + 1
  const charter = formulationAcceptance(facts, entry)
  const base = await readFormulationBaseInput(dir, { phase, plan, config, facts })
  return {
    phase,
    unit: awaiting.id,
    facts,
    entry,
    charter,
    chartersText,
    duties: planDutyText(facts, entry, { phaseName: entry.name }),
    sources: assembled.sources,
    missing: assembled.missing,
    seeded: seededLedgerRows(entry),
    floorFields: {
      ...(fields["floor-digest"] !== undefined ? { digest: fields["floor-digest"] } : {}),
      ...(prefixIds.length ? { prefix: prefixIds } : {}),
    },
    baseInput: base.input,
  }
}

// The floor composition's shared derivation (0282's split of the 0281
// assembly): the renderFormulationTodo base input plus the standing prefix
// and digest records, derived from disk alone — one derivation the synthesize
// assembly, the deterministic transfer's floor construction and the
// settlement's composition all read (P5/P6; loop-plan's compose builds the
// same input inline for the push pipeline, the demolition track retiring
// that twin when its callers empty).
export type FormulationBase = {
  input: Omit<Parameters<typeof renderFormulationTodo>[1], "synthesis">
  prefixIds: string[]
  digest: string
  // The floor render itself (undefined only when the render facts cannot
  // load — the caller's own refusal) and the facts it rendered under.
  todo: { goal: string; scope: string; acceptance: string } | undefined
  facts: PromptFacts | undefined
}

export async function readFormulationBaseInput(
  dir: string,
  pre: { phase: PhaseUnit; plan?: Plan; config?: ProjectConfig; facts?: PromptFacts; standing?: Plan["tasks"][number] },
): Promise<FormulationBase> {
  const phase = pre.phase
  const plan = pre.plan ?? await loadPlan(dir, phase).catch(() => undefined)
  const config = pre.config ?? await loadProjectConfig(dir).catch(() => undefined)
  const facts = pre.facts ?? (config === undefined ? undefined : promptFacts({ dir, intent: config.intent }))
  const entry = phase.entry
  const state = await phaseState(dir)
  const parts = await readFormulationSources(dir, phase, state)
  const brief = (await projectBriefText(dir)) || undefined
  const input = (await readPlanInput(dir, phase))?.trim() || undefined
  const block = await priorRoundBlock(dir, state, DEFAULT_CONTEXT_LIMIT)
  const standing = pre.standing ?? (plan === undefined ? undefined : awaitingFormulation(plan.tasks, phase))
  const todoText = standing === undefined ? undefined : await Bun.file(join(dir, taskStatePaths(standing.id).pending)).text().catch(() => undefined)
  const fields = todoText === undefined ? {} : parseUnitDoc(todoText).fields
  const review = standing?.status === "pending"
  const prefixIds = review
    ? (plan?.tasks.filter((task) => task.id !== standing?.id).map((task) => task.id) ?? [])
    : (fields.prefix ?? "").split(/[\s,]+/).filter(Boolean)
  const existingTasks = prefixIds.length && plan !== undefined
    ? existingTaskList(plan.tasks
        .filter((task) => prefixIds.includes(task.id))
        .map((task) => ({ id: task.id, title: task.title, status: task.status })))
    : undefined
  const numberStart = review
    ? await taskNumberFloor(dir)
    : prefixIds.length
      ? Math.max(taskNumber(standing?.id ?? "") ?? 0, ...prefixIds.map((id) => taskNumber(id) ?? 0)) + 1
      : (await formulationNumber(dir, phase)) + 1
  const delta = await roundDeltaBlock(dir, state.round)
  const charter = facts === undefined ? "" : formulationAcceptance(facts, entry)
  const input1 = {
    phase: entry,
    phaseId: plan?.phase ?? "",
    taskIndex: plan?.index ?? taskIndexPath(phase),
    numberStart,
    ...(existingTasks ? { existingTasks } : {}),
    ...(brief ? { brief } : {}),
    ...(parts.round ? { round: parts.round } : {}),
    ...(parts.analysis !== undefined ? { analysis: parts.analysis } : {}),
    ...(input ? { input, inputPath: planInputPath(phase) } : {}),
    handovers: parts.handovers,
    ...(block.prevRound ? { prevRound: block.prevRound } : {}),
    ...(config === undefined ? {} : { mode: loadModes(dir)[config.mode] }),
    trimmedPhases: !state.phases.some((unit) => (unit.type === "analysis" || unit.type === "design") && !state.closed.has(unit.id)),
    ...(delta ? { delta } : {}),
    charter,
  }
  const floor = facts === undefined ? undefined : renderFormulationTodo(facts, { ...input1, delta: undefined })
  return {
    input: input1,
    prefixIds,
    digest: floor === undefined ? "" : floorDigest(previewFormulationDocument(floor, plan?.phase ?? "", prefixIds.length ? prefixIds : undefined)),
    todo: floor,
    facts,
  }
}

// The deterministic floor construction (plans/0282, the pull-only transfer's
// apply): compose the phase's formulation todo through the shared derivation
// and land it through the standing construction path — git and document
// writes only, the synthesis enhancement riding the executor protocol as the
// synthesize grant (0281), the charter verifier's session refused (the
// person's review at the stop, the executor's verify share over the
// formulation unit). Returns constructFormulation's own shapes.
export async function constructPhaseFloor(dir: string, phase: PhaseUnit) {
  const base = await readFormulationBaseInput(dir, { phase })
  if (base.todo === undefined) {
    return { type: "failed" as const, question: "the formulation render facts could not load — inspect the project configuration" }
  }
  return constructFormulation(dir, phase, base.todo, {
    ...(base.digest ? { digest: base.digest } : {}),
    ...(base.prefixIds.length ? { prefix: base.prefixIds } : {}),
  })
}

// The settlement's composition: one holder reply validated and composed
// into the construction's body — the same mechanical checks the push loop
// ran (checkSynthesisReply) and the same synthesis-shape render (the
// guarantee gate's throw a problem, the holder's remedy). The landing
// itself stays the coordinator's (constructFormulation under the
// phase-synthesize stage word); this function is pure over disk plus the
// reply text, so a settlement replay re-derives it unchanged.
export type SynthesizedConstruction = {
  phase: PhaseUnit
  unit: string
  todo: { goal: string; scope: string; acceptance: string }
  record: { digest?: string; prefix?: string[]; stage: "phase-synthesize" }
}

export async function composeSynthesizedTodo(
  dir: string,
  replyText: string,
): Promise<{ kind: "ok"; construction: SynthesizedConstruction } | { kind: "problems"; problems: string[] }> {
  const assembly = await readSynthesisAssembly(dir)
  if (assembly === undefined) {
    return { kind: "problems", problems: ["no synthesizable formulation stands for the current phase (the formulation unit, its floor todo, the resolved charter, or the OPENCODE_AUTO_SYNTHESIS switch)"] }
  }
  const checked = checkSynthesisReply(replyText, assembly.seeded, assembly.sources)
  if ("problems" in checked) return { kind: "problems", problems: checked.problems }
  try {
    const todo = renderFormulationTodo(assembly.facts, {
      ...assembly.baseInput,
      synthesis: {
        brief: checked.brief,
        ledger: renderLedger([...assembly.seeded, ...checked.own]),
        ...(assembly.missing.length ? { missing: assembly.missing } : {}),
        protocol: protocolFrameText(assembly.entry),
      },
    })
    return {
      kind: "ok",
      construction: {
        phase: assembly.phase,
        unit: assembly.unit,
        todo,
        record: {
          ...(assembly.floorFields.digest !== undefined ? { digest: assembly.floorFields.digest } : {}),
          ...(assembly.floorFields.prefix !== undefined && assembly.floorFields.prefix.length ? { prefix: assembly.floorFields.prefix } : {}),
          stage: "phase-synthesize",
        },
      },
    }
  } catch (error) {
    if (error instanceof PromptGuaranteeError) return { kind: "problems", problems: [error.message] }
    throw error
  }
}

export type VerificationPreview = {
  kind: "verify"
  unit: string
  title: string
  index: string
  baseline: string
  head: string
  prompt: string
}

export type FixPreview = {
  kind: "fix"
  unit: string
  title: string
  head: string
  round: number
  touches?: readonly string[]
  // 0276: a fix round over the phase's formulation unit repairs the plan
  // its session wrote — the formulation context (the qualified phase id and
  // its index path) rides the grant so the landing fence's per-kind arm
  // admits the same family the formulate share writes (per-unit context on
  // the grant, 0261's letter). Absent on every other fix grant. 0278: a fix
  // round over the standing close-audit unit carries the audit context —
  // the findings document path — so the fence admits the same document the
  // audit share writes (the repair fixes the document's acceptance, never
  // the invariant).
  phase?: string
  index?: string
  findings?: string
  prompt: string
}

type FollowUp = { kind: "verify"; unit: string; baseline: string; head: string } |
  { kind: "fix"; unit: string; round: number; head: string }

// The follow-up blocks (0276: the formulate step excluded with execute — a
// follow-up derivation never answers with the fresh-claim formulate step,
// its route bypasses the awaiting branch by construction; 0277 adds the
// distill step — a follow-up route always targets a task unit, so the
// phase-addressed boundary step never answers one either; 0278 adds the
// audit step — the followUp flag bypasses the marker-field branch the same
// way, the wrap-up and fix renders owning the route; 0281 adds the
// synthesize step — the awaiting branch is the fresh-claim route's alone).
type FollowUpBlock = Exclude<ExecutorPreview, { kind: "execute" } | { kind: "formulate" } | { kind: "synthesize" } | { kind: "distill" } | { kind: "audit" }>

export function readExecutorFollowUp(
  dir: string,
  share: Extract<FollowUp, { kind: "verify" }>,
  continuation?: false,
  scoped?: boolean,
  checkout?: string,
): Promise<VerificationPreview | FollowUpBlock>
export function readExecutorFollowUp(
  dir: string,
  share: Extract<FollowUp, { kind: "fix" }>,
  continuation: boolean,
  scoped?: boolean,
  checkout?: string,
): Promise<FixPreview | FollowUpBlock>
export async function readExecutorFollowUp(
  dir: string,
  share: FollowUp,
  continuation = false,
  scoped = false,
  checkout?: string,
): Promise<VerificationPreview | FixPreview | FollowUpBlock> {
  const state = await readExecutorSnapshot(dir, continuation ? share.unit : undefined, checkout)
  if ("kind" in state) return state
  // The follow-up flag (0276): the landed share's verification or fix round
  // claims the unit through deriveExecutorPreview's ordinary task render —
  // over the phase's formulation unit too, whose standing todo would
  // otherwise answer the follow-up with the formulate step (the awaiting
  // branch is the fresh-claim route's alone).
  state.route = { task: share.unit, scoped, followUp: true }
  const step = deriveExecutorPreview(state)
  // The follow-up flag above bypasses the awaiting branch, so the formulate
  // step never answers a follow-up; the unreachable arm reads as off-route
  // (the fresh-claim route alone owns the formulate step). The distill step
  // joins it by the route wait (0277): a follow-up targets a task id, which
  // never equals the current phase's — the boundary step is the fresh-claim
  // and continuation routes' alone. The audit step joins by the flag (0278):
  // the marker-field branch is the fresh-claim route's alone, the wrap-up
  // and fix renders owning the follow-up. The synthesize step joins by the
  // flag's own bypass (0281): the awaiting branch is the fresh-claim route's
  // alone.
  if (step.kind === "formulate" || step.kind === "distill" || step.kind === "audit" || step.kind === "synthesize") {
    return { kind: "wait", reason: "not-ready", detail: `${share.unit} is outside the current phase route.` }
  }
  if (step.kind !== "execute") return step
  const current = state.round?.current
  const task = current?.plan.tasks.find(({ id }) => id === share.unit)
  if (!current || !task || step.unit !== share.unit) {
    return { kind: "wait", reason: "not-ready", detail: `${share.unit} is outside the current phase route.` }
  }
  const views = promptViews(current.plan, task)
  if (share.kind === "fix") {
    return {
      ...share,
      title: task.title,
      touches: task.touches,
      ...(task.formulate === current.plan.phase ? { phase: current.plan.phase, index: current.plan.index } : {}),
      // 0278: the audit context rides the fix grant over the standing
      // close-audit unit — the fence's family arm admits the findings
      // document for the repair (the marker field the derivation reads).
      ...(task.closeAudit !== undefined ? { findings: closeAuditFindingsDoc(task.id) } : {}),
      prompt: renderFix(current.facts, views.plan, views.task, taskDocPaths(task.id), {
        mode: current.mode,
        phase: current.phase,
        continuation: state.continuationHandoff,
      }),
    }
  }
  return {
    ...share,
    title: task.title,
    index: current.plan.index,
    prompt: renderWrapup(current.facts, views.plan, views.task, taskDocPaths(task.id), {
      mode: current.mode,
      phase: current.phase,
      commitRange: `${share.baseline}..${share.head}`,
    }),
  }
}
