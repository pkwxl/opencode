// Phase loop (--phases): the phase handover (handoverPhase and its step wrapper
// handoverWithStep) and the phase routing loop (runPhaseLoop), runAll's former
// closures as top-level functions with their captures made explicit as LoopCtx
// (defined in ./loop-task). Phase planning lives in ./loop-plan (plans/0053 A2).
// Split out of src/loop.ts (plans/0024-module-split-plan.md S16, pure move). Does not depend on loop.ts.
import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { requireArtifact } from "./artifact"
import { briefProposal, BRIEF_FILE } from "./brief"
import { phaseCloseLines, phaseResolveLines, roundCompleteLines, roundResolveLines } from "./conclusion"
import { acceptanceMark, ACCEPTED_MARK, constraintPitfallResolves, HANDOVER_SECTIONS, validHandover } from "./document/roles"
import { reportForUserPath } from "./docpaths"
import { allowWrite, reprotect } from "./protect"
import { hibernatePause } from "./hibernate"
import { extractKnowledge } from "./knowledge"
import { banner, log } from "./log"
import { sessionOpts } from "./opts"
import { appendPlan, appendWithStep, phaseState, phaseTitle, planWithStep } from "./loop-plan"
import { runTaskLoop, type LoopCtx } from "./loop-task"
import {
  CLARIFIED_MARK,
  completePhase,
  phaseAcceptanceDoc,
  phaseGateProblems,
  phaseGates,
  phaseHandoverDoc,
  phaseKey,
  phaseSurveyDoc,
  phaseVerdictDoc,
  routePhase,
  type PhaseUnit,
} from "./phases"
import { emptyIndexNotice, executeNotice, roundCompleteNext } from "./plan"
import { planInputPath, readPlanInput } from "./plan-input"

import { openBlockage } from "./blockage-diagnose"
import { clampLine, clampedItemsOf } from "./charter-clamp"
import { renderPhaseHandover } from "./prompt"
import { verifyAuditEntry, verifyPlanPrompt } from "./prompt-verify"
import { repairDutiesText, withIntentParagraph } from "./prompt-plan"
import { promptFacts } from "./prompt-facts"
import { REPORT_TASK_TITLE, reportAppendInput } from "./round-report"
import { emitStatus } from "./run-status"
import { roundCloseLines, roundCloseProblems } from "./round-close"
import { closeStep, openStep } from "./resume"
import { autoSwitches } from "./switches"
import { shellProfile } from "./shell"
import { statsPhase } from "./stats"
import { stepPause } from "./step"
import { loadPlan } from "./tasks"

