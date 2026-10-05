// Phase planning: the planning session (planPhase) and its step wrapper
// (planWithStep), the appending session (appendPlan, appendWithStep) with its
// snapshot → reset → collect cycle, plus the phase-state helpers the phase
// loop shares (phaseState, phaseTitle). Moved out of src/loop-phase.ts
// (plans/0053 A2) so the P3 planning additions, starting with the persisted
// planning input (A3, src/plan-input.ts), do not push that file past 600
// lines. It is the one planner: m mode plans here too (A4, D12), and m mode
// appends on the same append step (D23). Direction: loop-phase → loop-plan
// → loop-task; never imports loop-phase or loop.
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { requireArtifact } from "./artifact"
import { projectBriefText } from "./brief"
import { digestIndexEntries, priorKnowledgeDigest, renderDigestIndex } from "./knowledge"
import { formatTokens, log } from "./log"
import type { LoopCtx } from "./loop-task"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE, taskNumber } from "./numbering"
import { phaseHandoverDoc, phaseKey, phaseLabel, phaseName, prevRoundDigest, readPhases, type PhaseState, type PhaseUnit } from "./phases"
import { plannedLines } from "./plan"
import { planInputPath, readPlanInput, savePlanInput } from "./plan-input"
import { existingTaskList, planDutyText, renderImplementPlan, renderPhaseAppend, renderPhasePlan } from "./prompt-plan"
import { verifyAuditEntry, verifyPlanPrompt } from "./prompt-verify"
import { promptFacts } from "./prompt-facts"
import { closeStep } from "./resume"
import { roundBriefText } from "./round-brief"
import { statsDigest } from "./stats"
import { stepPause } from "./step"
import { estimateTokens } from "./usage"
import { DEFAULT_CONTEXT_LIMIT, sessionOpts } from "./opts"
import {
  doneTaskIds,
  loadPlan,
  newTaskProblems,
  plannedTaskProblems,
  qualifiedPhase,
  resetPlanning,
  takenTaskIds,
  taskDecl,
  taskIndexPath,
  taskStatePaths,
  type PlanPhase,
} from "./tasks"
import { templateRenders } from "./template"
import { isUnitId, parseIndex, unitProblems, type IndexEntry, type UnitDecl } from "./document/unit"

// the phase index (routing already validated it; re-read here only for the
// done set and the order, missing/invalid treated as empty).
export async function phaseState(directory: string): Promise<PhaseState> {
  return (await readPhases(directory).catch(() => undefined)) ?? { round: 0, index: "", phases: [], done: new Set(), closed: new Map() }
}

// the phase display name (logs/commit titles): P02-design Design
export const phaseTitle = (unit: PhaseUnit) => `${phaseLabel(unit)} ${phaseName(unit)}`

// The planning renders' facts (E2): the bypass sessions' human-questions mode
// is plan's stop condition — the same rule sessionOpts applies to every
// bypass site, so a planning prompt renders the question-rule's human-answer
// branch exactly when its session would wait for the human.
const planFacts = (ctx: LoopCtx) => promptFacts({ dir: ctx.directory, humanQuestions: ctx.opts.stopBefore === "execute", intent: ctx.opts.intent })

// A phase type's duty paragraph for the planning/append prompts (E2):
// prompt-plan's planDutyText — the type's own `## plan duties` (custom
// types), then — the pack tier, plans/0080 §4 — the active pack's `###
// <dutiesRef>` under `## phase duties`, then the core shared partial,
// rendered through the active library so overlays apply.
const planDuties = (ctx: LoopCtx, entry: PhaseUnit["entry"]): string => planDutyText(planFacts(ctx), entry)

