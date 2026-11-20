// Read-only executor previews (0246 D10 slice 1, 0249 D4). The coordinator
// must re-evaluate under its run lock before admitting work.
import { dirname, join } from "node:path"
import { CONFIG_FILE, loadProjectConfig, type ProjectConfig } from "./config"
import { ANALYSIS_DOC, taskDocPaths } from "./docpaths"
import { handoffStatus } from "./document/roles"
import { parkReleaseNote } from "./execute"
import { awaitingFormulation } from "./formulate"
import { repoRoots, statusEntriesRead, workdirEntry, workTree } from "./git"
import { loadModes, type ModeSpec } from "./mode"
import { currentPhase, phaseGateProblems, phaseGates, phaseSurveyDoc, readPhases, type PhaseUnit } from "./phases"
import { renderFix, renderWhole, renderWrapup, type PromptFacts } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { peekProgress } from "./resume"
import { loadPlan, next, promptViews, readyTasks, strandedParks, taskIndexPath, type Plan } from "./tasks"

type BlockReason = "config" | "subtask" | "unreadable" | "cleanTree" | "mutualPark"
type Blocked = { kind: "blocked"; reason: BlockReason; detail: string }

export type ExecutorPreview =
  | Blocked
  | { kind: "human"; gate: "project-start" | "survey-release"; document: string; detail?: string }
  | { kind: "wait"; reason: "not-ready" | "in-flight"; detail: string }
  | { kind: "execute"; unit: string; title: string; touches?: readonly string[]; prompt: string }
  | { kind: "formulate"; unit: string; title: string; phase: string; index: string; prompt: string }
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
    }
  }
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
  if (state.tree === "dirty" && !continuation && !state.route?.scoped) {
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
    // The follow-up derivation (a landed share's verification or fix round)
    // renders below even over the formulation unit: the bypass is the
    // follow-up route's alone, and an in_progress unit never carries one
    // (a landed executor share leaves its unit pending — the driver, never
    // the session, writes the in_progress state).
    if ((task.status === "in_progress" || task.formulate || task.closeAudit) && !state.route?.followUp) {
      return { kind: "wait", reason: "not-ready", detail: `${task.id} requires specialized routing before a whole-task brief can be rendered.` }
    }
    const views = promptViews(plan, task)
    const prompt = renderWhole(current.facts, views.plan, views.task, taskDocPaths(task.id), { phase, mode: current.mode, continuation: continuation && state.continuationHandoff })
    return { kind: "execute", unit: task.id, title: task.title, touches: task.touches, prompt }
  }
  if (state.route) return { kind: "wait", reason: "not-ready", detail: `${state.route.task} is not ready.` }
  const parks = strandedParks(plan)
  if (parks.length) {
    return { kind: "blocked", reason: "mutualPark", detail: parks.map((task) => `${task.id} parks on ${task.parked}`).join(", ") }
  }
  if (state.round?.open) {
    return { kind: "wait", reason: "not-ready", detail: "The open round has no pending tasks. Add work or close the round." }
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
    state.round.current = {
      phase, plan, indexPresent, surveyPresent, gateProblems,
      facts: promptFacts({ dir, intent: config.intent }),
      mode: loadModes(dir)[config.mode],
    }
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
  // the grant, 0261's letter). Absent on every other fix grant.
  phase?: string
  index?: string
  prompt: string
}

type FollowUp = { kind: "verify"; unit: string; baseline: string; head: string } |
  { kind: "fix"; unit: string; round: number; head: string }

// The follow-up blocks (0276: the formulate step excluded with execute — a
// follow-up derivation never answers with the fresh-claim formulate step,
// its route bypasses the awaiting branch by construction).
type FollowUpBlock = Exclude<ExecutorPreview, { kind: "execute" } | { kind: "formulate" }>

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
  // (the fresh-claim route alone owns the formulate step).
  if (step.kind === "formulate") {
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