// phase handover (§F, docs never move): ① the distillation session (the AI's
// only duty, a one-off bypass) produces the permanent handover document
// docs/R-NN/P<nn>-<type>/handover.md inside the phase directory (settled, it
// never moves) → ② phase completion (completePhase: todo.md → done.md + index
// tick; the phase directory is the archive, no snapshot, no reset, M3.4) →
// ③ the unified commit (Auto-Stage: phase-transition). Each step is
// idempotent: after an interruption the phase is still incomplete and its
// tasks all done, the route is handover as before, and with the handover
// document already complete the distillation is skipped and ②③ are made up
// directly (C.2). Returns 0 = handover complete, or a repair round appended
// under a --repair budget (plans/0079 §4 — the phase is not done; the loop
// re-derives the execute route for the appended tasks and hands over again
// when they close); 2 = the distillation session implicitly blocked, or a
// gate holds with no budget or a refused repair.
export async function handoverPhase(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  const state = await phaseState(directory)
  const following = state.phases[state.phases.findIndex((unit) => unit.id === phase.id) + 1]
  const next = following ? phaseTitle(following) : undefined
  const target = next ?? "flow complete"
  banner(`phase handover: ${phaseTitle(phase)} → ${target}`)
  // the phase directory is created at the round's start; the handover
  // document is not on the protect list, no allowWrite needed.
  const handover = phaseHandoverDoc(phase)
  const handoverFile = join(directory, handover)
  await mkdir(dirname(handoverFile), { recursive: true })
  // Phase gates (plans/0049 G7). With the acceptance gate on, the distillation
  // also drafts acceptance.md for the human to sign; the draft must never carry
  // an `Accepted:` line, which only a human writes.
  const gates = phaseGates(phase, opts.acceptanceGate)
  const acceptance = gates.includes("acceptance") ? phaseAcceptanceDoc(phase) : undefined
  const acceptanceFile = acceptance ? join(directory, acceptance) : undefined
  // fresh = the output of this distillation session: it must not be signed. An
  // existing draft on the idempotent skip path may carry the human's sign-off.
  const draftProblem = async (fresh: boolean): Promise<string | undefined> => {
    if (!acceptance) return undefined
    const text = await Bun.file(acceptanceFile!).text().catch(() => undefined)
    if (text === undefined) return `${acceptance} is missing`
    if (fresh && acceptanceMark(text).present) return `${acceptance} carries an \`Accepted:\` line; only the human reviewer writes it — remove it`
    if (!text.split("\n").some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()))) return `${acceptance} has no content`
    return undefined
  }
  // idempotent distillation skip + ③ make-up commit
  // (plans/0021-commit-boundary-design.md P4): with the handover document
  // already complete (the four sections validated by validHandover) the
  // distillation session is not reopened — a scene where the last
  // interruption landed inside the "distillation produced, driver not closed
  // out" interval resumes the snapshot/completion rename directly; if the
  // document is still on the uncommitted list, the make-up commit runs first
  // (an artifact counts as done only when on disk and committed). Partly
  // written (sections incomplete) goes through distillation as usual: reset
  // clears the file to start over, and the step resume point (openStep) can
  // still reuse the original session to continue writing.
  const distillTask = { id: "PLAN", title: `phase handover distillation (${phaseTitle(phase)})`, status: "in_progress" as const, attempts: 0, body: "" }
  const distillCommit = { stage: "phase-handover", subject: `PLAN handover ${phaseTitle(phase)}` }
  // The handover collect's two mechanical gates (plans/0082 §10 D13/D14a):
  // the OPEN-status lint (an AUTO-RESOLVE marker under "Constraints and
  // pitfalls" is status laundering — the item is an open decision, never a
  // constraint) and the write-time charter check (one verifier call over the
  // charter and the handover, the prompt-destined text; INCONSISTENT or
  // FAILED re-dists once with the verdict, then fails closed — where the
  // blockage machinery owns the person's decision).
  let collectIssue: string | undefined
  const lintHandover = constraintPitfallResolves
  const writeTimeGate = async (text: string): Promise<string | undefined> => {
    const outcome = await verifyPlanPrompt({ pool: ctx.server, routing: ctx.routing, facts: promptFacts(sessionOpts(ctx, { site: "handover" })), step: `handover ${phaseKey(phase).id}`, prompt: text })
    if (outcome.kind === "inactive" || outcome.kind === "skipped" || outcome.kind === "consistent") return undefined
    // Record the verdict beside the plan-step verdicts it precedes (the
    // audit's charter covers every composition judgment of the round).
    // The round's audit sits beside the phase directory (loop-plan's
    // convention): dirname(phase.dir) is the round root docs/R-NN.
    const audit = join(dirname(phase.dir), "prompt-audit.md")
    const previous = await Bun.file(join(directory, audit)).text().catch(() => "")
    await Bun.write(
      join(directory, audit),
      `${previous.trim() ? `${previous.trimEnd()}\n` : "# Prompt-audit record (plans/0080 §5): every plan-step consistency verdict of this round\n\n"}${verifyAuditEntry(`handover ${phaseKey(phase).id}`, outcome)}\n`,
    )
    const settled = await ctx.git.commitTree(directory, { id: "PLAN", title: `handover verification (${phaseTitle(phase)})` }, { stage: "prompt-audit", subject: `PLAN prompt-audit handover ${phaseKey(phase).id}` })
    if (!settled.ok) log(`⚠ the handover charter-check record could not be committed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}; commit ${audit} manually`)
    return outcome.kind === "inconsistent"
      ? `the charter check found the handover inconsistent with the intent charter: ${outcome.evidence}`
      : `the charter check could not judge the handover: ${outcome.reason}`
  }
  if (validHandover(await Bun.file(handoverFile).text().catch(() => "")) && !(await draftProblem(false))) {
    const skipText = await Bun.file(handoverFile).text().catch(() => "")
    const skipLint = validHandover(skipText) && !(await draftProblem(false)) ? lintHandover(skipText) : undefined
    collectIssue = skipLint ?? (await writeTimeGate(skipText)) ?? undefined
    if (collectIssue !== undefined) {
      // A complete-looking handover that fails the write-time check (D14a):
      // the phase stays on its handover route and the blockage machinery
      // owns the person's decision instead of a raw stop.
      const result = await openBlockage(
        {
          directory,
          gate: "handover-verify",
          step: `handover ${phaseKey(phase).id}`,
          verdict: `INCONSISTENT — ${collectIssue}`,
          evidence: collectIssue,
          blockMap: [{ block: "handover", source: handover }],
          auditTail: [],
          intro: `⏸ the handover verification found ${handover} inconsistent with the intent charter: ${collectIssue}`,
          next: "  rewrite the located file, or amend the intent — the driver never rewrites your words",
        },
        { server: serverHandle, opts: sessionOpts(ctx, { site: "diagnosis" }), ...(ctx.repl ? { repl: ctx.repl } : {}) },
      )
      for (const line of result.lines) log(line)
      return 2
    }
    const pending = await ctx.git.commitPending(directory, opts, distillTask, distillCommit, acceptance ? [handover, acceptance] : [handover])
    if (pending !== "clean") {
      if (!pending.ok) {
        log(`⏸ handover document make-up commit failed: ${pending.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}, handle it manually and re-run`)
        return 2
      }
      log(`✓ handover document produced but not yet committed; make-up commit done: ${handover}`)
    }
    log(`↻ handover document ${handover} is complete; skipping the distillation session, going straight to archiving`)
  } else {
    log(`▶ starting the handover distillation session to produce ${handover}${acceptance ? ` and the acceptance draft ${acceptance}` : ""}`)
    // The phase's closed tasks are listed for the distillation as not delivered (plans/0053 D16); the route already
    // validated the index, so a load failure only drops the list (an index-less phase has no tasks).
    const plan = await loadPlan(directory, phase).catch(() => undefined)
    const closedTasks = plan?.tasks.flatMap((task) => (task.closed === undefined ? [] : [{ id: task.id, title: task.title, reason: task.closed }]))
    let draftIssue: string | undefined
    const distilled = await requireArtifact(
      serverHandle,
      distillTask,
      renderPhaseHandover(promptFacts(sessionOpts(ctx, { site: "handover" })), { phase: phase.entry, handover, next, acceptance, closedTasks }),
      sessionOpts(ctx, { site: "handover" }),
      {
        kind: "handover distillation",
        step: { step: "phase-handover", unit: phaseKey(phase).id },
        // Independent hidden task unit: entry clean gate + SHA baseline + close-out
        // check (plans/0021-commit-boundary-design.md; a partly written handover is
        // cleared by reset and rewritten).
        unitStart: true,
        artifact: `a valid handover document ${handover} (all four mandatory sections)${acceptance ? ` and an acceptance draft ${acceptance}` : ""}`,
        detail: acceptance ? "missing, sections incomplete, or the acceptance draft missing, empty or signed" : "missing or sections incomplete",
        get requirement() {
          return (
            `write the handover document to ${handover} with four sections whose headings are exactly ` +
            `${HANDOVER_SECTIONS.map((section) => `\`${section}\``).join(" / ")} (driver protocol strings, write them verbatim).` +
            (acceptance ? ` Also write the acceptance draft ${acceptance} for the human reviewer, without any \`Accepted:\` line.` : "") +
            (draftIssue ? ` Problem last time: ${draftIssue}.` : "") +
            (collectIssue ? ` Problem last time: ${collectIssue}.` : "")
          )
        },
        commit: distillCommit,
        // The acceptance draft is not reset: on a rejected phase it holds the
        // reviewer's notes, which the new draft must keep.
        reset: () => rm(handoverFile, { force: true }),
        collect: async () => {
          const text = await Bun.file(handoverFile).text().catch(() => "")
          draftIssue = await draftProblem(true)
          const lint = validHandover(text) && !draftIssue ? lintHandover(text) : undefined
          const writeTime = lint === undefined && validHandover(text) && !draftIssue ? await writeTimeGate(text) : undefined
          collectIssue = lint ?? writeTime
          return (validHandover(text) && !draftIssue && collectIssue === undefined) || undefined
        },
      },
    )
    if (distilled !== true) {
      if (distilled.type === "dirty") {
        log(`⏸ worktree not clean before starting the handover distillation session; handle it manually (commit/clean) and re-run:`)
        for (const file of distilled.files) log(`  ${file}`)
      } else if (collectIssue !== undefined) {
        // Fail-closed after one re-distill (D14a): Part I's remediation owns
        // the decision instead of a raw blockage.
        log(`⏸ handover distillation failed closed on the charter check after one re-distill`)
        const result = await openBlockage(
          {
            directory,
            gate: "handover-verify",
            step: `handover ${phaseKey(phase).id}`,
            verdict: `INCONSISTENT — ${collectIssue}`,
            evidence: collectIssue,
            blockMap: [{ block: "handover", source: handover }],
            auditTail: [],
            intro: `⏸ the handover verification found ${handover} inconsistent with the intent charter after one re-distill: ${collectIssue}`,
            next: "  rewrite the located file, or amend the intent — the driver never rewrites your words",
          },
          { server: serverHandle, opts: sessionOpts(ctx, { site: "diagnosis" }), ...(ctx.repl ? { repl: ctx.repl } : {}) },
        )
        for (const line of result.lines) log(line)
      } else {
        log(`⏸ handover distillation session blocked (implicit block, investigate and re-run):\n${distilled.question}`)
      }
      return 2
    }
  }
  // close-out: the distillation session (this step's only AI part) has
  // produced a valid handover document and committed it, so the driver-side
  // resume point is deleted. The completion rename and commit after it are
  // idempotent driver bookkeeping; a re-run after an interruption completes
  // them through the handover-complete skip above, no longer relying on
  // session recovery.
  await closeStep(directory, "phase-handover", phaseKey(phase).id)
  // The round-report self-heal (plans/0081 D4) runs before the completion
  // rename, only with every gate passing: a report task appended under a
  // held gate would run before the phase may complete anyway. completePhase
  // re-checks the gates it renames through; nothing moves between the two
  // reads (the driver alone writes here).
  const preGate = await phaseGateProblems(directory, phase, gates)
  if (!preGate.length) {
    const healed = await ensureRoundReport(ctx, phase, state)
    if (healed === 0) return 0
    if (healed === 2) return 2
  }
  const gated = preGate.length ? preGate : await completePhase(directory, phase, gates)
  if (gated.length) {
    // The repair round (plans/0079 §4): a held verdict gate with budget left
    // appends repair tasks over the gate evidence instead of stopping — the
    // appending session runs here (appendPlan: the stale handover this
    // distillation just wrote is removed per 0053 D25), the loop then
    // re-derives the execute route for the appended tasks, and when they are
    // done the phase distills again and the gate re-checks the rewritten
    // verdict. Acceptance gates never repair — `Accepted: yes` is the human's
    // alone; a failed append falls through to the gate stop.
    if (ctx.opts.stopBefore !== "execute" && (ctx.opts.repair ?? 0) > ctx.repairs && gated.some((problem) => problem.startsWith("verdict"))) {
      ctx.repairs++
      log(`↻ repair round ${ctx.repairs}/${ctx.opts.repair}: the verdict gate holds ${phaseTitle(phase)} — appending repair tasks over the gate evidence`)
      ctx.input = {
        text:
          `Repair round ${ctx.repairs}: the phase ${phaseTitle(phase)} is held by its verdict gate — ${gated.join("; ")}. ` +
          `The verdict document docs/${phaseVerdictDoc(phase)} records why. Read it, then append repair tasks that fix what it found and ` +
          `re-run the verification so the verdict document is rewritten with an honest Result line; the phase is distilled again after they run.` +
          // The pack's repair discipline (plans/0080 §6): the boundary that
          // keeps a repair from re-architecting.
          withIntentParagraph(repairDutiesText(promptFacts({ dir: directory, intent: opts.intent }))),
      }
      const code = await appendPlan(ctx, phase)
      ctx.input = undefined
      if (code === 0) return 0
      log(`⏸ the repair append did not complete (exit ${code}); the gate stop follows`)
    }
    logGateStop(directory, phase, gated, acceptance)
    return 2
  }
  // The survey release's other half (plans/0081 D15.2): the person's
  // `Clarified: yes` approved the proposed `## Project brief` section with
  // the forks — the driver installs it now, its own commit through protect.
  if (gates.includes("human")) await installApprovedBrief(ctx, phase)
  // The phase's unit transition (P2b, src/run-status.ts): completePhase's
  // rename (todo.md → done.md inside the phase directory) is the fact; this
  // is the push of the same fact, keyed by the qualified phase id the stats
  // buckets and the fields use. A phase being handed over reads as having
  // been in_progress (the phase index records no runtime status).
  emitStatus({ type: "unit-transition", unit: phaseKey(phase).id, level: "phase", from: "in_progress", to: "done" })
  // the handover commit is the phase unit's close-out booking (completion
  // rename + index tick); commit failure → exit 2 blocked for human
  // attention: the phase is already renamed done, a re-run routes to the
  // next phase, and the leftover uncommitted changes continue once the human
  // has handled them (plans/0021-commit-boundary-design.md P3). The run's
  // git seam carries the strategy: on the no-commit double the ok answer
  // keeps the failure branch dead.
  const settled = await ctx.git.commitTree(directory, { id: "PLAN", title: `phase handover (${phaseTitle(phase)})` }, {
    stage: "phase-transition",
    subject: `PLAN transition ${phaseTitle(phase)} → ${target}`,
  })
  if (!settled.ok) {
    log(
      `⏸ phase handover commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
        `The completion changes are kept in the worktree (the phase is already marked done); commit manually and re-run`,
    )
    return 2
  }
  // the phase boundary's OPEN questions (plans/0082 §10 D12): one line per
  // charter-clamped default of this phase — the person's decision inbox
  // beside the proxy-answer summary.
  for (const item of await clampedItemsOf(directory, "phase", phaseKey(phase).id)) log(clampLine(item, item.clamp ?? ""))
  // the phase proxy-answer summary (plans/0020-auto-resolve-design.md §H-③,
  // H6): pinned above the ■ phase-close line.
  for (const line of await phaseResolveLines(directory, phase)) log(line)
  // the phase-close line (STATS_PLAN §4.3, T-006): after commitTree, before
  // return 0 — the handover commit's duration still lands in this phase's
  // bucket (readings extrapolated live, the currently open segment included).
  const closing = await phaseCloseLines(directory, phase)
  if (closing) for (const line of closing) log(line)
  return 0
}

// A phase gate holds (plans/0049 G7): the phase stays on its handover route,
// and the next run re-checks. The human's ways on — sign, rework through an
// append, or close without the gate — are spelled out here as commands: the
// append removes the stale handover itself (plans/0053 D25) and replans the
// distillation after the fix tasks.
function logGateStop(directory: string, phase: PhaseUnit, problems: string[], acceptance: string | undefined): void {
  const { bin } = shellProfile()
  const awaiting = problems.every((problem) => problem.startsWith("clarification:"))
  const waiting = problems.every((problem) => problem.startsWith("acceptance:"))
  log(`⏸ phase ${phaseTitle(phase)} ${awaiting ? "awaits your clarification" : waiting ? "awaits acceptance" : "is held by its gate"}:`)
  for (const problem of problems) log(`  ${problem}`)
  const handover = phaseHandoverDoc(phase)
  if (awaiting) {
    // The human gate (plans/0081 D14.3): a designed awaiting-person pause, the
    // acceptance gate's control point — done.md waits, and the person's
    // release simultaneously approves the proposed project brief (D15.2).
    const survey = phaseSurveyDoc(phase)
    log(`  to release: review ${survey}, resolve the recorded forks (append your answers beside them, or pass the next phase's planning input with ${bin} plan ${directory} --file <path>)`)
    log(`  then add the line \`${CLARIFIED_MARK}\` to ${survey}, commit, re-run — the phase completes and the approved \`## Project brief\` section is installed`)
  }
  if (acceptance) {
    log(`  to accept: review ${handover} and ${acceptance}, add the line \`${ACCEPTED_MARK}\` to ${acceptance}, commit, re-run`)
  }
  log(
    `  to rework: ${acceptance ? `write your notes in ${acceptance}, ` : ""}append fix tasks with ${bin} plan ${directory} --append -p <text> ` +
      `(the stale handover is removed and distilled again after them)`,
  )
  log(`  to close the phase without its gate: ${bin} close ${phaseKey(phase).id} ${directory} --reason <text>`)
}

// The brief install on survey release (plans/0081 D15.2): the person's
// `Clarified: yes` approves the forks and the proposed `## Project brief`
// section in one act — on release the driver installs that section verbatim
// into .opencode/auto/brief.md, one mechanical copy, a driver-exclusive
// write through protect (D6c), its own commit. Idempotent: an installed
// equal brief writes nothing. A survey released without a proposal installs
// nothing (the seed, an earlier install or the default path's `a`-phase
// proposal remain the brief's sources).
async function installApprovedBrief(ctx: LoopCtx, phase: PhaseUnit): Promise<void> {
  const survey = phaseSurveyDoc(phase)
  const text = await Bun.file(join(ctx.directory, survey)).text().catch(() => "")
  const proposal = briefProposal(text)
  if (proposal === undefined) return
  const target = join(ctx.directory, BRIEF_FILE)
  if ((await Bun.file(target).text().catch(() => "")) === `${proposal}\n`) return
  await allowWrite(target)
  await Bun.write(target, `${proposal}\n`)
  await reprotect(target)
  const settled = await ctx.git.commitTree(ctx.directory, { id: "PLAN", title: `phase handover (${phaseTitle(phase)})` }, {
    stage: "brief-install",
    subject: `PLAN brief install the approved project brief (${phaseTitle(phase)})`,
  })
  if (!settled.ok) {
    log(
      `⚠ the approved project brief was written to ${BRIEF_FILE} but its commit failed: ` +
        `${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Commit manually and re-run`,
    )
    return
  }
  log(`✓ approved project brief installed: ${survey} \`${briefProposalHeading()}\` section → ${BRIEF_FILE}`)
}

// The heading the install names in its log line (briefProposal's own).
function briefProposalHeading(): string {
  return "## Project brief"
}

// The round-report self-heal (plans/0081 D4, §7 A2): when the round's final
// task-bearing phase is about to complete and docs/R-NN/report-for-user.md
// does not exist or is empty, the driver appends exactly one report task
// through the existing append machinery (0079 §4's held-verdict append
// pattern) — which also carries legacy rounds whose final phase was planned
// before the duty landed and a planner that skipped it. Bounded once: a task
// with the mandated title already in the index (this round's earlier heal,
// or the planner's own wrap-up task) never appends again — a report task
// that ran without producing the report is the round-close gate's to block.
// Returns 0 = a report task was appended (the loop re-derives the execute
// route), 1 = nothing to do (not the final phase, the report stands, or the
// bound holds), 2 = the append failed.
async function ensureRoundReport(ctx: LoopCtx, phase: PhaseUnit, state: Awaited<ReturnType<typeof phaseState>>): Promise<number> {
  const last = state.phases.at(-1)
  if (last === undefined || last.id !== phase.id || !phase.entry.hasTasks) return 1
  const report = reportForUserPath(state.round)
  const existing = await Bun.file(join(ctx.directory, report)).text().catch(() => undefined)
  if (existing !== undefined && existing.trim()) return 1
  const plan = await loadPlan(ctx.directory, phase).catch(() => undefined)
  if (plan?.tasks.some((task) => task.title === REPORT_TASK_TITLE)) return 1
  // The durable once-per-round bound: a previous self-heal's append left its
  // input in the phase's plan-input.md (an append overwrites the file, so a
  // later append that replaced it simply re-arms the heal — but two heals in
  // a row cannot happen). A planner that will not comply stops here and the
  // round-close gate blocks for the human instead of looping.
  const priorHeal = (await Bun.file(join(ctx.directory, planInputPath(phase))).text().catch(() => "")).includes("Round report self-heal")
  if (priorHeal) {
    log(`⏸ the round report ${report} is still missing after one report-task append; the phase completes and the round-close gate will block — write the report by hand (ending with the terminator line) or re-plan`)
    return 1
  }
  log(`↻ the round's final phase is completing without ${report}; appending one report task (the person's account of the round, plans/0081 D4)`)
  ctx.input = { text: reportAppendInput(state.round) }
  const code = await appendPlan(ctx, phase)
  ctx.input = undefined
  if (code !== 0) {
    log(`⏸ the report-task append did not complete (exit ${code}); handle what it reported and re-run — the phase stays open until the report exists`)
    return 2
  }
  return 0
}

// the phase loop (D.1; the no-phase mode runs this loop too, plans/0047 L2):
// derive the current phase → with the task index listing no task, open a
// planning session → the main loop executes → with this phase's tasks all
// done, hand over → the phase completion rename derives the next phase; all
// phases complete exits 0. Environment errors such as a missing or invalid
// phase/task index exit 1 (§H).
// no-phase mode (ctx.manual, phases = "m"): the single phase P01-implement is
// manual — tasks are written by the human, a planning session opens only when
// a planning input was given or the planning step is not closed out
// (planPhase, plans/0053 D12), there is no handover, the phase stays
// incomplete (re-running after appending tasks just continues), and with all
// tasks done the round-complete line prints and it exits 0.
// step pause (phase boundary, OPENCODE_AUTO_STEP ≥ phase): a hard pause after
// the handover (completion+commit) finishes and before the next routing pass
// — after the last phase's pause, Enter means "all phases complete" and it
// exits.
// plan runs the same loop under its stop condition (opts.stopBefore,
// plans/0053 D6): it goes through handovers and knowledge phases as run does,
// and stops after a successful planning step or where an execute route would
// start, printing what to review; the complete route adds the next step (D8).
export async function handoverWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, repl } = ctx
  const code = await handoverPhase(ctx, phase)
  if (code !== 0) return code
  await stepPause("phase", `phase ${phaseTitle(phase)} handover`, { interactive: repl, dir: directory })
  // /exit checkpoint (phase boundary): the request flag lives in the run's
  // control service on ctx, as the router state beside it does.
  ctx.control.maybeExit("phase", `phase ${phaseTitle(phase)} handover`)
  // Hibernate window (phase boundary, OPENCODE_AUTO_HIBERNATE): a safe spot to
  // check after the handover (snapshot+completion+commit) completes; sleep
  // until wake inside the window before entering the next phase
  // (plans/0027-hibernate-design.md).
  await hibernatePause(`phase ${phaseTitle(phase)} handover boundary`, { dir: directory })
  // failback retry (phase boundary): every scope resets at the phase
  // boundary; /failback requests are consumed at the same point. Registry
  // routing (plans/0055 §6.4): every scope covers the phase boundary, so the
  // down marks clear here.
  ctx.router.clearDownMarks("phase", autoSwitches().modelFailbackScope)
  ctx.router.consumeFailback()
  return 0
}