// The plan-step consistency gate (plans/0080 §5): before a planning or append
// session runs, its composed prompt is judged against the active pack's
// verify-plan charter and the verdict recorded in the round's prompt-audit.md
// (written here, ahead of the session, so the step's own commit carries it —
// the wall documentation a clean-room defense wants). Returns 0 = proceed
// (consistent, inactive, or a skip the mechanical layers still cover), 2 =
// blocked for the human: an inconsistent prompt quotes the evidence, a
// verifier that cannot answer fails closed after its retry.
async function verifyPlanStep(ctx: LoopCtx, phase: PhaseUnit, step: string, prompt: string): Promise<number> {
  const outcome = await verifyPlanPrompt({ pool: ctx.server, routing: ctx.routing, facts: planFacts(ctx), step, prompt })
  if (outcome.kind === "inactive") return 0
  const audit = join(dirname(phase.dir), "prompt-audit.md")
  const previous = await Bun.file(join(ctx.directory, audit)).text().catch(() => "")
  await Bun.write(
    join(ctx.directory, audit),
    `${previous.trim() ? `${previous.trimEnd()}\n` : "# Prompt-audit record (plans/0080 §5): every plan-step consistency verdict of this round\n\n"}${verifyAuditEntry(step, outcome)}\n`,
  )
  if (outcome.kind === "skipped") {
    log(`ℹ plan verification skipped: ${outcome.reason}`)
    return 0
  }
  if (outcome.kind === "consistent") {
    log(`✓ plan verification: the ${step} prompt is consistent with the intent charter (${audit})`)
    return 0
  }
  if (outcome.kind === "inconsistent") {
    log(`⏸ plan verification found the ${step} prompt inconsistent with the intent charter: ${outcome.evidence}`)
    log(`  The verdict is recorded in ${audit}. Rewrite the conflicting input, or amend the intent — the driver never rewrites your words`)
    return 2
  }
  log(`⏸ plan verification could not judge the ${step} prompt: ${outcome.reason}`)
  log(`  The failure is recorded in ${audit} — fail-closed, fix the verifier's model and re-run`)
  return 2
}

// the phase planning session (§E): a one-off bypass reusing the
// requireArtifact skeleton, artifacts = this phase's task index
// <phase-directory>/tasks.md + each task's docs/T-NNN/todo.md (M3.4,
// plans/0047 L3); collect shape-checks under the mandatory policy
// (plannedTaskProblems). The pseudo task PLAN enters no task chain and writes
// no progress record.
// m mode (ctx.manual) plans on the same step, commit stage and checks
// (plans/0053 D12), with three differences: the prompt is implement-plan over
// the persisted planning input, which m-mode planning requires (m mode has no
// round brief or handovers); the routing role is implement-scan, so existing
// routing configs stay valid; and without the numbering record the tasks are
// numbered after the highest taken id. Returns 0 = planning complete, 1 = m
// mode with no planning input.
export async function planPhase(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  // The phase loop routes m mode here only with an input, new or persisted;
  // checked first, so a missing one starts no numbering-restore session.
  if (ctx.manual && !ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to plan ${phaseTitle(phase)} against: m-mode planning plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // auto numbering (config.autoNumber): the planning session's numbering
  // start comes from the .auto/next-task record; a missing record is restored
  // first (no historical evidence writes 1 directly, with evidence an AI
  // inference session opens, see src/numbering.ts), and a blocked restore
  // exits 2. The restore session itself produces one unified commit
  // (stage=numbering), ahead of the planning session.
  let numberStart: number | undefined
  if (opts.autoNumber) {
    const numbering = await ensureNumbering(serverHandle, directory, sessionOpts(ctx, { site: "plan-numbering" }))
    if (numbering.type === "dirty") {
      log(`⏸ worktree not clean before restoring the numbering record; handle it manually (commit/clean) and re-run:`)
      for (const file of numbering.files) log(`  ${file}`)
      return 2
    }
    if (numbering.type === "blocked") {
      log(`⏸ numbering-record restore session blocked (implicit block, investigate and re-run):\n${numbering.question}`)
      return 2
    }
    numberStart = numbering.next
  }
  // The planning input (plans/0053 D9): a new text is persisted to the phase's
  // plan-input.md and committed on its own before the planning unit starts;
  // without one the step plans against the persisted file, so an interrupted
  // or blocked step resumes with its input under plan and run alike. A
  // different text restarts an open step in a new session: the latest input
  // wins, and no reused session plans against a text it never saw.
  let restart: string | undefined
  if (ctx.input) {
    const saved = await savePlanInput(directory, phase, ctx.input, phaseTitle(phase))
    if (saved.type === "dirty") {
      log(`⏸ worktree not clean before saving the planning input; handle it manually (commit/clean) and re-run:`)
      for (const file of saved.files) log(`  ${file}`)
      return 2
    }
    if (saved.type === "failed") {
      log(`⏸ ${saved.question}`)
      return 2
    }
    ctx.input = undefined
    if (saved.type === "saved") {
      log(`✓ planning input saved to ${planInputPath(phase)}`)
      restart = "the planning input changed"
    }
  }
  const input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input && !restart) log(`ℹ planning against the persisted input ${planInputPath(phase)}`)
  // An optional slot, not a tier-1 marker (D11): an override that predates it
  // still loads, and would silently drop the input.
  if (!ctx.manual && input && !templateRenders("phase-plan", "input")) {
    log("⚠ the project's phase-plan template does not render {{input}}; the planning session will not see the input")
  }
  // The project brief (plans/0052 D9), comments stripped: an untouched stub injects nothing.
  const brief = await projectBriefText(directory)
  const taskIndex = taskIndexPath(phase)
  const phaseId = qualifiedPhase(phase)
  // the taken task numbers: the tasks other phases' task indexes list and
  // the already-completed tasks (this phase's own planning leftovers do not
  // count — an interrupted resume/feedback retry rewrites the same batch of
  // numbers).
  const taken = await takenTaskIds(directory, phase)
  const prompt = ctx.manual
    ? renderImplementPlan(planFacts(ctx), {
        file: planInputPath(phase),
        content: input!,
        brief,
        phaseId,
        taskIndex,
        // Without the numbering record: after the highest taken id (the former
        // init shortcut's rule, plans/0053 D12).
        numberStart: numberStart ?? Math.max(0, ...[...taken].map((id) => taskNumber(id) ?? 0)) + 1,
        parallel: opts.parallel,
      })
    : await phasePlanPrompt(ctx, phase, { brief, input, taskIndex, phaseId, numberStart })
  // The plan-step consistency gate (plans/0080 §5): the composed planning
  // prompt meets the intent charter here — where the human planning input,
  // the brief and the duties all sit in one text. Blocked (2) = the verdict
  // or a fail-closed verifier stopped the step before any session ran.
  const verified = await verifyPlanStep(ctx, phase, ctx.manual ? `implement-plan ${phaseId}` : `phase-plan ${phaseKey(phase).id}`, prompt)
  if (verified !== 0) return verified
  let problems: string[] = []
  log(`▶ starting the phase planning session to write ${taskIndex} and the task documents`)
  const planned = await requireArtifact(
    serverHandle,
    { id: "PLAN", title: `phase planning (${phaseTitle(phase)})`, status: "in_progress", attempts: 0, body: "" },
    prompt,
    sessionOpts(ctx, { site: "phase-plan" }),
    {
      kind: "phase planning",
      step: { step: "phase-plan", unit: phaseKey(phase).id },
      restart,
      role: ctx.manual ? "implement-scan" : undefined,
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out
      // check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `a valid task index ${taskIndex} with its task documents (at least one task)`,
      detail: "missing, no task, a non-compliant task document, or a task number reusing a taken number",
      get requirement() {
        return (
          `write the task index ${taskIndex} (one line per task, \`- [ ] T-NNN <task title>\`, at least one` +
          `${ctx.manual ? "" : "; even if you believe this phase has nothing to do, write one explanatory task"}) ` +
          `and each task's docs/T-NNN/todo.md (title line \`# T-NNN: <task title>\`, field line \`Phase: ${phaseId}\`, ` +
          `the three sections \`## Goal\` / \`## Scope\` / \`## Acceptance\`, last line \`<!-- auto: eof -->\`).` +
          (problems.length ? ` Problems last time: ${problems.join("; ")}.` : "")
        )
      },
      commit: { stage: "phase-plan", subject: `PLAN plan ${phaseTitle(phase)}` },
      reset: () => resetPlanning(directory, phase),
      collect: async () => {
        const checked = await plannedTaskProblems(directory, phase, { before: taken, numberStart })
        problems = checked.problems
        return problems.length ? undefined : checked.ids
      },
    },
  )
  if (!Array.isArray(planned)) {
    if (planned.type === "dirty") {
      log(`⏸ worktree not clean before starting the phase planning session; handle it manually (commit/clean) and re-run:`)
      for (const file of planned.files) log(`  ${file}`)
    } else {
      log(`⏸ phase planning session blocked (implicit block, investigate and re-run):\n${planned.question}`)
    }
    return 2
  }
  // auto numbering: on planning success the numbering record advances to
  // this run's highest number + 1 (only ever increases); later phases'/rounds'
  // planning sessions continue from the record, so numbers never repeat in
  // the target directory.
  if (numberStart !== undefined) {
    const next = await advanceNextTask(directory, planned)
    log(`✓ numbering record advanced: next available task number T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
  }
  log(`✓ phase planning complete: ${taskIndex} lists ${planned.length} task(s)`)
  ctx.planned = planned
  // close-out: delete this step's driver-side resume point (artifacts
  // validated, commit and numbering advance both done). Killed before this →
  // the record is still active, and the next run re-enters planning through
  // openStep and reuses the session.
  await closeStep(directory, "phase-plan", phaseKey(phase).id)
  return 0
}

// The phased planning prompt: phase-plan over the project brief, the planning
// input, the earlier phases' handovers, the previous round's conclusions (the
// round's first planning session only) and the round brief.
async function phasePlanPrompt(
  ctx: LoopCtx,
  phase: PhaseUnit,
  parts: { brief?: string; input?: string; taskIndex: string; phaseId: string; numberStart?: number },
): Promise<string> {
  const { directory, opts } = ctx
  const state = await phaseState(directory)
  // Earlier phases' handovers (injection discipline): only the distilled
  // handovers are injected, never the earlier phases' raw docs/. Each done phase
  // that precedes this one in the phase index is appended in order; the handover
  // is the permanent P<nn>-<type>/handover.md in the phase directory, and a phase
  // without one is listed as "(no handover document)".
  const handovers = await earlierHandovers(directory, phase, state)
  // Extra injection for the round's first planning session: ① prior knowledge
  // (the shell's startup distillation of existing migration results,
  // docs/R-NN/prior-kb.md, see src/knowledge.ts); ② the previous round's
  // conclusions (when a previous round directory exists). Later phases follow the
  // handover chain and get neither again.
  // "First" = no completed phase of this round has tasks (plans/0049 G4): a
  // leading task-less knowledge phase has no planning session and must not
  // swallow the digest.
  // The digest cap: above a quarter of the run's context limit (estimated by
  // the same token estimate the usage source uses), the prompt gets the index
  // form instead of the full texts — the path and size of each knowledge
  // document and handover, the session opening what it needs — still through
  // the prevRound slot. The sizes are booked per planning session either way,
  // so the memory-service question has its data.
  let prevRound: string | undefined
  if (!state.phases.some((unit) => state.done.has(unit.id) && unit.entry.hasTasks)) {
    const prior = (await priorKnowledgeDigest(directory))?.trim() || undefined
    const prev = (await prevRoundDigest(directory))?.trim() || undefined
    const parts = [prior, prev].filter((part): part is string => part !== undefined)
    const joined = parts.length ? parts.join("\n\n") : undefined
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
  // The round brief docs/R-NN/round.md (plans/0049 G3): every planning session
  // plans against the round's goal and criteria; an untouched stub injects nothing.
  const round = await roundBriefText(directory, state.round)
  return renderPhasePlan(planFacts(ctx), {
    phase: phase.entry,
    planDuties: planDuties(ctx, phase.entry),
    phaseId: parts.phaseId,
    taskIndex: parts.taskIndex,
    brief: parts.brief,
    round,
    input: parts.input,
    inputPath: planInputPath(phase),
    handovers,
    prevRound,
    mode: opts.mode,
    // No analysis/design phase delivered in this round's index → the implement
    // phase's planning gets the pipeline-trimming note. A closed analysis/design
    // phase (plans/0053 D16: done for scheduling, not delivered) counts as absent.
    trimmedPhases: !state.phases.some((unit) => (unit.type === "analysis" || unit.type === "design") && !state.closed.has(unit.id)),
    numberStart: parts.numberStart,
    parallel: opts.parallel,
  })
}

// Phase planning plus the plan-review pause (plans/0049 G5): at
// OPENCODE_AUTO_STEP ≥ phase the run holds after the planning commit, before
// the first task, so tasks.md and the task documents can be reviewed; /exit
// takes effect at the same point. Under plan's stop condition (plans/0053 D6)
// the run ends here instead, and that stop is the review point: the summary
// replaces the pause, and the caller returns.
export async function planWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const code = await planPhase(ctx, phase)
  if (code !== 0) return code
  if (ctx.opts.stopBefore === "execute") {
    for (const line of plannedLines(ctx.directory, phase, ctx.planned ?? [], ctx.manual)) log(line)
    return 0
  }
  await stepPause("phase", `phase ${phaseTitle(phase)} planning`, { interactive: ctx.repl, dir: ctx.directory })
  // /exit checkpoint (phase boundary): the request flag lives in the run's
  // control service on ctx, as the router state does.
  ctx.control.maybeExit("phase", `phase ${phaseTitle(phase)} planning`)
  return 0
}

// —— Append planning (plans/0053 D23–D25) ——

// The earlier phases' distilled handovers in index order, one block per done
// phase that precedes `phase` (the injection discipline: only distilled
// handovers, never the earlier phases' raw docs/). Shared by the planning and
// appending prompts, so both sessions see the same chain.
async function earlierHandovers(directory: string, phase: PhaseUnit, state: PhaseState): Promise<string> {
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

// What an appending session builds on, read from disk at step entry (plans/0053
// F1: the tree is clean at HEAD there — preflight guaranteed it — so disk is
// the committed state). Tasks a person committed mid-append count as existing
// on re-entry: the re-entry snapshot includes them, and only the entries after
// them are checked (D24's residual).
export type AppendSnapshot = {
  // Repository-relative path of the phase's task index.
  index: string
  // The index text as it stands at step entry.
  text: string
  entries: IndexEntry[]
  // Per existing task id: the text of the state file(s) that exist (exactly
  // one per task in a valid index); a missing key = the file was absent.
  files: Map<string, { pending?: string; complete?: string }>
}

// Read the append snapshot of a phase whose index already lists tasks.
export async function snapshotAppend(dir: string, phase: PlanPhase): Promise<AppendSnapshot> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text()
  const entries = parseIndex(text, "task").entries
  const files = new Map<string, { pending?: string; complete?: string }>()
  for (const entry of entries) {
    const paths = taskStatePaths(entry.id)
    const pending = await Bun.file(join(dir, paths.pending)).text().catch(() => undefined)
    const complete = await Bun.file(join(dir, paths.complete)).text().catch(() => undefined)
    files.set(entry.id, { ...(pending !== undefined ? { pending } : {}), ...(complete !== undefined ? { complete } : {}) })
  }
  return { index, text, entries, files }
}

// The append collect (plans/0053 D24): problems of what an appending session
// wrote onto a phase whose index already listed tasks (empty problems and the
// appended ids = accepted). The existing prefix is fixed — index lines and
// task documents alike — and only the entries after it are the session's
// output, each checked by the per-task rules (newTaskProblems, `before` =
// taken ∪ snapshot ids), with the whole index's dependency graph re-checked
// (the existing decls come from the snapshot texts, so an edited document is
// caught by the file-identity check, not silently re-validated).
export async function appendProblems(
  dir: string,
  phase: PlanPhase,
  snap: AppendSnapshot,
  opts: { before: ReadonlySet<string>; numberStart?: number },
): Promise<{ problems: string[]; ids: string[] }> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return { problems: [`${index} is missing`], ids: [] }
  const parsed = parseIndex(text, "task")
  const problems = parsed.problems.map((problem) => `${index} ${problem}`)
  const entries = parsed.entries
  const prefix = snap.entries
  // The first *n* entries equal the snapshot's, in order, with their lines
  // unchanged (compared through the parser's view — id, title, tick — which is
  // the shape the driver guarantees; anything a session may do to an existing
  // line shows up in one of the three).
  let prefixHolds = true
  if (entries.length < prefix.length) {
    problems.push(`${index} lists ${entries.length} task(s) but held ${prefix.length} before the append; existing lines are fixed — append after them, never remove one`)
    prefixHolds = false
  } else {
    for (let i = 0; i < prefix.length; i++) {
      const was = prefix[i]!
      const now = entries[i]!
      if (now.id !== was.id) {
        problems.push(`${index} line ${now.line}: ${now.id} sits where ${was.id} sat; existing lines are fixed — append after the last existing line, never reorder or replace`)
        prefixHolds = false
        break
      }
      if (now.title !== was.title || now.ticked !== was.ticked) {
        problems.push(`${index} line ${now.line}: the existing line of ${was.id} was edited; existing lines are fixed — append only`)
        prefixHolds = false
        break
      }
    }
  }
  // At least one new entry follows the snapshot prefix.
  const fresh = prefixHolds ? entries.slice(prefix.length) : []
  if (prefixHolds && !fresh.length) {
    problems.push(`${index} gained no new task; the append must add at least one (a line \`- [ ] T-NNN <task title>\` after the existing ones)`)
  }
  // No existing task's state file changed: per snapshot id, the file that
  // existed holds exactly the snapshotted text and the other one is still
  // absent (a created done.md would both edit the set and break the index).
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
      if (was === undefined && now !== undefined) {
        problems.push(`${paths[key]} of the existing task ${id} is new; an append never touches an existing task's state files`)
      } else if (was !== undefined && now !== was) {
        problems.push(`${paths[key]} of the existing task ${id} was changed or removed; an append never edits an existing task's document`)
      }
    }
  }
  // The per-task checks over the appended entries; the dependency graph of the
  // whole index runs once every entry has a decl (the prefix decls from the
  // snapshot texts, the fresh ones from the per-task read).
  const decls: UnitDecl[] = []
  let complete = prefixHolds
  for (let i = 0; i < prefix.length && complete; i++) {
    const entry = entries[i]!
    const files = snap.files.get(entry.id)
    const doc = files ? (files.pending ?? files.complete) : undefined
    if (doc === undefined) complete = false
    else decls.push(taskDecl(entry.id, doc))
  }
  for (const entry of fresh) {
    const checked = await newTaskProblems(dir, phase, entry.id, opts)
    problems.push(...checked.problems)
    if (checked.decl) decls.push(checked.decl)
    else complete = false
  }
  if (complete && decls.length === entries.length) {
    problems.push(...unitProblems("task", decls, { external: await doneTaskIds(dir) }).map((problem) => `${index}: ${problem}`))
  }
  return { problems, ids: fresh.map((entry) => entry.id).filter((id) => isUnitId("task", id)) }
}