export async function runPhaseLoop(ctx: LoopCtx): Promise<number> {
  try {
    return await phaseLoop(ctx)
  } finally {
    // plan's input backstop (plans/0053 D8): the prelude refuses an input no
    // phase would take, so this fires only where the loop stopped short of a
    // planning step (a gate, a block, a phase whose tasks were listed by hand).
    if (ctx.input) log("⚠ the planning input was not used: no planning step ran on it, so it was not saved; pass it again to a later plan")
  }
}

async function phaseLoop(ctx: LoopCtx): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  for (;;) {
    const route = await routePhase(directory, { loadPlan, bin: shellProfile().bin })
    if (route.type === "blocked") {
      log(`⏸ phase flow blocked: ${route.reason}`)
      return 1
    }
    if (route.type === "complete") {
      log("✓ all phases complete")
      for (const line of await roundResolveLines(directory)) log(line)
      // the round-complete line (STATS_PLAN §4.4, T-006): the phase count is
      // the phase index's done count (this round's already-handed-over
      // phases); the cumulative across-rounds segment is appended by the
      // constructor itself when history.rounds > 0.
      const state = await phaseState(directory)
      const lines = await roundCompleteLines(directory, { phaseCount: state.done.size })
      if (lines) for (const line of lines) log(line)
      // Round-close report (plans/0049 G8, anchor a): the checks the next
      // round's start enforces, reported on every complete run; the exit code
      // is unaffected.
      for (const line of roundCloseLines(await roundCloseProblems(directory, state.round, { build: opts.build, scanExempt: opts.scanExempt }))) log(line)
      // plan does not open the next round here (plans/0053 D8): the round's
      // ## Close cannot be filled in yet, so the round-close checks would fail.
      if (opts.stopBefore === "execute") log(roundCompleteNext(directory, state.round))
      return 0
    }
    // the phase-switch hook point (STATS_PLAN §3): a change of the
    // phase-qualified id resets the phase bucket; the same id is idempotent.
    // blocked has already returned and complete is about to exit, neither
    // needs the switch.
    await statsPhase(directory, phaseKey(route.phase).id)
    // Session resume takes precedence over file-derived routing
    // (plans/0018-session-resume-precedence-design.md): an unclosed phase-step
    // resume point on the driver side (the last run's planning/appending/
    // handover session was interrupted before the driver closed it out) →
    // re-enter that step and reuse the interrupted session, even if the
    // task/phase index has already moved file routing on. Task units and
    // handover docs are written by the AI (or patched by the driver after the
    // interruption) and cannot prove the session closed out; only closeStep
    // deleting the resume point does. It applies only when the step's phase is
    // the current routed phase and is not done: another phase (manual
    // rollback, stale record) lets file routing win, and a done phase clears
    // the stale record. The point is keyed by the qualified phase id R-NN.P<nn>
    // (a type may repeat within a round); a record without one (pre-M3.6
    // `letter`) matches no phase and file routing wins.
    // The check precedes the m-mode branch below (plans/0053 D12), so an
    // interrupted m-mode planning or appending step is finished by whichever
    // command runs next, from its persisted planning input; a record with no
    // input to plan against (it predates the input) is closed, and file
    // routing continues. An interrupted append re-enters through appendPlan
    // (plans/0053 D23), never a full planPhase.
    const open = await openStep(directory)
    if (open) {
      const state = await phaseState(directory)
      const owner = state.phases.find((unit) => phaseKey(unit).id === open.unit)
      if (owner && state.done.has(owner.id)) {
        await closeStep(directory, open.step, open.unit)
      } else if (
        ctx.manual &&
        (open.step === "phase-plan" || open.step === "phase-append") &&
        open.unit === phaseKey(route.phase).id &&
        !ctx.input &&
        !(await readPlanInput(directory, route.phase))?.trim()
      ) {
        log(
          `⚠ unclosed m-mode ${open.step === "phase-plan" ? "planning" : "appending"} resume point (${open.unit}) has no planning input (${planInputPath(route.phase)}) to plan against; ` +
            `closing it and continuing with the file-derived route`,
        )
        await closeStep(directory, open.step, open.unit)
      } else if (open.unit === phaseKey(route.phase).id) {
        const stepName = open.step === "phase-plan" ? "phase planning" : open.step === "phase-append" ? "task appending" : "phase handover"
        log(`↻ session resume point takes precedence: the ${stepName} session(${phaseTitle(route.phase)}) was not closed out; re-entering that step to continue`)
        if (open.step === "phase-plan") {
          banner(`${phaseTitle(route.phase)} phase planning`)
          const code = await planWithStep(ctx, route.phase)
          if (code !== 0 || opts.stopBefore === "execute") return code
          continue
        }
        if (open.step === "phase-append") {
          banner(`${phaseTitle(route.phase)} task append`)
          const code = await appendWithStep(ctx, route.phase)
          if (code !== 0 || opts.stopBefore === "execute") return code
          continue
        }
        // handover re-entry only when file routing is handover too (this
        // phase's tasks all done): otherwise (the anomalous state of
        // unfinished tasks remaining) the handover would mark a phase with
        // unfinished tasks complete, so file routing wins and a warning
        // prints.
        if (route.type === "handover") {
          const code = await handoverWithStep(ctx, route.phase)
          if (code !== 0) return code
          continue
        }
        log(
          `⚠ unclosed handover resume point (${open.unit}) is inconsistent with the current route (${route.type})` +
            `(unfinished tasks remain?); continuing with the file-derived route, not re-entering the handover to avoid losing unfinished tasks`,
        )
      } else {
        log(
          `⚠ unclosed phase-step resume point (${open.step} ${open.unit ?? "unrecorded phase"}) is inconsistent with the current route phase (${phaseTitle(route.phase)}); ` +
            `continuing with the file-derived route (ignore if this was a manual rollback; otherwise check .auto/progress.json)`,
        )
      }
    }
    // An append this run was asked for (plans/0053 D23): the phase the route
    // names now already has its index written — tasks pending (execute route)
    // or the phase distilled / gate-stopped (handover route) — so new tasks
    // are appended to it, never a full planning step and never another phase.
    // It always rides an input (the prelude refuses --append without one, and
    // m mode implies the append from an input on a non-empty index), so the
    // input still being unconsumed is what makes this an append: a planning
    // step consumed it otherwise, and appendPlan consumes it here.
    if (ctx.input !== undefined && route.type !== "plan" && (ctx.append || ctx.manual)) {
      banner(`${phaseTitle(route.phase)} task append`)
      const code = await appendWithStep(ctx, route.phase)
      if (code !== 0 || opts.stopBefore === "execute") return code
      continue
    }
    // manual mode (no phases): with no task to run it wraps up — an empty
    // task index prompts a fill-in, all tasks complete prints the
    // round-complete line; both exit 0 with the phase left incomplete. A
    // planning input handed to this run (ctx.input) is the exception: m mode
    // then plans on planPhase like a phase (plans/0053 D12).
    if (ctx.manual && route.type !== "execute" && !(route.type === "plan" && ctx.input)) {
      if (route.type === "plan") {
        for (const line of emptyIndexNotice(directory, route.plan.index)) log(line)
        return 0
      }
      log("✓ all tasks complete")
      // the round proxy-answer summary (plans/0020-auto-resolve-design.md
      // §H-③, H6): pinned above the ■ round line.
      for (const line of await roundResolveLines(directory)) log(line)
      // the round-complete line on the unphased path (STATS_PLAN §4.4,
      // T-006): the phase bucket is always the "m" pseudo phase, so the phase
      // segment is omitted.
      const lines = await roundCompleteLines(directory)
      if (lines) for (const line of lines) log(line)
      return 0
    }
    if (route.type === "plan") {
      // a k (knowledge distillation) phase claims the whole --extract-knowledge
      // design (P4): no planning session, no task index written — the plan
      // route goes straight into the knowledge-extraction bypass session (the
      // artifact is the type's standard artifact P<nn>-knowledge/kb.md inside
      // the phase directory; already produced = idempotent skip), then hands
      // over as usual. Extraction failure only prints a ⚠ warning and does
      // not pollute the exit code (a successful migration is not polluted in
      // turn by a document generation failure); when the human writes the task
      // index in the k phase by hand, the generic execute/handover routes
      // apply and the extraction hook point does not fire.
      // the criterion is the registry's hasTasks: false (M3.2); the direct
      // session is knowledge-extraction-only — among the builtin types only
      // knowledge has no tasks, custom types always have tasks (M3.6,
      // src/phases/custom.ts), so the session choice needs no generalization.
      if (!route.phase.entry.hasTasks) {
        banner("k knowledge distillation: migration knowledge capture")
        // The round report (plans/0081 D6b): when this knowledge phase is the
        // round's last, the one session writes two artifacts — kb.md
        // machine-facing, docs/R-NN/report-for-user.md human-facing — and
        // both are hard requirements (D5: the user report is unconditional).
        const knowState = await phaseState(directory)
        const knowLast = knowState.phases.at(-1)
        const report = knowLast && knowLast.id === route.phase.id ? reportForUserPath(knowState.round) : undefined
        const extracted = await extractKnowledge(serverHandle, directory, sessionOpts(ctx, { site: "knowledge" }), route.phase, {
          ...(report !== undefined ? { report } : {}),
        })
        if (extracted.type === "ok") log(`✓ migration knowledge document produced: ${extracted.file}${report !== undefined ? ` and the round report ${report}` : ""}`)
        else if (extracted.type === "skipped") log(`↻ migration knowledge document already produced (${extracted.file}); skipping extraction, going straight to handover`)
        else if (extracted.type === "dirty") {
          // dirty (plans/0021-commit-boundary-design.md ④ generalization): an
          // unclean worktree (leftover from an abandoned extraction, make-up
          // commit failure or unified commit failure) must stop for the
          // human — handing over anyway would start the next unit on an
          // unclean baseline, breaking the commit boundary.
          log(`⏸ migration knowledge extraction could not complete or post on a clean baseline; handle it manually (commit/clean) and re-run:`)
          for (const file of extracted.files) log(`  ${file}`)
          return 2
        } else {
          if (report !== undefined) {
            // The report is a completion requirement of a k-final round
            // (plans/0081 D5): unlike kb.md alone, a round without its report
            // does not close, so the failure blocks instead of warning.
            log(`⏸ migration knowledge capture incomplete and the round report ${report} was not produced; the round cannot close without it. Block details:\n${extracted.question}`)
            return 2
          }
          log(
            `⚠ migration knowledge capture incomplete (knowledge_extraction_error); exit code unaffected, the k phase hands over as usual; ` +
              `fix the issue, then retry separately per the manual rollback procedure (rename the knowledge phase's done.md back to todo.md and delete its kb.md). Block details:\n${extracted.question}`,
          )
        }
        const code = await handoverWithStep(ctx, route.phase)
        if (code !== 0) return code
        continue
      }
      banner(`${phaseTitle(route.phase)} phase planning`)
      const code = await planWithStep(ctx, route.phase)
      // plan's stop condition (plans/0053 D6): a planning step that succeeded
      // is where plan stops; planWithStep printed the summary.
      if (code !== 0 || opts.stopBefore === "execute") return code
      continue
    }
    if (route.type === "execute") {
      // plan's stop condition (plans/0053 D6, D7): an execute route this run
      // did not plan (planning stops the run itself), e.g. a next phase whose
      // tasks were listed by hand. An input left over is plan's usage error.
      if (opts.stopBefore === "execute") {
        for (const line of executeNotice(directory, route, ctx.manual)) log(line)
        return ctx.input ? 1 : 0
      }
      const code = await runTaskLoop(ctx, route.phase)
      if (code !== 0) return code
      continue
    }
    const code = await handoverWithStep(ctx, route.phase)
    if (code !== 0) return code
  }
}