// Restore the snapshot before each fresh attempt (plans/0053 D24): write the
// snapshot index text back, restore any changed existing task file (and remove
// a state file the snapshot does not have), and remove the task directories of
// index ids that are neither in the snapshot nor taken elsewhere — an id
// listed by another phase's index, or already done, belongs to that other
// unit, so its directory is never removed however it got listed here.
// requireArtifact skips this when a reused session resumes: the worktree is
// then the session's own progress, not stale output.
export async function resetAppend(dir: string, phase: PlanPhase, snap: AppendSnapshot): Promise<void> {
  const file = join(dir, snap.index)
  const current = await Bun.file(file).text().catch(() => undefined)
  const snapIds = new Set(snap.entries.map((entry) => entry.id))
  if (current !== undefined) {
    const taken = await takenTaskIds(dir, phase)
    for (const entry of parseIndex(current, "task").entries) {
      if (snapIds.has(entry.id) || taken.has(entry.id)) continue
      await rm(join(dir, "docs", entry.id), { recursive: true, force: true })
    }
  }
  if (current !== snap.text) await Bun.write(file, snap.text)
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      if (was === undefined) {
        await rm(join(dir, paths[key]), { force: true })
      } else {
        const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
        if (now !== was) await Bun.write(join(dir, paths[key]), was)
      }
    }
  }
}

// The appending session (plans/0053 D23–D25): the planner that adds tasks to
// a phase whose index already lists some, over the persisted planning input
// (an append always has one: --append without input is refused up front, and
// this backstop catches a deleted plan-input.md). Modeled on planPhase and
// sharing its machinery — the numbering record, the input commit, the step
// resume point — with the snapshot → reset → collect cycle in place of the
// fresh planning output check. Returns 0 = append complete, 1 = no planning
// input, 2 = blocked.
// AUTO-DECISION: no spec.role is declared (either mode) — phaseToRole already
// maps the phase-append step to the phase-plan model role (D23/F6), and the
// append template is new surface, so no legacy implement-scan routing applies
// to it; declaring one would only fork the mapping.
export async function appendPlan(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  // Appending plans against a planning input, checked first so a missing one
  // starts no numbering-restore session (the prelude and the shell check this
  // first; this backstops other shells and a deleted input file).
  if (!ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to append ${phaseTitle(phase)} against: appending plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // auto numbering: same as planPhase (a missing record is restored first, a
  // blocked restore exits 2).
  let numberStart: number | undefined
  if (opts.autoNumber) {
    const numbering = await ensureNumbering(serverHandle, directory, sessionOpts(ctx, { site: "append-numbering" }))
    if (numbering.type === "dirty") {
      log(`⏸ worktree not clean before restoring the numbering record; handle it manually (commit/clean) and re-run:`)
      for (const file of numbering.files) log(`  ${file}`)
      return 2
    }
    if (numbering.type === "blocked") {
      log(`⏸ numbering-record restore session blocked (implicit block, investigate and re-run):\n${numbering.question}`)
      return 2
    }
    numberStart = numbering.next
  }
  // The planning input (D9), exactly as in planPhase: a new text is persisted
  // and committed before the unit starts; a different text restarts an open
  // step in a new session, so no reused session plans against a text it never
  // saw. An append overwrites the phase's file — the latest input wins.
  let restart: string | undefined
  if (ctx.input) {
    const saved = await savePlanInput(directory, phase, ctx.input, phaseTitle(phase))
    if (saved.type === "dirty") {
      log(`⏸ worktree not clean before saving the planning input; handle it manually (commit/clean) and re-run:`)
      for (const file of saved.files) log(`  ${file}`)
      return 2
    }
    if (saved.type === "failed") {
      log(`⏸ ${saved.question}`)
      return 2
    }
    ctx.input = undefined
    if (saved.type === "saved") {
      log(`✓ planning input saved to ${planInputPath(phase)}`)
      restart = "the planning input changed"
    }
  }
  const input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input && !restart) log(`ℹ appending against the persisted input ${planInputPath(phase)}`)
  // The append builds on an index that lists tasks; a re-entered step whose
  // index has gone missing (deleted by hand between runs) is an anomaly to
  // surface, not an empty snapshot to append onto.
  const taskIndex = taskIndexPath(phase)
  if (!(await Bun.file(join(directory, taskIndex)).exists())) {
    log(`⏸ ${taskIndex} is missing: the task-append step of ${phaseTitle(phase)} has no task index to append to (deleted by hand?); restore it or list tasks there, then re-run`)
    return 1
  }
  // The snapshot (D24): taken at step entry from disk, which preflight's clean
  // gate left at HEAD. On re-entry it includes whatever was committed meanwhile
  // (D24's residual), so a person's mid-append commit counts as existing work.
  const snap = await snapshotAppend(directory, phase)
  const plan = await loadPlan(directory, phase)
  // taken numbers = other phases' indexes and done tasks ∪ this phase's
  // existing entries (D24); without auto numbering, the prompt's numbering
  // start is the highest number among them + 1 (D25: the highest taken or
  // listed id + 1).
  // AUTO-DECISION: the collect enforces the numbering start only under
  // autoNumber (the record's value), exactly as planPhase does — without the
  // record only collisions with taken or listed ids are refused, so a gap id
  // the session picks below the prompt's start stays acceptable, as in planning.
  const taken = await takenTaskIds(directory, phase)
  const before = new Set([...taken, ...snap.entries.map((entry) => entry.id)])
  const listed = Math.max(0, ...[...before].map((id) => taskNumber(id) ?? 0)) + 1
  const promptStart = numberStart ?? listed
  // The project brief, comments stripped: an untouched stub injects nothing.
  const brief = await projectBriefText(directory)
  const phaseId = qualifiedPhase(phase)
  const prompt = ctx.manual
    ? renderPhaseAppend(planFacts(ctx), {
        phaseId,
        taskIndex,
        numberStart: promptStart,
        input: input!,
        inputPath: planInputPath(phase),
        existingTasks: existingTaskList(plan.tasks),
        brief,
        parallel: opts.parallel,
      })
    : await phaseAppendPrompt(ctx, phase, { brief, input: input!, taskIndex, phaseId, numberStart: promptStart, existingTasks: existingTaskList(plan.tasks) })
  // The consistency gate, the append side (plans/0080 §5): an append plans
  // against a human input too — plan --append or a repair round's evidence —
  // so its composed prompt is verified the same way before its session runs.
  const verified = await verifyPlanStep(ctx, phase, `phase-append ${phaseKey(phase).id}`, prompt)
  if (verified !== 0) return verified
  let problems: string[] = []
  log(`▶ starting the task-append session to append to ${taskIndex}`)
  const appended = await requireArtifact(
    serverHandle,
    { id: "PLAN", title: `phase append (${phaseTitle(phase)})`, status: "in_progress", attempts: 0, body: "" },
    prompt,
    sessionOpts(ctx, { site: "phase-append" }),
    {
      kind: "task appending",
      step: { step: "phase-append", unit: phaseKey(phase).id },
      restart,
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out
      // check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `new task lines appended to ${taskIndex} with their task documents (at least one new task)`,
      detail: "no new task, an existing line or task document changed, or a task number reusing a taken number",
      get requirement() {
        return (
          `append new task lines after the existing ones of ${taskIndex} (one per task, \`- [ ] T-NNN <task title>\`, at least one) ` +
          `and each new task's docs/T-NNN/todo.md (title line \`# T-NNN: <task title>\`, field line \`Phase: ${phaseId}\`, ` +
          `the three sections \`## Goal\` / \`## Scope\` / \`## Acceptance\`, last line \`<!-- auto: eof -->\`), ` +
          `without changing any existing index line or task document.` +
          (problems.length ? ` Problems last time: ${problems.join("; ")}.` : "")
        )
      },
      commit: { stage: "phase-append", subject: `PLAN append ${phaseTitle(phase)}` },
      reset: () => resetAppend(directory, phase, snap),
      collect: async () => {
        const checked = await appendProblems(directory, phase, snap, { before, numberStart })
        problems = checked.problems
        return problems.length ? undefined : checked.ids
      },
    },
  )
  if (!Array.isArray(appended)) {
    if (appended.type === "dirty") {
      log(`⏸ worktree not clean before starting the task-append session; handle it manually (commit/clean) and re-run:`)
      for (const file of appended.files) log(`  ${file}`)
    } else {
      log(`⏸ task-append session blocked (implicit block, investigate and re-run):\n${appended.question}`)
    }
    return 2
  }
  // auto numbering: on append success the numbering record advances to this
  // run's highest new number + 1 (only ever increases).
  if (numberStart !== undefined) {
    const next = await advanceNextTask(directory, appended)
    log(`✓ numbering record advanced: next available task number T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
  }
  log(`✓ task append complete: ${taskIndex} gained ${appended.length} task(s)`)
  ctx.planned = appended
  // Stale handover (plans/0053 D25/F13): a phase that was already distilled
  // has a handover.md that predates the appended tasks — the phase is
  // distilled again after they run, so the stale document goes now, in its own
  // commit; acceptance.md and verdict.md stay (the next distillation redrafts
  // the first, the new tasks may rewrite the second).
  const handover = phaseHandoverDoc(phase)
  if (await Bun.file(join(directory, handover)).exists()) {
    await rm(join(directory, handover))
    // The run's git seam carries the strategy: on the no-commit double the
    // ok answer keeps the failure branch dead (the removal itself still
    // happens, as the rename does in the prior-knowledge close-out).
    const settled = await ctx.git.commitTree(directory, { id: "PLAN", title: `phase append (${phaseTitle(phase)})` }, {
      stage: "phase-append",
      subject: `PLAN append ${phaseTitle(phase)}: remove the stale handover`,
    })
    if (!settled.ok) {
      log(
        `⏸ stale-handover removal commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The deletion is kept in the worktree; commit manually and re-run (the append step re-enters idempotently)`,
      )
      return 2
    }
    log(`✓ stale handover removed: ${handover} (the phase is distilled again after the appended tasks)`)
  }
  // close-out: delete this step's driver-side resume point, the last step
  // (D25) — killed before this → the record is still active, and the next run
  // re-enters the append through openStep (idempotent). Known residual: if
  // the kill lands after the append unit's commit and before the close-out,
  // the re-entry snapshot already contains the committed appended tasks, and
  // the redo appends another batch (a residual the design accepts; plan stops
  // for human review, the duplication is visible and editable).
  await closeStep(directory, "phase-append", phaseKey(phase).id)
  return 0
}

// The phased appending prompt: phase-append over the project brief, the
// planning input, the earlier phases' handovers and the round brief (the
// existing tasks and the phase naming come with the shared template).
async function phaseAppendPrompt(
  ctx: LoopCtx,
  phase: PhaseUnit,
  parts: { brief?: string; input: string; taskIndex: string; phaseId: string; numberStart: number; existingTasks: string },
): Promise<string> {
  const { directory, opts } = ctx
  const state = await phaseState(directory)
  return renderPhaseAppend(planFacts(ctx), {
    phase: phase.entry,
    planDuties: planDuties(ctx, phase.entry),
    phaseId: parts.phaseId,
    taskIndex: parts.taskIndex,
    numberStart: parts.numberStart,
    input: parts.input,
    inputPath: planInputPath(phase),
    existingTasks: parts.existingTasks,
    brief: parts.brief,
    round: await roundBriefText(directory, state.round),
    handovers: await earlierHandovers(directory, phase, state),
    mode: opts.mode,
    parallel: opts.parallel,
  })
}

// Task appending plus the same stop handling as planWithStep (plans/0053 D6):
// under plan's stop condition the summary — over the appended ids — is the
// review point; under run the G5 pause applies as after a planning step.
export async function appendWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const code = await appendPlan(ctx, phase)
  if (code !== 0) return code
  if (ctx.opts.stopBefore === "execute") {
    for (const line of plannedLines(ctx.directory, phase, ctx.planned ?? [], ctx.manual)) log(line)
    return 0
  }
  await stepPause("phase", `phase ${phaseTitle(phase)} append`, { interactive: ctx.repl, dir: ctx.directory })
  // /exit checkpoint (phase boundary): the request flag lives in the run's
  // control service on ctx, as the router state does.
  ctx.control.maybeExit("phase", `phase ${phaseTitle(phase)} append`)
  return 0
}
